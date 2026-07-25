// EP1b — Gemeinsamer Lade-Weg für Schichten/Abwesenheiten/Skills.
// Wird sowohl von `buildDisplayData` (TRMNL-Dienstplan, Verified Truth
// inkl. getauschter Schichten) als auch von der Planungstafel-Route
// benutzt, damit beide Anzeigen exakt denselben Datenstand sehen.
//
// Reine DB-Zugriffe (supabaseAdmin) — keine Aufbereitung.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type RawRosterShift = {
  staff_id: string;
  shift_date: string;
  location_id: string;
  area: string;
  skill_id: string | null;
  service_period: string | null;
};

export type RawRosterAbsence = {
  staff_id: string;
  date: string;
  type: "urlaub" | "krank";
};

export type SkillMeta = { name: string; color: string | null };

export async function loadRosterShiftsRaw(
  admin: Admin,
  params: {
    organizationId: string;
    locationIds?: readonly string[];
    staffIds?: readonly string[];
    from: string;
    to: string;
  },
): Promise<{ ok: true; rows: RawRosterShift[] } | { ok: false }> {
  let q = admin
    .from("roster_shifts")
    .select("staff_id, shift_date, location_id, area, skill_id, service_period")
    .eq("organization_id", params.organizationId)
    .gte("shift_date", params.from)
    .lte("shift_date", params.to);
  if (params.locationIds && params.locationIds.length > 0) {
    q = q.in("location_id", params.locationIds as string[]);
  }
  if (params.staffIds && params.staffIds.length > 0) {
    q = q.in("staff_id", params.staffIds as string[]);
  }
  const { data, error } = await q;
  if (error) return { ok: false };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      staff_id: r.staff_id as string,
      shift_date: r.shift_date as string,
      location_id: r.location_id as string,
      area: r.area as string,
      skill_id: (r.skill_id as string | null) ?? null,
      service_period: (r.service_period as string | null) ?? null,
    })),
  };
}

export async function loadRosterAbsencesRaw(
  admin: Admin,
  params: {
    organizationId: string;
    staffIds?: readonly string[];
    from: string;
    to: string;
  },
): Promise<{ ok: true; rows: RawRosterAbsence[] } | { ok: false }> {
  let q = admin
    .from("roster_absence")
    .select("staff_id, date, type")
    .eq("organization_id", params.organizationId)
    .in("type", ["urlaub", "krank"])
    .gte("date", params.from)
    .lte("date", params.to);
  if (params.staffIds && params.staffIds.length > 0) {
    q = q.in("staff_id", params.staffIds as string[]);
  }
  const { data, error } = await q;
  if (error) return { ok: false };
  return {
    ok: true,
    rows: (data ?? [])
      .map((r) => ({
        staff_id: r.staff_id as string,
        date: r.date as string,
        type: r.type as string,
      }))
      .filter((r): r is RawRosterAbsence => r.type === "urlaub" || r.type === "krank"),
  };
}

export async function loadSkillsByIds(
  admin: Admin,
  skillIds: readonly string[],
): Promise<{ ok: true; byId: Map<string, SkillMeta> } | { ok: false }> {
  const byId = new Map<string, SkillMeta>();
  if (skillIds.length === 0) return { ok: true, byId };
  const { data, error } = await admin
    .from("skills")
    .select("id, name, color")
    .in("id", skillIds as string[]);
  if (error) return { ok: false };
  for (const r of data ?? []) {
    byId.set(r.id as string, {
      name: r.name as string,
      color: (r.color as string | null) ?? null,
    });
  }
  return { ok: true, byId };
}
