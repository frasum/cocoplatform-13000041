// M-Statistik Schritt 2 — Read-Server-Fn: Umsatzkennzahlen für eine Periode
// (oder ein frei wählbares Datumsfenster) inkl. Vorperiode + Trend.
//
// Reine Lese-Funktion. Keine Schreibvorgänge, kein Audit-Log, keine UI.
// Org-Scope strikt aus `loadAdminCaller` — nie aus dem Client-Input.
//
// S-6 (siehe gruendungsdokument.md, Nachtrag M-Statistik): ALLE Session-
// Status (`open|finalized|locked`) werden gezählt. Leere Tage tragen 0;
// `daysWithRevenue` aus `summarize` zählt nur Tage mit total > 0.
//
// S-3 (revidiert 29.06.2026): Statistik rechnet KALENDERMONATE (1. bis
// Monatsende), nicht die 26.–25.-Abrechnungsperiode. Lohn/Zeit nutzen
// weiterhin `periods`. Diese Fn berührt `periods` NICHT.
//
// STAT1: Die Umsatzableitung liegt vollständig in `decomposeRevenue`
// (N14-Zerlegung). Diese Fn liefert nur Kanal-`kind` + Betrag zu; TSB-`pos`
// ist dort als additive Zweitkasse abgebildet, Marker/SoUse als Abzug.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import {
  aggregateByBusinessDate,
  computeTrend,
  groupTakeawayByChannel,
  summarize,
  sumGuestsByDate,
  type DailyRevenue,
  type TakeawayChannel,
  type PeriodSummary,
  type Trend,
} from "./revenue-core";
import { mapToSessionInputs, type ChannelAmountRow, type SessionRow } from "./revenue-map";
import { loadPausenBezahlt, loadWorkMinutesEntries } from "./work-minutes.server";
import { totalWorkMinutes, workMinutesByDate } from "./work-minutes";
import {
  currentMonth,
  monthRange,
  previousMonthRange,
  previousRangeForDates,
} from "./period-window";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

type ChannelAmountQueryRow = {
  session_id: string;
  amount_cents: number;
  revenue_channels: { kind: string; label: string } | null;
};

type Window = { startDate: string; endDate: string };

/** STAT2 — Tageszeile mit Gästen und Arbeitsminuten. */
type DailyRow = DailyRevenue & { guestCount: number; workMinutes: number };

export const getRevenueStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        month: z.string().regex(MONTH_RE).optional(),
        startDate: z.string().regex(DATE_RE).optional(),
        endDate: z.string().regex(DATE_RE).optional(),
        locationId: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const org = caller.organizationId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // STAT2 — Arbeitsstunden kommen aus derselben Quelle wie die
    // Personalquote (work-minutes.server + paidMinutes). Keine zweite
    // Stundenformel; siehe KGL-Begründung in work-minutes.ts.
    const pausenBezahlt = await loadPausenBezahlt(supabaseAdmin, org);

    // Zeitraum + Vorperiode auflösen (identisch zu getTipStats).
    let current: Window;
    let previous: Window | null;
    let label: string | null;
    // Monatsmodus markieren — nur dort wird Vorperiode ggf. an `lastDataDay`
    // geklemmt (U5a: fairer Vergleich bei unvollständigem laufendem Monat).
    let monthForClamp: string | null = null;

    if (data.month) {
      current = monthRange(data.month);
      previous = previousMonthRange(data.month);
      label = data.month;
      monthForClamp = data.month;
    } else if (data.startDate && data.endDate) {
      if (data.endDate < data.startDate) {
        throw new Error("endDate muss ≥ startDate sein.");
      }
      current = { startDate: data.startDate, endDate: data.endDate };
      previous = previousRangeForDates(data.startDate, data.endDate);
      label = null;
    } else if (!data.startDate && !data.endDate) {
      const m = currentMonth();
      current = monthRange(m);
      previous = previousMonthRange(m);
      label = m;
      monthForClamp = m;
    } else {
      throw new Error("startDate und endDate müssen gemeinsam gesetzt sein.");
    }

    // 3) Fenster laden: Sessions + Channel-Amounts.
    async function loadWindow(win: Window): Promise<{
      daily: DailyRow[];
      summary: PeriodSummary;
      takeawayByChannel: TakeawayChannel[];
      takeawayComponents: { markerSumCents: number; souseSumCents: number };
      guestTotal: number;
      workMinutesTotal: number;
    }> {
      let sessionQuery = supabaseAdmin
        .from("sessions")
        .select("id, business_date, location_id, vectron_daily_total_cents, guest_count")
        .eq("organization_id", org)
        .gte("business_date", win.startDate)
        .lte("business_date", win.endDate);
      if (data.locationId) {
        sessionQuery = sessionQuery.eq("location_id", data.locationId);
      }
      const { data: sessRows, error: sessErr } = await sessionQuery;
      if (sessErr) throw sessErr;

      const sessions: SessionRow[] = (sessRows ?? []).map((r) => ({
        id: r.id as string,
        businessDate: r.business_date as string,
        locationId: r.location_id as string,
        vectronCents: (r.vectron_daily_total_cents as number | null) ?? 0,
      }));

      // STAT2 — Gäste je Geschäftstag: Σ über alle Sessions des Tages
      // (mehrere Standorte im Filter „alle" summieren korrekt auf).
      const { byDate: guestsByDate, total: guestTotal } = sumGuestsByDate(
        (sessRows ?? []).map((r) => ({
          businessDate: r.business_date as string,
          guestCount: (r.guest_count as number | null) ?? 0,
        })),
      );

      let channels: ChannelAmountRow[] = [];
      const takeawayRaw: { name: string; amountCents: number }[] = [];
      let markerSumCents = 0;
      let souseSumCents = 0;
      const cardBySession = new Map<string, number>();
      if (sessions.length > 0) {
        const ids = sessions.map((s) => s.id);
        const { data: chRows, error: chErr } = await supabaseAdmin
          .from("session_channel_amounts")
          .select("session_id, amount_cents, revenue_channels(kind, label)")
          .eq("organization_id", org)
          .in("session_id", ids)
          .returns<ChannelAmountQueryRow[]>();
        if (chErr) throw chErr;
        channels = (chRows ?? []).map((r) => ({
          sessionId: r.session_id,
          amountCents: r.amount_cents,
          kind: r.revenue_channels?.kind ?? "",
        }));
        for (const r of chRows ?? []) {
          // STAT1: Donut-Segmente = Marker + SoUse. `delivery_wolt` steckt
          // im Marker und ist reine Info (siehe `woltInfoCents`).
          const kind = r.revenue_channels?.kind;
          if (kind === "delivery_vectron" || kind === "delivery_souse") {
            takeawayRaw.push({
              name: r.revenue_channels?.label ?? kind,
              amountCents: r.amount_cents,
            });
            if (kind === "delivery_vectron") markerSumCents += r.amount_cents;
            else souseSumCents += r.amount_cents;
          }
        }

        // STAT-U2 — Kreditkartensummen pro Session aus waiter_settlements
        // (nur aktive, d.h. status != 'superseded'). Reine Aggregation zur
        // Laufzeit, keine Persistenz.
        const { data: wsRows, error: wsErr } = await supabaseAdmin
          .from("waiter_settlements")
          .select("session_id, card_total_cents, status")
          .eq("organization_id", org)
          .in("session_id", ids)
          .neq("status", "superseded");
        if (wsErr) throw wsErr;
        for (const r of wsRows ?? []) {
          const sid = r.session_id as string;
          const cents = (r.card_total_cents as number | null) ?? 0;
          cardBySession.set(sid, (cardBySession.get(sid) ?? 0) + cents);
        }
      }

      const inputs = mapToSessionInputs(sessions, channels);
      const dailyBase = aggregateByBusinessDate(inputs, cardBySession);

      const workEntries = await loadWorkMinutesEntries(supabaseAdmin, {
        organizationId: org,
        startDate: win.startDate,
        endDate: win.endDate,
        locationId: data.locationId,
        pausenBezahlt,
      });
      const minutesByDate = workMinutesByDate(workEntries);
      const workMinutesTotal = totalWorkMinutes(workEntries);

      const daily: DailyRow[] = dailyBase.map((d) => ({
        ...d,
        guestCount: guestsByDate.get(d.businessDate) ?? 0,
        workMinutes: minutesByDate.get(d.businessDate) ?? 0,
      }));
      return {
        daily,
        summary: summarize(dailyBase),
        takeawayByChannel: groupTakeawayByChannel(takeawayRaw),
        takeawayComponents: { markerSumCents, souseSumCents },
        guestTotal,
        workMinutesTotal,
      };
    }

    const cur = await loadWindow(current);

    // U5a: Im Monatsmodus Vorperiode auf den Tagesausschnitt klemmen, in dem
    // der laufende Monat tatsächlich Daten hat. Keine Daten → keine Vorperiode.
    let lastDataDay: string | null = null;
    let isPartial = false;
    if (monthForClamp) {
      const daysWithData = cur.daily.filter((d) => d.totalCents > 0).map((d) => d.businessDate);
      lastDataDay = daysWithData.length > 0 ? daysWithData.reduce((a, b) => (a > b ? a : b)) : null;
      const monthLastDay = Number(monthRange(monthForClamp).endDate.slice(8, 10));
      const throughDay = lastDataDay ? Number(lastDataDay.slice(8, 10)) : null;
      isPartial = throughDay !== null && throughDay < monthLastDay;
      if (lastDataDay === null) {
        previous = null;
      } else if (isPartial && throughDay !== null) {
        previous = previousMonthRange(monthForClamp, throughDay);
      }
    }

    const prev = previous ? await loadWindow(previous) : null;

    const trend: { total: Trend; house: Trend; takeaway: Trend } | null = prev
      ? {
          total: computeTrend(cur.summary.totalCents, prev.summary.totalCents),
          house: computeTrend(cur.summary.houseCents, prev.summary.houseCents),
          takeaway: computeTrend(cur.summary.takeawayCents, prev.summary.takeawayCents),
        }
      : null;

    return {
      range: { startDate: current.startDate, endDate: current.endDate, label },
      daily: cur.daily,
      summary: cur.summary,
      takeawayByChannel: cur.takeawayByChannel,
      takeawayComponents: cur.takeawayComponents,
      // STAT3b — Kanal-Bestandteile des (ggf. U5a-geklemmten) Vorfensters.
      // `loadWindow` berechnet sie ohnehin; hier wird nur zurückgegeben.
      previousTakeawayComponents: prev ? prev.takeawayComponents : null,
      previousWoltInfoCents: prev ? prev.summary.woltInfoCents : null,
      // STAT2 — Summen für die Kacheln „Ø Umsatz je Gast" / „je Arbeitsstunde".
      guestTotal: cur.guestTotal,
      workMinutesTotal: cur.workMinutesTotal,
      previous: prev ? prev.summary : null,
      previousDerived: prev
        ? { guestTotal: prev.guestTotal, workMinutesTotal: prev.workMinutesTotal }
        : null,
      // Vergleichsfenster (nach U5a-Klemmung) für die UI-Untertitel.
      previousRange:
        prev && previous ? { startDate: previous.startDate, endDate: previous.endDate } : null,
      trend,
      coverage: { lastDataDay, isPartial },
    };
  });
