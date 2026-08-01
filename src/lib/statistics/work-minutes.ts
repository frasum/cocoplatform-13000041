// STAT2 — Gemeinsame Arbeitszeit-Quelle der Statistik (rein, ohne IO).
//
// KGL-Begründung (Bauherren-Entscheid „b", 01.08.2026): Umsatz-Tab und
// Personalquote-Tab müssen für immer dieselben Stunden zeigen. Deshalb gibt es
// GENAU EINE Mapping-Regel von `time_entries`-Zeilen auf Minuten:
// Brutto-Anwesenheit (`grossMinutesBetween`) → `paidMinutes` mit dem
// Org-Schalter `pausen_bezahlt`. Die Org fährt derzeit `pausen_bezahlt = true`,
// daher liefert `paidMinutes` momentan exakt die Brutto-Anwesenheit; kommt
// später ein Pausenabzug, ändern sich BEIDE Panels gemeinsam. Keine zweite
// Stundenformel, keine Kopie dieser Logik.
//
// Offene Einträge (`ended_at` null) werden ausgelassen — identisch zum
// bisherigen Personalquote-Pfad.

import { grossMinutesBetween } from "@/lib/time/break-rules";
import { paidMinutes } from "@/lib/time/paid-hours";
import type { Department } from "@/lib/time/primary-department";

export type TimeEntryRow = {
  staff_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  break_minutes: number | null;
  business_date: string | null;
  department?: string | null;
};

export type WorkMinutesEntry = {
  staffId: string;
  businessDate: string;
  netMinutes: number;
  rawDepartment: Department | null;
};

/** Einzige Umrechnung Zeiteintrag → Vergütungsminuten. */
export function mapTimeEntryRows(
  rows: readonly TimeEntryRow[],
  pausenBezahlt: boolean,
): WorkMinutesEntry[] {
  const out: WorkMinutesEntry[] = [];
  for (const r of rows) {
    if (!r.ended_at || !r.started_at || !r.business_date || !r.staff_id) continue;
    const gross = grossMinutesBetween(new Date(r.started_at), new Date(r.ended_at));
    out.push({
      staffId: r.staff_id,
      businessDate: r.business_date,
      netMinutes: paidMinutes(gross, r.break_minutes ?? 0, pausenBezahlt),
      rawDepartment: (r.department as Department | null) ?? null,
    });
  }
  return out;
}

/** Tagesaggregation der Vergütungsminuten (Schlüssel = business_date). */
export function workMinutesByDate(entries: readonly WorkMinutesEntry[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    byDate.set(e.businessDate, (byDate.get(e.businessDate) ?? 0) + e.netMinutes);
  }
  return byDate;
}

export function totalWorkMinutes(entries: readonly WorkMinutesEntry[]): number {
  let total = 0;
  for (const e of entries) total += e.netMinutes;
  return total;
}