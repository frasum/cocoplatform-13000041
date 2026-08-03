import { describe, expect, it } from "vitest";
import { isNotInPlan, isUntouched, plannedKey, removalBlockedReason } from "./not-in-plan";

describe("isNotInPlan", () => {
  const planned = new Set([plannedKey("s1", "2026-08-03")]);

  it("markiert Einträge ohne geplante Schicht", () => {
    expect(isNotInPlan({ staffId: "s1", businessDate: "2026-08-04" }, planned)).toBe(true);
    expect(isNotInPlan({ staffId: "s2", businessDate: "2026-08-03" }, planned)).toBe(true);
  });

  it("markiert geplante Einträge nicht", () => {
    expect(isNotInPlan({ staffId: "s1", businessDate: "2026-08-03" }, planned)).toBe(false);
  });
});

const base = {
  hasClockEntry: false,
  hasSettlement: false,
  note: null,
  participatesOverride: null,
};

describe("isUntouched", () => {
  it("reiner Plan-Snapshot ist unberührt", () => {
    expect(isUntouched(base)).toBe(true);
  });

  it("jede Spur macht ihn berührt", () => {
    expect(isUntouched({ ...base, hasClockEntry: true })).toBe(false);
    expect(isUntouched({ ...base, hasSettlement: true })).toBe(false);
    expect(isUntouched({ ...base, note: "Sonderfall" })).toBe(false);
    expect(isUntouched({ ...base, participatesOverride: false })).toBe(false);
  });

  it("leere Notiz zählt nicht als Spur", () => {
    expect(isUntouched({ ...base, note: "   " })).toBe(true);
  });
});

describe("removalBlockedReason", () => {
  it("null bei unberührtem Eintrag", () => {
    expect(removalBlockedReason(base)).toBeNull();
  });

  it("nennt den Grund", () => {
    expect(removalBlockedReason({ ...base, hasClockEntry: true })).toContain("Ist-Zeit");
    expect(removalBlockedReason({ ...base, hasSettlement: true })).toContain("Abrechnung");
    expect(removalBlockedReason({ ...base, note: "x" })).toContain("Notiz");
    expect(removalBlockedReason({ ...base, participatesOverride: true })).toContain("übersteuert");
  });
});
