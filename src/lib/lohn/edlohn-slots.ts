// SL1 — edlohn-Zeitlohn-Slots je Person.
//
// In edlohn ist die Zeitlohn-Nummer die ANLAGE-REIHENFOLGE der Lohnart JE
// PERSON, kein bereichsweites Schema: 38 von 40 Personen laufen auf Slot 1
// (edlohn-Ist Juli 2026, Lohnbüro-bestätigt 31.07.2026). Vorher leitete
// COCO Bezeichnung und Kategorie starr vom Bereich ab (service→zeitlohn,
// gl→zeitlohn_2, kitchen→zeitlohn_3) — das war für Ein-Bereich-GL- und
// Küchen-Personen falsch.
//
// Geltungsbereich (Nullmessung, Auftragsfassung 31.07.):
//   Geschützt sind die RECHENWERTE — Stunden, Sätze, Beträge, SFN-Töpfe und
//   Blocker-Verhalten. Dieses Modul entscheidet ausschließlich über
//   Bezeichnung, Kategorie und Spaltenzuordnung. Es rechnet nichts.
//
// Blocker-Regel (K1, Auftragsfassung):
//   Nicht-raten-bar ist der Slot NUR, wenn mehrere Bereiche mit Stunden
//   UNTERSCHIEDLICHE aufgelöste Sätze haben und kein vollständiges Mapping
//   vorliegt. Bei identischen Sätzen (GERARD: Service + GL, beide 20,80 €)
//   führt edlohn genau EINE Zeitlohn-Zeile — ohne Mapping laufen dann alle
//   Bereiche auf Slot 1 und die Zeilen aggregieren sich zu einer. Das ist
//   das edlohn-Ist, kein Ratefall.

import type { Department } from "@/lib/time/primary-department";

/** Grenze gegen Fließkomma-Rauschen — identisch zu export-blockers.ts. */
const HOURS_EPS = 1e-9;

export type SlotNumber = 1 | 2 | 3;

export interface SlotBucket {
  department: Department;
  /** Bezahlte Stunden UNGERUNDET. */
  paidHoursUnrounded: number;
  /** Aufgelöster Bereichssatz in Cent/h; null = kein Satz gepflegt. */
  rateCents: number | null;
}

export interface SlotMappingRow {
  department: Department;
  slot: SlotNumber;
}

export interface SlotResolution {
  /** Slot je Bereich MIT Stunden. Bereiche ohne Stunden erscheinen nicht. */
  slots: ReadonlyMap<Department, SlotNumber>;
  /**
   * true, wenn ≥ 2 Bereiche mit Stunden ≥ 2 unterschiedliche Satz-Werte
   * tragen und kein vollständiges Mapping vorliegt → Blocker
   * `missing_slot_mapping`.
   */
  mappingMissing: boolean;
  /** Bereiche mit Stunden, für die kein Mapping-Eintrag existiert. */
  unmappedDepartments: readonly Department[];
}

const DEPT_LABEL: Record<Department, string> = {
  service: "Service",
  gl: "GL",
  kitchen: "Küche",
};

const SLOT_KATEGORIE: Record<SlotNumber, "zeitlohn" | "zeitlohn_2" | "zeitlohn_3"> = {
  1: "zeitlohn",
  2: "zeitlohn_2",
  3: "zeitlohn_3",
};

function hasHours(h: number): boolean {
  return h > HOURS_EPS;
}

/** Kategorie der Zeitlohn-Zeile für einen Slot (Nicht-Minijob). */
export function slotKategorie(slot: SlotNumber): "zeitlohn" | "zeitlohn_2" | "zeitlohn_3" {
  return SLOT_KATEGORIE[slot];
}

/**
 * Bezeichnung der Zeitlohn-Zeile. Slot 1 bleibt „Zeitlohn"; der Bereichs-
 * Zusatz in Klammern bleibt für den Lohnbüro-Abgleich erhalten und listet
 * bei aggregierten Zeilen alle beteiligten Bereiche.
 */
export function slotLabel(
  slot: SlotNumber,
  departments: readonly Department[],
  minijob: boolean,
): string {
  const base = minijob ? "Aushilfe-Zeitlohn" : "Zeitlohn";
  const nummer = slot > 1 ? ` ${slot}` : "";
  const bereiche = departments.map((d) => DEPT_LABEL[d]).join(", ");
  return minijob
    ? `${base}${nummer} (${bereiche}, pauschal)`
    : `${base}${nummer} (${bereiche})`;
}

/**
 * Löst die Slots für alle Bereiche mit Stunden auf. Ein vollständiges
 * Mapping gewinnt immer. Ohne vollständiges Mapping entscheiden die
 * aufgelösten Sätze (K1).
 */
export function resolveEdlohnSlots(
  buckets: readonly SlotBucket[],
  mapping: readonly SlotMappingRow[],
): SlotResolution {
  const active = buckets.filter((b) => hasHours(b.paidHoursUnrounded));
  const mapByDept = new Map<Department, SlotNumber>();
  for (const m of mapping) mapByDept.set(m.department, m.slot);

  const slots = new Map<Department, SlotNumber>();
  if (active.length === 0) {
    return { slots, mappingMissing: false, unmappedDepartments: [] };
  }

  const unmapped = active.filter((b) => !mapByDept.has(b.department)).map((b) => b.department);

  // (1) Vollständiges Mapping gewinnt — auch bei einem einzigen Bereich.
  if (unmapped.length === 0) {
    for (const b of active) slots.set(b.department, mapByDept.get(b.department)!);
    return { slots, mappingMissing: false, unmappedDepartments: [] };
  }

  // (2) Ein Bereich mit Stunden → Slot 1 (edlohn-Ist für 38/40 Personen).
  if (active.length === 1) {
    slots.set(active[0].department, 1);
    return { slots, mappingMissing: false, unmappedDepartments: unmapped };
  }

  // (3) Mehrere Bereiche, aber genau EIN Satz-Wert → eine Zeitlohn-Zeile
  //     auf Slot 1 (GERARD-Fall). Kein Blocker: der Slot ist eindeutig.
  const distinctRates = new Set(active.map((b) => b.rateCents));
  if (distinctRates.size <= 1) {
    for (const b of active) slots.set(b.department, 1);
    return { slots, mappingMissing: false, unmappedDepartments: unmapped };
  }

  // (4) Mehrere Bereiche mit unterschiedlichen Sätzen und ohne vollständiges
  //     Mapping: der Slot ist nicht bestimmbar. Deterministische Notbelegung
  //     in Bucket-Reihenfolge, damit die Anzeige die getrennten Sätze zeigt —
  //     der Export wird über `mappingMissing` geblockt.
  let next: SlotNumber = 1;
  for (const b of active) {
    slots.set(b.department, mapByDept.get(b.department) ?? next);
    if (next < 3) next = (next + 1) as SlotNumber;
  }
  return { slots, mappingMissing: true, unmappedDepartments: unmapped };
}
