// STAT3f — blockierende Tests der Kumulation: Handrechnung, MB3-Klemmung,
// Lückenregel (Variante B) und der Randfall „Januar läuft".

import { describe, expect, it } from "vitest";
import { ytdByYear, type YtdSeriesInput } from "./ytd-compare";
import type { MonthlyCell } from "./monthly-core";

function cells(year: number, months: number, cents: number, partial = false): MonthlyCell[] {
  return Array.from({ length: months }, (_, i) => ({
    year,
    month: i + 1,
    totalCents: cents * (i + 1),
    takeawayCents: null,
    source: "legacy" as const,
    partial: partial && i + 1 === months,
  }));
}

const spicery: YtdSeriesInput = {
  name: "spicery",
  cells: [
    ...cells(2025, 12, 100),
    ...cells(2026, 8, 200),
  ],
};

describe("ytdByYear", () => {
  it("kumuliert Jan–Jul gegen die Handrechnung", () => {
    const r = ytdByYear([spicery], 2026, 7, "2026-09", 2);
    expect(r.throughMonth).toBe(7);
    expect(r.years).toEqual([2025, 2026]);
    // 100*(1+..+7) = 2800 ; 200*(28) = 5600
    expect(r.series[0]!.values).toEqual([2_800, 5_600]);
    expect(r.incompleteYears).toEqual([]);
  });

  it("laufender Fokusmonat klemmt ALLE Jahre auf M−1", () => {
    const r = ytdByYear([spicery], 2026, 8, "2026-08", 2);
    expect(r.throughMonth).toBe(7);
    expect(r.series[0]!.values).toEqual([2_800, 5_600]);
  });

  it("abgeschlossener Fokusmonat nutzt das volle Fenster", () => {
    const r = ytdByYear([spicery], 2026, 8, "2026-09", 2);
    expect(r.throughMonth).toBe(8);
    expect(r.series[0]!.values).toEqual([100 * 36, 200 * 36]);
  });

  it("fehlender Monat im Fenster ⇒ null statt Teilsumme", () => {
    const luecke: YtdSeriesInput = { name: "YUM", cells: cells(2024, 3, 100) };
    const r = ytdByYear([spicery, luecke], 2026, 7, "2026-09", 3);
    expect(r.years).toEqual([2024, 2025, 2026]);
    expect(r.series[0]!.values[0]).toBeNull();
    expect(r.series[1]!.values).toEqual([null, null, null]);
    expect(r.incompleteYears).toEqual([2024, 2025, 2026]);
  });

  it("Januar läuft ⇒ leeres Fenster, Grafik entfällt", () => {
    const r = ytdByYear([spicery], 2026, 1, "2026-01");
    expect(r).toEqual({ throughMonth: 0, years: [], series: [], incompleteYears: [] });
  });

  it("Standardfenster umfasst fünf Jahre", () => {
    const r = ytdByYear([spicery], 2026, 7);
    expect(r.years).toEqual([2022, 2023, 2024, 2025, 2026]);
  });
});
