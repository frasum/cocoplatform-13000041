// RS1 — Merkmal „im Dienstplan planbar" (public.staff.roster_plannable).
// Reines Filtermodul: entscheidet, ob eine Person in Planungs-Personenlisten
// (Wochenplan, Zuweisung, Displays, Tausch-Peers) erscheint. Zeiterfassung,
// Lohn und die allgemeine Personalliste nutzen diesen Filter NICHT.

/** Minimale Zeilenform: nur die zwei Felder, die über Sichtbarkeit entscheiden. */
export type PlannableRow = {
  /** false = Mitarbeiter inaktiv. undefined/null = Bestand, gilt als aktiv. */
  isActive?: boolean | null;
  /** false = nicht im Dienstplan planbar. undefined/null = Bestand, gilt als planbar. */
  rosterPlannable?: boolean | null;
};

/** true, wenn die Person in Planungslisten erscheinen darf. */
export function isPlannable(row: PlannableRow): boolean {
  return row.isActive !== false && row.rosterPlannable !== false;
}

/** Filtert eine Personenliste auf planbare, aktive Personen. */
export function filterPlannable<T extends PlannableRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => isPlannable(r));
}
