// EP1a — Reine Aufbereitung der GL-Planungstafel für TRMNL X.
// Zeilen: Standort → Bereich (Küche/Service/GL). Spalten: Kalendertage.
// Zellen: Liste der eingeteilten Anzeigenamen mit Cross-Standort-Punkt
// und Abwesenheits-Overlay; nicht freigegebene (location, area, date)
// werden explizit als `not_released` markiert. Keine Uhrzeiten
// (Entscheidung Frank 25.07.).
//
// Alle Eingaben sind flach — kein DB-, Netz- oder Zeit-Zugriff. Die Route
// bereitet die Daten via supabaseAdmin auf und ruft diese Funktion.

import type { StaffDepartment } from "@/lib/staff-domain";

export type PtArea = "kitchen" | "service" | "gl";
export type PtAbsenceType = "urlaub" | "krank";

export type PtShift = {
  staffId: string;
  shiftDate: string;
  locationId: string;
  area: PtArea;
};

export type PtAbsence = {
  staffId: string;
  date: string;
  type: PtAbsenceType;
};

// Ein Release-Fenster: Für dieses (Standort, Bereich) ist der Zeitraum
// [startDate, endDate] freigegeben. Aus roster_releases × periods gejoint.
export type PtRelease = {
  locationId: string;
  area: PtArea;
  startDate: string;
  endDate: string;
};

export type PtStaff = { id: string; displayName: string };
export type PtLocation = { id: string; name: string };

// Zuordnung MA → Standort/Bereich (aus staff_locations). Wird gebraucht,
// damit abwesende MA ohne Schicht im richtigen Bereich gelistet werden.
export type PtStaffLocation = {
  staffId: string;
  locationId: string;
  department: StaffDepartment;
};

export type PtEntry = {
  staffId: string;
  staffName: string;
  absent: PtAbsenceType | null;
  crossLocation: boolean;
};

export type PtCell =
  | { kind: "not_released" }
  | { kind: "empty" }
  | { kind: "roster"; entries: PtEntry[] };

export type PtAreaRow = {
  area: PtArea;
  label: string;
  cellsByDate: Record<string, PtCell>;
};

export type PtLocationBlock = {
  locationId: string;
  locationName: string;
  areas: PtAreaRow[];
};

export const PT_AREAS: ReadonlyArray<{ area: PtArea; label: string }> = [
  { area: "kitchen", label: "Küche" },
  { area: "service", label: "Service" },
  { area: "gl", label: "GL" },
];

function isReleased(
  releases: readonly PtRelease[],
  locationId: string,
  area: PtArea,
  date: string,
): boolean {
  for (const r of releases) {
    if (
      r.locationId === locationId &&
      r.area === area &&
      r.startDate <= date &&
      date <= r.endDate
    ) {
      return true;
    }
  }
  return false;
}

export function buildPlanungstafelData(input: {
  days: readonly string[];
  locations: readonly PtLocation[];
  staff: readonly PtStaff[];
  staffLocations: readonly PtStaffLocation[];
  shifts: readonly PtShift[];
  absences: readonly PtAbsence[];
  releases: readonly PtRelease[];
}): PtLocationBlock[] {
  const nameById = new Map<string, string>();
  for (const s of input.staff) nameById.set(s.id, s.displayName);

  // Abwesenheiten schnell nachschlagbar.
  const absenceByKey = new Map<string, PtAbsenceType>();
  for (const a of input.absences) absenceByKey.set(`${a.staffId}|${a.date}`, a.type);

  // Für Cross-Location-Flag: alle Location-IDs je (staff, date).
  const locsByStaffDate = new Map<string, Set<string>>();
  for (const s of input.shifts) {
    const key = `${s.staffId}|${s.shiftDate}`;
    const set = locsByStaffDate.get(key) ?? new Set<string>();
    set.add(s.locationId);
    locsByStaffDate.set(key, set);
  }

  // Schichten je (locationId|area|date) → staffIds.
  const shiftsByCell = new Map<string, Set<string>>();
  for (const s of input.shifts) {
    const key = `${s.locationId}|${s.area}|${s.shiftDate}`;
    const set = shiftsByCell.get(key) ?? new Set<string>();
    set.add(s.staffId);
    shiftsByCell.set(key, set);
  }

  // Zuordnung Location → Area → StaffIds (aus staff_locations),
  // damit abwesende MA in der richtigen Zeile erscheinen.
  const staffByLocArea = new Map<string, Set<string>>();
  for (const sl of input.staffLocations) {
    const area: PtArea = sl.department;
    const key = `${sl.locationId}|${area}`;
    const set = staffByLocArea.get(key) ?? new Set<string>();
    set.add(sl.staffId);
    staffByLocArea.set(key, set);
  }

  function makeEntry(staffId: string, date: string, locationId: string): PtEntry {
    const locs = locsByStaffDate.get(`${staffId}|${date}`);
    const crossLocation = !!locs && (locs.size > 1 || !locs.has(locationId));
    return {
      staffId,
      staffName: nameById.get(staffId) ?? "—",
      absent: absenceByKey.get(`${staffId}|${date}`) ?? null,
      crossLocation,
    };
  }

  const out: PtLocationBlock[] = [];
  for (const loc of input.locations) {
    const areas: PtAreaRow[] = [];
    for (const { area, label } of PT_AREAS) {
      const cellsByDate: Record<string, PtCell> = {};
      for (const date of input.days) {
        if (!isReleased(input.releases, loc.id, area, date)) {
          cellsByDate[date] = { kind: "not_released" };
          continue;
        }
        const scheduledIds = shiftsByCell.get(`${loc.id}|${area}|${date}`) ?? new Set<string>();
        const areaStaff = staffByLocArea.get(`${loc.id}|${area}`) ?? new Set<string>();

        const entryIds = new Set<string>(scheduledIds);
        // Abwesende (Urlaub/krank) mit passendem Bereich am Standort dazu.
        for (const staffId of areaStaff) {
          if (absenceByKey.has(`${staffId}|${date}`)) entryIds.add(staffId);
        }

        if (entryIds.size === 0) {
          cellsByDate[date] = { kind: "empty" };
          continue;
        }

        const entries = Array.from(entryIds)
          .map((id) => makeEntry(id, date, loc.id))
          .sort((a, b) => a.staffName.localeCompare(b.staffName, "de"));
        cellsByDate[date] = { kind: "roster", entries };
      }
      areas.push({ area, label, cellsByDate });
    }
    out.push({ locationId: loc.id, locationName: loc.name, areas });
  }
  return out;
}