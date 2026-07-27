import { describe, expect, it } from "vitest";
import { paidHours, paidMinutes } from "./paid-hours";

describe("paidHours", () => {
  it("Pausen bezahlt = true → brutto (unabhängig von Pausenminuten)", () => {
    expect(paidHours(8, 30, true)).toBe(8);
    expect(paidHours(0, 30, true)).toBe(0);
  });
  it("Pausen bezahlt = false → brutto − Pausen (Stunden)", () => {
    expect(paidHours(8, 30, false)).toBe(7.5);
    expect(paidHours(8, 0, false)).toBe(8);
  });
  it("Pausen bezahlt = false + Pause > Brutto → auf 0 gekappt", () => {
    expect(paidHours(0.2, 60, false)).toBe(0);
  });
  it("Bestandsverhalten: break=0 identisch für beide Schalter", () => {
    expect(paidHours(7.5, 0, true)).toBe(paidHours(7.5, 0, false));
  });
});

describe("paidMinutes", () => {
  it("brutto vs. netto", () => {
    expect(paidMinutes(480, 30, true)).toBe(480);
    expect(paidMinutes(480, 30, false)).toBe(450);
  });
  it("kappt negativ auf 0", () => {
    expect(paidMinutes(20, 30, false)).toBe(0);
  });
});
