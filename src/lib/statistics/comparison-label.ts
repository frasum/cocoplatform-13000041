// Untertitel-Text für die Statistik-Kacheln: welcher Zeitraum wird verglichen?
//
// Reine Formatierung, keine Berechnung. Das Vergleichsfenster kommt fertig aus
// den Statistik-Server-Funktionen (`previousRange`).

export type ComparisonRange = { startDate: string; endDate: string };

function dmy(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

function dm(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/**
 * Kompakter deutscher Vergleichshinweis, z. B.
 *  - gleicher Monat:      "vs. 01.–18.06.2026"
 *  - über Monatsgrenze:   "vs. 29.06.–09.07.2026"
 *  - Einzeltag:           "vs. 18.06.2026"
 *
 * `partial: true` (laufender Monat unvollständig, Vormonat auf denselben
 * Tagesausschnitt geklemmt) ergänzt "(gleicher Tagesausschnitt)".
 *
 * Ohne Vergleichsfenster: null — die UI zeigt dann keinen Untertitel.
 */
export function formatComparisonRange(
  range: ComparisonRange | null | undefined,
  opts?: { partial?: boolean },
): string | null {
  if (!range) return null;
  const { startDate, endDate } = range;
  let core: string;
  if (startDate === endDate) {
    core = dmy(startDate);
  } else if (startDate.slice(0, 7) === endDate.slice(0, 7)) {
    core = `${startDate.slice(8, 10)}.–${dmy(endDate)}`;
  } else {
    core = `${dm(startDate)}–${dmy(endDate)}`;
  }
  return opts?.partial ? `vs. ${core} (gleicher Tagesausschnitt)` : `vs. ${core}`;
}