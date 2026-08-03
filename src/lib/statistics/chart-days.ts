// STAT4a — Achsen-Skelett für die Bildschirm-Charts.
//
// Reine Funktionen, UTC-sicher. Liefert für ein Fenster (Monat oder freier
// Zeitraum) ALLE Kalendertage als Achse und hängt die vorhandenen Datentage
// daran. Unterschied zu `fillDailyGaps` (Balken-Logik des PDFs): fehlende
// Tage bleiben hier LEER (`point === null`) statt 0 — ein Tag ohne Session
// ist keine Null-Umsatz-Aussage. Ein echter 0-Umsatz-Tag (Session mit 0)
// kommt als Datenpunkt und bleibt eine echte 0.

import type { DailyPoint } from "./chart-fill";

export type ChartDaySlot = {
  /** ISO-Kalendertag der Achse. */
  businessDate: string;
  /** Zweistellige Tagesnummer — X-Achsen-Label. */
  day: string;
  /** Datentag, falls vorhanden; sonst `null` (ehrliche Lücke). */
  point: DailyPoint | null;
};

function toUtcMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${d.getUTCFullYear()}-${m < 10 ? `0${m}` : m}-${day < 10 ? `0${day}` : day}`;
}

/** Alle Kalendertage von `startDate` bis `endDate` (inklusive). */
export function spanDays(startDate: string, endDate: string): string[] {
  if (endDate < startDate) return [];
  const out: string[] = [];
  const endMs = toUtcMs(endDate);
  for (let ms = toUtcMs(startDate); ms <= endMs; ms += 86_400_000) out.push(fromUtcMs(ms));
  return out;
}

/**
 * Achse = volles Fenster; Datentage werden per `business_date` zugeordnet.
 * Datentage außerhalb des Fensters werden ignoriert (die Achse ist die
 * Wahrheit über den Zeitraum). Bei Duplikaten gewinnt der letzte Eintrag.
 */
export function chartDaySlots(
  daily: readonly DailyPoint[],
  range: { startDate: string; endDate: string },
): ChartDaySlot[] {
  const byDate = new Map<string, DailyPoint>();
  for (const p of daily) byDate.set(p.businessDate, p);
  return spanDays(range.startDate, range.endDate).map((iso) => ({
    businessDate: iso,
    day: iso.slice(8, 10),
    point: byDate.get(iso) ?? null,
  }));
}
