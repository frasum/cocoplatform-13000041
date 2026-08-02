// EV1-R2 — Reine Hinweis-Logik für die Tagesabrechnung.
//
// Kein new Date() im Kern: der Kalendertag wird injiziert (die Kasse liefert
// ihren Geschäftstag). F1/F2 des EV1-Grilling-Protokolls:
//   - "tomorrow": date_from === heute + 1 Tag
//   - "running":  date_from <= heute <= date_to, mit Tag x/y
// Am Starttag gilt ausschließlich "running Tag 1/y" — kein Doppel-Hinweis.

import { EVENT_IMPACTS, type EventImpact, type EventRow } from "./events-core";

export type EventNotice = {
  kind: "tomorrow" | "running";
  name: string;
  impact: EventImpact;
  provisional: boolean;
  /** nur running: */ dayIndex?: number;
  /** nur running: */ dayCount?: number;
  /** nur tomorrow: */ dateFrom?: string;
};

const IMPACT_RANK: Record<EventImpact, number> = {
  sehr_hoch: 0,
  hoch: 1,
  mittel_hoch: 2,
  mittel: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO-Tag (YYYY-MM-DD) -> UTC-Zeitstempel auf Mittag (DST-neutral). */
function dayValue(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

function addDays(iso: string, days: number): string {
  const shifted = new Date(dayValue(iso) + days * DAY_MS);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function diffDays(fromIso: string, toIso: string): number {
  return Math.round((dayValue(toIso) - dayValue(fromIso)) / DAY_MS);
}

export function eventNotices(events: readonly EventRow[], todayISO: string): EventNotice[] {
  const tomorrow = addDays(todayISO, 1);
  const notices: { notice: EventNotice; dateFrom: string }[] = [];

  for (const ev of events) {
    if (!(EVENT_IMPACTS as readonly string[]).includes(ev.impact)) continue;
    if (ev.dateFrom <= todayISO && todayISO <= ev.dateTo) {
      notices.push({
        dateFrom: ev.dateFrom,
        notice: {
          kind: "running",
          name: ev.name,
          impact: ev.impact,
          provisional: ev.provisional,
          dayIndex: diffDays(ev.dateFrom, todayISO) + 1,
          dayCount: diffDays(ev.dateFrom, ev.dateTo) + 1,
        },
      });
      continue;
    }
    if (ev.dateFrom === tomorrow) {
      notices.push({
        dateFrom: ev.dateFrom,
        notice: {
          kind: "tomorrow",
          name: ev.name,
          impact: ev.impact,
          provisional: ev.provisional,
          dateFrom: ev.dateFrom,
        },
      });
    }
  }

  notices.sort((a, b) => {
    const byImpact = IMPACT_RANK[a.notice.impact] - IMPACT_RANK[b.notice.impact];
    if (byImpact !== 0) return byImpact;
    return a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0;
  });

  return notices.map((n) => n.notice);
}
