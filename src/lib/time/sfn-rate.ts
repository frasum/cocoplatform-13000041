// ST1-C2 — Bewertungssatz der SFN-ÜBERSICHT (Zeit-Admin): Hauptbereichs-Satz
// der Person am Stichtag, aus staff_compensation_rates.
//
// BEWUSSTE NÄHERUNG (Bauherren-Entscheid Variante a, §117): Die Übersicht
// bewertet alle SFN-Stunden einer Person mit EINEM Satz — dem ihres
// Hauptbereichs (primaryDepartment: gl > kitchen > service). Die exakte,
// bereichsgenaue SFN-Bewertung liegt im Lohnrechner (D4) und wird hier
// nicht dupliziert. Kein Satz gepflegt → null (Variant B: Lücke zeigen,
// nie still mit 0 bewerten — der Aufrufer entscheidet über die Anzeige).

import { resolveRateCents, type RateRow } from "@/lib/lohn/rate-resolution";
import { primaryDepartment, type Department } from "./primary-department";

export function sfnOverviewRateCents(
  staffDepts: readonly Department[],
  rates: readonly RateRow[],
  onDate: string,
): number | null {
  return resolveRateCents(rates, primaryDepartment(staffDepts), onDate);
}