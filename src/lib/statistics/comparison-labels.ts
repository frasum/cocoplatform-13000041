// STAT2c — Reine Beschriftungs-Logik für den Standortvergleich.
//
// Zwei Fragen werden hier getrennt beantwortet, weil sie in den Karten
// direkt nebeneinander stehen und vorher verwechselbar waren:
//
//  1. Standort gegen Standort — EIN zentrales Delta mit benanntem Bezug
//     („spicery +15,2 % vs. YUM"). Rechenquelle: `pctDiff`.
//  2. Standort gegen eigenes Vormonatsfenster — Trendzeile je Standortwert
//     („+12,0 % vs. 01.–30.06."). Rechenquelle: `computeTrend`,
//     Fensterlabel: `formatComparisonRange`.
//
// Keine Berechnungen jenseits dieser beiden Quellen, keine Seiteneffekte.
// Fehlender Vergleichswert oder Nenner 0 ⇒ „—" (nie NaN/Infinity/0-Fake).

import { pctDiff } from "./comparison-core";
import { computeTrend, ppDelta } from "./revenue-core";
import { formatComparisonRange, type ComparisonRange } from "./comparison-label";

export type Tone = "up" | "down" | "neutral";

/** Prozentwert deutsch mit einer Nachkommastelle (ohne Vorzeichen). */
export function formatPctDe(pct: number): string {
  return Math.abs(pct).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export type LeadDelta = {
  /** Führender Standort ("a"/"b"); null bei Gleichstand oder fehlenden Werten. */
  leader: "a" | "b" | null;
  /** Abweichung des führenden Standorts gegenüber dem anderen; null wenn undefiniert. */
  pct: number | null;
  text: string;
  tone: Tone;
};

/**
 * Zentrales Delta einer Vergleichskarte mit explizitem Bezug.
 *  - Gleichstand ⇒ „Gleichstand (±0,0 %)"
 *  - Vergleichswert 0 ⇒ kein Prozentwert, nur die Richtung
 *  - fehlender Wert ⇒ „—"
 */
export function leadDelta(input: {
  aName: string;
  bName: string;
  aValue: number | null;
  bValue: number | null;
}): LeadDelta {
  const { aName, bName, aValue, bValue } = input;
  if (aValue === null || bValue === null) {
    return { leader: null, pct: null, text: "—", tone: "neutral" };
  }
  if (aValue === bValue) {
    return { leader: null, pct: 0, text: "Gleichstand (±0,0 %)", tone: "neutral" };
  }
  const aLeads = aValue > bValue;
  const leader = aLeads ? "a" : "b";
  const leadName = aLeads ? aName : bName;
  const otherName = aLeads ? bName : aName;
  const pct = pctDiff(aLeads ? aValue : bValue, aLeads ? bValue : aValue);
  if (pct === null) {
    return {
      leader,
      pct: null,
      text: `${leadName} führt vs. ${otherName} — kein Prozentwert (Vergleichswert 0)`,
      tone: "neutral",
    };
  }
  return {
    leader,
    pct,
    text: `${leadName} +${formatPctDe(pct)} % vs. ${otherName}`,
    tone: "up",
  };
}

export type TrendLabel = { pct: number | null; text: string; tone: Tone };

/**
 * Trendzeile eines Standortwerts gegen sein eigenes Vormonatsfenster.
 * Fehlender Vormonatswert oder Vormonatswert 0 ⇒ „—".
 */
export function previousTrendLabel(
  current: number | null | undefined,
  previous: number | null | undefined,
  range: ComparisonRange | null | undefined,
  opts?: { partial?: boolean },
): TrendLabel {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { pct: null, text: "—", tone: "neutral" };
  }
  const { pct } = computeTrend(current, previous);
  if (pct === null) return { pct: null, text: "—", tone: "neutral" };
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "±";
  const suffix = formatComparisonRange(range ?? null, opts) ?? "vs. Vormonat";
  return {
    pct,
    text: `${sign}${formatPctDe(pct)} % ${suffix}`,
    tone: pct > 0 ? "up" : pct < 0 ? "down" : "neutral",
  };
}

/**
 * STAT2d — Trendzeile für eine QUOTEN-Kennzahl: Punktdifferenz statt relativem
 * Wachstum („+0,2 pp vs. 01.–30.06."). Fehlender Wert ⇒ „—".
 */
export function ppTrendLabel(
  current: number | null | undefined,
  previous: number | null | undefined,
  range: ComparisonRange | null | undefined,
  opts?: { partial?: boolean },
): TrendLabel {
  const delta = ppDelta(current ?? null, previous ?? null);
  if (delta === null) return { pct: null, text: "—", tone: "neutral" };
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const suffix = formatComparisonRange(range ?? null, opts) ?? "vs. Vormonat";
  return {
    pct: delta,
    text: `${sign}${formatPctDe(delta)} pp ${suffix}`,
    tone: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
  };
}
