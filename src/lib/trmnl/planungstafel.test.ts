import { describe, expect, it } from "vitest";
import {
  buildPlanungstafelData,
  type PtAbsence,
  type PtLocation,
  type PtRelease,
  type PtShift,
  type PtStaff,
  type PtStaffLocation,
} from "./planungstafel";

const DAYS = ["2026-07-25", "2026-07-26", "2026-07-27"];

const LOC_A: PtLocation = { id: "loc-a", name: "Spicery" };
const LOC_B: PtLocation = { id: "loc-b", name: "YUM" };
const LOCS = [LOC_A, LOC_B];

const STAFF: PtStaff[] = [
  { id: "s1", displayName: "Anna" },
  { id: "s2", displayName: "Ben" },
  { id: "s3", displayName: "Cara" },
];

const SL: PtStaffLocation[] = [
  { staffId: "s1", locationId: "loc-a", department: "service" },
  { staffId: "s2", locationId: "loc-a", department: "kitchen" },
  { staffId: "s3", locationId: "loc-b", department: "service" },
];

// Voll-Freigabe für alle Bereiche beider Standorte im Fenster.
const FULL_RELEASES: PtRelease[] = [LOC_A, LOC_B].flatMap((l) =>
  (["kitchen", "service", "gl"] as const).map((area) => ({
    locationId: l.id,
    area,
    startDate: DAYS[0],
    endDate: DAYS[DAYS.length - 1],
  })),
);

describe("buildPlanungstafelData", () => {
  it("markiert Tage ohne Release als not_released", () => {
    // Nur Küche/Service bei loc-a freigegeben, GL nicht — Tag 2026-07-27
    // liegt zusätzlich außerhalb der Freigabe (endet am 26.).
    const releases: PtRelease[] = [
      { locationId: "loc-a", area: "kitchen", startDate: DAYS[0], endDate: DAYS[1] },
      { locationId: "loc-a", area: "service", startDate: DAYS[0], endDate: DAYS[1] },
    ];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      staffLocations: SL,
      shifts: [],
      absences: [],
      releases,
    });
    const [block] = out;
    const gl = block.areas.find((a) => a.area === "gl")!;
    expect(gl.cellsByDate[DAYS[0]]).toEqual({ kind: "not_released" });
    const service = block.areas.find((a) => a.area === "service")!;
    expect(service.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
    expect(service.cellsByDate[DAYS[2]]).toEqual({ kind: "not_released" });
  });

  it("setzt Cross-Standort-Punkt für Schicht am anderen Standort", () => {
    const shifts: PtShift[] = [
      { staffId: "s1", shiftDate: DAYS[0], locationId: "loc-a", area: "service" },
      // Anna ist am selben Tag auch bei loc-b im Service.
      { staffId: "s1", shiftDate: DAYS[0], locationId: "loc-b", area: "service" },
    ];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: LOCS,
      staff: STAFF,
      staffLocations: SL,
      shifts,
      absences: [],
      releases: FULL_RELEASES,
    });
    const aServ = out[0].areas.find((a) => a.area === "service")!;
    const bServ = out[1].areas.find((a) => a.area === "service")!;
    const cellA = aServ.cellsByDate[DAYS[0]];
    const cellB = bServ.cellsByDate[DAYS[0]];
    if (cellA.kind !== "roster" || cellB.kind !== "roster") throw new Error("erwartet roster");
    expect(cellA.entries[0].crossLocation).toBe(true);
    expect(cellB.entries[0].crossLocation).toBe(true);
  });

  it("kein Cross-Punkt bei Schicht nur am eigenen Standort", () => {
    const shifts: PtShift[] = [
      { staffId: "s1", shiftDate: DAYS[0], locationId: "loc-a", area: "service" },
      // Zweite Schicht am gleichen Standort, anderer Bereich → kein Cross.
      { staffId: "s1", shiftDate: DAYS[0], locationId: "loc-a", area: "gl" },
    ];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      staffLocations: SL,
      shifts,
      absences: [],
      releases: FULL_RELEASES,
    });
    const cell = out[0].areas.find((a) => a.area === "service")!.cellsByDate[DAYS[0]];
    if (cell.kind !== "roster") throw new Error("erwartet roster");
    expect(cell.entries[0].crossLocation).toBe(false);
  });

  it("nimmt abwesende MA in den eigenen Bereich auf", () => {
    const absences: PtAbsence[] = [{ staffId: "s2", date: DAYS[0], type: "urlaub" }];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      staffLocations: SL,
      shifts: [],
      absences,
      releases: FULL_RELEASES,
    });
    const kitchen = out[0].areas.find((a) => a.area === "kitchen")!;
    const cell = kitchen.cellsByDate[DAYS[0]];
    if (cell.kind !== "roster") throw new Error("erwartet roster");
    expect(cell.entries).toHaveLength(1);
    expect(cell.entries[0]).toMatchObject({ staffName: "Ben", absent: "urlaub" });
  });

  it("leere Zelle bei Freigabe ohne Einteilung/Abwesenheit", () => {
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      staffLocations: SL,
      shifts: [],
      absences: [],
      releases: FULL_RELEASES,
    });
    const service = out[0].areas.find((a) => a.area === "service")!;
    expect(service.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
  });
});
