# LG2 — Stundenaufteilung nach Abteilung in der Gesamt-Zelle (final, mit 3 Auflagen)

Ziel: In `PayrollTab` unter der fetten Gesamtstunden-Zahl eine kleine zweite Zeile `GL 73,00 · SV 32,00` bei Personen mit Einträgen in ≥ 2 Abteilungen. Keine neue Zuordnungslogik — dieselbe Attribution wie im Wochenplan.

## Dateien

- `src/lib/time/time-admin.functions.ts` — `getTimeOverview` + `getTimeOverviewBatch` um `assignedStaff`, `rosterAreaByStaffDate`, `rosterGlByStaffDate` für den gesamten Zeitraum ergänzen. Zwei irreführende Kommentare korrigieren (Auflage 2).
- `src/lib/time/zeit-uebersicht-core.ts` — reine Helferfunktion `aggregateHoursByStaffAndDept(entries, ctx)` (Auflage: Aggregationslogik gehört nicht ins Route-Modul).
- `src/routes/_authenticated/admin/zeit-uebersicht.tsx` — Aggregation aufrufen, `hoursByStaffAndDept` als Prop an `PayrollTab`, in `BuchhaltungExportRow`s einbauen.
- `src/components/zeit/PayrollTab.tsx` — zweite Zeile in der Gesamt-Zelle.
- `src/lib/time/buchhaltung-export.ts` — Spalten `stunden_gl`, `stunden_service`, `stunden_kueche` vor `urlaubDays`.
- Neu: `src/lib/time/hours-by-staff-and-dept.test.ts` (drei blockierende Fälle).

Keine Migration, keine Schema-/DB-Änderung. `computeShiftHours`, `entryRowDepartment`, `primaryDepartment` unverändert.

## 1) Server — Overview um Roster-Attribution erweitern (Option A)

`getTimeOverview` und `getTimeOverviewBatch` bauen `assignedStaff`, `rosterAreaByStaffDate`, `rosterGlByStaffDate` **für [fromDate, toDate]** — analog zum bestehenden Wochen-Pfad in derselben Datei. Reine Ergänzung des Response-Shape, kein bestehendes Feld ändert Semantik.

- Batch-Merge über Standorte (Konflikt beim selben Tag / derselben Person mit unterschiedlicher Area, oder beim Aufbau von `assignedStaff.staffDepts`) — **Auflage 1**: **kein** eigener Prioritätsvergleich im Batch-Code. Stattdessen `primaryDepartment(candidates)` aus `src/lib/time/primary-department.ts` aufrufen. Die verbindliche Reihenfolge ist `gl > kitchen > service`, sie steht genau an dieser einen Stelle.
- Die Wochen-Merge-Stellen für `rosterAreaByStaffDate` (Batch-Merge in `zeit-uebersicht.tsx` Z. 297) enthalten eine handkodierte `["kitchen","service","gl"]`-Reihenfolge — Auflage 1 gilt hier ebenfalls: auf `primaryDepartment([existing, area])` umstellen, denselben Aufruf verwenden wie server-seitig. Falls beim Durchsehen weitere Stellen mit derselben handkodierten Reihenfolge auffallen, werden sie mit umgestellt und im Bericht aufgelistet.

**Auflage 2 — Kommentare korrigieren:** In `src/lib/time/time-admin.functions.ts`:

- Z. ~836: „Primär-Abteilung je Mitarbeiter (Priorität kitchen > service > gl)" → `gl > kitchen > service`.
- Z. ~911: „primaryDepartment liefert kitchen>service>gl — hier für den seltenen Fall zweier Schichten desselben Mitarbeiters am selben Tag mit unterschiedlichen Areas." → `gl > kitchen > service`.

Nur Kommentartext, kein Code. Ich durchsuche die betroffenen Module (`time-admin.functions.ts`, `primary-department.ts`, `zeit-uebersicht-core.ts`, `zeit-uebersicht.tsx`, `roster-*`) nach weiteren veralteten Prioritäts-Kommentaren und liste Funde im Bericht auf.

## 2) Reine Helferfunktion (`zeit-uebersicht-core.ts`)

```ts
// LG2 — Deckungsgleich mit der Wochenplan-Attribution (entryRowDepartment) und
// derselben Stundenzerlegung (computeShiftHours), aus der auch
// staffAggs.totalHours entsteht. Eine Regel, eine Implementierung.
export function aggregateHoursByStaffAndDept(
  entries: readonly TimeOverviewEntry[],
  ctx: {
    staffDeptsByStaff: Map<string, readonly Department[]>;
    rosterAreaByStaffDate: Record<string, Record<string, Department>>;
    rosterGlByStaffDate: Record<string, Record<string, boolean>>;
  },
): Map<string, Map<Department, number>>
```

Iteriert die übergebenen Einträge, ruft `entryRowDepartment` mit den Ctx-Feldern auf und addiert `computeShiftHours(...).totalHours` in `Map<staffId, Map<department, hours>>`. Nichts eigenes rechnen — dieselbe Zerlegung wie `staffAggs`.

## 3) staffDepts über Standorte vereinigen (Auflage 3)

**Vor der Iterationsschleife** eine `Map<staffId, Department[]>` einmal aufbauen — als Vereinigungsmenge über alle `assignedStaff`-Einträge derselben Person über alle geladenen Standorte:

```ts
const staffDeptsByStaff = new Map<string, Department[]>();
for (const s of overview.assignedStaff ?? []) {
  const cur = staffDeptsByStaff.get(s.staffId) ?? [];
  const source = s.staffDepts ?? [s.department];
  for (const d of source) if (!cur.includes(d)) cur.push(d);
  staffDeptsByStaff.set(s.staffId, cur);
}
```

Kein `.filter()[0]`, kein „erster Treffer". Beim „Alle Standorte"-Merge im Batch-Pfad passiert dasselbe: `staffDepts` je Person = Union über alle Standort-Buckets. Damit greift `entryRowDepartment` für MO (Spicery + YUM) korrekt, statt in den Mismatch-Zweig zu laufen.

## 4) Route (`zeit-uebersicht.tsx`)

Neben `periodTotalsByStaff` (Z. 382) einmal `aggregateHoursByStaffAndDept(overviewEntries, {...})` aufrufen. Ctx-Felder kommen aus dem neu erweiterten Overview-Payload (Punkt 1). Ergebnis als optionales Prop an `PayrollTab`:

```ts
hoursByStaffAndDept?: Map<string, Map<Department, number>>;
```

**Meldepflicht** (bleibt): Falls die Teilwerte sich trotz Option A nicht zur `staffAggs.totalHours` summieren — anhalten, melden, nicht kaschieren.

## 5) Anzeige (`PayrollTab.tsx`)

In der `TableCell` der Gesamt-Spalte (~Z. 428):

```tsx
const parts = hoursByStaffAndDept?.get(row.staffId);
const nonZero = parts ? [...parts].filter(([, h]) => h > 0) : [];
// ...
<div className="font-semibold">{fmtHm(floorToQuarterHours(row.totalHours))}</div>
{nonZero.length >= 2 && (
  <div className="text-xs text-muted-foreground">
    {(["gl","service","kitchen"] as Department[])
      .filter((d) => (parts!.get(d) ?? 0) > 0)
      .map((d) => `${SHORT[d]} ${fmtDec(parts!.get(d)!)}`)
      .join(" · ")}
  </div>
)}
```

- Kürzel: `gl → GL`, `service → SV`, `kitchen → KÜ`.
- Teilwerte **ohne** `floorToQuarterHours`, `fmtDec` (deutsches Komma, 2 NKS). Summe der Teilwerte = ungerundete `totalHours`.
- Summenzeile am Tabellenende bleibt einzeilig.

## 6) Export (`buchhaltung-export.ts`)

Drei Spalten `stunden_gl`, `stunden_service`, `stunden_kueche` **vor `urlaubDays`**, in beiden Modi (`simple` + `section3b`):

- `BuchhaltungExportRow` bekommt `stundenGl?`, `stundenService?`, `stundenKueche?`.
- Bei genau einer Abteilung mit Stunden > 0: alle drei Felder leer (keine Duplizierung der Gesamtstunden).
- Sonst: befüllt, ohne `floorToQuarterHours`, mit `fmtDec`.
- `cellValue` + `totals` (Rohsumme, konsistent mit UI, ohne Rundung).
- CSV, XLSX und PDF nutzen `columns()` — automatisch konsistent.

## 7) Tests (blockierend) — `hours-by-staff-and-dept.test.ts`

- **Ein-Abteilungs-Fall**: Map hat genau einen Eintrag > 0.
- **Zwei-Abteilungen-Fall** (eine Person, ein Standort, GL + Service): Σ Teilwerte === `totalHours`, Toleranz 0.
- **Mehrstandort-Fall (Auflage 3)**: Person mit `service` in Standort A und `gl` in Standort B, Einträge an beiden. Erwartung: beide Abteilungen erscheinen mit ihren Stunden, kein Fallback/Mismatch, Σ Teilwerte === `totalHours`.

## 8) Nicht anfassen

`computeShiftHours` (Pause-Thema separat, bekannt), `entryRowDepartment`, `primaryDepartment`, bestehende Spaltenreihenfolge/Breiten, §3b-Umschalter, `staffAggs`, `periodTotalsByStaff`, `payrollRowsByStaff`, alle Dateien außerhalb der oben gelisteten.

## 9) Erfolgs-Gate

- `npx prettier --write` über geänderte Dateien (**ausdrückliche Bestätigung im Bericht**), dann `npx eslint --fix`.
- `npx tsc --noEmit` → 0.
- `npx eslint .` → 0/0.
- `npx prettier --check .` → clean.
- `npx vitest run` → alle grün (Ausgang 1897, +3 neue Tests → 1900).

## Klicktest

LAM Juli 2026: unter `105:00` → `GL 73,00 · SV 32,00`, addiert 105,00. MO analog (Spicery+YUM, beide Standorte vereinigt). EM: `KÜ … · SV …`. Übrige: unverändert einzeilig. §3b-Umschalter ändert die Aufteilung nicht. Export enthält dieselben Werte in CSV, XLSX, PDF.
