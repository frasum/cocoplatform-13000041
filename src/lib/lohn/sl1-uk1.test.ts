// SL1/UK1 — Regeltests für Slot-Blocker und den U/K-Vertragssatz-Fallback.
import { describe, expect, it } from "vitest";
import { computeExportBlockers } from "./export-blockers";
import { buildUrlaubKrankZeilen } from "./urlaub-krank-zeilen";
import { resolveEdlohnSlots } from "./edlohn-slots";

describe("SL1 — Slot-Blocker (K1)", () => {
  const base = {
    staffId: "s1",
    staffLabel: "LAM",
    persoNr: "12",
    unresolvedHoursUnrounded: 0,
  };

  it("blockiert je unzugeordnetem Bereich, wenn Sätze verschieden sind", () => {
    const slots = resolveEdlohnSlots(
      [
        { department: "gl", paidHoursUnrounded: 54, rateCents: 2200 },
        { department: "service", paidHoursUnrounded: 18.75, rateCents: 1600 },
      ],
      [],
    );
    expect(slots.mappingMissing).toBe(true);
    const blockers = computeExportBlockers([
      {
        ...base,
        buckets: [
          { department: "gl", paidHoursUnrounded: 54, rateCents: 2200 },
          { department: "service", paidHoursUnrounded: 18.75, rateCents: 1600 },
        ],
        unmappedSlotDepartments: slots.unmappedDepartments,
      },
    ]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reasons.filter((r) => r.reason === "missing_slot_mapping")).toHaveLength(2);
  });

  it("blockiert NICHT, wenn alle Bereiche denselben Satz tragen (GERARD-Fall)", () => {
    const slots = resolveEdlohnSlots(
      [
        { department: "gl", paidHoursUnrounded: 8, rateCents: 2300 },
        { department: "kitchen", paidHoursUnrounded: 8, rateCents: 2300 },
        { department: "service", paidHoursUnrounded: 8, rateCents: 2300 },
      ],
      [],
    );
    expect(slots.mappingMissing).toBe(false);
    expect(new Set(slots.slots.values())).toEqual(new Set([1]));
    const blockers = computeExportBlockers([
      {
        ...base,
        buckets: [
          { department: "gl", paidHoursUnrounded: 8, rateCents: 2300 },
          { department: "kitchen", paidHoursUnrounded: 8, rateCents: 2300 },
          { department: "service", paidHoursUnrounded: 8, rateCents: 2300 },
        ],
        unmappedSlotDepartments: slots.mappingMissing ? slots.unmappedDepartments : [],
      },
    ]);
    expect(blockers).toHaveLength(0);
  });

  it("blockiert NICHT bei vollständigem Mapping trotz verschiedener Sätze", () => {
    const slots = resolveEdlohnSlots(
      [
        { department: "gl", paidHoursUnrounded: 54, rateCents: 2200 },
        { department: "service", paidHoursUnrounded: 18.75, rateCents: 1600 },
      ],
      [
        { department: "gl", slot: 2 },
        { department: "service", slot: 1 },
      ],
    );
    expect(slots.mappingMissing).toBe(false);
    expect(slots.slots.get("gl")).toBe(2);
    expect(slots.slots.get("service")).toBe(1);
  });
});

describe("UK1/K2 — no_hours-Fallback ohne 3M-Basis", () => {
  it("erzeugt nur Basis-Zeilen mit Label-Zusatz, keine Zuschlagszeilen", () => {
    const zeilen = buildUrlaubKrankZeilen({
      urlaubTage: 2,
      krankTage: 1,
      sollHoursPerDay: 8,
      hourlyRateCents: 1600,
      sfnTagCent: 4200,
      ohneDreiMonatsBasis: true,
    });
    expect(zeilen.map((z) => z.bezeichnung)).toEqual([
      "Urlaubsstunden (ohne 3M-Basis)",
      "Lohnfortzahlung Krankheit (ohne 3M-Basis)",
    ]);
    expect(zeilen[0].betragCent).toBe(2 * 8 * 1600);
    expect(zeilen[1].betragCent).toBe(8 * 1600);
  });

  it("mit 3M-Basis bleiben Zuschlagszeilen und Labels unverändert", () => {
    const zeilen = buildUrlaubKrankZeilen({
      urlaubTage: 2,
      krankTage: 1,
      sollHoursPerDay: 8,
      hourlyRateCents: 1600,
      sfnTagCent: 4200,
    });
    expect(zeilen.map((z) => z.bezeichnung)).toEqual([
      "Urlaubsstunden",
      "Zuschlag Urlaubsentgelt (3M-Ø)",
      "Lohnfortzahlung Krankheit",
      "Zuschlag Krank (3M-Ø)",
    ]);
  });
});
