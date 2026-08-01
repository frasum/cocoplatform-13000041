// MB1 — Read-Server-Fn: Monatsentwicklung (Legacy-Historie + live gerechnete
// Monate) je Standort und als Summe.
//
// Reine Lese-Funktion. Org-Scope strikt aus `loadAdminCaller`, nie aus dem
// Client-Input. Die Zusammenführung und alle Kennzahlen liegen rein in
// `monthly-core.ts`; hier steht nur der IO-Rand.
//
// Live-Monate werden NICHT gespeichert (kein abgeleiteter Wert): die Matrix
// entsteht zur Laufzeit aus `monthly_revenue_history` (< LIVE_FROM) und den
// Sessions (>= LIVE_FROM) über `decomposeRevenue`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { selectAllPaged } from "@/lib/supabase/select-all";
import { mapToSessionInputs, type ChannelAmountRow, type SessionRow } from "./revenue-map";
import {
  LIVE_FROM,
  aggregateLiveMonths,
  mergeMonthlyCells,
  monthlyHeadline,
  toYearRows,
  type LegacyRow,
  type MonthlyCell,
  type MonthlyHeadline,
  type YearRow,
} from "./monthly-core";
import { currentMonth } from "./period-window";

const MONTH_RE = /^\d{4}-\d{2}$/;

/** Sammel-Schlüssel der summierten Ansicht („beide Standorte"). */
export const ALL_LOCATIONS = "all";

export type MonthlySeries = {
  locationId: string;
  locationName: string;
  cells: MonthlyCell[];
  years: YearRow[];
  headline: MonthlyHeadline;
};

type ChannelQueryRow = {
  session_id: string;
  amount_cents: number;
  revenue_channels: { kind: string } | null;
};

export const getMonthlyRevenueMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ month: z.string().regex(MONTH_RE).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const org = caller.organizationId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const nowMonth = currentMonth();
    const focusMonth = data.month ?? nowMonth;
    const focusYear = Number(focusMonth.slice(0, 4));
    const focusMonthNo = Number(focusMonth.slice(5, 7));

    // 1) Standorte (Namen für die Umschalter und das PDF).
    const { data: locRows, error: locErr } = await supabaseAdmin
      .from("locations")
      .select("id, name")
      .eq("organization_id", org)
      .order("name", { ascending: true });
    if (locErr) throw locErr;
    const locations = (locRows ?? []).map((l) => ({
      id: l.id as string,
      name: l.name as string,
    }));

    // 2) Legacy-Historie (< LIVE_FROM; die Grenze zieht `mergeMonthlyCells`).
    const legacyRows = await selectAllPaged<{
      location_id: string;
      year: number;
      month: number;
      total_cents: number;
      takeaway_cents: number | null;
    }>((from, to) =>
      supabaseAdmin
        .from("monthly_revenue_history")
        .select("location_id, year, month, total_cents, takeaway_cents")
        .eq("organization_id", org)
        .order("year", { ascending: true })
        .order("month", { ascending: true })
        .range(from, to),
    );

    // 3) Sessions ab LIVE_FROM + Kanalbeträge.
    const sessionRows = await selectAllPaged<{
      id: string;
      business_date: string;
      location_id: string;
      vectron_daily_total_cents: number | null;
    }>((from, to) =>
      supabaseAdmin
        .from("sessions")
        .select("id, business_date, location_id, vectron_daily_total_cents")
        .eq("organization_id", org)
        .gte("business_date", LIVE_FROM)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const sessions: SessionRow[] = (sessionRows ?? []).map((r) => ({
      id: r.id,
      businessDate: r.business_date,
      locationId: r.location_id,
      vectronCents: r.vectron_daily_total_cents ?? 0,
    }));

    let channels: ChannelAmountRow[] = [];
    if (sessions.length > 0) {
      // `session_channel_amounts` kennt kein Datum — es wird über die
      // geladenen Session-IDs gefiltert (Sessions beginnen 16.02.2026).
      const chRows = await selectAllPaged<ChannelQueryRow>((from, to) =>
        supabaseAdmin
          .from("session_channel_amounts")
          .select("session_id, amount_cents, revenue_channels(kind)")
          .eq("organization_id", org)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<ChannelQueryRow[]>(),
      );
      const known = new Set(sessions.map((s) => s.id));
      channels = (chRows ?? [])
        .filter((r) => known.has(r.session_id))
        .map((r) => ({
          sessionId: r.session_id,
          amountCents: r.amount_cents,
          kind: r.revenue_channels?.kind ?? "",
        }));
    }

    const live = aggregateLiveMonths(mapToSessionInputs(sessions, channels));

    // 4) Serien bauen: je Standort + summierte Gesamtansicht.
    function buildSeries(locationId: string, locationName: string): MonthlySeries {
      const isAll = locationId === ALL_LOCATIONS;
      const legacy = accumulate(
        (legacyRows ?? [])
          .filter((r) => isAll || r.location_id === locationId)
          .map((r) => ({
            year: r.year,
            month: r.month,
            totalCents: Number(r.total_cents),
            takeawayCents: r.takeaway_cents === null ? null : Number(r.takeaway_cents),
          })),
      );
      const liveRows = live
        .filter((r) => isAll || r.locationId === locationId)
        .map((r) => ({
          year: r.year,
          month: r.month,
          totalCents: r.totalCents,
          takeawayCents: r.takeawayCents,
        }));
      const liveMerged = accumulate(liveRows).map((r) => ({
        year: r.year,
        month: r.month,
        totalCents: r.totalCents,
        takeawayCents: r.takeawayCents ?? 0,
      }));
      const cells = mergeMonthlyCells({
        legacy,
        live: liveMerged,
        currentMonthKey: nowMonth,
      });
      return {
        locationId,
        locationName,
        cells,
        years: toYearRows(cells),
        headline: monthlyHeadline(cells, focusYear, focusMonthNo, nowMonth),
      };
    }

    const series: MonthlySeries[] = [
      ...locations.map((l) => buildSeries(l.id, l.name)),
      buildSeries(ALL_LOCATIONS, "Alle Standorte"),
    ];

    return {
      liveFrom: LIVE_FROM,
      currentMonthKey: nowMonth,
      focusMonth,
      locations,
      series,
    };
  });

/** Monatszeilen mehrerer Standorte auf einen Wert je Monat summieren. */
function accumulate(rows: readonly LegacyRow[]): LegacyRow[] {
  const acc = new Map<string, LegacyRow>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    const existing = acc.get(key);
    if (existing) {
      existing.totalCents += r.totalCents;
      if (r.takeawayCents !== null) {
        existing.takeawayCents = (existing.takeawayCents ?? 0) + r.takeawayCents;
      }
    } else {
      acc.set(key, { ...r });
    }
  }
  return Array.from(acc.values());
}
