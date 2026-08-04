// UB2 — Urlaubskonto-VORSCHLAG: reine Rechnung, keine Buchung.
//
// Führend ist edlohn; `staff.vacation_days_*` sind im Stammblatt manuell
// gepflegt. Aufzehrungs-Reihenfolge und Verfall sind im Modell NICHT
// abgebildet — deshalb entsteht hier ausschließlich ein Vorschlag, den ein
// Mensch per Knopf übernimmt (keine stille Umbuchung).

import { isoWeekday } from "@/lib/roster/business-calendar";
import { getHolidayName } from "@/lib/roster/holidays-display";

export type VacationBalanceInput = {
  /** staff.vacation_days_previous_year */
  previousYear: number | null;
  /** staff.vacation_days_current_year */
  currentYear: number | null;
  /** staff.vacation_days_taken (manuell gepflegt) */
  taken: number | null;
  /**
   * Bereits BESTÄTIGTE Urlaubstage des laufenden Jahres aus
   * `lohn_absence_days` — nur der Teil, der noch NICHT in `taken` steckt.
   * Doppelzählungs-Schutz: der Aufrufer übergibt beide Zahlen, diese
   * Funktion rechnet nur.
   */
  confirmedNotInTaken: number;
};

/**
 * Verfügbare bezahlte Urlaubstage:
 * previous_year + current_year − taken − bestätigte (nicht in taken) U-Tage.
 *
 * `null` in einem der Kontofelder ⇒ Ergebnis `null` („Konto nicht gepflegt");
 * es wird bewusst KEINE 0 vorgetäuscht. Ergebnis ist nie negativ.
 */
export function availablePaidVacationDays(input: VacationBalanceInput): number | null {
  if (input.previousYear == null || input.currentYear == null || input.taken == null) return null;
  const avail =
    input.previousYear - input.taken + input.currentYear - Math.max(0, input.confirmedNotInTaken);
  return Math.max(0, avail);
}

/**
 * Vorschlag: die ersten `available` Arbeitstage (chronologisch) bleiben
 * bezahlt, der Rest wird als unbezahlt vorgeschlagen.
 */
export function splitVacationProposal(
  workdays: readonly string[],
  available: number,
): { paid: string[]; unpaid: string[] } {
  const sorted = [...workdays].sort();
  const n = Math.max(0, Math.floor(available));
  return { paid: sorted.slice(0, n), unpaid: sorted.slice(n) };
}

/**
 * Arbeitstag im Sinne des Vorschlags: Mo–Fr und kein bayerischer Feiertag.
 * Wochenend- und Feiertagstage bleiben bei der Übernahme unangetastet.
 */
export function isVacationWorkday(dateIso: string): boolean {
  return isoWeekday(dateIso) <= 5 && getHolidayName(dateIso) == null;
}
