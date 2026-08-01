// STAT3 — blockierende Tests der Chart-Geometrie: Skalierung, Leerfälle,
// Monatsbreiten (28/30/31 Tage) und das 13-Monats-Fenster über den
// Jahreswechsel. Geometrie ist rein — hier wird nichts gezeichnet.

import { describe, expect, it } from "vitest";
import {
  barChartGeometry,
  formatTsd,
  lineChartGeometry,
  monthWindow,
  type ChartArea,
} from "./statistik-pdf-charts";

const area: ChartArea = { x: 40, y: 100, width: 300, height: 60 };

describe("barChartGeometry", () => {
  it("skaliert den Maximalwert auf die volle Höhe, andere linear", () => {
    const g = barChartGeometry([100, 50, 0], area);
    expect(g.max).toBe(100);
    expect(g.bars[0]!.height).toBeCloseTo(60, 6);
    expect(g.bars[0]!.y).toBeCloseTo(area.y, 6);
    expect(g.bars[1]!.height).toBeCloseTo(30, 6);
    expect(g.bars[2]!.height).toBe(0);
    // Balken sitzen auf der Grundlinie.
    for (const b of g.bars) expect(b.y + b.height).toBeCloseTo(area.y + area.height, 6);
  });

  it("leerer Monat: alle Balken 0, kein NaN, ein Tick auf der Grundlinie", () => {
    const g = barChartGeometry([0, 0, 0, 0], area);
    expect(g.max).toBe(0);
    for (const b of g.bars) {
      expect(b.height).toBe(0);
      expect(Number.isNaN(b.x)).toBe(false);
      expect(Number.isNaN(b.y)).toBe(false);
    }
    expect(g.ticks).toEqual([{ value: 0, y: area.y + area.height }]);
  });

  it("nicht-finite und negative Werte gelten als 0", () => {
    const g = barChartGeometry([Number.NaN, -500, 200, null, undefined], area);
    expect(g.max).toBe(200);
    expect(g.bars.map((b) => b.height)).toEqual([0, 0, 60, 0, 0]);
  });

  it.each([28, 30, 31])("%i Tage füllen die Breite lückenlos aus", (days) => {
    const values = Array.from({ length: days }, (_, i) => (i + 1) * 100);
    const g = barChartGeometry(values, area);
    expect(g.bars).toHaveLength(days);
    const slot = area.width / days;
    expect(g.bars[0]!.width).toBeCloseTo(slot * 0.75, 6);
    // Erster Balken beginnt innerhalb des ersten Slots, letzter endet im Rahmen.
    expect(g.bars[0]!.x).toBeGreaterThanOrEqual(area.x);
    const last = g.bars[days - 1]!;
    expect(last.x + last.width).toBeLessThanOrEqual(area.x + area.width + 1e-9);
    // Gleichmäßiger Abstand der Slots.
    expect(g.bars[1]!.x - g.bars[0]!.x).toBeCloseTo(slot, 6);
  });

  it("liefert drei Stützwerte inklusive Maximum", () => {
    const g = barChartGeometry([400, 200], area);
    expect(g.ticks.map((t) => t.value)).toEqual([0, 200, 400]);
    expect(g.ticks[2]!.y).toBeCloseTo(area.y, 6);
  });
});

describe("lineChartGeometry", () => {
  it("teilt die Achse in count-1 Schritte und skaliert reihenübergreifend", () => {
    const g = lineChartGeometry(
      [
        { name: "A", values: [100, 200] },
        { name: "B", values: [50, 100] },
      ],
      area,
    );
    expect(g.max).toBe(200);
    expect(g.slotX).toEqual([area.x, area.x + area.width]);
    expect(g.series[0]!.points[1]!.y).toBeCloseTo(area.y, 6);
    expect(g.series[1]!.points[1]!.y).toBeCloseTo(area.y + 30, 6);
  });

  it("fehlende Monate werden zu null-Punkten (keine 0-Kerbe)", () => {
    const g = lineChartGeometry([{ name: "A", values: [null, 100, null] }], area);
    expect(g.series[0]!.points[0]).toBeNull();
    expect(g.series[0]!.points[2]).toBeNull();
    expect(g.series[0]!.points[1]!.value).toBe(100);
    expect(g.series[0]!.points[1]!.y).toBeCloseTo(area.y, 6);
  });

  it("leere Reihe erzeugt kein NaN", () => {
    const g = lineChartGeometry([{ name: "A", values: [0, 0] }], area);
    expect(g.max).toBe(0);
    for (const p of g.series[0]!.points) expect(Number.isNaN(p!.y)).toBe(false);
  });

  it("einzelner Monat sitzt in der Flächenmitte", () => {
    const g = lineChartGeometry([{ name: "A", values: [100] }], area);
    expect(g.slotX).toEqual([area.x + area.width / 2]);
  });
});

describe("monthWindow", () => {
  it("13-Monats-Fenster endet im Berichtsmonat und beginnt im Vorjahresmonat", () => {
    const w = monthWindow(2026, 7);
    expect(w).toHaveLength(13);
    expect(w[0]).toEqual({ year: 2025, month: 7, key: "2025-07", label: "Jul" });
    expect(w[12]).toEqual({ year: 2026, month: 7, key: "2026-07", label: "Jul" });
  });

  it("läuft korrekt über den Jahreswechsel", () => {
    const w = monthWindow(2026, 1);
    expect(w[0]!.key).toBe("2025-01");
    expect(w[11]!.key).toBe("2025-12");
    expect(w[12]!.key).toBe("2026-01");
  });

  it("kleines Fenster im Januar greift ins Vorjahr", () => {
    expect(monthWindow(2026, 2, 3).map((m) => m.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("formatTsd", () => {
  it("rundet auf T€ mit deutschen Tausenderpunkten", () => {
    expect(formatTsd(1_234_567_00)).toBe("1.235 T€");
    expect(formatTsd(0)).toBe("0 T€");
  });
});
