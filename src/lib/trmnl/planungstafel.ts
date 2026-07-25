// EP1b — Reine Aufbereitung der GL-Planungstafel für TRMNL X.
// Zeilen: Standort → Bereich (Küche/Service/GL). Spalten: Kalendertage.
// Nur ARBEITENDE werden gerendert — Urlauber/Kranke erscheinen NICHT
// (Design Frank 25.07., ersetzt Dossier-Q3b-Teilregel). Abwesenheiten
// werden hier ausschließlich als Filter genutzt, um Personen mit Urlaub/
// krank an einem Tag NICHT anzuzeigen, falls trotzdem eine Schicht-Zeile
// im Rohbestand liegt.
//
// GL-Zuordnung strikt über die Schicht selbst: eine Schicht ist eine
// GL-Schicht, wenn `skillName` (case-insensitive) === "gl" — nicht über
// staff_locations, nicht über area='gl' (WZ2: der Skill trägt den Typ).
// GL-Personen erscheinen NUR in der GL-Zeile, nicht doppelt im Herkunfts-
// bereich.
//
// Nicht freigegebene (location, area, date) werden als `not_released`
// markiert. GL-Zeile gilt als freigegeben, sobald mindestens ein Bereich
// (Küche oder Service) für den Standort am Tag freigegeben ist.
//
// Alle Eingaben sind flach — kein DB-, Netz- oder Zeit-Zugriff. Die Route
// bereitet die Daten via supabaseAdmin (gemeinsamer Loader, s.
// display/roster-window.server.ts) auf und ruft diese Funktion.

export type PtArea = "kitchen" | "service" | "gl";

export type PtShift = {
  staffId: string;
  shiftDate: string;
  locationId: string;
  // Bereich der Schicht laut roster_shifts (nur kitchen/service — GL wird
  // über `skillName` erkannt, nicht über die Bereichs-Spalte).
  area: "kitchen" | "service";
  skillName: string | null;
};

export type PtAbsenceType = "urlaub" | "krank";

export type PtAbsence = {
  staffId: string;
  date: string;
  type: PtAbsenceType;
};

export type PtRelease = {
  locationId: string;
  area: PtArea;
  startDate: string;
  endDate: string;
};

export type PtStaff = { id: string; displayName: string };
export type PtLocation = { id: string; name: string };

export type PtEntry = {
  staffId: string;
  staffName: string;
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

function isGlSkill(skillName: string | null | undefined): boolean {
  return !!skillName && skillName.trim().toLowerCase() === "gl";
}

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

function isAnyReleased(releases: readonly PtRelease[], locationId: string, date: string): boolean {
  for (const r of releases) {
    if (
      r.locationId === locationId &&
      (r.area === "kitchen" || r.area === "service") &&
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
  shifts: readonly PtShift[];
  absences: readonly PtAbsence[];
  releases: readonly PtRelease[];
}): PtLocationBlock[] {
  const nameById = new Map<string, string>();
  for (const s of input.staff) nameById.set(s.id, s.displayName);

  // Abwesenheiten: Set von "staffId|date" — reines Filter-Signal.
  const absentKey = new Set<string>();
  for (const a of input.absences) absentKey.add(`${a.staffId}|${a.date}`);

  // Für Cross-Location-Flag: alle Location-IDs je (staff, date). Abwesende
  // Tage zählen dafür nicht mit (sie erscheinen nirgends).
  const locsByStaffDate = new Map<string, Set<string>>();
  for (const s of input.shifts) {
    if (absentKey.has(`${s.staffId}|${s.shiftDate}`)) continue;
    const key = `${s.staffId}|${s.shiftDate}`;
    const set = locsByStaffDate.get(key) ?? new Set<string>();
    set.add(s.locationId);
    locsByStaffDate.set(key, set);
  }

  // Schichten je (locationId|area|date) → staffIds — pro Zielbereich
  // (kitchen, service, gl). GL wird strikt über die Schicht-Zeile selbst
  // erkannt (skillName='gl'), nicht über die area-Spalte. Absente Personen
  // werden hier gefiltert.
  const shiftsByCell = new Map<string, Set<string>>();
  for (const s of input.shifts) {
    if (absentKey.has(`${s.staffId}|${s.shiftDate}`)) continue;
    const targetArea: PtArea = isGlSkill(s.skillName) ? "gl" : s.area;
    const key = `${s.locationId}|${targetArea}|${s.shiftDate}`;
    const set = shiftsByCell.get(key) ?? new Set<string>();
    set.add(s.staffId);
    shiftsByCell.set(key, set);
  }

  function makeEntry(staffId: string, date: string, locationId: string): PtEntry {
    const locs = locsByStaffDate.get(`${staffId}|${date}`);
    const crossLocation = !!locs && (locs.size > 1 || !locs.has(locationId));
    return {
      staffId,
      staffName: nameById.get(staffId) ?? "—",
      crossLocation,
    };
  }

  const out: PtLocationBlock[] = [];
  for (const loc of input.locations) {
    const areas: PtAreaRow[] = [];
    for (const { area, label } of PT_AREAS) {
      const cellsByDate: Record<string, PtCell> = {};
      for (const date of input.days) {
        const released =
          area === "gl"
            ? isAnyReleased(input.releases, loc.id, date)
            : isReleased(input.releases, loc.id, area, date);
        if (!released) {
          cellsByDate[date] = { kind: "not_released" };
          continue;
        }
        let entryIds = shiftsByCell.get(`${loc.id}|${area}|${date}`) ?? new Set<string>();
        // Dedup: wer in der GL-Zeile am (Standort, Tag) erscheint, wird
        // NICHT zusätzlich in Küche/Service gelistet.
        if (area !== "gl") {
          const glIds = shiftsByCell.get(`${loc.id}|gl|${date}`);
          if (glIds && glIds.size > 0) {
            const filtered = new Set<string>();
            for (const id of entryIds) if (!glIds.has(id)) filtered.add(id);
            entryIds = filtered;
          }
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
