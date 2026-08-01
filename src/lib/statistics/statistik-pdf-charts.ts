/**
 * STAT3 — Chart-Geometrie für das Statistik-PDF.
 *
 * Reine Funktionen: Eingabe = Werte + Zeichenfläche, Ausgabe = Rechteck- und
 * Punktkoordinaten. KEINE jsPDF-Aufrufe, keine Rundungs- oder Umsatzlogik —
 * `statistik-pdf.ts` konsumiert diese Geometrie nur noch zeichnend.
 *
 * Alle Beträge in ganzen Cent; y wächst wie in jsPDF nach unten.
 */

import { displayTsd } from "./monthly-core";
import { MONTH_LABELS } from "./monatsbericht-pdf";

export type ChartArea = {
  x: number;
  y: number;
  width: number;
  /** Höhe der Wertefläche (ohne Achsenbeschriftung). */
  height: number;
};

export type BarRect = {
  index: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AxisTick = { value: number; y: number };

export type BarGeometry = {
  bars: BarRect[];
  /** Skalierungs-Maximum (0, wenn keine positiven Werte vorliegen). */
  max: number;
  ticks: AxisTick[];
};

/** Nicht-finite oder negative Werte gelten als 0 (nie NaN in der Geometrie). */
function safeValue(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function maxOf(values: readonly (number | null | undefined)[]): number {
  let max = 0;
  for (const v of values) {
    const s = safeValue(v);
    if (s > max) max = s;
  }
  return max;
}

function ticksFor(max: number, area: ChartArea, tickCount: number): AxisTick[] {
  if (max <= 0) return [{ value: 0, y: area.y + area.height }];
  const n = Math.max(2, Math.trunc(tickCount));
  const ticks: AxisTick[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    ticks.push({ value: max * frac, y: area.y + area.height - area.height * frac });
  }
  return ticks;
}

/**
 * Balkengeometrie: der größte Wert füllt die Fläche exakt aus, alle übrigen
 * skalieren linear. Leere Reihen ergeben Balken der Höhe 0.
 */
export function barChartGeometry(
  values: readonly (number | null | undefined)[],
  area: ChartArea,
  opts?: { gapRatio?: number; tickCount?: number },
): BarGeometry {
  const gapRatio = clamp(opts?.gapRatio ?? 0.25, 0, 0.8);
  const max = maxOf(values);
  const count = values.length;
  const slot = count > 0 ? area.width / count : 0;
  const width = slot * (1 - gapRatio);
  const offset = (slot - width) / 2;

  const bars: BarRect[] = values.map((raw, index) => {
    const value = safeValue(raw);
    const height = max > 0 ? (value / max) * area.height : 0;
    return {
      index,
      value,
      x: area.x + index * slot + offset,
      y: area.y + area.height - height,
      width,
      height,
    };
  });

  return { bars, max, ticks: ticksFor(max, area, opts?.tickCount ?? 3) };
}

export type LinePoint = { index: number; value: number; x: number; y: number };

export type StackSegment = {
  seriesIndex: number;
  name: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BarStack = {
  index: number;
  /** Summe der Reihen dieses Tages (Skalierungsgrundlage). */
  total: number;
  x: number;
  width: number;
  /** Oberkante des gesamten Stapels. */
  y: number;
  height: number;
  /** Von unten nach oben, Reihenfolge stabil nach Eingabereihen. */
  segments: StackSegment[];
};

export type StackedBarGeometry = {
  stacks: BarStack[];
  /** Maximum der Tages-SUMMEN (nicht der Einzelreihen). */
  max: number;
  ticks: AxisTick[];
};

/**
 * STAT3c — gestapelte Balken: je Index ein Stapel aus Segmenten (unten
 * beginnend). Skaliert über das Maximum der Tages-Summen; die Segmentkanten
 * entstehen aus Kumulativsummen, damit kein Rundungs-Spalt im Stapel klafft.
 *
 * Der Ein-Reihen-Fall ist rechnerisch identisch zu `barChartGeometry`.
 */
export function stackedBarChartGeometry(
  series: ReadonlyArray<{ name: string; values: readonly (number | null | undefined)[] }>,
  area: ChartArea,
  opts?: { gapRatio?: number; tickCount?: number },
): StackedBarGeometry {
  const count = series.length > 0 ? (series[0]?.values.length ?? 0) : 0;
  for (const s of series) {
    if (s.values.length !== count) {
      throw new Error(
        `stackedBarChartGeometry: Reihe "${s.name}" hat ${s.values.length} Werte, erwartet ${count}`,
      );
    }
  }

  const gapRatio = clamp(opts?.gapRatio ?? 0.25, 0, 0.8);
  const totals = Array.from({ length: count }, (_, i) =>
    series.reduce((acc, s) => acc + safeValue(s.values[i]), 0),
  );
  const max = maxOf(totals);
  const slot = count > 0 ? area.width / count : 0;
  const width = slot * (1 - gapRatio);
  const offset = (slot - width) / 2;
  const baseline = area.y + area.height;

  const stacks: BarStack[] = totals.map((total, index) => {
    const x = area.x + index * slot + offset;
    const height = max > 0 ? (total / max) * area.height : 0;
    let cum = 0;
    let lowerY = baseline;
    const segments: StackSegment[] = series.map((s, seriesIndex) => {
      const value = safeValue(s.values[index]);
      cum += value;
      const topY = max > 0 ? baseline - (cum / max) * area.height : baseline;
      const segment: StackSegment = {
        seriesIndex,
        name: s.name,
        value,
        x,
        y: topY,
        width,
        height: lowerY - topY,
      };
      lowerY = topY;
      return segment;
    });
    return { index, total, x, width, y: baseline - height, height, segments };
  });

  return { stacks, max, ticks: ticksFor(max, area, opts?.tickCount ?? 3) };
}

export type LineSeriesGeometry = {
  name: string;
  /** null = kein Wert für diesen Monat (Lücke, keine 0-Kerbe). */
  points: (LinePoint | null)[];
};

export type LineGeometry = {
  series: LineSeriesGeometry[];
  max: number;
  ticks: AxisTick[];
  /** x-Positionen der Rasterpunkte (für Monatskürzel). */
  slotX: number[];
};

/**
 * Punktgeometrie für eine oder mehrere Reihen über dieselbe Zeitachse. Die
 * Skala ist reihenübergreifend (Standorte bleiben vergleichbar).
 */
export function lineChartGeometry(
  series: ReadonlyArray<{ name: string; values: ReadonlyArray<number | null> }>,
  area: ChartArea,
  opts?: { tickCount?: number },
): LineGeometry {
  const count = series.reduce((acc, s) => Math.max(acc, s.values.length), 0);
  const max = maxOf(series.flatMap((s) => [...s.values]));
  const slotX: number[] = [];
  for (let i = 0; i < count; i++) {
    slotX.push(count === 1 ? area.x + area.width / 2 : area.x + (i * area.width) / (count - 1));
  }

  const out: LineSeriesGeometry[] = series.map((s) => ({
    name: s.name,
    points: Array.from({ length: count }, (_, index) => {
      const raw = s.values[index];
      if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
      const value = safeValue(raw);
      const height = max > 0 ? (value / max) * area.height : 0;
      return { index, value, x: slotX[index] ?? area.x, y: area.y + area.height - height };
    }),
  }));

  return { series: out, max, ticks: ticksFor(max, area, opts?.tickCount ?? 3), slotX };
}

export type MonthSlot = { year: number; month: number; key: string; label: string };

/**
 * `count` Monate, endend beim übergebenen Monat (Standard 13 = Vorjahresmonat
 * bis Berichtsmonat). Jahreswechsel inklusive.
 */
export function monthWindow(year: number, month: number, count = 13): MonthSlot[] {
  const slots: MonthSlot[] = [];
  const n = Math.max(1, Math.trunc(count));
  for (let back = n - 1; back >= 0; back--) {
    const zeroBased = year * 12 + (month - 1) - back;
    const y = Math.floor(zeroBased / 12);
    const m = (zeroBased % 12) + 1;
    slots.push({
      year: y,
      month: m,
      key: `${y}-${m < 10 ? `0${m}` : m}`,
      label: MONTH_LABELS[m - 1] ?? String(m),
    });
  }
  return slots;
}

/** Achsen-/Wertbeschriftung in T€ mit deutschen Tausenderpunkten. */
export function formatTsd(cents: number): string {
  return `${displayTsd(cents).toLocaleString("de-DE")} T€`;
}
