// LG3b — Harter Export-Gate. Reines Modul: nimmt eine Liste
// `StaffExportPayload` entgegen und liefert je Person eine Blocker-Liste
// mit strukturierten Gründen. Das Werfen erledigt `assertExportUnblocked`
// — es wird in Etappe 2 aus `buildUebersichtCsv`/`buildLohnXlsx` direkt
// aufgerufen (A4: das Gate sitzt in den Build-Funktionen, nicht im UI).
//
// Auflagen (siehe docs/LG3b-bereichs-saetze.md):
//   * Prüfmenge ist ausschließlich Personen mit Stunden in der Periode.
//     Payroll-Zugänge ohne Stunden (z. B. Viktoria Schaffer) blockieren nie.
//   * Prüfung auf ungerundeten `paidHours` — 0,2 h zählt, auch wenn die
//     Anzeige 0,00 zeigt. Toleranz nur gegen Fließkomma-Rauschen.
//   * Vier Gründe: `missing_rate`, `missing_perso_nr`, `unresolved_department`
//     und (SL1) `missing_slot_mapping`. Eine Person kann mehrere gleichzeitig
//     haben; ein Grund je Bucket-Detail.
//   * SL1 — `missing_slot_mapping` greift NUR, wenn ≥ 2 Bereiche mit Stunden
//     ≥ 2 unterschiedliche aufgelöste Sätze tragen und kein vollständiges
//     edlohn-Slot-Mapping vorliegt. Bei identischen Sätzen ist der Slot
//     eindeutig (alle auf 1, eine aggregierte Zeile) — kein Blocker.

import type { Department } from "@/lib/time/primary-department";

/** Grenze gegen Fließkomma-Rauschen — 1 Sekunde ≈ 0,000278 h. */
const HOURS_EPS = 1e-9;

export type BlockerReason =
  | "missing_rate"
  | "missing_perso_nr"
  | "unresolved_department"
  | "missing_slot_mapping";

export interface DeptBucket {
  department: Department;
  /** Bezahlte Stunden UNGERUNDET (nicht auf ¼-Stunde gekappt). */
  paidHoursUnrounded: number;
  /** Aufgelöster Bereichs-Satz in Cent/h, oder null wenn kein Satz gepflegt. */
  rateCents: number | null;
}

export interface StaffExportPayload {
  staffId: string;
  staffLabel: string;
  /** Personalnummer aus staff.perso_nr; null/leer, wenn ungepflegt. */
  persoNr: string | null;
  /** Buckets je Bereich, in dem die Person Stunden in der Periode hat. */
  buckets: readonly DeptBucket[];
  /** UNGERUNDETE Stunden von Einträgen, deren Bereich nicht zuordenbar war. */
  unresolvedHoursUnrounded: number;
  /**
   * SL1 — Bereiche mit Stunden ohne edlohn-Slot-Mapping, obwohl der Slot
   * wegen unterschiedlicher Sätze nicht bestimmbar ist. Leer/undefined =
   * kein Slot-Blocker.
   */
  unmappedSlotDepartments?: readonly Department[];
}

export interface BlockerDetail {
  reason: BlockerReason;
  /** Bereich, wenn der Grund bereichs-spezifisch ist (missing_rate). */
  department?: Department;
  /** Stunden im betroffenen Bucket bzw. unresolved-Topf. */
  hoursUnrounded?: number;
}

export interface StaffBlocker {
  staffId: string;
  staffLabel: string;
  persoNr: string | null;
  reasons: BlockerDetail[];
}

/**
 * Strukturierte Exception für den Export-Gate. Trägt die vollständige
 * Blocker-Liste — das UI zeigt sie im Dialog an, ohne selbst zu rechnen.
 */
export class LohnExportBlockedError extends Error {
  readonly blockers: readonly StaffBlocker[];
  constructor(blockers: readonly StaffBlocker[]) {
    super(`Lohn-Export blockiert für ${blockers.length} Person(en).`);
    this.name = "LohnExportBlockedError";
    this.blockers = blockers;
  }
}

function hasHours(h: number): boolean {
  return h > HOURS_EPS;
}

function personoNrLeer(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

/**
 * Ermittelt Blocker je Person. Personen ganz ohne Stunden (Summe der
 * Buckets + unresolved = 0) tauchen nicht auf.
 */
export function computeExportBlockers(payloads: readonly StaffExportPayload[]): StaffBlocker[] {
  const out: StaffBlocker[] = [];
  for (const p of payloads) {
    const totalHours =
      p.buckets.reduce((s, b) => s + b.paidHoursUnrounded, 0) + p.unresolvedHoursUnrounded;
    if (!hasHours(totalHours)) continue; // keine Stunden → nie Blocker

    const reasons: BlockerDetail[] = [];

    // (1) fehlende Personalnummer — greift, sobald Stunden anfallen.
    if (personoNrLeer(p.persoNr)) {
      reasons.push({ reason: "missing_perso_nr" });
    }

    // (2) unresolved_department — Stunden, deren Bereich WZ2 nicht klärt.
    if (hasHours(p.unresolvedHoursUnrounded)) {
      reasons.push({
        reason: "unresolved_department",
        hoursUnrounded: p.unresolvedHoursUnrounded,
      });
    }

    // (3) missing_rate — je Bucket mit Stunden aber ohne aufgelösten Satz.
    for (const b of p.buckets) {
      if (!hasHours(b.paidHoursUnrounded)) continue;
      if (b.rateCents == null) {
        reasons.push({
          reason: "missing_rate",
          department: b.department,
          hoursUnrounded: b.paidHoursUnrounded,
        });
      }
    }

    // (4) SL1 — fehlendes edlohn-Slot-Mapping bei mehreren Bereichen mit
    // unterschiedlichen Sätzen. Ein Grund je betroffenem Bereich.
    for (const d of p.unmappedSlotDepartments ?? []) {
      reasons.push({ reason: "missing_slot_mapping", department: d });
    }

    if (reasons.length > 0) {
      out.push({
        staffId: p.staffId,
        staffLabel: p.staffLabel,
        persoNr: p.persoNr ?? null,
        reasons,
      });
    }
  }
  return out;
}

/** Wirft `LohnExportBlockedError`, wenn irgendein Blocker vorliegt. */
export function assertExportUnblocked(payloads: readonly StaffExportPayload[]): void {
  const blockers = computeExportBlockers(payloads);
  if (blockers.length > 0) {
    throw new LohnExportBlockedError(blockers);
  }
}
