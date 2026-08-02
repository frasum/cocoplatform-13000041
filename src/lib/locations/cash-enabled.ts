// LS1 — Standort-Merkmal „nur Planung" (public.locations.cash_enabled).
// Reines Filtermodul analog roster-plannable: entscheidet, ob ein Standort
// in KASSEN- und AUSWERTUNGSlisten erscheint. Dienstplan, Zeiterfassung,
// Urlaub, Lohn und Personalverwaltung nutzen diesen Filter NICHT.
//
// `is_active` bleibt der übergeordnete Schalter: inaktiv ⇒ nirgends.

/** Minimale Zeilenform: nur das Feld, das über Kassen-Sichtbarkeit entscheidet. */
export type CashEnabledRow = {
  /** false = reiner Planungs-Standort. undefined/null = Bestand, gilt als Kassenstandort. */
  cashEnabled?: boolean | null;
};

/** true, wenn der Standort in Kassen-/Statistiklisten erscheinen darf. */
export function isCashEnabled(row: CashEnabledRow): boolean {
  return row.cashEnabled !== false;
}

/** Filtert eine Standortliste auf Kassen-/Auswertungsstandorte. */
export function filterCashEnabled<T extends CashEnabledRow>(rows: readonly T[]): T[] {
  return rows.filter((r) => isCashEnabled(r));
}
