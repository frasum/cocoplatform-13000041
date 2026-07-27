// LG3b Etappe 2a-i — G1: Gewichteter 91-Tage-Durchschnittssatz für U/K bei
// Mehrsatz-Personen. Rein arithmetisches Modul ohne IO. Die Beschaffung des
// 91-Tage-Fensters (paidHours je Bereich vor Periodenbeginn) und der
// Bereichs-Sätze erfolgt außerhalb (Etappe 2a-iii) und wird hier als
// aufbereitete Struktur hereingereicht.
//
// Regel (Auftrag, G1 = Option c):
//   - Ein-Bereich-Person: unverändert; der Aufrufer verwendet direkt den
//     Bereichssatz (dieses Modul kommt in dem Pfad gar nicht zum Einsatz).
//   - Mehr-Bereichs-Person: gewichteter Mittel-Satz über die Bereiche mit
//     `paidHours > 0` im 91-Tage-Referenzfenster:
//         rate = round( Σ (paidHours_d × rateCents_d) / Σ paidHours_d )
//   - Fehlt für einen Bereich mit `paidHours > 0` der Satz (LG-9), gibt es
//     KEIN stilles Ersatzergebnis: das Modul liefert `null`. Der Aufrufer
//     muss entscheiden (Anzeige-Pfad: 0 € + roter Marker; Export-Pfad:
//     Blocker `missing_rate`).
//   - Ohne bezahlte Stunden im Fenster: `null`. Der Aufrufer entscheidet,
//     wie er U/K in diesem Grenzfall bewertet (Bauherren-Entscheidung
//     außerhalb dieses Moduls).
//
// Bewusst NICHT hier: das Herausfiltern der Ein-Bereichs-Fälle. Der Aufrufer
// entscheidet, wann er `computeWeightedUkRate` überhaupt aufruft — genau
// so bleibt die Nullmessung (Ein-Bereich) frei von jeder Verhaltensänderung.

import type { Department } from "@/lib/time/primary-department";

/** Ein Bereichs-Slot im 91-Tage-Referenzfenster. */
export interface UkRateSlot {
  department: Department;
  /** Bezahlte Stunden im 91-Tage-Fenster in diesem Bereich. Ungerundet. */
  paidHours: number;
  /**
   * Aufgelöster Bereichssatz zum Periodenbeginn (jüngstes
   * `valid_from ≤ periodStart`). `null` = kein Satz gepflegt.
   */
  rateCents: number | null;
}

export interface WeightedUkRateResult {
  /** Gewichteter Cent-Satz, auf ganze Cent gerundet. `null` = nicht bestimmbar. */
  rateCents: number | null;
  /**
   * Grund für `null`, sonst `undefined`. Nützlich für Diagnose und Blocker:
   *   - `no_hours`: kein Bereich hatte bezahlte Stunden im Fenster.
   *   - `missing_rate`: mindestens ein Bereich mit `paidHours > 0` hat
   *     keinen Satz. Zusätzlich enthält `missingDepartments` die Liste.
   */
  reason?: "no_hours" | "missing_rate";
  missingDepartments?: Department[];
}

export function computeWeightedUkRate(
  slots: readonly UkRateSlot[],
): WeightedUkRateResult {
  // Nur Bereiche mit tatsächlich bezahlten Stunden im Fenster fließen ein.
  // (Ungerundet — Blocker-Prüfmenge der Engine folgt derselben Regel.)
  const active = slots.filter((s) => s.paidHours > 0);
  if (active.length === 0) {
    return { rateCents: null, reason: "no_hours" };
  }

  const missing: Department[] = [];
  for (const s of active) {
    if (s.rateCents === null) missing.push(s.department);
  }
  if (missing.length > 0) {
    // Dedup, stabile Reihenfolge (Eingabereihenfolge).
    const seen = new Set<Department>();
    const missingDepartments: Department[] = [];
    for (const d of missing) {
      if (!seen.has(d)) {
        seen.add(d);
        missingDepartments.push(d);
      }
    }
    return { rateCents: null, reason: "missing_rate", missingDepartments };
  }

  let weightedSum = 0;
  let totalHours = 0;
  for (const s of active) {
    // rateCents ist hier per Konstruktion nicht null (missing wäre gesetzt).
    weightedSum += s.paidHours * (s.rateCents as number);
    totalHours += s.paidHours;
  }
  // totalHours > 0 (active.length > 0 und alle paidHours > 0).
  return { rateCents: Math.round(weightedSum / totalHours) };
}