// Reine Funktion: erzeugt aus den BESTÄTIGTEN Dienstplan-Schichten eines
// Geschäftstags + den standort-spezifischen Standardzeiten einen Snapshot
// für `session_tip_pool_entries`. Wird bei der Eröffnung einer Session
// in die DB geschrieben und seit RS1 zusätzlich additiv nach jeder
// Dienstplan-Änderung an einer offenen Session (Bestätigen/Ändern/Tauschen)
// erneut ausgeführt. Idempotenz über `on conflict (session_id, staff_id)
// do nothing` — bestehende Einträge (Zeiten, Trinkgeld, shift_end) bleiben
// unverändert; nur fehlende Zeilen kommen hinzu.
//
// Regeln:
//   * Bereichs-Priorität pro Mitarbeiter: gl (Ausschluss) > kitchen > service.
//     Wer an dem Tag IRGENDEINE gl-Schicht hat, wird als gl geschnappschusst
//     (Franks Hausregel TP-GL: GL-Schicht dominiert und schließt vom
//     Trinkgeldpool aus). Ohne gl-Schicht gilt kitchen > service.
//     Mehrfacheinteilung ergibt so genau eine Zeile.
//   * Küche/Service: shift_start/shift_end aus
//     location_department_defaults; hours_minutes via kitchenShiftMinutes.
//     Fehlt das Default oder ist es unvollständig → null/null/0.
//   * GL: department='gl', shift_start=null, shift_end=null,
//     hours_minutes=0. GL bekommt nie Trinkgeld; der Eintrag dient nur als
//     Arbeitszeit-Anker. Frank trägt Zeiten bei Bedarf manuell nach.
//
// Hinweis: `session_tip_pool_entries` trägt damit bewusst auch
// Nicht-Trinkgeld-Arbeitszeit (GL). Der Verteil-Algorithmus
// (`computeTipPool`) ignoriert alles außer kitchen/service über
// `staffDepartments`.

import { kitchenShiftMinutes } from "./kitchen-shift-hours";
import type { StaffDepartment } from "@/lib/staff-domain";

export type RosterShiftInput = {
  staffId: string;
  area: StaffDepartment;
};

export type DefaultsByArea = Partial<
  Record<"kitchen" | "service" | "gl", { checkin: string | null; checkout: string | null }>
>;

export type SnapshotEntry = {
  staffId: string;
  department: StaffDepartment;
  shiftStart: string | null;
  shiftEnd: string | null;
  hoursMinutes: number;
};

// gl dominiert (Ausschluss), sonst kitchen > service.
const PRIORITY: Record<StaffDepartment, number> = {
  gl: 3,
  kitchen: 2,
  service: 1,
};

export function buildRosterPoolSnapshot(input: {
  rosterShifts: RosterShiftInput[];
  defaultsByArea: DefaultsByArea;
}): SnapshotEntry[] {
  // Pro Mitarbeiter: gl dominiert (Ausschluss); sonst gewinnt kitchen > service.
  const winner = new Map<string, StaffDepartment>();
  for (const s of input.rosterShifts) {
    const prev = winner.get(s.staffId);
    if (!prev || PRIORITY[s.area] > PRIORITY[prev]) {
      winner.set(s.staffId, s.area);
    }
  }

  const out: SnapshotEntry[] = [];
  for (const [staffId, dept] of winner) {
    if (dept === "gl") {
      // GLD1: GL bekommt Zeiten aus location_department_defaults (falls
      // gepflegt); Tagestyp-Auswahl passiert bereits im Aufrufer via
      // resolvePoolDefaults, das das Ergebnis in `defaultsByArea.gl` ablegt.
      const glDef = input.defaultsByArea.gl;
      const glIn = glDef?.checkin ?? null;
      const glOut = glDef?.checkout ?? null;
      if (!glIn || !glOut) {
        out.push({
          staffId,
          department: "gl",
          shiftStart: null,
          shiftEnd: null,
          hoursMinutes: 0,
        });
        continue;
      }
      const s = glIn.slice(0, 5);
      const e = glOut.slice(0, 5);
      let minutes = 0;
      try {
        minutes = kitchenShiftMinutes(s, e);
      } catch {
        minutes = 0;
      }
      out.push({
        staffId,
        department: "gl",
        shiftStart: s,
        shiftEnd: e,
        hoursMinutes: minutes,
      });
      continue;
    }
    const def = input.defaultsByArea[dept];
    const checkin = def?.checkin ?? null;
    const checkout = def?.checkout ?? null;
    // Service: `default_checkout` ist bewusst variabel (Abgabezeit setzt
    // shift_end später) — `default_checkin` allein genügt. Küche
    // braucht weiterhin beide Defaults (feste Schicht).
    if (dept === "service") {
      if (!checkin) {
        out.push({
          staffId,
          department: dept,
          shiftStart: null,
          shiftEnd: null,
          hoursMinutes: 0,
        });
        continue;
      }
      out.push({
        staffId,
        department: dept,
        shiftStart: checkin.slice(0, 5),
        shiftEnd: null,
        hoursMinutes: 0,
      });
      continue;
    }
    if (!checkin || !checkout) {
      out.push({
        staffId,
        department: dept,
        shiftStart: null,
        shiftEnd: null,
        hoursMinutes: 0,
      });
      continue;
    }
    // Defaults kommen als "HH:MM" oder "HH:MM:SS" aus Postgres `time`.
    const start = checkin.slice(0, 5);
    const end = checkout.slice(0, 5);
    let minutes = 0;
    try {
      minutes = kitchenShiftMinutes(start, end);
    } catch {
      minutes = 0;
    }
    out.push({
      staffId,
      department: dept,
      shiftStart: start,
      shiftEnd: end,
      hoursMinutes: minutes,
    });
  }
  return out;
}
