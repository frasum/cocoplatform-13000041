// FK1 — Ferien-Hinweise für die Tagesabrechnung (reine Logik, EV1-R2-Muster).
//
// Kein new Date() im Kern: der Kalendertag wird injiziert (die Kasse liefert
// ihren Geschäftstag). Regeln identisch zu den Event-Notices:
//   - läuft heute  ⇒ ausschließlich "holiday_running" mit Tag x/y (auch Tag 1)
//   - beginnt morgen ⇒ "holiday_tomorrow"
// Ferien haben KEINE Lohn-/SFN-Wirkung; sie sind Dauerkontext, keine Impact-Stufe.

import { shiftIsoDay, type EventNotice } from "./event-notices";
import {
  schoolHolidayOn,
  type SchoolHolidayPeriod,
  type SchoolHolidayRegion,
} from "@/lib/time/school-holidays";

/** Eine Antwort für die Kassen-Kopfzeile: Events zuerst, Ferien als Dauerkontext. */
export type TodayNotices = {
  events: EventNotice[];
  schoolHolidays: SchoolHolidayNotice[];
};

export type SchoolHolidayNotice =
  | { kind: "holiday_tomorrow"; name: string }
  | { kind: "holiday_running"; name: string; dayIndex: number; dayCount: number };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayValue(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function diffDays(fromIso: string, toIso: string): number {
  return Math.round((dayValue(toIso) - dayValue(fromIso)) / DAY_MS);
}

function running(p: SchoolHolidayPeriod, todayISO: string): SchoolHolidayNotice {
  return {
    kind: "holiday_running",
    name: p.name,
    dayIndex: diffDays(p.from, todayISO) + 1,
    dayCount: diffDays(p.from, p.to) + 1,
  };
}

export function schoolHolidayNotices(
  todayISO: string,
  region: SchoolHolidayRegion = "BY",
): SchoolHolidayNotice[] {
  const today = schoolHolidayOn(todayISO, region);
  if (today) return [running(today, todayISO)];

  const tomorrowISO = shiftIsoDay(todayISO, 1);
  const tomorrow = schoolHolidayOn(tomorrowISO, region);
  if (tomorrow && tomorrow.from === tomorrowISO) {
    return [{ kind: "holiday_tomorrow", name: tomorrow.name }];
  }
  return [];
}
