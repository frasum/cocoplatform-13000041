// UB1-ICS — Abwesenheiten als ICS-Events, Typ eindeutig erkennbar.
//
// Reine Logik, kein I/O: gruppiert Kalendertage nach dem ECHTEN
// Abwesenheitstyp (nicht nach der Blockier-Klasse), merged
// aufeinanderfolgende Tage je Typ und liefert Label + CATEGORIES-Tag.
// Damit unterscheidet ein Kalender-Client "Urlaub (unbezahlt)" von
// bezahltem Urlaub — vorher waren beide als "Urlaub" exportiert.

import type { RosterIcsEvent } from "@/lib/calendar/roster-ics";
import { ABSENCE_LABEL, normalizeAbsenceType, type AbsenceType } from "@/lib/roster/absence-types";
import { mergeAbsenceRanges } from "@/lib/roster/vacation-planner";

/** Maschinenlesbarer Tag je Typ (CATEGORIES-Wert im ICS). */
export const ABSENCE_ICS_CATEGORY: Record<AbsenceType, string> = {
  urlaub: "URLAUB",
  krank: "KRANK",
  urlaub_unbezahlt: "URLAUB_UNBEZAHLT",
};

function shiftIso(iso: string, deltaDays: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function buildAbsenceIcsEvents(
  rows: Array<{ date: string; type: unknown }>,
  staffId: string,
): RosterIcsEvent[] {
  const byType = new Map<AbsenceType, string[]>();
  for (const r of rows) {
    const t = normalizeAbsenceType(r.type);
    const arr = byType.get(t) ?? [];
    arr.push(r.date);
    byType.set(t, arr);
  }
  const events: RosterIcsEvent[] = [];
  for (const [type, dates] of byType) {
    for (const range of mergeAbsenceRanges(dates)) {
      events.push({
        uid: `absence-${type}-${staffId}-${range.start}@coco`,
        summary: ABSENCE_LABEL[type],
        location: "",
        allDay: true,
        date: range.start,
        endDateExclusive: shiftIso(range.end, 1),
        categories: [ABSENCE_ICS_CATEGORY[type]],
      });
    }
  }
  return events;
}
