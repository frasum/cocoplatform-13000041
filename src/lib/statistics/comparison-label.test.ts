import { describe, expect, it } from "vitest";

import { formatComparisonRange } from "./comparison-label";

describe("formatComparisonRange", () => {
  it("gleicher Monat: Tag–Tag.Monat.Jahr", () => {
    expect(formatComparisonRange({ startDate: "2026-06-01", endDate: "2026-06-18" })).toBe(
      "vs. 01.–18.06.2026",
    );
  });

  it("über Monatsgrenze: volles Startdatum", () => {
    expect(formatComparisonRange({ startDate: "2026-06-29", endDate: "2026-07-09" })).toBe(
      "vs. 29.06.–09.07.2026",
    );
  });

  it("Einzeltag", () => {
    expect(formatComparisonRange({ startDate: "2026-06-18", endDate: "2026-06-18" })).toBe(
      "vs. 18.06.2026",
    );
  });

  it("Jahreswechsel", () => {
    expect(formatComparisonRange({ startDate: "2025-12-20", endDate: "2026-01-05" })).toBe(
      "vs. 20.12.–05.01.2026",
    );
  });

  it("Teil-Vormonat wird als gleicher Tagesausschnitt markiert", () => {
    expect(
      formatComparisonRange({ startDate: "2026-06-01", endDate: "2026-06-18" }, { partial: true }),
    ).toBe("vs. 01.–18.06.2026 (gleicher Tagesausschnitt)");
  });

  it("ohne Vergleichsfenster: null", () => {
    expect(formatComparisonRange(null)).toBeNull();
    expect(formatComparisonRange(undefined)).toBeNull();
  });
});