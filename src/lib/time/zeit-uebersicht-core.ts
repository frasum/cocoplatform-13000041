// G1a — Pure Helfer/Typen aus src/routes/_authenticated/admin/zeit-uebersicht.tsx
// extrahiert (Scheibe 1). Verhaltensgleiche 1:1-Verschiebung — keine
// Konsolidierung mit bestehenden Helfern (business-date, format-date). Etwaige
// Dubletten sind unten als TODO markiert und werden separat entschieden.

export type Department = "kitchen" | "service" | "gl";
export type Entry = {
  staffId: string;
  displayName: string;
  department: Department;
  businessDate: string;
  hoursWorked: number;
  breakMinutes: number;
  startedAt?: string;
  endedAt?: string;
  rawDepartment?: Department | null;
};

// bewusst eigenständig: liefert den 1. des LAUFENDEN Kalendermonats in der
// Browser-Lokalzeit (Filter-Default der Zeit-Übersicht). business-date löst
// „Geschäftstag mit 3-Uhr-Cutoff" — semantisch ein anderes Problem. Kein
// zentraler Helfer hat dieselbe Aufgabe.
export function firstOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// bewusst eigenständig: verankert einen reinen YYYY-MM-DD-String auf UTC-Mittag,
// damit die nachfolgende UTC-Tages-Arithmetik (addDays/mondayOf/isoWeek) DST-frei
// bleibt. format-date.parseIsoDate ist modul-privat und liefert {y,m,d} statt Date;
// business-date arbeitet auf Zeitstempeln in Europe/Berlin — beide passen nicht.
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}
// bewusst eigenständig: serialisiert ein UTC-Date zurück nach YYYY-MM-DD und ist
// das Gegenstück zu parseIsoDate für die UTC-Wochen-Arithmetik. format-date liefert
// Anzeige-Strings („Mi 01.06"), keinen ISO-Datumsteil — nicht austauschbar.
export function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
// ISO week (Mon–Sun). Returns {year, week} per ISO 8601.
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay() || 7;
  return addDays(d, 1 - day);
}
export function ddmm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
}
export function fmtHm(hours: number): string {
  if (hours <= 0) return "0:00";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Periodenrhythmus 26.→25.: Label-Monat = Monat des Enddatums.
const MONTH_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
export function periodDefaultStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-26`;
}
export function periodDefaultEnd(): string {
  const d = new Date();
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const m = d.getMonth() === 11 ? 1 : d.getMonth() + 2;
  return `${y}-${String(m).padStart(2, "0")}-25`;
}
// bewusst eigenständig: liefert „<Monat> <Jahr>" (z. B. „März 2026") für die
// Perioden-Auswahl. display/period-split.periodLabel gibt nur den Monatsnamen
// zurück; time/period-label.derivePeriodLabel meint Tageszeit-Fenster
// („Früh/Mittag/Abend"). Beide decken diesen Anzeige-Fall nicht ab.
export function periodLabelForEnd(endIso: string): string {
  const d = parseIsoDate(endIso);
  return `${MONTH_DE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function nextPeriodFromLast(lastEndIso: string): {
  startDate: string;
  endDate: string;
  label: string;
} {
  // Start = letzter Tag + 1 (immer der 26.); End = Folgemonat-25.
  const start = addDays(parseIsoDate(lastEndIso), 1);
  const endMonth = start.getUTCMonth() === 11 ? 0 : start.getUTCMonth() + 1;
  const endYear = start.getUTCMonth() === 11 ? start.getUTCFullYear() + 1 : start.getUTCFullYear();
  const endIso = `${endYear}-${String(endMonth + 1).padStart(2, "0")}-25`;
  return { startDate: fmtIso(start), endDate: endIso, label: periodLabelForEnd(endIso) };
}
export function fmtDDMM(iso: string): string {
  const d = parseIsoDate(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

export type WeekCol = { key: string; label: string; start: string; end: string };

export function buildWeekColumns(fromIso: string, toIso: string): WeekCol[] {
  const cols: WeekCol[] = [];
  const fromD = parseIsoDate(fromIso);
  const toD = parseIsoDate(toIso);
  let cursor = mondayOf(fromD);
  while (cursor.getTime() <= toD.getTime()) {
    const end = addDays(cursor, 6);
    const { year, week } = isoWeek(cursor);
    cols.push({
      key: `${year}-W${String(week).padStart(2, "0")}`,
      label: `KW ${week} ${ddmm(cursor)}–${ddmm(end)}`,
      start: fmtIso(cursor),
      end: fmtIso(end),
    });
    cursor = addDays(cursor, 7);
  }
  return cols;
}

// G1a Scheibe 2 — Gemeinsam genutzte Konstanten/Typen/Helfer für die
// Zeit-Übersicht-Route und ihre ausgelagerten Unterkomponenten. 1:1
// verschoben aus src/routes/_authenticated/admin/zeit-uebersicht.tsx.

import { berlinLocalToIso } from "@/lib/time/shift-hours";
import { entryRowDepartment } from "@/lib/time/primary-department";
import { computeShiftHours } from "@/lib/time/shift-hours";
import { paidHours } from "@/lib/time/paid-hours";
// (computeShiftHours wird in aggregateStaffDeptRows weiter unten benutzt.)

export const DEPT_LABEL: Record<Department, string> = {
  kitchen: "Küche",
  service: "Service",
  gl: "Geschäftsleitung",
};
export const DEPT_BG: Record<Department, string> = {
  kitchen: "bg-orange-50",
  service: "bg-blue-50",
  gl: "bg-gray-50",
};
export const DEPT_BAR: Record<Department, string> = {
  kitchen: "bg-orange-400",
  service: "bg-blue-400",
  gl: "bg-gray-400",
};
export const DEPT_HEADER_LABEL: Record<Department, string> = {
  kitchen: "KÜCHE",
  service: "SERVICE",
  gl: "GESCHÄFTSLEITUNG",
};
export const DEPT_ORDER: Department[] = ["kitchen", "service", "gl"];

export type WeeklyEntry = {
  id: string;
  staffId: string;
  displayName: string;
  department: Department;
  // Z3 — Roh-Abteilung des Eintrags (NULL = unbestimmt/Bestandsdaten).
  rawDepartment?: Department | null;
  businessDate: string;
  startedAt: string;
  endedAt: string;
  // ZS1 — „nicht mehr im Plan": keine planned/confirmed Roster-Schicht mehr
  // für (Person, Geschäftstag). `removable` zusätzlich unberührt.
  notInPlan?: boolean;
  removable?: boolean;
};

export type WeeklyData = {
  weekStart: string;
  weekEnd: string;
  entries: WeeklyEntry[];
  crossLocationDates: Record<string, string[]>;
  assignedStaff?: {
    staffId: string;
    displayName: string;
    department: Department;
    isActive: boolean;
    isPrimary?: boolean;
    // Z3 — alle Abteilungen der Person am Standort (Attribution im Grid).
    staffDepts?: Department[];
    // Z4 — Skill-IDs der Person (Wochenplan-Skill-Filter).
    skillIds?: string[];
  }[];
  // Z4b — Dienstplan-Realität der Woche je Mitarbeiter (aus roster_shifts).
  rosterByStaff?: Record<string, { areas: Department[]; skillIds: string[] }>;
  // Z3b — Per-Tag-Roster-Area je Mitarbeiter (Attribution NULL-Einträge).
  rosterAreaByStaffDate?: Record<string, Record<string, Department>>;
  // WZ2 — Per-Tag-GL-Skill-Flag je Mitarbeiter (Dienstplan-Skill = 'gl').
  // „Die Schicht hat den Typ, nicht die Person" — GL-Skill-Tage routen zur
  // GL-Zeile, auch wenn die Person sonst Service läuft (LAM-Fall).
  rosterGlByStaffDate?: Record<string, Record<string, boolean>>;
};

export function fmtDec(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

// BH1 (24.07.2026) — Viertelstunden-Abrundung für payroll-relevante
// Anzeige-/Export-Summen (edlohn arbeitet in Viertelstunden; Abrunden ist
// die sichere Richtung für die Lohn-Übergabe). REINE Anzeige-Rundung —
// Rohdaten und Rechenpfade bleiben unberührt. Negative Werte werden auf 0
// geklemmt (Stundensummen sind nie negativ; ein Math.floor auf einen
// versehentlich negativen Wert würde stärker nach unten runden).
export function floorToQuarterHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.floor(hours * 4) / 4;
}

export function fmtHHMM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

// Baut einen ISO-Timestamp aus Geschäftsdatum + HH:MM. Die Uhrzeit wird
// IMMER als Europe/Berlin-Wanduhrzeit interpretiert (unabhängig von der
// Browser-Zeitzone), sonst hätten manuelle Korrekturen aus einer anderen
// TZ eine falsche UTC-Zeit ergeben. `fromHHMM` markiert den Start —
// wenn die End-Uhrzeit ECHT KLEINER ist, rollt der Tag um 1 (Mitternachts-
// Wrap). Ende == Start ergibt bewusst KEINEN 24-h-Wrap (siehe
// buildShiftIsosOrThrow unten).
export function buildIsoFromLocal(dateIso: string, hhmm: string, fromHHMM?: string): string {
  const [h, m] = hhmm.split(":").map((v) => Number.parseInt(v, 10));
  let effectiveDate = dateIso;
  if (fromHHMM) {
    const [fh, fm] = fromHHMM.split(":").map((v) => Number.parseInt(v, 10));
    if (h * 60 + m < fh * 60 + fm) {
      const d = new Date(`${dateIso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      effectiveDate = d.toISOString().slice(0, 10);
    }
  }
  return berlinLocalToIso(effectiveDate, h, m);
}

// Liefert Start/Ende als ISO oder wirft, wenn Ende == Start (der Server
// würde sonst einen 24-h-Eintrag anlegen).
export function buildShiftIsosOrThrow(
  dateIso: string,
  from: string,
  to: string,
): { startedAt: string; endedAt: string } {
  if (from === to) {
    throw new Error("Ende darf nicht gleich Start sein.");
  }
  return {
    startedAt: buildIsoFromLocal(dateIso, from),
    endedAt: buildIsoFromLocal(dateIso, to, from),
  };
}

export function dayHeader(d: Date): string {
  const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${names[d.getUTCDay()]} ${ddmm(d)}`;
}

// LG2 (26.07.2026) — Stundenaufteilung nach Schichtart je Mitarbeiter für die
// Buchhaltung. Nutzt exakt die Attribution des Wochenplans (entryRowDepartment
// mit rosterArea + rosterHasGlSkill), damit die Departmental-Aufteilung 1:1
// mit der Zeilen-Attribution im Grid übereinstimmt.
//
// Eingabe:
//   entries — dieselben Perioden-Einträge, die die Payroll-Summen (totalHours)
//     füttern. hoursWorked wird 1:1 verwendet (keine getrennte Rechnung).
//   staffDeptsByStaff — Abteilungs-Zuordnungen der Person (Union über alle
//     Standorte, bei "Alle Standorte").
//   rosterAreaByStaffDate, rosterGlByStaffDate — Dienstplan-Realität der
//     Periode (Union bei "Alle Standorte"); dieselben Signale wie im Grid.
//
// Ausgabe: staffId → (Department → Stunden). Nur befüllte Departments sind
// enthalten (Konsument entscheidet über Anzeigelogik "eine Zahl vs.
// Aufteilung").
export function aggregateHoursByStaffAndDept(input: {
  entries: ReadonlyArray<{
    staffId: string;
    businessDate: string;
    hoursWorked: number;
    rawDepartment?: Department | null;
  }>;
  staffDeptsByStaff: Map<string, Department[]>;
  rosterAreaByStaffDate: Record<string, Record<string, Department>>;
  rosterGlByStaffDate: Record<string, Record<string, boolean>>;
}): Map<string, Map<Department, number>> {
  const out = new Map<string, Map<Department, number>>();
  for (const e of input.entries) {
    if (!(e.hoursWorked > 0)) continue;
    const staffDepts = input.staffDeptsByStaff.get(e.staffId) ?? [];
    const rosterArea = input.rosterAreaByStaffDate[e.staffId]?.[e.businessDate] ?? null;
    const rosterHasGlSkill = Boolean(input.rosterGlByStaffDate[e.staffId]?.[e.businessDate]);
    const { department } = entryRowDepartment(e.rawDepartment ?? null, staffDepts, {
      rosterArea,
      rosterHasGlSkill,
    });
    let byDept = out.get(e.staffId);
    if (!byDept) {
      byDept = new Map();
      out.set(e.staffId, byDept);
    }
    byDept.set(department, (byDept.get(department) ?? 0) + e.hoursWorked);
  }
  return out;
}

// „LG3 (27.07.2026) — Physische Zeilen-Aufteilung nach Schichtart pro
// Mitarbeiter+Abteilung (statt einer Zeile mit Untzeile). Jede Schicht wird
// via `entryRowDepartment` genau EINER Ziel-Abteilung zugerechnet — Stunden,
// Anzahl Schichten UND die Basiswerte für die SFN-Zuschläge (Abend/Nacht/
// SO+Fei) laufen 1:1 in die Zeile dieser Abteilung.
//
// Ein-Bereichs-Personen bekommen exakt eine Zeile (Verhalten wie zuvor).
// Mehrbereichs-Personen (z. B. Lam: GL + Service) erscheinen mit einer eigenen
// Zeile pro belegter Abteilung. `isPrimary` markiert die „Hauptzeile" (=
// meiste Stunden; bei Gleichstand GL > Kitchen > Service). Notizen, Vorschuss,
// Urlaub/Krank bleiben personengebunden und werden vom Konsumenten NUR auf
// der Primärzeile gerendert.
//
// `basisEvening/basisNight/basisSunHol` sind die clientseitig aus den
// Schichten dieser Abteilung berechneten Rohwerte — der Konsument nutzt sie,
// um die serverseitigen SFN-Summen (evening/night/sunHol/sonntag/feiertag/
// feiertag150) proportional auf die Abteilungszeilen zu splitten und dabei
// die Personen-Summe invariant zu halten.
export type StaffDeptRow = {
  staffId: string;
  displayName: string;
  department: Department;
  isPrimary: boolean;
  perWeek: Map<string, number>;
  totalHours: number;
  shiftDates: Set<string>;
  basisEvening: number;
  basisNight: number;
  basisSunHol: number;
};

const DEPT_TIE_ORDER: Department[] = ["gl", "kitchen", "service"];

export function aggregateStaffDeptRows(input: {
  entries: ReadonlyArray<{
    staffId: string;
    displayName: string;
    businessDate: string;
    hoursWorked: number;
    breakMinutes: number;
    rawDepartment?: Department | null;
    startedAt?: string;
    endedAt?: string;
  }>;
  seedStaff: ReadonlyArray<{ id: string; displayName: string; deps: readonly Department[] }>;
  staffDeptsByStaff: Map<string, Department[]>;
  rosterAreaByStaffDate: Record<string, Record<string, Department>>;
  rosterGlByStaffDate: Record<string, Record<string, boolean>>;
  // PB2 — Vergütungsstunden-Regel; steuert paidHours() für totalHours und
  // computeShiftHours() für die SFN-Zerlegung (SFN-Töpfe bleiben netto).
  pausenBezahlt: boolean;
}): StaffDeptRow[] {
  type Bucket = {
    staffId: string;
    displayName: string;
    department: Department;
    perWeek: Map<string, number>;
    totalHours: number;
    shiftDates: Set<string>;
    basisEvening: number;
    basisNight: number;
    basisSunHol: number;
  };
  const buckets = new Map<string, Bucket>();
  const keyOf = (sid: string, dept: Department) => `${sid}|${dept}`;
  const ensure = (sid: string, name: string, dept: Department): Bucket => {
    const k = keyOf(sid, dept);
    let b = buckets.get(k);
    if (!b) {
      b = {
        staffId: sid,
        displayName: name,
        department: dept,
        perWeek: new Map(),
        totalHours: 0,
        shiftDates: new Set(),
        basisEvening: 0,
        basisNight: 0,
        basisSunHol: 0,
      };
      buckets.set(k, b);
    }
    return b;
  };

  // Seed: alle aktiven Mitarbeiter (aus dem Standort-Filter) mit exakt einer
  // Zeile bei ihrer Startabteilung. Kommen Einträge dazu, entstehen zusätzliche
  // Zeilen — die Seed-Zeile bleibt bestehen (0-h-Fall). Personen mit Einträgen
  // in mehreren Abteilungen werden entsprechend gesplittet.
  const seededPrimary = new Map<string, Department>();
  for (const s of input.seedStaff) {
    if (s.deps.length === 0) continue;
    const dep = s.deps[0] as Department;
    ensure(s.id, s.displayName, dep);
    seededPrimary.set(s.id, dep);
  }

  for (const e of input.entries) {
    const staffDepts = input.staffDeptsByStaff.get(e.staffId) ?? [];
    const rosterArea = input.rosterAreaByStaffDate[e.staffId]?.[e.businessDate] ?? null;
    const rosterHasGlSkill = Boolean(input.rosterGlByStaffDate[e.staffId]?.[e.businessDate]);
    const { department } = entryRowDepartment(e.rawDepartment ?? null, staffDepts, {
      rosterArea,
      rosterHasGlSkill,
    });
    const b = ensure(e.staffId, e.displayName, department);
    const wk = isoWeek(parseIsoDate(e.businessDate));
    const wkKey = `${wk.year}-W${String(wk.week).padStart(2, "0")}`;
    const paid = paidHours(e.hoursWorked, e.breakMinutes, input.pausenBezahlt);
    b.perWeek.set(wkKey, (b.perWeek.get(wkKey) ?? 0) + paid);
    b.totalHours += paid;
    b.shiftDates.add(e.businessDate);
    if (e.startedAt && e.endedAt) {
      const h = computeShiftHours(
        e.startedAt,
        e.endedAt,
        e.businessDate,
        e.breakMinutes,
        input.pausenBezahlt,
      );
      b.basisEvening += h.eveningHours;
      b.basisNight += h.nightHours;
      b.basisSunHol += h.sundayHolidayHours;
    }
  }

  // Primär-Zeile je Mitarbeiter bestimmen: meiste Stunden gewinnt; bei
  // Gleichstand DEPT_TIE_ORDER (GL > Kitchen > Service). Personen ohne
  // Einträge (0h) behalten die Seed-Abteilung als Primär.
  const rowsByStaff = new Map<string, Bucket[]>();
  for (const b of buckets.values()) {
    const arr = rowsByStaff.get(b.staffId) ?? [];
    arr.push(b);
    rowsByStaff.set(b.staffId, arr);
  }
  const primaryByStaff = new Map<string, Department>();
  for (const [sid, arr] of rowsByStaff) {
    if (arr.length === 1) {
      primaryByStaff.set(sid, arr[0].department);
      continue;
    }
    const allZero = arr.every((r) => r.totalHours === 0);
    if (allZero) {
      primaryByStaff.set(sid, seededPrimary.get(sid) ?? arr[0].department);
      continue;
    }
    const sorted = [...arr].sort((a, b) => {
      if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
      return DEPT_TIE_ORDER.indexOf(a.department) - DEPT_TIE_ORDER.indexOf(b.department);
    });
    primaryByStaff.set(sid, sorted[0].department);
  }

  const out: StaffDeptRow[] = [];
  for (const b of buckets.values()) {
    out.push({
      staffId: b.staffId,
      displayName: b.displayName,
      department: b.department,
      isPrimary: primaryByStaff.get(b.staffId) === b.department,
      perWeek: b.perWeek,
      totalHours: b.totalHours,
      shiftDates: b.shiftDates,
      basisEvening: b.basisEvening,
      basisNight: b.basisNight,
      basisSunHol: b.basisSunHol,
    });
  }
  // Sortierung: Name (de) — Konsument gruppiert selbst per Abteilung.
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "de"));
}

// LG3 — Proportionaler Split einer personen-aggregierten SFN-Metrik auf die
// Abteilungszeilen einer Person, gemessen an einer clientseitig berechneten
// Basis (z. B. `basisEvening`). Summe über alle Zeilen bleibt EXAKT gleich
// dem Personen-Wert (letzte Zeile erhält den Restbetrag). Ist die Basis-Summe
// 0 (metrik trifft niemanden dieser Person), bekommt die Primärzeile den
// gesamten Wert — so gehen Beträge nie verloren.
export function splitSfnMetricByDept(
  rows: readonly StaffDeptRow[],
  personTotal: number,
  basis: (r: StaffDeptRow) => number,
): Map<Department, number> {
  const out = new Map<Department, number>();
  for (const r of rows) out.set(r.department, 0);
  if (personTotal <= 0 || rows.length === 0) return out;
  const basisSum = rows.reduce((a, r) => a + basis(r), 0);
  if (basisSum <= 0) {
    const primary = rows.find((r) => r.isPrimary) ?? rows[0];
    out.set(primary.department, personTotal);
    return out;
  }
  let assigned = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i];
    const share = (basis(r) / basisSum) * personTotal;
    out.set(r.department, share);
    assigned += share;
  }
  const last = rows[rows.length - 1];
  out.set(last.department, personTotal - assigned);
  return out;
}
