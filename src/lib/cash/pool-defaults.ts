// GLD1 — Tagestyp-abhängige Pool-Defaults.
//
// Ein Standort kann pro Bereich neben `default_checkin/checkout` optional
// zusätzlich `default_checkin_sunday_holiday` und
// `default_checkout_sunday_holiday` pflegen. An Sonntagen und bayerischen
// Feiertagen gelten dann diese abweichenden Zeiten (Franks Hausregel: GL
// Mo–Sa 17:00–01:00, So/Feiertag 15:00–02:00). Ohne Sonderwert bleibt es
// beim regulären Default.
//
// Reines Modul: nur ISO-Datum + `getHolidayName` — kein DB-Zugriff.

import { getHolidayName } from "@/lib/roster/holidays-display";

export type DepartmentDefaultRow = {
  default_checkin: string | null;
  default_checkout: string | null;
  default_checkin_sunday_holiday: string | null;
  default_checkout_sunday_holiday: string | null;
};

export type ResolvedDefaults = {
  checkin: string | null;
  checkout: string | null;
};

/**
 * Sonntag = UTC-Wochentag 0 (ISO-Datum ist zeitzonenfrei; UTC-Getter ist
 * die stabile Wahl). Feiertag wird über `getHolidayName` gemeldet.
 */
export function isSundayOrHoliday(dateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCDay() === 0) return true;
  return getHolidayName(dateIso) !== null;
}

/**
 * Wählt zwischen regulären Werten und Sonntag/Feiertag-Werten. Ist der
 * Sonderwert nicht gepflegt, fällt die Auflösung bewusst NICHT auf den
 * Werktags-Default zurück (an So/Feiertag soll GL/Küche/Service dann keine
 * Zeit als „gearbeitet" mitschleifen).
 */
export function resolvePoolDefaults(
  row: DepartmentDefaultRow | null | undefined,
  dateIso: string,
): ResolvedDefaults {
  if (!row) return { checkin: null, checkout: null };
  if (isSundayOrHoliday(dateIso)) {
    return {
      checkin: row.default_checkin_sunday_holiday,
      checkout: row.default_checkout_sunday_holiday,
    };
  }
  return {
    checkin: row.default_checkin,
    checkout: row.default_checkout,
  };
}