import { describe, it, expect } from "vitest";
import { isValidFromAllowed, periodStart } from "./valid-from-guard";

describe("isValidFromAllowed (LG-12)", () => {
  it("Datum in laufender Periode ist erlaubt", () => {
    // Heute 2026-07-16 → Periode 2026-06-26 .. 2026-07-25
    expect(isValidFromAllowed("2026-06-26", "2026-07-16")).toBe(true);
    expect(isValidFromAllowed("2026-07-16", "2026-07-16")).toBe(true);
    expect(isValidFromAllowed("2026-07-25", "2026-07-16")).toBe(true);
  });
  it("Datum vor Periodenstart ist gesperrt", () => {
    expect(isValidFromAllowed("2026-06-25", "2026-07-16")).toBe(false);
    expect(isValidFromAllowed("2020-01-01", "2026-07-16")).toBe(false);
  });
  it("Datum in Zukunft (nach heute, aber vor Periodenende) ist erlaubt", () => {
    expect(isValidFromAllowed("2026-07-25", "2026-07-16")).toBe(true);
  });
  it("Periodenwechsel bei Tag > 25", () => {
    // Heute 2026-07-26 → Periode 2026-07-26 .. 2026-08-25
    expect(periodStart("2026-07-26")).toBe("2026-07-26");
    expect(isValidFromAllowed("2026-07-25", "2026-07-26")).toBe(false);
    expect(isValidFromAllowed("2026-07-26", "2026-07-26")).toBe(true);
  });
});
