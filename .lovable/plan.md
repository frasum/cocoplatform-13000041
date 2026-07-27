## LG3b — Restbau: Engine je Eintrag, SFN je Lohnart, Export/Anzeige mit drei Blockern (Freigabe mit acht Auflagen)

Aufbau auf `docs/LG3b-bereichs-saetze.md`, `src/lib/lohn/rate-resolution.ts` (steht), PB2-Anker 708e4906. Keine Migration, keine SQL. Auslieferungsanker Vorzustand = `0d063077`, Testzahl-Baseline = 1930.

### Änderungen im Detail

**1. Attribution je time-entry** (`src/lib/lohn/lohn-period.functions.ts` + neuer `src/lib/lohn/entry-attribution.ts`)
- Pro Eintrag `entryRowDepartment(entry.department, staffDepts, { rosterArea, rosterHasGlSkill, rosterPlanned })` — identische Signatur wie in Buchhaltung/LG2, nicht neu implementieren.
- `staff_locations` (staffDepts) und die Roster-Signale (`roster_shifts` + Skills) einmalig für den Zeitraum laden, gleicher Pfad wie in `zeit-uebersicht-core`. Reiner Helper bündelt die Zuordnung `entryId → { department, mismatched }`.

**2. Satzauflösung + Bereichs-Buckets**
- `staff_compensation_rates` einmal laden. Pro Eintrag: `resolveRateCents(rates, department, business_date)`. `null` = kein Satz.
- **A1**: `unpriced` fällt nicht aus der Rechnung. Die Bereichs-Buckets tragen die Stunden weiter (`paidHours` fließen in `totalHours` und `byDepartment[dept].totalHours`), aber `hourlyRateCents = null`, `zeitlohnCents = 0`, `zuschlagCents = 0`. SFN läuft für diese Gruppe nicht (Grundlohn ist der Multiplikator — ohne Satz keine SFN-Wirkung).
- **A5**: `mismatched:true`-Einträge zählen ebenfalls in `totalHours` und `byDepartment[fallbackDept]`, werden aber zusätzlich in einem Bucket `unresolved: { totalHours, entries[] }` erfasst — damit die Detailansicht sie als eigene Zeile „Bereich nicht zuordenbar — X h, 0 €" zeigen kann, ohne dass sie in der SFN-Rechnung doppelt landen.
- Einträge nach `department` gruppieren. Für jede Gruppe mit vorhandenem Satz: `berechneSfnGeld(rows, mode, rateCentsDept, holidayRates)`. Formelinhalte unangetastet.
- Ergebnis-Shape von `aggregateSfnPeriod` erweitert um `byDepartment: Record<Department, { hourlyRateCents: number | null; totalHours; entryCount; workdayCount; simple; extended }>`, `unresolved: { totalHours; entries: { businessDate; hours }[] }` und `blockerHints: { missingRateDepartments: Department[]; unresolvedDepartmentHours: number }`.
- **A2**: Aggregat-`hourlyRateCents` bleibt nur bei genau **einem** Bereich mit Satz belegt. Bei zwei oder drei Bereichen mit unterschiedlichen Sätzen → `hourlyRateCents = null`. **Kein** gewichteter Mittelwert, nirgends.

**3. Engine-Verdrahtung** (`lohn-rechner.functions.ts`)
- `computeLohnForStaff` erzeugt bis zu drei Zeitlohn-Zeilen (eine je Bereich mit `paidHours > 0`):
  - Service → `zeitlohn`
  - GL → neue Kategorie `zeitlohn_2`
  - Küche → neue Kategorie `zeitlohn_3`
- `unpriced`-Bereiche: eigene Zeile mit Bezeichnung „Zeitlohn <Bereich> — kein Satz gepflegt", `betragCent = 0`, `stunden = X`, `satzCent = null`. Weder verschluckt noch stumm.
- **A3 — Minijob-Zweig explizit:**
  - Genau ein Bereich mit Stunden → eine einzige `zeitlohn`-Zeile (pauschal), Bestandsverhalten eingefroren.
  - Zwei oder drei Bereiche mit unterschiedlichen Sätzen → **§104-Meldung an den Auftraggeber**, keine Implementierungsentscheidung im Alleingang. Kein stillschweigender Mix auf eine Zeile.
  - Alle Bereiche gleicher Satz → gleicher Pfad wie „ein Bereich" (eine Zeile).
- `types.ts` (`Kategorie`) um `zeitlohn_2`, `zeitlohn_3` erweitern; `berechneLohn` behandelt beide identisch zu `zeitlohn` (SV/LSt-Basis). Sicherstellen, dass keine Konstanten-Vergleiche gegen genau `"zeitlohn"` in `lohn-core.ts` etwas ausschließen.
- SFN eine einzige `zuschlag_frei`-Zeile mit Summe über alle Bereiche; die Bereichs-Aufteilung lebt separat für den Export (siehe 5.).

**4. Blocker im Übersichts-Pfad** (`berechneLohnUebersicht`)
- Prüfmenge: Personen mit **ungerundeter** `paidHours > 0` (Rohsumme aus `byDepartment` inkl. `unresolved`), nicht die viertelstundengerundete Anzeige.
- Drei Gründe je Person:
  - `missing_rate: Department[]` — Bereiche mit `paidHours > 0` ohne Satz.
  - `missing_perso_nr: boolean` — `staff.perso_nr` null oder leer.
  - `unresolved_department: boolean` — `unresolved.totalHours > 0`.
- Rückgabe erweitert: `blockers: { missingRate: Department[]; missingPersoNr: boolean; unresolvedDepartment: boolean } | null` je Zeile, plus `byDepartment` und `unresolved` für die Anzeige.

**5. Export-Gate in den Build-Funktionen** (A4)
- Neuer reiner Helper `src/lib/lohn/export-blockers.ts` (mit Tests): baut aus dem Übersichts-Ergebnis eine sortierte Payload, wenn irgendeine Person Blocker hat, und definiert `class LohnExportBlockedError extends Error { readonly blockers: […] }`.
- **`buildUebersichtCsv` und `buildLohnXlsx` rufen `assertExportUnblocked(rows)` als ersten Schritt auf** und werfen `LohnExportBlockedError` mit vollständiger Liste. Kein Bau eines Teil-Blobs, keine Umgehung durch neue Aufrufer. Ein Gate nur im Panel wäre das USING(true)-Muster und wird ausdrücklich abgelehnt.
- `LohnrechnerPanel.tsx` fängt den Error und zeigt Dialog mit vollständiger Liste; keine eigene Vor-Prüfung dort.
- Spalten je Lohnart im Export: `zeitlohn_std`, `zeitlohn_satz_cent`, `zeitlohn_2_std`, `zeitlohn_2_satz_cent`, `zeitlohn_3_std`, `zeitlohn_3_satz_cent`, SFN aufgeteilt je Bereich (`sfn_service_cent`, `sfn_gl_cent`, `sfn_kitchen_cent`). Bestehende Alt-Spalten (`stunden`, `stundensatz_cent`, `zuschlag_cent`) bleiben als Summen; `stundensatz_cent` ist leer bei mehr als einem Bereich (A2).

**6. Anzeige (LG-9-c)** (`LohnrechnerPanel.tsx`)
- Zeilen mit Blockern rot markiert, Tooltip listet die Gründe (fehlende Bereiche, `perso_nr`, `unresolved`). Summenzeile trägt „unvollständig", wenn irgendein Blocker aktiv ist.
- Detailansicht zeigt sichtbar: je Bereich eine Zeile (Bereich · Stunden · Satz · Betrag), zusätzlich die A5-Zeile „Bereich nicht zuordenbar — X h, 0 €". Fehlender Satz → Zeile rot mit „Kein Bereichssatz". Kein stiller Mischsatz.

**7. Stammblatt-Label** (A7) (`src/routes/_authenticated/admin/staff.$staffId.tsx` / PersonalDetailsTab)
- Hinweis am Bereichs-Sätze-Block „noch ohne Lohnwirkung" entfernen.
- Legacy-Feld `staff_compensation.hourly_rate`: Bezeichnung dreht von „aktuell lohnwirksam" auf „Alt-Satz — von der Lohnrechnung nicht mehr gelesen". Feld bleibt editierbar für den Übergang, wird aber nicht mehr in der Engine gelesen (Abriss = separater späterer Auftrag).

**8. Nullmessung + Fixtures** (A6)
- `src/lib/lohn/lg3b-nullmessung.test.ts` — blockierend, **drei reale Fälle** aus `edlohn-faelle.json`:
  - Fall 1: reine Service-Person (Ein-Bereich, kein SFN-Spektrum).
  - Fall 2: reine Küche-Person (Ein-Bereich, kein SFN-Spektrum).
  - Fall 3: Ein-Bereich mit gefülltem SFN-Spektrum (Nacht 25 + Nacht 40 + Sonntag + Feiertag).
  - Alle drei mit Bereichssatz = altem `hourly_rate`. Cent-Vergleich auf `zuschlagCents`, `bruttoCents`, `stBruttoAusweisCent`, `nettoCents`, `auszahlungCents`.
- Zwei Mehrsatz-Fixtures (`src/lib/lohn/lg3b-mehrsatz.test.ts`):
  - **LAM** (GL + Service) — Referenzwerte aus realer edlohn-Juli-Abrechnung: Sonntag 30,75 h GL, Nacht 25 33,75 h = 18,75 GL + 15,00 Service, Nacht 40 8,25 h = 4,50 GL + 3,75 Service. Handgerechnete Zuschlagssummen im Test-Kommentar.
  - **MO** (drei Bereiche) — `gl = kitchen = service = 2300` Cent (nicht die 17,50-Zeile).
- `src/lib/lohn/entry-attribution.test.ts` — deckt `mismatched:true`-Fälle ab.
- `src/lib/lohn/export-blockers.test.ts` — drei Blocker einzeln und kombiniert, Regel „ungerundete paidHours" (0,2 h zählt), „Payroll-Zugang ohne Stunden blockiert nie", und `LohnExportBlockedError` aus `buildUebersichtCsv`/`buildLohnXlsx` bei belegter Payload.

### Technische Details

- Neue `Kategorie`-Werte `zeitlohn_2`, `zeitlohn_3` in `types.ts` und im Zod-Enum von `zusatzZeilen` (Rückwärtskompatibilität: bestehende Zusatzzeilen laufen weiter über `zeitlohn`).
- `dropPoolWhenRealEntryExists` unverändert (Vor-Filter bleibt).
- `applyBreakProration`, `berechneSfnGeld` **unverändert** — nur mehrfach aufgerufen. `pap-2026/**` nicht angefasst.
- `staff_compensation.hourly_rate` wird von der Engine nicht mehr gelesen; Feld + Tabelle bleiben.
- `isValidFromAllowed` unverändert.

### Nicht enthalten

- Migration/SQL, RLS.
- Urlaubs-/Krankstunden-Zuordnung zu Lohnarten (Lohnbüro offen).
- Abriss `staff_compensation.hourly_rate` (späterer Auftrag).
- Frank-seitiger Parallel-Lohnlauf August alt/neu (post-Deploy).

### Meldepflicht §104

Jede Berührung von `pap-2026/**`, `applyBreakProration` oder den `berechneSfnGeld`-Formelinhalten wird gemeldet, nicht durchgeführt. Ebenso: Minijob-Mehrbereich mit unterschiedlichen Sätzen (siehe A3).

### Abnahme-Gate (A8)

Volles Gate, nicht nur `bun test` + `tsgo`:

1. `prettier --write` über alle geänderten Dateien (ausdrücklich bestätigen).
2. `tsc --noEmit` → 0 Fehler.
3. `eslint . --max-warnings=0` → 0 Warnings/Errors.
4. `prettier --check` → clean.
5. `vitest run` grün. **Vorzustand gemessen gegen Anker `0d063077` = 1930.** Endzustand ≥ 1930 + neue Tests aus 8.
6. Manuelle Sicht: Panel zeigt Bereichs-Zeilen für LAM Juli; Export-Blob-Aufruf wirft `LohnExportBlockedError` bei fehlender `perso_nr`, fehlendem Bereichssatz oder `unresolved` — Dialog listet vollständig; Stammblatt-Labels neu formuliert.
