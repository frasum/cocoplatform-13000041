// LG3a — Rückwirkung eines neuen Stundensatzes.
//
// Reine Berechnung, damit Server-Handler und UI identisch entscheiden:
// `valid_from` darf frühestens auf den Beginn der laufenden Abrechnungs-
// periode (26. → 25.) zurückliegen; alles davor ist gesperrt. „Heute" liefert
// der Aufrufer als YYYY-MM-DD in Europa/Berlin (siehe `todayIso`), damit die
// Regel testbar bleibt.

import { currentBillingCycle } from "./billing-cycle";

export function isValidFromAllowed(validFromIso: string, todayIso: string): boolean {
  const { startDate } = currentBillingCycle(todayIso);
  return validFromIso >= startDate;
}

export function periodStart(todayIso: string): string {
  return currentBillingCycle(todayIso).startDate;
}