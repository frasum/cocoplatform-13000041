## Ziel

Mitarbeiter mit Schichten in mehreren Abteilungen (z.B. Lam: GL + Service) erscheinen ab sofort mit einer eigenen Zeile pro Abteilung — jeweils in der passenden Sektion (Geschäftsleitung / Service / Küche). Stunden UND Zuschläge (Abend, Nacht, Sonn-/Feiertag, Feiertag 150) werden pro Zeile ausschließlich aus den Schichten berechnet, die auf diese Abteilung geroutet wurden. Die bisherige Sub-Untzeile „GL x · SV y" unter den Gesamtstunden entfällt. Ein-Bereichs-Mitarbeiter bleiben unverändert bei einer Zeile.

## Zeilen-Attribution (Single Source of Truth)

Pro `time_entry` wird die Ziel-Abteilung wie im Wochenplan-Grid bestimmt (`entryRowDepartment` mit rawDepartment + rosterArea + rosterHasGlSkill). Dieselbe Funktion liefert also je Schicht *ein* Department — daraus ergibt sich, wo Stunden und Zuschläge dieser Schicht landen. Reihenfolge (GL > Kitchen > Service) bleibt durch die bestehende Attributions-Logik erhalten.

## Änderungen

### 1. Aggregation um Zuschläge erweitern — `src/lib/time/zeit-uebersicht-core.ts`

`aggregateHoursByStaffAndDept` wird erweitert (oder eine Schwester-Funktion `aggregateStaffByDept` daneben gestellt), die pro (staffId, department) folgende Summen aus den time_entries dieser Abteilung liefert:

- `hours` (Gesamt-Stunden)
- `evening`, `night` (via `computeShiftHours` je Schicht)
- `sunHol` (Basis-Zuschlag)
- `sonntag`, `feiertag`, `feiertag150` (aus SFN-Ergebnissen — siehe Punkt 2)
- `shiftDates: Set<string>` (für Anzahl Schichten pro Zeile)

Signatur nimmt zusätzlich die Roh-Einträge mit `startedAt/endedAt` entgegen, damit `computeShiftHours` pro Schicht aufgerufen werden kann. Für Ein-Dept-Personen bleibt Verhalten 1:1 identisch (nur ein Department im Ergebnis).

### 2. SFN-Split — Umgang mit vorhandener Bibliothek

Aktuell wird SFN pro Person für die ganze Periode berechnet (`fetchSfn`/`fetchSfnBatch`), unabhängig von der Abteilung. Für den Split muss SFN je Abteilung anfallen. Vorgehen ohne Server-Änderung:

- Wir behalten `fetchSfn` unverändert (Server-Fn intakt).
- Auf dem Client wird pro (staffId, department) ein Anteil bestimmt anhand des Verhältnisses der departmentalen SFN-relevanten Stunden zur Person-Summe: `sonntag`, `feiertag`, `feiertag150` werden pro Zeile aus den `time_entries` der Abteilung neu über `computeShiftHours` + Feiertag-/Sonntag-Kalender berechnet — dieselben Regeln wie in `fetchSfn`, nur lokal je Untermenge.
- Falls die serverseitige SFN-Logik nicht 1:1 lokal spiegelbar ist (extended-Feiertagsregeln), wird zunächst der einfache Weg gewählt: `sonntag`/`feiertag`/`feiertag150` proportional zur departmentalen Stundenverteilung splitten. Als Kompromiss/Sicherheit: Summe über alle Zeilen einer Person = bisheriger Personen-Wert (invariant gehalten). Dieser Fallback wird in einem Kommentar dokumentiert; die exakte per-Schicht-Rechnung folgt, sobald die SFN-Bibliothek eine `perShift`-Ausgabe erhält (Nachzug-Ticket).

Empfehlung: proportionale Aufteilung als Runde 1 — sie ist deterministisch, additiv korrekt (Summe unverändert) und ändert die Lohnsummen der Periode nicht. Ist das ok, oder soll SFN per Schicht neu gerechnet werden (aufwendiger, aber exakt)? Voreinstellung dieses Plans: **proportional in Runde 1**, mit sichtbarem TODO für exakte Neurechnung.

### 3. Zeilen-Modell — `src/routes/_authenticated/admin/zeit-uebersicht.tsx`

`staffAggs` liefert derzeit *eine* Zeile pro Mitarbeiter. Neu: eine Zeile je (staffId, department), nur wenn der Mitarbeiter in dieser Abteilung > 0h in der Periode gebucht hat. Personen mit genau einer Ziel-Abteilung bekommen weiterhin eine Zeile (Verhalten wie bisher). Die Zeile trägt den staffId als Basis und die department als Sektion.

Konsequenzen:

- `byDept` gruppiert automatisch nach der Zeilen-Abteilung, weil jede Zeile ihre eigene `department` mitbringt.
- Zuschlags-Werte (`evening`, `night`, `sunHol`, `sonntag`, `feiertag`, `feiertag150`) je Zeile kommen aus der neuen Aggregation (Punkt 1+2).
- Anzahl Schichten je Zeile = `shiftDates.size` der departmentalen Untermenge.
- Notizen (`notesByStaff`), Vorschüsse, Abwesenheiten sind personengebunden — sie erscheinen NUR auf der „primären" Zeile der Person (Regel: Abteilung mit den meisten Stunden; bei Gleichstand die Reihenfolge GL > Kitchen > Service). Zweit-Zeilen zeigen bei Notizen/Vorschuss/U/K einen unauffälligen „–". Krank/Urlaub-Tage sind ebenfalls personengebunden und erscheinen nur auf der Primär-Zeile.

### 4. UI — `src/components/zeit/PayrollTab.tsx`

- Sub-Untzeile „GL x · SV y" (Zeilen 442–448) wird entfernt. `deptParts`-Prop entfällt vollständig.
- `PayrollRow` rendert unverändert eine Zeile — nur füttern wir jetzt eine Zeile pro (staffId, department).
- Summenzeile bleibt die Perioden-Summe der aktuell sichtbaren Zeilen (mathematisch identisch zur bisherigen Summe, da über alle Zeilen einer Person die Werte in Punkt 1/2 addiert bleiben).
- Zebra-Streifen: `idx % 2 === 1` je Sektion bleibt intakt.

### 5. Zusammenfassung-Tab

Gleiche Umstellung: eine Zeile pro (staffId, department) mit departmentalen Stunden + Zuschlägen. Klicks auf Namen führen weiterhin zum Personal-Profil (staffId).

### 6. Netto/Brutto/Provision-Tabs

Zeilenquelle wird auf die neuen (staffId, department)-Zeilen umgestellt, damit die Zeilen-Zuschläge dort korrekt in Brutto/Netto einfließen. Notizen/Vorschüsse/Provision-Sätze bleiben personengebunden und erscheinen NUR auf der Primär-Zeile (siehe oben). Voraussetzung: die dort verwendete Brutto-/Netto-Rechnung basiert auf den in der Zeile gezeigten Werten (Stunden + Zuschläge). Falls sie stattdessen aggregierte Personen-Werte liest, ergänze ich den entsprechenden Rechenpfad, damit die Zuschläge je Zeile korrekt berücksichtigt werden.

### 7. Exporte — `src/lib/time/buchhaltung-export.ts` (CSV/XLSX/PDF)

- Die bisher exklusive `stundenGl` / `stundenKueche` / `stundenService`-Zusatzspalte wird aus dem Row-Datentyp entfernt (nicht mehr benötigt, weil jede Zeile ohnehin genau EINE Abteilung repräsentiert).
- Stattdessen bekommt jede exportierte Zeile: `abteilung` (Klartext-Label), Personalnummer, Rufname, vollständiger Name, Std, Abend, Nacht, So/Feiertag (bzw. Sonntag/Feiertag/Feiertag150), Anzahl Schichten. Notizen/Vorschuss/U/K nur auf der Primär-Zeile.
- Reihenfolge im Export: personenweise gruppiert; innerhalb einer Person Primär-Zeile zuerst, weitere Abteilungszeilen darunter. Alternativ (falls buchhalterisch angenehmer) departmental gruppiert wie in der UI — Voreinstellung: **UI-Gruppierung 1:1** (departmental).
- Column-Test in `buchhaltung-export-columns.test.ts` wird angepasst: `stundenGl/stundenKueche/stundenService` weg, `abteilung` dazu.

### 8. Tests

- `src/lib/time/hours-by-staff-and-dept.test.ts`: bestehende Tests bleiben grün (Aggregations-Ergebnis pro Department unverändert für Stunden). Neue Tests für die erweiterte Aggregation:
  - Multi-Dept-Person mit Sonntags- und Nacht-Schicht in GL: Zuschläge landen in der GL-Zeile, nicht in der Service-Zeile.
  - Ein-Dept-Person: genau eine Zeile im Ergebnis.
  - Summen-Invariante: Σ über Zeilen = Personen-Gesamtwert (für alle Zuschlags-Kategorien).
- `buchhaltung-export-columns.test.ts`: neue Spaltenliste.

### 9. Was NICHT geändert wird

- `time_entries`-Schema und Server-Funktionen (`fetchOverview`, `fetchSfn`, `fetchNotes`, …) bleiben unverändert.
- Wochenplan-Ansicht und Grid-Attribution bleiben unverändert.
- Trinkgeldpool und Provisionsberechnungen greifen weiterhin auf Personen-Aggregate zu (kein Split-Effekt).

## Reihenfolge der Umsetzung

1. `zeit-uebersicht-core.ts`: erweiterte Aggregations-Funktion + Tests.
2. `zeit-uebersicht.tsx`: Zeilen-Modell auf (staffId, department) umbauen, Primär-Zeile-Logik für Notizen/Vorschuss/U/K.
3. `PayrollTab.tsx`: `deptParts` entfernen.
4. Zusammenfassung-Tab: gleiche Umstellung.
5. Netto/Brutto/Provision-Tabs: Zeilenquelle umstellen, Rechenpfad prüfen.
6. Exporte + Column-Test.
7. Manuelle Verifikation mit Lam (Juli-Periode): Summe über GL-Zeile + Service-Zeile = bisherige Anzeige.
