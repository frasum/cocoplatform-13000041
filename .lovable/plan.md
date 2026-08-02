## Bestandsmeldung (Konflikt melden, nicht still lösen)

- Basis: `origin/main`, HEAD `13b92e106` (danach `582771776` = §130-Doku-Vertrag). Anker 55530025 liegt darunter.
- **Abweichung zu Schritt 1:** Die Spalte `public.staff.roster_plannable` (boolean, NOT NULL, DEFAULT true) **existiert in der Datenbank bereits** und ist in `src/integrations/supabase/types.ts` generiert. Im Anwendungscode wird sie **nirgends** verwendet. Es ist also nur noch der Spalten-Kommentar offen, keine Struktur-Migration. Ich lege daher nur eine kleine, idempotente Migration (`ADD COLUMN IF NOT EXISTS` + `COMMENT ON COLUMN`) an — falls du sie gar nicht ausführen willst, entfällt lediglich der Kommentar.

## Fundliste der Planungs-Personenquellen (geprüft)

Gefiltert wird auf `roster_plannable = true` (bzw. `!== false`) — genau an den Stellen, die heute `is_active` prüfen:

1. `src/lib/roster/roster.functions.ts` → `getStaffForRoster` (Zeilen ~508–560): `staff(id, display_name, is_active)` wird zu `staff(id, display_name, is_active, roster_plannable)`; die zwei bestehenden Filterstellen bekommen die Zusatzbedingung. Diese Quelle versorgt Wochenplan (`admin/dienstplan.tsx`), `RosterGrid`, `RosterAreaBlock`, `RosterDayView`, `DayEditSheet` (Personen-Auswahl beim Zuweisen) und `PlanerRosterView` — damit sind alle Planer-/Zuweisungslisten in einem Zug erfasst.
2. `src/lib/display/display-data.server.ts` (Zeile ~254/270, Zeilenbasis der Displays): gleiche Ergänzung. Wirkt auf Restaurant-Display, TRMNL-Dienstplan und TRMNL-Planungstafel (alle bauen auf `buildDisplayData`).
3. `src/lib/roster/swap.functions.ts` (Peer-Kandidaten, ~Zeile 196): der `staff`-Query filtert bereits `is_active = true`; dort zusätzlich `roster_plannable = true`, damit eine Feste-Zeiten-Kraft keine neuen Schichten per Tausch erhält. *(Falls du das anders willst — sag es, dann bleibt Tausch unberührt.)*

**Nicht angetastet** (geprüft, dass sie andere Pfade nutzen): Zeiterfassung (`stempeln`, `zeit-uebersicht`, `schichten`), Lohn/Exporte, Verwaltungs-Personalliste (`staff.index.tsx`, `admin/staff.functions.ts` Listen-Query), Urlaubs-/Abwesenheitsplaner (`vacation-planner.functions.ts` — laut Auftrag ausdrücklich ausgenommen), Frei-Wünsche der Mitarbeiter (Selbstansicht), Dokumente, Statistik, `pap-2026/**`. Bestehende `roster_shifts` bleiben unverändert sichtbar — gefiltert werden nur Personenlisten.

## Verwaltungs-UI

In der Mitarbeiter-Detailseite (`staff.$staffId`, Stammdaten-Block) ein Schalter **„Im Dienstplan planbar"** (Default an), Hilfstext: „Aus: für Kräfte mit festen Arbeitszeiten — erscheinen nicht in der Planung; Zeiterfassung und Lohn laufen normal." Umsetzung exakt nach dem bestehenden Muster von `participates_in_pool`: neues Feld in `getStaffDetail` (Select + Rückgabe `rosterPlannable`), neue Server-Funktion `setStaffRosterPlannable` (admin-only, Audit-Log-Eintrag `staff.set_roster_plannable`), Mutation + Invalidierung in der UI.

## Tests (blockierend)

Neues pures Modul `src/lib/roster/roster-plannable.ts` mit `filterPlannable(rows)` (Signatur über eine minimale Row-Form `{ isActive, rosterPlannable }`), das die drei Fundstellen gemeinsam nutzen; dazu `roster-plannable.test.ts`:
- `rosterPlannable: false` ⇒ nicht in der Planungsliste,
- `true` / `undefined` (Bestand) ⇒ enthalten,
- inaktive Person bleibt wie bisher ausgeschlossen,
- allgemeine Staff-Liste (ungefilterter Pfad) enthält die Person weiterhin.

## Technische Details

- Migration (idempotent): `ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS roster_plannable boolean NOT NULL DEFAULT true;` + `COMMENT ON COLUMN ...`. Kein Backfill.
- Kein RLS-/Grant-Wechsel: die Spalte hängt an der bestehenden `staff`-Tabelle mit unveränderten Policies.
- Kommentar-Hygiene: jede geänderte Stelle bekommt einen knappen `RS1`-Hinweis, der nur beschreibt, was tatsächlich passiert.

## Erfolgs-Gate

Vier Gates auf dem Liefer-SHA: `tsc --noEmit` 0 · `eslint . --max-warnings=0` 0 · `prettier --check .` clean · `vitest run` grün. `prettier --write` vor dem Commit, eine Runde = ein Commit. Fertigmeldung nennt die vollständige Fundliste und den SHA.
