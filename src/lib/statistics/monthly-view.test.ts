// MB2 — Tests für den Ansichts-Umschalter „Gesamt | Takeaway".
import { describe, expect, it } from "vitest";
import { toYearRows, type MonthlyCell } from "./monthly-core";
import {
  cellValueCents,
  projectCells,
  viewHeadline,
  viewMaxCents,
  viewYearRows,
} from "./monthly-view";

function cell(
  year: number,
  month: number,
  totalCents: number,
  takeawayCents: number | null,
  partial = false,
): MonthlyCell {
  return { year, month, totalCents, takeawayCents, source: "legacy", partial };
}

describe("cellValueCents", () => {
  const c = cell(2025, 3, 300_000, 40_000);
  it("liest Gesamt bzw. Takeaway", () => {
    expect(cellValueCents(c, "total")).toBe(300_000);
    expect(cellValueCents(c, "takeaway")).toBe(40_000);
  });
  it("null-Zelle und fehlender Takeaway-Wert bleiben null", () => {
    expect(cellValueCents(null, "total")).toBeNull();
    expect(cellValueCents(null, "takeaway")).toBeNull();
    expect(cellValueCents(cell(2019, 5, 200_000, null), "takeaway")).toBeNull();
    expect(cellValueCents(cell(2019, 5, 200_000, null), "total")).toBe(200_000);
  });
});

describe("viewYearRows im Takeaway-Modus", () => {
  const cells = [
    cell(2019, 1, 100_000, null),
    cell(2019, 2, 110_000, null),
    cell(2021, 1, 120_000, 20_000),
    cell(2021, 5, 130_000, 30_000),
  ];
  const years = toYearRows(cells);

  it("Jahr komplett ohne Takeaway fällt weg, Teiljahr behält nur vorhandene Monate", () => {
    const rows = viewYearRows(years, "takeaway");
    expect(rows.map((r) => r.year)).toEqual([2021]);
    const row = rows[0]!;
    expect(row.values[0]).toBe(20_000);
    expect(row.values[1]).toBeNull();
    expect(row.values[4]).toBe(30_000);
    expect(row.totalCents).toBe(50_000);
  });

  it("Gesamt-Modus behält alle Jahre und Summen", () => {
    const rows = viewYearRows(years, "total");
    expect(rows.map((r) => r.year)).toEqual([2019, 2021]);
    expect(rows[0]!.totalCents).toBe(210_000);
    expect(rows[1]!.totalCents).toBe(250_000);
  });

  it("Maximum ist ansichtsbezogen", () => {
    expect(viewMaxCents(viewYearRows(years, "total"))).toBe(130_000);
    expect(viewMaxCents(viewYearRows(years, "takeaway"))).toBe(30_000);
  });
});

describe("viewHeadline", () => {
  const cells = [
    cell(2025, 6, 300_000, null),
    cell(2026, 5, 280_000, 40_000),
    cell(2026, 6, 320_000, 50_000),
  ];

  it("Takeaway-Modus: Vorjahresmonat ohne TA-Wert ⇒ kein YoY", () => {
    const h = viewHeadline(cells, 2026, 6, "takeaway");
    expect(h.currentCents).toBe(50_000);
    expect(h.previousYearCents).toBeNull();
    expect(h.yoyPct).toBeNull();
    expect(h.ytdCents).toBe(90_000);
  });

  it("Gesamt-Modus rechnet unverändert mit den Gesamtwerten", () => {
    const h = viewHeadline(cells, 2026, 6, "total");
    expect(h.currentCents).toBe(320_000);
    expect(h.previousYearCents).toBe(300_000);
    expect(h.yoyPct).toBeCloseTo(6.6667, 3);
  });

  it("projectCells lässt den Gesamt-Modus unverändert", () => {
    expect(projectCells(cells, "total")).toEqual(cells);
  });
});
