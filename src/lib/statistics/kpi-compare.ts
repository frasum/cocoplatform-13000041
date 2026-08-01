// STAT2b — Reine Vergleichslogik für Dichte-Kennzahlen (Ø Umsatz je Gast,
// Umsatz je Arbeitsstunde) im Standortvergleich.
//
// Bewusst OHNE Anteils-Balken: bei Verhältniszahlen ist ein „Anteil" fachlich
// irreführend. Die Karte zeigt Wert A, Wert B und die prozentuale Differenz.
// Nenner-0 kommt als `null` herein (so liefert es `derivedKpis`) und bleibt
// `null` — kein NaN, kein Infinity, kein 0-Fake.

import { pctDiff } from "./comparison-core";

export type KpiComparison = {
  aValue: number | null;
  bValue: number | null;
  /** Abweichung A gegenüber B in Prozent; null, wenn nicht definiert. */
  aDiffPct: number | null;
  /** Abweichung B gegenüber A in Prozent; null, wenn nicht definiert. */
  bDiffPct: number | null;
};

export function compareKpi(a: number | null, b: number | null): KpiComparison {
  const both = a !== null && b !== null;
  return {
    aValue: a,
    bValue: b,
    aDiffPct: both ? pctDiff(a, b) : null,
    bDiffPct: both ? pctDiff(b, a) : null,
  };
}
