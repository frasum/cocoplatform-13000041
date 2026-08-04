// Urlaub/Krank-Diagnose (Schritt 1b, READ-ONLY): reine Helfer ohne Seiteneffekte.
// Wird von urlaub-krank-diagnose.ts genutzt. Keine Lohnart, kein Brutto-Eingriff.

/** Anteil Arbeitstage am Fenster: (gearbeitet + abwesend) / Fenstertage, geklemmt [0,1]. */
export function workRate(scheduledDays: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.min(1, Math.max(0, scheduledDays / windowDays));
}

/** Geschätzte Arbeitstage einer Abwesenheit (Näherung, rotierender Plan). */
export function estimateWorkdays(calendarDays: number, rate: number): number {
  return Math.round(calendarDays * rate);
}

/**
 * UB1 — Kalendertage der Periode nach Typ trennen. `urlaub_unbezahlt` wird
 * getrennt geführt: die Person war weg, die Tage sind aber NICHT
 * fortzahlungsrelevant und dürfen den Urlaubs-Vorschlag nicht erhöhen.
 */
export function splitAbsenceCalDays(rows: ReadonlyArray<{ type: string }>): {
  urlaub: number;
  krank: number;
  urlaubUnbezahlt: number;
} {
  let urlaub = 0;
  let krank = 0;
  let urlaubUnbezahlt = 0;
  for (const r of rows) {
    if (r.type === "urlaub") urlaub += 1;
    else if (r.type === "krank") krank += 1;
    else if (r.type === "urlaub_unbezahlt") urlaubUnbezahlt += 1;
  }
  return { urlaub, krank, urlaubUnbezahlt };
}
