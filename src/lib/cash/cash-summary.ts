// Reine Berechnungs-Funktion für den vier-zeiligen Bargeld-Block der
// Tagesabrechnung. Keine Server-Aufrufe, keine UI.
//
// - Tages-Bargeld = computeDailyCash(dayInput)
// - cashActual == null → Differenz null, Tresor = Tages-Bargeld
// - sonst Differenz = cashActual − cashTarget,
//         Tresor    = Tages-Bargeld − Differenz

import { computeDailyCash, type DayInput } from "./cash-ledger";

export type SummaryRows = {
  tagesBargeldCents: number;
  differenzCents: number | null;
  tresorCents: number;
};

export function computeSummaryRows(args: {
  dayInput: DayInput;
  cashActualCents: number | null;
  cashTargetCents: number;
}): SummaryRows {
  const tagesBargeldCents = computeDailyCash(args.dayInput);
  if (args.cashActualCents == null) {
    return {
      tagesBargeldCents,
      differenzCents: null,
      tresorCents: tagesBargeldCents,
    };
  }
  const differenzCents = args.cashActualCents - args.cashTargetCents;
  return {
    tagesBargeldCents,
    differenzCents,
    tresorCents: tagesBargeldCents - differenzCents,
  };
}

/**
 * Rollender operativer Saldo über Vortage (≤ 0). Pro Tag wird das
 * `rawBargeld` addiert, ein Überschuss aber sofort abgeschöpft, sodass
 * nur Defizit weiterläuft. Eingabe chronologisch (ältester zuerst).
 */
export function rollOperativeDeficitCents(rawBargeldByDayCents: number[]): number {
  let bal = 0;
  for (const raw of rawBargeldByDayCents) {
    bal += raw;
    bal -= Math.max(0, bal);
  }
  return bal;
}

/**
 * Tages-Ergebnis inkl. Vortagsdefizit. `previousDeficitCents` ≤ 0.
 * - diff = TagesBargeld + min(0, Vortagsdefizit)
 * - Tresor = max(0, diff)
 * - Wechselgeldbestand = Soll + min(0, diff)
 * - diffToTargetSignedCents = UNGEKAPPTE, vorzeichenbehaftete Differenz zum
 *   Soll-Bestand (WG1). Die Bestands-Kappung bleibt unverändert (Überschuss
 *   wandert in den Tresor); nur die Anzeige-Differenz ist beidseitig ehrlich.
 */
export function computeWechselgeld(args: {
  tagesBargeldCents: number;
  previousDeficitCents: number;
  cashTargetCents: number;
}): {
  diffCents: number;
  tresorCents: number;
  wechselgeldbestandCents: number;
  diffToTargetSignedCents: number;
} {
  const diff = args.tagesBargeldCents + Math.min(0, args.previousDeficitCents);
  return {
    diffCents: diff,
    tresorCents: Math.max(0, diff),
    wechselgeldbestandCents: args.cashTargetCents + Math.min(0, diff),
    diffToTargetSignedCents: diff,
  };
}
