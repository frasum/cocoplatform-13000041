// LG3b — Per-Eintrag Attribution eines time_entries-Datensatzes auf einen
// Arbeitsbereich (Department). Dünner, reiner Wrapper um
// `entryRowDepartment` (aus src/lib/time/primary-department.ts), damit die
// Payroll-Engine und die Zusammenfassung *dieselbe* Attribution nutzen —
// eine Regel, ein Ort. Keine Rate-Auflösung, keine Buckets, keine
// Cent-Rechnung: nur die Zeilen-Entscheidung.
//
// Rückgabe-Kontrakt:
//   - `department`: Zeile, unter der die Stunden dieses Eintrags erscheinen
//     (Priorität gl > kitchen > service via Fallback).
//   - `unresolved`: true, wenn der Eintrag eine `rawDepartment` trägt, die
//     die Person am Standort nicht (mehr) hat. Aus Zusammenfassungs-Sicht
//     ist das der bekannte „mismatched"-Fall; für den Export (Etappe 2)
//     ist es der Blocker-Grund `unresolved_department`.
//
// Etappe 1: dieses Modul wird noch nirgends aufgerufen; die Verdrahtung
// in `lohn-period.functions.ts` und `lohn-rechner.functions.ts` gehört
// definitionsgemäß in Etappe 2 (siehe docs/LG3b-bereichs-saetze.md).

import { entryRowDepartment, type Department } from "@/lib/time/primary-department";

export interface AttributionInput {
  rawDepartment: Department | null;
  staffDepts: readonly Department[];
  rosterArea?: Department | null;
  rosterHasGlSkill?: boolean;
  /**
   * Ob am fraglichen Tag ein Dienstplan existiert. Falls nicht angegeben,
   * leitet `entryRowDepartment` es aus `rosterArea || rosterHasGlSkill` ab
   * — identisch zum Wochenplan-/Zusammenfassungs-Pfad.
   */
  rosterPlanned?: boolean;
}

export interface AttributionResult {
  department: Department;
  unresolved: boolean;
}

export function attributeEntry(input: AttributionInput): AttributionResult {
  const { department, mismatched } = entryRowDepartment(
    input.rawDepartment ?? null,
    input.staffDepts,
    {
      rosterArea: input.rosterArea ?? null,
      rosterHasGlSkill: input.rosterHasGlSkill ?? false,
      rosterPlanned: input.rosterPlanned,
    },
  );
  return { department, unresolved: mismatched };
}
