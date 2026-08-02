// STAT3 — blockierende Tests der Chart-Geometrie: Skalierung, Leerfälle,
// Monatsbreiten (28/30/31 Tage) und das 13-Monats-Fenster über den
// Jahreswechsel. Geometrie ist rein — hier wird nichts gezeichnet.

import { describe, expect, it } from "vitest";
import {
  barChartGeometry,
  formatTsd,
  formatTsdPlain,
  groupedBarChartGeometry,
  lineChartGeometry,
  monthWindow,
  niceTicks,
  stackedBarChartGeometry,
  type ChartArea,
} from "./statistik-pdf-charts";

const area: ChartArea = { x: 40, y: 100, width: 300, height: 60 };

/** STAT3g — obere Skalengrenze muss die Daten fassen, sonst wirkt der Chart abgeschnitten. */
function topTick(ticks: ReadonlyArray<{ value: number }>): number {
  return ticks.reduce((acc, t) => Math.max(acc, t.value), 0);
}

describe("barChartGeometry", () => {
  it("skaliert gegen die Skalen-Obergrenze, andere linear", () => {
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

  // STAT3g — blockierend: oberster Tick schließt die Skala über dem Datenmaximum ab.
  it("oberster Tick liegt über dem Datenmaximum, kein Balken verlässt die Fläche", () => {
    const g = barChartGeometry([1_000, 1_171, 400], area, { tickCount: 4 });
    expect(topTick(g.ticks)).toBeGreaterThanOrEqual(1_171);
    for (const b of g.bars) expect(b.y).toBeGreaterThanOrEqual(area.y - 1e-9);
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

  // STAT3g — blockierend: auch die geschnittene Linien-Achse schließt oben mit einem Tick ab.
  it("oberster Tick liegt über dem Datenmaximum, kein Punkt verlässt die Fläche", () => {
    const g = lineChartGeometry([{ name: "A", values: [131, 197, 183] }], area, {
      tickCount: 4,
      baseline: "nice",
    });
    expect(topTick(g.ticks)).toBeGreaterThanOrEqual(197);
    // Untere Kappung bleibt unverändert (STAT3e).
    expect(g.baseline).toBe(120);
    for (const p of g.series[0]!.points) if (p) expect(p.y).toBeGreaterThanOrEqual(area.y - 1e-9);
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

  // STAT3g — Balkenlabels tragen keine Einheit, die Achse tut es.
  it("formatTsdPlain liefert denselben Wert ohne Einheit", () => {
    expect(formatTsdPlain(1_234_567_00)).toBe("1.235");
    expect(formatTsdPlain(0)).toBe("0");
  });
});

// STAT3e — Achsenwerte auf rundem Raster; Baseline nur bei echtem Abstand zur 0.
describe("niceTicks", () => {
  it("0-basiert: nur runde Werte, kein krummer Zwischenwert", () => {
    const t = niceTicks(0, 197_000_00);
    expect(t.baseline).toBe(0);
    expect(t.values).toEqual([0, 50_000_00, 100_000_00, 150_000_00, 200_000_00]);
    for (const v of t.values) expect(v % 50_000_00).toBe(0);
  });

  it("geschnittene Achse: Baseline liegt rund und unter dem Minimum", () => {
    const t = niceTicks(131_000_00, 197_000_00);
    expect(t.baseline).toBeLessThanOrEqual(131_000_00);
    expect(t.baseline).toBe(120_000_00);
    expect(t.step).toBe(20_000_00);
    expect(t.values[t.values.length - 1]).toBeGreaterThanOrEqual(197_000_00);
  });

  it("Minimum unter 20 % des Maximums ⇒ 0-Basis bleibt", () => {
    expect(niceTicks(15, 100).baseline).toBe(0);
    expect(niceTicks(30, 100).baseline).toBeGreaterThan(0);
  });

  it("min == max und kleine Spannen ergeben gültige Raster", () => {
    const flat = niceTicks(100, 100);
    expect(flat.baseline).toBeLessThanOrEqual(100);
    expect(flat.values.length).toBeGreaterThanOrEqual(1);
    const tiny = niceTicks(98, 100);
    expect(tiny.baseline).toBeLessThanOrEqual(98);
    expect(Number.isFinite(tiny.step)).toBe(true);
  });

  it("max <= 0 ergibt einen 0-Tick", () => {
    expect(niceTicks(0, 0).values).toEqual([0]);
    expect(niceTicks(-5, -1).values).toEqual([0]);
  });

  it("Balken behalten die 0-Basis, nur die Ticks werden rund", () => {
    const g = barChartGeometry([1_400, 900], area, { tickCount: 4 });
    // STAT3g — die Skala läuft bis zum obersten Rasterwert (1.500), nicht bis 1.400.
    expect(g.max).toBe(1_500);
    expect(g.ticks.map((t) => t.value)).toEqual([0, 500, 1000, 1500]);
    // Grundlinie bleibt die 0-Linie.
    expect(g.ticks[0]!.y).toBeCloseTo(area.y + area.height, 6);
    expect(g.bars[0]!.height).toBeCloseTo(area.height * (1_400 / 1_500), 6);
  });

  it("Linien mit baseline 'nice': Baseline sitzt auf der Grundlinie", () => {
    const g = lineChartGeometry([{ name: "A", values: [131, 197, null] }], area, {
      tickCount: 4,
      baseline: "nice",
    });
    expect(g.baseline).toBe(120);
    expect(g.ticks[0]!.value).toBe(120);
    expect(g.ticks[0]!.y).toBeCloseTo(area.y + area.height, 6);
    // STAT3g — die Fläche endet am obersten Tick (200), das Maximum liegt darunter.
    expect(g.max).toBe(200);
    expect(g.series[0]!.points[1]!.y).toBeCloseTo(
      area.y + area.height - ((197 - 120) / (200 - 120)) * area.height,
      6,
    );
    expect(g.series[0]!.points[2]).toBeNull();
    for (const p of g.series[0]!.points) if (p) expect(Number.isNaN(p.y)).toBe(false);
  });

  it("Linien ohne Option bleiben 0-basiert (Rückwärtskompatibilität)", () => {
    const g = lineChartGeometry([{ name: "A", values: [100, 200] }], area);
    expect(g.baseline).toBe(0);
    expect(g.series[0]!.points[0]!.y).toBeCloseTo(area.y + area.height / 2, 6);
  });
});

// STAT3c — gestapelte Tagesbalken (Standort-Verteilung ohne Zahlen im PDF).
describe("stackedBarChartGeometry", () => {
  it("Segmenthöhen eines Tages summieren sich exakt zur Stapelhöhe", () => {
    const g = stackedBarChartGeometry(
      [
        { name: "spicery", values: [3000, 1000] },
        { name: "YUM", values: [1000, 500] },
      ],
      area,
    );
    expect(g.max).toBe(4000);
    const first = g.stacks[0]!;
    expect(first.height).toBeCloseTo(60, 10);
    expect(first.segments.reduce((a, s) => a + s.height, 0)).toBeCloseTo(first.height, 10);
    const second = g.stacks[1]!;
    expect(second.total).toBe(1500);
    expect(second.segments.reduce((a, s) => a + s.height, 0)).toBeCloseTo(second.height, 10);
    // unten beginnend: erste Reihe sitzt auf der Grundlinie
    expect(first.segments[0]!.y + first.segments[0]!.height).toBeCloseTo(area.y + area.height, 10);
  });

  it("0 in einer Reihe: das andere Segment füllt den Stapel, kein NaN", () => {
    const g = stackedBarChartGeometry(
      [
        { name: "spicery", values: [0] },
        { name: "YUM", values: [2000] },
      ],
      area,
    );
    const stack = g.stacks[0]!;
    expect(stack.segments[0]!.height).toBe(0);
    expect(stack.segments[1]!.height).toBeCloseTo(stack.height, 10);
    expect(Number.isFinite(stack.height)).toBe(true);
  });

  it("Reihen ungleicher Länge werfen laut", () => {
    expect(() =>
      stackedBarChartGeometry(
        [
          { name: "spicery", values: [1, 2, 3] },
          { name: "YUM", values: [1, 2] },
        ],
        area,
      ),
    ).toThrow(/YUM/);
  });

  it("Ein-Reihen-Fall ist identisch zu barChartGeometry", () => {
    const values = [1000, 0, 2500, 700];
    const flat = barChartGeometry(values, area);
    const stackedGeo = stackedBarChartGeometry([{ name: "spicery", values }], area);
    expect(stackedGeo.max).toBe(flat.max);
    expect(stackedGeo.ticks).toEqual(flat.ticks);
    stackedGeo.stacks.forEach((s, i) => {
      const b = flat.bars[i]!;
      expect(s.x).toBe(b.x);
      expect(s.width).toBe(b.width);
      expect(s.y).toBe(b.y);
      expect(s.height).toBe(b.height);
      expect(s.segments[0]!.y).toBe(b.y);
      expect(s.segments[0]!.height).toBe(b.height);
    });
  });

  it("leere Reihenliste ergibt keine Stapel", () => {
    const g = stackedBarChartGeometry([], area);
    expect(g.stacks).toEqual([]);
    expect(g.max).toBe(0);
  });
});

// STAT3f — gruppierte Balken (Jahre × Standorte), Skala zwingend 0-basiert.
describe("groupedBarChartGeometry", () => {
  const groups = [
    { label: "2025", values: [100, 50] },
    { label: "2026", values: [200, 150] },
  ];

  it("Gruppen und Balken füllen die Fläche ohne Überlappung", () => {
    const g = groupedBarChartGeometry(groups, area, { seriesNames: ["spicery", "YUM"] });
    const slot = area.width / 2;
    expect(g.groups).toHaveLength(2);
    for (const grp of g.groups) {
      expect(grp.width).toBeCloseTo(slot * 0.75, 6);
      expect(grp.bars).toHaveLength(2);
      expect(grp.bars[0]!.x).toBeGreaterThanOrEqual(area.x - 1e-9);
      // Balken liegen lückenlos aneinander, aber innerhalb der Gruppe.
      expect(grp.bars[0]!.x + grp.bars[0]!.width).toBeCloseTo(grp.bars[1]!.x, 6);
      expect(grp.bars[1]!.x + grp.bars[1]!.width).toBeCloseTo(grp.x + grp.width, 6);
    }
    // Gruppen überlappen nicht.
    const first = g.groups[0]!;
    expect(first.x + first.width).toBeLessThanOrEqual(g.groups[1]!.x + 1e-9);
    expect(g.groups[0]!.bars[0]!.name).toBe("spicery");
    expect(g.groups[0]!.bars[1]!.name).toBe("YUM");
  });

  it("Maximum füllt die Höhe, alles skaliert linear ab 0", () => {
    const g = groupedBarChartGeometry(groups, area);
    expect(g.max).toBe(200);
    expect(g.groups[1]!.bars[0]!.height).toBeCloseTo(60, 6);
    expect(g.groups[0]!.bars[0]!.height).toBeCloseTo(30, 6);
    for (const grp of g.groups)
      for (const b of grp.bars) expect(b.y + b.height).toBeCloseTo(area.y + area.height, 6);
  });

  it("null bleibt Lücke (kein 0-Balken)", () => {
    const g = groupedBarChartGeometry([{ label: "2022", values: [null, 100] }], area);
    const bars = g.groups[0]!.bars;
    expect(bars[0]!.value).toBeNull();
    expect(bars[0]!.height).toBe(0);
    expect(Number.isNaN(bars[0]!.y)).toBe(false);
    expect(bars[1]!.value).toBe(100);
  });

  it("ein einziges Jahr sitzt mittig in der Fläche", () => {
    const g = groupedBarChartGeometry([{ label: "2026", values: [10, 20] }], area);
    const grp = g.groups[0]!;
    expect(grp.x + grp.width / 2).toBeCloseTo(area.x + area.width / 2, 6);
  });

  it("alle Werte gleich ⇒ gleiche Höhe, Skala schließt oberhalb ab", () => {
    const g = groupedBarChartGeometry(
      [
        { label: "a", values: [500, 500] },
        { label: "b", values: [500, 500] },
      ],
      area,
    );
    // STAT3g — die Fläche endet am obersten Rasterwert, nicht am Datenmaximum:
    // gleiche Werte ⇒ gleiche Höhe, aber Kopfraum bis zum Tick.
    const top = topTick(g.ticks);
    expect(top).toBeGreaterThanOrEqual(500);
    for (const grp of g.groups)
      for (const b of grp.bars) expect(b.height).toBeCloseTo(area.height * (500 / top), 6);
  });

  it("Skala beginnt bei 0, auch wenn alle Werte hoch liegen (keine Baseline)", () => {
    const g = groupedBarChartGeometry(
      [
        { label: "a", values: [980_000] },
        { label: "b", values: [1_000_000] },
      ],
      area,
      { tickCount: 4 },
    );
    expect(g.ticks[0]!.value).toBe(0);
    expect(g.ticks[0]!.y).toBeCloseTo(area.y + area.height, 6);
    expect(g.groups[0]!.bars[0]!.height).toBeCloseTo(area.height * 0.98, 6);
  });

  it("leere Eingabe ergibt keine Gruppen", () => {
    const g = groupedBarChartGeometry([], area);
    expect(g.groups).toEqual([]);
    expect(g.max).toBe(0);
  });

  // STAT3g — blockierend: kein Balken ragt über den obersten Tick hinaus.
  it("oberster Tick liegt über dem Datenmaximum", () => {
    const g = groupedBarChartGeometry(
      [
        { label: "a", values: [1_171] },
        { label: "b", values: [640] },
      ],
      area,
      { tickCount: 4 },
    );
    expect(topTick(g.ticks)).toBeGreaterThanOrEqual(1_171);
    for (const grp of g.groups)
      for (const b of grp.bars) expect(b.y).toBeGreaterThanOrEqual(area.y - 1e-9);
  });

  // STAT3j — feineres 1/2/2.5/5-Raster: 1.171 schließt mit 1.250 ab (250er
  // Schritt) statt mit 1.500 (500er Schritt). Grundregel „Tick >= Max" bleibt.
  it("fineSteps: Maximum 1.171 ergibt Skalenabschluss 1.250 im 250er-Raster", () => {
    const fine = groupedBarChartGeometry(
      [
        { label: "a", values: [1_171] },
        { label: "b", values: [640] },
      ],
      area,
      { tickCount: 5, fineSteps: true },
    );
    expect(fine.max).toBe(1_250);
    expect(fine.ticks.map((t) => t.value)).toEqual([0, 250, 500, 750, 1_000, 1_250]);

    // Ohne die Option bleibt das klassische Raster bit-stabil (1.500).
    const coarse = groupedBarChartGeometry(
      [
        { label: "a", values: [1_171] },
        { label: "b", values: [640] },
      ],
      area,
      { tickCount: 5 },
    );
    expect(coarse.max).toBe(1_500);
  });
});

// ── STAT3k — dayBands ─────────────────────────────────────────────────────
describe("dayBands", () => {
  const area = { x: 100, y: 50, width: 310, height: 100 };

  it("liefert für keinen markierten Tag ein leeres Ergebnis", () => {
    expect(dayBands(new Array(31).fill(false), area)).toEqual([]);
  });

  it("markiert einen Einzeltag als genau einen Slot", () => {
    const marked = new Array(31).fill(false);
    marked[10] = true;
    const bands = dayBands(marked, area);
    const slot = area.width / 31;
    expect(bands).toHaveLength(1);
    expect(bands[0]!.w).toBeCloseTo(slot, 10);
    expect(bands[0]!.x).toBeCloseTo(area.x + 10 * slot, 10);
    expect(bands[0]!.y).toBe(area.y);
    expect(bands[0]!.h).toBe(area.height);
  });

  it("merged Sa+So zu einem Band", () => {
    const marked = new Array(31).fill(false);
    marked[5] = true;
    marked[6] = true;
    const bands = dayBands(marked, area);
    const slot = area.width / 31;
    expect(bands).toHaveLength(1);
    expect(bands[0]!.w).toBeCloseTo(2 * slot, 10);
  });

  it("merged Feiertag + Wochenende zu einem zusammenhängenden Band", () => {
    const marked = new Array(31).fill(false);
    marked[3] = true; // Fr-Feiertag
    marked[4] = true; // Sa
    marked[5] = true; // So
    marked[9] = true; // separates Wochenende
    const bands = dayBands(marked, area);
    const slot = area.width / 31;
    expect(bands).toHaveLength(2);
    expect(bands[0]!.w).toBeCloseTo(3 * slot, 10);
    expect(bands[1]!.w).toBeCloseTo(slot, 10);
  });

  it("hält erste und letzte Bänder an der Chart-Kante (kein Überstand)", () => {
    const marked = new Array(28).fill(false);
    marked[0] = true;
    marked[27] = true;
    const bands = dayBands(marked, area);
    expect(bands).toHaveLength(2);
    expect(bands[0]!.x).toBe(area.x);
    expect(bands[1]!.x + bands[1]!.w).toBeCloseTo(area.x + area.width, 10);
  });

  it("skaliert Slotbreiten mit der Monatslänge (28 vs. 31 Tage)", () => {
    const b28 = dayBands([true, ...new Array(27).fill(false)], area);
    const b31 = dayBands([true, ...new Array(30).fill(false)], area);
    expect(b28[0]!.w).toBeCloseTo(area.width / 28, 10);
    expect(b31[0]!.w).toBeCloseTo(area.width / 31, 10);
    expect(b28[0]!.w).toBeGreaterThan(b31[0]!.w);
  });
});
