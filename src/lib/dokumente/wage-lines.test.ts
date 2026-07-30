import { describe, expect, it } from "vitest";
import type { RateRow } from "@/lib/lohn/rate-resolution";
import { formatWageLines, resolveWageLines } from "./wage-lines";

const r = (department: RateRow["department"], validFrom: string, cents: number): RateRow => ({
  department,
  validFrom,
  hourlyRateCents: cents,
});

describe("wage-lines", () => {
  it("ohne Sätze: leer und null", () => {
    expect(resolveWageLines([], "2026-07-30")).toEqual([]);
    expect(formatWageLines([])).toBeNull();
  });

  it("ein Bereich: nur Betrag, kein Präfix", () => {
    const lines = resolveWageLines([r("service", "2026-01-01", 1450)], "2026-07-30");
    expect(formatWageLines(lines)).toBe("14,50 €/h");
  });

  it("zwei/drei Bereiche: Präfix und feste Reihenfolge", () => {
    const lines = resolveWageLines(
      [r("gl", "2026-01-01", 2200), r("kitchen", "2026-01-01", 1500), r("service", "2026-01-01", 1450)],
      "2026-07-30",
    );
    expect(lines.map((l) => l.department)).toEqual(["service", "kitchen", "gl"]);
    expect(formatWageLines(lines)).toBe(
      "je nach Einsatzbereich: Service 14,50 €/h · Küche 15,00 €/h · Geschäftsleitung 22,00 €/h",
    );
  });

  it("valid_from-Historie: jüngste Zeile <= Stichtag gewinnt, Zukunft wirkt nicht", () => {
    const lines = resolveWageLines(
      [r("service", "2026-01-01", 1400), r("service", "2026-06-01", 1450), r("service", "2026-09-01", 1600)],
      "2026-07-30",
    );
    expect(formatWageLines(lines)).toBe("14,50 €/h");
  });

  it("Bereich mit nur zukünftiger Zeile erscheint nicht", () => {
    const lines = resolveWageLines(
      [r("service", "2026-01-01", 1450), r("kitchen", "2026-09-01", 1500)],
      "2026-07-30",
    );
    expect(lines.map((l) => l.department)).toEqual(["service"]);
    expect(formatWageLines(lines)).toBe("14,50 €/h");
  });

  it("Cent-Formatierung deutsch", () => {
    expect(formatWageLines(resolveWageLines([r("service", "2020-01-01", 1450)], "2026-07-30"))).toBe(
      "14,50 €/h",
    );
    expect(formatWageLines(resolveWageLines([r("gl", "2020-01-01", 2200)], "2026-07-30"))).toBe(
      "22,00 €/h",
    );
  });
});
