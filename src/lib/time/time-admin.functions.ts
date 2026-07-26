// B2b — Manager-Korrektur-Server-Functions für time_entries + Admin-Wasserlinie.
//
// Architektur:
//   * Alle Schreibvorgänge laufen via supabaseAdmin (RLS auf time_entries ist DENY-ALL).
//   * runGuarded prüft Rolle VOR der Operation; audit_log NUR bei Erfolg.
//   * G2-Sperrlogik via assertBusinessDateUnlocked: business_date ≤ Wasserlinie
//     blockiert ALLE Rollen (auch Manager) → KEIN audit_log-Eintrag (Gate d).
//   * source bleibt erhalten, wenn vorher 'clock' (kein stilles Umflaggen).
//   * manual_delete schreibt vollständigen Zeilen-Snapshot in audit_log.meta
//     (Gate e — Rekonstruierbarkeit aus append-only log).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runWithPermission } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";
import { businessDateOf } from "@/lib/business-date";
import { assertBusinessDateUnlocked } from "./time-lock";
import { isInCurrentBillingCycle } from "./billing-cycle";
import { todayIso } from "@/lib/format";
import { timeEntryToSfnRow } from "@/lib/lohn/time-entry-sfn";
import { formatAbsenceNote } from "./absence-note";
import { isAbsenceWorkday } from "./urlaub-count";
import type { SfnShiftRow } from "@/lib/lohn/sfn-geld/types";
import { computeStaffSfn } from "@/lib/lohn/compute-staff-sfn";
import { primaryDepartment, type Department } from "./primary-department";
import { selectAllPaged } from "@/lib/supabase/select-all";

// N12: Wochenstart auf Montag derselben ISO-Woche normalisieren.
// Übergibt ein Client einen Mittwoch, kommt die Woche Mo–So zurück — statt
// einen kryptischen 400-Fehler zu werfen.
function normalizeIsoWeek(isoDate: string): { weekStart: string; weekEnd: string } {
  const anchor = new Date(`${isoDate}T12:00:00Z`);
  // getUTCDay: 0=So..6=Sa. Montag-Offset = (dow+6)%7 (Mo=0..So=6).
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}
export const _normalizeIsoWeekForTest = normalizeIsoWeek;

// N1 (Nachprüfung 13.07.): Zentrale, paginierte time_entries-Loader für die
// Batch-Server-Functions. PostgREST kappt Selects still bei 1000 Zeilen —
// ohne Pagination würde ein Monat über mehrere Standorte in Lohn/SFN stumm
// unvollständig laufen. Exportiert (unterstrich-Prefix), damit die Tests
// die Trunkierungs-Regression ohne Middleware-Plumbing absichern können.

type PagedAdmin = {
  from: (t: "time_entries" | "roster_shifts") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (cols: string) => any;
  };
};

export type TimeEntryOverviewRow = {
  location_id: string;
  staff_id: string;
  business_date: string;
  started_at: string;
  ended_at: string;
  source: string;
  department: Department | null;
  staff: { display_name: string } | null;
  id: string;
};

export async function _loadTimeEntriesForOverviewBatch(
  supabaseAdmin: PagedAdmin,
  organizationId: string,
  locationIds: readonly string[],
  fromDate: string,
  toDate: string,
): Promise<TimeEntryOverviewRow[]> {
  return selectAllPaged<TimeEntryOverviewRow>(() =>
    supabaseAdmin
      .from("time_entries")
      .select(
        "id, location_id, staff_id, business_date, started_at, ended_at, source, department, staff(display_name)",
      )
      .eq("organization_id", organizationId)
      .in("location_id", locationIds)
      .gte("business_date", fromDate)
      .lte("business_date", toDate)
      .not("ended_at", "is", null)
      .order("id", { ascending: true }),
  );
}

export type TimeEntrySfnRow = {
  location_id: string;
  staff_id: string;
  business_date: string;
  started_at: string;
  ended_at: string;
  break_minutes: number | null;
  id: string;
};

export async function _loadTimeEntriesForSfnBatch(
  supabaseAdmin: PagedAdmin,
  organizationId: string,
  locationIds: readonly string[],
  fromDate: string,
  toDate: string,
): Promise<TimeEntrySfnRow[]> {
  return selectAllPaged<TimeEntrySfnRow>(() =>
    supabaseAdmin
      .from("time_entries")
      .select("id, location_id, staff_id, business_date, started_at, ended_at, break_minutes")
      .eq("organization_id", organizationId)
      .in("location_id", locationIds)
      .gte("business_date", fromDate)
      .lte("business_date", toDate)
      .not("ended_at", "is", null)
      .order("id", { ascending: true }),
  );
}

export type TimeEntryWeeklyRow = {
  id: string;
  location_id: string;
  staff_id: string;
  started_at: string;
  ended_at: string;
  business_date: string;
  department: Department | null;
  staff: { display_name: string } | null;
};

export async function _loadTimeEntriesForWeeklyBatch(
  supabaseAdmin: PagedAdmin,
  organizationId: string,
  locationIds: readonly string[],
  weekStart: string,
  weekEnd: string,
): Promise<TimeEntryWeeklyRow[]> {
  return selectAllPaged<TimeEntryWeeklyRow>(() =>
    supabaseAdmin
      .from("time_entries")
      .select(
        "id, location_id, staff_id, started_at, ended_at, business_date, department, staff(display_name)",
      )
      .eq("organization_id", organizationId)
      .in("location_id", locationIds)
      .gte("business_date", weekStart)
      .lte("business_date", weekEnd)
      .not("ended_at", "is", null)
      .order("id", { ascending: true }),
  );
}

type WeeklyRosterRow = {
  location_id: string;
  staff_id: string;
  area: Department | null;
  skill_id: string | null;
  shift_date: string;
};

export async function _loadRosterShiftsForWeeklyBatch(
  supabaseAdmin: PagedAdmin,
  organizationId: string,
  locationIds: readonly string[],
  weekStart: string,
  weekEnd: string,
): Promise<WeeklyRosterRow[]> {
  return selectAllPaged<WeeklyRosterRow>(() =>
    supabaseAdmin
      .from("roster_shifts")
      .select("location_id, staff_id, area, skill_id, shift_date")
      .eq("organization_id", organizationId)
      .in("location_id", locationIds)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd)
      // Deterministische Paginierung: shift_date + staff_id als Tiebreaker.
      .order("shift_date", { ascending: true })
      .order("staff_id", { ascending: true }),
  );
}

// Batch-Zod-Schema: nicht-leerer, deduplizierter Array von Location-UUIDs.
// Begrenzt die IN-Liste auf 50, damit ein Client-Bug nicht die ganze
// Organisation in einen Query zwingt (bisher gab es max. 3 Standorte;
// 50 lässt Luft nach oben, ohne die Query zu sprengen).
const locationIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(50)
  .transform((arr) => Array.from(new Set(arr)));

// Reduziert staff_locations-Zeilen (eine pro Zuordnung) auf eine deterministische
// Primär-Abteilung je staff_id (WZ1/KGL: Priorität gl > kitchen > service).
// Wird von getTimeOverview UND getWeeklyTimeEntries genutzt — keine
// Last-write-wins-Falle.
function buildPrimaryDeptMap(
  rows: ReadonlyArray<{ staff_id: string; department: string }>,
): Map<string, Department> {
  const byStaff = new Map<string, Department[]>();
  for (const r of rows) {
    const dept = r.department as Department;
    const arr = byStaff.get(r.staff_id) ?? [];
    arr.push(dept);
    byStaff.set(r.staff_id, arr);
  }
  const out = new Map<string, Department>();
  for (const [staffId, depts] of byStaff) {
    out.set(staffId, primaryDepartment(depts));
  }
  return out;
}

// Z3 — Alle Abteilungs-Zuordnungen je Mitarbeiter (für die
// Zeilen-Attribution im Wochenplan-Grid).
function buildStaffDeptsMap(
  rows: ReadonlyArray<{ staff_id: string; department: string }>,
): Map<string, Department[]> {
  const byStaff = new Map<string, Department[]>();
  for (const r of rows) {
    const dept = r.department as Department;
    const arr = byStaff.get(r.staff_id) ?? [];
    if (!arr.includes(dept)) arr.push(dept);
    byStaff.set(r.staff_id, arr);
  }
  return byStaff;
}

// Z3 — Prüft, ob eine Abteilung der Person am Standort zugeordnet ist.
// Wird server-seitig VOR Insert/Update aufgerufen (Client nicht vertrauen).
async function assertStaffDeptAssignment(
  supabaseAdmin: {
    from: (t: "staff_locations") => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (s: string) => any;
    };
  },
  organizationId: string,
  staffId: string,
  locationId: string,
  department: Department,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("staff_locations")
    .select("staff_id")
    .eq("organization_id", organizationId)
    .eq("staff_id", staffId)
    .eq("location_id", locationId)
    .eq("department", department)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`Abteilung „${department}" ist der Person am Standort nicht zugeordnet.`);
  }
}

// =========================================================================
// B6 — Arbeitszeitübersicht (Zusammenfassung + Buchhaltung)
// =========================================================================

export const getTimeOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        // WZ1: locationId nullable — null = alle Standorte org-weit
        // (inkl. Einträge mit location_id IS NULL).
        locationId: z.string().uuid().nullable(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // WZ1: bei locationId=null kein .eq()-Filter → org-weit inkl.
    // location_id IS NULL (Bestandsdaten ohne Standort-Zuordnung).
    let entriesQuery = supabaseAdmin
      .from("time_entries")
      .select(
        "staff_id, business_date, started_at, ended_at, source, department, staff(display_name)",
      )
      .eq("organization_id", caller.organizationId)
      .gte("business_date", data.fromDate)
      .lte("business_date", data.toDate)
      .not("ended_at", "is", null)
      .order("business_date", { ascending: true });
    if (data.locationId != null) {
      entriesQuery = entriesQuery.eq("location_id", data.locationId);
    }
    const { data: rows, error } = await entriesQuery;
    if (error) throw error;

    let deptQuery = supabaseAdmin
      .from("staff_locations")
      .select("staff_id, department")
      .eq("organization_id", caller.organizationId);
    if (data.locationId != null) {
      deptQuery = deptQuery.eq("location_id", data.locationId);
    }
    const { data: deptRows, error: deptErr } = await deptQuery;
    if (deptErr) throw deptErr;
    // WZ1: bei "Alle Standorte" reduziert buildPrimaryDeptMap je Mitarbeiter
    // über ALLE Standort-Zuordnungen (gl > kitchen > service).
    const deptByStaff = buildPrimaryDeptMap(deptRows ?? []);
    // LG2 — Alle Abteilungs-Zuordnungen je Mitarbeiter (für entryRowDepartment
    // in der Payroll-Aggregation nach Schichtart).
    const staffDeptsByStaff = buildStaffDeptsMap(deptRows ?? []);

    // LG2 — Dienstplan-Realität der Periode je Mitarbeiter (roster_shifts):
    // rosterAreaByStaffDate + rosterGlByStaffDate identisch zur Wochen-Variante,
    // damit die Payroll-Aggregation die Schicht-Typ-Attribution (Tages-Skill)
    // konsistent zum Wochenplan-Grid berechnen kann.
    let rosterQuery = supabaseAdmin
      .from("roster_shifts")
      .select("staff_id, area, skill_id, shift_date")
      .eq("organization_id", caller.organizationId)
      .gte("shift_date", data.fromDate)
      .lte("shift_date", data.toDate);
    if (data.locationId != null) {
      rosterQuery = rosterQuery.eq("location_id", data.locationId);
    }
    const { data: rosterRows, error: rosterErr } = await rosterQuery;
    if (rosterErr) throw rosterErr;

    const glSkillIds = new Set<string>();
    {
      const { data: glSkillRows, error: glSkillErr } = await supabaseAdmin
        .from("skills")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("category", "gl");
      if (glSkillErr) throw glSkillErr;
      for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);
    }

    const rosterAreaByStaffDate: Record<string, Record<string, Department>> = {};
    const rosterGlByStaffDate: Record<string, Record<string, boolean>> = {};
    for (const r of rosterRows ?? []) {
      const sid = r.staff_id as string;
      const area = r.area as Department | null;
      const skillId = r.skill_id as string | null;
      const iso = r.shift_date as string;
      if (area) {
        const perStaff = rosterAreaByStaffDate[sid] ?? {};
        const existing = perStaff[iso];
        perStaff[iso] = existing ? primaryDepartment([existing, area]) : area;
        rosterAreaByStaffDate[sid] = perStaff;
      }
      if (skillId && glSkillIds.has(skillId)) {
        const perStaff = rosterGlByStaffDate[sid] ?? {};
        perStaff[iso] = true;
        rosterGlByStaffDate[sid] = perStaff;
      }
    }

    // LG2 — assignedStaff mit staffDepts (für Client-Attribution). Bei "Alle
    // Standorte" ohne Filter, sonst nur der gewählte Standort.
    const assignedStaff = Array.from(staffDeptsByStaff.entries()).map(([staffId, depts]) => ({
      staffId,
      staffDepts: depts,
    }));

    const entries = (rows ?? []).map((r) => {
      const started = new Date(r.started_at).getTime();
      const ended = new Date(r.ended_at as string).getTime();
      const hoursWorked = Math.max(0, (ended - started) / 3_600_000);
      const raw = (r.department as Department | null) ?? null;
      const primary = deptByStaff.get(r.staff_id) ?? ("service" as const);
      return {
        staffId: r.staff_id,
        displayName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
        // WZ1/KGL: rawDepartment (Z3) hat Vorrang, primary nur Fallback
        // für Einträge ohne gesetztes Department (Stempel/Bestandsdaten).
        department: raw ?? primary,
        rawDepartment: raw,
        businessDate: r.business_date as string,
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
        hoursWorked,
        source: r.source as string,
      };
    });

    // WZ1: Lücken-Counts nur bei konkreter Standort-Sicht (bei
    // "Alle Standorte" sind sie per Definition bereits enthalten).
    let gaps = { unlocatedShifts: 0, openShifts: 0 };
    if (data.locationId != null) {
      const [{ count: unlocatedShifts }, { count: openShifts }] = await Promise.all([
        supabaseAdmin
          .from("time_entries")
          .select("id", { head: true, count: "exact" })
          .eq("organization_id", caller.organizationId)
          .is("location_id", null)
          .gte("business_date", data.fromDate)
          .lte("business_date", data.toDate),
        supabaseAdmin
          .from("time_entries")
          .select("id", { head: true, count: "exact" })
          .eq("organization_id", caller.organizationId)
          .eq("location_id", data.locationId)
          .gte("business_date", data.fromDate)
          .lte("business_date", data.toDate)
          .is("ended_at", null),
      ]);
      gaps = {
        unlocatedShifts: unlocatedShifts ?? 0,
        openShifts: openShifts ?? 0,
      };
    }
    return {
      entries,
      gaps,
      assignedStaff,
      rosterAreaByStaffDate,
      rosterGlByStaffDate,
    };
  });

// SFN-Zuschlagsberechnung pro Mitarbeiter für Standort × Zeitraum.
// Reines Read-Only — verwendet `timeEntryToSfnRow` + `berechneSfnGeld` (simple-Modus,
// wie tagesabrechnung-Original). hourlyRateCents = jüngste staff_compensation
// mit valid_from ≤ toDate.
export const getSfnOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        // WZ1: locationId nullable — null = org-weit inkl. location_id IS NULL.
        locationId: z.string().uuid().nullable(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let sfnQuery = supabaseAdmin
      .from("time_entries")
      .select("staff_id, business_date, started_at, ended_at, break_minutes")
      .eq("organization_id", caller.organizationId)
      .gte("business_date", data.fromDate)
      .lte("business_date", data.toDate)
      .not("ended_at", "is", null);
    if (data.locationId != null) {
      sfnQuery = sfnQuery.eq("location_id", data.locationId);
    }
    const { data: rows, error } = await sfnQuery;
    if (error) throw error;

    const { data: comps, error: compErr } = await supabaseAdmin
      .from("staff_compensation")
      .select("staff_id, hourly_rate, valid_from")
      .eq("organization_id", caller.organizationId)
      .lte("valid_from", data.toDate)
      .order("valid_from", { ascending: false });
    if (compErr) throw compErr;
    const rateByStaff = new Map<string, number>();
    for (const c of comps ?? []) {
      if (!rateByStaff.has(c.staff_id)) {
        rateByStaff.set(c.staff_id, Math.round(Number(c.hourly_rate ?? 0) * 100));
      }
    }

    const rowsByStaff = new Map<string, SfnShiftRow[]>();
    for (const r of rows ?? []) {
      const sfnRow = timeEntryToSfnRow({
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
        businessDate: r.business_date as string,
        breakMinutes: Number(r.break_minutes ?? 0),
      });
      const arr = rowsByStaff.get(r.staff_id) ?? [];
      arr.push(sfnRow);
      rowsByStaff.set(r.staff_id, arr);
    }

    const sfn = Array.from(rowsByStaff.entries()).map(([staffId, sfnRows]) => {
      const rate = rateByStaff.get(staffId) ?? 0;
      const { simple, extended, zuschlagCents } = computeStaffSfn(sfnRows, rate);
      return {
        staffId,
        hourlyRateCents: rate,
        zuschlagCents,
        simple: {
          night25Hours: simple.night25Hours,
          night40Hours: simple.night40Hours,
          sundayHours: simple.sundayHours,
        },
        extended: {
          night25Hours: extended.night25Hours,
          night40Hours: extended.night40Hours,
          sundayHours: extended.sundayHours,
          holidayHours: extended.holidayHours,
          holiday150Hours: extended.holiday150Hours,
        },
      };
    });
    return { sfn };
  });

export const listPayrollNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("payroll_notes")
      .select("staff_id, vorschuss, besonderheiten")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .eq("period_start", data.periodStart)
      .eq("period_end", data.periodEnd);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      staffId: r.staff_id,
      vorschuss: Number(r.vorschuss ?? 0),
      besonderheiten: r.besonderheiten ?? "",
    }));
  });

// Vorschuss-Summen pro Mitarbeiter aus Tagesabrechnung (session_advances)
// für einen Standort × Zeitraum (business_date inkl.).
export const listAdvancesByStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("session_advances")
      .select("staff_id, amount_cents, sessions!inner(business_date)")
      .eq("organization_id", caller.organizationId)
      .gte("sessions.business_date", data.periodStart)
      .lte("sessions.business_date", data.periodEnd);
    if (error) throw error;
    const sums = new Map<string, number>();
    for (const r of rows ?? []) {
      sums.set(r.staff_id, (sums.get(r.staff_id) ?? 0) + Number(r.amount_cents ?? 0));
    }
    return Array.from(sums.entries()).map(([staffId, totalCents]) => ({ staffId, totalCents }));
  });

// Urlaubs- und Kranktage pro Mitarbeiter aus Dienstplan (roster_absence)
// für einen Zeitraum (inkl.).
export const listAbsencesByStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_absence")
      .select("staff_id, date, type")
      .eq("organization_id", caller.organizationId)
      .gte("date", data.periodStart)
      .lte("date", data.periodEnd);
    if (error) throw error;
    type Entry = {
      krankDays: number;
      urlaubDays: number;
      items: Array<{ date: string; type: "urlaub" | "krank" }>;
    };
    const map = new Map<string, Entry>();
    for (const r of rows ?? []) {
      const entry = map.get(r.staff_id) ?? { krankDays: 0, urlaubDays: 0, items: [] };
      if (r.type === "krank") {
        // UZ1 v2: Krank-Zählung folgt dem 5-Tage-Modell (nur Mo–Fr).
        // roster_absence-Daten bleiben unverändert; die Note (items)
        // zeigt weiterhin ALLE Kalendertage — nur die Zählung filtert.
        if (isAbsenceWorkday(r.date)) {
          entry.krankDays += 1;
        }
        entry.items.push({ date: r.date, type: "krank" });
      } else if (r.type === "urlaub") {
        // UZ1: Urlaubs-Zählung folgt dem 5-Tage-Modell (nur Mo–Fr).
        if (isAbsenceWorkday(r.date)) {
          entry.urlaubDays += 1;
        }
        entry.items.push({ date: r.date, type: "urlaub" });
      }
      map.set(r.staff_id, entry);
    }
    return Array.from(map.entries()).map(([staffId, v]) => ({
      staffId,
      krankDays: v.krankDays,
      urlaubDays: v.urlaubDays,
      absenceNote: formatAbsenceNote(v.items, data.periodStart, data.periodEnd),
    }));
  });

export const upsertPayrollNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        staffId: z.string().uuid(),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        vorschuss: z.number().min(0).max(100000),
        besonderheiten: z.string().max(2000).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return runWithPermission(
      context.supabase,
      "time.payroll_note.edit",
      data.locationId,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("payroll_notes").upsert(
          {
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            location_id: data.locationId,
            period_start: data.periodStart,
            period_end: data.periodEnd,
            vorschuss: data.vorschuss,
            besonderheiten: data.besonderheiten,
          },
          { onConflict: "staff_id,location_id,period_start,period_end" },
        );
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "payroll_note.upsert",
            entity: "payroll_note",
            meta: {
              staffId: data.staffId,
              locationId: data.locationId,
              periodStart: data.periodStart,
              periodEnd: data.periodEnd,
              vorschuss: data.vorschuss,
              besonderheiten: data.besonderheiten,
            },
          },
        };
      },
    );
  });

// =========================================================================
// Payroll Recurring Notes — Raten- und Dauer-Notizen (§105-Nachzug 19.07.)
// =========================================================================

export const listRecurringNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("payroll_recurring_notes")
      .select(
        "id, staff_id, location_id, kind, text, first_period_start, periods_total, canceled_at",
      )
      .eq("organization_id", caller.organizationId);
    if (data.locationId) {
      q = q.or(`location_id.is.null,location_id.eq.${data.locationId}`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      staffId: r.staff_id as string,
      locationId: (r.location_id as string | null) ?? null,
      kind: r.kind as "rate" | "dauer",
      text: r.text as string,
      firstPeriodStart: r.first_period_start as string,
      periodsTotal: (r.periods_total as number | null) ?? null,
      canceledAt: (r.canceled_at as string | null) ?? null,
    }));
  });

export const createRecurringNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        locationId: z.string().uuid().nullable(),
        kind: z.enum(["rate", "dauer"]),
        text: z.string().min(1).max(500),
        firstPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodsTotal: z.number().int().min(1).max(120).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    if (data.kind === "rate" && data.periodsTotal == null) {
      throw new Error("periodsTotal ist bei kind='rate' Pflicht.");
    }
    return runWithPermission(
      context.supabase,
      "time.payroll_note.edit",
      data.locationId,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("payroll_recurring_notes")
          .insert({
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            location_id: data.locationId,
            kind: data.kind,
            text: data.text,
            first_period_start: data.firstPeriodStart,
            periods_total: data.kind === "rate" ? data.periodsTotal : null,
            created_by_staff_id: caller.staffId,
          })
          .select("id")
          .single();
        if (error) throw error;
        return {
          result: { id: row.id as string },
          audit: {
            action: "payroll_recurring_note.create",
            entity: "payroll_recurring_note",
            entityId: row.id as string,
            meta: {
              staffId: data.staffId,
              locationId: data.locationId,
              kind: data.kind,
              periodsTotal: data.periodsTotal,
              firstPeriodStart: data.firstPeriodStart,
            },
          },
        };
      },
    );
  });

export const cancelRecurringNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("payroll_recurring_notes")
      .select("id, organization_id, location_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing || existing.organization_id !== caller.organizationId) {
      throw new Error("Notiz nicht gefunden.");
    }
    return runWithPermission(
      context.supabase,
      "time.payroll_note.edit",
      (existing.location_id as string | null) ?? null,
      makeAuditWriter(caller),
      async () => {
        const { error } = await supabaseAdmin
          .from("payroll_recurring_notes")
          .update({ canceled_at: new Date().toISOString() })
          .eq("id", data.id)
          .is("canceled_at", null);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "payroll_recurring_note.cancel",
            entity: "payroll_recurring_note",
            entityId: data.id,
          },
        };
      },
    );
  });

// =========================================================================
// B6b — Wochenplan (Wochen-Ansicht für genau eine ISO-Woche)
// =========================================================================

export const getWeeklyTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // N12 (Nachprüfung 13.07.): Übergebenes Startdatum auf den Montag
    // derselben Woche normalisieren — statt einen Nicht-Montag stumm
    // abzulehnen. Danach weekEnd = normalisierter Montag + 6 Tage.
    const { weekStart, weekEnd } = normalizeIsoWeek(data.weekStart);

    // 1. Einträge am Zielstandort.
    const { data: rows, error } = await supabaseAdmin
      .from("time_entries")
      .select(
        "id, staff_id, started_at, ended_at, business_date, location_id, department, staff(display_name)",
      )
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .gte("business_date", weekStart)
      .lte("business_date", weekEnd)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: true });
    if (error) throw error;

    // 2. Einträge an ANDEREN Standorten in derselben Woche (gesamte Org).
    const { data: crossRows, error: crossErr } = await supabaseAdmin
      .from("time_entries")
      .select("staff_id, business_date, location_id")
      .eq("organization_id", caller.organizationId)
      .neq("location_id", data.locationId)
      .gte("business_date", weekStart)
      .lte("business_date", weekEnd)
      .not("ended_at", "is", null);
    if (crossErr) throw crossErr;

    // 3. Abteilungen für diesen Standort.
    const { data: deptRows, error: deptErr } = await supabaseAdmin
      .from("staff_locations")
      .select("staff_id, department, staff(display_name, is_active)")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId);
    if (deptErr) throw deptErr;
    // Primär-Abteilung je Mitarbeiter (Priorität gl > kitchen > service) —
    // entries.department wird darauf gemappt, damit alle Stunden einer
    // Person deterministisch auf EINER Zeile auflaufen (time_entries hat
    // keine Abteilungs-Dimension).
    const deptByStaff = buildPrimaryDeptMap(deptRows ?? []);
    const staffDeptsByStaff = buildStaffDeptsMap(deptRows ?? []);

    // Z4 — Skill-IDs pro Mitarbeiter (Stammdaten). Wird für den Wochenplan-
    // Filter NICHT mehr verwendet (Z4b: dienstplan-basiert, siehe unten),
    // bleibt aber im Response-Shape, weil `assignedStaff.skillIds` als
    // stabile Kennzeichnung an anderen Stellen (Grid-Anzeige, spätere
    // Konsumenten) zugesichert ist.
    const staffIds = Array.from(new Set((deptRows ?? []).map((d) => d.staff_id as string)));
    const skillsByStaff = new Map<string, string[]>();
    if (staffIds.length > 0) {
      const { data: skillRows, error: skillErr } = await supabaseAdmin
        .from("staff_skills")
        .select("staff_id, skill_id")
        .eq("organization_id", caller.organizationId)
        .in("staff_id", staffIds);
      if (skillErr) throw skillErr;
      for (const r of skillRows ?? []) {
        const sid = r.staff_id as string;
        const arr = skillsByStaff.get(sid) ?? [];
        arr.push(r.skill_id as string);
        skillsByStaff.set(sid, arr);
      }
    }

    // Z4b — Dienstplan-Realität der Woche je Mitarbeiter (aus roster_shifts):
    // Wochenplan-Filter matcht Bereich/Skill gegen tatsächlich geplante
    // Schichten am gewählten Standort in [weekStart..weekEnd]. Schichten mit
    // skill_id=null zählen für den Bereichs-Filter (area), nicht für Skill.
    const rosterByStaff: Record<string, { areas: Department[]; skillIds: string[] }> = {};
    const { data: rosterRows, error: rosterErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("staff_id, area, skill_id, shift_date")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd);
    if (rosterErr) throw rosterErr;
    // WZ2 — GL-Skill-IDs der Organisation (D-3: GL ist ein Skill der
    // Kategorie 'gl', kein Roster-Bereich). Ein Query, danach im Speicher
    // gejoint. Verwendet für rosterGlByStaffDate — die Tages-Typ-Quelle.
    const glSkillIds = new Set<string>();
    {
      const { data: glSkillRows, error: glSkillErr } = await supabaseAdmin
        .from("skills")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("category", "gl");
      if (glSkillErr) throw glSkillErr;
      for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);
    }
    // Z3b — Per-Tag-Roster-Area je Mitarbeiter: erlaubt der Client-
    // Attribution, NULL-Einträge auf die tatsächlich geplante Area des
    // Tages zu legen (statt hart kitchen>service>gl). Bei mehreren Areas
    // am selben Tag gewinnt die per primaryDepartment-Priorität — das
    // ist der historische Default und bleibt für Randfälle stabil.
    const rosterAreaByStaffDate: Record<string, Record<string, Department>> = {};
    // WZ2 — Per-Tag-GL-Skill-Flag (any-of über mehrere Schichten desselben Tages).
    const rosterGlByStaffDate: Record<string, Record<string, boolean>> = {};
    for (const r of rosterRows ?? []) {
      const sid = r.staff_id as string;
      const area = r.area as Department | null;
      const skillId = r.skill_id as string | null;
      const iso = r.shift_date as string;
      const bucket = rosterByStaff[sid] ?? { areas: [], skillIds: [] };
      if (area && !bucket.areas.includes(area)) bucket.areas.push(area);
      if (skillId && !bucket.skillIds.includes(skillId)) bucket.skillIds.push(skillId);
      rosterByStaff[sid] = bucket;
      if (area) {
        const perStaff = rosterAreaByStaffDate[sid] ?? {};
        const existing = perStaff[iso];
        // primaryDepartment liefert gl>kitchen>service — hier für den seltenen
        // Fall zweier Schichten desselben Mitarbeiters am selben Tag mit
        // unterschiedlichen Areas.
        perStaff[iso] = existing ? primaryDepartment([existing, area]) : area;
        rosterAreaByStaffDate[sid] = perStaff;
      }
      if (skillId && glSkillIds.has(skillId)) {
        const perStaff = rosterGlByStaffDate[sid] ?? {};
        perStaff[iso] = true;
        rosterGlByStaffDate[sid] = perStaff;
      }
    }

    // Z2: Alle dem Standort zugeordneten (aktiven) Mitarbeiter — EINE Zeile
    // pro Zuordnung, damit Mehrfach-Zuordnungen (z. B. kitchen + gl) im
    // Wochenplan-Grid in JEDER Sektion erscheinen. isPrimary markiert die
    // Zeile, auf der die tatsächlichen Stunden aufsummiert werden.
    const assignedStaff = (deptRows ?? [])
      .map((d) => {
        const s = d.staff as { display_name: string; is_active: boolean } | null;
        const dept = d.department as Department;
        const staffId = d.staff_id as string;
        return {
          staffId,
          displayName: s?.display_name ?? "—",
          department: dept,
          isActive: s?.is_active ?? true,
          isPrimary: deptByStaff.get(staffId) === dept,
          // Z3: alle Abteilungen der Person am Standort — Client attribuiert
          // damit Einträge über entryRowDepartment auf die richtige Zeile.
          staffDepts: staffDeptsByStaff.get(staffId) ?? [],
          // Z4: Skill-IDs der Person (für den Wochenplan-Skill-Filter).
          skillIds: skillsByStaff.get(staffId) ?? [],
        };
      })
      .filter((s) => s.isActive);

    const crossLocationDates: Record<string, string[]> = {};
    for (const c of crossRows ?? []) {
      const key = c.staff_id as string;
      const date = c.business_date as string;
      const arr = crossLocationDates[key] ?? [];
      if (!arr.includes(date)) arr.push(date);
      crossLocationDates[key] = arr;
    }

    return {
      weekStart,
      weekEnd,
      entries: (rows ?? []).map((r) => ({
        id: r.id as string,
        staffId: r.staff_id as string,
        displayName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
        // Z3: Primär-Abteilung als Fallback für Grid-Kompatibilität; das Grid
        // nutzt entryRowDepartment(rawDepartment, staffDepts) für die
        // eigentliche Zeilen-Attribution.
        department: deptByStaff.get(r.staff_id as string) ?? ("service" as const),
        rawDepartment: (r.department as Department | null) ?? null,
        businessDate: r.business_date as string,
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
      })),
      crossLocationDates,
      assignedStaff,
      rosterByStaff,
      rosterAreaByStaffDate,
      rosterGlByStaffDate,
    };
  });

// =========================================================================
// Batch-Varianten: nehmen locationIds[] und liefern Record<locationId, Shape>.
// Ersetzen im "Alle Standorte"-Modus N useQueries-Fanouts durch 1 Request pro
// Query-Familie. Die Single-Location-Varianten bleiben unverändert, damit die
// bestehenden queryKeys ["…", locationId, …] und Invalidierungen funktionieren.
// =========================================================================

export const getTimeOverviewBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationIds: locationIdsSchema,
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // N1: paginierter Loader statt PostgREST-Default (1000-Zeilen-Kappung).
    const rows = await _loadTimeEntriesForOverviewBatch(
      supabaseAdmin,
      caller.organizationId,
      data.locationIds,
      data.fromDate,
      data.toDate,
    );

    const { data: deptRows, error: deptErr } = await supabaseAdmin
      .from("staff_locations")
      .select("location_id, staff_id, department")
      .eq("organization_id", caller.organizationId)
      .in("location_id", data.locationIds);
    if (deptErr) throw deptErr;

    // Pro Standort die Primary-Dept-Map bauen (Priorität gl>kitchen>service).
    const deptByLoc = new Map<string, Map<string, Department>>();
    const staffDeptsByLoc = new Map<string, Map<string, Department[]>>();
    const rowsByLoc = new Map<string, Array<{ staff_id: string; department: string }>>();
    for (const r of deptRows ?? []) {
      const lid = r.location_id as string;
      const arr = rowsByLoc.get(lid) ?? [];
      arr.push({ staff_id: r.staff_id as string, department: r.department as string });
      rowsByLoc.set(lid, arr);
    }
    for (const [lid, arr] of rowsByLoc) {
      deptByLoc.set(lid, buildPrimaryDeptMap(arr));
      staffDeptsByLoc.set(lid, buildStaffDeptsMap(arr));
    }

    // LG2 — Roster + GL-Skills für die ganze Periode über alle Standorte.
    const { data: rosterRows, error: rosterErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("location_id, staff_id, area, skill_id, shift_date")
      .eq("organization_id", caller.organizationId)
      .in("location_id", data.locationIds)
      .gte("shift_date", data.fromDate)
      .lte("shift_date", data.toDate);
    if (rosterErr) throw rosterErr;
    const glSkillIds = new Set<string>();
    {
      const { data: glSkillRows, error: glSkillErr } = await supabaseAdmin
        .from("skills")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("category", "gl");
      if (glSkillErr) throw glSkillErr;
      for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);
    }

    const byLocation: Record<
      string,
      {
        entries: Array<{
          staffId: string;
          displayName: string;
          department: Department;
          rawDepartment: Department | null;
          businessDate: string;
          startedAt: string;
          endedAt: string;
          hoursWorked: number;
          source: string;
        }>;
        assignedStaff: Array<{ staffId: string; staffDepts: Department[] }>;
        rosterAreaByStaffDate: Record<string, Record<string, Department>>;
        rosterGlByStaffDate: Record<string, Record<string, boolean>>;
      }
    > = {};
    for (const lid of data.locationIds) {
      const staffDeptsMap = staffDeptsByLoc.get(lid) ?? new Map<string, Department[]>();
      byLocation[lid] = {
        entries: [],
        assignedStaff: Array.from(staffDeptsMap.entries()).map(([staffId, depts]) => ({
          staffId,
          staffDepts: depts,
        })),
        rosterAreaByStaffDate: {},
        rosterGlByStaffDate: {},
      };
    }
    for (const r of rosterRows ?? []) {
      const lid = r.location_id as string;
      const bucket = byLocation[lid];
      if (!bucket) continue;
      const sid = r.staff_id as string;
      const area = r.area as Department | null;
      const skillId = r.skill_id as string | null;
      const iso = r.shift_date as string;
      if (area) {
        const perStaff = bucket.rosterAreaByStaffDate[sid] ?? {};
        const existing = perStaff[iso];
        perStaff[iso] = existing ? primaryDepartment([existing, area]) : area;
        bucket.rosterAreaByStaffDate[sid] = perStaff;
      }
      if (skillId && glSkillIds.has(skillId)) {
        const perStaff = bucket.rosterGlByStaffDate[sid] ?? {};
        perStaff[iso] = true;
        bucket.rosterGlByStaffDate[sid] = perStaff;
      }
    }

    for (const r of rows) {
      const lid = r.location_id as string;
      const bucket = byLocation[lid];
      if (!bucket) continue;
      const started = new Date(r.started_at as string).getTime();
      const ended = new Date(r.ended_at as string).getTime();
      const hoursWorked = Math.max(0, (ended - started) / 3_600_000);
      const deptMap = deptByLoc.get(lid);
      bucket.entries.push({
        staffId: r.staff_id as string,
        displayName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
        department: deptMap?.get(r.staff_id as string) ?? ("service" as const),
        rawDepartment: (r.department as Department | null) ?? null,
        businessDate: r.business_date as string,
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
        hoursWorked,
        source: r.source as string,
      });
    }
    return { byLocation };
  });

export const getSfnOverviewBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationIds: locationIdsSchema,
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // N1: paginierter Loader (1000-Zeilen-Trunkierung kappt sonst SFN-Summen still).
    const rows = await _loadTimeEntriesForSfnBatch(
      supabaseAdmin,
      caller.organizationId,
      data.locationIds,
      data.fromDate,
      data.toDate,
    );

    const { data: comps, error: compErr } = await supabaseAdmin
      .from("staff_compensation")
      .select("staff_id, hourly_rate, valid_from")
      .eq("organization_id", caller.organizationId)
      .lte("valid_from", data.toDate)
      .order("valid_from", { ascending: false });
    if (compErr) throw compErr;
    const rateByStaff = new Map<string, number>();
    for (const c of comps ?? []) {
      if (!rateByStaff.has(c.staff_id)) {
        rateByStaff.set(c.staff_id, Math.round(Number(c.hourly_rate ?? 0) * 100));
      }
    }

    type SfnEntry = {
      staffId: string;
      hourlyRateCents: number;
      zuschlagCents: number;
      simple: { night25Hours: number; night40Hours: number; sundayHours: number };
      extended: {
        night25Hours: number;
        night40Hours: number;
        sundayHours: number;
        holidayHours: number;
        holiday150Hours: number;
      };
    };

    // Pro Standort → Rows nach staff bucketen und SFN je Mitarbeiter berechnen.
    const rowsByLocStaff = new Map<string, Map<string, SfnShiftRow[]>>();
    for (const lid of data.locationIds) rowsByLocStaff.set(lid, new Map());
    for (const r of rows) {
      const lid = r.location_id as string;
      const bucket = rowsByLocStaff.get(lid);
      if (!bucket) continue;
      const sfnRow = timeEntryToSfnRow({
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
        businessDate: r.business_date as string,
        breakMinutes: Number(r.break_minutes ?? 0),
      });
      const arr = bucket.get(r.staff_id as string) ?? [];
      arr.push(sfnRow);
      bucket.set(r.staff_id as string, arr);
    }

    const byLocation: Record<string, { sfn: SfnEntry[] }> = {};
    for (const lid of data.locationIds) {
      const staffMap = rowsByLocStaff.get(lid) ?? new Map<string, SfnShiftRow[]>();
      const sfn: SfnEntry[] = Array.from(staffMap.entries()).map(([staffId, sfnRows]) => {
        const rate = rateByStaff.get(staffId) ?? 0;
        const { simple, extended, zuschlagCents } = computeStaffSfn(sfnRows, rate);
        return {
          staffId,
          hourlyRateCents: rate,
          zuschlagCents,
          simple: {
            night25Hours: simple.night25Hours,
            night40Hours: simple.night40Hours,
            sundayHours: simple.sundayHours,
          },
          extended: {
            night25Hours: extended.night25Hours,
            night40Hours: extended.night40Hours,
            sundayHours: extended.sundayHours,
            holidayHours: extended.holidayHours,
            holiday150Hours: extended.holiday150Hours,
          },
        };
      });
      byLocation[lid] = { sfn };
    }
    return { byLocation };
  });

export const listPayrollNotesBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationIds: locationIdsSchema,
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("payroll_notes")
      .select("location_id, staff_id, vorschuss, besonderheiten")
      .eq("organization_id", caller.organizationId)
      .in("location_id", data.locationIds)
      .eq("period_start", data.periodStart)
      .eq("period_end", data.periodEnd);
    if (error) throw error;

    const byLocation: Record<
      string,
      Array<{ staffId: string; vorschuss: number; besonderheiten: string }>
    > = {};
    for (const lid of data.locationIds) byLocation[lid] = [];
    for (const r of rows ?? []) {
      const lid = r.location_id as string;
      const bucket = byLocation[lid];
      if (!bucket) continue;
      bucket.push({
        staffId: r.staff_id as string,
        vorschuss: Number(r.vorschuss ?? 0),
        besonderheiten: r.besonderheiten ?? "",
      });
    }
    return { byLocation };
  });

export const getWeeklyTimeEntriesBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationIds: locationIdsSchema,
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // N12: Wochenstart auf Montag normalisieren (Nicht-Montag → derselbe
    // Wochen-Montag), damit clientseitige Off-by-one-Rundungen die
    // Batch-Ansicht nicht verstellen.
    const { weekStart, weekEnd } = normalizeIsoWeek(data.weekStart);

    // N1: paginierte Loader — 1 Woche × mehrere Standorte kann bei größeren
    // Belegschaften die 1000-Zeilen-Grenze streifen.
    const entryRows = await _loadTimeEntriesForWeeklyBatch(
      supabaseAdmin,
      caller.organizationId,
      data.locationIds,
      weekStart,
      weekEnd,
    );

    const { data: deptRows, error: deptErr } = await supabaseAdmin
      .from("staff_locations")
      .select("location_id, staff_id, department, staff(display_name, is_active)")
      .eq("organization_id", caller.organizationId)
      .in("location_id", data.locationIds);
    if (deptErr) throw deptErr;

    // Skills-Stammdaten für alle betroffenen Staff-IDs in einem Query.
    const allStaffIds = Array.from(new Set((deptRows ?? []).map((d) => d.staff_id as string)));
    const skillsByStaff = new Map<string, string[]>();
    if (allStaffIds.length > 0) {
      const { data: skillRows, error: skillErr } = await supabaseAdmin
        .from("staff_skills")
        .select("staff_id, skill_id")
        .eq("organization_id", caller.organizationId)
        .in("staff_id", allStaffIds);
      if (skillErr) throw skillErr;
      for (const r of skillRows ?? []) {
        const sid = r.staff_id as string;
        const arr = skillsByStaff.get(sid) ?? [];
        arr.push(r.skill_id as string);
        skillsByStaff.set(sid, arr);
      }
    }

    // WZ2 — GL-Skill-IDs (skills.category = 'gl') als Menge, ein Query.
    const glSkillIds = new Set<string>();
    {
      const { data: glSkillRows, error: glSkillErr } = await supabaseAdmin
        .from("skills")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("category", "gl");
      if (glSkillErr) throw glSkillErr;
      for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);
    }

    const rosterRows = await _loadRosterShiftsForWeeklyBatch(
      supabaseAdmin,
      caller.organizationId,
      data.locationIds,
      weekStart,
      weekEnd,
    );

    // Rows nach Location bucketen.
    type DeptRow = {
      location_id: string;
      staff_id: string;
      department: string;
      staff: { display_name: string; is_active: boolean } | null;
    };
    const deptByLoc = new Map<string, DeptRow[]>();
    for (const lid of data.locationIds) deptByLoc.set(lid, []);
    for (const r of deptRows ?? []) {
      const arr = deptByLoc.get(r.location_id as string);
      if (arr) arr.push(r as unknown as DeptRow);
    }

    type RosterRow = {
      location_id: string;
      staff_id: string;
      area: Department | null;
      skill_id: string | null;
      shift_date: string;
    };
    const rosterByLoc = new Map<string, RosterRow[]>();
    for (const lid of data.locationIds) rosterByLoc.set(lid, []);
    for (const r of rosterRows ?? []) {
      const arr = rosterByLoc.get(r.location_id as string);
      if (arr) arr.push(r as unknown as RosterRow);
    }

    type EntryRow = (typeof entryRows extends (infer U)[] | null ? U : never) & {
      location_id: string;
    };
    const entriesByLoc = new Map<string, EntryRow[]>();
    for (const lid of data.locationIds) entriesByLoc.set(lid, []);
    for (const r of entryRows ?? []) {
      const arr = entriesByLoc.get(r.location_id as string);
      if (arr) arr.push(r as unknown as EntryRow);
    }

    const byLocation: Record<
      string,
      {
        weekStart: string;
        weekEnd: string;
        entries: Array<{
          id: string;
          staffId: string;
          displayName: string;
          department: Department;
          rawDepartment: Department | null;
          businessDate: string;
          startedAt: string;
          endedAt: string;
        }>;
        crossLocationDates: Record<string, string[]>;
        assignedStaff: Array<{
          staffId: string;
          displayName: string;
          department: Department;
          isActive: boolean;
          isPrimary: boolean;
          staffDepts: Department[];
          skillIds: string[];
        }>;
        rosterByStaff: Record<string, { areas: Department[]; skillIds: string[] }>;
        rosterAreaByStaffDate: Record<string, Record<string, Department>>;
        rosterGlByStaffDate: Record<string, Record<string, boolean>>;
      }
    > = {};

    for (const lid of data.locationIds) {
      const locDeptRows = deptByLoc.get(lid) ?? [];
      const deptByStaff = buildPrimaryDeptMap(
        locDeptRows.map((d) => ({ staff_id: d.staff_id, department: d.department })),
      );
      const staffDeptsByStaff = buildStaffDeptsMap(
        locDeptRows.map((d) => ({ staff_id: d.staff_id, department: d.department })),
      );

      const rosterByStaff: Record<string, { areas: Department[]; skillIds: string[] }> = {};
      const rosterAreaByStaffDate: Record<string, Record<string, Department>> = {};
      const rosterGlByStaffDate: Record<string, Record<string, boolean>> = {};
      for (const r of rosterByLoc.get(lid) ?? []) {
        const bucket = rosterByStaff[r.staff_id] ?? { areas: [], skillIds: [] };
        if (r.area && !bucket.areas.includes(r.area)) bucket.areas.push(r.area);
        if (r.skill_id && !bucket.skillIds.includes(r.skill_id)) bucket.skillIds.push(r.skill_id);
        rosterByStaff[r.staff_id] = bucket;
        if (r.area) {
          const perStaff = rosterAreaByStaffDate[r.staff_id] ?? {};
          const existing = perStaff[r.shift_date];
          perStaff[r.shift_date] = existing ? primaryDepartment([existing, r.area]) : r.area;
          rosterAreaByStaffDate[r.staff_id] = perStaff;
        }
        if (r.skill_id && glSkillIds.has(r.skill_id)) {
          const perStaff = rosterGlByStaffDate[r.staff_id] ?? {};
          perStaff[r.shift_date] = true;
          rosterGlByStaffDate[r.staff_id] = perStaff;
        }
      }

      const assignedStaff = locDeptRows
        .map((d) => {
          const dept = d.department as Department;
          const staffId = d.staff_id;
          return {
            staffId,
            displayName: d.staff?.display_name ?? "—",
            department: dept,
            isActive: d.staff?.is_active ?? true,
            isPrimary: deptByStaff.get(staffId) === dept,
            staffDepts: staffDeptsByStaff.get(staffId) ?? [],
            skillIds: skillsByStaff.get(staffId) ?? [],
          };
        })
        .filter((s) => s.isActive);

      const entries = (entriesByLoc.get(lid) ?? []).map((r) => ({
        id: r.id as string,
        staffId: r.staff_id as string,
        displayName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
        department: deptByStaff.get(r.staff_id as string) ?? ("service" as const),
        rawDepartment: (r.department as Department | null) ?? null,
        businessDate: r.business_date as string,
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
      }));

      // crossLocationDates wird im „Alle Standorte"-Mode client-seitig nicht
      // gemergt (nur die Single-Location-Variante braucht das für die
      // Kollegen-Anzeige). Für Batch → leer, um zusätzliche Cross-Queries zu
      // sparen. Der Merge-Reducer (weeklyData in zeit-uebersicht) verwendet
      // dieses Feld ohnehin nicht, wenn isAllLocations aktiv ist.
      byLocation[lid] = {
        weekStart,
        weekEnd,
        entries,
        crossLocationDates: {},
        assignedStaff,
        rosterByStaff,
        rosterAreaByStaffDate,
        rosterGlByStaffDate,
      };
    }
    return { byLocation };
  });

// B6c — Inline-Edit/Create für Wochenplan (Admin)
// Schmaler Wrapper, der nur Start/Ende setzt und break_minutes erhält bzw. 0 setzt.

export const setTimeEntryShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        // Z3 — optional: setzt/ändert die Abteilungs-Dimension des Eintrags.
        // undefined → unverändert lassen; null → auf NULL setzen; Enum-Wert
        // wird gegen staff_locations validiert (Person ∈ Abteilung am Standort).
        department: z.enum(["kitchen", "service", "gl"]).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "planer",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Standort des Eintrags für den Scope-Check vorladen.
    const { data: before, error: loadErr } = await supabaseAdmin
      .from("time_entries")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!before) throw new Error("Eintrag nicht gefunden.");
    // Z5 — Planer dürfen nur Einträge innerhalb der LAUFENDEN Abrechnungsperiode
    // (26.–25.) bearbeiten. Alte Perioden bleiben manager/admin-exklusiv.
    if (caller.role === "planer") {
      const today = todayIso();
      const newBusinessDate = businessDateOf(new Date(data.startedAt));
      if (
        !isInCurrentBillingCycle(before.business_date, today) ||
        !isInCurrentBillingCycle(newBusinessDate, today)
      ) {
        throw new Error("Planer dürfen nur Einträge der laufenden Abrechnungsperiode ändern.");
      }
    }
    return runWithPermission(
      context.supabase,
      "time.entry.edit",
      before.location_id,
      makeAuditWriter(caller),
      async () => {
        if (new Date(data.endedAt).getTime() <= new Date(data.startedAt).getTime()) {
          throw new Error("Ende muss nach dem Beginn liegen.");
        }
        const newBusinessDate = businessDateOf(new Date(data.startedAt));
        await assertBusinessDateUnlocked(
          supabaseAdmin,
          caller.organizationId,
          before.business_date,
        );
        if (newBusinessDate !== before.business_date) {
          await assertBusinessDateUnlocked(supabaseAdmin, caller.organizationId, newBusinessDate);
        }
        // Z3: Abteilungs-Zuordnung serverseitig gegen staff_locations prüfen.
        if (data.department != null && before.location_id) {
          await assertStaffDeptAssignment(
            supabaseAdmin,
            caller.organizationId,
            before.staff_id,
            before.location_id,
            data.department,
          );
        }

        const patch: {
          started_at: string;
          ended_at: string;
          business_date: string;
          department?: Department | null;
        } = {
          started_at: data.startedAt,
          ended_at: data.endedAt,
          business_date: newBusinessDate,
        };
        if (data.department !== undefined) patch.department = data.department;

        const { error } = await supabaseAdmin
          .from("time_entries")
          .update(patch)
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;

        return {
          result: { ok: true as const },
          audit: {
            action: "time_entry.shift_update",
            entity: "time_entry",
            entityId: data.id,
            meta: {
              reason: "Wochenplan inline edit",
              before: {
                startedAt: before.started_at,
                endedAt: before.ended_at,
                businessDate: before.business_date,
                department: (before as { department: Department | null }).department ?? null,
              },
              after: {
                startedAt: data.startedAt,
                endedAt: data.endedAt,
                businessDate: newBusinessDate,
                department:
                  data.department !== undefined
                    ? (data.department ?? null)
                    : ((before as { department: Department | null }).department ?? null),
              },
            },
          },
        };
      },
    );
  });

export const createTimeEntryShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        locationId: z.string().uuid(),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        department: z.enum(["kitchen", "service", "gl"]).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "planer",
    ]);
    if (caller.role === "planer") {
      const businessDate = businessDateOf(new Date(data.startedAt));
      if (!isInCurrentBillingCycle(businessDate, todayIso())) {
        throw new Error("Planer dürfen nur Einträge der laufenden Abrechnungsperiode anlegen.");
      }
    }
    return runWithPermission(
      context.supabase,
      "time.entry.edit",
      data.locationId,
      makeAuditWriter(caller),
      async () => {
        if (new Date(data.endedAt).getTime() <= new Date(data.startedAt).getTime()) {
          throw new Error("Ende muss nach dem Beginn liegen.");
        }
        const businessDate = businessDateOf(new Date(data.startedAt));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await assertBusinessDateUnlocked(supabaseAdmin, caller.organizationId, businessDate);

        const { data: staff, error: sErr } = await supabaseAdmin
          .from("staff")
          .select("id")
          .eq("id", data.staffId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle();
        if (sErr) throw sErr;
        if (!staff) throw new Error("Mitarbeiter nicht in dieser Organisation.");

        // Z3: Falls Abteilung mitgegeben → gegen staff_locations validieren.
        if (data.department != null) {
          await assertStaffDeptAssignment(
            supabaseAdmin,
            caller.organizationId,
            data.staffId,
            data.locationId,
            data.department,
          );
        }

        const { data: created, error } = await supabaseAdmin
          .from("time_entries")
          .insert({
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            location_id: data.locationId,
            started_at: data.startedAt,
            ended_at: data.endedAt,
            business_date: businessDate,
            break_minutes: 0,
            source: "manual",
            department: data.department ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;

        return {
          result: { id: created.id },
          audit: {
            action: "time_entry.shift_create",
            entity: "time_entry",
            entityId: created.id,
            meta: {
              reason: "Wochenplan inline create",
              staffId: data.staffId,
              locationId: data.locationId,
              businessDate,
              startedAt: data.startedAt,
              endedAt: data.endedAt,
              department: data.department ?? null,
            },
          },
        };
      },
    );
  });

// WP1 — Löschen eines Einzel-Eintrags aus dem Wochenplan.
//
// Ehrlichkeitsregel: der Kopfkommentar (Zeile 9) beschreibt manual_delete +
// Snapshot als Bestandteil von B2b. Bis WP1 gab es die Funktion nicht — jetzt
// existiert sie und der Kommentar stimmt wieder mit dem Code überein.
//
// Ablauf: runWithPermission("time.entry.edit") → assertBusinessDateUnlocked →
// DELETE → audit_log("time_entry.manual_delete") mit vollständigem Zeilen-
// Snapshot. Ein gesperrter Geschäftstag bricht VOR dem DELETE ab (kein
// audit_log-Eintrag).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
type SupabaseAdminLike = SupabaseClient<Database>;

export async function _deleteTimeEntryCore(
  supabaseAdmin: SupabaseAdminLike,
  organizationId: string,
  id: string,
  reason: string,
): Promise<{
  locationId: string | null;
  audit: {
    action: string;
    entity: string;
    entityId: string;
    meta: Record<string, unknown>;
  };
}> {
  const { data: before, error: loadErr } = await supabaseAdmin
    .from("time_entries")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!before) throw new Error("Eintrag nicht gefunden.");
  await assertBusinessDateUnlocked(supabaseAdmin, organizationId, before.business_date);
  const { error: delErr } = await supabaseAdmin
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);
  if (delErr) throw delErr;
  return {
    locationId: before.location_id,
    audit: {
      action: "time_entry.manual_delete",
      entity: "time_entry",
      entityId: id,
      meta: {
        reason,
        // Voller Snapshot — Rekonstruierbarkeit aus append-only Log (Gate e).
        snapshot: before as Record<string, unknown>,
      },
    },
  };
}

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(3, "Bitte mindestens 3 Zeichen Begründung.").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "planer",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Scope-Check: Standort des Eintrags vorladen, damit runWithPermission
    // die time.entry.edit-Berechtigung am korrekten Standort prüft.
    const { data: pre, error: preErr } = await supabaseAdmin
      .from("time_entries")
      .select("location_id, business_date")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (preErr) throw preErr;
    if (!pre) throw new Error("Eintrag nicht gefunden.");
    if (caller.role === "planer") {
      if (!isInCurrentBillingCycle(pre.business_date, todayIso())) {
        throw new Error("Planer dürfen nur Einträge der laufenden Abrechnungsperiode löschen.");
      }
    }
    return runWithPermission(
      context.supabase,
      "time.entry.edit",
      pre.location_id,
      makeAuditWriter(caller),
      async () => {
        const { audit } = await _deleteTimeEntryCore(
          supabaseAdmin,
          caller.organizationId,
          data.id,
          data.reason,
        );
        return { result: { ok: true as const }, audit };
      },
    );
  });

// =========================================================================
// B7 — Periodenverwaltung (26.–25.)
// =========================================================================

export const listPeriods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
      "planer",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("periods")
      .select("id, label, start_date, end_date, status")
      .eq("organization_id", caller.organizationId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((p) => ({
      id: p.id as string,
      label: p.label as string,
      startDate: p.start_date as string,
      endDate: p.end_date as string,
      status: p.status as "open" | "locked",
    }));
  });

export const createPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        label: z.string().trim().min(1).max(80),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runWithPermission(
      context.supabase,
      "time.period.manage",
      null,
      makeAuditWriter(caller),
      async () => {
        if (data.endDate < data.startDate) {
          throw new Error("Enddatum muss ≥ Startdatum sein.");
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Overlap-Check
        const { data: overlap, error: oErr } = await supabaseAdmin
          .from("periods")
          .select("id, label, start_date, end_date")
          .eq("organization_id", caller.organizationId)
          .lte("start_date", data.endDate)
          .gte("end_date", data.startDate)
          .limit(1);
        if (oErr) throw oErr;
        if (overlap && overlap.length > 0) {
          throw new Error(
            `Überschneidet sich mit „${overlap[0].label}" (${overlap[0].start_date}–${overlap[0].end_date}).`,
          );
        }
        const { data: created, error } = await supabaseAdmin
          .from("periods")
          .insert({
            organization_id: caller.organizationId,
            label: data.label,
            start_date: data.startDate,
            end_date: data.endDate,
          })
          .select("id")
          .single();
        if (error) throw error;
        return {
          result: { id: created.id as string },
          audit: {
            action: "period.create",
            entity: "period",
            entityId: created.id as string,
            meta: { label: data.label, startDate: data.startDate, endDate: data.endDate },
          },
        };
      },
    );
  });

export const togglePeriodLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runWithPermission(
      context.supabase,
      "time.period.lock",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error: loadErr } = await supabaseAdmin
          .from("periods")
          .select("id, status, label")
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId)
          .maybeSingle();
        if (loadErr) throw loadErr;
        if (!row) throw new Error("Periode nicht gefunden.");
        const next = row.status === "locked" ? "open" : "locked";
        const { error } = await supabaseAdmin
          .from("periods")
          .update({ status: next })
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;
        return {
          result: { id: data.id, status: next as "open" | "locked" },
          audit: {
            action: next === "locked" ? "period.lock" : "period.unlock",
            entity: "period",
            entityId: data.id,
            meta: { label: row.label, before: row.status, after: next },
          },
        };
      },
    );
  });

export const deletePeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runWithPermission(
      context.supabase,
      "time.period.manage",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error: loadErr } = await supabaseAdmin
          .from("periods")
          .select("id, status, label, start_date, end_date")
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId)
          .maybeSingle();
        if (loadErr) throw loadErr;
        if (!row) throw new Error("Periode nicht gefunden.");
        if (row.status !== "open") {
          throw new Error("Nur offene Perioden können gelöscht werden.");
        }
        const { error } = await supabaseAdmin
          .from("periods")
          .delete()
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "period.delete",
            entity: "period",
            entityId: data.id,
            meta: {
              label: row.label,
              startDate: row.start_date,
              endDate: row.end_date,
            },
          },
        };
      },
    );
  });
