// D5 — Reine, I/O-freie Aufbereitung für die mobile Tagesansicht des
// Dienstplans. Gruppiert einen Ein-Tages-Datensatz nach Standort und
// Bereich (Küche/Service), sortiert stabil und blendet leere Standorte
// aus. Wird von `RosterDayView` konsumiert; keinerlei Fetching oder
// Business-Logik über die reine Ableitung hinaus.

import type { RosterShift, RosterAbsence } from "@/lib/roster/roster.functions";
import { serviceMarker } from "@/lib/roster/service-marker";
import { absenceBlockingType } from "./absence-types";

export type DayViewEntry = {
  shiftId: string;
  staffId: string;
  staffName: string;
  skillId: string | null;
  skillName: string | null;
  skillColor: string | null;
  status: "planned" | "confirmed";
  /** Nur für Service befüllt: X / B / 19h / GL / H. */
  marker: string | null;
  absence: "U" | "K" | null;
  wish: boolean;
};

export type DayViewGroup = {
  locationId: string;
  locationName: string;
  kitchen: DayViewEntry[];
  service: DayViewEntry[];
};

export type DayViewInput = {
  date: string;
  locations: Array<{ id: string; name: string }>;
  shifts: RosterShift[];
  absences: RosterAbsence[];
  wishes: Array<{ staffId: string; wishDate: string; note: string | null }>;
};

function bucketFor(area: RosterShift["area"]): "kitchen" | "service" {
  // GL wird visuell dem Service-Bereich zugeschlagen (bestehende Konvention).
  return area === "kitchen" ? "kitchen" : "service";
}

function cmpEntry(a: DayViewEntry, b: DayViewEntry): number {
  const sa = a.skillName ?? "";
  const sb = b.skillName ?? "";
  if (sa !== sb) return sa.localeCompare(sb, "de");
  return a.staffName.localeCompare(b.staffName, "de");
}

/**
 * Baut die gruppierte Tagesansicht. Standorte ohne Einträge werden
 * ausgeblendet; die Reihenfolge folgt der Eingabe-Reihenfolge der
 * `locations` (typischerweise alphabetisch, wie von `listLocations`).
 */
export function buildDayView(input: DayViewInput): DayViewGroup[] {
  // UB1: unbezahlter Urlaub erscheint in der Tagesansicht wie Urlaub.
  const absenceMap = new Map<string, "urlaub" | "krank">();
  for (const a of input.absences) {
    if (a.date === input.date) absenceMap.set(a.staffId, absenceBlockingType(a.type));
  }
  const wishSet = new Set<string>();
  for (const w of input.wishes) {
    if (w.wishDate === input.date) wishSet.add(w.staffId);
  }

  const byLoc = new Map<string, { kitchen: DayViewEntry[]; service: DayViewEntry[] }>();
  for (const s of input.shifts) {
    if (s.shiftDate !== input.date) continue;
    const bucket = bucketFor(s.area);
    const entry: DayViewEntry = {
      shiftId: s.id,
      staffId: s.staffId,
      staffName: s.staffName,
      skillId: s.skillId,
      skillName: s.skillName,
      skillColor: s.skillColor,
      status: s.status,
      marker: bucket === "service" ? serviceMarker(s.skillName) : null,
      absence:
        absenceMap.get(s.staffId) === "urlaub"
          ? "U"
          : absenceMap.get(s.staffId) === "krank"
            ? "K"
            : null,
      wish: wishSet.has(s.staffId),
    };
    const slot = byLoc.get(s.locationId) ?? { kitchen: [], service: [] };
    slot[bucket].push(entry);
    byLoc.set(s.locationId, slot);
  }

  const out: DayViewGroup[] = [];
  for (const loc of input.locations) {
    const slot = byLoc.get(loc.id);
    if (!slot) continue;
    if (slot.kitchen.length === 0 && slot.service.length === 0) continue;
    out.push({
      locationId: loc.id,
      locationName: loc.name,
      kitchen: [...slot.kitchen].sort(cmpEntry),
      service: [...slot.service].sort(cmpEntry),
    });
  }
  return out;
}
