import { describe, expect, it } from "vitest";
import {
  buildPlanungstafelData,
  dayHeader,
  type PtAbsence,
  type PtLocation,
  type PtRelease,
  type PtShift,
  type PtStaff,
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

const FULL_RELEASES: PtRelease[] = [LOC_A, LOC_B].flatMap((l) =>
  (["kitchen", "service", "gl"] as const).map((area) => ({
    locationId: l.id,
    area,
    startDate: DAYS[0],
    endDate: DAYS[DAYS.length - 1],
  })),
);

function svc(
  staffId: string,
  shiftDate: string,
  locationId: string,
  skillName: string | null = "Service",
): PtShift {
  return { staffId, shiftDate, locationId, area: "service", skillName };
}
function kit(
  staffId: string,
  shiftDate: string,
  locationId: string,
  skillName: string | null = null,
): PtShift {
  return { staffId, shiftDate, locationId, area: "kitchen", skillName };
}

describe("buildPlanungstafelData", () => {
  it("markiert Tage ohne Release als not_released", () => {
    const releases: PtRelease[] = [
      { locationId: "loc-a", area: "kitchen", startDate: DAYS[0], endDate: DAYS[1] },
      { locationId: "loc-a", area: "service", startDate: DAYS[0], endDate: DAYS[1] },
    ];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      shifts: [],
      absences: [],
      releases,
    });
    const [block] = out;
    const gl = block.areas.find((a) => a.area === "gl")!;
    expect(gl.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
    expect(gl.cellsByDate[DAYS[2]]).toEqual({ kind: "not_released" });
    const service = block.areas.find((a) => a.area === "service")!;
    expect(service.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
    expect(service.cellsByDate[DAYS[2]]).toEqual({ kind: "not_released" });
  });

  it("setzt Cross-Standort-Punkt für Schicht am anderen Standort", () => {
    const shifts: PtShift[] = [svc("s1", DAYS[0], "loc-a"), svc("s1", DAYS[0], "loc-b")];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: LOCS,
      staff: STAFF,
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
    const shifts: PtShift[] = [svc("s1", DAYS[0], "loc-a"), kit("s1", DAYS[0], "loc-a")];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      shifts,
      absences: [],
      releases: FULL_RELEASES,
    });
    const cell = out[0].areas.find((a) => a.area === "service")!.cellsByDate[DAYS[0]];
    if (cell.kind !== "roster") throw new Error("erwartet roster");
    expect(cell.entries[0].crossLocation).toBe(false);
  });

  it("blendet abwesende MA komplett aus (kein Rendering, keine Symbole)", () => {
    // Ben hat eine Küchen-Schicht UND Urlaub am selben Tag — er darf
    // NICHT gerendert werden.
    const shifts: PtShift[] = [kit("s2", DAYS[0], "loc-a")];
    const absences: PtAbsence[] = [{ staffId: "s2", date: DAYS[0], type: "urlaub" }];
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      shifts,
      absences,
      releases: FULL_RELEASES,
    });
    const kitchen = out[0].areas.find((a) => a.area === "kitchen")!;
    expect(kitchen.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
  });

  it("leere Zelle bei Freigabe ohne Einteilung", () => {
    const out = buildPlanungstafelData({
      days: DAYS,
      locations: [LOC_A],
      staff: STAFF,
      shifts: [],
      absences: [],
      releases: FULL_RELEASES,
    });
    const service = out[0].areas.find((a) => a.area === "service")!;
    expect(service.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
  });

  it("GL-Zeile ist freigegeben, sobald mindestens ein Bereich freigegeben ist", () => {
    const releases: PtRelease[] = [
      { locationId: "loc-a", area: "service", startDate: DAYS[0], endDate: DAYS[0] },
    ];
    const out = buildPlanungstafelData({
      days: [DAYS[0]],
      locations: [LOC_A],
      staff: STAFF,
      shifts: [],
      absences: [],
      releases,
    });
    const gl = out[0].areas.find((a) => a.area === "gl")!;
    expect(gl.cellsByDate[DAYS[0]]).toEqual({ kind: "empty" });
  });

  it("GL wird über skillName='gl' erkannt und aus Service dedupliziert", () => {
    const shifts: PtShift[] = [
      svc("s1", DAYS[0], "loc-a", "Service"),
      svc("s1", DAYS[0], "loc-a", "GL"),
    ];
    const out = buildPlanungstafelData({
      days: [DAYS[0]],
      locations: [LOC_A],
      staff: STAFF,
      shifts,
      absences: [],
      releases: FULL_RELEASES,
    });
    const service = out[0].areas.find((a) => a.area === "service")!.cellsByDate[DAYS[0]];
    const gl = out[0].areas.find((a) => a.area === "gl")!.cellsByDate[DAYS[0]];
    expect(service).toEqual({ kind: "empty" });
    if (gl.kind !== "roster") throw new Error("erwartet roster");
    expect(gl.entries.map((e) => e.staffId)).toEqual(["s1"]);
  });

  it("Golden Sa 25.07. Spicery — Küche/Service/GL wie im Screenshot", () => {
    const day = "2026-07-25";
    const spicery: PtLocation = { id: "spi", name: "Spicery" };
    const staff: PtStaff[] = [
      { id: "baeng", displayName: "BÄNG" },
      { id: "eh", displayName: "EH" },
      { id: "elson", displayName: "Elson" },
      { id: "jit", displayName: "JIT" },
      { id: "nat", displayName: "NAT" },
      { id: "dereje", displayName: "DEREJE" },
      { id: "gig_k", displayName: "GIG" },
      { id: "cherry", displayName: "CHERRY" },
      { id: "gigsrv", displayName: "GIG SERVICE" },
      { id: "joy", displayName: "JOY" },
      { id: "wit", displayName: "WIT" },
      { id: "coco", displayName: "COCO" },
      { id: "lam", displayName: "LAM" },
      { id: "pon", displayName: "PON" },
      { id: "mo", displayName: "MO" },
    ];
    const shifts: PtShift[] = [
      kit("baeng", day, "spi"),
      kit("eh", day, "spi"),
      kit("elson", day, "spi"),
      kit("jit", day, "spi"),
      kit("nat", day, "spi"),
      // Abwesend, mit Schicht-Zeile: dürfen NICHT erscheinen.
      kit("dereje", day, "spi"),
      kit("gig_k", day, "spi"),
      svc("cherry", day, "spi", "Service"),
      svc("gigsrv", day, "spi", "Service"),
      svc("joy", day, "spi", "Service"),
      svc("wit", day, "spi", "Service"),
      // Abwesend im Service: dürfen NICHT erscheinen.
      svc("coco", day, "spi", "Service"),
      svc("lam", day, "spi", "Service"),
      svc("pon", day, "spi", "Service"),
      // MO trägt den GL-Skill: gehört NUR in die GL-Zeile.
      svc("mo", day, "spi", "GL"),
    ];
    const absences: PtAbsence[] = [
      { staffId: "dereje", date: day, type: "krank" },
      { staffId: "gig_k", date: day, type: "urlaub" },
      { staffId: "coco", date: day, type: "krank" },
      { staffId: "lam", date: day, type: "urlaub" },
      { staffId: "pon", date: day, type: "urlaub" },
    ];
    const releases: PtRelease[] = [
      { locationId: "spi", area: "kitchen", startDate: day, endDate: day },
      { locationId: "spi", area: "service", startDate: day, endDate: day },
    ];
    const out = buildPlanungstafelData({
      days: [day],
      locations: [spicery],
      staff,
      shifts,
      absences,
      releases,
    });
    const block = out[0];
    const kitchen = block.areas.find((a) => a.area === "kitchen")!.cellsByDate[day];
    const service = block.areas.find((a) => a.area === "service")!.cellsByDate[day];
    const gl = block.areas.find((a) => a.area === "gl")!.cellsByDate[day];
    if (kitchen.kind !== "roster" || service.kind !== "roster" || gl.kind !== "roster") {
      throw new Error("erwartet roster in allen drei Zeilen");
    }
    expect(kitchen.entries.map((e) => e.staffName)).toEqual(["BÄNG", "EH", "Elson", "JIT", "NAT"]);
    expect(service.entries.map((e) => e.staffName)).toEqual([
      "CHERRY",
      "GIG SERVICE",
      "JOY",
      "WIT",
    ]);
    expect(gl.entries.map((e) => e.staffName)).toEqual(["MO"]);
  });

  it("Tausch: Schicht liegt auf Person B — Tafel zeigt B (Paritäts-Beweis)", () => {
    // Nach einem Tausch trägt roster_shifts.staff_id die neue Person; der
    // gemeinsame Loader liefert genau diesen Stand.
    const day = DAYS[0];
    const shifts: PtShift[] = [svc("s2", day, "loc-a", "Service")];
    const out = buildPlanungstafelData({
      days: [day],
      locations: [LOC_A],
      staff: STAFF,
      shifts,
      absences: [],
      releases: FULL_RELEASES,
    });
    const service = out[0].areas.find((a) => a.area === "service")!.cellsByDate[day];
    if (service.kind !== "roster") throw new Error("erwartet roster");
    expect(service.entries.map((e) => e.staffId)).toEqual(["s2"]);
  });
});

describe("dayHeader", () => {
  it("Offset 0/1/2 → Heute/Morgen/Übermorgen, human mit Wochentag", () => {
    const today = "2026-07-25"; // Samstag
    const h0 = dayHeader(today, today);
    expect(h0.label).toBe("Heute");
    expect(h0.human).toBe("Samstag, 25. Juli");
    expect(h0.dow).toBe(6);

    const h1 = dayHeader("2026-07-26", today); // Sonntag
    expect(h1.label).toBe("Morgen");
    expect(h1.human).toBe("Sonntag, 26. Juli");
    expect(h1.dow).toBe(0);

    const h2 = dayHeader("2026-07-27", today); // Montag
    expect(h2.label).toBe("Übermorgen");
    expect(h2.human).toBe("Montag, 27. Juli");
    expect(h2.dow).toBe(1);
  });

  it("Offset 3 → Wochentagsname, human ohne Wochentag", () => {
    const h = dayHeader("2026-07-28", "2026-07-25"); // Dienstag
    expect(h.label).toBe("Dienstag");
    expect(h.human).toBe("28. Juli");
    expect(h.dow).toBe(2);
  });

  it("Offset 3 über Monatsgrenze", () => {
    const h = dayHeader("2026-08-02", "2026-07-30"); // Sonntag
    expect(h.label).toBe("Sonntag");
    expect(h.human).toBe("02. August");
    expect(h.dow).toBe(0);
  });

  it("Offset 3 über Sommerzeit-Grenze — kein Tag-Sprung", () => {
    // 2026-10-25 ist der Umstellungstag in Europa. UTC-Basis darf nichts verschieben.
    const h = dayHeader("2026-10-27", "2026-10-24");
    expect(h.label).toBe("Dienstag");
    expect(h.human).toBe("27. Oktober");
    expect(h.dow).toBe(2);
  });
});
