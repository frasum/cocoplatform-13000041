// LG3b — Reine Satz-Auflösung je Zeiteintrag.
//
// Jüngstes `validFrom ≤ businessDate` im passenden Bereich; KEIN
// Bereichs-Fallback. `null` = kein Satz gepflegt (LG-9-Fall). Cent-Konvertierung
// findet an genau einer Stelle statt: im IO-Rand (`lohn-period.functions.ts`),
// vor Aufruf dieses Moduls. Hier wird nichts umgerechnet — nur ausgewählt.

import type { Department } from "@/lib/time/primary-department";

export type RateRow = {
  department: Department;
  validFrom: string; // ISO-Datum YYYY-MM-DD
  hourlyRateCents: number;
};

export function resolveRateCents(
  rates: readonly RateRow[],
  department: Department,
  businessDate: string,
): number | null {
  let best: RateRow | null = null;
  for (const r of rates) {
    if (r.department !== department) continue;
    if (r.validFrom > businessDate) continue;
    if (best === null || r.validFrom > best.validFrom) best = r;
  }
  return best?.hourlyRateCents ?? null;
}
