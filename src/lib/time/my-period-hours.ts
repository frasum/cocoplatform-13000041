// Z1 — reines Modul: Vergütungs-Minuten je Zeit-Eintrag, Gruppierung nach
// business_date und Periodensummen. Keine I/O, keine DB-Zugriffe.
//
// PB2 — die Vergütungsminuten folgen dem Org-Schalter `pausenBezahlt`
// (`paidMinutes`): Nein → grossMinutes − breakMinutes (bit-identisch zum
// vor-PB2-Verhalten), Ja → grossMinutes. Offene Einträge (endedAt = null)
// fließen NICHT in Tages-/Periodensummen.

import { grossMinutesBetween } from "./break-rules";
import { paidMinutes } from "./paid-hours";

export type EntryInput = {
  businessDate: string;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
};

export function entryNetMinutes(e: EntryInput, pausenBezahlt: boolean = false): number | null {
  if (!e.endedAt) return null;
  const gross = grossMinutesBetween(new Date(e.startedAt), new Date(e.endedAt));
  return paidMinutes(gross, e.breakMinutes ?? 0, pausenBezahlt);
}

export type DayGroup<E extends EntryInput> = {
  businessDate: string;
  entries: E[];
  netMinutes: number;
};

export function groupEntriesByDay<E extends EntryInput>(
  entries: E[],
  pausenBezahlt: boolean = false,
): DayGroup<E>[] {
  const byDay = new Map<string, E[]>();
  for (const e of entries) {
    const list = byDay.get(e.businessDate);
    if (list) list.push(e);
    else byDay.set(e.businessDate, [e]);
  }
  const dates = Array.from(byDay.keys()).sort();
  return dates.map((businessDate) => {
    const dayEntries = byDay.get(businessDate)!;
    let net = 0;
    for (const e of dayEntries) {
      const n = entryNetMinutes(e, pausenBezahlt);
      if (n !== null) net += n;
    }
    return { businessDate, entries: dayEntries, netMinutes: net };
  });
}

export function periodTotalMinutes(entries: EntryInput[], pausenBezahlt: boolean = false): number {
  let total = 0;
  for (const e of entries) {
    const n = entryNetMinutes(e, pausenBezahlt);
    if (n !== null) total += n;
  }
  return total;
}

export function formatMinutes(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, "0")} h`;
}
