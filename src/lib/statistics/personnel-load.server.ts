// ST1-A — IO-Rand: Bereichs-Sätze + Attributions-Signale für die
// Personalkosten-Statistik.
//
// §104-MELDUNG: Das Lade- und Zuordnungsmuster (staff_compensation_rates,
// staff_locations, roster_shifts + GL-Skills) ist inhaltlich identisch zum
// Lohnpfad (`src/lib/lohn/lohn-period.functions.ts`, dort staff-einzeln).
// Weil die Statistik ZWEI Aufrufer hat (Statistik-Server-Fn und
// KI-Tool-Dispatcher), liegt das Muster hier einmal — mehrfach-staff-fähig.
// Der Lohnpfad wurde bewusst NICHT angefasst; ein gemeinsames Lademodul für
// beide Welten bleibt offener Kandidat (ST1-B/-C).
//
// Es wird nichts gerechnet: nur laden, mappen und je Eintrag `attributeEntry`
// (LG3b) aufrufen. Satz-Auflösung passiert in `personnel-core`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { attributeEntry } from "@/lib/lohn/entry-attribution";
import type { RateRow } from "@/lib/lohn/rate-resolution";
import { primaryDepartment, type Department } from "@/lib/time/primary-department";

export interface PersonnelAttributionContext {
  /** Bereichs-Sätze je Mitarbeiter, Cent-konvertiert (einzige Umrechnung). */
  ratesByStaff: Record<string, RateRow[]>;
  /** LG3b-Attribution eines einzelnen Zeiteintrags. */
  attribute: (args: {
    staffId: string;
    businessDate: string;
    rawDepartment: Department | null;
  }) => { department: Department; unresolved: boolean };
}

export async function loadPersonnelAttributionContext(
  admin: SupabaseClient<Database>,
  organizationId: string,
  staffIds: string[],
  fromDate: string,
  toDate: string,
): Promise<PersonnelAttributionContext> {
  const ratesByStaff: Record<string, RateRow[]> = {};
  const deptsByStaff = new Map<string, Department[]>();
  const rosterAreaByKey = new Map<string, Department>();
  const rosterGlKeys = new Set<string>();

  const empty: PersonnelAttributionContext = {
    ratesByStaff,
    attribute: ({ staffId, businessDate, rawDepartment }) => {
      const key = `${staffId}|${businessDate}`;
      return attributeEntry({
        rawDepartment,
        staffDepts: deptsByStaff.get(staffId) ?? [],
        rosterArea: rosterAreaByKey.get(key) ?? null,
        rosterHasGlSkill: rosterGlKeys.has(key),
      });
    },
  };
  if (staffIds.length === 0) return empty;

  const { data: rateRows, error: rateErr } = await admin
    .from("staff_compensation_rates")
    .select("staff_id, department, valid_from, hourly_rate")
    .in("staff_id", staffIds);
  if (rateErr) throw rateErr;
  for (const r of rateRows ?? []) {
    if (!r.staff_id || !r.department || !r.valid_from || r.hourly_rate === null) continue;
    (ratesByStaff[r.staff_id] ??= []).push({
      department: r.department as Department,
      validFrom: r.valid_from as string,
      // EUR → Cent: genau hier, einmalig (Muster wie lohn-period.functions.ts).
      hourlyRateCents: Math.round(Number(r.hourly_rate) * 100),
    });
  }

  const { data: locRows, error: locErr } = await admin
    .from("staff_locations")
    .select("staff_id, department")
    .in("staff_id", staffIds);
  if (locErr) throw locErr;
  for (const r of locRows ?? []) {
    if (!r.staff_id || !r.department) continue;
    const list = deptsByStaff.get(r.staff_id) ?? [];
    const dept = r.department as Department;
    if (!list.includes(dept)) list.push(dept);
    deptsByStaff.set(r.staff_id, list);
  }

  const glSkillIds = new Set<string>();
  const { data: glSkillRows, error: glSkillErr } = await admin
    .from("skills")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("category", "gl");
  if (glSkillErr) throw glSkillErr;
  for (const s of glSkillRows ?? []) glSkillIds.add(s.id as string);

  const { data: rosterRows, error: rosterErr } = await admin
    .from("roster_shifts")
    .select("staff_id, area, skill_id, shift_date")
    .eq("organization_id", organizationId)
    .in("staff_id", staffIds)
    .gte("shift_date", fromDate)
    .lte("shift_date", toDate);
  if (rosterErr) throw rosterErr;
  for (const r of rosterRows ?? []) {
    if (!r.staff_id || !r.shift_date) continue;
    const key = `${r.staff_id}|${r.shift_date}`;
    const area = (r.area as Department | null) ?? null;
    if (area) {
      const existing = rosterAreaByKey.get(key);
      rosterAreaByKey.set(key, existing ? primaryDepartment([existing, area]) : area);
    }
    const skillId = (r.skill_id as string | null) ?? null;
    if (skillId && glSkillIds.has(skillId)) rosterGlKeys.add(key);
  }

  return empty;
}
