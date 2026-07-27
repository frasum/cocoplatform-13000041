// Zeiterfassung B2a — Server-Functions.
//
// Architektur:
//  - Alle Schreibvorgänge laufen ausschließlich serverseitig via supabaseAdmin.
//    time_entries hat KEINE Client-Schreibpolicy (DENY-ALL).
//  - business_date wird aus started_at über businessDateOf() berechnet
//    (gleiche Definition wie SQL current_business_date(), Europe/Berlin,
//    3-Uhr-Cutoff).
//  - Geschäftsregeln werden in time-rules.ts (reine Funktionen) geprüft,
//    VOR dem Schreiben.
//  - location_id wird automatisch gesetzt, wenn der Mitarbeiter genau EINER
//    Standort-Zuordnung hat; sonst NULL.
//  - source = 'clock' für UI-Stempelungen; 'manual' bleibt für B2b
//    (Manager-Korrekturen) reserviert.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { businessDateOf } from "@/lib/business-date";
import { canClockIn, canClockOut, denialMessage } from "./time-rules";
import { pickSingleLocation } from "./resolve-location";
import { writeAuditLog } from "@/lib/admin/audit";
import { assertPermission } from "@/lib/admin/admin-call";
import { arbzgMinimumBreak, isArbzgShort, grossMinutesBetween } from "./break-rules";
import { assertWithinFence } from "@/lib/geo/server-check";
import { absenceTodayError, shouldWarnAbsenceClockIn, type AbsenceType } from "./absence-warn";
import { assertRealIdentity } from "@/lib/admin/impersonation";
// IMP1b — loadStaffCaller/StaffCaller wohnen zentral in admin/staff-context.
// Re-Export für bestehende Importpfade (Backwards-Kompatibilität).
import { loadStaffCaller, type StaffCaller } from "@/lib/admin/staff-context";
export { loadStaffCaller, type StaffCaller };

export async function loadOpenEntry(
  staffId: string,
): Promise<{ id: string; startedAt: Date; locationId: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .select("id, started_at, location_id")
    .eq("staff_id", staffId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    startedAt: new Date(data.started_at),
    locationId: data.location_id ?? null,
  };
}

async function resolveDefaultLocation(
  staffId: string,
  organizationId: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("staff_locations")
    .select("location_id")
    .eq("staff_id", staffId)
    .eq("organization_id", organizationId);
  if (error) throw error;
  return pickSingleLocation(data ?? []);
}

// =========================================================================
// Lesen
// =========================================================================

export const getMyOpenEntry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const open = await loadOpenEntry(caller.staffId);
    if (!open) return null;
    return { id: open.id, startedAt: open.startedAt.toISOString() };
  });

export const listMyEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("time_entries")
      .select("id, started_at, ended_at, business_date, source, location_id")
      .eq("staff_id", caller.staffId)
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      businessDate: r.business_date,
      source: r.source,
      locationId: r.location_id,
    }));
  });

// Z1 — gearbeitete Schichten der Abrechnungsperiode (Portal-Self-Service).
// periodOffset: 0 = aktuelle Periode, -1 = vorherige usw. (nur Vergangenheit).
export const getMyPeriodEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ periodOffset: z.number().int().min(-24).max(0).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const offset = data.periodOffset ?? 0;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: periods, error: pErr } = await supabaseAdmin
      .from("periods")
      .select("id, label, start_date, end_date")
      .eq("organization_id", caller.organizationId)
      .order("start_date", { ascending: false });
    if (pErr) throw pErr;
    const all = periods ?? [];
    const today = businessDateOf(new Date());
    const currentIdx = all.findIndex(
      (p) => (p.start_date as string) <= today && (p.end_date as string) >= today,
    );
    if (currentIdx < 0) {
      throw new Error("Keine Abrechnungsperiode gefunden.");
    }
    const targetIdx = currentIdx - offset; // offset -1 → index+1 (frühere Periode)
    const period = all[targetIdx];
    if (!period) {
      throw new Error("Keine Abrechnungsperiode gefunden.");
    }

    const { data: rows, error } = await supabaseAdmin
      .from("time_entries")
      .select("id, business_date, started_at, ended_at, break_minutes, source, location_id")
      .eq("staff_id", caller.staffId)
      .gte("business_date", period.start_date as string)
      .lte("business_date", period.end_date as string)
      .order("started_at", { ascending: true });
    if (error) throw error;

    const { data: locs, error: lErr } = await supabaseAdmin
      // ST1: bewusst ungefiltert — Daten-Zugriff (Namensauflösung an historischen Zeiteinträgen).
      .from("locations")
      .select("id, name, enabled_service_periods")
      .eq("organization_id", caller.organizationId);
    if (lErr) throw lErr;
    const nameById = new Map<string, string>(
      (locs ?? []).map((l) => [l.id as string, l.name as string]),
    );
    // SP2 — Aktive Planungsfenster je Standort. Fenster-Badge wird im Portal
    // gezeigt, sobald mehr als ein Fenster aktiv ist (aus der Startzeit
    // abgeleitet, nicht persistiert).
    const dayServiceById = new Map<string, boolean>(
      (locs ?? []).map((l) => {
        const periods = ((l as { enabled_service_periods?: string[] | null })
          .enabled_service_periods ?? ["abend"]) as string[];
        return [l.id as string, periods.length > 1];
      }),
    );

    // PB2 — Vergütungsminuten in der Selbstansicht folgen dem Org-Schalter
    // `pausen_bezahlt` (Default TRUE). Kein manager+ nötig: nur der eine
    // Boolean der eigenen Organisation wird geliefert.
    const { data: orgSet, error: orgSetErr } = await supabaseAdmin
      .from("organization_settings")
      .select("pausen_bezahlt")
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (orgSetErr) throw orgSetErr;
    const pausenBezahlt = orgSet?.pausen_bezahlt ?? true;

    return {
      period: {
        id: period.id as string,
        label: period.label as string,
        startDate: period.start_date as string,
        endDate: period.end_date as string,
        isCurrent: offset === 0,
      },
      pausenBezahlt,
      entries: (rows ?? []).map((r) => ({
        id: r.id as string,
        businessDate: r.business_date as string,
        startedAt: r.started_at as string,
        endedAt: (r.ended_at as string | null) ?? null,
        breakMinutes: (r.break_minutes as number | null) ?? 0,
        source: r.source as "clock" | "manual",
        locationId: (r.location_id as string | null) ?? null,
        locationName: r.location_id ? (nameById.get(r.location_id as string) ?? null) : null,
        locationDayServiceEnabled: r.location_id
          ? (dayServiceById.get(r.location_id as string) ?? false)
          : false,
      })),
    };
  });

// =========================================================================
// Schreiben (Stempeln)
// =========================================================================

const GeoFixSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000),
});

export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    GeoFixSchema.extend({ confirmAbsence: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    const open = await loadOpenEntry(caller.staffId);
    const decision = canClockIn({ staffIsActive: caller.isActive, openEntry: open });
    if (!decision.ok) throw new Error(denialMessage(decision.reason));

    const now = new Date();
    const locationId = await resolveDefaultLocation(caller.staffId, caller.organizationId);
    if (!locationId) {
      throw new Error(
        "Kein eindeutiger Standort zugeordnet — Geofence kann nicht geprüft werden. Bitte Manager kontaktieren.",
      );
    }

    // Rechte-Check: darf dieser Mitarbeiter an diesem Standort stempeln?
    await assertPermission(context.supabase, "time.entry.clock", locationId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // UA1 — Abwesenheits-Warnung am heutigen business_date.
    // Verweigerung schreibt KEINEN time_entry und KEINEN Audit-Eintrag
    // (B2a-Muster). Bestätigt der Aufrufer explizit, landet der Typ als
    // absenceOverride im clock_in-Audit-meta.
    const businessDate = businessDateOf(now);
    const { data: absenceRows, error: absenceErr } = await supabaseAdmin
      .from("roster_absence")
      .select("type")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .eq("date", businessDate)
      .in("type", ["urlaub", "krank"])
      .limit(1);
    if (absenceErr) throw absenceErr;
    const absenceType: AbsenceType | null =
      (absenceRows?.[0]?.type as AbsenceType | undefined) ?? null;
    const warn = shouldWarnAbsenceClockIn({
      absenceToday: absenceType,
      confirmed: data.confirmAbsence === true,
    });
    if ("warn" in warn && warn.warn) {
      throw new Error(absenceTodayError(warn.type));
    }
    const absenceOverride: AbsenceType | null =
      "override" in warn && warn.override ? warn.type : null;

    const geo = await assertWithinFence({
      admin: supabaseAdmin,
      organizationId: caller.organizationId,
      locationId,
      fix: data,
    });

    const { data: created, error } = await supabaseAdmin
      .from("time_entries")
      .insert({
        organization_id: caller.organizationId,
        staff_id: caller.staffId,
        location_id: locationId,
        started_at: now.toISOString(),
        business_date: businessDate,
        source: "clock",
      })
      .select("id, started_at")
      .single();
    if (error) throw error;

    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "time_entry.clock_in",
      entity: "time_entry",
      entityId: created.id,
      meta: {
        source: "clock",
        locationId,
        geo: {
          lat: data.latitude,
          lng: data.longitude,
          accuracyM: data.accuracyM,
          distanceM: geo.decision.ok ? geo.decision.distanceM : null,
        },
        ...(absenceOverride ? { absenceOverride: { type: absenceOverride } } : {}),
      },
    });

    return { id: created.id, startedAt: created.started_at };
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        breakMinutes: z.number().int().min(0).max(479),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    // Rechte-Check pro Standort, falls offener Eintrag mit Location existiert.
    const open = await loadOpenEntry(caller.staffId);
    await assertPermission(context.supabase, "time.entry.clock", open?.locationId ?? null);
    const result = await performClockOut(
      caller,
      data.breakMinutes,
      {},
      {
        latitude: data.latitude,
        longitude: data.longitude,
        accuracyM: data.accuracyM,
      },
    );
    if (!result) throw new Error(denialMessage("no_open_entry"));
    return result;
  });

/**
 * Interner Auto-Ausstempel-Pfad: gleiche Validierung, gleicher
 * Audit-Action (`time_entry.clock_out`), kann von anderen Server-Functions
 * (z. B. `submitWaiterSettlement`) aufgerufen werden.
 *
 * Rückgabe `null`, wenn KEIN offener Zeiteintrag existiert. Bewusst kein
 * Throw, damit Aufrufer zwischen „kein Eintrag" und „Fehler" unterscheiden
 * können.
 *
 * `extraMeta` wird in das audit_log-meta gemergt (z. B.
 * `{ triggered_by: 'settlement', settlement_id, arbzg_default: true }`).
 */
export async function performClockOut(
  caller: StaffCaller,
  breakMinutes: number,
  extraMeta: Record<string, unknown> = {},
  geoFix?: { latitude: number; longitude: number; accuracyM: number },
): Promise<{ id: string; startedAt: string; endedAt: string } | null> {
  const open = await loadOpenEntry(caller.staffId);
  const now = new Date();
  const decision = canClockOut({ openEntry: open, now });
  if (!decision.ok) {
    if (decision.reason === "no_open_entry") return null;
    throw new Error(denialMessage(decision.reason));
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Geofence-Check NUR für UI-Stempelungen (geoFix mitgegeben). Interne
  // Aufrufer (z. B. Abrechnungs-Auto-Out) übergeben keinen Fix und werden
  // nicht geprüft, weil das System dort selbständig schliesst.
  let distanceM: number | null = null;
  if (geoFix) {
    if (!open!.locationId) {
      throw new Error(
        "Offener Eintrag hat keinen Standort hinterlegt — Geofence kann nicht geprüft werden.",
      );
    }
    const geo = await assertWithinFence({
      admin: supabaseAdmin,
      organizationId: caller.organizationId,
      locationId: open!.locationId,
      fix: geoFix,
    });
    distanceM = geo.decision.ok ? geo.decision.distanceM : null;
  }

  const { data: updated, error } = await supabaseAdmin
    .from("time_entries")
    .update({ ended_at: now.toISOString(), break_minutes: breakMinutes })
    .eq("id", open!.id)
    .eq("staff_id", caller.staffId)
    .is("ended_at", null)
    .select("id, started_at, ended_at")
    .single();
  if (error) throw error;

  const gross = grossMinutesBetween(new Date(updated.started_at), now);
  const arbzgShort = isArbzgShort(gross, breakMinutes);

  await writeAuditLog({
    organizationId: caller.organizationId,
    actorUserId: caller.userId,
    actorStaffId: caller.staffId,
    action: "time_entry.clock_out",
    entity: "time_entry",
    entityId: updated.id,
    meta: {
      source: "clock",
      breakMinutes,
      grossMinutes: gross,
      arbzgRecommended: arbzgMinimumBreak(gross),
      arbzgShort,
      geo: geoFix
        ? {
            lat: geoFix.latitude,
            lng: geoFix.longitude,
            accuracyM: geoFix.accuracyM,
            distanceM,
          }
        : null,
      ...extraMeta,
    },
  });

  return {
    id: updated.id,
    startedAt: updated.started_at,
    endedAt: updated.ended_at!,
  };
}
