/**
 * STAT3f — kumulierte Jahresvergleiche (Jan…M) je Standort über die letzten
 * fünf Jahre. Reine Funktion auf der BESTEHENDEN MB1-Monatsmatrix (dieselbe
 * Quelle wie der 13-Monats-Verlauf) — kein neuer Datenweg, nur ein anderes
 * Fenster und eine Summierung.
 *
 * Zwei Regeln tragen die Aussage:
 *  - Klemmung (MB3-Lehre): läuft der Berichtsmonat noch, kumulieren ALLE Jahre
 *    nur bis M−1. Nie sieben laufende Monate gegen acht volle.
 *  - Lücken (Variante B): fehlt einem Jahr auch nur EIN Monat des Fensters,
 *    liefert das Jahr `null` statt einer plausiblen falschen Teilsumme.
 */

import { monthKey, type MonthlyCell } from "./monthly-core";

export type YtdSeriesInput = {
  name: string;
  cells: readonly MonthlyCell[];
};

export type YtdCompare = {
  /** Letzter kumulierter Monat (1..12); 0 ⇒ leeres Fenster, Grafik entfällt. */
  throughMonth: number;
  /** Aufsteigend [J−(n−1) … J]; leer bei leerem Fenster. */
  years: number[];
  /** Je Standort ein Wert pro Jahr; null = Historie unvollständig. */
  series: Array<{ name: string; values: Array<number | null> }>;
  /** Jahre, in denen mindestens ein Standort eine Lücke hat (für die Fußnote). */
  incompleteYears: number[];
};

/** Σ Jan…`throughMonth`; null, sobald ein Monat des Fensters fehlt. */
function ytdOrNull(
  cells: readonly MonthlyCell[],
  year: number,
  throughMonth: number,
): number | null {
  let sum = 0;
  for (let m = 1; m <= throughMonth; m++) {
    const cell = cells.find((c) => c.year === year && c.month === m);
    if (!cell) return null;
    sum += cell.totalCents;
  }
  return sum;
}

export function ytdByYear(
  series: readonly YtdSeriesInput[],
  focusYear: number,
  focusMonth: number,
  /** "YYYY-MM" des laufenden Kalendermonats; löst die Klemmung aus. */
  currentMonthKey?: string,
  yearCount = 5,
): YtdCompare {
  const focusIsRunning =
    currentMonthKey !== undefined && monthKey(focusYear, focusMonth) === currentMonthKey;
  const throughMonth = focusIsRunning ? focusMonth - 1 : focusMonth;
  if (throughMonth < 1) {
    return { throughMonth: 0, years: [], series: [], incompleteYears: [] };
  }
  const n = Math.max(1, Math.trunc(yearCount));
  const years: number[] = [];
  for (let back = n - 1; back >= 0; back--) years.push(focusYear - back);

  const out = series.map((s) => ({
    name: s.name,
    values: years.map((y) => ytdOrNull(s.cells, y, throughMonth)),
  }));
  const incompleteYears = years.filter((_, i) => out.some((s) => s.values[i] === null));
  return { throughMonth, years, series: out, incompleteYears };
}
