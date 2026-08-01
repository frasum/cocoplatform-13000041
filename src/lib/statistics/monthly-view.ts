/**
 * MB2 — Ansichts-Umschalter „Gesamt | Takeaway" für die Monatsentwicklung.
 *
 * Semantik: Takeaway ist eine TEILMENGE des Gesamtumsatzes (N14-Zerlegung).
 * Deshalb ein Umschalter statt einer Zusatzspalte — nebeneinander dargestellt
 * würde die Takeaway-Spalte zur Addition verleiten und den Umsatz verdoppeln.
 *
 * Reine Funktionen: keine DB-Zugriffe, keine Seiteneffekte, keine Neu-Rechnung
 * von Umsätzen. Es wird ausschließlich zwischen den bereits vorhandenen Feldern
 * `totalCents` und `takeawayCents` der Zellen ausgewählt. Fehlende
 * Takeaway-Werte (Legacy vor 2021) bleiben null — kein 0-Fake.
 */

import { monthlyHeadline } from "./monthly-core";
import type { MonthlyCell, MonthlyHeadline, YearRow } from "./monthly-core";

export type MonthlyViewMode = "total" | "takeaway";

/** Zellen-Selektor: Wert der Zelle in der gewählten Ansicht (null = keine Daten). */
export function cellValueCents(cell: MonthlyCell | null, mode: MonthlyViewMode): number | null {
  if (cell === null) return null;
  return mode === "total" ? cell.totalCents : cell.takeawayCents;
}

/**
 * Zellen auf die gewählte Ansicht projizieren: im Takeaway-Modus zählt der
 * Takeaway-Wert als `totalCents`, Zellen ohne Takeaway-Wert fallen weg.
 * So rechnen YoY/YTD im TA-Modus nur über vorhandene Werte.
 */
export function projectCells(cells: readonly MonthlyCell[], mode: MonthlyViewMode): MonthlyCell[] {
  if (mode === "total") return [...cells];
  return cells
    .filter((c) => c.takeawayCents !== null)
    .map((c) => ({ ...c, totalCents: c.takeawayCents as number }));
}

export function viewHeadline(
  cells: readonly MonthlyCell[],
  year: number,
  month: number,
  mode: MonthlyViewMode,
  currentMonthKey?: string,
): MonthlyHeadline {
  return monthlyHeadline(projectCells(cells, mode), year, month, currentMonthKey);
}

export type MonthlyViewYearRow = {
  year: number;
  /** Original-Zellen (für Tooltips/Quelle), unabhängig von der Ansicht. */
  cells: (MonthlyCell | null)[];
  /** 12 Werte der gewählten Ansicht; null = keine Daten. */
  values: (number | null)[];
  /** 12 Werte für den Linien-Chart: wie `values`, aber laufende Monate (partial) sind null. */
  chartValues: (number | null)[];
  /** Σ der vorhandenen Werte des Jahres. */
  totalCents: number;
};

/** Jahresreihen der gewählten Ansicht; Jahre ohne jeden Wert fallen weg. */
export function viewYearRows(
  years: readonly YearRow[],
  mode: MonthlyViewMode,
): MonthlyViewYearRow[] {
  return years
    .map((y) => {
      const values = y.months.map((c) => cellValueCents(c, mode));
      // MB3 — der laufende Monat ist unvollständig und würde die Linie
      // senkrecht abstürzen lassen; im Chart daher als Lücke.
      const chartValues = y.months.map((c) => (c?.partial ? null : cellValueCents(c, mode)));
      return {
        year: y.year,
        cells: [...y.months],
        values,
        chartValues,
        totalCents: values.reduce<number>((s, v) => s + (v ?? 0), 0),
      };
    })
    .filter((r) => r.values.some((v) => v !== null));
}

/** Maximum der Ansicht — Basis der Heatmap-Farbskala (TA-Modus: TA-Maximum). */
export function viewMaxCents(rows: readonly MonthlyViewYearRow[]): number {
  let max = 0;
  for (const r of rows) {
    for (const v of r.values) {
      if (v !== null && v > max) max = v;
    }
  }
  return max;
}
