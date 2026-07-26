// Z2 — deterministische Primär-Abteilung eines Mitarbeiters am Standort.
//
// time_entries hat KEINE Abteilungs-Dimension: die Stunden einer Person
// laufen daher immer auf genau EINER Zeile auf. Damit dieselbe Person nicht
// je nach Row-Reihenfolge einmal unter KÜCHE, einmal unter GL landet, wird
// die Primär-Abteilung aus den staff_locations-Zuordnungen deterministisch
// gewählt.
//
// WZ1/KGL — Reihenfolge: gl > kitchen > service. Deckungsgleich mit der
// TP-GL-Hausregel in `src/lib/cash/roster-pool-snapshot.ts` (Franks
// Referenz-Regel für den Kassen-Pool). Vorher lief hier
// kitchen > service > gl — LAM (service+gl) erschien in der Zusammen-
// fassung nie unter Geschäftsleitung. Fallback (leere Liste): "service"
// — konsistent mit dem historischen Default in getTimeOverview /
// getWeeklyTimeEntries.

export type Department = "kitchen" | "service" | "gl";

const PRIORITY: Department[] = ["gl", "kitchen", "service"];

export function primaryDepartment(depts: readonly Department[]): Department {
  for (const d of PRIORITY) {
    if (depts.includes(d)) return d;
  }
  return "service";
}

// Z3 — Zeilen-Attribution eines time_entries-Eintrags im Wochenplan.
//
// Regel:
//   * entryDept != null UND ∈ staffDepts → dieser Eintrag gehört zur Zeile
//     dieser Abteilung.
//   * entryDept == null → NULL-Fall (Stempel/Batch/Pool/Bestandsdaten) →
//     Anzeige auf der Primär-Zeile (PRIORITY: gl > kitchen > service).
//   * entryDept != null aber NICHT in staffDepts → Person ist der
//     Abteilung am Standort (nicht mehr) zugeordnet: Anzeige auf der
//     Primär-Zeile + `mismatched: true` für Tooltip/Warnung. Kein
//     stilles Verschlucken.
export function entryRowDepartment(
  entryDept: Department | null | undefined,
  staffDepts: readonly Department[],
  opts?: {
    rosterArea?: Department | null;
    // WZ2 — Der Dienstplan-Skill des Tages hat Kategorie 'gl' (D-3: GL
    // ist ein Skill, kein Bereich). Wenn true, ist die Schicht laut Plan
    // eine GL-Schicht und routet abteilungslose Stempelungen zur GL-Zeile
    // — unabhängig davon, ob die Person „GL-Person" ist.
    rosterHasGlSkill?: boolean;
    // WZ2 — Explizites „Es gibt einen Tagesplan"-Signal, damit die
    // GL-Skill-Regel auch dann greift, wenn area=null (Skill-only)
    // und Z3b keinen Bereich hätte. Default: abgeleitet aus
    // rosterArea || rosterHasGlSkill.
    rosterPlanned?: boolean;
  },
): { department: Department; mismatched: boolean } {
  if (entryDept && staffDepts.includes(entryDept)) {
    return { department: entryDept, mismatched: false };
  }
  // WZ2 — Die Schicht hat den Typ, nicht die Person (Frank 16.07.).
  // Tages-Skill aus dem Dienstplan ist die Typ-Quelle; die W2-Personen-
  // vermutung greift nur noch als Fallback ohne Tagesplan.
  if (entryDept == null) {
    const planned =
      opts?.rosterPlanned ?? (Boolean(opts?.rosterArea) || Boolean(opts?.rosterHasGlSkill));
    if (planned) {
      // (1) Tages-Roster mit GL-Skill → GL. Die W2-Pauschal-Übersteuerung
      // für GL-Personen entfällt hier: LAM in einer Service-Schicht ist
      // Service, auch wenn LAM „GL-Person" ist.
      if (opts?.rosterHasGlSkill) {
        return { department: "gl", mismatched: false };
      }
      // (2) Tages-Roster ohne GL-Skill → Z3b: geplanter Bereich, sofern
      // die Person diesen Bereich hat.
      if (opts?.rosterArea && staffDepts.includes(opts.rosterArea)) {
        return { department: opts.rosterArea, mismatched: false };
      }
      // (2b) Roster-Area nicht in staffDepts → fällt auf statische Priorität.
    } else {
      // (3) Kein Tages-Roster: W2-Rest — GL-Personen (GERARD/Andre) landen
      // ohne Plan-Signal auf der GL-Zeile; andere fallen auf statische
      // Priorität.
      if (staffDepts.includes("gl")) {
        return { department: "gl", mismatched: false };
      }
    }
  }
  return {
    department: primaryDepartment(staffDepts),
    mismatched: entryDept != null,
  };
}
