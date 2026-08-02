// KA1 — „Heute" in Kassen-Kontexten ist der GESCHÄFTSTAG (3-Uhr-Cut), nicht
// der Kalendertag: Nach Mitternacht gehört der laufende Abend noch zum Vortag.
// Serverseitig gilt dieselbe Regel (SQL current_business_date, businessDateOf)
// — diese Helfer halten die UI-Einstiege daran.

import { businessDateOf } from "@/lib/business-date";

/** Vorauswahl-Datum der Tagesabrechnung: Geschäftstag mit 3-Uhr-Cut. */
export function defaultCashBusinessDate(now: Date): string {
  return businessDateOf(now);
}

/**
 * Anker-Datum für die Monatsnavigation der Kassen-Listen. Zeigt am Monatsersten
 * um 01:00 noch auf den Vormonat, weil der laufende Geschäftstag dort liegt.
 */
export function cashBusinessMonthAnchor(now: Date): Date {
  const [y, m, d] = defaultCashBusinessDate(now).split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}
