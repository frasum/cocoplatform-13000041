// D1 — Dienstplan (Vorausplanung). Nur Lese-Functions in diesem Schritt.
// Schreiben kommt in D2; RLS auf roster_shifts ist SELECT-only für authenticated.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runWithPermission, assertPermission } from "@/lib/admin/admin-call";
// assertPermission wird unten in createDayOffWish/deleteDayOffWish verwendet.
import { makeAuditWriter } from "@/lib/admin/audit";
import { loadStaffCaller } from "@/lib/time/time.functions";
import { assertRealIdentity } from "@/lib/admin/impersonation";
import type { MyShiftRow } from "@/lib/roster/my-shifts";
import { mergeAbsenceRanges, type AbsenceRange } from "@/lib/roster/vacation-planner";
import { resolvePlanerScope } from "@/lib/roster/scope-util";
import { assertDayOpen } from "@/lib/roster/business-calendar.server";
import { selectAllPaged } from "@/lib/supabase/select-all";
import { shiftMatesKey, type ShiftMate } from "@/lib/roster/shift-mates";
import { todayIso } from "@/lib/format";
import { syncOpenSessionsPoolAfterRosterWrite } from "@/lib/cash/roster-pool-sync";

// SP2 — Helper: gewähltes Planungsfenster muss in enabled_service_periods
// des Standorts liegen. Ersetzt den früheren Boolean-Check (day_service_enabled).
const PERIOD_LABEL: Record<"frueh" | "mittag" | "abend", string> = {
  frueh: "Früh",
  mittag: "Mittag",
  abend: "Abend",
};
async function assertServicePeriodAllowed(
  admin: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  locationId: string,
  servicePeriod: "frueh" | "mittag" | "abend",
): Promise<void> {
  const { data, error } = await admin
    .from("locations")
    .select("name, enabled_service_periods")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  const enabled = ((data?.enabled_service_periods as string[] | null) ?? ["abend"]) as Array<
    "frueh" | "mittag" | "abend"
  >;
  if (enabled.includes(servicePeriod)) return;
  const locName = (data as { name?: string | null } | null)?.name?.trim();
  const label = locName ? `„${locName}"` : "Dieser Standort";
  const allowed = enabled.map((p) => PERIOD_LABEL[p]).join(", ") || "—";
  throw new Error(
    `Fenster „${PERIOD_LABEL[servicePeriod]}" nicht möglich: ${label} hat nur ${allowed} aktiviert. ` +
      "Unter Admin → Standorte kann die Fenster-Liste angepasst werden.",
  );
}

const READ_ROLES = ["manager", "admin", "payroll", "staff", "planer"] as const;
const WRITE_ROLES = ["manager", "admin", "planer"] as const;

// P-3b Fix: Berechtigung für absence-Operationen wird in einem der
// Standort/Bereich-Scopes des Mitarbeiters geprüft. Für Admin/Manager
// liefert has_permission ohnehin global true; für Planer muss ein
// passender Override am Standort/Bereich des Mitarbeiters existieren.
async function resolveAllowedStaffScope(
  supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  staffId: string,
  perm: "roster.absence.manage" | "roster.shift.manage",
): Promise<{ locationId: string | null; area: "kitchen" | "service" | "gl" | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("staff_locations")
    .select("location_id, department")
    .eq("staff_id", staffId);
  if (error) return { locationId: null, area: null };
  for (const row of data ?? []) {
    const locId = row.location_id as string;
    const dept = row.department as "kitchen" | "service" | "gl";
    const { data: ok } = await supabase.rpc("has_permission", {
      _perm: perm,
      _location: locId,
      _area: dept,
    });
    if (ok === true) return { locationId: locId, area: dept };
  }
  return { locationId: null, area: null };
}

// Fachregel „Vergangenheit im Dienstplan" (N19, 13.07.2026):
// -------------------------------------------------------------
// Admin und Manager dürfen im Dienstplan JEDEN Tag der aktuell OFFENEN
// Periode bearbeiten — auch bereits vergangene Tage (z. B. 26.06. am
// heutigen 13.07.). Grenze ist ausschließlich der Perioden-Status:
//
//   status = 'open'   → editierbar (Vergangenheit wie Zukunft)
//   status = 'locked' → gesperrt für alle (auch Admin muss zuerst
//                       die Sperre über Periodenwechsel zurückziehen)
//
// Es gibt bewusst KEINEN „Wasserlinien"-Vergleich `shift_date < today`
// für den Dienstplan — der wäre eine stille Zusatzregel gegen die
// Fachvorgabe. Für die Zeiterfassung (`time_locked_through_date`) und
// den Schichttausch (`shift_date > today`) gelten eigene Regeln, die
// hier nicht mitrasieren dürfen. Wer diese Funktion refactort: den
// Vergleich `status === 'locked'` nicht zu `status !== 'open'` oder
// „< today" umbauen.
function assertPeriodStatusAllowsWrite(status: string | null | undefined): void {
  if (status === "locked") {
    throw new Error("Periode gesperrt");
  }
}

async function assertShiftDateUnlocked(
  admin: import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >,
  organizationId: string,
  shiftDate: string,
): Promise<void> {
  const { data, error } = await admin
    .from("periods")
    .select("status")
    .eq("organization_id", organizationId)
    .lte("start_date", shiftDate)
    .gte("end_date", shiftDate)
    .maybeSingle();
  if (error) throw error;
  assertPeriodStatusAllowsWrite(data?.status);
}

// Nur für Tests exportiert — kein öffentlicher API-Vertrag.
export const __test_assertPeriodStatusAllowsWrite = assertPeriodStatusAllowsWrite;

export type RosterShift = {
  id: string;
  staffId: string;
  staffName: string;
  locationId: string;
  shiftDate: string;
  area: "kitchen" | "service" | "gl";
  skillId: string | null;
  skillName: string | null;
  skillColor: string | null;
  status: "planned" | "confirmed";
  notes: string | null;
  servicePeriod: "frueh" | "mittag" | "abend";
};

export type RosterSkill = {
  id: string;
  name: string;
  color: string | null;
  category: "kitchen" | "service" | "gl" | "other";
  sortOrder: number;
};

export type RosterStaffRow = {
  staffId: string;
  displayName: string;
  department: "kitchen" | "service";
  skillIds: string[];
  // SD1b — Nur Monat-Tag (MM-DD) für den Geburtstags-Marker.
  // Jahrgang bleibt server-seitig; Marker vergleicht MM-DD gegen ISO-Datum.
  birthdayMonthDay: string | null;
};

export type RosterCrossBooking = {
  staffId: string;
  shiftDate: string;
  locationId: string;
  locationName: string;
  area: "kitchen" | "service" | "gl";
  skillName: string | null;
  servicePeriod: "frueh" | "mittag" | "abend";
};

export type RosterAvailability = {
  staffId: string;
  date: string;
};

export type RosterAbsence = {
  staffId: string;
  date: string;
  type: "urlaub" | "krank";
};

export const getRosterShifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RosterShift[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_shifts")
      .select(
        "id, staff_id, location_id, shift_date, area, skill_id, status, notes, service_period, staff(display_name), skills(name, color)",
      )
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .gte("shift_date", data.fromDate)
      .lte("shift_date", data.toDate);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      staffId: r.staff_id as string,
      staffName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
      locationId: r.location_id as string,
      shiftDate: r.shift_date as string,
      area: r.area as "kitchen" | "service" | "gl",
      skillId: (r.skill_id as string | null) ?? null,
      skillName: (r.skills as { name: string } | null)?.name ?? null,
      skillColor: (r.skills as { color: string | null } | null)?.color ?? null,
      status: r.status as "planned" | "confirmed",
      notes: (r.notes as string | null) ?? null,
      servicePeriod: ((r.service_period as string | null) ?? "abend") as
        | "frueh"
        | "mittag"
        | "abend",
    }));
  });

// Welle A — Self-Service: eigene kommende Schichten.
// Caller-staffId kommt ausschließlich aus der Session (loadStaffCaller);
// niemals aus dem Client-Payload.
export const getMyShifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        mode: z.enum(["range", "released"]).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<MyShiftRow[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const today = new Date();
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);
    const from = data.from ?? isoDate(today);
    let to = data.to;
    if (!to) {
      const end = new Date(today);
      end.setUTCDate(end.getUTCDate() + 27);
      to = isoDate(end);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Modus "released": Fenster & Sichtbarkeit ergeben sich aus den
    // Freigaben an den Standorten des Mitarbeiters. Nur (Standort × Bereich)-
    // Kombinationen, die als roster_release existieren, sind sichtbar.
    let releasedPairs: Array<{ locationId: string; area: "kitchen" | "service" | "gl" }> | null =
      null;
    if (data.mode === "released") {
      const { data: staffLocs } = await supabaseAdmin
        .from("staff_locations")
        .select("location_id")
        .eq("staff_id", caller.staffId)
        .eq("organization_id", caller.organizationId);
      const locIds = Array.from(new Set((staffLocs ?? []).map((r) => r.location_id as string)));
      if (locIds.length === 0) return [];

      const { data: releases } = await supabaseAdmin
        .from("roster_releases")
        .select("location_id, area, period_id")
        .eq("organization_id", caller.organizationId)
        .in("location_id", locIds);
      const rels = releases ?? [];
      if (rels.length === 0) return [];

      const periodIds = Array.from(new Set(rels.map((r) => r.period_id as string)));
      const { data: periods } = await supabaseAdmin
        .from("periods")
        .select("id, end_date")
        .in("id", periodIds);
      const endByPeriod = new Map<string, string>();
      for (const p of periods ?? []) endByPeriod.set(p.id as string, p.end_date as string);

      let maxEnd = from;
      for (const r of rels) {
        const e = endByPeriod.get(r.period_id as string);
        if (e && e > maxEnd) maxEnd = e;
      }
      to = maxEnd;
      releasedPairs = rels.map((r) => ({
        locationId: r.location_id as string,
        area: r.area as "kitchen" | "service" | "gl",
      }));
    }

    const { data: rows, error } = await supabaseAdmin
      .from("roster_shifts")
      .select(
        "id, shift_date, area, status, notes, location_id, service_period, locations(name, enabled_service_periods), skills(name, category)",
      )
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .gte("shift_date", from)
      .lte("shift_date", to)
      .order("shift_date", { ascending: true })
      .order("area", { ascending: true });
    if (error) throw error;

    const filtered = releasedPairs
      ? (rows ?? []).filter((r) =>
          releasedPairs!.some(
            (p) => p.locationId === (r.location_id as string) && p.area === (r.area as string),
          ),
        )
      : (rows ?? []);

    return filtered.map((r) => {
      const skill = r.skills as { name: string; category: string } | null;
      const loc = r.locations as {
        name: string;
        enabled_service_periods: string[] | null;
      } | null;
      const enabledPeriods = ((loc?.enabled_service_periods ?? ["abend"]) as string[]).filter(
        (p): p is "frueh" | "mittag" | "abend" => p === "frueh" || p === "mittag" || p === "abend",
      );
      return {
        id: r.id as string,
        shift_date: r.shift_date as string,
        locationId: r.location_id as string,
        locationName: loc?.name ?? "—",
        area: r.area as "kitchen" | "service" | "gl",
        skillCode: skill?.category ?? null,
        skillLabel: skill?.name ?? null,
        status: r.status as "planned" | "confirmed",
        notes: (r.notes as string | null) ?? null,
        servicePeriod: ((r.service_period as string | null) ?? "abend") as
          | "frueh"
          | "mittag"
          | "abend",
        enabledServicePeriods: enabledPeriods,
        // Kompatibilitäts-Feld (bleibt bis Commit 2): mehr als ein aktives
        // Fenster ⇒ UI zeigt Fenster-Badge.
        locationDayServiceEnabled: enabledPeriods.length > 1,
      };
    });
  });

// UA2 — Freigabe-Horizont für den eingeloggten Mitarbeiter: spätestes
// end_date aller Perioden, die an einem seiner Standorte in mindestens
// einem Bereich freigegeben sind. Null, wenn keine Freigabe existiert.
export const getMyReleaseHorizon = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ maxEnd: string | null }> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: staffLocs } = await supabaseAdmin
      .from("staff_locations")
      .select("location_id")
      .eq("staff_id", caller.staffId)
      .eq("organization_id", caller.organizationId);
    const locIds = Array.from(new Set((staffLocs ?? []).map((r) => r.location_id as string)));
    if (locIds.length === 0) return { maxEnd: null };

    const { data: releases } = await supabaseAdmin
      .from("roster_releases")
      .select("period_id")
      .eq("organization_id", caller.organizationId)
      .in("location_id", locIds);
    const periodIds = Array.from(new Set((releases ?? []).map((r) => r.period_id as string)));
    if (periodIds.length === 0) return { maxEnd: null };

    const { data: periods } = await supabaseAdmin
      .from("periods")
      .select("end_date")
      .in("id", periodIds);
    let maxEnd: string | null = null;
    for (const p of periods ?? []) {
      const e = p.end_date as string;
      if (!maxEnd || e > maxEnd) maxEnd = e;
    }
    return { maxEnd };
  });

// UA1 — Self-Service: eigene Abwesenheits-Ranges im Zeitfenster.
// Read-only, expandierte roster_absence-Zeilen werden pro Typ zu
// aufeinanderfolgenden Balken zusammengefasst.
export type MyAbsenceRange = AbsenceRange & { type: "urlaub" | "krank" };

export const getMyAbsences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<MyAbsenceRange[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_absence")
      .select("date, type")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .in("type", ["urlaub", "krank"])
      .gte("date", data.from)
      .lte("date", data.to);
    if (error) throw error;
    const byType = new Map<"urlaub" | "krank", string[]>();
    for (const r of rows ?? []) {
      const t = r.type as "urlaub" | "krank";
      const arr = byType.get(t) ?? [];
      arr.push(r.date as string);
      byType.set(t, arr);
    }
    const result: MyAbsenceRange[] = [];
    for (const [type, dates] of byType) {
      for (const range of mergeAbsenceRanges(dates)) {
        result.push({ ...range, type });
      }
    }
    result.sort((a, b) => a.start.localeCompare(b.start));
    return result;
  });

export const listSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RosterSkill[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("skills")
      .select("id, name, color, category, sort_order")
      .eq("organization_id", caller.organizationId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      color: (s.color as string | null) ?? null,
      category: s.category as RosterSkill["category"],
      sortOrder: s.sort_order as number,
    }));
  });

// P-3b — Scopes des aktuellen Aufrufers: in welchen (Standort, Bereich)-
// Kombinationen darf er Dienstpläne schreiben (roster.shift.manage)?
// Spiegelt nur die Server-Durchsetzung (P-2) ins UI – die harte Grenze
// bleibt runWithPermission. Für admin/manager liefert has_permission
// global true → alle Kombinationen; für planer nur dessen Freigaben.
// Bewusst eingegrenzt: kitchen/service (Grid-Bereiche). area='gl' bleibt
// aussen vor – das Grid kennt nur die zwei Spalten.
export type RosterScopeRow = { locationId: string; area: "kitchen" | "service" };

export const getMyRosterScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RosterScopeRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // PL1 — gemeinsamer Helfer. Verhalten unverändert: admin/manager erhalten
    // via has_permission(_perm=…, _location=null) globales true und damit alle
    // Kombinationen; planer erhält nur seine Freigaben.
    const scope = await resolvePlanerScope(
      context.supabase,
      supabaseAdmin,
      caller.organizationId,
      "roster.shift.manage",
    );
    if (scope.all) {
      const { data: locs, error } = await supabaseAdmin
        // ST1: bewusst ungefiltert — Daten-Zugriff (Dienstplan-Defaults für alle bestehenden Standorte).
        .from("locations")
        .select("id")
        .eq("organization_id", caller.organizationId);
      if (error) throw error;
      const areas: RosterScopeRow["area"][] = ["kitchen", "service"];
      return (locs ?? []).flatMap((l) =>
        areas.map((a) => ({ locationId: l.id as string, area: a })),
      );
    }
    return scope.combos;
  });

export const getStaffForRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ locationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<RosterStaffRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: payrollRows, error: payrollErr } = await supabaseAdmin
      .from("role_assignments")
      .select("staff_id")
      .eq("organization_id", caller.organizationId)
      .eq("role", "payroll");
    if (payrollErr) throw payrollErr;
    const payrollIds = new Set((payrollRows ?? []).map((r) => r.staff_id as string));
    const { data: rows, error } = await supabaseAdmin
      .from("staff_locations")
      // RS1 — roster_plannable mitlesen: Feste-Zeiten-Kräfte erscheinen nicht
      // in Planungslisten (Wochenplan, Zuweisung).
      .select("staff_id, department, staff(id, display_name, is_active, roster_plannable)")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId);
    if (error) throw error;

    const visibleRows = (rows ?? []).filter((r) => !payrollIds.has(r.staff_id as string));

    const staffIds = Array.from(
      new Set(
        visibleRows
          .map((r) => r.staff_id as string)
          .filter((id) => {
            const s = visibleRows.find((x) => x.staff_id === id)?.staff as {
              is_active: boolean;
              roster_plannable: boolean | null;
            } | null;
            return isPlannable({ isActive: s?.is_active, rosterPlannable: s?.roster_plannable });
          }),
      ),
    );

    const { data: skillsRows, error: sErr } = await supabaseAdmin
      .from("staff_skills")
      .select("staff_id, skill_id")
      .eq("organization_id", caller.organizationId)
      .in("staff_id", staffIds.length > 0 ? staffIds : ["00000000-0000-0000-0000-000000000000"]);
    if (sErr) throw sErr;
    const skillsByStaff = new Map<string, string[]>();
    for (const sr of skillsRows ?? []) {
      const k = sr.staff_id as string;
      const arr = skillsByStaff.get(k) ?? [];
      arr.push(sr.skill_id as string);
      skillsByStaff.set(k, arr);
    }

    const { data: dobRows, error: dErr } = await supabaseAdmin
      .from("staff_personal_details")
      .select("staff_id, date_of_birth")
      .eq("organization_id", caller.organizationId)
      .in("staff_id", staffIds.length > 0 ? staffIds : ["00000000-0000-0000-0000-000000000000"]);
    if (dErr) throw dErr;
    const bdayByStaff = new Map<string, string | null>();
    for (const r of dobRows ?? []) {
      const dob = (r.date_of_birth as string | null) ?? null;
      bdayByStaff.set(r.staff_id as string, dob && dob.length >= 10 ? dob.slice(5, 10) : null);
    }

    return visibleRows
      .filter((r) => {
        const s = r.staff as { is_active: boolean; roster_plannable: boolean | null } | null;
        return isPlannable({ isActive: s?.is_active, rosterPlannable: s?.roster_plannable });
      })
      .map((r) => ({
        staffId: r.staff_id as string,
        displayName: (r.staff as { display_name: string } | null)?.display_name ?? "—",
        department:
          (r.department as "kitchen" | "service" | "gl") === "kitchen"
            ? ("kitchen" as const)
            : ("service" as const),
        skillIds: skillsByStaff.get(r.staff_id as string) ?? [],
        birthdayMonthDay: bdayByStaff.get(r.staff_id as string) ?? null,
      }))
      .filter((row, idx, arr) => {
        // Dedupe auf (staffId, mappedArea): gl+service desselben Mitarbeiters → 1 Service-Zeile
        return (
          arr.findIndex((x) => x.staffId === row.staffId && x.department === row.department) === idx
        );
      })
      .sort((a, b) => {
        const order = { kitchen: 0, service: 1 } as const;
        if (order[a.department] !== order[b.department]) {
          return order[a.department] - order[b.department];
        }
        return a.displayName.localeCompare(b.displayName, "de");
      });
  });

export const getStaffCrossBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RosterCrossBooking[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_shifts")
      .select(
        "staff_id, shift_date, location_id, area, service_period, locations(name), skills(name)",
      )
      .eq("organization_id", caller.organizationId)
      .gte("shift_date", data.fromDate)
      .lte("shift_date", data.toDate);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      staffId: r.staff_id as string,
      shiftDate: r.shift_date as string,
      locationId: r.location_id as string,
      locationName: (r.locations as { name: string } | null)?.name ?? "—",
      area: r.area as "kitchen" | "service" | "gl",
      skillName: (r.skills as { name: string } | null)?.name ?? null,
      servicePeriod: ((r.service_period as string | null) ?? "abend") as
        | "frueh"
        | "mittag"
        | "abend",
    }));
  });

// =========================================================================
// D2a — Schreiben (Manager+)
// =========================================================================

export const createRosterShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        staffId: z.string().uuid(),
        shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        area: z.enum(["kitchen", "service", "gl"]),
        skillId: z.string().uuid().nullable(),
        servicePeriod: z.enum(["mittag", "abend"]).optional().default("abend"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      data.locationId,
      data.area,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, data.shiftDate);
        await assertDayOpen(supabaseAdmin, data.locationId, data.shiftDate);
        await assertServicePeriodAllowed(supabaseAdmin, data.locationId, data.servicePeriod);

        // Regel: max. EINE Einteilung pro Mitarbeiter, Tag und Fenster
        // (standort-/bereichsübergreifend). Mittag + Abend am gleichen Tag
        // sind mit SP1 ausdrücklich erlaubt (Doppelschicht).
        const { data: existing, error: existErr } = await supabaseAdmin
          .from("roster_shifts")
          .select("location_id, area, service_period, locations(name)")
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .eq("shift_date", data.shiftDate)
          .eq("service_period", data.servicePeriod)
          .limit(1)
          .maybeSingle();
        if (existErr) throw existErr;
        if (existing) {
          const locName = (existing.locations as { name: string } | null)?.name ?? "—";
          throw new Error(
            `Mitarbeiter ist an diesem Tag im gleichen Fenster bereits eingeteilt (${locName} · ${existing.area}).`,
          );
        }

        const { data: row, error } = await supabaseAdmin
          .from("roster_shifts")
          .upsert(
            {
              organization_id: caller.organizationId,
              location_id: data.locationId,
              staff_id: data.staffId,
              shift_date: data.shiftDate,
              area: data.area,
              skill_id: data.skillId,
              status: "planned",
              service_period: data.servicePeriod,
            },
            { onConflict: "staff_id,location_id,shift_date,area,service_period" },
          )
          .select("id")
          .single();
        if (error) throw error;

        await syncOpenSessionsPoolAfterRosterWrite({
          organizationId: caller.organizationId,
          targets: [{ locationId: data.locationId, businessDate: data.shiftDate }],
          op: "roster.shift.create",
        });

        return {
          result: { id: row.id as string },
          audit: {
            action: "roster_shift.create",
            entity: "roster_shift",
            entityId: row.id as string,
            meta: {
              locationId: data.locationId,
              staffId: data.staffId,
              shiftDate: data.shiftDate,
              area: data.area,
              skillId: data.skillId,
              servicePeriod: data.servicePeriod,
            },
          },
        };
      },
    );
  });

export const deleteRosterShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error: loadErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!snap) throw new Error("Schicht nicht gefunden.");
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      snap.location_id as string,
      snap.area as "kitchen" | "service" | "gl",
      makeAuditWriter(caller),
      async () => {
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, snap.shift_date);

        const { error } = await supabaseAdmin
          .from("roster_shifts")
          .delete()
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;

        await syncOpenSessionsPoolAfterRosterWrite({
          organizationId: caller.organizationId,
          targets: [
            {
              locationId: snap.location_id as string,
              businessDate: snap.shift_date as string,
            },
          ],
          op: "roster.shift.delete",
        });

        return {
          result: { ok: true as const },
          audit: {
            action: "roster_shift.delete",
            entity: "roster_shift",
            entityId: data.id,
            meta: {
              snapshot: {
                locationId: snap.location_id,
                staffId: snap.staff_id,
                shiftDate: snap.shift_date,
                area: snap.area,
                skillId: snap.skill_id,
                status: snap.status,
                notes: snap.notes,
              },
            },
          },
        };
      },
    );
  });

export const updateRosterShiftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["planned", "confirmed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error: loadErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("shift_date, status, location_id, area")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!snap) throw new Error("Schicht nicht gefunden.");
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      snap.location_id as string,
      snap.area as "kitchen" | "service" | "gl",
      makeAuditWriter(caller),
      async () => {
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, snap.shift_date);

        const { error } = await supabaseAdmin
          .from("roster_shifts")
          .update({ status: data.status })
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;

        await syncOpenSessionsPoolAfterRosterWrite({
          organizationId: caller.organizationId,
          targets: [
            {
              locationId: snap.location_id as string,
              businessDate: snap.shift_date as string,
            },
          ],
          op: "roster.shift.status",
        });

        return {
          result: { ok: true as const },
          audit: {
            action: "roster_shift.status",
            entity: "roster_shift",
            entityId: data.id,
            meta: { before: snap.status, after: data.status },
          },
        };
      },
    );
  });

export const updateRosterShiftSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        skillId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error: loadErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("shift_date, skill_id, location_id, area")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!snap) throw new Error("Schicht nicht gefunden.");
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      snap.location_id as string,
      snap.area as "kitchen" | "service" | "gl",
      makeAuditWriter(caller),
      async () => {
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, snap.shift_date);

        const { error } = await supabaseAdmin
          .from("roster_shifts")
          .update({ skill_id: data.skillId })
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;

        return {
          result: { ok: true as const },
          audit: {
            action: "roster_shift.skill",
            entity: "roster_shift",
            entityId: data.id,
            meta: { before: snap.skill_id, after: data.skillId },
          },
        };
      },
    );
  });

// D2f — Schicht verschieben (Drag & Drop). Lock-Check auf BEIDEN Daten.
// Kollisions-Pre-Check liefert eine Klartext-Fehlermeldung statt
// Unique-Violation aus der DB.
export const moveRosterShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        staffId: z.string().uuid(),
        shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        area: z.enum(["kitchen", "service", "gl"]),
        servicePeriod: z.enum(["mittag", "abend"]).optional().default("abend"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error: loadErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("location_id, staff_id, shift_date, area, skill_id, status, service_period")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!snap) throw new Error("Schicht nicht gefunden.");
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      snap.location_id as string,
      snap.area as "kitchen" | "service" | "gl",
      makeAuditWriter(caller),
      async () => {
        const targetPeriod = data.servicePeriod;
        const currentPeriod = ((snap.service_period as string | null) ?? "abend") as
          | "mittag"
          | "abend";
        // No-op guard: nichts ändert sich.
        if (
          snap.staff_id === data.staffId &&
          snap.shift_date === data.shiftDate &&
          snap.area === data.area &&
          currentPeriod === targetPeriod
        ) {
          return {
            result: { ok: true as const },
            audit: {
              action: "roster_shift.move",
              entity: "roster_shift",
              entityId: data.id,
              meta: { noop: true },
            },
          };
        }

        // Ziel-Bereich-Check: wenn sich der Bereich ändert, muss auch der
        // Ziel-Bereich am gleichen Standort erlaubt sein (für scoped Planer).
        // Wirft VOR der Mutation → kein audit_log-Eintrag bei Verweigerung.
        if (snap.area !== data.area) {
          await assertPermission(
            context.supabase,
            "roster.shift.manage",
            snap.location_id as string,
            data.area,
          );
        }

        // Lock-Check auf alte UND neue shift_date.
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, snap.shift_date);
        if (snap.shift_date !== data.shiftDate) {
          await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, data.shiftDate);
        }
        // Ziel-Tag muss offen sein (Löschen bleibt erlaubt).
        await assertDayOpen(supabaseAdmin, snap.location_id as string, data.shiftDate);
        // Ziel-Fenster (Mittag) nur wenn Standort Tagesbetrieb hat.
        await assertServicePeriodAllowed(supabaseAdmin, snap.location_id as string, targetPeriod);

        // Konflikt-Pre-Check auf Zielzelle.
        const { data: clash, error: clashErr } = await supabaseAdmin
          .from("roster_shifts")
          .select("id")
          .eq("organization_id", caller.organizationId)
          .eq("location_id", snap.location_id)
          .eq("staff_id", data.staffId)
          .eq("shift_date", data.shiftDate)
          .eq("area", data.area)
          .eq("service_period", targetPeriod)
          .neq("id", data.id)
          .maybeSingle();
        if (clashErr) throw clashErr;
        if (clash) {
          throw new Error(
            "Mitarbeiter ist an diesem Tag in diesem Bereich und Fenster bereits eingeteilt.",
          );
        }

        // Regel: max. EINE Einteilung pro Mitarbeiter, Tag und Fenster —
        // auch an anderem Standort/Bereich. Andere Fenster erlaubt (Doppelschicht).
        const { data: elsewhere, error: elseErr } = await supabaseAdmin
          .from("roster_shifts")
          .select("location_id, area, service_period, locations(name)")
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .eq("shift_date", data.shiftDate)
          .eq("service_period", targetPeriod)
          .neq("id", data.id)
          .limit(1)
          .maybeSingle();
        if (elseErr) throw elseErr;
        if (elsewhere) {
          const locName = (elsewhere.locations as { name: string } | null)?.name ?? "—";
          throw new Error(
            `Mitarbeiter ist an diesem Tag im gleichen Fenster bereits eingeteilt (${locName} · ${elsewhere.area}).`,
          );
        }

        const { error } = await supabaseAdmin
          .from("roster_shifts")
          .update({
            staff_id: data.staffId,
            shift_date: data.shiftDate,
            area: data.area,
            service_period: targetPeriod,
          })
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw error;

        await syncOpenSessionsPoolAfterRosterWrite({
          organizationId: caller.organizationId,
          targets: [
            {
              locationId: snap.location_id as string,
              businessDate: snap.shift_date as string,
            },
            {
              locationId: snap.location_id as string,
              businessDate: data.shiftDate,
            },
          ],
          op: "roster.shift.move",
        });

        return {
          result: { ok: true as const },
          audit: {
            action: "roster_shift.move",
            entity: "roster_shift",
            entityId: data.id,
            meta: {
              before: {
                staffId: snap.staff_id,
                shiftDate: snap.shift_date,
                area: snap.area,
                servicePeriod: currentPeriod,
              },
              after: {
                staffId: data.staffId,
                shiftDate: data.shiftDate,
                area: data.area,
                servicePeriod: targetPeriod,
              },
            },
          },
        };
      },
    );
  });

// =========================================================================
// D2f — Verfügbarkeiten (mitarbeiterweit, ohne Standortbezug)
// =========================================================================

export const getAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RosterAvailability[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_availability")
      .select("staff_id, date")
      .eq("organization_id", caller.organizationId)
      .gte("date", data.fromDate)
      .lte("date", data.toDate);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      staffId: r.staff_id as string,
      date: r.date as string,
    }));
  });

export const setUnavailable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.availability.manage_all",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("roster_availability").upsert(
          {
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            date: data.date,
            type: "unavailable",
          },
          { onConflict: "staff_id,date", ignoreDuplicates: true },
        );
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster_availability.set",
            entity: "roster_availability",
            meta: { staffId: data.staffId, date: data.date, type: "unavailable" },
          },
        };
      },
    );
  });

export const clearUnavailable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.availability.manage_all",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("roster_availability")
          .delete()
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .eq("date", data.date);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster_availability.clear",
            entity: "roster_availability",
            meta: { staffId: data.staffId, date: data.date },
          },
        };
      },
    );
  });

// =========================================================================
// D2g — Urlaub / Abwesenheit (mitarbeiterweit)
// =========================================================================

export const getAbsences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RosterAbsence[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_absence")
      .select("staff_id, date, type")
      .eq("organization_id", caller.organizationId)
      .gte("date", data.fromDate)
      .lte("date", data.toDate);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      staffId: r.staff_id as string,
      date: r.date as string,
      type: ((r.type as "urlaub" | "krank") ?? "urlaub") as "urlaub" | "krank",
    }));
  });

export const setAbsence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        type: z.enum(["urlaub", "krank"]).optional().default("urlaub"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const scope = await resolveAllowedStaffScope(
      context.supabase,
      data.staffId,
      "roster.absence.manage",
    );
    return runWithPermission(
      context.supabase,
      "roster.absence.manage",
      scope.locationId,
      scope.area,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // N19: Absenzen dürfen nicht in eine gesperrte Periode geschrieben
        // werden — analog zu allen roster_shifts-Schreibpfaden.
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, data.date);
        const { error } = await supabaseAdmin.from("roster_absence").upsert(
          {
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            date: data.date,
            type: data.type,
          },
          { onConflict: "staff_id,date" },
        );
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster_absence.set",
            entity: "roster_absence",
            meta: { staffId: data.staffId, date: data.date, type: data.type },
          },
        };
      },
    );
  });

export const clearAbsence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const scope = await resolveAllowedStaffScope(
      context.supabase,
      data.staffId,
      "roster.absence.manage",
    );
    return runWithPermission(
      context.supabase,
      "roster.absence.manage",
      scope.locationId,
      scope.area,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // N19: Absenzen dürfen nicht in einer gesperrten Periode entfernt
        // werden — analog zu allen roster_shifts-Schreibpfaden.
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, data.date);
        const { error } = await supabaseAdmin
          .from("roster_absence")
          .delete()
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .eq("date", data.date);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster_absence.clear",
            entity: "roster_absence",
            meta: { staffId: data.staffId, date: data.date },
          },
        };
      },
    );
  });

function expandDateRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const setAbsenceRange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        type: z.enum(["urlaub", "krank"]),
      })
      .refine((v) => v.toDate >= v.fromDate, { message: "toDate muss >= fromDate sein" })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const scope = await resolveAllowedStaffScope(
      context.supabase,
      data.staffId,
      "roster.absence.manage",
    );
    return runWithPermission(
      context.supabase,
      "roster.absence.manage",
      scope.locationId,
      scope.area,
      makeAuditWriter(caller),
      async () => {
        const days = expandDateRange(data.fromDate, data.toDate);
        if (days.length > 92) {
          throw new Error("Zeitraum darf maximal 92 Tage umfassen.");
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Wasserlinie: Wenn der Zeitraum in eine gesperrte Periode ragt,
        // dürfen wir dort weder Absence upserten noch die Schichten löschen.
        // Analog zu den Einzel-Schreibpfaden brechen wir mit klarem Fehler ab,
        // statt still Schichten zu entfernen.
        const { data: lockedPeriods, error: perErr } = await supabaseAdmin
          .from("periods")
          .select("start_date, end_date, status")
          .eq("organization_id", caller.organizationId)
          .eq("status", "locked")
          .lte("start_date", data.toDate)
          .gte("end_date", data.fromDate);
        if (perErr) throw perErr;
        if (lockedPeriods && lockedPeriods.length > 0) {
          const spans = lockedPeriods.map((p) => `${p.start_date}–${p.end_date}`).join(", ");
          throw new Error(
            `Periode gesperrt: Der Zeitraum ${data.fromDate}–${data.toDate} ` +
              `überschneidet gesperrte Periode(n) (${spans}). ` +
              `Ein Admin muss die Sperre zuerst zurückziehen.`,
          );
        }
        const rows = days.map((d) => ({
          organization_id: caller.organizationId,
          staff_id: data.staffId,
          date: d,
          type: data.type,
        }));
        const { error: upErr } = await supabaseAdmin
          .from("roster_absence")
          .upsert(rows, { onConflict: "staff_id,date" });
        if (upErr) throw upErr;

        const { data: deleted, error: delErr } = await supabaseAdmin
          .from("roster_shifts")
          .delete()
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .gte("shift_date", data.fromDate)
          .lte("shift_date", data.toDate)
          .select("id");
        if (delErr) throw delErr;
        const deletedShiftCount = deleted?.length ?? 0;

        return {
          result: { ok: true as const, daysCount: days.length, deletedShiftCount },
          audit: {
            action: "roster_absence.set_range",
            entity: "roster_absence",
            meta: {
              staffId: data.staffId,
              fromDate: data.fromDate,
              toDate: data.toDate,
              type: data.type,
              daysCount: days.length,
              deletedShiftCount,
            },
          },
        };
      },
    );
  });

// Zählt alle Dienstplan-Schichten eines Mitarbeiters im Zeitraum
// [fromDate, toDate] (inklusiv, über ALLE Standorte/Bereiche). Wird vom
// Abwesenheits-Formular als Vorab-Warnung benutzt — der Server löscht
// beim Anlegen einer Range genau diese Schichten, das Grid zeigt aber
// nur ein 4-Wochen-Fenster; ohne diesen Aufruf wäre die Warnzahl
// systematisch zu klein.
export const countStaffShiftsInRange = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .refine((v) => v.toDate >= v.fromDate, { message: "toDate muss >= fromDate sein" })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await supabaseAdmin
      .from("roster_shifts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", data.staffId)
      .gte("shift_date", data.fromDate)
      .lte("shift_date", data.toDate);
    if (error) throw error;
    return { count: count ?? 0 };
  });

// =========================================================================
// Welle B — Freier-Tag-Wünsche (lila Herz)
// Tabelle day_off_wishes existiert bereits (Migration separat).
// =========================================================================

export type DayOffWishRow = {
  staffId: string;
  wishDate: string;
  note: string | null;
};

export type MyDayOffWishRow = {
  wishDate: string;
  note: string | null;
};

export const getDayOffWishes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<DayOffWishRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("day_off_wishes")
      .select("staff_id, wish_date, note")
      .eq("organization_id", caller.organizationId)
      .gte("wish_date", data.fromDate)
      .lte("wish_date", data.toDate);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      staffId: r.staff_id as string,
      wishDate: r.wish_date as string,
      note: (r.note as string | null) ?? null,
    }));
  });

export const getMyDayOffWishes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyDayOffWishRow[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    // N18a (13.07.): zentrale Berlin-„Heute"-Funktion — sonst würde die
    // Wunschfrei-Liste zwischen 00:00 und 02:00 Ortszeit den heutigen
    // Wunsch fälschlich als „vergangen" wegfiltern.
    const today = todayIso();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("day_off_wishes")
      .select("wish_date, note")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .gte("wish_date", today)
      .order("wish_date", { ascending: true });
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      wishDate: r.wish_date as string,
      note: (r.note as string | null) ?? null,
    }));
  });

export const createDayOffWish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        wishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .transform((v) => {
            if (v == null) return null;
            const trimmed = v.trim();
            return trimmed.length === 0 ? null : trimmed;
          }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    await assertPermission(context.supabase, "roster.wish.create_self", null);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("day_off_wishes").upsert(
      {
        organization_id: caller.organizationId,
        staff_id: caller.staffId,
        wish_date: data.wishDate,
        note: data.note,
      },
      { onConflict: "staff_id,wish_date" },
    );
    if (error) throw error;
    return { ok: true as const };
  });

// =========================================================================
// Dienstplan-Freigabe pro (Standort, Periode, Bereich)
// =========================================================================

export const getRosterRelease = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        periodId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ kitchen: boolean; service: boolean }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, READ_ROLES);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("roster_releases")
      .select("area")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .eq("period_id", data.periodId);
    if (error) throw error;
    const areas = new Set((rows ?? []).map((r) => r.area as string));
    return { kitchen: areas.has("kitchen"), service: areas.has("service") };
  });

export const setRosterRelease = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        periodId: z.string().uuid(),
        area: z.enum(["kitchen", "service"]),
        released: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.shift.manage",
      data.locationId,
      data.area,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let releaseId: string | undefined;
        if (data.released) {
          const { data: row, error } = await supabaseAdmin
            .from("roster_releases")
            .upsert(
              {
                organization_id: caller.organizationId,
                location_id: data.locationId,
                period_id: data.periodId,
                area: data.area,
                released_at: new Date().toISOString(),
                released_by: caller.staffId,
              },
              { onConflict: "location_id,period_id,area" },
            )
            .select("id")
            .single();
          if (error) throw error;
          releaseId = row.id as string;
        } else {
          // Idempotent zurückziehen: wenn die Freigabe schon weg ist, ist das
          // Ergebnis ebenfalls „nicht freigegeben“. Die Rückgabe der gelöschten
          // ID macht sichtbar, dass wirklich die Bereichs-Zeile entfernt wurde.
          const { data: deleted, error } = await supabaseAdmin
            .from("roster_releases")
            .delete()
            .eq("organization_id", caller.organizationId)
            .eq("location_id", data.locationId)
            .eq("period_id", data.periodId)
            .eq("area", data.area)
            .select("id")
            .maybeSingle();
          if (error) throw error;
          releaseId = (deleted?.id as string | undefined) ?? undefined;
        }
        return {
          result: { ok: true as const, released: data.released },
          audit: {
            action: "roster.release",
            entity: "roster_release",
            entityId: releaseId,
            meta: {
              locationId: data.locationId,
              periodId: data.periodId,
              area: data.area,
              released: data.released,
            },
          },
        };
      },
    );
  });

export const deleteDayOffWish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ wishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    await assertPermission(context.supabase, "roster.wish.create_self", null);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("day_off_wishes")
      .delete()
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .eq("wish_date", data.wishDate);
    if (error) throw error;
    return { ok: true as const };
  });

// =========================================================================
// Manager-Erfassung: Wunschfrei manuell setzen/entfernen
// =========================================================================

export const createDayOffWishFor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        wishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .transform((v) => {
            if (v == null) return null;
            const trimmed = v.trim();
            return trimmed.length === 0 ? null : trimmed;
          }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.wish.manage_all",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("day_off_wishes").upsert(
          {
            organization_id: caller.organizationId,
            staff_id: data.staffId,
            wish_date: data.wishDate,
            note: data.note,
          },
          { onConflict: "staff_id,wish_date" },
        );
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster.wish.set_for",
            entity: "day_off_wish",
            meta: { staffId: data.staffId, wishDate: data.wishDate },
          },
        };
      },
    );
  });

export const deleteDayOffWishFor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        wishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, WRITE_ROLES);
    return runWithPermission(
      context.supabase,
      "roster.wish.manage_all",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("day_off_wishes")
          .delete()
          .eq("organization_id", caller.organizationId)
          .eq("staff_id", data.staffId)
          .eq("wish_date", data.wishDate);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "roster.wish.clear_for",
            entity: "day_off_wish",
            meta: { staffId: data.staffId, wishDate: data.wishDate },
          },
        };
      },
    );
  });

// WA2 — „Mit dir im Dienst": Kollegen des Callers pro Tag+Standort.
// Rechtemodell: keine RLS-Aufweichung. Caller-staffId kommt aus der Session.
// Es werden ausschließlich Kollegen an Tagen/Standorten geladen, an denen
// der Caller SELBST eingeplant ist. Keine Stammdaten außer display_name +
// skill-Name.
const MY_SHIFT_MATES_MAX_DAYS = 62;

export type ShiftMatesMap = Record<string, ShiftMate[]>;

export const getMyShiftMates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ShiftMatesMap> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);

    // Zeitraum serverseitig auf max. 62 Tage kappen.
    const fromMs = Date.parse(`${data.from}T00:00:00Z`);
    const toMs = Date.parse(`${data.to}T00:00:00Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
      return {};
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.floor((toMs - fromMs) / dayMs) + 1;
    const cappedTo =
      spanDays > MY_SHIFT_MATES_MAX_DAYS
        ? new Date(fromMs + (MY_SHIFT_MATES_MAX_DAYS - 1) * dayMs).toISOString().slice(0, 10)
        : data.to;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Eigene Schichten → Menge relevanter (date, location)-Paare.
    const { data: ownRows, error: ownErr } = await supabaseAdmin
      .from("roster_shifts")
      .select("shift_date, location_id")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .gte("shift_date", data.from)
      .lte("shift_date", cappedTo);
    if (ownErr) throw ownErr;
    if (!ownRows || ownRows.length === 0) return {};

    const pairSet = new Set<string>();
    const dateSet = new Set<string>();
    const locSet = new Set<string>();
    for (const r of ownRows) {
      const d = r.shift_date as string;
      const l = r.location_id as string;
      pairSet.add(shiftMatesKey(d, l));
      dateSet.add(d);
      locSet.add(l);
    }
    const dates = Array.from(dateSet);
    const locations = Array.from(locSet);

    // 2) Alle Schichten in diesen Datumsspalten UND Standorten laden.
    // Filter im DB-Layer ist konservativ (Kreuzprodukt aus Dates×Locations);
    // spätere In-Memory-Filterung erzwingt die exakten Paare.
    const rawRows = await selectAllPaged<{
      staff_id: string;
      shift_date: string;
      location_id: string;
      area: string;
      status: string;
      skill_id: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("roster_shifts")
        .select("staff_id, shift_date, location_id, area, status, skill_id")
        .eq("organization_id", caller.organizationId)
        .in("shift_date", dates)
        .in("location_id", locations)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const mateRows = rawRows.filter(
      (r) =>
        r.staff_id !== caller.staffId &&
        (r.area === "kitchen" || r.area === "service") &&
        pairSet.has(shiftMatesKey(r.shift_date, r.location_id)),
    );
    if (mateRows.length === 0) return {};

    // 3) Namen + Skills nachladen (nur die Felder, die die UI zeigt).
    const staffIds = Array.from(new Set(mateRows.map((r) => r.staff_id)));
    const skillIds = Array.from(
      new Set(mateRows.map((r) => r.skill_id).filter((v): v is string => Boolean(v))),
    );

    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("staff")
      .select("id, display_name")
      .eq("organization_id", caller.organizationId)
      .in("id", staffIds);
    if (staffErr) throw staffErr;
    const nameById = new Map<string, string>();
    for (const s of staffRows ?? []) {
      nameById.set(s.id as string, ((s.display_name as string | null) ?? "—").trim() || "—");
    }

    const skillNameById = new Map<string, string>();
    if (skillIds.length > 0) {
      const { data: skillRows, error: skillErr } = await supabaseAdmin
        .from("skills")
        .select("id, name")
        .eq("organization_id", caller.organizationId)
        .in("id", skillIds);
      if (skillErr) throw skillErr;
      for (const sk of skillRows ?? []) {
        skillNameById.set(sk.id as string, sk.name as string);
      }
    }

    const grouped: ShiftMatesMap = {};
    for (const r of mateRows) {
      const key = shiftMatesKey(r.shift_date, r.location_id);
      const list = grouped[key] ?? (grouped[key] = []);
      list.push({
        staffId: r.staff_id,
        displayName: nameById.get(r.staff_id) ?? "—",
        area: r.area as "kitchen" | "service",
        skillName: r.skill_id ? (skillNameById.get(r.skill_id) ?? null) : null,
        status: r.status as "planned" | "confirmed",
      });
    }
    // Alphabetisch nach Anzeigename (case-insensitiv, deutsche Locale).
    const cmp = new Intl.Collator("de", { sensitivity: "base" }).compare;
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => cmp(a.displayName, b.displayName));
    }
    return grouped;
  });
