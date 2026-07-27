// 2b — Perioden-Aggregation für SFN-Zuschläge.
//
// Zustandslose, admin-gated Serverfunktion: liest time_entries einer Periode,
// erzeugt SFN-Rohzeilen via timeEntryToSfnRow und rechnet beide Modi
// (simple, extended) durch berechneSfnGeld. KEIN Schreiben, KEIN Audit-Log.
//
// LG3b Etappe 2a-ii — Bereichs-Sätze in der Motorik.
//   * Rate-Quelle ist ausschließlich `staff_compensation_rates` (kein
//     Fallback auf `staff_compensation.hourly_rate` — Variante B).
//   * Jeder Eintrag wird per WZ2 einem Bereich zugeordnet (`attributeEntry`).
//   * Rate je Eintrag via `resolveRateCents` (jüngstes valid_from ≤
//     business_date, kein Bereichs-Fallback). Fehlt der Satz, ist rateCents
//     null — Stunden zählen mit, Geld ist 0 (A1).
//   * SFN wird PRO BEREICH über `berechneSfnGeld` gerechnet und dann
//     addiert (D4 = Option a). Für Ein-Bereichs-Personen bit-identisch
//     zum Alt-Pfad (nur ein Aufruf → eine Rundung).
//   * Der Legacy-Skalar `hourlyRateCents` bleibt für die Rückkompatibilität
//     erhalten und ist auf dem Primär-Bereich (WZ1: gl>kitchen>service) der
//     tatsächlich benutzten Bereiche am `toDate` aufgelöst. In 2a-iii wird
//     die U/K-Rate im Mehrsatz-Fall über `uk-rate-weighted` neu berechnet.
//
// Wirkungsbereich: die Ein-Bereichs-Fixtures in `lg3b-baseline-2a0.test.ts`
// bleiben bit-identisch grün (Nullmessung Verhaltenserhalt). Mehrsatz-Fälle
// verändern sich beabsichtigt (Bereichs-getrennte SFN-Rundung).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertPermission } from "@/lib/admin/admin-call";
import { timeEntryToSfnRow } from "./time-entry-sfn";
import { berechneSfnGeld } from "./sfn-geld/sfn-geld";
import type { SfnGeldErgebnis, SfnShiftRow } from "./sfn-geld/types";
import { bavarianHolidaySurchargeRate } from "./holiday-rate";
import { countDistinctWorkdays } from "./fixed-zeilen";
import { dropPoolWhenRealEntryExists } from "@/lib/cash/pool-time-writeback";
import { calculateShiftHours } from "@/lib/time/sfn/tagesabrechnung";
import { isSundayOrHoliday } from "@/lib/time/shift-hours";
import { paidHours } from "@/lib/time/paid-hours";
import { attributeEntry } from "./entry-attribution";
import { resolveRateCents, type RateRow } from "./rate-resolution";
import { primaryDepartment, type Department } from "@/lib/time/primary-department";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-Bereich-Aggregat innerhalb der Periode. Wird von 2a-iii (Grundlohn-
 * Verdrahtung) und den Exporten (Etappe 2b) benutzt.
 */
export interface SfnDeptSlice {
  department: Department;
  rateCents: number | null;
  paidHours: number;
  entryCount: number;
  simple: SfnGeldErgebnis;
  extended: SfnGeldErgebnis;
}

/**
 * Per-Eintrag-Snapshot für Export-Blocker (Etappe 2b): eine Zeile pro
 * time_entries-Zeile mit Attribution und aufgelöstem Satz.
 */
export interface SfnEntryAttribution {
  businessDate: string;
  department: Department;
  rateCents: number | null;
  paidHours: number;
  unresolved: boolean;
}

export interface SfnPeriodAggregate {
  /**
   * LG3b A2 — Legacy-Skalar: Bereichssatz bei genau einem tatsächlich
   * benutzten Bereich; `null` bei Mehrsatz (Anzeige „—", die Bereichszeilen
   * tragen die Wahrheit). Bit-identisch zum Alt-Wert im Ein-Bereichs-Fall.
   */
  hourlyRateCents: number | null;
  totalHours: number;
  entryCount: number;
  workdayCount: number;
  simple: SfnGeldErgebnis;
  extended: SfnGeldErgebnis;
  /** LG3b — Pro-Bereich-Aufteilung; leere Liste bei komplett leerer Periode. */
  deptSlices: SfnDeptSlice[];
  /** LG3b — Pro-Eintrag-Attribution, in Reihenfolge der Verarbeitung. */
  entryAttribution: SfnEntryAttribution[];
  /**
   * LG3b A5 — ungerundete bezahlte Stunden, deren Bereich WZ2 nicht klären
   * konnte. Speist die A5-Zeile im Rechner und den `unresolved_department`-
   * Export-Blocker.
   */
  unresolvedHoursUnrounded: number;
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

  // LG3b — Bereichs-Sätze (kein Fallback auf staff_compensation.hourly_rate).
  const { data: rateRows, error: rateErr } = await supabaseAdmin
    .from("staff_compensation_rates")
    .select("department, valid_from, hourly_rate")
    .eq("staff_id", staffId);
  if (rateErr) throw rateErr;
  const rates: RateRow[] = (rateRows ?? []).map((r) => ({
    department: r.department as Department,
    validFrom: r.valid_from as string,
    hourlyRateCents: Math.round(Number(r.hourly_rate) * 100),
  }));

  // Bereichs-Zuordnung der Person am Standort (für WZ2-Attribution
  // NULL-Fall). Ohne Zeilen fällt `primaryDepartment` auf 'service'.
  const { data: locRows, error: locErr } = await supabaseAdmin
    .from("staff_locations")
    .select("department")
    .eq("staff_id", staffId);
  if (locErr) throw locErr;
  const staffDepts = Array.from(new Set((locRows ?? []).map((r) => r.department as Department)));

  // LG3b 2a-ii-b — Roster-Signale (rosterArea/rosterHasGlSkill) je business_date.
  // Serverfähiger Signal-Pfad, deckungsgleich zu getTimeOverview (LG2). WZ2
  // gehört in die Motor-Attribution, nicht in die Anzeige (§104-Befund).
  const rosterAreaByDate = new Map<string, Department>();
  const rosterGlByDate = new Set<string>();
  if (orgId) {
    const { data: rosterRows, error: rosterErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("area, skill_id, shift_date")
      .eq("organization_id", orgId)
      .eq("staff_id", staffId)
      .gte("shift_date", fromDate)
      .lte("shift_date", toDate);
    if (rosterErr) throw rosterErr;
    const glSkillIds = new Set<string>();
    const { data: glSkillRows, error: glSkillErr } = await supabaseAdmin
      .from("skills")
      .select("id")
      .eq("organization_id", orgId)
      .eq("category", "gl");
    if (glSkillErr) throw glSkillErr;
    for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);
    for (const r of rosterRows ?? []) {
      const area = r.area as Department | null;
      const skillId = r.skill_id as string | null;
      const iso = r.shift_date as string;
      if (area) {
        const existing = rosterAreaByDate.get(iso);
        rosterAreaByDate.set(iso, existing ? primaryDepartment([existing, area]) : area);
      }
      if (skillId && glSkillIds.has(skillId)) rosterGlByDate.add(iso);
    }
  }

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from("time_entries")
    .select("started_at, ended_at, business_date, break_minutes, source, department")
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

  const berlinHHMM = (iso: string): string => {
    const parts = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(iso));
    return `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`;
  };

  // Per-Eintrag: SfnShiftRow + WZ2-Attribution + Rate-Auflösung + paidHours.
  interface Enriched {
    row: SfnShiftRow;
    dept: Department;
    unresolved: boolean;
    rateCents: number | null;
    paidHrs: number;
    businessDate: string;
  }
  const enriched: Enriched[] = filteredEntries.map((e) => {
    const row = timeEntryToSfnRow({
      startedAt: e.started_at,
      endedAt: e.ended_at as string,
      businessDate: e.business_date,
      breakMinutes: e.break_minutes ?? 0,
    });
    const attr = attributeEntry({
      rawDepartment: (e.department as Department | null) ?? null,
      staffDepts,
      // LG3b 2a-ii-b — Roster-Signale je business_date aus derselben
      // Quelle wie getTimeOverview (LG2). Ein-Bereich ist signal-invariant
      // (die 2a-0-Baselines bleiben bit-identisch grün).
      rosterArea: rosterAreaByDate.get(e.business_date) ?? null,
      rosterHasGlSkill: rosterGlByDate.has(e.business_date),
    });
    const rateCents = resolveRateCents(rates, attr.department, e.business_date);
    const businessDay = new Date(`${e.business_date}T12:00:00Z`);
    const gross = calculateShiftHours({
      start: berlinHHMM(e.started_at),
      end: berlinHHMM(e.ended_at as string),
      sundayOrHoliday: isSundayOrHoliday(businessDay),
    });
    const paidHrs = paidHours(gross.totalHours, e.break_minutes ?? 0, pausenBezahlt);
    return {
      row,
      dept: attr.department,
      unresolved: attr.unresolved,
      rateCents,
      paidHrs,
      businessDate: e.business_date,
    };
  });

  const holidayRates = new Map<string, number>();
  for (const en of enriched) {
    if (en.row.isHoliday)
      holidayRates.set(en.row.shiftDate, bavarianHolidaySurchargeRate(en.row.shiftDate));
  }

  // Nach Bereich gruppieren, SFN je Bereich rechnen, addieren.
  const groups = new Map<Department, Enriched[]>();
  for (const en of enriched) {
    const list = groups.get(en.dept);
    if (list) list.push(en);
    else groups.set(en.dept, [en]);
  }

  const emptyBuckets = (): SfnGeldErgebnis => ({
    night25Hours: 0,
    night40Hours: 0,
    sundayHours: 0,
    holidayHours: 0,
    holiday150Hours: 0,
    zuschlagCents: 0,
  });
  const addBuckets = (a: SfnGeldErgebnis, b: SfnGeldErgebnis): SfnGeldErgebnis => ({
    night25Hours: Math.round((a.night25Hours + b.night25Hours) * 100) / 100,
    night40Hours: Math.round((a.night40Hours + b.night40Hours) * 100) / 100,
    sundayHours: Math.round((a.sundayHours + b.sundayHours) * 100) / 100,
    holidayHours: Math.round((a.holidayHours + b.holidayHours) * 100) / 100,
    holiday150Hours: Math.round((a.holiday150Hours + b.holiday150Hours) * 100) / 100,
    zuschlagCents: a.zuschlagCents + b.zuschlagCents,
  });

  const deptSlices: SfnDeptSlice[] = [];
  let simpleAgg = emptyBuckets();
  let extendedAgg = emptyBuckets();
  // Deterministische Reihenfolge: WZ1-Priorität, dann alphabetisch.
  const deptOrder: Department[] = ["gl", "kitchen", "service"];
  const orderedDepts = deptOrder.filter((d) => groups.has(d));
  for (const dept of orderedDepts) {
    const list = groups.get(dept)!;
    const rateCents = list[0]?.rateCents ?? null;
    // Unpriced-Bereich: A1 — Stunden zählen, Geld ist 0.
    const rateForSfn = rateCents ?? 0;
    const rows = list.map((e) => e.row);
    const s = berechneSfnGeld(rows, "simple", rateForSfn, holidayRates);
    const x = berechneSfnGeld(rows, "extended", rateForSfn, holidayRates);
    const paidH = Math.round(list.reduce((acc, e) => acc + e.paidHrs, 0) * 100) / 100;
    deptSlices.push({
      department: dept,
      rateCents,
      paidHours: paidH,
      entryCount: list.length,
      simple: s,
      extended: x,
    });
    simpleAgg = addBuckets(simpleAgg, s);
    extendedAgg = addBuckets(extendedAgg, x);
  }

  const totalHours = Math.round(enriched.reduce((s, e) => s + e.paidHrs, 0) * 100) / 100;
  const workdayCount = countDistinctWorkdays(enriched.map((e) => e.row.shiftDate));

  // LG3b A2 — Legacy-Skalar: Bereichssatz nur bei genau EINEM benutzten
  // Bereich (bit-identisch zum Alt-Wert). Bei Mehrsatz `null` — der falsche
  // Primär-Satz wäre für den Rest der Stunden schlicht die falsche Angabe;
  // die Bereichszeilen (deptSlices) tragen ab 2b die Wahrheit.
  // Leere Periode: Bereichs-Fallback über staff_locations, damit Detail-
  // Ansicht/Exporte einen sinnvollen Anzeigewert bekommen.
  let hourlyRateCents: number | null;
  if (orderedDepts.length === 1) {
    hourlyRateCents = resolveRateCents(rates, orderedDepts[0], toDate);
  } else if (orderedDepts.length === 0) {
    const fallbackDept = primaryDepartment(staffDepts);
    hourlyRateCents = resolveRateCents(rates, fallbackDept, toDate) ?? 0;
  } else {
    hourlyRateCents = null;
  }

  const unresolvedHoursUnrounded = enriched
    .filter((e) => e.unresolved)
    .reduce((s, e) => s + e.paidHrs, 0);

  return {
    hourlyRateCents,
    totalHours,
    entryCount: enriched.length,
    workdayCount,
    simple: simpleAgg,
    extended: extendedAgg,
    deptSlices,
    entryAttribution: enriched.map((e) => ({
      businessDate: e.businessDate,
      department: e.dept,
      rateCents: e.rateCents,
      paidHours: e.paidHrs,
      unresolved: e.unresolved,
    })),
    unresolvedHoursUnrounded,
  };
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
