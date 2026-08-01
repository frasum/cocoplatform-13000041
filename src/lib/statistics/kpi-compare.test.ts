import { describe, expect, it } from "vitest";
import { compareKpi } from "./kpi-compare";

describe("compareKpi (STAT2b)", () => {
  it("Normalfall: Werte durchgereicht, Differenzen mit Vorzeichen", () => {
    expect(compareKpi(2_500, 2_000)).toEqual({
      aValue: 2_500,
      bValue: 2_000,
      aDiffPct: 25,
      bDiffPct: -20,
    });
  });

  it("ein Nenner 0 (Wert null) ⇒ keine Differenz, Wert bleibt null", () => {
    expect(compareKpi(null, 2_000)).toEqual({
      aValue: null,
      bValue: 2_000,
      aDiffPct: null,
      bDiffPct: null,
    });
    expect(compareKpi(2_000, null)).toEqual({
      aValue: 2_000,
      bValue: null,
      aDiffPct: null,
      bDiffPct: null,
    });
  });

  it("beide null ⇒ zweimal Gedankenstrich (alles null)", () => {
    expect(compareKpi(null, null)).toEqual({
      aValue: null,
      bValue: null,
      aDiffPct: null,
      bDiffPct: null,
    });
  });

  it("B = 0 ⇒ kein definierter Prozentwert (kein Infinity)", () => {
    const r = compareKpi(1_000, 0);
    expect(r.aDiffPct).toBeNull();
    expect(r.bDiffPct).toBe(-100);
  });
});
