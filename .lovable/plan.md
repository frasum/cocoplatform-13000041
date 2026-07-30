## ST1-C3 — Alt-Satz-Feld und Legacy-Functions abreißen (Schlussrunde 4/4)

Vorbefund eigenhändig nachgemessen und bestätigt:
- `src/lib/admin/compensation.functions.ts` hat genau einen Importeur: `src/components/admin/PersonalDetailsTab.tsx` (Zeile 14, Nutzung in 621/622).
- `CompensationSection` ist ab Zeile 619 definiert und genau einmal gemountet (Zeile 538, `{canEdit && <CompensationSection staffId={staffId} />}`), direkt vor `CompensationRatesSection` (Zeile 540).
- `from("staff_compensation")` steht nur in `compensation.functions.ts` und `m4-payroll-permissions.db.test.ts`.
- Kein Test referenziert die beiden Functions; `CompensationDto` wird nur in der Definitionsdatei benutzt.
- Der Mount ist ein eigenständiger Geschwister-Block ohne Layout-Kopplung — die Entfernung berührt keine Conditional-Kette.

### Änderungen

**1. `src/components/admin/PersonalDetailsTab.tsx`**
- Import in Zeile 14 entfernen.
- Mount-Zeile 538 entfernen; `CompensationRatesSection` bleibt zeichengleich stehen.
- Funktion `CompensationSection` (ca. 619–765) ersatzlos löschen, samt State (`rate`, `validFrom`, `editing`, `msg`), Query, Mutation und Markup.
- Danach prüfen, ob dadurch Imports (`useEffect`, `useQuery`, `useServerFn` u. a.) ungenutzt werden — nur solche entfernen, die kein anderer Block mehr braucht.

**2. `src/lib/admin/compensation.functions.ts`**
- Datei löschen (beide Functions + `CompensationDto`).

Keine Migration, kein Feature-Flag, kein auskommentierter Rest.

### Nicht angefasst
`compensation-rates.functions.ts`, `CompensationRatesSection`, `DepartmentRatesRow`, `permissions-catalog.ts` und die Keys `payroll.compensation.view/.edit`, `m4-payroll-permissions.db.test.ts`, `expect-ok.ts`, `admin-call.ts`, `audit.ts`, alle Migrationen, `supabase/**`, Workflows, `docs/arbeitsweise.md` (§117 sammelt separat).

### Gates & Fertigmeldung
- `prettier --write` + `eslint --fix` auf die geänderte Datei, danach `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run`.
- Erwartet unverändert 204 Dateien / 2041 Tests; jede Abweichung wird aufgeschlüsselt.
- Die drei Greps aus 2c mit exakten Ergebnissen melden, inkl. Wortgrenzen-Kontrolle, dass `upsertStaffCompensationRate` unberührt bleibt — Grep 3 soll dann nur noch `m4-payroll-permissions.db.test.ts` zeigen (Freigabe-Kriterium für die Drop-Migration).
- §104: Halt-und-melden bei jedem zusätzlichen Importeur oder Layout-Kopplung.
