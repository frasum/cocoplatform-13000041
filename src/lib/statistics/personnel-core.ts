// M-Statistik S-8 / ST1-A — Personalquote: reine Funktionen.
//
// EHRLICHKEITSREGEL (unverändert): Diese Stufe rechnet *Basis-Brutto-
// Lohnkosten*: bezahlte Stunden × Bereichs-Stundensatz.
//
// Bewusst NICHT enthalten (spätere Lohn-Modul-Stufe):
//   - Arbeitgeber-SV-Anteil
//   - SFN-Zuschläge
//
// Der Wert ist eine NÄHERUNG der Brutto-Lohnkosten, NICHT die volle
// Arbeitgeberkostenquote.
//
// ST1-A — Quelle und Regeln:
//   * Satz-Quelle ist `staff_compensation_rates` (drei Bereiche, echte
//     valid_from-Historie), aufgelöst je Zeiteintrag über
//     `resolveRateCents` — dieselbe Funktion wie im Lohnpfad (KGL).
//   * Die Bereichs-Attribution je Eintrag kommt vom IO-Rand aus
//     `attributeEntry` (LG3b); hier wird sie nur konsumiert.
//   * Variant B: Stunden ohne auflösbaren Satz (oder mit unauflösbarer
//     Attribution) werden AUSGEWIESEN (`unratedNetHours`), niemals still
//     mit 0 € bewertet und in die Kosten gemischt.
//
// Rein, deterministisch. Ganzzahlige Cents intern.

import type { Department } from "@/lib/time/primary-department";
import { resolveRateCents, type RateRow } from "@/lib/lohn/rate-resolution";

export type WorkEntry = {
  staffId: string;
  businessDate: string; // "YYYY-MM-DD"
  netMinutes: number; // bereits netto/bezahlt (>= 0)
  /** Ergebnis der LG3b-Attribution (attributeEntry) — vom IO-Rand geliefert. */
  department: Department;
  /** true, wenn die Attribution nicht auflösbar war (WZ2-mismatched). */
  unresolved: boolean;
};

export type PersonnelPerStaff = {
  staffId: string;
  netHours: number; // 2 Nachkommastellen
  laborCostCents: number;
  /** Stunden dieser Person ohne bewerteten Satz (2 Nachkommastellen). */
  unratedNetHours: number;
};

export type PersonnelAgg = {
  totalNetHours: number; // 2 Nachkommastellen
  totalLaborCostCents: number;
  /** Stunden, die mangels gepflegtem Bereichs-Satz NICHT bewertet wurden. */
  unratedNetHours: number;
  perStaff: PersonnelPerStaff[]; // absteigend nach laborCostCents
  staffWithoutRate: string[]; // staffIds mit ≥1 unbewerteter Stunde
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function aggregatePersonnel(
  entries: WorkEntry[],
  ratesByStaff: Record<string, RateRow[]>,
): PersonnelAgg {
  const perStaffMap = new Map<
    string,
    { netHours: number; laborCostCents: number; unratedNetHours: number }
  >();
  const withoutRate = new Set<string>();

  for (const e of entries) {
    const netHours = e.netMinutes / 60;
    const rateCents = e.unresolved
      ? null
      : resolveRateCents(ratesByStaff[e.staffId] ?? [], e.department, e.businessDate);
    // Cent-genau je Eintrag — keine EUR-Zwischenstufe, kein Float-Aufsummieren.
    const cost = rateCents === null ? 0 : Math.round(netHours * rateCents);
    if (rateCents === null) withoutRate.add(e.staffId);

    const cur = perStaffMap.get(e.staffId) ?? {
      netHours: 0,
      laborCostCents: 0,
      unratedNetHours: 0,
    };
    cur.netHours += netHours;
    cur.laborCostCents += cost;
    if (rateCents === null) cur.unratedNetHours += netHours;
    perStaffMap.set(e.staffId, cur);
  }

  let totalNetHours = 0;
  let totalLaborCostCents = 0;
  let unratedNetHours = 0;
  const perStaff: PersonnelPerStaff[] = [];
  for (const [staffId, agg] of perStaffMap.entries()) {
    totalNetHours += agg.netHours;
    totalLaborCostCents += agg.laborCostCents;
    unratedNetHours += agg.unratedNetHours;
    perStaff.push({
      staffId,
      netHours: round2(agg.netHours),
      laborCostCents: agg.laborCostCents,
      unratedNetHours: round2(agg.unratedNetHours),
    });
  }
  perStaff.sort((a, b) => b.laborCostCents - a.laborCostCents);

  return {
    totalNetHours: round2(totalNetHours),
    totalLaborCostCents,
    unratedNetHours: round2(unratedNetHours),
    perStaff,
    staffWithoutRate: Array.from(withoutRate).sort(),
  };
}

/**
 * Personalquote in Prozent. revenue 0 → null (kein definierter Wert).
 * Einzige Quote-Definition — UI ruft diese Funktion mit den Totals aus
 * getPersonnelStats + getRevenueStats.
 */
export function personnelRatioPct(laborCostCents: number, revenueCents: number): number | null {
  if (revenueCents === 0) return null;
  return (laborCostCents / revenueCents) * 100;
}
