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
  /**
   * STAT3g — Skalen-Obergrenze = oberster Nice-Tick (≥ Datenmaximum);
   * 0, wenn keine positiven Werte vorliegen.
   */
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

function minOf(values: readonly (number | null | undefined)[]): number {
  let min: number | null = null;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    if (min === null || v < min) min = v;
  }
  return min ?? 0;
}

/**
 * Schrittweite im Rasterset ×10^n, mindestens so groß wie `raw`.
 *
 * Standard ist 1/2/5 (klassisches Achsenraster). STAT3j erlaubt zusätzlich
 * 1/2/2.5/5 (`fine`): dadurch existiert überhaupt ein 250er-Raster, das bei
 * Maximum 1.171 T€ mit 1.250 abschließt statt mit 1.500 (500er-Raster).
 */
const COARSE_MANTISSAS = [1, 2, 5, 10] as const;
const FINE_MANTISSAS = [1, 2, 2.5, 5, 10] as const;

function niceStep(raw: number, fine = false): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const pow = 10 ** exp;
  const f = raw / pow;
  const mantissas = fine ? FINE_MANTISSAS : COARSE_MANTISSAS;
  const m = mantissas.find((c) => f <= c) ?? 10;
  return m * pow;
}

export type NiceTicks = {
  /** Größter Rasterwert ≤ min, nie negativ (0 bei flachem Datenminimum). */
  baseline: number;
  /** Kleinster Rasterwert ≥ max. */
  top: number;
  step: number;
  /** Aufsteigend von `baseline` bis `top`. */
  values: number[];
};

/**
 * STAT3e — Achsenwerte auf runden Zahlen (1/2/5×10^n-Raster).
 *
 * Rein rechnerisch, ohne Zeichenfläche. `baseline` ist der größte Rasterwert
 * unter dem Datenminimum — ausgenommen der flache Fall: liegt das Minimum unter
 * 20 % des Maximums, bleibt die 0-Basis (kein Schnitt für nichts).
 */
export function niceTicks(
  min: number,
  max: number,
  targetCount = 4,
  opts?: { fineSteps?: boolean },
): NiceTicks {
  const hi = Number.isFinite(max) && max > 0 ? max : 0;
  if (hi <= 0) return { baseline: 0, top: 0, step: 1, values: [0] };
  let lo = Number.isFinite(min) && min > 0 ? Math.min(min, hi) : 0;
  // Flaches Minimum ⇒ 0-Basis: ein Schnitt würde hier nur Fläche verschenken.
  if (lo < hi * 0.2) lo = 0;
  const n = Math.max(2, Math.trunc(targetCount));
  const span = hi - lo > 0 ? hi - lo : hi;
  const step = niceStep(span / n, opts?.fineSteps === true);
  const baseline = Math.max(0, Math.floor(lo / step) * step);
  const top = Math.ceil(hi / step) * step;
  const values: number[] = [];
  // Ganzzahlige Schrittzähler statt fortlaufender Addition: keine Float-Drift.
  const count = Math.round((top - baseline) / step);
  for (let i = 0; i <= count; i++) values.push(baseline + i * step);
  return { baseline, top, step, values };
}

export type Axis = {
  /** Untere Skalengrenze (0 bei Balken, ggf. geschnitten bei Linien). */
  baseline: number;
  /** Obere Skalengrenze = oberster Rasterwert, garantiert ≥ Datenmaximum. */
  top: number;
  ticks: AxisTick[];
};

/**
 * STAT3g — Achse für eine Fläche: die Skala schließt IMMER mit einem Rasterwert
 * ≥ Datenmaximum ab, und alle Rasterwerte werden gezeichnet.
 *
 * Vorher lief die Skala bis zum rohen Datenmaximum, während Ticks darüber
 * weggefiltert wurden — dadurch ragten Balken/Punkte über den obersten Tick
 * hinaus und wirkten abgeschnitten. Die untere Kappung (`baseline`, nur Linien)
 * bleibt unberührt.
 */
function axisFor(
  dataMax: number,
  area: ChartArea,
  tickCount: number,
  baseline = 0,
  opts?: { fineSteps?: boolean },
): Axis {
  if (dataMax <= 0) {
    return { baseline: 0, top: 0, ticks: [{ value: 0, y: area.y + area.height }] };
  }
  const nice = niceTicks(baseline, dataMax, tickCount, opts);
  const top = Math.max(nice.top, dataMax);
  const span = top - nice.baseline;
  const values = nice.values.length > 0 ? nice.values : [nice.baseline];
  return {
    baseline: nice.baseline,
    top,
    ticks: values.map((value) => ({
      value,
      y: area.y + area.height - (span > 0 ? ((value - nice.baseline) / span) * area.height : 0),
    })),
  };
}

/**
 * Balkengeometrie: alle Werte skalieren linear gegen die Skalen-Obergrenze
 * (STAT3g: oberster Nice-Tick). Leere Reihen ergeben Balken der Höhe 0.
 */
export function barChartGeometry(
  values: readonly (number | null | undefined)[],
  area: ChartArea,
  opts?: { gapRatio?: number; tickCount?: number },
): BarGeometry {
  const gapRatio = clamp(opts?.gapRatio ?? 0.25, 0, 0.8);
  const axis = axisFor(maxOf(values), area, opts?.tickCount ?? 3);
  const max = axis.top;
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

  return { bars, max, ticks: axis.ticks };
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
  /** STAT3g — Skalen-Obergrenze über die Tages-SUMMEN (oberster Nice-Tick). */
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
  const axis = axisFor(maxOf(totals), area, opts?.tickCount ?? 3);
  const max = axis.top;
  const slot = count > 0 ? area.width / count : 0;
  const width = slot * (1 - gapRatio);
  const offset = (slot - width) / 2;
  const baseline = area.y + area.height;

  const stacks: BarStack[] = totals.map((total, index) => {
    const x = area.x + index * slot + offset;
    const height = max > 0 ? (total / max) * area.height : 0;
    let cum = 0;
    let prevScaled = 0;
    const segments: StackSegment[] = series.map((s, seriesIndex) => {
      const value = safeValue(s.values[index]);
      cum += value;
      // Kanten aus skalierten Kumulativsummen: kein Rundungs-Spalt, und der
      // Ein-Reihen-Fall ergibt bitgleich (value / max) * height.
      const scaled = max > 0 ? (cum / max) * area.height : 0;
      const segment: StackSegment = {
        seriesIndex,
        name: s.name,
        value,
        x,
        y: baseline - scaled,
        width,
        height: scaled - prevScaled,
      };
      prevScaled = scaled;
      return segment;
    });
    return { index, total, x, width, y: baseline - height, height, segments };
  });

  return { stacks, max, ticks: axis.ticks };
}

export type LineSeriesGeometry = {
  name: string;
  /** null = kein Wert für diesen Monat (Lücke, keine 0-Kerbe). */
  points: (LinePoint | null)[];
};

export type GroupedBar = {
  seriesIndex: number;
  name: string;
  /** null = Lücke (kein Balken zeichnen), nie als 0 dargestellt. */
  value: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BarGroup = {
  index: number;
  label: string;
  /** Linke Kante der Gruppe und ihre Gesamtbreite (für Achsenlabels). */
  x: number;
  width: number;
  bars: GroupedBar[];
};

export type GroupedBarGeometry = {
  groups: BarGroup[];
  /** STAT3g — Skalen-Obergrenze (oberster Nice-Tick ≥ Datenmaximum). */
  max: number;
  ticks: AxisTick[];
};

/**
 * STAT3f — gruppierte Balken (Jahre × Standorte). Die Skala ist ZWINGEND
 * 0-basiert: bei Balken trägt die Fläche den Wert, ein Achsenschnitt würde
 * lügen (bewusster Kontrast zur geschnittenen Linien-Achse aus STAT3e).
 *
 * `null` bleibt Lücke — kein 0-Balken, damit fehlende Historie nicht wie ein
 * Umsatz von null aussieht.
 */
export function groupedBarChartGeometry(
  groups: ReadonlyArray<{ label: string; values: ReadonlyArray<number | null> }>,
  area: ChartArea,
  opts?: { gapRatio?: number; tickCount?: number; seriesNames?: readonly string[] },
): GroupedBarGeometry {
  const gapRatio = clamp(opts?.gapRatio ?? 0.25, 0, 0.8);
  const groupCount = groups.length;
  const seriesCount = groups.reduce((acc, g) => Math.max(acc, g.values.length), 0);
  const axis = axisFor(maxOf(groups.flatMap((g) => [...g.values])), area, opts?.tickCount ?? 3);
  const max = axis.top;
  const slot = groupCount > 0 ? area.width / groupCount : 0;
  const groupWidth = slot * (1 - gapRatio);
  const offset = (slot - groupWidth) / 2;
  const barWidth = seriesCount > 0 ? groupWidth / seriesCount : 0;
  const baseY = area.y + area.height;

  const out: BarGroup[] = groups.map((g, index) => {
    const gx = area.x + index * slot + offset;
    const bars: GroupedBar[] = Array.from({ length: seriesCount }, (_, seriesIndex) => {
      const raw = g.values[seriesIndex];
      const missing = raw === null || raw === undefined || !Number.isFinite(raw);
      const value = missing ? null : safeValue(raw);
      const height = value !== null && max > 0 ? (value / max) * area.height : 0;
      return {
        seriesIndex,
        name: opts?.seriesNames?.[seriesIndex] ?? String(seriesIndex),
        value,
        x: gx + seriesIndex * barWidth,
        y: baseY - height,
        width: barWidth,
        height,
      };
    });
    return { index, label: g.label, x: gx, width: groupWidth, bars };
  });

  return { groups: out, max, ticks: axis.ticks };
}

export type LineGeometry = {
  series: LineSeriesGeometry[];
  /** STAT3g — Skalen-Obergrenze (oberster Nice-Tick ≥ Datenmaximum). */
  max: number;
  /** Untere Skalengrenze (0 = ungeschnittene Achse). */
  baseline: number;
  ticks: AxisTick[];
  /** x-Positionen der Rasterpunkte (für Monatskürzel). */
  slotX: number[];
};

/**
 * Punktgeometrie für eine oder mehrere Reihen über dieselbe Zeitachse. Die
 * Skala ist reihenübergreifend (Standorte bleiben vergleichbar).
 *
 * STAT3e — `baseline: "nice"` schneidet die Achse am größten runden Wert unter
 * dem Datenminimum (siehe `niceTicks`). Nur für LINIEN erlaubt; Balken bleiben
 * grundsätzlich 0-basiert, weil dort die Fläche den Wert trägt.
 */
export function lineChartGeometry(
  series: ReadonlyArray<{ name: string; values: ReadonlyArray<number | null> }>,
  area: ChartArea,
  opts?: { tickCount?: number; baseline?: "nice" | 0 },
): LineGeometry {
  const count = series.reduce((acc, s) => Math.max(acc, s.values.length), 0);
  const dataMax = maxOf(series.flatMap((s) => [...s.values]));
  const tickCount = opts?.tickCount ?? 3;
  const lowerBaseline =
    opts?.baseline === "nice"
      ? niceTicks(minOf(series.flatMap((s) => [...s.values])), dataMax, tickCount).baseline
      : 0;
  const axis = axisFor(dataMax, area, tickCount, lowerBaseline);
  const max = axis.top;
  const baseline = axis.baseline;
  const span = max - baseline;
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
      const height = span > 0 ? (Math.max(0, value - baseline) / span) * area.height : 0;
      return { index, value, x: slotX[index] ?? area.x, y: area.y + area.height - height };
    }),
  }));

  return { series: out, max, baseline, ticks: axis.ticks, slotX };
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

/**
 * STAT3g — Wertelabel in T€ OHNE Einheit („1.171"). Die Einheit trägt die
 * Achsenbeschriftung; über den Balken wäre sie nur Wiederholung.
 */
export function formatTsdPlain(cents: number): string {
  return displayTsd(cents).toLocaleString("de-DE");
}
