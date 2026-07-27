// 2b — Perioden-Aggregation für SFN-Zuschläge.
//
// Zustandslose, admin-gated Serverfunktion: liest time_entries einer Periode,
// erzeugt SFN-Rohzeilen via timeEntryToSfnRow und rechnet beide Modi
// (simple, extended) durch berechneSfnGeld. KEIN Schreiben, KEIN Audit-Log.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertPermission } from "@/lib/admin/admin-call";
import { timeEntryToSfnRow } from "./time-entry-sfn";
import { berechneSfnGeld } from "./sfn-geld/sfn-geld";
import type { SfnGeldErgebnis } from "./sfn-geld/types";
import { bavarianHolidaySurchargeRate } from "./holiday-rate";
import { countDistinctWorkdays } from "./fixed-zeilen";
import { dropPoolWhenRealEntryExists } from "@/lib/cash/pool-time-writeback";
import { calculateShiftHours } from "@/lib/time/sfn/tagesabrechnung";
import { isSundayOrHoliday } from "@/lib/time/shift-hours";
import { paidHours } from "@/lib/time/paid-hours";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export interface SfnPeriodAggregate {
  hourlyRateCents: number;
  totalHours: number;
  entryCount: number;
  workdayCount: number;
  simple: SfnGeldErgebnis;
  extended: SfnGeldErgebnis;
}

/**
 * Reine Aggregation: liest Stundensatz + abgeschlossene time_entries einer
 * Periode und berechnet beide SFN-Modi. Wird von zwei Server-Functions
 * geteilt (eine createServerFn darf keine andere createServerFn aufrufen).
 */
export async function aggregateSfnPeriod(
  supabaseAdmin: SupabaseClient<Database>,
  staffId: string,
  fromDate: string,
  toDate: string,
): Promise<SfnPeriodAggregate> {
  const { data: comp, error: compErr } = await supabaseAdmin
    .from("staff_compensation")
    .select("hourly_rate")
    .eq("staff_id", staffId)
    .maybeSingle();
  if (compErr) throw compErr;
  const hourlyRateCents = Math.round(Number(comp?.hourly_rate ?? 0) * 100);

  // PB2 — Grundlohnbasis folgt dem Org-Schalter `pausen_bezahlt` (Default TRUE
  // = Bestandsverhalten aus PB1). IO-Rand ausschließlich hier; die SFN-Töpfe
  // laufen unverändert netto durch `applyBreakProration`. Kein Aufruf in
  // `compute-staff-sfn.ts` — das bleibt eine reine Funktion.
  const { data: staffOrg, error: staffOrgErr } = await supabaseAdmin
    .from("staff")
    .select("organization_id")
    .eq("id", staffId)
    .maybeSingle();
  if (staffOrgErr) throw staffOrgErr;
  const orgId = staffOrg?.organization_id ?? null;
  let pausenBezahlt = true;
  if (orgId) {
    const { data: orgSet, error: orgSetErr } = await supabaseAdmin
      .from("organization_settings")
      .select("pausen_bezahlt")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (orgSetErr) throw orgSetErr;
    pausenBezahlt = orgSet?.pausen_bezahlt ?? true;
  }

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, ended_at, business_date, break_minutes, source")
    .eq("staff_id", staffId)
    .gte("business_date", fromDate)
    .lte("business_date", toDate)
    .not("ended_at", "is", null);
  if (entriesErr) throw entriesErr;

  const filteredEntries = dropPoolWhenRealEntryExists(
    (entries ?? [])
      .filter((e) => e.ended_at != null)
      .map((e) => ({ ...e, businessDate: e.business_date, source: e.source as string })),
  );

  const rows = filteredEntries.map((e) =>
    timeEntryToSfnRow({
      startedAt: e.started_at,
      endedAt: e.ended_at as string,
      businessDate: e.business_date,
      breakMinutes: e.break_minutes ?? 0,
    }),
  );

  const holidayRates = new Map<string, number>();
  for (const r of rows) {
    if (r.isHoliday) holidayRates.set(r.shiftDate, bavarianHolidaySurchargeRate(r.shiftDate));
  }

  const simple = berechneSfnGeld(rows, "simple", hourlyRateCents, holidayRates);
  const extended = berechneSfnGeld(rows, "extended", hourlyRateCents, holidayRates);

  // Grundlohn-Stunden: pro Eintrag über `paidHours(gross, break, pausenBezahlt)`.
  // `gross` stammt aus `calculateShiftHours` (identisch zur Quelle, die auch
  // `timeEntryToSfnRow` intern nutzt). Bei `pausenBezahlt=false` bit-identisch
  // zum bisherigen Netto-Ergebnis (Golden-Master hat Pause=0, siehe PB2-Bericht).
  const berlinHHMM = (iso: string): string => {
    const parts = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    return `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`;
  };
  const paidTotal = filteredEntries.reduce((s, e) => {
    const businessDay = new Date(`${e.business_date}T12:00:00Z`);
    const raw = calculateShiftHours({
      start: berlinHHMM(e.started_at),
      end: berlinHHMM(e.ended_at as string),
      sundayOrHoliday: isSundayOrHoliday(businessDay),
    });
    return s + paidHours(raw.totalHours, e.break_minutes ?? 0, pausenBezahlt);
  }, 0);
  const totalHours = Math.round(paidTotal * 100) / 100;
  const workdayCount = countDistinctWorkdays(rows.map((r) => r.shiftDate));

  return { hourlyRateCents, totalHours, entryCount: rows.length, workdayCount, simple, extended };
}

export const getSfnPeriodForStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        fromDate: z.string().regex(dateRegex),
        toDate: z.string().regex(dateRegex),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, "payroll.period.view");
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("id", data.staffId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staff) throw new Error("Mitarbeiter nicht in dieser Organisation.");

    return aggregateSfnPeriod(supabaseAdmin, data.staffId, data.fromDate, data.toDate);
  });
