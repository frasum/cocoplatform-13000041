// TG5 — Umsatz je Arbeitsstunde für den Telegram-Tagesbericht.
//
// EINE Formelwahrheit: die Kennzahl kommt aus `derivedKpis` (Statistik-Kern,
// STAT2). Hier wird KEINE zweite Stundenzählung und keine eigene Division
// gebaut — nur der Aufruf mit den bereits geladenen Tageswerten und das
// Telegram-Format („76 €/Std", ganze Euro; ohne Stunden „— €/Std").

import { derivedKpis } from "@/lib/statistics/revenue-core";

/** Umsatz je Arbeitsstunde in Cents; Stunden 0 ⇒ null (kein 0-Fake). */
export function revenuePerWorkHourCents(input: {
  totalCents: number;
  workMinutes: number;
}): number | null {
  return derivedKpis({
    houseCents: 0,
    totalCents: input.totalCents,
    guestCount: 0,
    workMinutes: input.workMinutes,
  }).revenuePerWorkHourCents;
}

/** Format wie die Statistik-Kachel: ganze Euro, „—" wenn nicht definiert. */
export function fmtEuroPerHour(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "— €/Std";
  return `${Math.round(cents / 100).toLocaleString("de-DE")} €/Std`;
}
