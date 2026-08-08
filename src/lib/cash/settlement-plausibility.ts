// KA3 Teil 1 — Reine Entscheidungslogik für die laute Rückfrage bei
// Fremd-/Geisterabgabe.
//
// Produktionsvorfall 06.08.2026: Eine Kollegin gab unter dem noch
// angemeldeten Konto eines krank heimgegangenen Kellners ab. Das System
// hatte DREI Signale (keine offene Stempelung, kein Pool-Eintrag, kein
// Dienstplan-Eintrag) und lief kommentarlos durch.
//
// Regel: Nur ALLE DREI negativ lösen eine Rückfrage aus. Ein einzelnes
// fehlendes Signal (Nicht-Stempler MIT Pool-Eintrag — Normalfall vieler
// Aushilfen) bleibt still.

export type SettlementPlausibility = {
  /** offene Stempelung des Callers */
  hasOpenTimeEntry: boolean;
  /** Pool-Eintrag in der Session */
  hasPoolEntry: boolean;
  /** Dienstplan-Eintrag am Geschäftstag */
  hasRosterShift: boolean;
};

/** Alle drei Signale fehlen. */
export function isTripleNegative(p: SettlementPlausibility): boolean {
  return !p.hasOpenTimeEntry && !p.hasPoolEntry && !p.hasRosterShift;
}

/** Rückfrage nötig: dreifach-negativ UND noch nicht bestätigt. */
export function needsForeignConfirmation(
  p: SettlementPlausibility,
  confirmedForeign: boolean | undefined,
): boolean {
  return isTripleNegative(p) && confirmedForeign !== true;
}

/**
 * Ist die Bestätigung wirksam? NUR bei tatsächlich dreifach-negativer Lage —
 * kein Freifahrtschein für andere Fälle.
 */
export function foreignConfirmationAccepted(
  p: SettlementPlausibility,
  confirmedForeign: boolean | undefined,
): boolean {
  return confirmedForeign === true && isTripleNegative(p);
}
