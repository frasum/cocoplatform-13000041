# Arbeitsweise & Stammdaten-Referenz — COCO

Stand: 01.08.2026 (§124: STAT3-Serie PDF-Summary komplett; DL2 Abmahnungs-Vorlage; PG-Prognose-Grilling beschlossen)

Schlankes Betriebshandbuch für die laufende Entwicklung. Wird bei jedem neuen Baublock konsultiert. Bewusst kurz gehalten — Architektur-Begründungen stehen im gruendungsdokument.md, nicht hier.

SaaS-Vorbereitung: Readiness-Audit und Modul-Katalog stehen in docs/saas-vorbereitung.md (Leitplanke: keine SaaS-Umbauten vor dem Kassen-Go-live).

Produktionsreife-Review: docs/produktionsreife-review.md (Stand 07.07.2026, HEAD 8cfdbc1d, inkl. Patch-Plan P0–P7) — kritischer Pfad vor dem Kassen-Go-live: Monitoring (P1) → Finalize-E2E (P2) → Restore-Probe (P3) → Cutover.

TH1 — Standort-Farbthema: LocationThemeProvider im \_authenticated-Layout hält den themeKey (spicery/yum/neutral).
LocationPills melden die Auswahl per useLocationThemeSync; Mapping: Name enthält „spicery" → spicery, „yum" → yum, sonst neutral (auch TSB/„Alle"/leer).
PillSelect färbt nur mit themed-Prop (setzt LocationPills); alle anderen PillSelect-Verwendungen bleiben unverändert. Druck ignoriert das Theme (@media print).

NAV1 — Personal-Anträge umbenannt (früher „Stammdaten & Dokumente"), Dokument-Vorlagen in den Mitarbeiter-Bereich verschoben.
Top-Tab „Dokumente" entfällt; /admin/dokumente bleibt unverändert erreichbar.

**PL1-Fix Urlaub-Sichtbarkeit (05.07.2026):** In
`permission_role_defaults` war `roster.leave.view_all` als Default für
die Rolle `planer` hinterlegt — `resolvePlanerScope` erhielt dadurch bei
`has_permission(perm, null, null)` sofort `true` und kurzschloss auf
`{all:true}`, so dass `listLeaveRequests`/`decideLeaveRequest` KEINEN
Bereichs-Filter mehr anwendeten (Planer sah Service-Urlaubsanträge).
Fix: Migration löscht diesen Default → Planer greift wieder auf
`permission_overrides` zurück (Sumitr: Küche an beiden Standorten). Der
**Jahresplaner** (`getVacationPlanner`) ist gezielt entkoppelt und
standort-gattert (nicht bereichs-gattert): sobald der Planer an einem
Standort irgendeinen Bereich frei hat, sieht er dort BEIDE Blöcke
(Küche + Service) — bewusst, weil die Balken-Übersicht die
Kollisionen zwischen Bereichen zeigen muss. Schichttausch war schon
korrekt bereichs-scoped (kein planer-Default für `roster.swap.view_pending`).

**Nachschärfung 05.07.:** `roster.leave.view_all` aus den
`planer`-Rollen-Defaults entfernt (Migration) — Sicht ausschließlich über
gescopte Overrides.

**PL2 (06.07.2026) — Planer-Regression durch globale Vorab-Checks:** Die
PL1-Nachschärfung (Löschung des `roster.leave.view_all`-Rollen-Defaults für
`planer`) legte einen Muster-Fehler frei: `has_permission` OHNE
`_location`/`_area` matcht nur Overrides mit `location_id IS NULL` — ein
globaler `assertPermission(…, perm, null)`-Vorab-Check liefert für Planer
mit rein GESCOPTEN Overrides daher immer Forbidden, bevor die
`resolvePlanerScope`-Logik dahinter greift. Betroffen: `getVacationPlanner`
(Jahresplaner lud nicht — Frank-Report), `listLeaveRequests`,
`listPendingSwaps`. Fix: Vorab-Checks entfernt; neuer getesteter Helper
`assertScopeNotEmpty(scope, perm)` (`scope-util.ts`) wirft NACH der
Scope-Auflösung, wenn weder `all` noch irgendeine Freigabe vorliegt —
Sicherheits-Invariante unverändert (Berechtigungslose weiter Forbidden;
admin/manager via `all=true` unverändert). Regel: Vor `resolvePlanerScope`
nie ein globaler `assertPermission`-Check — das Gate ist
`assertScopeNotEmpty`. Gescopte Checks MIT `location`/`area` (z. B.
`moveRosterShift`) und Self-Service-Rechte bleiben unberührt. Vier Gates
grün (1457 Tests).

**BB1 (05.07.2026):** Buchhaltungs-Spalte „Besonderheiten" =
**Auto-Teil** (live aus `roster_absence`, `formatAbsenceNote` in
`src/lib/time/absence-note.ts` mit `mergeAbsenceRanges` wiederverwendet
aus `vacation-planner.ts`, auf Perioden-Grenzen `[periodStart, periodEnd]`
geklippt, Format `Urlaub 12.–24.07. · Krank 03.07.`, chronologisch mit `·`)
**+ editierbarer** `payroll_notes.besonderheiten`-Notiz. Der Auto-Teil wird
**NIE gespeichert** (eine Wahrheit — Korrekturen an der Quelle im
Urlaubs-/Krank-Datensatz); UI zeigt ihn dezent (Kalender-Icon, muted, mit
Tooltip) über dem Notiz-Feld; PDF/Excel-Export zeigt beide Teile getrennt
durch `|` (nur vorhandene Teile). Server liefert `absenceNote` in
`listAbsencesByStaff` mit; kein Schema, keine Migration.

**Stempeln-Abmelden generalisiert (05.07.):** Der „Abmelden"-Knopf auf der
Stempel-Seite gilt für ALLE (Zurück-Link bleibt). Ersetzt den kurzlebigen
Sumitr-Namens-Hardcode (`special-cases.ts`, gelöscht). Grundsatz: Personen-
Hardcodes sind unerwünscht — Bedürfnisse werden generisch gelöst.

**EIN1 (05.07.2026):** Einstellungen/Allgemein in vier Unter-Tabs
gegliedert (Trinkgeldpool · Bestellungen · Sofortmeldung & Arbeitgeber
· Telegram), Tab-Wahl im URL-Param `?tab=…` (Reload/Verlinkung halten
die Position, z. B. `…/admin/einstellungen?tab=telegram`). Die sechs
bisherigen Sektionen sind als eigene Komponenten nach
`src/components/settings/` extrahiert
(`TrinkgeldpoolSection`, `BestellungenSection`, `SofortmeldungSection`,
`ArbeitgeberSection`, `TelegramBotSection`,
`TelegramTagesberichtSection`). Reine Umgruppierung — Formulare,
Validierungen, Server-Aufrufe und Texte sind Zeichen für Zeichen
identisch. Die org-settings-Mutation (`updateOrgSettings` erwartet
alle fünf Felder gemeinsam) bleibt im Container und wird von
Trinkgeldpool- + Bestellungen-Sektion via Props geteilt, damit das
bisherige Speicherverhalten beider Karten erhalten bleibt.

**ST1 (05.07.2026) — Standort-Lebenszyklus:** Neue Spalte
`locations.is_active boolean NOT NULL DEFAULT true` als reine
Sichtbarkeits-Markierung. Die zentrale Standort-Auswahl
(`listLocations` in `src/lib/admin/locations.functions.ts`) filtert
default `is_active = true` und akzeptiert optional
`{ includeInactive: true }` — nur die Standorte-Admin-Seite nutzt
diesen Zweig (deaktivierte Standorte erscheinen dort gedämpft mit
Badge „deaktiviert" und Button „Aktivieren"). Alle Auswahl-Oberflächen
im System (Zeitübersicht-, Kasse-, Dienstplan-, Jahresplaner-,
Statistik-, EasyOrder-, Verkaufsartikel-, Batch-, Display-,
Mitarbeiter-Pills usw.) beziehen ihre Liste über `listLocations` und
bekommen inaktive Standorte damit automatisch nicht mehr angeboten.
Zusätzlich überspringt der **Telegram-Tagesbericht**
(`telegram-report.server.ts`) inaktive Standorte. Historische
DATEN-Abfragen (Zeit-Einträge, Sessions, Lohn, Buchhaltung) und
`staff_locations`-Zuordnungen bleiben unangetastet — wer den Standort
später reaktiviert oder alte Daten auswertet, sieht alles. Direkter
Aufruf einer Display-/Detailroute eines inaktiven Standorts liefert
weiterhin Inhalt (kein 404). Neue admin-only Server-Function
`setLocationActive({ locationId, isActive })` schaltet den Zustand um
(Audit `location.activated` / `location.deactivated`). Löschen ist
härter: Dialog verlangt das Eintippen des Standort-Namens; die
Server-Regel „nur referenzfreie Standorte löschbar" (Check auf
`staff_locations`) bleibt unverändert die eigentliche Sicherung. Der
Dialog empfiehlt Deaktivieren als Alltagsweg. Status: TSB deaktiviert,
bis der Standort aufgesetzt wird.

**ST1b (05.07.2026) — Rest-Audit:** Alle rohen `from("locations")`-Stellen
durchgegangen. Ursache der weiterhin sichtbaren TSB-Pills auf
`bestellung/verkaufsartikel` (und potenziell weiteren Auswahl-Seiten):
`admin/locations.tsx` teilte den Query-Key `["admin","locations"]` mit
allen Auswahl-Oberflächen, rief `listLocations` aber mit
`includeInactive: true` auf — der Admin-Cache hat die gefilterte Liste
überschrieben. Fix: eigener Key `["admin","locations","with-inactive"]`
auf der Admin-Seite; `invalidateQueries` per Prefix trifft weiterhin
beide. 0 Auswahl-Ladestellen mussten inhaltlich umgestellt werden
(alle nutzten schon `listLocations`). 15 Daten-/Integritäts-Zugriffe
(`assertLocationInOrg`, Namens-Joins an historischen Bestellungen/
Zeiteinträgen/ICS, Import-Zuordnungen, Provisions-Update, Display-
API, Geofence-Check) sind bewusst ungefiltert und tragen jetzt einen
`// ST1: bewusst ungefiltert — Daten-Zugriff …`-Kommentar, damit das
Audit wiederholbar ist. `telegram-report.server.ts` filtert bereits
eigenständig auf `is_active = true` (aus ST1).

**KAB1 (05.07.2026):** UI der Tagesabrechnung konsolidiert — der manuelle
Button „Session speichern" ist entfernt (Auto-Save deckt denselben Payload
ab, verifiziert: `handleSave` und Auto-Save-Effekt in `SessionFieldsCard`
rufen dasselbe `build()` → `onSave(payload)`). Feedback zeigt jetzt der
Status-Text im Card-Footer („Automatisch gespeichert · HH:MM",
„Speichert…", bei Fehler „Speichern fehlgeschlagen — erneut versuchen"
mit Retry-Link); der zuvor pro Auto-Save gefeuerte Toast entfällt.
Finalisieren und Sperren sind ein EIN kontextueller Status-Button
(Beschriftung folgt `session.status`: `open` → „Tag finalisieren",
`finalized` → „Session sperren" (für Manager disabled + Tooltip
„Sperren: nur Admin"), `locked` → Badge „Gesperrt 🔒" mit `locked_at`).
Ein kleiner Status-Stepper Offen → Finalisiert → Gesperrt zeigt den
Fortschritt. Die BESTEHENDEN Dialoge und die Status-Maschine
(`finalizeSession`, `lockSession`, `assertCashWritable`) sind
unverändert. Der DR1-Druck-Button ist zusätzlich statusbewusst: bei
`open` öffnet er den Kopplungs-Dialog „Tag finalisieren & drucken?"
(primär „Finalisieren & drucken" → strikt erst `finalizeSession`, dann
Druck; sekundär „Nur drucken" für Zwischen-Ausdrucke; Admin-Checkbox
„danach Session sperren" ruft nach erfolgreichem Druck-Aufruf
`lockSession`); bei `finalized`/`locked` druckt er direkt.

**DR1 (05.07.2026):** Auf `admin/kasse` gibt es zusätzlich zum bisherigen
„PDF Export" (Archiv/Mail) den primären Button **„Tagesabrechnung
drucken"**. Ein-Klick-Druck: die Seite baut aus dem gemeinsamen
`buildDailySummaryData(...)`-Objekt (dieselbe Datenquelle wie das PDF —
eine Zahlen-Wahrheit, KGL-Lektion) eine HTML-Druckansicht
(`renderDailyPrintHtml`) und öffnet den System-Druckdialog via unsicht­bares
`srcdoc`-iframe (`printDailySummary`). HTML statt PDF-iframe, weil Safari
eingebettete PDFs unzuverlässig druckt (Leerseiten-Bug bei Frank/Mac);
`window.open` wird bewusst vermieden (Popup-Blocker). Stilles Drucken ist
browserseitig nicht möglich — Minimum ist der Systemdialog. Der PDF-Export
bleibt als Zweitfunktion erhalten.

**KAB2 (05.07.2026 abends):** Nach dem aktiven Praxistag wurde der
Tagesabrechnungs-Einstieg auf **einen Knopf** reduziert. Weg sind: der
Status-Stepper Offen → Finalisiert → Gesperrt, der Button „Tag
finalisieren" samt Dialog, der Kopplungs-Dialog „Finalisieren &
drucken?" (inkl. der Sekundärfunktion „Nur drucken") und der Button
„PDF Export" (der Bau-Pfad `generateDailySummaryPdf`/`PdfCanvasPreview`
bleibt im Repo — der Typ `PdfExportData` wird von `DailyPrintView` und
den Tests importiert; nur der UI-Einstieg entfällt). „Session wieder
öffnen" (finalized → open) ist ebenfalls raus. **„Tagesabrechnung
drucken"** ist der einzige Ausgabe-Weg: bei Status `open` läuft ohne
Rückfrage direkt der `finalize_print`-Pfad — strikt erst
`finalizeSession`, dann Druck, für Admins anschließend `lockSession`
(vormals verstecktes Default-Verhalten); bei `finalized`/`locked` wird
wie bisher direkt gedruckt (kein Statuswechsel). Bewusste Konsequenz:
**Zwischen-Ausdrucke eines offenen Tages gibt es nicht mehr — Drucken
finalisiert immer.** Als schlanke Sicherheitsventile stehen rechts
neben dem Druck-Button ein dezentes Status-Badge („Offen" /
„Finalisiert" / „Gesperrt 🔒 · locked_at") und admin-only die kleinen
Buttons „Session sperren" (nur bei `finalized`) sowie „Session
entsperren" (nur bei `locked`, ruft `unlockSession`, Wasserlinie bleibt
bewusst unverändert — Warntext im Dialog). Die Server-Fns
(`finalizeSession`, `lockSession`, `unlockSession`) und
`assertCashWritable` sind unverändert; nur der UI-Einstieg wurde
umgebaut. Der Druck-Fehlerpfad bleibt erhalten: schlägt
`finalizeSession` fehl, wird NICHT gedruckt.

## 1. Rollenverteilung im Team

Drei Rollen, klar getrennt:

- **Lovable Agent = Baumeister.** Schreibt Code, Migrationen, UI auf Basis eines präzisen Prompts. Committet nach main.
- **Claude = Architekt / Prüfer.** Schreibt die Prompts (mit „Nicht anfassen"-Liste und Erfolgs-Gate), prüft jeden Commit via git fetch + Tests + ESLint, gibt Migrations-Vorab-SQL aus.
- **Frank = entscheidet & führt SQL aus.** Gibt Prompts an Lovable, genehmigt, führt alle SQL-Statements selbst im Supabase-Editor aus (Datenhoheit).

Begründung: Bei einem System mit Geld, Arbeitszeit und RLS sind stille Fehler teuer. Die Dreiteilung erzwingt einen Review-Loop und verhindert „stille Lösungen".

## 2. Review-Loop (nach jedem Lovable-Commit)

```
git fetch -q origin && git reset -q --hard origin/HEAD
git log --oneline <letzter-SHA>..origin/HEAD
npx eslint src/ --max-warnings=0
npx vitest run
```

Erst wenn ESLint 0 Fehler und alle Tests grün sind → ABGENOMMEN.

## 3. Pflicht-Regeln (aus Erfahrung teuer gelernt)

- **Prettier/ESLint VOR jedem Commit.** Die CI fährt `prettier --check` über das **ganze Repo** (inkl. `docs/`), nicht nur `src/` — genau daran hingen mehrfach rote Runs (tsc/vitest grün, nur Format rot). Jeder Lovable-Prompt endet daher mit diesem Pflicht-Block: „Vor dem Commit: `npx prettier --write .` + `npx eslint --fix src/` über alle geänderten Dateien. Danach müssen `npx tsc --noEmit` (0 Fehler), `npx eslint . --max-warnings=0` (0 Fehler), `npx vitest run` (grün) und `npx prettier --check .` (sauber, **ganzes Repo**) alle durchlaufen. Erst dann committen. Jede Abweichung vom freigegebenen Plan wird im Chat gemeldet, BEVOR committet wird." → Spart die wiederkehrenden Formatierungs-Nachzieher.
- **CI nach JEDEM Commit prüfen**, nicht erst wenn rote Runs auflaufen. (Lektion: zwischen CI #75 und #88 waren ~13 rote Runs unbemerkt.)
- **Migrationen immer als Vorab-SQL-Skizze im Prompt mitgeben** — nicht Lovable raten lassen. Reduziert Schema-Fehler erheblich.
- **Massen-SQL in Batches** (max. ~2000–2500 Zeilen pro Datei), sonst bricht der Supabase-Editor mit Connection-Fehler ab. Bei Fehler einfach nochmal „Run".
- **Dokument nach JEDER Session nachziehen** — egal ob mit Claude oder direkt mit dem Lovable-Agenten gearbeitet wurde. Mindestens den Modul-Status (Abschnitt 6/7) aktualisieren. Diese Datei ist die gemeinsame Wahrheit für beide Arbeitswege; nur wenn sie aktuell bleibt, driften die Wege nicht auseinander. Beim Wiedereinstieg gilt der hier dokumentierte Stand als Ausgangspunkt (nicht der „letzte gesehene" Stand einer einzelnen Person), daher: `git pull` + `git log` gegen diesen Stand, um auch Direkt-Commits zu erfassen.
- **Geld-Helfer zentralisieren — aber Verhaltens-Deltas ehrlich machen.** Gleichnamige Helfer divergieren oft subtil (`parseEuroToCents` hatte vier Varianten: leer→`0` vs `null`, negativ erlaubt vs nicht, Punkt als Tausender- vs Dezimaltrenner). Konsolidieren ist erlaubt, aber **nie stillschweigend**: vorher byte-diffen, jede Verhaltensänderung im Prompt/Commit explizit benennen und mit Charakterisierungstests festnageln. Seit 20.06. ist `parseEuroToCents` eine Implementierung in `@/lib/format` (Optionen `emptyAs`/`allowNegative`), die zwei bewussten Deltas sind getestet. **Gleiche Form ≠ gleicher Vertrag:** `parseLocaleNumber` (Prozent/Stunden → Float/NaN) bleibt von `parseEuroToCents` (Geld → Cent/null) getrennt — nicht über Domänengrenzen verschmelzen.
- **Identity-Cache: `await invalidateQueries(["identity"])` VOR `router.invalidate()`/`navigate`.** `ensureQueryData` (react-query v5, `revalidateIfStale` default `false`) liefert sonst stale Cache ohne Refetch abzuwarten → nach Passwortwechsel/Impersonation-Start/-Stop Redirect-Loop. `removeQueries` vermeiden (Flicker beim aktiven AuthContext-`identityQuery`). Guards in `passwort-aendern.tsx`, `impersonate.tsx` (`handleStart`), `impersonation-banner.tsx` (`handleStop`).
- **Jedes DB-Schreibergebnis prüfen (`if (error) throw`).** Verschluckte `.update()`/`.insert()`-Fehler auf Geld-/Zeit-Pfaden brechen unbemerkt Invarianten — z. B. blieb im Auto-Ausstempeln ein fehlgeschlagener Link-Write still, sodass der Idempotenz-Marker `auto_clockout_time_entry_id` NULL blieb und ein Resubmit doppelt ausstempeln konnte. Kein `supabaseAdmin`-Schreibaufruf ohne Fehlerprüfung.
- **PostgREST-`.or()`-String-Interpolation nur mit Allowlist-validierten Werten.** Einzelne DSL-Zeichen zu strippen reicht nicht — Wildcards `*`/`%` bleiben stehen (`firstName="*"` matcht alle). Namens-Eingaben im Login laufen über `validatePinLoginName`; ungültige → generische Ablehnung.
- **CI-Jobs:** `check` (tsc+eslint+vitest) muss grün sein. `db-integration` hat jetzt drei Robustheits-Schichten gegen Infrastruktur-Flakes (CI1, 15.07.): setup-cli-Token+Version-Pin (gegen GitHub-API-Rate-Limit beim Release-Auflösen) · H4-Start-Retry (gegen ghcr-Rate-Limit bei `supabase start`) · `withDbInsertRetry` in Seed-Helfern + Vitest-`retry: 1` nur für `*.db.test.ts` (gegen „invalid response from upstream server" bei Test-Body-Inserts). Manueller Re-Run nur noch als letzter Ausweg.
- **Migrationen sind beim Commit bereits live.** Lovable wendet committete Migrationen automatisch auf die (einzige) Produktiv-Supabase-Instanz an. Daraus folgt:
  - Frank führt **committete Migrationen NICHT** selbst aus. Nach dem Commit nur noch eine **Read-only-Verify-Query** (Signatur-/Policy-/`to_regprocedure(...)`-Check) zur Bestätigung des DB-Stands.
  - Manuelles SQL durch Frank gilt nur noch für **Ad-hoc-/Daten-SQL** (Imports, einmalige Korrekturen) — nicht für Migrationsdateien.
  - **„prüfe" ist Nachkontrolle, kein Tor vor dem Livegang.** Das Tor _vor_ Live ist der **Prompt** (Migration als fertige SQL-Skizze + „Nicht-anfassen"-Liste + Stop-Bedingung). Fehler werden **vorwärts** mit einer Korrektur-Migration behoben (kein Rückbau — die DB kann nicht zuverlässig zurück). Migrationen daher **additiv/idempotent** (`IF NOT EXISTS`, `ON CONFLICT`, `DROP … IF EXISTS`).
  - Nach jedem Migrations-Commit **zügig prüfen + funktional smoke-testen** — statisches Review fängt Laufzeitfehler nicht (s. Caller-Param-Bug bei den Task-RPCs).
- **Neue Stammdaten-Spalte ⇒ Select-Liste mitziehen.** Jede neue Spalte auf `staff_personal_details`, die der Berechnungspfad braucht, MUSS in die explizite `.select(...)`-Liste in `src/lib/lohn/lohn-rechner.functions.ts` (Funktion `computeLohnForStaff`). Migration + Mapping (`staffDetailsToPerson`) + Berechnung allein reichen NICHT: fehlt die Spalte im Select, kommt sie als `undefined` an → `!!undefined = false` bzw. `?? default` → das Feature greift stillschweigend nicht, obwohl Code, Daten und CI grün sind. (Aktivrente-Hebel 26.06.: ~1 h Phantom-Deploy-Suche, bis die fehlende Select-Spalte gefunden war.) Daher nennt jeder Hebel-Prompt mit neuer Spalte die Select-Erweiterung explizit.
- **Vor neuem Tabellen-/Enum-Bau: existierendes Schema UND diese Doku prüfen.** Bevor eine neue Tabelle oder ein neuer Enum entsteht, gegen `src/integrations/supabase/types.ts` greppen (`awk '/^      <tabelle>: \{/,/^      }/' …`) UND Abschnitt 6 / diese Datei lesen — oft existiert der Speicher schon. Beispiel 29.06.: Für Abwesenheits-Overlays wurde kurzzeitig `staff_absences` gebaut, obwohl `roster_absence` / `leave_requests` (Abschnitt 6) Abwesenheiten längst führen → verworfen (siehe Abschnitt 20). Welle-B/C-Direktbauten (Frank+Lovable ohne Claude) existieren auch ohne Claudes Wissen; das prüfe-Protokoll (git pull + `types.ts` + Doku) gilt damit auch fürs **Schema**, nicht nur für Code.
- **Storage-Buckets nie als Migration:** Der Lovable-Migrations-Guard blockiert
  `INSERT INTO storage.buckets` in Migrationsdateien still (`bucket_sql_blocked`
  — so dreimal unbemerkt beim staff-documents-Bucket, 03.07.2026). Buckets
  gehören in `docs/seed-storage.sql` (Ops-Seed, bei DB-Neuaufbau manuell nach
  den Migrationen ausführen). `storage.objects`-Policies sind davon nicht
  betroffen und bleiben reguläre Migrationen.
- **Storage-Buckets sind nicht migrationsfähig** (Plattform-Blockade
  `bucket_sql_blocked`): Anlage/Änderung nur über das Lovable-Storage-Tool,
  niemals per SQL-Migration beauftragen. Repo-Parität ersetzt dieses Inventar
  (bei jedem neuen Bucket hier nachtragen, `public`-Flag ist Pflichtangabe):

  | Bucket            | public | Zweck                                       |
  | ----------------- | ------ | ------------------------------------------- |
  | `staff-documents` | false  | SP-Dokumente (Ausweise, Nachweise)          |
  | `payslips`        | false  | PaySlip-PDFs (Welle D, depriorisiert)       |
  | `task-photos`     | false  | AF1 Aufgaben-Fotos (signierte URLs, 60 min) |

- **Lovable-Diskrepanz-Meldungen: erst SHA-Beweis, dann glauben.** Zweimal
  am 03.07. meldete Lovable „Prompt kollidiert mit Code-Realität" bzw.
  behauptete „mein Workspace ist identisch mit origin/HEAD (Revert)" —
  beide Male war die Sandbox desynchron und origin unversehrt (frischer
  Clone mit Zeitstempel als Beweis). Regel: Bei jeder Diskrepanz-Meldung
  zuerst `git rev-parse HEAD` des Workspace UND von origin verlangen;
  Claude verifiziert parallel per frischem Clone. Bis zur Klärung darf
  Lovable NICHTS committen (Push aus alter Sandbox wischt neuere Commits
  weg — E1-Muster). Origin ist die Wahrheit, nie die Workspace-Aussage.
- **PostgREST-1000-Zeilen-Kappung:** Jeder Supabase-Read, dessen
  Ergebnismenge 1000 Zeilen erreichen KANN (Artikel, Zuordnungstabellen,
  Historien), läuft über `selectAllPaged` mit stabilem `ORDER BY`
  (`id`-Tiebreaker). Unpaginierte Reads nur für ID-Lookups und hart
  begrenzte Mengen. (Lektion BFIX2: die Kappung schlägt still zu — keine
  Fehlermeldung, nur fehlende Daten.)
- **REVOKE-from-PUBLIC auf RPC-Funktionen nie ohne `GRANT EXECUTE … TO service_role`** (42501-Vorfall §95). Trigger-Funktionen sind die Ausnahme — dort kein Grant nötig.
- **E1-Freigabe-Disziplin (seit 14.07., Lovable kann keine Branches):** Jeder Lovable-Block, der eine MIGRATION trägt, geht erst an Lovable, nachdem Frank das Vorab-SQL explizit freigegeben hat („SQL ok"). Destruktives SQL läuft unverändert über Regel A/B (Frank führt selbst aus). Reine Code-Blöcke ohne Migration brauchen keine Vorab-Freigabe. Jeder Migrations-Merge wird unmittelbar published (Migration+Deploy gekoppelt, §87).
- **SQL-Kennzeichnung Fall 1/2/3:** Jedes SQL vom Prüfer trägt im Kopf sein Ziel: **Fall 1** = von Frank in der COCO-DB ausführen · **Fall 2** = von Frank in bestellung.pro ausführen · **Fall 3** = NICHT ausführen, nur freigeben (Lovable-Migrations-Skizze, E1). Wird Fall-3-SQL versehentlich manuell angewandt, wird die Migration idempotent nachgezogen (MA1-Muster §96).
- **Test-Seeds gegen das vollständige Schema-Verhalten prüfen** — Check-Constraints UND Trigger-Auto-Seeds (§89 Steuerklassen, §96 Kanäle). Wo ein Auto-Seed existiert: SELECTen statt INSERTen.

## 4. Stammdaten-Referenz (COCO Produktion)

### Organisation

| ID  | organization_id                        |
| --- | -------------------------------------- |
|     | `77838674-26c1-40dd-9b74-eb1041e79b95` |

### Standorte (locations)

| Name    | location_id                            |
| ------- | -------------------------------------- |
| Spicery | `44a99e7e-93be-44b1-89ab-38e364a02ddc` |
| YUM     | `14c2d773-6c5f-4a24-ba00-1c726f277091` |
| TSB     | `7918a4cd-0388-49b3-abfb-8105b8f17815` |

### Rollen

`admin > manager > staff` (Hierarchie) + zwei **Seitenrollen** (RANK 0 — erben **keine** Hierarchie-Rechte): `payroll` (nur Lesezugriff auf Zeitübersicht/Perioden/Buchhaltung, kein Schreibrecht) und `planer` (Dienstplan-Bearbeitung, aber nur in freigegebenen `(Standort, Bereich)`-Kombinationen via `permission_overrides`; sieht den ganzen Plan, ändert nur den eigenen Scope — Details §25/§26).

### Abrechnungsperioden

Immer **26. eines Monats bis einschließlich 25. des Folgemonats**. Label = Monat des End-Datums. Beispiel: „Juni 2026" = 26.05.–25.06.2026.

### Skills (skills-Tabelle, je Kategorie)

| Name        | Kategorie | Farbe     |
| ----------- | --------- | --------- |
| VS          | kitchen   | `#bae6fd` |
| PASS        | kitchen   | `#fecdd3` |
| SPÜLEN      | kitchen   | `#d1fae5` |
| CO          | kitchen   | `#fed7aa` |
| SERVICE     | service   | `#dbeafe` |
| BAR         | service   | `#ede9fe` |
| 19 Uhr      | service   | `#99f6e4` |
| GL          | gl        | `#ffe4e6` |
| Hausmeister | other     | `#e7e5e4` |

## 5. Alt-System → COCO Mappings (für Daten-Migrationen)

### Quell-Repos (Lovable/GitHub, frasum)

- **COCO (Ziel, kanonisch seit §113):** cocoplatform-13000041 (privat)
- **tagesabrechnung** (Kasse/Zeit-Quelle) — `gh repo clone frasum/tagesabrechnung`
- **bunker-shift-flow** (Dienstplan-UI-Vorlage: RosterGrid, Paint-Tool) — `gh repo clone frasum/bunker-shift-flow`
- **thaitime-12f46b18** (Dienstplan-Daten + Display-Vorlage)
- **bestellung-5fff1793** (M5-Quelle, hat `SYSTEM_BLUEPRINT.md`) — `gh repo clone frasum/bestellung-5fff1793`

**Klon-Befehle für die Prüf-/Referenz-Repos** (Claude zieht diese für Golden-Master & Portierung; geklont werden, nicht raten):

```bash
gh repo clone frasum/tagesabrechnung
# Referenz: src/lib/shiftCalculations.ts (SFN-Golden-Master), src/lib/sfnRates.ts (M4-Geldsätze),
#           src/pages/DailySummary.tsx (Kassen-Abgleich), src/pages/zeiterfassung/ZtBruttoNetto.tsx (SFN-Geld simple/extended)

gh repo clone frasum/bunker-shift-flow
# Referenz: src/components/roster/RosterGrid.tsx + PaintToolbar.tsx (M3-UI),
#           src/lib/sfn.ts + sfn.test.ts (zweite SFN-Testquelle), src/lib/billing-cycle.ts (26.–25.-Zyklus)

gh repo clone frasum/bestellung-5fff1793
# Referenz: SYSTEM_BLUEPRINT.md + Welle-4/EasyOrder-Quelllogik (M5)
```

### thaitime → COCO Standort-Mapping

| thaitime branch     | COCO location |
| ------------------- | ------------- |
| `spicery 83f56090…` | Spicery       |
| `yum f1229497…`     | YUM           |
| `TSB 2b00f500…`     | TSB           |

### thaitime → COCO Skill-Mapping (Dienstplan)

| thaitime           | COCO        |
| ------------------ | ----------- |
| Vorspeise          | VS          |
| pass               | PASS        |
| spülen             | SPÜLEN      |
| Kochen 1, Kochen 2 | CO          |
| Service 1–4        | SERVICE     |
| Bar                | BAR         |
| 19 Uhr             | 19 Uhr      |
| GL                 | GL          |
| Hausmeister        | Hausmeister |

### tagesabrechnung → COCO Kassen-Mapping (Juni-Nachimport, 29.06.2026)

Rekonstruiert per Kalibrierung gegen bereits validierte Bestands-Sessions (Referenztag 10.06.). Geld = Quellwert ×100 → `*_cents`. **`sessions.id` und `waiter_settlements.id` werden 1:1 aus der Quelle übernommen.**

**Standort:** `restaurant_id` `3065f458-…` → YUM, `a1710390-…` → Spicery. (TSB hat in der Quelle keine Kassen-Sessions.)

**`sessions`:** `pos_total`→`vectron_daily_total_cents`; `session_date`→`business_date`; `guest_count`, `einladung`, `finedine_vouchers`, `vorschuss`, `sonstige_einnahme`, `vouchers_sold/redeemed` → gleichnamige `*_cents`. Konstant gesetzt: `status='open'`, `tip_pool_settlement_only=true`, `opentabs_deduction_cents=0`, `cash_actual_cents`/`opening_balance_cents`=NULL.

**Kanäle (`session_channel_amounts`, je `channel_id`):** `wolt_revenue`→Wolt, `takeaway_total`→Vectron-Takeaway, `ordersmart_revenue`→SOUSE. **Terminals (`session_terminal_amounts`, je `terminal_id`):** `terminal_1_total`→Terminal 1, `terminal_2_total`→Terminal 2, `card_total_gl`→Kredit Karten GL. **Null-Beträge erzeugen keine Zeile.** Diese Tabellen haben **keine** `location_id`-Spalte.

**`waiter_settlements` (eine Zeile je `waiter_shifts`):** `pos_sales`→`pos_sales_cents`; **`kassiert_brutto_cents = pos_sales` (Entscheidung A** — folgt der Live-Wahrheit, nicht dem Quell-Feld `kassiert_brutto`); `card_total`, `cash_handed_in`, `differenz`, `open_invoices`, `kitchen_tip`, `hilf_mahl` → `*_cents`; `kitchen_tip_rate`=0.0200; `status='submitted'`; `submitted_at` aus Quelle. `partner_staff_id`/`second_waiter_name`=NULL, `additional_waiters='[]'`. **Die Tabelle hat keine `location_id`-Spalte.** Zusatzkellner bekommen **keine** Settlement-Zeile.

**`session_tip_pool_entries`:** `hours_minutes = round(hours_worked × 60)`. Service je `waiter_shifts` mit `participates_in_pool=true`; Küche je `kitchen_shifts`. **Zusatzkellner** (`additional_waiters`/`second_waiter_name`) erhalten einen **eigenen** Service-Eintrag mit den Stunden des Primärkellners und `note='Zusatzkellner-Nachimport'`. Die Tabelle hat **keine** `location_id`-Spalte.

**Mitarbeiter-Auflösung:** Quell-`waiter_name`/`staff_name` → COCO `staff_id` über `upper(staff.display_name)` (case-insensitive). Sonderfälle: Login-Form `jirawut.saechiang` → `COCO` (perso 19); `KRIS` → `KRISS` (Quelle schrieb dieselbe Person in zwei Schreibweisen).

**Idempotenz:** Import-SQL nutzt durchgängig `WHERE NOT EXISTS` (gefahrlos mehrfach ausführbar); Kassendetail-Tabellen (`session_card_transactions`/`session_expenses`/`session_bank_deposits`/`session_advances`/`session_register_transfers`) werden für diese settlement-only-Sessions **nicht** befüllt.

**Leere native Hüllen ersetzen (26./27.06., nachgezogen 29.06.):** Beim Nachimport zeigte sich, dass COCO für manche Tage bereits eine **leere native Session-Hülle** führt — die Session existiert, hat aber `vectron_daily_total_cents=0` und 0 Kind-Zeilen. Eine Lückenerkennung über die reine **Session-Existenz** übersieht diese; geprüft werden muss der **Inhalt** (vectron + Zähler von `waiter_settlements`/`session_channel_amounts`/`session_terminal_amounts`/`session_tip_pool_entries`). Betroffen waren YUM 28. sowie YUM **und** Spicery 26.+27. Behandlung = **guarded Replace**: die leere Hülle nur löschen, wenn sie kinderlos ist (`NOT EXISTS` auf alle vier Kind-Tabellen, die eigene Legacy-`id` per `id <> …` ausgenommen), dann die Legacy-Session mit Legacy-`id` einspielen — atomar in `BEGIN…COMMIT`. **Konsequenz für den Go-Live-Re-Import:** Der muss leere native Hüllen **ersetzen**, nicht nur fehlende Tage auffüllen — sonst bleiben Tage mit Null-Umsatz in der Abrechnung sichtbar, obwohl die Legacy echte Zahlen hat.

### Mitarbeiter-Mapping

Über das Nickname in Klammern im thaitime-Vornamen, z.B. „REDACTED" → COCO display_name „REDACTED". Sonderfall: „REDACTED" → REDACTED. „REDACTED" existiert nicht in COCO (ignoriert). Sonderfall Doppel-Nickname GIG: Der bestehende Küchen-„GIG" (perso 360) und der neue Service-„GIG" tragen in thaitime denselben Nickname-Stamm — daher KEIN Auto-Match. „(GIG SERVICE)" ist per Hardcode auf den eigenen Service-Mitarbeiter `staff_id 93e44abe-d1d8-4763-b0a6-63cea7313687` (display_name „GIG SERVIE", Spicery/`service`) gemappt; der Küchen-GIG bleibt unverändert.

## 6. Aktueller Modul-Status (29.06.2026)

| Modul                                                                                                                                                                                                 | Status                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B3 Kasse + B4 Trinkgeld + B5 Tresor                                                                                                                                                                   | ✅                                                                                                                                             |
| B6 Zeitübersicht (Wochenplan/Zusammenfassung/Buchhaltung/Perioden)                                                                                                                                    | ✅                                                                                                                                             |
| B7 Perioden (26.–25.) + Import Jan–Sep 2026                                                                                                                                                           | ✅                                                                                                                                             |
| B8 Lohnbüro-Rolle (payroll)                                                                                                                                                                           | ✅                                                                                                                                             |
| D1 Dienstplan-Datenmodell + Grid                                                                                                                                                                      | ✅                                                                                                                                             |
| D2a–e Dienstplan editierbar, Realtime, Service-Symbole, Cross-Booking                                                                                                                                 | ✅                                                                                                                                             |
| D-8 Eine Einteilung/MA/Tag (Pre-Check + UI-Lock, kein DB-Constraint)                                                                                                                                  | ✅                                                                                                                                             |
| Dienstplan-Migration (Re-Import 17.06.: 3764 · Delta-Nachimport 29.06.: +114 → 3873, inkl. Jul–Sep-Planung + GIG-Service)                                                                             | ✅                                                                                                                                             |
| D3 Display — Token, Auto-Refresh, Einstellungen (Rotation/Bereiche/Header/Legende/Nachricht/QR), Bereichs-Freigabe, Geburtstags-Banner                                                                | ✅                                                                                                                                             |
| M4 Lohn — Rechen-Kern (Stufe 1/3): PAP 2026 + SV, edlohn-cent-getestet                                                                                                                                | ✅                                                                                                                                             |
| M4 Lohn — SFN-Geld + Perioden-Aggregation + Verdrahtung (Stufe 2a–c)                                                                                                                                  | ✅                                                                                                                                             |
| M4 Lohn — Lohnrechner-UI + Excel-Export (`/admin/lohnrechner`)                                                                                                                                        | ✅                                                                                                                                             |
| M4 Lohn — Perioden-Übersicht (Liste aller aktiven MA je Periode, Klick → Detail)                                                                                                                      | ✅                                                                                                                                             |
| M4 Lohn — Lohnrechner-Übersicht CSV-Export (edlohn-Abgleichs-Datensatz)                                                                                                                               | ✅                                                                                                                                             |
| M4 Lohn — Sachbezug + Mahlzeiten als automatische Lohnarten                                                                                                                                           | ✅                                                                                                                                             |
| M4 Lohn — Soll-Std/Tag-Feld (Vertrags-Soll je MA)                                                                                                                                                     | ✅                                                                                                                                             |
| M4 Lohn — Urlaub/Krank ins Brutto (`lohn_absence_days`, Tage = Vorgabe)                                                                                                                               | ✅                                                                                                                                             |
| Provision (wochenbasiert)                                                                                                                                                                             | ✅ P1 Server + P2 UI (E2E-Freigabe Frank ausstehend)                                                                                           |
| Geofencing-Stempeln (UI clockIn nur am Standort, distinct-Location)                                                                                                                                   | ✅                                                                                                                                             |
| PIN-Login via Vorname/Nickname                                                                                                                                                                        | ✅                                                                                                                                             |
| Hub & Meine Schichten (`/zeit/schichten`, `/zeit/stempeln`)                                                                                                                                           | ✅                                                                                                                                             |
| M-Statistik — Umsatz (S-1/S-2: reine Fn + Server-Fn, Kalendermonat, doppelzählungsfrei)                                                                                                               | ✅                                                                                                                                             |
| M-Statistik — Trinkgeld (S-7: Tagesreihe + Totals + perStaff, Reuse computeSessionTipPoolCore)                                                                                                        | ✅                                                                                                                                             |
| M-Statistik — Personalquote (S-8: Basis-Brutto B2, gültigkeitsdatierter hourly_rate)                                                                                                                  | ✅                                                                                                                                             |
| M-Statistik — UI (Tabs, KPI/Chart, Trinkgeld, Personalquote, Standortvergleich, PDF, freier Zeitraum)                                                                                                 | ✅                                                                                                                                             |
| Inventur-Session an DB gebunden                                                                                                                                                                       | ✅                                                                                                                                             |
| Self-Service Welle B — Freier-Tag-Wunsch (`/zeit/wuensche`)                                                                                                                                           | ✅                                                                                                                                             |
| Self-Service Welle C — Urlaubsanträge + Genehmigung (`/zeit/urlaub`, `/admin/urlaub`)                                                                                                                 | ✅                                                                                                                                             |
| Kasse — Vier-Zeilen-Bargeldblock + Soll-Wechselgeld je Standort                                                                                                                                       | ✅                                                                                                                                             |
| Kasse — Abgleichs-Warnungen (POS-/Terminal-Differenz, `payment_terminals.is_gl`)                                                                                                                      | ✅                                                                                                                                             |
| Trinkgeld-Pool — Küche manuell, Plan-Snapshot, GL-Sicht, Teilnahme-Override (§21)                                                                                                                     | ✅                                                                                                                                             |
| Impersonation („Anmelden als") + granularer Rechte-Tab + Passwort-Flows (ändern/zurücksetzen)                                                                                                         | ✅                                                                                                                                             |
| M4 — Payroll-Policies erweitert (`m4-payroll-permissions.db.test`)                                                                                                                                    | ✅                                                                                                                                             |
| Buchhaltung §3b-Block (`/admin/zeit-uebersicht`, payroll-Tab) inkl. Feiertags-Fix                                                                                                                     | ✅                                                                                                                                             |
| Interne Verbesserungen: `@/lib/format`, DE-Lokalisierung, Skeletons, Identity-Roundtrip                                                                                                               | ✅                                                                                                                                             |
| Refactor: `kasse.tsx` aufgeteilt (2189 → 860 Z., `src/components/cash/*`)                                                                                                                             | ✅                                                                                                                                             |
| Auto-Ausstempeln: verschluckter DB-Fehler in `submitWaiterSettlementCore` gefixt (`if (linkErr) throw`)                                                                                               | ✅                                                                                                                                             |
| PIN-/Passwort-Login gegen PostgREST-Filter-Injection gehärtet (Allowlist `validatePinLoginName`)                                                                                                      | ✅                                                                                                                                             |
| `parseEuroToCents` zentralisiert (eine Impl. in `@/lib/format`; Bestellung-Magnitude-Korrektur)                                                                                                       | ✅                                                                                                                                             |
| Artikel-Suche (`listArticles`) gegen PostgREST-`.or()`-Injection gehärtet (`sanitizeArticleSearchTerm`)                                                                                               | ✅                                                                                                                                             |
| jspdf/pdfjs lazy-geladen (#3-Rest: keine statischen PDF-Imports mehr)                                                                                                                                 | ✅                                                                                                                                             |
| Security-Header / CSP (Report-Only) auf HTML-Responses (`withSecurityHeaders` in `server.ts`)                                                                                                         | ✅                                                                                                                                             |
| Mitarbeiter-Matrix (Stammblatt-Umbau: Standort-Dept-Pills, Skill-Eligibility, Index-Redesign)                                                                                                         | ✅                                                                                                                                             |
| payroll = Büro (Index-Sperre + Dienstplan-Ausschluss, keine 4. Abteilung)                                                                                                                             | ✅                                                                                                                                             |
| Wochenplan → Abrechnungsperioden (26.–25., gemeinsamer Periodenbegriff im Zeit-Screen)                                                                                                                | ✅                                                                                                                                             |
| Aufräumen: Dead-Code, `makeAuditWriter` zentral, Typ-Single-Source `staff-domain.ts`                                                                                                                  | ✅                                                                                                                                             |
| Rolle „Planer" (P-1..P-3b: scoped Dienstplan-Zugang, Verwaltung, Login-Redirect; Multiblock verworfen)                                                                                                | ✅                                                                                                                                             |
| M4 Stufe 3a — edlohn-Abgleich Härtung (5 Fixes, GM-Fälle 4–8)                                                                                                                                         | ✅ ABGENOMMEN 03.07.2026, HEAD 1a9f0f4, 1008 Tests grün                                                                                        |
| M-BWA Welle F1 — Schema `bwa_monthly`, Quersummen-Kern, Server-Fns, Erfassung (§41)                                                                                                                   | ✅                                                                                                                                             |
| M-BWA Historie-Import Mai 23–Apr 25 (48 Zeilen, Ist=Soll verifiziert)                                                                                                                                 | ✅                                                                                                                                             |
| M-BWA Welle F2a — Dashboard: KPIs+YoY, Prime Cost, Wasserfall, Break-even (§41)                                                                                                                       | ✅                                                                                                                                             |
| M-BWA Welle F2b — Vergleich-Tab, Sachkosten-Drilldown, Break-even-Sortier-Fix (§41)                                                                                                                   | ✅                                                                                                                                             |
| M-BWA Welle F3 — PDF-Upload + eurodata-Parser mit Review-Screen (§41)                                                                                                                                 | ✅                                                                                                                                             |
| M-BWA Welle F4a — Jahresabschluss-Parser + Server-Layer inkl. Gate-Härtung (§49)                                                                                                                      | ✅                                                                                                                                             |
| M-BWA Welle F4b — Jahresabschluss-UI (Upload, Drill-Down, KPIs, Mehrjahres) + Migrations-Nachzug F4a (§49)                                                                                            | ✅                                                                                                                                             |
| Lohn-RLS-Härtung — SELECT manager+ auf lohn_absence_days/lohn_recurring_zeilen (§42)                                                                                                                  | ✅                                                                                                                                             |
| Welle SP1 — Self-Service Stammdaten & Dokumente: Schema + Server-Layer (§43)                                                                                                                          | ✅                                                                                                                                             |
| Welle SP2 — Mitarbeiter-UI `/profil` (Kontakt direkt, Anträge, Dokumente) (§43)                                                                                                                       | ✅ (SP3 Admin-Review offen)                                                                                                                    |
| §Z3 Wochenplan — Abteilungs-Dimension auf `time_entries`, jede Zeile voll editierbar (`/admin/zeit-uebersicht`)                                                                                       | ✅ (E2E: GL-Eintrag bleibt auf GL — GERARD-Fall bestätigt)                                                                                     |
| §Z4 Wochenplan-Filter — Bereich + Skill (nur Anzeige, Export/Buchhaltung unangetastet)                                                                                                                | ✅ (E2E-Rundgang Frank offen)                                                                                                                  |
| §PV1 POS-Verkaufsstatistik — Namens-Join + kaskadierender Gruppen-Filter (Artikel-Tab in Bestellung/POS-Verkauf)                                                                                      | ✅                                                                                                                                             |
| §PV1a POS-WG-Überschreibung — `sales_pos_group_overrides` (DENY-ALL, manager-Server-Fn, Override vor Namens-Join)                                                                                     | ✅                                                                                                                                             |
| §PV2 POS-Verkauf — XLSX-Upload mit Review-Screen (`replace_pos_sales_stats`, strikter Fußzeilen-Check, Audit)                                                                                         | ✅ (E2E: optionaler Idempotenz-Reupload offen)                                                                                                 |
| §PV3 POS-Stundenbericht — Vectron „Stunden-Bericht (lang)", Chart+Tabelle, Upload mit Fußzeilen-Gate (`pos_hourly_stats`)                                                                             | ✅ (Real-Datei-Validierung durch Claude: Spicery 101.283 Stk / 9.817.288,78 € · YUM 97.695 Stk / 8.383.044,04 € — Upload-Freigabe Frank offen) |
| §KAB2 Tagesabrechnung Ein-Knopf-Flow — „Tagesabrechnung drucken" = finalize→print(→lock), Status-Stepper/PDF-Export/Kopplungs-Dialog raus, dezente Statuszeile + Admin-Sperren/Entsperren als Ventile | ✅ (E2E-Rundgang Frank offen)                                                                                                                  |
| Rezeptur-Modul R1–R2b (Schema, Rechenkern, Editor, Anlage vom Verkaufsartikel)                                                                                                                        | ✅ (Golden-Master-Referenzgericht ausstehend)                                                                                                  |
| Betriebskalender RT1/UZ1 (Ruhetage, Ausnahmen, Feiertags-Urlaubsregel)                                                                                                                                | ✅                                                                                                                                             |
| Schichtbetrieb SP1/SP1b (service_period, Display-Rotation, Marker)                                                                                                                                    | ✅ (aktiviert erst bei TSB-Reaktivierung)                                                                                                      |
| Trinkgeld-Modell je Standort TG1 (Pool-Schalter, Overrides, Abschluss-Warnung)                                                                                                                        | ✅                                                                                                                                             |
| Monitoring & Impersonation-Härtung P1/IMP2 (Sentry, 60-min-Verfall)                                                                                                                                   | ✅ **VOLLSTÄNDIG inkl. DSN + beidseitiger Probe (07.07.2026)**                                                                                 |
| SP2 Drei-Fenster-Modell (`locations.enabled_service_periods`, Früh/Mittag/Abend)                                                                                                                      | ✅                                                                                                                                             |
| P2 Finalize-E2E (Kassen-Finalize Playwright-Rundgang, Seed-Cluster)                                                                                                                                   | ✅ 3/3 lokal grün (HEAD `9d401acb`) — CI-Job auf Promotion beobachten                                                                          |
| ENV1 `.env`-Enttrackung + CI-Secret-Guard                                                                                                                                                             | ✅ (HEAD `a17dd3e1`)                                                                                                                           |

**Juni-Kassenlücke geschlossen (29.06.2026):** YUM (16., 18.–25.) und Spicery (16., 18.–25., 28.) aus `tagesabrechnung` nachimportiert — 19 Sessions; das leere native YUM-28 durch Legacy-Daten ersetzt. `vectron_daily_total_cents` 19/19 gegen die Quelle verifiziert. Mapping siehe Abschnitt 5.

**⚠ Offen bei COCO-Go-Live (Wiederholung des Imports):** COCO läuft derzeit nur als **Test**; `tagesabrechnung` ist weiterhin **live** und im Produktivbetrieb. Beim Umschalten von COCO auf live müssen **alle bis dahin in COCO fehlenden Tagesabrechnungen erneut** aus `tagesabrechnung` nachgezogen werden (nicht nur die Juni-Lücke). Das Mapping und das idempotente Import-Verfahren (`WHERE NOT EXISTS`) stehen in Abschnitt 5 und sind 1:1 wiederverwendbar — pro Durchlauf nur die fehlenden Session-IDs/Tage neu exportieren und einspielen.

**Stand 26.06.2026 (Lohnrechner — Perioden-Übersicht):**

- **Geteilter Rechen-Kern (`lohn-rechner.functions.ts`):** Der Pro-MA-Zusammenbau (`aggregateSfnPeriod` → `staff_personal_details` → `staffDetailsToPerson` → Entgeltzeilen → `berechneLohn`) wurde aus `berechneLohnFuerMitarbeiter` in den privaten Helper `computeLohnForStaff(supabaseAdmin, { staffId, fromDate, toDate, mode, zusatzZeilen })` extrahiert. **Einzelansicht und Übersicht rechnen über denselben Helper** — kein zweiter Rechenpfad, kein Drift. Reine Code-Verschiebung (Golden-Master + `lohn-core` unverändert grün → verhaltensgleich). Rückgabe-Shape von `berechneLohnFuerMitarbeiter` bleibt 1:1.
- **Neue read-only serverFn `berechneLohnUebersicht`** (`payroll.calc.run`, `loadAdminCaller(["admin","payroll"])`, org-scoped): rechnet **alle aktiven MA** einer Periode. Schleife mit **`try/catch` pro MA** — ein MA ohne `staff_personal_details` erscheint mit „—" + Hinweis statt die ganze Liste abzureißen (die Einzelansicht wirft dort weiterhin bewusst). Übersicht rechnet **ohne** manuelle Zusatzzeilen (rohe Perioden-Rechnung); Zeilen liefern `totalHours`, `hourlyRateCents`, `zuschlagCents`, `bruttoCents`, `nettoCents`, `auszahlungCents`.
- **UI `/admin/lohnrechner`:** Perioden-Dropdown (26.–25., aus `listPeriods`) **ersetzt** die freien Von/Bis-Felder; Default = neueste Periode. Übersichts-Tabelle mit Spalten **Mitarbeiter · Stunden · Stundenlohn · Zuschläge · Brutto · Netto · Auszahlung**. **Klick auf eine Zeile** öffnet die **unveränderte** Detailansicht (Zeilen, Person, Ergebnis, Excel-Export, Zusatzzeilen) für den MA; Fehlerzeilen sind nicht klickbar. Altes Staff-Dropdown entfernt.
- **Gates:** `tsc`/`eslint --max-warnings=5`/`prettier`/`vitest` (743) grün. Kein Schema-/RLS-/Migrations-Eingriff (read-only über `supabaseAdmin` hinter Permission-Gate).

**Stand 26.06.2026 (M4 Lohn — Übersichts-CSV + edlohn-Abgleich: Sachbezug/Mahlzeiten, Soll-Std/Tag, Urlaub/Krank ins Brutto):**

- **CSV-Export der Lohnrechner-Übersicht (`/admin/lohnrechner`):** voller Abgleichs-Datensatz für den edlohn-Vergleich. Reines Modul `src/lib/lohn/lohn-csv-export.ts` (`buildUebersichtCsv`, getestet): `perso_nr` (= edlohn-Personal-Nr., Join-Schlüssel), SFN-Topf-Stunden, alle Steuer-/SV-Cent-Felder. UTF-8-BOM, `;`-getrennt, Geld als Cent-Ganzzahl, Kommentar-Headerzeile mit Periode. Download über `downloadBlob` — **nicht** über eine vorab im State erzeugte Object-URL (die wird vom React-Query-Refetch widerrufen → toter `blob:`-Link; Fix-Lektion).
- **Sachbezug + Mahlzeiten als automatische Lohnarten** (Migration `20260626104055`: `staff_personal_details.meal_allowance bool default true` + `sachbezug_monthly_cents int default 0`). Reines Modul `src/lib/lohn/fixed-zeilen.ts` (`buildFixedZeilen`, `mahlzeitSachbezugCent(year)`, `countDistinctWorkdays`, getestet). Sachbezug = fixer Monatsbetrag pro Person (50 € als Flag; perso 1,11,25,129,309 = 0). Mahlzeiten = distinct Arbeitstage × amtl. Sachbezugswert (2026 = 4,57 €, 2025 = 4,40, 2024 = 4,13; jahres-gemappt, 16. SvEV-ÄndVO v. 19.12.2025). `lohn-core.ts` behandelt beide Kategorien (`sachbezug_frei`/`mahlzeiten_paust`) bereits korrekt (ins Gesamtbrutto, RAUS aus St-/SV-Brutto, am Ende als geldwerter Vorteil abgezogen) — es fehlte nur das automatische Erzeugen. CSV um `arbeitstage`/`mahlzeiten_cent`/`sachbezug_cent` erweitert. Cent-genau gegen edlohn verifiziert.
- **Soll-Std/Tag-Feld** (Migration `20260626114245`: `staff_personal_details.soll_hours_per_day numeric default 8`). Vertragliche Soll-Stunden/Arbeitstag (8/7/6) — **nicht** der Ist-Schnitt: edlohn rechnet die Urlaub/Krank-Basis mit dem Vertrags-Soll (lange Ist-Schichten verzerren den Durchschnitt).
- **Urlaub/Krank ins Brutto** (Migration `20260626121324`: Tabelle `lohn_absence_days(staff_id, organization_id, period_start, urlaub_tage, krank_tage)`; RLS SELECT own-org, write manager+):
  - **Tagezahl = Franks Vorgabe.** Der Dienstplan rotiert → keine festen Arbeits-Wochentage; die genaue Tagezahl ist Franks manuelles Urteil. Frank pflegt sie pro Periode (`period_start` = Periodenbeginn, z. B. `2026-04-26` für „Mai 2026") per SQL in `lohn_absence_days`. COCO rechnet nur Basis + Zuschlag darauf.
  - **4 steuerpflichtige `zeitlohn`-Zeilen** (analog edlohn-Abrechnung) aus `src/lib/lohn/urlaub-krank-zeilen.ts` (`buildUrlaubKrankZeilen`, getestet): Urlaubsstunden + Zuschlag Urlaubsentgelt (3M-Ø), Lohnfortzahlung Krankheit + Zuschlag Krank (3M-Ø). Beide St=L/SV=L (Kategorie `zeitlohn`, **nicht** `zuschlag_frei`): SFN-Zuschläge in Urlaub/Krank sind voll steuer-/SV-pflichtig (§3b EStG nur für tatsächlich geleistete Arbeit; fortgezahlte Zuschläge = Phantomlohn, BSG 2024).
  - **Basis** = Tage × Soll-Std/Tag × Stundensatz (aus `staff_compensation`, auch bei 0 Ist-Stunden vorhanden) → cent-genau gegen edlohn.
  - **Zuschlag** = Tage × 3-Monats-Ø SFN/Tag. Der 3M-Ø kommt aus `urlaub-krank-diagnose.ts`/`urlaub-krank-core.ts` (read-only): Fenster 91 Tage vor Periodenbeginn, SFN-Geld ÷ (gearbeitete + eigene Abwesenheitstage). **Den Nenner um die eigenen Abwesenheitstage zu erweitern war der Schlüssel** — sonst ist der Schnitt bei zuletzt viel-abwesenden MA ~2× zu hoch. Liegt ±~15 % an edlohn (edlohns interne 3M-Glättung nicht bit-genau nachbaubar; bewusst „nah").
  - **CSV:** `urlaub_tage`/`krank_tage` (verwendet) + `urlaub_tage_est`/`krank_tage_est` (COCO-Schätzung als Befüll-Hilfe) + `avg_std_tag`/`avg_sfn_tag_cent`.
- **End-to-End-Abgleich (Mai 2026):** 9/11 Abwesenheits-MA innerhalb ±1 % St-Brutto gegen edlohn. Ausreißer perso 23 (+98 %) und 317 (+22 %) sind die separaten Midijob-/Stundenkürzungs-Lücken (COCO rechnet volle Ist-Stunden, edlohn gekürzt), **nicht** die Abwesenheitszahlung.
- **Verifizierter Stand:** HEAD `a753cf0` — `tsc`/`format:check`/`eslint --max-warnings=5`/`vitest` (765) grün.
- **Noch offen am edlohn-Abgleich** (separate Hebel, kartiert): Midijob-Übergangsbereich-SV (perso 17,23,117,334,358), `hourly_rate_2`/Doppelsatz, StKl 5/6 (PAP), Provision (wochenbasiert), Nischen (GF-Tantieme/bAV, Aktivrente).

**Stand 20.06.2026 (Session-Nachzug, Teil 2 — Härtung & Security-Header):**

- **Artikel-Suche gegen PostgREST-Injection gehärtet (`articles.functions.ts`):** `listArticles` baut den Suchfilter über `.or(name.ilike…, article_number.ilike…)`. Neuer Sanitizer `sanitizeArticleSearchTerm` entfernt alles außer Buchstaben/Ziffern/Leerzeichen/`-`; bleibt nichts übrig, entfällt der Filter (statt kaputter Query). **Schweregrad niedrig** (org-scope + `is_active` sind separate AND-Filter, Injection kann sie nicht umgehen; Aufrufer bereits manager+) — Hauptnutzen ist Robustheit (legitime Suchen wie „50%" / „ART-(2)" funktionieren jetzt). Damit ist die gesamte `.or()`-Injektionsfläche abgedeckt: PIN-/Passwort-Login (s. Block oben) und Artikel-Suche gehärtet; `order-units.functions.ts` interpoliert nur eine **session-abgeleitete UUID** (nicht injizierbar, bewusst belassen, Defense-in-Depth offen).
- **jspdf/pdfjs lazy-geladen (#3-Rest):** Alle drei PDF-Generatoren (`generateDailySummaryPdf`, `buildWeeklyPdf`, `buildBuchhaltungPdf` — letzterer war im ersten Plan **vergessen** und wurde nachgezogen) jetzt `async` mit dynamischem `import("jspdf")`; die drei Aufrufstellen (`kasse.tsx`, `zeit-uebersicht.tsx` ×2) mit `await`. `pdfExport.ts` nutzt `import type jsPDF` nur für den Rückgabetyp (Fall B). pdfjs: `import * as pdfjsLib` dynamisch in der `useEffect`-IIFE; die `?url`-Worker-URL bleibt statisch (billig). **`recharts`-Lazy-Load ist ein separater, noch offener Schritt.** vitest 715.
- **Security-Header / CSP (Report-Only):** `src/lib/security-headers.ts` (`withSecurityHeaders`) setzt auf **HTML-Responses** HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (`geolocation=(self), camera=(), microphone=()`) und eine **`Content-Security-Policy-Report-Only`**. Angewendet im Cloudflare-Worker-Entry `src/server.ts` (`fetch`-Wrapper — der zuverlässige Engpass, bewusst nicht in einer Middleware). CSP-`connect-src` enthält `wss://*.supabase.co` (Dienstplan-Realtime). **Noch Report-Only** → protokolliert Verstöße, blockiert nichts.
  - **Preview-Fix (X-Frame-Options entfernt, Commit `2715360`):** `X-Frame-Options` wurde komplett entfernt — samt der Host-Allowlist `isLovablePreviewHost`. Grund: der Header ist all-or-nothing und blockierte das **legitime** Lovable-Editor-iframe (die Projekt-Domain `cocoplatform.lovable.app` fiel durch die Allowlist → `DENY` → Vorschau tot). Framing wird jetzt **nur über CSP `frame-ancestors 'self' https://lovable.dev https://*.lovable.dev`** gescoped; ein evtl. vorgelagert gesetztes `X-Frame-Options` wird aktiv gelöscht. Da CSP Report-Only ist, blockiert `frame-ancestors` aktuell nicht → Vorschau läuft.
  - **Domain-Wechsel — Betriebsnotiz:** Der Security-Header-Code ist **domain-agnostisch**: überall `'self'`, das die Auslieferungs-Domain automatisch verfolgt; **kein COCO-Host ist hartkodiert**. Ein Domain-Wechsel erfordert daher **keine** Code-Änderung an den Headern. Relevant wird die Domain nur beim späteren **CSP-Scharfschalten** (Report-Only → erzwingend): dann entscheiden (a) die finale Produktions-Domain und (b) ob weiter über den Lovable-Editor gearbeitet wird, ob `frame-ancestors` `lovable.dev` behält oder auf `'self'`/`'none'` verengt wird. Beim Scharfschalten `cdn.gpteng.co` **nicht** whitelisten — das ist Lovables Editor-Skript, das nur in der Vorschau injiziert wird und in Produktion fehlt (am Live-Tab `cocoplatform.lovable.app/auth` verifiziert: kein `gpteng.co`-Request). **Außerhalb des Repos** (Frank-Seite, nicht im Code) zieht ein Domain-Wechsel nach: Supabase → Auth → Site-URL/Redirect-URLs umstellen (sonst brechen Login-Redirects und Passwort-Reset-Mails); MailerSend SPF/DKIM bzw. FROM-Domain im DNS. Randnotiz: Geocoding läuft über `connector-gateway.lovable.dev` (Lovable-Plattform-Endpoint) — kein Domain-Thema, aber zu ersetzen, falls COCO die Lovable-Plattform ganz verlässt.
  - **Auth-Seite Hydration-Meldung (kein Bug, dokumentiert damit nicht erneut untersucht):** `/auth` ist bewusst `ssr: false` (der `getSession()`-Check im `beforeLoad` ist Browser-Storage-abhängig). Die Konsole zeigt dort eine React-Hydration-Meldung (`+<main>` vs `-<Suspense>`) — das ist das **erwartete Verhalten** der SSR-deaktivierten Route (Server schickt den Platzhalter, Client rendert das echte `<main>`), kein Funktions- oder Sicherheitsproblem; Login, Redirect, alles läuft. Ein im selben Tab sichtbarer Passwortmanager (`completion_list.html?username=…`) mutiert nur die Input-Felder, ist **nicht** die Ursache dieser Meldung. Nicht reaktiv „fixen".

**Stand 20.06.2026 (Session-Nachzug):**

- **Auto-Ausstempel-Fix (`cash.functions.ts`):** Im Auto-Ausstempel-Pfad von `submitWaiterSettlementCore` wurde der Fehler des Link-Writes (`waiter_settlements.auto_clockout_time_entry_id`) still verschluckt → jetzt `const { error: linkErr } = … ; if (linkErr) throw linkErr;`. **Bekanntes Restfenster (nicht in diesem Fix):** `performClockOut` läuft vor dem Link-Write und ist nicht atomar mit ihm; bleibt der Link bei einem transienten Fehler NULL (Idempotenz-Marker), kann ein **späterer** Resubmit nach erneutem Einstempeln doppelt ausstempeln. Durable Lösung wäre, den „bereits ausgestempelt"-Check auf die Existenz eines Clockouts mit `triggered_by='settlement'` + `settlement_id` zu stützen — vertagt.
- **PIN-Login gegen PostgREST-Filter-Injection gehärtet (`auth-flows.server.ts` / `.functions.ts`):** `toPostgrestIlikeLiteral` (strippte nur `( ) , . \`, ließ aber `*`/`%` als Wildcards durch → `firstName="*"` matchte alle) **entfernt**, ersetzt durch Allowlist `validatePinLoginName` (`/^[\p{L}][\p{L} -]*$/u`, getrimmt). Ungültige Namen → generische Ablehnung **vor** der Query; der `.or()`-Filter interpoliert weiter, aber sicher (Wert ist DSL-/Wildcard-frei). Die Kandidaten-Query ist von PIN- **und** Passwort-Login geteilt → Allowlist gilt für beide. Neue Test-Suite `auth-flows.server.test.ts`. **DB-Check (Produktion) bestätigt:** kein aktiver Mitarbeiter hat Apostroph/Punkt/Ziffer im `first_name`/`display_name` → kein Lockout.
- **`parseEuroToCents` zentralisiert:** eine Implementierung in `src/lib/format.ts` (`opts: { emptyAs?: 0 | null; allowNegative?: boolean }`); die vier lokalen Varianten ersetzt (kasse-helpers + abrechnung = dünne Options-Wrapper, Aufrufstellen unverändert; beide Bestellung-Dateien importieren direkt mit Defaults). **Bewusste Verhaltensänderungen, getestet:** Bestellung — `"12.50"` ergibt jetzt `1250 ct` statt `125000 ct` (fachliche Korrektur); kasse/abrechnung — Tausendertrenner `"1.234,56"` wird akzeptiert (vorher null→`?? 0`→0 € verbucht), Trailing-Dot `"12."` abgelehnt. **Kein stilles Umskalieren** (alle Deltas nur null↔Zahl). `parseLocaleNumber` (Prozent/Stunden → Float/NaN) bleibt bewusst getrennt — kein Geld-Parser.

**Stand 18.–19.06.2026 (Session-Nachzug):**

- **Auth-/Admin-Ausbau:**
  - **Impersonation („Anmelden als"):** `src/lib/admin/impersonation.functions.ts` (`startImpersonation`/`stopImpersonation`), `src/components/impersonation-banner.tsx`, Route `/admin/impersonate`. **Start** sitzt in `impersonate.tsx` (`handleStart`), **Stop** im Banner (`handleStop`) — nicht in `impersonate.tsx`.
  - **Granularer Rechte-Tab** im Staff-Detail: `permissions-catalog.ts`, `permissions.functions.ts`, `PermissionsTab.tsx`.
  - **Passwort-Flows:** `passwort-aendern.tsx`, `reset-password.tsx`, `password-change.functions.ts`, `password-generator.ts`, `account.functions.ts`. `createStaffAccount` spiegelt den bewährten Flow: `auth.admin.createUser` mit `app_metadata.staff_id`, `user_links`-Insert, `must_change_password=true`, gibt das einmalige Standardpasswort als **Klartext** zurück (nicht geloggt). Admin-gated, schreibt `audit_log staff.account_created`.
  - **M4-Payroll-Policies erweitert** (+ `m4-payroll-permissions.db.test.ts`).
- **Payroll-Kraft „Viktoria Schaffer" angelegt** (Rolle `payroll`, Login `…@etl.de`, PIN). **Bewusst ohne `staff_locations`** → unsichtbar in Dienstplan + Zeitübersicht. **Merker:** Diese Sichtbarkeit hängt an `staff_locations` (`getStaffForRoster` joint es, `getTimeOverview` zieht aus `time_entries` an der Location), **nicht an der Rolle** — kein Rollen-Filter im Code. `participates_in_pool` für externe Kräfte explizit `false` (DB-Default ist `true`).
- **Buchhaltung §3b-Block** im `payroll`-Tab von `/admin/zeit-uebersicht`: §3b-Toggle (Einfach/§3b), Spalten 20–24/24–X/SO-FEI, im §3b-Modus zusätzlich Sonntag/Feiertag 125 %/Feiertag 150 %, Footer-Summen, Suche, PDF/Excel-Export (`buchhaltung-export.ts`, **ExcelJS** — kein `xlsx`). Perioden- und Buchhaltung-Tab existierten bereits (B6/B7) — **kein Neubau**, nur Anreicherung.
  - **Feiertags-Bug gefixt (`e105780`):** `getSfnOverview` rechnete `"simple"` mit leerer `holidayRates`-Map → „Feiertag"/„Feiertag 150 %" strukturell **immer 0**, alles unter „Sonntag". Fix: reine, getestete `src/lib/lohn/compute-staff-sfn.ts` (baut die Map via `bavarianHolidaySurchargeRate`, rechnet simple **und** extended), `getSfnOverview` nutzt sie modusabhängig. 20–24/24–X bleiben die §3b-25 %/40 %-Töpfe (`night25`/`night40`, Entscheidung Frank).
- **Interne Verbesserungen (ohne Verhaltensänderung):**
  - **`src/lib/format.ts`** — nur die byte-identischen Helfer `fmtCents`/`parseIso`/`todayIso` zentralisiert. `parseEuroToCents`/`fmtTime`/`formatDuration`/`daysBetween` **bewusst lokal gelassen** (divergente Varianten, s. §3).
  - **DE-Lokalisierung** `__root.tsx` (404/Error-Seite, `lang="de"`).
  - **Skeleton-Loader** `src/components/ui/page-skeletons.tsx` (kasse/zeit-uebersicht; Dienstplan hatte keinen „Lade…"-Text → Skeleton exportiert, ungenutzt).
  - **Identity-Roundtrip** via `ensureQueryData` in beiden `_authenticated`-`beforeLoad` (ein `getMyIdentity` pro Session statt zwei) + 3 Invalidate-Guards (s. §3).
- **Refactor `kasse.tsx` aufgeteilt (2189 → 860 Z.):** Sub-Komponenten nach `src/components/cash/*` (SettlementWarningsBanner, SettlementsCard, SessionFieldsCard, CashSummaryBlock, ExcelRows, ExpenseForm, AdvanceForm, TipPoolCard), Helper nach `src/lib/cash/kasse-helpers.ts`, geteilte Typen nach `kasse-types.ts`. Byte-identische Extraktion, Tests unverändert (685). `parseEuroToCents` blieb byte-identisch (nicht gemergt).

**Stand 17.06.2026 (Abend, Session-Nachzug):**

- **Kasse — Abgleichs-Warnungen (POS-Differenz + Terminal-Differenz):** Rotes Banner oben im `/admin/kasse`-Editor, wenn Kellner-Abrechnungen existieren und der Soll/Ist-Abgleich ≥ 1 Cent abweicht. Reines, getestetes Modul `src/lib/cash/settlement-warnings.ts` (`computeSettlementWarnings`); Banner-Verdrahtung in `kasse.tsx` nutzt dieselbe Kanal-`kind`-Auflösung wie der Cash-Ledger (kein zweiter Rechenweg). Legacy-Referenz: `tagesabrechnung` `DailySummary.tsx` (`adjustedPosDiff` / `cardTerminalMismatch`) — **1:1 portiert**, nicht aus einer verbalen Beschreibung rekonstruiert (genau das war zuerst der Bug).
  - **Zwei teuer gelernte Semantik-Regeln (sonst False Positives):**
    1. **Wolt ist NICHT im Vectron-Tagesumsatz** (Drittplattform, läuft nicht über die Vectron-Kasse). Im POS-Abgleich wird Wolt **nie** abgezogen — nur `delivery_vectron` (Vectron-Takeaway) + `delivery_souse`. Identität: `vectron_daily_total = Σ Kellner-POS + delivery_vectron + delivery_souse`.
    2. **„Kredit Karten GL" gehört auf die Kellner-Karten-Seite**, nicht zu den physischen Terminals. Flag `payment_terminals.is_gl` (Frank-SQL in COCO) markiert die GL-Deklaration (Spicery `16ba431d…`, YUM `fcf379d8…`; TSB keine Kasse). Terminal-Identität: `(T1 + T2) = Σ Kellner-Karten + GL`. Der Banner splittet `terminalAmounts` via `is_gl` in physisch vs. GL.
  - **Geld-Pfad unberührt:** Wolt bleibt in `cash-ledger.ts` / Saldo / Export gebuchter Umsatz; nur der Settlement-**Abgleich** zieht es nicht ab. Tests in `settlement-warnings.test.ts` nutzen die echten Spicery-10.06.-Zahlen als Regressions-Guard (POS → 0, Terminal → 0, Gegenprobe ohne GL → 1590).
- **Lohn-Tabelle (B6 `/admin/zeit-uebersicht`) — Vorschuss aus Kasse + U/K-Spalten:** Vorschuss-Spalte jetzt **read-only aus `session_advances`** (Kasse, je Standort × Periode summiert) statt manuellem Eingabefeld — keine Doppeleingabe. U/K-Spalten zeigen Urlaubs-/Kranktage aus `roster_absence` (org-weit). Neue read-only Server-Reader `listAdvancesByStaff`/`listAbsencesByStaff` (GET, `loadAdminCaller([manager,admin,payroll])`, org-scoped). `payroll_notes.vorschuss` wird downstream **nicht mehr gelesen** (write-only `0`). **Merker M4:** Vorschuss ist hier **standort-gefiltert**, Abwesenheiten **org-weit** — beim echten Netto-Lohn den Vorschuss-Abzug eines Mehr-Standort-Mitarbeiters über **alle** Standorte summieren, sonst Unterzählung.

**Stand 17.06.2026 (Nachmittag, Session-Nachzug):**

- **Mitarbeiter-Self-Service Wellen A–C** (aus `/zeit` eine MA-Plattform gemacht):
  - **A — Hub + Meine Schichten:** `/zeit` ist Hub mit Karten (Stempeln/Schichten/Abrechnung/Wünsche/Urlaub). `getMyShifts` liest read-only auf eigene `staffId` via `loadStaffCaller`. Stempeluhr → `/zeit/stempeln`, „Meine Schichten" → `/zeit/schichten`.
  - **B — Freier-Tag-Wunsch:** `/zeit/wuensche` (`createDayOffWish`/`getMyDayOffWishes`/`deleteDayOffWish`, reines `day-off-wishes.ts`). Unverbindlich, kein Tausch.
  - **C — Urlaubsanträge mit Genehmigung:** Tabelle `leave_requests` (Status `offen/genehmigt/abgelehnt`). MA-Sicht `/zeit/urlaub`, Manager-Posteingang `/admin/urlaub` (manager+, `runGuarded`). Genehmigung über atomare **SECURITY-DEFINER-RPC `approve_leave_request`** → expandiert den Bereich in `roster_absence` (type `urlaub`, grüner Schirm im Plan). **Sicherheit:** RPC-EXECUTE nur `service_role` (Lockdown-Migration `20260617190822` — sonst Self-Approval am Manager-Guard vorbei); `leave_requests` nur SELECT für `authenticated`. Reines `leave-requests.ts` (validate/count/can-cancel/can-decide) getestet.
  - **UP1 (04.07.2026): Jahresplaner auf der Urlaubsanträge-Seite** — read-only Sektion unter der Antrags-Liste (manager+). Quelle: `roster_absence` mit `type='urlaub'` (operative Wahrheit, in die die Antrags-Genehmigung expandiert; **nicht** `leave_requests`). Pures Merge-/Positions-Modul `src/lib/roster/vacation-planner.ts` mit Tests (Monatsgrenze, Einzeltag, Lücke trennt, Jahreswechsel-Kappung, Schaltjahr). Server-Fn `getVacationPlanner({locationId, year})` gruppiert aktive Standort-MA nach Bereich (**gl → service**, D-3-Regel). UI: Standort-Pills + Jahres-Nav, Dichte-Streifen (0=transparent, 1–2=dezent, **ab 3=kräftig rot** — Frühwarnung), zwei Bereichsblöcke mit einer kompakten Zeile pro Aktivem (auch ohne Urlaub — Leere ist Information), 12-Monats-Raster, Heute-Linie. Proportional (kein horizontales Scrollen). Keine Schreibpfade; Antrags-Flow und `roster_absence`-Schreiber unberührt.

    **UP2 (04.07.) — Politur:** Dichte-Streifen getrennt je Bereich (Küche/Service, je Block), Zebra über volle Zeile inkl. Name, Namen mittig, Urlaubs-Balken emerald-grün, KÜCHE/SERVICE als abgesetzte Karten; Monats-Raster einmal oben als gemeinsame Referenz. Reines UI — Modul/Server-Fn unverändert.

    **Urlaubszählung — drei Sichten (Klärung 04.07.):** Planung (Anträge, Jahresplaner, Dienstplan-U) zählt KALENDERTAGE der Abwesenheit; der Lohn (`urlaub-krank-diagnose`) schränkt U/K auf die regulären Arbeits-Wochentage aus dem 13-Wochen-Muster ein (individuell, nicht pauschal Mo–Fr); das Urlaubskonto (Anspruch/genommen/Rest) führt edlohn in ARBEITSTAGEN — COCO bucht bei Genehmigung bewusst NICHTS ab (keine zweite Kontowahrheit). Offen (Frank entscheidet): UP3-Anzeige „Kalendertage · vsl. Urlaubstage" auf der Antragskarte.

  - **UA1 (04.07.2026): Stempel-Warnung + Urlaub in „Meine Schichten" & Kalender-Abo.** `clockIn` prüft vor dem Insert die eigene `roster_absence`-Zeile am `business_date` (Typ `urlaub`/`krank`); ohne `confirmAbsence: true` → Fehler-Code `ABSENCE_TODAY:<typ>`, **kein** `time_entry`, **kein** Audit (B2a-Muster). Mit Bestätigung landet der Typ als `meta.absenceOverride: { type }` im `time_entry.clock_in`-Audit — Beleg für die Lohn-Frage „Urlaubstag + Arbeitsstunden". UI `/zeit/stempeln` fängt den Code ab und zeigt „Trotzdem einstempeln"-Dialog. Reine Regel `src/lib/time/absence-warn.ts` mit Tests (Urlaub/Krank/keine/bestätigt). „Meine Schichten" (`/zeit/schichten`) zeigt zusätzlich eine gedämpfte Abwesenheits-Sektion (aufeinanderfolgende Tage per `mergeAbsenceRanges` zu einer Zeile gemerged, Icons 🏖/🤒) via neuer read-only Server-Fn `getMyAbsences({from,to})`. ICS-Feed (`/api/public/calendar/$token.ics`) bekommt für jeden gemergten Urlaubs-/Krank-Block ein ganztägiges Event: `DTSTART;VALUE=DATE` = Startdatum, `DTEND;VALUE=DATE` = **Folgetag** des letzten Tags (RFC 5545: exklusiv), stabile UID `absence-<type>-<staffId>-<startdate>@coco`. Neue ICS-Tests: Einzeltag mit DTEND=+1, Mehrtages-Wrap (12.12.2026–24.01.2027 → DTEND `20270125`), Ganztags ohne Ende weiterhin ohne DTEND. `clockOut`, Auto-Ausstempeln, Pool-Writeback, Wasserlinie und Schicht-Events im ICS unverändert. Keine Migration.
  - **Offen — Welle D:** Payslips einsehen (edlohn-PDF-Split, Dry-Run, Personalnummer je edlohn-Mandant).

- **Geofencing-Stempeln (M1) + Distinct-Fix:** UI-`clockIn` ist server-seitig geofence-gegated (`src/lib/geo/`). `locations` hat `latitude`/`longitude`/`geofence_radius_m` (Default 100 m). `clockIn` verlangt **genau einen distinkten** Standort in `staff_locations` (`pickSingleLocation` in `src/lib/time/resolve-location.ts` zählt distinkte `location_id`, **nicht Zeilen** — behebt, dass ein MA mit zwei Bereichs-Zeilen an EINEM Standort fälschlich blockiert wurde) **und** hinterlegte Koordinaten — sonst sprechende deutsche Ablehnung, kein Eintrag. Manager-Korrekturen geofence-frei. **Voraussetzung Live:** alle Standorte brauchen GPS + Radius, sonst kein Stempeln. Google-Maps-Browser-Key per HTTP-Referrer restringieren (er liegt browser-öffentlich im Repo).
- **PIN-Login via Vorname/Nickname:** `validatePin` matcht `first_name` ODER `display_name` (exakt, case-insensitive), der PIN disambiguiert pro Kandidat, `staffId` aus dem server-seitigen Match (nie Client). Mehrdeutigkeit (zwei Gleichnamige mit gleichem PIN) → Ablehnung, **kein** Fremd-Login. Shadow-Session unverändert.
- **Kasse — Vier-Zeilen-Bargeldblock:** `/admin/kasse` zeigt Tages-Bargeld / Differenz zum Wechselgeld / in den Tresor / Wechselgeldbestand-Input. Soll-Wechselgeld als `locations.cash_balance_target_cents` (`bigint NULL`, Migration `20260617184811`); Resolver `COALESCE(location, organizations.cash_balance_target_cents)`. Reine Summen-Funktion `cash-summary.ts` (`computeSummaryRows`). DayInput-Bau aus `pdfExport.ts` in geteilten Helper `session-day-input.ts` (`sessionToDayInput`) extrahiert — **eine Wahrheit** für PDF + UI; `grossRevenueCents` aus `vectron_daily_total_cents`. Golden-Master-Cash-Tests bleiben grün (verhaltensgleich).

**Stand 17.06.2026 (Session-Nachzug):**

- **Dienstplan-Re-Import korrigiert (4362 → 3764):** `roster_shifts` aus korrigiertem thaitime-`schedule_entries`-Export neu aufgebaut. Aufteilung: Spicery 1848, YUM 1905, TSB 11. Lektion: `locations.name` für Spicery ist klein geschrieben („spicery") — Standort-Auflösung daher über feste `location_id`-UUIDs (§4), nicht über den Namen (ein Name-Join scheiterte zunächst an allen 1846 Spicery-Zeilen). Mapping-Sonderfälle bestätigt: „Sumitr (PAE)" → `SUMITR`, „Elson" (ohne Nickname) → display_name `Elson`; Kosal/BIG inaktiv mit 3 Schichten. **Marker-Lektion:** thaitime speichert „nicht verfügbar" als `schedule_entries`-Zeile mit `notes='\t='` (Beleg WIT 27.01.) — Import nimmt nur notiz-freie Zeilen (3764 echte Schichten); der 4365-Vollexport enthält 601 dieser Marker und darf NICHT importiert werden. Die Lasse-Zeilen sind selbst Marker (existieren nicht in COCO). Nachtrag: der 10:59-Export ließ zusätzlich 2 echte Gerard-Schichten (Spicery 08./09.04.) aus — nachgesetzt → Endstand 3764.
- **Dienstplan-Delta-Nachimport (29.06.: +114 → 3873):** Additiver Nachimport (Mode A) der seit dem 17.06.-Re-Import in thaitime hinzugekommenen Plan-Schichten. 3711 von 3825 thaitime-Zeilen trafen exakt bestehende COCO-Keys (Mapping 1:1 bestätigt); 114 echte Lücken (Spicery 107, YUM 7; Küche 89 / Service 25; Planungshorizont Jun–Sep, Aug + Sep vorher 0). Idempotent via `ON CONFLICT (staff_id, location_id, shift_date, area) DO NOTHING` in `BEGIN…COMMIT`, alle `status='confirmed'`. **Neuer MA „GIG SERVICE":** trägt in thaitime denselben Nickname-Stamm wie der bestehende Küchen-GIG (perso 360) → KEIN Auto-Match, sondern eigener COCO-MA (`93e44abe-d1d8-4763-b0a6-63cea7313687`, „GIG SERVIE", Spicery/`service` in `staff_locations`) + Hardcode-Mapping „(GIG SERVICE)" → diese `staff_id` (18 Schichten). **Lektion:** Delta gegen validierte Bestands-Keys kalibrieren statt raten; Doppel-Nicknames (Gig Küche vs. Service) per Hardcode trennen, sonst zieht der Auto-Resolver beide auf denselben MA; Kalibrier-CSVs mit JOIN-Spalten täuschen echte Tabellen-Spalten vor → vor jedem INSERT `select *` einer Referenzzeile prüfen.

**Stand 16.06.2026 (Session-Nachzug):**

- **B2b-Korrektur-UI entfernt:** `/admin/zeit` (Manager-Zeitkorrektur) + die Server-Functions `listEntriesForCorrection`/`getTimeLockSettings`/`createManualEntry`/`updateTimeEntry`/`deleteTimeEntry`/`setTimeLock` bewusst gelöscht. Schema (`source='manual'`, Wasserlinie) bleibt; Korrektur derzeit nur per SQL. Zeit-Migration aus tagesabrechnung (B2c) **unberührt** (eigenes `migration/`-Subsystem). Details im gruendungsdokument-Nachtrag.
- **Branding O1 entschieden:** App heißt „Central Ops" (BrandLockup über alle Seiten).
- **Standorte:** Kontaktfelder ergänzt (`phone`/`contact_name`/`contact_phone` auf `locations`, Migration `20260616102537`; create/update admin-only, org-gescoped). Live-DB-ALTER ggf. noch ausführen.
- **Personaldaten-Tab** in `/admin/staff/:id` (HR-Daten: IBAN, Steuer-ID, SV-Nummer, Steuerklasse, Bank, Urlaub etc.). Eigene Tabelle `staff_personal_details` (NICHT die `staff`-Stammtabelle). RLS: SELECT nur `admin`/`payroll`, Schreiben nur `admin`, org-scoped (Migration `20260616145016` — **verschärft SELECT von manager+ → admin/payroll; auf Live-DB ausführen, sonst lesen Manager dort noch IBAN/SV**). Audit-Log schreibt sensible Felder nur als `[REDACTED]` (`redactForAudit`, getestet) — nie Klartext. IBAN wird validiert/normalisiert.
- **M2 Kasse — Vollmigration abgeschlossen + validiert (16.06.2026):** Komplette
  tagesabrechnung-Historie (Feb–Juni 2026, Spicery + YUM, **239 Sessions**, 782
  Settlements, 1868 Tip-Pool-Einträge, 184 Ausgaben, 3 Einzahlungen) nach COCO migriert.
  TSB hat keine Kasse-Sessions (nur Dienstplan). Pilot (26.04–25.05) unberührt; 4 manuelle
  Juni-Testtage gelöscht + aus Quelle neu importiert.
- **`tip_pool_settlement_only`-Flag** (Migration `20260616195215`, „Option A"): an
  migrierten Kasse-Tagen bestimmt **nur die Kasse** den Trinkgeld-Pool — `time_entries`
  fügen **keine** zusätzlichen Pool-Köpfe hinzu. Alle bestehenden Sessions = `true`; neue
  Live-Sessions default `false` (Live-Verhalten unverändert).
- **Zusatzkellner-Logik:** Eine Kellnerabrechnung gehört zu _einer Kasse_, nicht zu _einer
  Person_ — mehrere Kellner pro Abrechnung möglich (`additional_waiters`, bis zu 4), alle
  sind Service-Pool-**Mitglieder**, Geld zählt einmal. 156 Zusatzkellner als Service-
  `session_tip_pool_entries` nachimportiert (Stunden = Schichtstunden des Primär-Kellners).
- **Spot-Check 06.03 YUM:** Drei-Wege deckungsgleich (COCO = CSV-Quelle = tagesabrechnung)
  bei Umsatz, Settlements, Pool-Besetzung (Service 5 inkl. Kriss, Küche 110,93 €). Bewusste
  Rest-Differenzen (Historie längst ausgezahlt): COCO verteilt **nach Stunden** (~81 €),
  tagesabrechnung **gleichmäßig** (81,69 €); **EM** bleibt im COCO-Küchen-Pool (das
  „kein Pool"-Flag steckte nicht in den Quell-`kitchen_shifts`).

- **M4 Lohn — Stufe 1/3 (Rechen-Kern) fertig (`src/lib/lohn/`):** Reines, getestetes TS-Modul ohne DB/UI/Serverfunktion. Amtlicher **BMF-PAP 2026** nach TS portiert (`pap-2026/pap2026.ts`, `decimal.js` für die BigDecimal-Arithmetik) → Lohnsteuer/Soli/KiSt-Basis in Cent. **SV-AN-Anteile** (KV/RV/AV/PV mit BBG-Deckel, PV-Kinder-Abschläge, Minijob) in `sv-2026.ts`. Zusammenbau Schritt A–F (Gesamtbrutto → St/SV-Brutto → Netto → Auszahlung) in `lohn-core.ts`. **Golden Master:** 3 edlohn-Referenzfälle (Normal StKl 1 / Minijob / StKl 4 + 2 Kinder) **bitgenau** (`golden-master/edlohn-faelle.json`, blockierende Tests, 598 grün). Minijob-RV = **Gesamt(18,6 %) − AG-Pauschale(15 %)**, je cent-gerundet (nicht direkt 3,6 % — sonst 1 Cent Abweichung). Sätze/BBG 2026 als Konstanten in `config-2026.ts` — **BBG durch die 3 Fälle nicht abgedeckt → noch unbelegt** (4. Gutverdiener-Fall offen). Cloudflare-konform: **kein** Edge Function, **kein** Python. **Offen:** Stufe 2 (Stammdaten an `staff`/`staff_personal_details`; fehlende Spalten KVZ/Kinderlosen-Zuschlag-Elterneigenschaft/Bundesland; `hourly_rate_2` einbeziehen; admin-gated `createServerFn`, die den Kern aufruft), Stufe 3 (UI/Batch/CSV-Export). Methoden-Validierung über einen 2. Minijob-Fall (18,6−15 vs. Abrunden) noch offen.
- **`staff_compensation.hourly_rate_2`** (Migration `20260616232913`, zweiter Stundenlohn für Mitarbeiter in zwei Bereichen, z. B. Service/Küche) ergänzt — Live-DB-`ALTER` ggf. noch ausführen. Fließt in M4-Stufe-2 ein (Brutto = Stunden × Satz je Bereich).
- **M4 Lohn — Stufe 2a–c + UI fertig (17.06.2026), zustandslos:**
  - **2a SFN-Geld** (`src/lib/lohn/sfn-geld/`): Topf-Stunden + Stundensatz → steuerfreie Zuschläge (€) in zwei Modi `simple` (Betriebspraxis „Feiertag wie Sonntag", 50 %) und `extended` (§3b additiv, Nacht stapelt, Feiertag 125/150). Charakterisiert gegen `tagesabrechnung` (`ZtBruttoNetto` `aggregateSimple/Extended` + `sfnRates.ts`); Golden Master **5 Fälle × 2 Modi bitgenau**. Die 50-€-Grundlohngrenze ist (wie im Original) definiert, aber **nicht angewandt**.
  - **2b Perioden-Aggregation** (`time-entry-sfn.ts`, `holiday-rate.ts`, `lohn-period.functions.ts`): Brücke `time_entries` → **rohe** Töpfe inkl. `nightDeep` via `calculateShiftHours` (Europe/Berlin-Uhrzeit), **Pause proportional** abgezogen. Bayerische Feiertage aus dem **Code** (`isBavarianHoliday`, Gauß-Ostern) — **keine** `bavarian_holidays`-Tabelle nötig; 125/150-Split via `bavarianHolidaySurchargeRate` (150 % = 1. Mai, 25./26.12.). Zustandslose admin-Serverfn `getSfnPeriodForStaff` (beide Modi). Reine DB-Aggregation als `aggregateSfnPeriod` herausgezogen (von beiden Serverfns genutzt).
  - **2c Verdrahtung** (`person-mapping.ts`, `lohn-rechner.functions.ts`): `staff_personal_details` → `PersonenParameter` (`tax_class` röm.→1–6, KVZ, Kinderzahl, PV-Kinderlosen-Zuschlag aus Kinderzahl+Alter abgeleitet). `totalHours × Satz` → `zeitlohn`-Zeile, SFN-Zuschläge → `zuschlag_frei`, plus manuelle Handposten (Sachbezug/Mahlzeiten/Abzüge) → Lohn-Kern → Brutto/Netto/Auszahlung. Zustandslose admin-Serverfn `berechneLohnFuerMitarbeiter`. Migration `20260617004033`: `staff_personal_details.kk_zusatzbeitrag` (KVZ %) + `children_count` — **Frank-SQL in COCO** (Spalten müssen je Mitarbeiter gepflegt sein, sonst keine Lohnsteuer).
  - **UI** `/admin/lohnrechner` (admin-gated über Route-`beforeLoad` **und** Serverfn): ruft nur die **read-only**-Funktion, zeigt Zeilen/Person/Ergebnis, **Excel-Export** (`lohn-excel-export.ts`, `exceljs`, reine Präsentation). `hourly_rate_2`-Bereichs-Split bewusst ausgelassen (ein Satz pro Person).
  - **Offen (echter M4-Abnahmetest):** Cent-Abgleich gegen einen bekannten **edlohn-Monat** (setzt gepflegte `staff_personal_details` voraus: Steuerklasse, `kk_zusatzbeitrag`, `children_count`). Zusatz: 4. Gutverdiener-Fall (belegt die BBG-Deckel), `hourly_rate_2`-Split.

**Stand B3/B4 (reconciled 17.06.2026):**

- **Trinkgeld-Pool-Verteilung — erledigt:** `src/lib/cash/tip-pool.ts` (reine Verteilung nach Stunden, getestet), `session_tip_pool_entries`, Küchen-/Mitarbeiter-Pool, `tip_pool_settlement_only`.
- **Kassen-Saldo + Excel-Export — vorhanden:** `/admin/kasse-saldo` (`bargeld-export.ts`, „Export Excel").
- **Wirklich offen:**
  - **Provision (wochenbasiert)** — umsatzbasierte Commission-Formel (`commissionPct`/`minRevenue`: Pool/Tag = Σ max(0,(Umsatz − minRevenue × Kellnerzahl) × %)). Kein Modul/Tabelle im Code. (= der separate „Provision"-⏳-Eintrag.)
  - **D-M2-1 Auto-Ausstempeln bei Abrechnungs-Abgabe** — ✅ umgesetzt (§27): Die Abgabe stempelt Stempler automatisch aus und setzt für Nicht-Stempler das Service-Pool-Ende aus dem Abgabezeitpunkt („Ablauf B"). Damit stempelt das Service-Team in COCO um.
  - **B3c-1 manuelles E2E** des Trinkgeld-/Abrechnungs-Pfads.
  - **D3-Display-Rest:** Bereichs-Rotation, Legende (X/–/U/K/B/♡), Geburtstags-Banner.

**Stand 21.06.2026 (Aufgaben/Kanban-Modul + Migrations-Workflow-Klarstellung):**

- **Migrations-Workflow geklärt** (s. §3): Lovable wendet committete Migrationen direkt auf die Produktiv-DB an; Frank verifiziert nur noch read-only und führt committete Migrationen nicht mehr selbst aus.
- **Aufgaben/Kanban (neuer Modulstrang):** Restaurant-Aufgabenboard. Kategorien `service`/`kitchen`/`maintenance`/`manager_admin`, Status `open/in_progress/done/cancelled`, `priority` 0–3, `sort_order` numeric (Drag&Drop), Archivieren statt Löschen. Manager-Board `/admin/aufgaben`, Staff-Board `/zeit/aufgaben`, Realtime live.
  - **Sicherheitsmuster (Hausmuster):** Schreib-RPCs `create_task/set_task_status/reassign_task/update_task/archive_task/claim_task` sind **service_role-only**; Identität kommt als Parameter (`p_caller_staff_id`/`p_organization_id`) aus dem Server-Fn (`loadAdminCaller`), die Rolle wird in der RPC autoritativ aus `role_assignments` ermittelt. **Kein `auth.uid()`/`current_*()`/`has_permission()` in diesen RPCs** (war unter service_role NULL → „kein aktiver Aufrufer"; live gefixt mit Migration `…123007`). RLS auf `tasks`: nur SELECT (admin/manager + staff), **keine** Client-Schreib-Policy.
  - **Bewusste Entscheidung „volle Transparenz":** Staff sehen alle nicht-archivierten Tasks ihrer Standorte **inkl. `manager_admin`** (anlegen dürfen sie `manager_admin` weiterhin nicht). Archivieren ist admin-only (kein `manager`/`tasks.delete`).
  - **Migrationen (alle live):** `…074514`(Enums) · `…074544`(tasks+RLS) · `…074628`(RPCs) · `…075820`(Staff-Policy+claim) · `…080455`(Realtime) · `…081844`(Permission-Defaults) · `…090845`(claim_task-Grant normalisiert) · `…123007`(RPCs auf Caller-Parameter).
  - **Erledigt (21.06.):** End-to-End-Smoke-Test bestätigt (Anlegen → Staff sieht/claimt → Realtime). **Assignee-Filter nach Kategorie** gebaut — reines, getestetes `filter-staff-by-category.ts`. Standort ist über die Quelle (`staffForLocation` im Admin-Board, `listStaffForLocation` im Staff-Board) bereits erzwungen; der Filter narrowt zusätzlich nach Skill/Rolle (`service`/`kitchen` → Skill-Kategorie; `manager_admin`/`maintenance` → Rolle bzw. `other`-Skill).

**Stand 21.06.2026 (Trinkgeld-Reporting, Netto-Fix, Standort-Pillen, Mitarbeiter-Index Teilstand):**

- **Trinkgeld-/Cash-Reporting (Anzeige, Geld-Kern unverändert):** KPI-Kacheln (`SessionFieldsCard`), Trinkgeld-Quote-Spalte (`SettlementsCard`), Kellner-Pool-Anteil (nur nach Tagesabschluss sichtbar), Tip/h pro Pool. Reine Lese-/Anzeige-Logik über den bestehenden `computeSessionTipPoolCore` — keine Persistenz-/Math-Änderung.
- **Netto-Trinkgeld-Korrektur (Geld-Anzeige-Bug, live gefixt):** Kellner-Sicht zeigte „Mein Trinkgeld (netto, Küche ab)" ohne Abzug des Küchenanteils. `differenz_cents` ist brutto, `kitchen_tip_cents` separat. Neue reine, getestete Funktion `waiterNetTipCents(differenzCents, kitchenTipCents) = max(0, differenz − kitchen_tip)` in `waiter-settlement.ts`, verwendet in `abrechnung.tsx`.
- **Standort-Pillen-Refactor:** `LocationPills` + `pill-select` ersetzen die Standort-Dropdowns quer durch die Admin-Routen; Sentinels (`all`, `""`/`__all__`) bleiben erhalten.
- **Mitarbeiter-Index (Teilstand):** Berechtigung als Dropdown via neuer Server-Fn `setStaffRole` — **admin-only, Last-Admin-Schutz** (`wouldRemoveLastActiveAdmin`), org-gescoped, auditiert (`staff.set_role`) — plus Skill-Chips. **Offen:** Abteilungs-Pills (`setStaffLocationDepartment` mit `organization_id` + In-Org-Validierung), Skill-Sperre nach Abteilung als geteiltes `skill-eligibility.ts` (UI + `assignStaffSkills`), Regel „Abteilungs-Entzug blockieren, solange ein abhängiger Skill aktiv ist", sowie `assertStaffInOrg` in `setStaffRole` als Defense-in-Depth.

**Stand 21.06.2026 (Abend, Session-Nachzug — Mitarbeiter-Matrix, payroll=Büro, Wochenplan-Perioden, Aufräumen):**

- **Mitarbeiter-Matrix abgeschlossen** (schließt den „Mitarbeiter-Index (Teilstand)"-Block oben ab — die dort als _offen_ genannten Punkte sind jetzt erledigt):
  - **Abteilungs-Pills je Standort:** Server-Fn `setStaffLocationDepartment` (toggelt eine `(staff_id, location_id, department)`-Zeile, `organization_id`, In-Org-Validierung via `assertStaffInOrg`/`assertLocationInOrg`, auditiert).
  - **Skill-Eligibility als geteiltes reines Modul** `src/lib/admin/skill-eligibility.ts` (`isSkillCategoryEligible`/`ineligibleSkills`/`distinctDepartments`, getestet) — genutzt von UI **und** `assignStaffSkills`.
  - **Regel (a) „Abteilungs-Entzug blockieren, solange ein abhängiger Skill aktiv ist":** `setStaffLocationDepartment` wirft **vor** dem DELETE, wenn dadurch ein gehaltener Skill verwaisen würde — kein stilles Skill-Entfernen, kein Cascade.
  - **`setStaffRole` gehärtet** mit `assertStaffInOrg` (Defense-in-Depth).
  - **Index-Redesign** (`staff.index.tsx`, UI-only, Vorlage bunker `StaffMatrixView`): Hero-Kopf mit Zählern, Suche, Filter-Tabs (Alle/Service/Küche), **Spalte je Standort** (alle 3 Org-Standorte — behebt „letzte Abteilung verschwindet"), inline farbige Skill-Chips (`skill.color`-Hex, **nicht** `hsl(var(--…))`), optimistische Updates + Fehler-Toasts.
- **payroll = Büro (Entscheidung):** Eine „Büro"-Kraft braucht **keine** Bereiche/Skills und gehört **nicht** in Dienstplan/Zeiterfassung — das ist exakt die bestehende **`payroll`-Rolle**, **kein** 4. Department. Der „Büro-als-Abteilung"-Ansatz wurde verworfen.
  - **Im Index:** `payroll`-MA → Dept-Pills deaktiviert (—), Skills-Zelle „Lohnbüro – keine Bereiche/Skills" (nicht-destruktiv, Daten bleiben).
  - **OR-gehaltene-Skills-Filter:** im Index nur Skill-Chips, deren Kategorie zu einer Abteilung des MA passt **oder** die der MA bereits hält (Hausmeister/`other` nur sichtbar/entfernbar, wenn gehalten).
  - **Roster-Ausschluss (b2):** `getStaffForRoster` (`roster.functions.ts`) filtert payroll-Staff jetzt **per Rolle** aus dem Dienstplan-Grid. **Abgrenzung zur Notiz vom 18.–19.06.** („Sichtbarkeit hängt an `staff_locations`, nicht an der Rolle"): Der **Dienstplan** hat damit jetzt zusätzlich einen **Rollen-Filter**; die **Zeitübersicht/Zeiterfassung bleibt bewusst rollen-ungefiltert** — sonst verschwänden echte historische Stunden einer Person, die später payroll wurde.
- **Wochenplan → Abrechnungsperioden (26.–25.):** Der Wochenplan-Tab in `zeit-uebersicht.tsx` war der **einzige** Tab noch am Kalendermonat. Jetzt hängt er am bereits vorhandenen `selectedPeriodId`/`effectivePeriodId`/`selectedPeriod` (gemeinsam mit Zusammenfassung/Buchhaltung/Perioden) → **ein** Periodenbegriff für den ganzen Zeit-Screen, wie der Dienstplan. Wochen-Chips spannen den 26.–25.-Zyklus (`periodWeeks`); ein Sync-Effekt (`useEffect`, Deps nur `[effectivePeriodId]`) hält `weekStart` immer in der gewählten Periode; „Heute" zieht die Periode mit. `selectedMonth`/`monthOptions`/`monthWeeks` entfernt. **Reine UI, keine Migration.**
- **Aufräum-Refactors (abgenommen, grün):**
  - Toter Code entfernt (`example.functions.ts`, `config.server.ts`).
  - `makeAuditWriter` aus den Einzeldateien nach `src/lib/admin/audit.ts` zentralisiert.
  - `fmtCents`-Duplikat in `trinkgeld-rest.tsx` durch Import aus `@/lib/format` ersetzt (`pdfExport.ts` `fmtEur` bewusst belassen — anderes Format).
  - **Typ-Single-Source `src/lib/staff-domain.ts`** für `StaffDepartment`/`SkillCategory`; die Hubs (`skill-eligibility`, `skills.functions`, `tip-pool`, `import-assignments`) importieren/re-exportieren daraus.
- **Lektion „Reverted to commit X":** Ein Lovable-Revert auf einen älteren Commit nimmt **alle** dazwischenliegenden Commits mit — hier kollateral die Typ-Konsolidierung (`staff-domain.ts`), die danach sauber wiederhergestellt wurde. Bei „Reverted to commit X" im Log künftig immer `git diff X..HEAD --stat` prüfen, was wegfällt.
- **Lektion „Januar-Zeitdaten nicht sichtbar" (kein Bug):** Die Daten sind vollständig in der DB (660 Januar-`time_entries`: YUM 359 + spicery 301, alle mit `ended_at` + korrekter `location_id`; Woche 26.01. hat 70 spicery-Einträge). Die leere Wochenplan-Woche im Screenshot war ein **veralteter Preview-Build**, kein Code-Fehler. Vorgehen bei „Daten fehlen": erst per SQL gegen die DB prüfen, bevor man im Code jagt.
- **Verifizierter Stand:** HEAD `b5b6a40` — `tsc`/`eslint --max-warnings=5`/`prettier`/`vitest` (738) grün.

## 7. Modul M5 — Bestellwesen (bestellung.pro-Migration), Stand 16.06.2026

Quelle der Wahrheit: Legacy `bestellung` (Repo `bestellung-5fff1793`, hat `SYSTEM_BLUEPRINT.md`). In „Wellen" gebaut. Geld = BIGINT cents. Alle Server-Fns Cloudflare-kompatibel (kein Edge-Function, kein SMTP).

| Welle       | Inhalt                                                                                 | Status                                    |
| ----------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Welle 1     | Bestell-Kern (9 Tabellen, atomare RPC `create_order_from_cart`, E-Mail via MailerSend) | ✅ LIVE                                   |
| Welle 2     | Inventur (per-Standort, 2 Lagerorte, Bestandswert)                                     | ✅ LIVE                                   |
| Welle 3-A/B | Wein-Katalog + Quiz (`category='Wein'`, `wine_quiz_scores`)                            | ✅ LIVE                                   |
| Welle 3-C   | KI-Weinrecherche (Firecrawl + Perplexity)                                              | ⏳ offen (optional)                       |
| Welle 4     | EasyOrder (4-A Schema, 4-B Resolver, 4-C UI, 4-D Verwaltung)                           | ✅ Code fertig; Live-Deploy 4-B/C/D offen |
| Welle E1    | Einheitenmodell (Bestell-/Inventureinheit, Faktor, Snapshots, Bar/Trockenlager)        | ✅ LIVE (03.07.2026)                      |
| Stammdaten  | 40 Lieferanten + ~1335 Artikel importiert                                              | ✅ LIVE                                   |

**Historischer Bestell-Import (16.06.2026):** 45 abgeschlossene (`confirmed`) Bestellungen + 367 Positionen aus Legacy `bestellung` nach COCO `orders`/`order_items` importiert (alle Standort YUM, Zeitraum Dez 2025–Mai 2026). Einmaliges Direkt-SQL im Supabase-Editor, NICHT als Migration committet (setzt existierende Lieferanten voraus). Mapping: Lieferanten per Name → COCO-ID (12/12, Legacy-UUIDs nicht erhalten); Standort → YUM; Geld → cents; `order_number` original übernommen. Bewusst NICHT mitgenommen: `pending`-Bestellungen (34); `order_items.article_id` bleibt NULL (Legacy-Artikel-IDs existieren in COCO nicht — `article_name`/`sku`/Preise als Text erhalten); `email_sent`/`confirmed_at`/`delivery_date` (nicht im Export). Verifiziert: 45/367. Optionaler Nachzug offen: Artikel-Verlinkung per Name+Lieferant-Match (separates UPDATE-Skript).

**EasyOrder-Architektur (wichtig):** Staff bestellt vereinfacht über COCOs bestehenden PIN-Login (`validatePin` → echte Supabase-Session via Shadow-User → RLS greift). KEIN Legacy-bcrypt-Edge-Function-Modell (das war die tagesabrechnung-Lücke: PIN ohne Session → keine RLS). An bestehende `staff` gekoppelt (keine `employees`-Tabelle). Tabellen `staff_easyorder_access` + `staff_easyorder_suppliers` (4-A, live, RLS manager+). 4-B `easyorder.functions.ts`: `staffId` IMMER aus `auth.uid` via `loadAdminCaller`, nie vom Client; alle Permission-Checks server-seitig; nutzt die atomare RPC. 4-D `easyorder-admin.functions.ts`: manager-gated, Cross-Org-Validierung (`assertStaffInOrg`/`assertLocationInOrg`/supplier-count).

**Stand 16.06.2026 (Katalog-/Bestell-Umbau, direkt mit Lovable gebaut):**

- **Lieferanten-Seite = alleinige Katalogansicht.** `bestellung.lieferanten.tsx` zeigt Lieferanten als aufklappbare Header mit ihren Artikeln (inkl. „letzte Bestellung"). Separate `bestellung.artikel.tsx` entfernt. Neue Server-Fn `getLastOrderByArticle` (in `orders.functions.ts`): „wer hat bestellt" wird über das `audit_log` aufgelöst (`order.create` → `actor_staff_id`), weil `orders` KEIN `user_id` trägt; ohne Audit-Treffer → „—" (gilt u. a. für die importierten Alt-Bestellungen). Artikel-/Lieferanten-CRUD auf Dialoge umgestellt.
- **Warenkorb-Seite entfernt** (`bestellung.warenkorb.tsx` gelöscht) → ersetzt durch Inline-Cart (`CartDrawer` + `SendOrderDialog`). `/admin/bestellung` leitet jetzt auf `…/lieferanten` (war kurz auf die gelöschte warenkorb-Route → gefixt).
- **Pro-Lieferant-Bestellung:** RPC `create_order_from_cart` um optionalen `p_supplier_id` erweitert — Migration `20260616132808` (DROP+CREATE, SECURITY DEFINER + `search_path`; löscht beim Filter nur die Cart-Items des bestellten Lieferanten). Rückwärtskompatibel (4. Param `DEFAULT NULL`).
- **Auto-Versand pro Mitarbeiter:** neue Spalte `staff.can_easyorder_auto_send` (Migration `20260616140653`, default false). `true` → EasyOrder löst beim Absenden direkt den MailerSend-Versand aus; `false` → Bestellung bleibt `pending`, Admin versendet manuell.
- **MailerSend echt verdrahtet:** `send-order-email.server.ts` schickt an die MailerSend-API, setzt danach `email_sent`/`email_sent_at` + Audit. Secrets: `MAILERSEND_API_KEY` / `MAILERSEND_FROM_EMAIL` / `MAILERSEND_FROM_NAME` (NICHT `FROM_EMAIL`/`FROM_NAME`). Lieferant braucht `suppliers.email`, sonst Fehler.
- **Umbenennungen (Nav):** Tab „Bestellungen" → Lieferanten-Katalog, „Bestellhistorie" → `bestellungen`-Seite.
- **Noch auf Live-DB auszuführen:** Migrationen `20260616132808` + `20260616140653`. Code-Gates grün geprüft (tsc 0, ESLint 0/5, vitest 571).

**Offen M5:** 3-C (optional), Live-Deploy + RLS-CSV-Verifikation von Welle 4 (4-A war live), MailerSend SPF/DKIM in Hostinger-DNS + Secrets `MAILERSEND_API_KEY`/`MAILERSEND_FROM_EMAIL`/`MAILERSEND_FROM_NAME` (Frank-Seite) für echten Mailversand. Niedrige Prio: Lieferanten-Namensvarianten in UI prüfen.

**BFIX1 (06.07.2026):** `sendOrderEmail` (Warenkorb-„Senden"-Knopf) auf zentralen Versand `sendOrderEmailWithAdmin` umgestellt — die Welle-1-Eigenimplementierung hatte den (später gebauten) Testmodus umgangen und im Live-Fall eine echte Bestellung an den Lieferanten geschickt. Jetzt EIN Versandpfad für Warenkorb-Flow UND EasyOrder (Testmodus-Umschaltung, harter Fehler ohne Test-Adresse, Test-Kontext in Betreff/Body, Status-Update, Resend-Erkennung). Auth (loadAdminCaller manager) + runGuarded + Audit bleiben im Handler. Grep-Gate: genau 1 Treffer für `api.mailersend.com` im Code (`send-order-email.server.ts`).

**TB1 (06.07.2026):** Testmodus-Banner im Bestellung-Layout (`admin/bestellung.tsx`) + EasyOrder-Seite (`easyorder.tsx`) — gemeinsame Komponente `components/bestellung/TestModeBanner.tsx`. Status via neue Fn `getOrderTestModeStatus` (`lib/bestellung/test-mode-status.functions.ts`): authenticated (KEIN Admin-Gate — auch EasyOrder-Staff sieht den Banner), liefert nur `{ enabled: boolean }`; die Test-E-Mail-Adresse bleibt admin-only in den Einstellungen. Read-only, kein Audit.

**SL1 (06.07.2026) — Standort-Lieferanten:** Kundennummern und Aktiv-Status je (Lieferant, Standort). Neue Tabelle `supplier_locations` (deny-all wie `article_locations`, 0 Client-Policies, Migration `20260706053659`) mit Kern-Semantik: fehlende Zeile = Lieferant am Standort aktiv, keine eigene Kundennummer (Fallback auf `suppliers.customer_number`) — kein Backfill, kein Drift bei neuen Lieferanten/Standorten. Reiner Helper `resolveCustomerNumber` (`src/lib/bestellung/customer-number.ts`, getestet); der zentrale E-Mail-Versand (`send-order-email.server.ts`) löst die Kundennummer per `(order.supplier_id, order.location_id)` auf — `is_active` ist dort bewusst KEIN Guard (bereits angelegte Bestellungen bleiben versendbar; der Guard greift beim Anlegen). Server-Functions `listSupplierLocations`/`setSupplierLocation` (manager+, Cross-Org-Guards, atomares Upsert, Audit `supplier_location.set`). Lieferanten-Dialog mit Standort-Sektion (Kundennummer + Aktiv-Switch je Standort). Admin-Katalog (`bestellung.lieferanten.tsx`) mit Standort-Pill oberhalb der Suche — Pill und `carts.location_id` sind über `setCartMeta` EIN Zustand, keine „Alle"-Option; Artikel-Filter über `article_locations`, Lieferanten-Filter über `supplier_locations` (fehlende Zeile = sichtbar). RPC `create_order_from_cart` (4-Param) um zwei Guards erweitert (Migration `20260706054351`, REVOKE/GRANT wie Sicherheits-Fix #1): P0006 = Artikel am Cart-Standort nicht freigegeben (Freitext ausgenommen), P0007 = Lieferant am Standort deaktiviert. EasyOrder-Katalog filtert standort-deaktivierte Lieferanten zusätzlich zur Whitelist. Abgenommen: HEAD `68a67bda`, vier Gates grün (1448 Tests), Live-DB verifiziert (Tabelle + RLS aktiv + 0 Client-Policies; RPC-Grants nur `service_role`; nur 4-Param-Signatur, `SECURITY DEFINER`).

**SL2 (06.07.2026) — Stammdaten-Abgleich `bestellung.pro` → COCO:** Abgleich der Artikel-/Lieferanten-Stammdaten mit dem Legacy per CSV-Diff + idempotenten SQL-Paketen (Frank im Supabase-Editor, Rest-Check jeweils in derselben Ausführung) — bewusst KEIN Neuimport: `order_items` referenziert Artikel mit `ON DELETE RESTRICT`, und das Legacy ist selbst massiv intern dupliziert (Hamberger-Katalog bis 6× übereinander; 323 Namen mehrfach). Kern-Erkenntnis: Legacy lief mit ZWEI Organisationen — „YUM Gastronomie GmbH" (Standorte Spicery + YUM) und „the spice bazaar" (= TSB); der Import vom 16.06. hatte beide per Artikelname dedupliziert zusammengelegt (100 % Namensabdeckung, aber Cross-Org-Lieferanten-Dubletten und Einheiten-Verluste). Pakete (alle live verifiziert):

**A Lieferanten-Merges:** Grätz→Josef Grätz, Früchte Feldbrach→Feldbrach, Pachmayr AFG→Pachmayr (Pachmayr Bier bleibt eigenständig); leeres „Hofbräu München" gelöscht; exakte Tartufi-Artikel-Dublette gemerged. Bewusst NICHT gemerged: Klocke / Friedrich Klocke GmbH, Dr. Bürklin Wolf / Weingut Dr. Bürklin Wolf. Merge-Muster: `articles`/`orders`/`cart(_draft)_items`/`supplier_locations`/`staff_easyorder_suppliers` konfliktfrei umhängen, dann Dublette löschen.

**B Einheiten:** 399 Artikel aus Legacy korrigiert (u. a. Wein „0,75l" statt „Stk"); `unit`+`order_unit`+`inventory_unit` synchron, nur bei unangetasteter E1-Default-Konfiguration (Guard). Numerische Legacy-„Einheiten" (1, 6, 12 = Gebindegrößen im falschen Feld) bewusst NICHT übernommen; Stk/Stück-Kosmetik auf COCO-„Stk" belassen.

**C Beschreibungen:** 113 Artikel, Thai bevorzugt (Legacy hatte separate `description_th`-Spalte; COCO hat EIN `description`-Feld).

**D Preise:** 23 Artikel auf Legacy-Stand.

**F Artikel-Standort-Zuordnung:** `article_locations` = echte Legacy-Allowlist statt Pauschal-Backfill (Legacy-Semantik: Artikel nur mit aktiver Zeile am Standort sichtbar — gegen Legacy-UI verifiziert). Live: Spicery 428 · YUM 430 · TSB 980 Zuordnungen, 0 aktive Artikel ohne Standort. 122 im Legacy nirgends zugeordnete Artikel mit Fallback nach Org-Herkunft (Review-CSV bei Frank).

**G Kundennummern je Standort:** 45 `supplier_locations`-Upserts aus Legacy (Namen auf gemergte COCO-Lieferanten abgebildet; Kundennummern verbatim als Text, führende Nullen erhalten; Beispiel Josef Grätz: Spicery/YUM 38966, TSB 38968). 3 Spicery-Deaktivierungen (Alveus, Garibaldi, Kagerer). Luigi-„Kundennummer" war Platzhalter „yum" → übersprungen, echte Nummer manuell nachtragen.

**H Kontaktdaten:** 22 Füllungen NUR leerer COCO-Felder (`email`/`phone`/org-weite `customer_number`); bestehende Werte nie überschrieben. Einziger Lieferant ohne E-Mail: „Nicht zugeordnet" (gewollt — Platzhalter, Versand verweigert sauber).

**E Artikel-Dubletten (06.07.2026, abgeschlossen):** 105 Kandidaten-Paare von Frank per CSV markiert (Größen-/Qualitäts-Varianten bewusst NICHT gemerged: Roederer 0,375l/0,75l, Plose, Coca-Cola-Gebinde, Havana 3/7 años, Top-Service-Gebinde). Dazu 36 exakte Namens-Dubletten, die erst durch die A-Lieferanten-Merges entstanden waren (Feldbrach/Früchte-Feldbrach-Überschneidung u. a.), automatisch ergänzt. Per Verkettung 93 Merge-Gruppen, 113 Artikel aufgelöst → 1200 Artikel (live verifiziert). Überlebender je Gruppe zur Laufzeit gewählt (meiste Bestellhistorie → vorhandene Beschreibung → kleinste ID); leere Felder aus Dubletten aufgefüllt; Inventur-Kollisionen (UNIQUE session_id+article_id) durch Mengen-Summierung gelöst; Umhängen von order_items/cart(\_draft)\_items/inventory_items/sales_articles.ek_source_article_id/article_locations (Union). Rückfragen geklärt: Farnetani Barolo/Grappa bewusst getrennt gelassen (zwei Produkte); das BGL-H-Milch-Paar war transitiv bereits in E enthalten (beide über das Milch-Paar verkettet). SL2 damit vollständig abgeschlossen — das CSV-Diff-→-idempotente-Pakete-Muster steht für künftige Legacy-Abgleiche bereit.

**BFIX2 (06.07.2026) — PostgREST-1000-Zeilen-Kappung:** PostgREST kappt Ergebnismengen per Default bei 1000 Zeilen — `listArticles` lud Artikel (1199) und `article_locations` (~1700) unpaginiert, wodurch der Admin-Katalog nach den SL1-Standortfiltern ganze Lieferanten fälschlich leer zeigte (Kappungsgrenze lag alphabetisch mitten im „K": KAO sichtbar, Klocke leer). Die DB-Daten waren korrekt; reiner Lade-Bug, der latent seit dem 1335-Artikel-Import bestand und erst durch die Standortfilter sichtbar wurde. Fix: zentraler Helper `selectAllPaged` (`src/lib/supabase/select-all.ts`, getestet, Hard-Cap gegen Endlosschleifen) + Umstellung aller >1000-Zeilen-Kandidaten (`listArticles`, `listArticleCategories`, EasyOrder-Katalog, Inventur, EK-Werkbank, Verkaufsartikel) mit stabilem `id`-Tiebreaker im `ORDER BY`. Abgenommen HEAD `12c35416`, vier Gates grün (1454 Tests).

## 8. CI-Befund (15.06.2026): db-integration Schema-Cache-Blocker

Bekanntes Supabase/PostgREST-Problem (Issues #42183, #39446): nach Migrationen kennt der PostgREST-Schema-Cache neue Tabellen/Spalten nicht (PGRST204 `guest_count` / PGRST205 `wine_quiz_scores`). 4 DB-Tests scheitern dauerhaft daran (im Test-SETUP beim `suppliers`-Insert, NICHT in der Logik). 75/79 DB-Tests grün. 4 CI-Fix-Versuche (Container-Restart, Probe-Logik, `db reset`, `pgrst_watch`-Event-Trigger) lösten es im CI nicht. Entscheidung: `db-integration` via `continue-on-error` NON-BLOCKING — läuft + reportet, blockiert aber nicht den grünen Gesamtstatus. `check`-Job (tsc+eslint+vitest) bleibt blockierend. Revisiten wenn Supabase-CLI den Cache-Reload nach `db reset` fixt → `continue-on-error` entfernen. Konsequenz: EasyOrder 4-B/4-D Sicherheits-DB-Tests statisch wasserdicht, aber nicht real in CI bewiesen (scheitern im Setup, nicht an der Logik). Der `pgrst_watch`-Trigger bleibt drin (hilft in Produktion).

**Hinweis CI:** Die 5 tolerierten `react-hooks/exhaustive-deps`-Warnings sind aufgeräumt — `eslint .` ist wieder bei **0 Warnings**. Am 18.06. wurde ein **Format-Job** in der CI ergänzt (prüft Prettier). **Wiederkehrendes Muster:** Lovable überspringt gern `npx prettier --write` → CI wird **nur** an Prettier rot (tsc/vitest grün). Standing Fix: `prettier --write` vor jedem Commit (steht in §3). Optionaler Folgeschritt: husky Pre-Commit-Hook, der `prettier --write` lokal automatisch laufen lässt.

**Lektion (30.06.2026):** Die CI fährt `prettier --check .` über das **ganze Repo** (inkl. `docs/`), nicht nur `src/`. Lokale Prüfung daher ebenfalls mit `prettier --check .` — ein Check nur über `src/**/*.{ts,tsx}` übersieht Doku-Format-Drift, der die CI rot hält (so geschehen: ~9 rote Runs allein wegen unformatierter `arbeitsweise.md`, während `src/` grün war).

## 9. Sicherheits-Härtung #1–#3 (24.06.2026)

Sicherheits-Durchgang nach einem externen Review (ChatGPT, gegen einen Repo-Snapshot), von Claude gegen den echten Code kalibriert. Drei echte Lücken geschlossen, alle Atomaritäts-/Cross-System-Pfade abgesichert. Gates durchgehend grün (tsc, eslint 0/5, prettier, 738 Tests).

**Geteilter Guard:** neue Datei `src/lib/admin/org-guards.ts` mit `assertStaffInOrg(staffId, organizationId)` (lazy `supabaseAdmin`, wirft „Mitarbeiter nicht in dieser Organisation."). Aus `staff.functions.ts` extrahiert, wird von mehreren Pfaden genutzt.

| Fix | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Migration        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| #1  | `create_order_from_cart` (4-arg-Overload) war `SECURITY DEFINER` + `GRANT … authenticated` → direkt aufrufbar (IDOR + Audit-Bypass). `REVOKE` von PUBLIC/anon/authenticated, `GRANT` nur `service_role` (die 3-arg-Variante wurde bereits am 16.06. durch Migration `20260616132808` gedroppt; seitdem existiert NUR die 4-Parameter-Signatur mit `p_supplier_id DEFAULT NULL`. Live verifiziert am 06.07.: genau eine Signatur, `prosecdef = true`, EXECUTE nur `postgres` + `service_role`). App ruft über `supabaseAdmin` → keine Breakage. | `20260622063557` |
| #2a | PIN: `setPin` von Delete+Insert auf **atomares Upsert** (`onConflict: "staff_id"`, `staff_pins.staff_id` ist `NOT NULL UNIQUE`) + `assertStaffInOrg` davor; `clearPin` Guard ergänzt.                                                                                                                                                                                                                                                                                                                                                          | — (nur TS)       |
| #2b | `replace_staff_skills` / `replace_staff_role` / `replace_staff_locations` — Delete+Insert je in **einer** Transaktion, org-gefilterte Inserts. Schließt latente Cross-Org-Lücke in Skills/Standorten (hatten keinen Guard).                                                                                                                                                                                                                                                                                                                    | `20260624194327` |
| #2c | `save_cart_as_draft` / `load_draft_into_cart` — Draft↔Cart-Kopieren komplett in DB-Transaktion, hart auf `(organization_id, user_id)` gescoped (schließt #5 Cart-Besitz für diese Pfade).                                                                                                                                                                                                                                                                                                                                                      | `20260624195337` |
| #2d | `link_account_to_staff` — DB-Teil der Konto-Erstellung (user_links-Insert + staff-Update) atomar. `createStaffAccount` kompensiert bei RPC-Fehler den zuvor erstellten Auth-User (`auth.admin.deleteUser`, best-effort) → **kein verwaister Auth-User**. `resetStaffPassword` bewusst unverändert (harmloser Failure-Mode; Kompensation wäre schlechter als Ist).                                                                                                                                                                              | `20260624200904` |
| #3  | `setPermissionOverride` / `clearPermissionOverride` org-scharf: Aufrufer-Org via `current_organization_id()` → `assertStaffInOrg` vor dem Schreiben. `getStaffPermissions` war bereits org-scharf (Fehlalarm).                                                                                                                                                                                                                                                                                                                                 | — (nur TS)       |

**RPC-Muster (verbindlich für solche Fixes):** `SECURITY DEFINER` + `SET search_path = public` + staff-in-org-Guard + org-gescopter Delete + org-gefilterter Insert + `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`. Danach **Supabase-Types regenerieren**, sonst ist der `rpc("…")`-Aufruf nicht typsicher (tsc rot).

**Prinzip (teuer gelernt, gilt weiter):** Unter `service_role` ist `auth.uid()` **NULL** — keine `auth.uid()`-Checks in service_role-aufgerufenen SECURITY-DEFINER-Funktionen. `staffId`/Org kommen immer aus dem Aufruferkontext (`loadAdminCaller`), nie vom Client.

**Kalibrierung (als Fehlalarm verworfen, dokumentiert):**

- `hasPin` über `staff_pins`-Embed ist korrekt (To-One → Objekt/null, kein Array-Bug).
- Ein `UNIQUE(staff_id, shift_date)` auf `roster_shifts` wäre eine **Design-Regression** — Cross-Booking über Bereiche/Standorte ist **absichtlich** nur ein advisory roter Punkt, kein harter Block.
- `.env` **ist am 07.07.2026 aus dem Git-Tracking entfernt** (ENV1): Werte waren ausschließlich publishable/anon + domain-beschränkter Maps-Key, deshalb kein History-Rewrite. Lokal aus `.env.example` neu befüllen (Werte aus dem Supabase-Projekt bzw. `supabase status`). CI-Guard im `check`-Job blockt Wieder-Committen und generisches `*_KEY = "…"` in getrackten Dateien.

**Offen — Härtungs-Backlog (Defense-in-Depth, keine offene Lücke):** Display-Token `Referrer-Policy: no-referrer` + Rotation; `search_path`-Härtung breiter ausrollen; Composite-FKs `(organization_id, location_id)`; Check-Constraints (qty>0, cents≥0 — nuanciert, manche Beträge legitim negativ); db-security-Tests blockierend machen (aus dem flaky `db-integration`-Job herauslösen); Bun-Version pinnen.

## 10. Zeit-Re-Import März–Juni 2026 + location_id-Reparatur (26.06.2026)

Arbeitszeiten der Perioden **März–Juni 2026** wurden aus der Legacy-`tagesabrechnung` (`zt_shifts`) neu nach COCO `time_entries` importiert (über `/admin/migration`), weil die Quelldaten korrigiert wurden. Der Import **ersetzt** bestehende Import-Zeilen periodenweise. Danach war eine **location_id-Reparatur** nötig (siehe Lektion unten).

### Ergebnis (alle Perioden verifiziert: Zeilen = distinct import_keys, Stunden = Quelle ± Rundung)

| Periode | Zeitraum      | Zeilen | Std (COCO) | Std (Quelle) |
| ------- | ------------- | ------ | ---------- | ------------ |
| März    | 26.02.–25.03. | 649    | 5261,73    | 5261,79      |
| April   | 26.03.–25.04. | 699    | 5675,67    | 5675,67      |
| Mai     | 26.04.–25.05. | 676    | 5464,57    | 5464,55      |
| Juni    | 26.05.–25.06. | 670    | 5369,38    | 5369,40      |

Wasserlinie (`organization_settings.time_locked_through_date`) steht auf 25.06. Übersprungene Quell-Zeilen pro Periode sind legitime Leer-Platzhalter (0 h, keine Zeiten) + Abwesenheiten (Urlaub/Krank).

### Verbindliche Prozedur pro Periode

1. **Export + Sanity** (tagesabrechnung-DB): **16**-Spalten-SELECT aus `zt_shifts` JOIN `staff` ON `staff.id = zt_shifts.employee_id`; `ohne_staff_match` muss **0** sein. Die 16. Spalte `restaurant` wird **pro Schicht** über die Kette `zt_shifts.week_id → weeks.period_id → scheduling_periods.restaurant_id → restaurants.name` abgeleitet (für die 8 Mehrhaus-Fälle ist das das einzige verlässliche Per-Schicht-Signal — **nicht** der Heimatstandort des MA).
2. **Dry-Run** auf `/admin/migration`.
   2a. **Standort-Gate im Dry-Run**: Der Zähler **„ohne Standort"** (`importedWithoutLocation`) muss **0** sein. Ist er > 0, fehlt/ist falsch die Export-Spalte `restaurant` (oder ein Name matcht keine COCO-`locations`-Zeile) → **nicht committen**, Export korrigieren.
3. **Gescopter DELETE** der alten Import-Zeilen in COCO (`source='import'` + `business_date`-Range) — **niemals** `clock`/`manual` anfassen — **mit Rest-Check im SELBEN Editor-Lauf**.
4. **Commit erst wenn Rest = 0.**
5. **Endcheck**: `count = distinct import_keys = erwartete Zeilenzahl`.
6. **Stunden-Abgleich** gegen die Quelle.

### Lektionen (teuer gelernt)

- **„Success. No rows returned" sagt NICHTS über betroffene Zeilen.** DELETE + Rest-Check immer in **einem** Editor-Lauf ausführen; **nie committen, solange Rest ≠ 0** (einmal beinahe doppelt importiert, weil ein DELETE in einem anderen Tab/Connection lief).
- **Der Importer setzt KEIN `location_id`.** Re-importierte Zeilen hatten `location_id = NULL` und waren dadurch im Wochenplan **unsichtbar** — `getWeeklyTimeEntries` (in `src/lib/time/time-admin.functions.ts`) filtert strikt `.eq("location_id", …)`, und „Alle" lädt pro Standort und merged. NULL-Location-Zeilen erscheinen nirgends.
- **location_id-Backfill-Mechanik** (einmalig, manuell per SQL — nicht im Importer):
  - **34 Single-Location-Mitarbeiter**: neue NULL-Zeilen bekamen den (einzigen) Standort ihrer bestehenden Zeilen kopiert (`HAVING count(DISTINCT location_id) = 1`). UUID-Aggregat über `(min(location_id::text))::uuid` — `max(uuid)` existiert nicht.
  - **8 Mehrhaus-Fälle** (DEAU, Elson, EM, MO, SUMITR, GUNG, NET + BIG): Standort **pro Schicht** aus der Quell-Kette abgeleitet — `zt_shifts.week_id` → `weeks.period_id` → `scheduling_periods.restaurant_id` → `restaurants.name`. Die **Abteilung disambiguiert NICHT** (alle arbeiten dieselbe Abteilung an beiden Häusern); die scheduling_period ist das einzige verlässliche Per-Schicht-Signal. Mapping auf COCO über `import_key = 'tagesabrechnung:' || zt_shifts.id`, dann gezieltes UPDATE (nur `source='import' AND location_id IS NULL`).
  - Endstand: **0** Import-Zeilen ohne `location_id`.

### Offen

- **Importer setzt `location_id` jetzt beim Import** (erledigt): optionale CSV-Spalte `restaurant` → `resolveLocationId()` (rein, case-insensitiv, getrimmt; `null` bei Miss) gegen die `locations`-Namens-Map der Org. Neuer Zähler `importedWithoutLocation` macht NULL-Location-Zeilen im Dry-Run/Commit sichtbar (Badge „X ohne Standort" im Migrations-UI). **Voraussetzung:** der Export liefert die 16. Spalte `restaurant` pro Schicht (s. Prozedur). Der frühere manuelle location_id-Backfill ist nur noch **Fallback**, falls versehentlich ein alter 15-Spalten-Export ohne `restaurant` benutzt wurde (dann zeigt der Dry-Run `importedWithoutLocation > 0`).

### Vollständigkeits-Abschluss (04.07.2026)

**Jan+Feb 2026 waren bereits importiert** (früherer, hier zuvor nicht
dokumentierter Lauf) — heute zeilengenau verifiziert: COCO source='import'
umfasst 26.12.2025–25.06.2026 mit 4019 Zeilen = Quelle aller sechs Perioden
(4085) minus 66 legitime Leer-/Abwesenheits-Zeilen (Jan 1, Feb 65).
Stunden-Abgleich: 2026-01 = 648 Zeilen/5345,00 h, 2026-02 = 677/5450,50 h —
exakt Quelle. Die Legacy-Historie beginnt am 26.12.2025; davor existiert
nichts.

**Lücken-Schluss 26.–29.06.2026:** Zwischen Import-Ende (25.06.) und
Pool-Writeback-Start (30.06., §51) fehlten vier Tage. Per §10-Prozedur
geschlossen (Export 16 Spalten, /admin/migration, Run-ID 40865e29-…):
gelesen 76 / importiert 75 / übersprungen 1 (invalid_time = Abwesenheit
28.06. ohne Zeiten). Verifiziert pro Tag: 20/156,77 · 19/156,68 · 17/133,83
· 19/153,25 = 75 Einträge / 600,53 h (Quelle 600,49 — Rundungsrauschen).
Der Importer zog die Zeit-Wasserlinie automatisch auf den 29.06. nach.

**Neue harte Regel:** Die Import-Obergrenze ist der Pool-Writeback-Start
(30.06.2026). Ab diesem Datum erfasst COCO selbst (clock/pool/manual) —
ein zt_shifts-Import darüber hinaus wäre Doppelzählung im Lohn und ist
VERBOTEN. Die Legacy-Zeiterfassung ist damit Archiv; die COCO-Zeit-Historie
ist lückenlos vom 26.12.2025 bis heute.

## 11. Modul M4 — edlohn-Cent-Abgleich Juni 2026 (26.06.2026)

COCO-Lohnrechner cent-genau gegen die offizielle edlohn-Abrechnung Juni 2026 (Mandant 09290/205, 39 MA) abgeglichen. Methode: CSV-Export `/admin/lohnrechner` (simple) ↔ edlohn-Referenz, Diff je Spalte. Standard-Kohorte deckungsgleich (Rest <0,3 % Rundungsrauschen — COCO rundet SFN/Stunden minimal niedrig, immateriell). Sonderfälle als „Hebel" abgearbeitet.

### Datenfixes (reine Stammdaten, Produktion)

- `kk_zusatzbeitrag` für 33 GKV-MA gesetzt → KV cent-genau.
- `lohn_absence_days` (Urlaub/Krank-Tage) für 10 MA.
- `soll_hours_per_day` korrigiert (Perso 23, 117, 334).
- `tax_class`: 11→VI, 352→IV, 358→V.
- `children_count`/`has_parent_status` (Treiber-C, PV-Sätze) für Eltern inkl. 331 (1 Kind).
- `date_of_birth`-Fix (25, 27).
- `is_minijob = true` (12, 20).
- Perso 27 (NET = Narunet Dannerbeck): war `perso_nr = null` („Steuerklasse fehlt") → repariert (perso_nr, tax_class IV, kk_zusatzbeitrag).

### Code-Hebel (Lovable, CI-grün, deployt)

| Hebel               | MA                | Status | Mechanik                                                                                                                                         |
| ------------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| StKl 6              | 11                | ✅     | reine Daten (`tax_class` I→VI)                                                                                                                   |
| Pauschal-Minijob    | 12, 20            | ✅     | `zeitlohnKategorie()` → erste Zeile `aushilfe_paust`; RV = 3,6 % Aufstockung; KV/AV/PV/LSt = 0                                                   |
| Aktivrente          | 100, 331          | ✅     | neue Spalten `rv_frei`/`av_frei`/`lst_freibetrag_monat_cent`; RV/AV-Befreiung in `svBeitraege`; Freibetrag via `freibetragCent` → PAP `LZZFREIB` |
| Midijob/Werkstudent | 17,23,117,334,358 | ✅     | Übergangsbereich `midijobBemessungCent` (UG=603/OG=2000) + Werkstudent (`kv_frei`/`av_frei`/`pv_frei`); s. §12                                   |
| Privat-KV/GF        | 1, 109, 309       | 🔄     | SV (Ph.1) + Brutto/St-SV-Split (Ph.3) ✅; LSt-Vorsorgepauschale (Ph.2) offen; s. §12                                                             |
| Doppelsatz          | 320, 352          | ⏸️     | zurückgestellt — COCO kennt keine Rate-1/Rate-2-Attribution; Lösung später per `lohn_second_rate_hours`-Tabelle                                  |

Aktivrente-Detail: DEAU (100) voll RV+AV-frei + Freibetrag 2000 €/Monat; NOK (331) nur AV-frei + Freibetrag, RV bleibt. `is_sv_exempt` (Alt-Spalte) bleibt unverdrahtet — zu grob (RV ≠ AV). Mini-Rest DEAU: KV +7,29 = ermäßigter Satz 14,0 % (Rentnerin ohne Krankengeld) → späterer Bool `kv_ermaessigt`.

### Lektionen (teuer gelernt)

- **Neue Spalte ⇒ Select-Liste** (s. Abschnitt 3). Ursache der Aktivrente-Phantomsuche.
- **Green CI ≠ live.** Produktion braucht ggf. expliziten Publish/Redeploy in Lovable; neuer Commit triggert frischen Cloudflare-Build (~5–8 Min, nicht zu früh exportieren).
- **Export nur aus eigenständigem `…lovable.app`-Tab** — der eingebettete Preview-iframe blockiert CSV-Downloads (Sandbox).

## 12. Modul M4 — Hebel-Fortschritt, Forts. (26.06.2026)

Setzt §11 fort. Der Hebel-Status **hier** ist maßgeblich.

### Aktueller Hebel-Status

| Hebel                                    | MA                        | Status                                              |
| ---------------------------------------- | ------------------------- | --------------------------------------------------- |
| StKl 6                                   | 11                        | ✅                                                  |
| Pauschal-Minijob                         | 12, 20                    | ✅                                                  |
| Aktivrente                               | 100, 331                  | ✅                                                  |
| Midijob/Übergangsbereich                 | 358; RV-Teil 17           | ✅                                                  |
| Werkstudent-SV                           | 17                        | ✅                                                  |
| Privat-KV/GF — SV (Phase 1)              | 1, 109, 309               | ✅                                                  |
| St/SV-Brutto-Split + Lohnarten (Phase 3) | 1, 109                    | ✅                                                  |
| SUMITR komplett cent-genau               | 109                       | ✅                                                  |
| Vorsorgepauschale (Phase 2)              | 1, 309, 17                | ⏸️ blockiert — braucht KV/PV-Beiträge + AG-Zuschuss |
| Brutto-Overshoot (3M-Ø Zuschlag)         | 6, 23, 117, 129, 334, 504 | offen, eigenes Thema                                |
| Doppelsatz                               | 320, 352                  | zurückgestellt                                      |
| KV ermäßigt (DEAU)                       | 100                       | Mini-Rest +7,29                                     |

### Neue Mechaniken

**Midijob / Übergangsbereich** (358; RV-Teil von PIM 17): AN-beitragspflichtige Einnahme = `OG/(OG−UG) × (AE−UG)`, UG=603 (Minijob-Grenze 2026), OG=2000, nur wenn `is_midijob` UND UG<AE≤OG. Konstante `UEBERGANGSBEREICH_2026` (config-2026), Helper `midijobBemessungCent` + Schalter in `svBeitraege`. MA mit AE>2000 (23/117/334) bekommen keine Reduktion → ihr Rest ist Brutto-Overshoot, kein SV-Thema. Faktor F nicht nötig (nur AG-Seite).

**Werkstudent** (PIM 17, BGR 0-1-0-0): KV/AV/PV-AN = 0 über `kv_frei`/`av_frei`/`pv_frei`, RV bleibt (auf Übergangsbereich-Basis). Die vier Branchen-Befreiungs-Flags `rv_frei`/`av_frei`/`kv_frei`/`pv_frei` decken Aktivrente, Werkstudent UND Privat-KV-SV ab — ein gemeinsames Muster. `is_sv_exempt` bleibt unverdrahtet (zu grob).

**Privat-KV/GF SV (Phase 1):** GF (1 CHEFIN, 309 Peter) BGR 0-0-0-0 → alle vier `*_frei`=true (SV komplett 0). SUMITR (109) BGR 9-1-1-1, freiwillig GKV → nur `kv_frei`/`pv_frei` (RV/AV bleiben). Reine Daten, größter €-Posten je Kopf (~1.300–1.460 €).

**St/SV-Brutto-Split + Lohnarten (Phase 3):** `lohn-core` trennt `stBruttoCent` (LSt-Basis) von `svBruttoCent` (SV-Basis). Vier neue Kategorien: `bav_frei` (st+sv-frei), `bav_sv` (st-FREI/sv-PFLICHTIG — der Grund für den Split), `sachbezug_pflichtig` (st+sv-pflichtig, Auszahlung −), `entgeltumwandlung` (negativ, mindert beide Brutto). Wiederkehrende MA-Lohnarten in neuer Tabelle `lohn_recurring_zeilen` (staff_id, organization_id, bezeichnung, betrag_cent, kategorie, sort_order), geladen in `computeLohnForStaff`. Bildet Direktversicherung (stsv-frei / stfr-svpfl) + Dienstrad (1 % gwV + Entgeltverzicht) ab. SUMITR damit komplett cent-genau.

### Offen — Phase 2 (LSt-Vorsorgepauschale), blockiert

CHEFIN (1), Peter (309), PIM (17): COCO gewährt die GKV-Vorsorgepauschale, obwohl GF ohne GRV bzw. privat bzw. Werkstudent → LSt zu niedrig (CHEFIN −560, Peter −482). PAP-Pfad steht: `KRV=1` nullt den RV-Teilbetrag (`pap2026` Z. ~962), `PKV>0` bildet den KV/PV-Teilbetrag aus `PKPV−PKPVAGZ` mit Günstigerprüfung gg. Mindestvorsorge. **Der Wrapper `lohnsteuer-2026.ts` verdrahtet aktuell `KRV:0`/`PKV:0` hart** — das ist die Lücke. Cent-genaue Reproduktion braucht je MA die **monatlichen KV/PV-Beiträge + AG-Zuschuss** (lokale PAP-Probe ohne diese: ±15–250 € daneben). PIM = Mindestvorsorgepauschale (kein PKV-Beitrag). Wartet auf die Beitragszahlen aus den edlohn-Stammdaten.

### Lektionen

- **St-Brutto ≠ SV-Brutto** sobald bAV-Entgeltumwandlung im Spiel ist (steuerfrei, aber oberhalb 4 % BBG sv-pflichtig). Das gemeinsame `stSvBrutto` der Stufe 1 trug nur, weil die Referenzfälle es nie auseinandertrieben.
- **Vorsorgepauschale ≠ tatsächliche SV.** Auch wer KV-frei ist (Werkstudent, GF, freiwillig GKV Firmenzahler), braucht für die LSt den korrekten `kk_zusatzbeitrag` bzw. PKV-Beitrag — die Pauschale rechnet unabhängig vom tatsächlichen Beitragsabzug. SUMITRs LSt-Rest war allein ihr fehlender `kk_zusatzbeitrag`.

## 13. Modul M4 — Brutto-Overshoot (3M-Ø-Zuschlag): Methoden-Rest (26.06.2026)

Betrifft die saubere 3M-Ø-Gruppe **23 Andre (+81,36)**, **117 APPEL (+69,32)**, **334 PON (+16,07)** — Δ jeweils **rein im Zuschlag „Urlaubsentgelt/Krank (3M-Ø)"**, Urlaubsstunden/Zeitlohn cent-genau gegen edlohn. edlohn baut die Zeile identisch (`Tage × Tagessatz`), nur der **Tagessatz** weicht ab.

### Befund

COCO: `avgSfnTagCent = round(refSFN(91 Tage) / scheduledDays)`, `scheduledDays = distinct Arbeitstage + Urlaub/Krank-Tage` im Fenster `[fromDate−91 .. fromDate−1]` (`urlaub-krank-diagnose.ts`). Diagnose-SQL (2026-02-24..2026-05-25) ergab `scheduled_days` = 64 / 56 / 57. Zurückgerechnet:

| MA  | COCO Tagessatz | scheduled_days | COCO refSFN ≈ | edlohn Tagessatz | edlohn Divisor |
| --- | -------------- | -------------- | ------------- | ---------------- | -------------- |
| 23  | 36,50          | 64             | 2336 €        | 27,46            | 85             |
| 117 | 22,48          | 56             | 1259 €        | 19,18            | 66             |
| 334 | 20,05          | 57             | 1143 €        | 18,04            | 63             |

**Divisoren 63 / 66 / 85 — keine ableitbare Regel** (kein „×65", kein Soll-Tage-Muster); Andre (16 Referenz-Urlaubstage) sprengt jedes Schema. Andersrum gelesen (gleicher Nenner): COCOs **SFN-Summe** wäre um 11 % / 17 % / 33 % zu hoch. Aus den vorliegenden Daten **nicht entscheidbar**, ob die Differenz im Zähler (SFN-Arten / Referenzfenster) oder Nenner (gezählte Tage) sitzt.

### Entscheidung

**Methoden-Rest, kein Hebel.** Cent-genaue Reproduktion bräuchte edlohns **Durchschnitts-Berechnungsbeleg SFN** (Referenz-SFN-Summe + Tagezahl je MA) — steht **nicht** auf der Juni-Abrechnung (0 Treffer). Fester Nenner (z. B. 65) als „Pfusch-Fix" würde APPEL/PON näherbringen, Andre verschlechtern → verworfen. Abgehakt, bis (falls) der edlohn-Durchschnittsbeleg vorliegt; dann saubere Nenner-/Zähler-Korrektur in `urlaub-krank-diagnose.ts`.

### Abgrenzung (kein Teil dieses Rests)

- **6 ANDI (+120) / 129 GERARD (−220):** echte Stundenzahl-Differenz → Zeitdaten-Abgleich, kein Rechen-Hebel.
- **504 TIP:** Austritt/Teilmonat (Steuer-Tage) → eigenes Feature.
- **320 / 352:** Doppelsatz (rate-1/rate-2), zurückgestellt (COCO hat keine Satz-Attribution; künftige `lohn_second_rate_hours`).

## 14. Modul M4 — GF/PKV-Vorsorgepauschale: Phase-2-Blocker gelöst (27.06.2026)

Voll sozialversicherungsfreie, privat krankenversicherte Geschäftsführer (CHEFIN/perso 1, Peter/perso 309) wichen in der **Lohnsteuer** ab (Brutto/SV identisch). Ursache war **nicht** ein fehlender KV/PV-Beitrag (so war Phase 2 bisher blockiert), sondern drei **fälschlich gewährte Vorsorgepauschale-Teilbeträge**.

### Bug im PAP-Wrapper

`lohnsteuer-2026.ts` verdrahtete `KRV=0` und `ALV=0` hart und speiste `PKV` nie. Für einen SV-freien GF erzeugt das:

- **RV-Teilbetrag** (KRV=0 statt 1) — er zahlt keine GRV.
- **GKV-KV/PV-Teilbetrag** (PKV ungesetzt → GKV-Pauschalweg) — er ist PKV.
- **AV-Teilbetrag** (ALV=0 → `MVSPHB` läuft, `0,013 × BBGRVALV`) — er zahlt keine AV.

Mechanik (verifiziert via PAP-Probe gegen die Engine): `MVSPHB` (AV-/Höchstbetrag) wird in `UPEVP` genau dann ausgeführt, wenn **`ALV !== 1`**. `KRV=1` nullt den RV-Teil, `PKV=1`+`PKPV=0` nullt den KV/PV-Teil, `ALV=1` überspringt den AV-Teil ⇒ Vorsorgepauschale = 0.

### Fix (Commits 6d21b18 + f81d9c6)

Drei optionale PapEingabe-Felder (`krvKeinRv`, `alvKeinAv`, `pkpvCent`), in `lohn-core` **ausschließlich für `is_pkv`-MA** gesetzt:

```
pkv: person.istPkv,
krvKeinRv: person.istPkv && person.rvFrei,
alvKeinAv: person.istPkv && person.avFrei,
pkpvCent: person.pkvBasisBeitragMonatCent,
```

Neue Spalten `is_pkv` (default false), `pkv_basis_beitrag_monat_cent` (default 0). **SELECT-Liste erweitert** (§3). Defaults erhalten Altverhalten bit-identisch → das `is_pkv`-Gate garantiert null Regression (nur 1 & 309 geflaggt; Diff-Export bestätigt: je genau eine Zeile bewegt).

### Ergebnis cent-genau

- **CHEFIN (1):** StKl 1, St-Brutto 10.918,76. edlohn gewährt **VSP = 0** → `is_pkv=true`, `pkpv=0`. LSt 3.054,00 → **3.613,58**, Auszahlung 10.288,14 → **9.691,44**. Zerlegung der 559,58 LSt: RV 330,09 + KV/PV 168,66 + AV 46,17 + kvz 14,66.
- **Peter (309):** StKl 4, St-Brutto 7.084,00, Basisabsicherung 981,00. edlohn gewährt **VSP ≈ 683 €/Jahr** (nicht 0, nicht der volle Beitrag) → `pkv_basis_beitrag_monat_cent=5692` (netto 56,92/Monat). LSt 1.496,83 → **1.979,00**, Auszahlung 6.926,97 → **6.411,11**.

### Offener Faden (Peter)

Die **56,92 sind rückgerechnet, nicht erklärt**: voller 981er-Beitrag gäbe LSt 1.590,91, halber AG-Zuschuss 1.796,91 — beide verfehlen edlohns 1.979,00. edlohn setzt deutlich **weniger** an, als der Basisbeitrag hergäbe. Wert ist beitragsbasiert/monatsstabil, aber ETL-Beleg („welcher PKV-Basisbeitrag fließt in Peters Vorsorgepauschale?") steht aus.

### Lektion

SV-Befreiung ist eine **Lohnsteuer**-Frage (Vorsorgepauschale), nicht SV: SV-frei ⇒ keine/kaum Vorsorgepauschale ⇒ **höhere** LSt. Der vermeintliche Phase-2-Blocker („wir brauchen die Beiträge") löste sich auf — flag-getrieben, ohne Beitragszahl (CHEFIN) bzw. nur netto-effektiver PKPV (Peter). Tarif selbst war korrekt (UPTAB26 Zone 4 `0,42×X − 11.135,63`).

### Phase-2-Status

| MA          | Status                                               |
| ----------- | ---------------------------------------------------- |
| CHEFIN (1)  | ✅ cent-genau (VSP = 0)                              |
| Peter (309) | ✅ cent-genau (PKPV 5692; ETL-Beleg offen)           |
| PIM (17)    | offen — Werkstudent-Mindestvorsorge, Mini-Rest ~33 € |

## 15. Modul D3 — Dienstplan-Display: Einstellungen, Bereichs-Freigabe, Geburtstags-Banner (27.06.2026)

Drei Features, alle CI-grün (tsc / eslint-Prettier-3.7.3 / 787 Tests) + live.

### 15a. Display-Einstellungen (Voll-Port aus thaitime)

- `display_settings` (je Standort) erweitert: `rotation_enabled` (bool, def false), `rotation_interval_seconds` (int, def 30), `show_areas` (text[], **null = alle**; Werte `kitchen|service|gl`), `show_header` (bool, def true), `show_footer` (bool, def true = **Legende**), `custom_message` (text). Dependency `qrcode.react`.
- Server: `src/lib/display/display.functions.ts` (Validator + Persist); Public-API `src/routes/api/public/display.$locationId.ts` exponiert alle Felder (camelCase).
- UI: `src/routes/_authenticated/admin/locations.tsx` (Display-Sektion) — Display-URL (origin-basiert) + Kopieren/Öffnen + **QR** (`QRCodeSVG`), Rotation-Switch+Intervall, Bereichs-Checkboxen (alle angehakt ⇒ `show_areas=null`), Header-/Legende-Switch, Nachricht-Textarea.
- Display `src/routes/display.$locationId.tsx`: `showHeader` blendet Kopf, `customMessage` als Banner, `showFooter` = Legende-Footer, `showAreas` filtert Spalten, **Rotation** mit Fortschrittsbalken + Punkt-Indikatoren (aus thaitime `ScheduleDisplay.tsx` portiert; rotierbare Gruppen = sichtbare nicht-leere Bereiche; Hooks **vor** den Early-Returns). Merke: in thaitime ist `show_footer` = die Legende.

### 15b. Bereichs-Freigabe (Küche/Service getrennt), Modell B

- `roster_releases` + Spalte `area` (NOT NULL); alte Unique `(location_id,period_id)` **ersetzt** durch `(location_id,period_id,area)`; Backfill je (Standort, Periode, Bereich) für `area IN ('kitchen','service')` aus `roster_shifts` → bestehende Displays bleiben sichtbar.
- Server `src/lib/roster/roster.functions.ts`: `getRosterRelease → {kitchen,service}`; `setRosterRelease({locationId,periodId,area,released})` (Upsert `onConflict location_id,period_id,area` / Delete je area); Audit `roster.release`.
- Public-API liefert `releasedAreas: string[]` und **filtert Schichten serverseitig**: unfreigegebene Küche/Service gehen **nicht** an den Client; `gl` immer. Display zeigt „Bereich – noch nicht freigegeben" je Bereich.
- Grid `src/routes/_authenticated/admin/dienstplan.tsx`: zwei Buttons (Küche/Service), `kitchenReleased`/`serviceReleased`, `handleToggleArea`. Freigabe = **expliziter Button** (Modell B), pro (Standort, Periode, **Bereich**).

### 15c. Geburtstags-Banner

- Public-API: `staff_locations` (Team des Standorts) → `staff` (`is_active=true`) → `staff_personal_details.date_of_birth`; Abgleich **Tag+Monat** (`date.slice(5)` vs. `date_of_birth.slice(5,10)`). Liefert `birthdays: string[]` (Anzeigename; ganzes aktives Team, nicht nur heute Eingeteilte).
- Display: festliches Banner oben (🎂), eigenständig (unabhängig von `showHeader`), nur wenn `birthdays.length > 0`.

### 15d. Domain-Wechsel → cocoplatform.online

- Alle App-URLs **origin-basiert** (`window.location.origin`): Display-Link, QR, Passwort-Reset → **domain-agnostisch**, kein Repo-Change. Keine hartkodierte App-Domain (das `lovable.dev` in den Security-Headers ist nur CSP fürs Editor-Preview).
- **Aktion (Dashboard, nicht Repo):** Supabase → Authentication → URL Configuration: Site-URL + Redirect-Allowlist müssen `https://cocoplatform.online` enthalten, sonst brechen Login-/Reset-Redirects.
- **Geofencing domain-unabhängig:** Fence (`latitude`/`longitude`/`geofence_radius_m`) in `locations`, Distanz-Check serverseitig (`assertWithinFence`); `Permissions-Policy: geolocation=(self)` ist origin-relativ → greift automatisch. Einzige Folge: Browser-Standortfreigabe ist **pro Origin** → MA werden auf neuer Domain einmal neu gefragt (erwartet).

### 15e. Lektionen (teuer gelernt)

1. **`.in([viele IDs])` sprengt die PostgREST-URL-Länge → HTTP 400.** Bei großen Mengen (z. B. alle Artikel-IDs) stattdessen **Inner-Join** (`tabelle!inner(spalte)` + `.eq(...)`) oder org-weit laden + im Speicher filtern. Kleine Mengen (≤ ~50, z. B. Team eines Standorts) sind mit `.in` ok.
2. **Neue Tabellen/Spalten brauchen `notify pgrst, 'reload schema';` in der Migration.** Raw-SQL-Editor umgeht PostgREST (sieht Änderungen sofort), die App geht **durch** PostgREST (Schema-Cache) → ohne Reload „column/table not found".
3. **Prettier exakt `3.7.3`** (package.json + bun.lock, **kein** Caret). Lokal **vor** `eslint`/`format:check`: `npm i prettier@3.7.3` (sonst löst node_modules evtl. 3.8.5 auf → falsch grün/rot). Lovable committet gelegentlich nicht-3.7.3-formatiert → CI `check` rot → Fix: `prettier --write <Datei>`. Der `db-integration`-Job ist `continue-on-error` → sein rotes ❌ ist normal, blockiert nichts.

## 16. Kasse, Portal-Architektur, EasyOrder-Optik & Lohnabrechnungs-Verteilung (27.06.2026)

### 16a. Kasse — Vortagsdefizit / Auto-Abschöpfung Wechselgeldbestand

**Entscheidung:** Wechselgeldbestand wird **auto-berechnet** (Auto-Abschöpfung), das manuelle „Ist gezählt"-Feld ist aus der Anzeige raus. Vortagsdefizit wird mitgeschleppt (wie Alt-System), 90 Tage rollierend.

- **Modell:** `diff = Tages-Bargeld + min(0, Vortagsdefizit)` · `Tresor = max(0, diff)` · `Wechselgeld = Soll + min(0, diff)`. Rollierend: `bal += rawBargeld; bal -= max(0, bal)` → Ergebnis ≤ 0.
- **Reine Helfer** in `src/lib/cash/cash-summary.ts`: `rollOperativeDeficitCents(rawBargeldByDayCents[])` + `computeWechselgeld({ tagesBargeldCents, previousDeficitCents, cashTargetCents })`. Getestet in `cash-summary.test.ts`.
- **Server-Fn** `getPreviousOperativeDeficit`/`…Core` in `src/lib/cash/cash.functions.ts`: 90-Tage-Fenster (org-/standort-gescoped, `business_date ≥ datum−90 ∧ < datum`, asc). **Bit-genau:** baut den `DayInput` über das kanonische `sessionToDayInput` + `computeDailyCash` (KEINE Re-Implementierung). Inputs 1:1 wie die Tagesabrechnung: `cardTotal = Σ session_terminal_amounts`; `delivery_souse`/`delivery_wolt` aus `session_channel_amounts` nach `revenue_channels.kind`; offene Rechnungen = `waiter_settlements` **ohne `superseded`**; Ausgaben/Vorschüsse als Listen; Skalare (vectron, Gutscheine, einladung, sonstige, vorschuss) aus der gespeicherten Session. Roll inline identisch zum Helfer. Rückgabe `{ deficitCents, sourceDate }`.
- **UI:** `CashSummaryBlock.tsx` ohne manuelles Feld, nutzt `computeWechselgeld`, zeigt „Fehlbetrag Vortag" bei `previousDeficitCents < 0`. `kasse.tsx` lädt den Defizit (90 d) und reicht `previousDeficitCents`/`SourceDate` an Block + PDF.
- **PDF** (`src/lib/cash/pdfExport.ts`): `computeWechselgeld` an Highlight + Footer; zusätzlich **Vorschuss-Quittungsblätter** — je Vorschuss eine separate, signierbare Seite (addPage: Header, „Vorschussquittung", Mitarbeiter, Betrag, Bestätigungstext, „Datum, Unterschrift").
- **Rest:** Spalte `cash_actual_cents` + ihr Form-State in `SessionFieldsCard.tsx` sind tot (kein sichtbares Feld mehr) — bei Gelegenheit entfernbar, kein Blocker.

### 16b. Abrechnung — Session-Eröffnen-Karte + Kasse-Sprung

- `src/routes/_authenticated/zeit/abrechnung.tsx`: ist keine Session offen, sehen **admin/manager** (`canOpenSession`) eine Karte „Session für heute eröffnen" (`LocationPills` + `getOrCreateOpenSession`). **Kein Auto-Redirect** (bewusst zurückgenommen) — nach Anlegen bleibt man auf der Seite (Toast + `["cash"]`-Invalidierung → Formular erscheint); stattdessen „Zur Kassenübersicht"-Link im Header (nur admin/manager).
- `src/routes/_authenticated/admin/kasse.tsx`: `validateSearch` (`locationId`, `businessDate`, beide optional) → `KassePage` initialisiert Standort/Datum aus den Search-Params (Vorauswahl).

### 16c. Portal-Architektur — Capability-Quelle + PortalShell

Eine Quelle (Rolle + Freischaltungen) treibt **Navigation UND Erreichbarkeit** → „sichtbar = erreichbar", verhindert strukturell ANDI-artige Bugs.

- `src/lib/nav/portal-nav.ts` — `usePortalNav()`: leitet `PortalNavItem[]` aus `identity.role` + EasyOrder-Zugriff ab. Items: Start (`/`), Stempeln (`/zeit`), Abrechnung (`/zeit/abrechnung`), **Lohn (`/lohn`)** für staff/manager/admin; Bestellung (`/easyorder`) bei `hasEasyOrder`; Backoffice (`/admin`) für admin/manager.
- `src/components/portal/PortalShell.tsx` — responsive: Desktop sticky Top-Bar (`hidden sm:flex`), Mobile Bottom-Tabs (`fixed inset-x-0 bottom-0 sm:hidden`, Content `pb-24`).
- `src/routes/_authenticated/route.tsx` — `inAdmin = pathname === "/admin" || startsWith("/admin/")`; `{inAdmin ? <Outlet/> : <PortalShell><Outlet/></PortalShell>}`. /admin behält eigene Shell. **Neue Portal-Routen daher NICHT selbst in PortalShell wrappen.**
- **EasyOrder-Bestellseite liegt unter `/easyorder`** (aus `/admin` rausgezogen, damit staff-Rolle Zugriff hat — das `/admin`-Layout leitet nicht-(admin/manager/payroll) auf `/` um). EasyOrder-**Verwaltung** bleibt unter `/admin` (manager+).

### 16d. EasyOrder — Admin-Bestelloptik (Accordion + Warenkorb-Icon)

`src/routes/_authenticated/easyorder.tsx`, angeglichen an die Admin-Ansicht `bestellung.lieferanten.tsx`:

- Lieferanten-Gruppen per Default **eingeklappt** (`collapsed[name] ?? true`); bei aktiver Suche (`search.trim() !== ""`) Auto-Expand. Header = Chevron `▸/▾` + runde Zähler-Badge (`rounded-full bg-muted`) + Name; `border-b/bg-muted` nur im aufgeklappten Zustand.
- Mengen-Interaktion: **Warenkorb-Icon statt Stepper** — `🛒` = +1, ab Menge > 0 Anzahl + „−" = −1. Verdrahtet an lokalem `qty`/`setItemQty` (clamp 0..9999, bei 0 `delete copy[id]`); Absende-RPC + Submit-Filter (`q > 0`) unverändert. **Stepper-Import bleibt** (Free-Text „Sonstiger Artikel" nutzt ihn weiter).

### 16e. Modul — Lohnabrechnungs-Verteilung (payslips, privater Storage-Bucket)

Admin lädt PDF je Mitarbeiter hoch → Mitarbeiter sieht/öffnet die eigene Abrechnung. Erster produktive Supabase-**Storage**-Nutzung im Repo. (Die edlohn-PDF-Split-Automatik — Sammel-PDF je Mandant/Personalnummer auftrennen — bleibt davon getrennt offen.)

- **Bucket** `payslips` (privat, im Dashboard angelegt — **NICHT** per Migration). Pfad-Konvention `{organization_id}/{staff_id}/<datei>`.
- **RLS** (`storage.objects`, zwei Migrationen): SELECT = eigene (`foldername[1]=org ∧ [2]=staff`) **oder Admin der Org**; INSERT/UPDATE/DELETE = **nur Admin** der Org (`ra.role = 'admin'`). Manager bewusst draußen.
- **Reines Modul** `src/lib/payslips/payslip-path.ts` (+ Test): `payslipFolder`, `sanitizePayslipFileName` (lehnt `/`, `\`, `..`, führenden Punkt, leer, Fremdzeichen ab), `isPayslipPathAllowed` (eigener Pfad mit Trailing-Slash gegen ID-Prefix-Kollision; Admin org-weit).
- **Server-Fns** `src/lib/payslips/payslips.functions.ts` (Muster `cash.functions.ts`, Storage über `supabaseAdmin`): `listMyPayslips` (staff), `getPayslipSignedUrl` (staff, `isPayslipPathAllowed`-Gate), `listStaffPayslips`/`uploadPayslip`/`deletePayslip` (admin). Runtime = Cloudflare Workers → base64 via `Uint8Array.from(atob(...), c => c.charCodeAt(0))`, **kein `Buffer`**.
- **UI:** `/lohn` (`src/routes/_authenticated/lohn.tsx`, Self-Download, PortalShell-konform) + Portal-Nav „Lohn" (staff/manager/admin) + Admin-Karte als Tab „Lohn" in `staff.$staffId.tsx`, **doppelt `isAdmin`-gated** (Tab-Liste + Render).

### 16f. Lektionen (teuer gelernt)

1. **Roll-Logik nicht aus dem Bauch testen.** Mein Prompt-Erwartungswert `rollOperativeDeficitCents([5000, -2000]) === 0` war **falsch** — korrekt `-2000`: der Tag-1-Überschuss wird sofort abgeschöpft (bal → 0), das Tag-2-Defizit läuft **neu** auf, der alte Überschuss deckt nichts mehr. Impl/Test stimmten; mein Wert nicht. → Erwartungswerte gegen den Algorithmus rechnen, nicht gegen die Intuition.
2. **Supabase-Storage-Gotchas (erstmals genutzt):** `createSignedUrl` liefert **`data.signedUrl`** (nicht `data.url`). `.list()`-Felder: `created_at` (nicht camelCase) + Größe unter **`metadata.size`** (nicht Top-Level). Bucket-Anlage passiert im Dashboard, nicht per Migration — RLS-Policies referenzieren nur `bucket_id`.
3. **Lovable baut große Pläne teilweise.** Beim Payslip-Plan kamen zuerst nur das reine Modul + Migration; Server-Fns + UI (Schritt 3–6) fehlten komplett → separater Nachzieh-Prompt nötig. Nach jedem Lauf gegen die **Dateiliste** prüfen (`git diff --stat`), nicht nur Gates.
4. **Newline-Pflicht weiterhin Lovables Schwachstelle:** trotz expliziter Prompt-Anweisung fehlte neuen Dateien der Schluss-Zeilenumbruch → `format:check`/`eslint` rot. Standard-Fix `prettier --write <datei>`.

## 17. Modul Welle D — Lohnabrechnungs-Verteilung: Auto-Matcher + Sammel-PDF-Splitter (28.06.2026)

Aufbauend auf 16e (manueller Einzel-Upload). Beide Schritte abgenommen (tsc/eslint/vitest grün, Diff-Review). Der manuelle Einzel-Upload aus 16e bleibt unverändert bestehen.

### 17a. Auto-Matcher für Einzeldateien (HEAD a55d892)

Admin lädt mehrere bereits gesplittete edlohn-PDFs auf einmal in `/admin/lohn-verteilung`. Zuordnung über die **Personal-Nr im Dateinamen**, nicht über manuelle Auswahl.

- **Reine Module:** `src/lib/payslips/payslip-filename.ts` (`parsePayslipName`, Regex `-(\d{6})-(\d{4})-(0[1-9]|1[0-2])\.pdf$`) + `payslip-assign-core.ts` (`classifyAssignment` → Status `matched`/`matched_inactive`/`unknown_perso`/`ambiguous`/`unparsable`).
- **Server-Fns** `payslip-assign.functions.ts`, beide admin-gated via `loadAdminCaller(…, "admin")`: `planPayslipAssignment` (Dry-Run, nur Dateinamen) + `assignPayslips` (lädt nur eindeutige Treffer). **Auflösung rein server-seitig** über `staff.perso_nr` (org-scoped); Client liefert nie eine `staffId`. base64 via `atob` (kein Buffer). Konsistent mit `uploadPayslip`: kein `audit_log`.
- **Zwei-Schritt:** Vorschau-Tabelle (perso · Mitarbeiter · Status) → bestätigen → Upload. Nur `matched`/`matched_inactive` werden hochgeladen.
- **`ambiguous`-Sicherheitsnetz:** >1 `staff` zur perso → kein Upload, Meldung. Der Matcher verweigert im Zweifel, statt je falsch zuzuordnen.

### 17b. Sammel-PDF-Splitter (HEAD 11b9488)

Ein edlohn-Monatsexport je Mandant (alle Mitarbeiter hintereinander) wird **im Browser** in Einzel-PDFs zerlegt und in denselben Matcher (17a) gespeist. **Server-Matcher unverändert** — der Splitter erzeugt nur dessen Eingaben.

- **Dependency neu:** `pdf-lib` (`^1.17.1`). `pdfjs-dist` (`^6`) war bereits da (Worker-Setup wie `PdfCanvasPreview.tsx`).
- **Reines Modul** `src/lib/payslips/split-combined-core.ts` (+ Golden-Master-Test): `parsePersoFromPageText`, `parseRunMonth` (Korrektur-Seiten liefern den Lauf-Monat via „Korrektur in MM.YYYY"), `groupPagesByPerso` → gruppiert nach perso (Reihenfolge erhalten), Lauf-Monat per Mehrheit, Dateiname `Lohn-NNNNNN-YYYY-MM.pdf` (matcher-kompatibel). Seiten ohne perso → `unparsablePages`, **nie** an Nachbarn gehängt.
- **Browser-Harness** `split-combined.ts`: `extractPageTexts` (pdfjs), `splitCombinedPdf` (pdf-lib `copyPages` je Gruppe), `bytesToBase64` (chunked, kein Buffer). PDF-Inhalt wird nicht geloggt.
- **Golden Master** aus echtem Mai-2026-Export (YUM GmbH): 49 Seiten → 39 Mitarbeiter; Seitenzahl pro Person **variabel** (Korrektur-Monate hängen an derselben perso: perso 000001 = 5 Seiten, 000109 = 5, 000011/000027 = je 2).

### 17c. Mandanten / TSB — dokumentierte Wiedervorlage (zurückgestellt)

Lohn läuft über **zwei GmbHs / edlohn-Mandanten**: **GmbH A = YUM + Spicery**, **GmbH B = TSB**. edlohn-Personal-Nrn sind nur **je Mandant** eindeutig. COCO modelliert die GmbH aktuell **nicht** (kein Feld an `staff`/`locations`, kein Unique-Index auf `perso_nr`).

- **Aktuelle Annahme (per Live-CSV bestätigt):** `perso_nr` ist heute org-weit eindeutig (0 Doppelungen). **TSB ist lohnseitig ausgeklammert** → Matcher löst org-weit auf. Das `ambiguous`-Netz (17a) fängt künftige perso-Kollisionen ab (verweigert, statt fehlzuzuordnen).
- **Offene Frage vor TSB-Aktivierung:** Es arbeitet jemand über die GmbH-Grenze. Zu klären: **eine** Lohnabrechnung (eine GmbH zahlt, hilft nur aus) **oder zwei** (je GmbH eine Personal-Nr)? Bei „zwei" reicht ein einzelnes `staff.mandant_id` nicht → Zuordnungstabelle `staff_payroll_identities (staff_id, mandant_id, perso_nr)` nötig.
- **Zurückgestellter Prompt „Mandanten-Fundament"** (`mandanten`-Tabelle + `staff.mandant_id` + partieller Unique-Index `(mandant_id, perso_nr)` + GmbH-Dropdown in der Mitarbeiter-Anlage): erst bauen, wenn TSB in den Lohnlauf kommt und die Ein/Zwei-Abrechnungs-Frage entschieden ist. Bis dahin keine Mandanten-Logik im Code.

### 17d. Lektionen (teuer gelernt)

1. **Sammel-PDF: nach perso gruppieren, nicht nach Seitenzahl.** Korrektur-Monate erzeugen variable Seitenzahlen pro Person. Annahme „2 Seiten pro Person" wäre falsch gewesen.
2. **Nur `perso_nr` ist der Schlüssel, nie der Name.** Im echten Export: zwei verschiedene „Schumann" (perso 1 ≠ 109), zwei „Robkla" (perso 6 ≠ 12). `display_name` ist ohnehin nur ein Spitzname/Rolle (perso 1 = „CHEFIN" = Frank Schumann).
3. **PDF-Text muss im Browser gelesen werden** (`pdfjs-dist`), nicht auf Cloudflare Workers. `pdf-lib` kann zerlegen, aber keinen Text extrahieren.
4. **Unparsable-Seiten nie automatisch zuordnen** — melden und den Menschen prüfen lassen.

### 17e. Zurückgestellt — Payslip-Auslieferung (Ad-Blocker-Block)

Die hochgeladene Lohnabrechnung wird in `lohn.tsx` und `staff.$staffId.tsx` per `window.open(res.url, "_blank", "noopener")` geöffnet — also als neuer Tab direkt auf die rohe `*.supabase.co`-Signed-URL (`getPayslipSignedUrl` → `createSignedUrl`).

- **Symptom:** Clientseitige Ad-/Tracking-Blocker (uBlock Origin, Brave-Shields, In-App-Blocker auf Mobilgeräten) können diesen Tab blockieren → Chrome zeigt `ERR_BLOCKED_BY_CLIENT`. **Kein** Server-/RLS-/Code-Fehler — die Anfrage erreicht Supabase gar nicht erst.
- **Sofort-Workaround:** Inkognito-Fenster (Erweiterungen aus) oder im Blocker `cocoplatform.online` + `*.supabase.co` whitelisten.
- **Robuste Lösung (zurückgestellt):** Payslip-Bytes über COCOs **eigene Domain** ausliefern — Server-Fn streamt die Datei server-seitig aus dem Storage (`supabaseAdmin`), der Browser trifft nur noch `cocoplatform.online/...` (auf keiner Blockliste). Löst zugleich den dokumentierten Safari-`blob:`-Stolperstein (Vorschau via pdfjs-Canvas statt Roh-URL).
- **Auslöser zum Bauen:** sobald relevant — z. B. Mitarbeiter-Beschwerden, dass die eigene Abrechnung nicht öffnet. Bis dahin keine Änderung am Auslieferungspfad.

### 17f. Admin-Payslip-Sicht — Auflösung (29.06.2026)

Symptom war: Admin-Lohn-Tab und `/lohn`-Selbstansicht blieben leer, obwohl die Dateien im Storage lagen. Drei Ursachen lagen übereinander; alle behoben:

1. **Auflistung über RPC statt `storage.list()`** (HEAD `dd8a1ff`). `supabaseAdmin.storage.from("payslips").list("{org}/{staffId}")` liefert bei **zweistufig verschachteltem Präfix leer** zurück — auch mit Service-Role (RLS umgangen), auch mit Limit/Sortierung. Lösung: `listFolder` in `payslips.functions.ts` ruft die neue SECURITY-DEFINER-RPC `public.list_payslip_objects(p_prefix)` (Migration `20260628191912_*.sql`), die `storage.objects` direkt nach Präfix liest (`name like prefix||'/%' and not like prefix||'/%/%'`). EXECUTE nur `service_role`, `search_path=''`. Per direktem RPC-Aufruf an echten Daten verifiziert (liefert die Dateien).

2. **Fehleranzeige statt maskiertem „leer"** (HEAD `16c52d3`, Prettier-Nachzug `8992644`). `PayslipsTab` (in `staff.$staffId.tsx`) und `lohn.tsx` trennen jetzt Laden / Fehler (`q.error.message`, rot) / Leer / Liste. Vorher erschien **jeder geworfene Fehler identisch als „Noch keine Lohnabrechnungen"** — die eigentliche Ursache blieb unsichtbar.

3. **Account-Verknüpfung korrigiert (eigentliche Wurzel).** `frank.schumann@me.com` war in `user_links` an **ANDIs** Datensatz gehängt (`6dfb47b9-…`, perso 6, Rolle **staff**) statt an Franks eigenen (`ce04575a-…`, perso 1, CHEFIN, **admin**). Beim E-Mail-Login war Frank im Selbst-Kontext also ANDI. Korrigiert per SQL (Option A): Schatten-Link auf `ce04575a` gelöst → E-Mail-Login von `6dfb47b9` auf `ce04575a` umgehängt. Verifiziert: `frank.schumann@me.com → ce04575a, perso 1, CHEFIN, admin`.

Lektionen (teuer gelernt):

- **`storage.list()` ist bei verschachteltem Präfix unzuverlässig** — Listen über RPC auf `storage.objects` lesen, nicht über die Storage-List-API.
- **UI darf einen Fehler nie als „leer" maskieren** — sonst debuggt man die falsche Ebene (hier zweimal).
- **`user_links` hat `user_id` UND `staff_id` je UNIQUE** — ein Datensatz hat genau einen Login und umgekehrt. Ein Login umhängen heißt: erst den belegenden Link am Ziel-Datensatz lösen, dann umhängen (sonst Unique-Verletzung). Vor jeder solchen Änderung Rolle am Ziel prüfen (Lockout-Schutz: `ce04575a` hatte bereits `admin`).
- **Nur `perso_nr`/`staff_id` sind verlässlich, nie der Anzeigename** — `display_name` ist Spitzname/Rolle (perso 1 = „CHEFIN" = Frank Schumann).

## 18. Modul M-Statistik — Backend (29.06.2026)

Quelle der Wahrheit: Analyse der `tagesabrechnung`-Statistikseite (Auswertungs-Fehler kartiert), Neubau in COCO als reine, getestete Funktionen + dünne Read-Server-Fns. Alle cent-basiert, gated `["manager","admin","payroll"]`, org-/standort-scoped.

**Designentscheidungen (verbindlich):**

- **Kalendermonat NUR für die Statistik** (1.–Monatsende). Lohn/Zeit bleiben bei 26.–25. (`periods`-Tabelle). Selektor `month: "YYYY-MM"`; Vergleich = echter Vormonat (variable Länge); Custom-Range möglich (Vorperiode = gleich langes Fenster davor); ohne Argumente = aktueller Monat. Geteilte UTC-sichere Helfer in `src/lib/statistics/period-window.ts` (`monthRange`/`previousMonthRange`/`previousRangeForDates`) — Umsatz und Trinkgeld nutzen dasselbe Fenster.
- **Umsatz doppelzählungsfrei:** `Gesamtumsatz = vectron_daily_total_cents + Σ(is_takeaway-Kanäle)`. YUM/Spicery sind Takeaway-only (`pos`-Kanal = 0) → Haus = vectron, Takeaway additiv/disjunkt. TSB hat zusätzlich einen `Kasse`/pos-Kanal (is_takeaway=false) → Haus-Umsatz-Verifikation offen, sobald TSB-Sessions finalisiert sind.
- **Alle Sessions zählen** (S-6): Team finalisiert nicht, daher kein Status-Filter; gezählt wird, sobald Umsatz vorhanden ist.
- **Ein Trinkgeld-Begriff** (S-7): ausschließlich `computeSessionTipPoolCore` (M2) wiederverwendet — keine zweite Formel. perStaff = Summe der `TipPoolShare` über die Sessions. Second-Waiter wie der Kern es heute liefert (zurückgestellt).
- **Personalquote = Basis-Brutto (B2):** Netto-Stunden × gültigkeitsdatiertem `hourly_rate` (EUR, `numeric(10,2)`). OHNE AG-SV, SFN, `hourly_rate_2`. Quote (Kosten/Umsatz) in der UI via `personnelRatioPct`. `staffWithoutRate` als Diagnose, damit fehlende Sätze die Quote nicht stillschweigend untertreiben.

**Vermiedene tagesabrechnung-Fehler:** Doppelzählung Lieferumsatz; KPI-Wert vs. Trend über verschiedene Fenster; zwei parallele Trinkgeld-Formeln; verworfener Umsatz schichtloser Sessions; „Alle"-Tagesverlauf nicht nach Datum aggregiert.

**Dateien (`src/lib/statistics/`):** `revenue-core.ts`, `revenue-map.ts`, `revenue-stats.functions.ts`, `period-window.ts`, `tip-aggregate.ts`, `tip-stats.functions.ts`, `personnel-core.ts`, `personnel-stats.functions.ts` (je mit Tests). In `cash.functions.ts` wurden `computeSessionTipPoolCore`, `loadOrgSettings` (+ zwei Typen) nur `export`-sichtbar gemacht — keine Logikänderung.

**Server-Fns:** `getRevenueStats`, `getTipStats`, `getPersonnelStats` — gleiches Input-/Perioden-Modell (`month`/Custom/Default), Trend gegen Vorperiode.

**Offen:** TSB-Haus-Umsatz-Verifikation. (UI ist umgesetzt — siehe Abschnitt 19.)

**Verifizierter Stand:** HEAD `f0ba414` — `tsc`/`eslint --max-warnings=5`/`vitest` (870) grün.

## 19. Modul M-Statistik — UI (29.06.2026)

Route `/admin/statistik` (gated `["manager","admin","payroll"]`), konsumiert die drei Read-Fns aus Abschnitt 18 + `personnelRatioPct`. Drei Bauschritte, alle abgenommen.

### Tabs gegen Endlos-Scroll (HEAD 862568a)

Vier Tabs (`Umsatz` · `Trinkgeld` · `Personalquote` · `Standortvergleich`, shadcn `ui/tabs`). Die Filterleiste (Monat/Standort/PDF) bleibt **global oberhalb** der Tabs. **Wichtig:** alle Query-Hooks (`statsQ`/`tipsQ`/`personnelQ` + die drei Compare-`useQueries`) bleiben **eager** oben in `StatistikPage` — Tabs steuern nur Sichtbarkeit, weil der PDF-Export alle Daten gleichzeitig braucht. Nicht in Tabs verschieben/konditionalisieren.

### Chart-Lückenfüllung (HEAD 862568a)

Reine, getestete Funktion `fillDailyGaps` in `src/lib/statistics/chart-fill.ts`: erzeugt aus den vorhandenen Tagen eine **lückenlose** Folge von min..max `businessDate`, fehlende Kalendertage als Null-Balken (`houseCents/takeawayCents/totalCents = 0`). UTC-Millisekunden-Schritte (kein DST-/Zeitzonen-Drift, Monatsgrenzen korrekt), nur Innen-Lücken (keine führenden/nachfolgenden Leertage). `RevenueChart` schickt `daily` vor dem Mapping durch diese Funktion → lineare X-Achse.

### Freier Zeitraum (HEAD db13823)

Modus-Umschalter `Monat ⇄ Zeitraum` (Segmented aus zwei Buttons). Im Zeitraum-Modus zwei `type=date`-Felder (Von/Bis), beim Umschalten mit den Grenzen des aktuellen Monats (`monthRange`) vorbelegt. Eine Quelle der Wahrheit (`periodArgs` = `{month}` bzw. `{startDate,endDate}`, plus `periodValid`) speist **alle vier** Query-Gruppen inkl. Compare; `queryKey`s tragen `mode + month + startDate + endDate + locationFilter`; `enabled: periodValid` blockt ungültige/leere Bereiche (`endDate ≥ startDate`).

**Backend war bereits range-fähig** (`startDate/endDate`, Vorperiode = gleich langes Vorfenster via `previousRangeForDates`, Trend wird auch im Range-Modus berechnet). **Merker:** im Range-Modus liefert das Backend `range.label = null` — UI **und** PDF bauen das Label selbst aus `startDate–endDate`. `periodLabel` (Monat „LLLL yyyy" bzw. „TT.MM.JJJJ – TT.MM.JJJJ") fließt in PDF-Kopf + Dateiname; `exportDisabled` schließt `!periodValid` ein. `MonthNav` und die „· unvollständig (Stand …)"-Anzeige bleiben **monatsspezifisch** (Coverage-Klemmung U5a gilt nur im Monatsmodus).

**Offen (M-Statistik gesamt):** nur noch TSB-Haus-Umsatz-Verifikation; größere Charts könnten später `recharts` lazy laden (separater Schritt, vgl. Abschnitt 18-Umfeld).

## 20. Dienstplan-Abwesenheiten — Korrektur `staff_absences` + Krank in `roster_absence` (29.06.2026)

**Ausgangslage / Fehler:** Für die geplante Display-Overlay-Anzeige (Urlaub / Krank / Verfügbar / Wunsch-frei) wurde zunächst eine **neue Tabelle `staff_absences`** (+ Enum `absence_type`) gebaut und mit 550 Zeilen (117 Krank + 433 Urlaub aus thaitime) befüllt. **Das war redundant:** COCO führt Abwesenheiten längst in der `roster_*`-Familie (siehe Abschnitt 6) — `roster_absence` (per-Tag, gelesen von Grid `dienstplan.tsx`, `roster.functions.ts`, `urlaub-krank-diagnose.ts`), `roster_availability`, `day_off_wishes`, sowie `leave_requests` → expandiert per SECURITY-DEFINER-RPC `approve_leave_request` nach `roster_absence`. Der Anwendungscode unterstützte `type: "urlaub" | "krank"` bereits durchgängig (zod-Enum in `roster.functions.ts`, Grid-Label „Krank", `urlaub-krank-diagnose.ts` filtert `.in("type", ["urlaub","krank"])`) — **nur die DB-CHECK-Constraint blockierte `krank`.**

**Korrektur (Migration `20260629160444`):** `drop table staff_absences` + `drop type absence_type`; `roster_absence`-CHECK von `('urlaub')` auf `('urlaub','krank')` erweitert. Keine Code-Verweise auf `staff_absences` mehr.

**Krank-Quelle + Import:** thaitime `absence_entries` (Krank) — 117 Zeiträume → **119 per-Tag-Zeilen** nach `roster_absence`, `type='krank'`, idempotent `ON CONFLICT (staff_id, date) DO NOTHING` (rohes SQL, kein Audit). Endstand Krank in `roster_absence`: **120** (119 Import + 1 manuell via App-`set_range`). Urlaub bleibt unverändert die Quelle `leave_requests` / `approve_leave_request` — **kein Urlaub-Re-Import nötig.**

**Datenstand Urlaub (geklärt, kein Schaden):** Während der Arbeit fiel `roster_absence`-Urlaub von 951 auf 835. **Durch keine unserer Operationen verursachbar** — Krank-Import = nur Insert, Korrektur-Migration = nur CHECK (beide ohne Delete/Update von Urlaub); `audit_log` (`entity='roster_absence'`) zeigte im Fenster **kein `clear`**, nur 1 `set_range`. Die Urlaub-Quelle (433 genehmigte thaitime-Anträge → **849 Tage**, exakt gleiche Datumsspanne 2025-12-02…2027-01-17) liegt dicht an 835; die ursprünglichen 951 enthielten ~100 Tage aus Nicht-Antrags-Quellen (Grid-Direkteinträge), die außerhalb der Session weggefallen sein können. **835 ist plausibel korrekt.** Ein gefahrloser additiver Abgleich (849 Antrags-Tage, `ON CONFLICT DO NOTHING`, ändert/löscht nichts) liegt bereit, ist aber nicht erforderlich.

**Lektion (teuer gelernt):** **Vor jedem neuen Tabellen-/Enum-Bau erst bestehenden Schema-Stand UND diese Doku prüfen** — `roster_absence` / `leave_requests` standen längst in Abschnitt 6, die Antwort lag im Dokument. Direkt im Editor angelegte Tabellen sind Repo-Drift → immer per idempotenter Migration über Lovable nachziehen (so geschehen) statt nur im SQL-Editor. `roster_absence` hat `UNIQUE (staff_id, date)`; `setAbsenceRange` upsertet (kann Urlaub↔Krank umflaggen) und löscht überlappende `roster_shifts`. Idempotenz für Daten-Importe immer über `ON CONFLICT DO NOTHING`.

## 21. Trinkgeld-Pool — manuelle Küchen-Verteilung, Plan-Snapshot, GL-Sicht, Teilnahme-Override (30.06.2026)

Verifizierter Stand HEAD `c9c35f1` (tsc 0, eslint 0, vitest 911, prettier sauber). In vier Schritten gebaut; Geld-Logik durchgehend gegen `computeTipPool` (unverändert) abgesichert.

### 21a. Küche manuell (Schalter)

- Org-Einstellung `organization_settings.kitchen_manual_only` (bool, default false). Aktiv → für die **Küche** werden Stempelstunden ignoriert; die Stundenbasis kommt ausschließlich aus manuell erfassten Schichten. **Service unverändert** auf Stempelstunden.
- Eingabe per **Start/Ende-Zeit**: `session_tip_pool_entries.shift_start/shift_end` (time). Reine Fn `kitchenShiftMinutes(start,end)` (`src/lib/cash/`), Mitternachts-Wrap `end<start → +1440`, `start==end → 0` (bewusste Abweichung vom Legacy-„=24h"). `hours_minutes` bleibt die von der Verteilung konsumierte Größe.
- Stunden-Auflösung als reine Fn `resolvePoolTimeEntries` (kitchenManualOnly verwirft Küchen-Stempel, auch ohne manuellen Eintrag).

### 21b. Plan-Snapshot bei Session-Eröffnung

- `getOrCreateOpenSession` legt **nur im Create-Zweig** je bestätigter (`status='confirmed'`) `roster_shifts`-Schicht des Tages/Standorts eine `session_tip_pool_entries`-Zeile an (idempotent `on conflict do nothing`); Snapshot-Fehler eröffnen die Session trotzdem (Komfort, kein Blocker). Reine Fn `buildRosterPoolSnapshot` (`src/lib/cash/roster-pool-snapshot.ts`).
- **Snapshot-Semantik:** Zusammensetzung wird bei Eröffnung eingefroren — spätere Plan-Änderungen wirken nicht zurück. Card-Button „Aus Dienstplan ergänzen" fügt nachträglich Bestätigte hinzu (überschreibt nichts).
- **Standardzeiten** in `location_department_defaults` (bestehend): `default_checkin` + neue Spalte **`default_checkout`**, je Standort × Bereich. Stammdaten-UI: `src/routes/_authenticated/admin/standortzeiten.tsx`. Küche z. B. 15:00–23:30, Service 16:00–23:00 (Service-Ende ist vorläufiger Fallback).
- **Service-Ende-Nachzug:** bei der Kellnerabrechnung (`submitWaiterSettlementCore`) wird das Service-Pool-Ende auf den echten Auto-ClockOut (`time_entries.ended_at`) gesetzt — **nur, wenn `shift_end` noch exakt dem Service-`default_checkout` entspricht** (= seit Eröffnung unverändert). Kein Extra-Flag; manuell geändertes Ende bleibt. `time_entries` wird dabei **nur gelesen**.

### 21c. GL-Sichtbarkeit (ohne Trinkgeld)

- GL wird beim Snapshot mit angelegt: `department='gl'`, `shift_start/end=null`, `hours_minutes=0` (**keine** Standardzeit). Eigene Card-Sektion „Geschäftsleitung — Arbeitszeit (keine Trinkgeld-Beteiligung)", erfassbar, **ohne** Anteil-Spalte.
- **Doppelte Geld-Sicherheit:** (a) `computeTipPool` schließt über `staffDepartments` alles außer kitchen/service aus; (b) GL liegt in getrennter Anzeige-Liste (`glEntries`). `session_tip_pool_entries` trägt damit bewusst auch Nicht-Trinkgeld-Arbeitszeit.
- Bereichs-Priorität bei Mehrfach-Einteilung: **gl (Ausschluss) > kitchen > service** (eine Zeile je MA; Mehrfach-Einteilung bleibt architektonisch erlaubt, D-3/D-6 unverändert). Siehe **TP-GL**.

**TP-GL (05.07.):** GL-Schicht am Tag schließt vom Trinkgeldpool aus —
Snapshot-Priorität geändert auf gl (Ausschluss) > kitchen > service
(vorher kitchen > service > gl; Fund: LAM/Spicery mit Service+GL landete
im Service-Pool). Manuelles Hinzufügen warnt bei GL-Schicht, Manager kann
bewusst übersteuern.

**Betriebs-Notiz Pool-Snapshot (04.07., WIT):** Pool-Zeilen sind ein
Session-Snapshot — nachträgliches Entfernen von Dienstplan-Schichten
wirkt erst ab der nächsten Session („Aus Dienstplan ergänzen" fügt nur
hinzu). Ausgeschiedene Mitarbeiter ggf. manuell aus dem Pool nehmen;
im konkreten Fall unschädlich (0,00 h ⇒ kein Anteil).

### 21d. Teilnahme-Übersteuerung pro Session

- Spalte `session_tip_pool_entries.participates` (bool **nullable**): NULL = Stammdaten-Default (`staff.participates_in_pool`), true/false = Session-Override. **Entkoppelt von den Stunden** — löst den Fall „früher heimgeschickt" (echte Stunden bleiben, MA trotzdem ganz aus dem Pool).
- Reine Fn **`effectiveParticipation(override, staffDefault) = override ?? staffDefault`** (`tip-pool.ts`), ersetzt die frühere `hours_minutes>0`-Heuristik. Verdrahtet in `computeSessionTipPoolCore`; `computeTipPool` unverändert.
- Card: Teilnahme-Toggle je kitchen/service-Zeile, vorbelegt mit effektivem Status; **abgewählte bleiben sichtbar** (0 Anteil) über die vollständige `poolEntries`-Liste; live-Recompute. GL ohne Toggle.

### Ausgeführte Migrationen (COCO-DB, Frank)

`organization_settings.kitchen_manual_only`; `session_tip_pool_entries.shift_start/shift_end`; `location_department_defaults.default_checkout`; `session_tip_pool_entries.participates`. Alle additiv (`add column if not exists`), keine neuen Policies.

### Offen / bewusst vertagt

- **Fähigkeit B (an M4): ✅ umgesetzt am 30.06.2026 — siehe §23.** (Realisiert als `source='pool'`, nicht `'manual'`.)
- Teilnahme-Override greift nur für MA **mit** `session_tip_pool_entry`; reine Stempel-MA ohne Eintrag erst nach Aufnahme in der Card übersteuerbar.

### Lektionen (teuer gelernt)

- **Feature war großteils schon da:** Küchentrinkgeld rechnete COCO bereits (`kitchen_tip_cents`, `kitchenPool`, Verteilung). Vor Neubau erst Bestand prüfen.
- **Geld-Regel blockierend testbar machen:** inline-Logik in async-Fns ist nur über den flaky `db-integration`-Job prüfbar → als reine Fn extrahieren (`effectiveParticipation`, Muster `resolvePoolTimeEntries`) und im `check`-Gate unit-testen.
- **Snapshot nur im Create-Zweig:** sonst legt jeder Session-Get doppelt an.

## 22. Dienstplan-Display — Farbschema an Grid angeglichen, geteilte `pill-style.ts` (30.06.2026)

Verifizierter Stand HEAD `406010a` (tsc 0, eslint 0, vitest 918, prettier sauber). Das öffentliche Display (`display.$locationId.tsx`, `CellView`) sieht jetzt farblich genauso aus wie der Dienstplan (`ShiftPill` + Grid-Zelle).

### Befund (Drift durch Duplizierung)

Grid und Display rendern Schicht-Pillen unabhängig voneinander → auseinandergelaufen: Grid dunkelte die Skill-Farbe ab (`color-mix(in oklab, color 85/92%, black)`) + weißer Text + Abkürzung; Display nahm die **rohe** `cell.color` + dunklen Text + vollen Skill-Namen. Abwesenheiten zusätzlich mit abweichendem Icon (Krank: Display `Thermometer` vs. Grid `HeartPulse`).

### Lösung — geteilte Quelle (Muster wie `service-marker.ts`)

- Neue Datei **`src/lib/roster/pill-style.ts`**: reine Fns `pillStyle({ skillColor, area, label, status }) → { backgroundColor, textClass }` und `abbr(skillName)`, aus `ShiftPill` extrahiert.
- **`ShiftPill` UND Display-`CellView` rufen jetzt dieselbe Funktion** — kein Copy-Paste mehr, kein erneuter Drift. (Genau dieselbe Philosophie, mit der schon `serviceMarker` zwischen Grid und Display geteilt wird.)
- Charakterisierungstest `pill-style.test.ts` (7 Tests) nagelt `backgroundColor`/`textClass` fest → der Refactor kann die Grid-Optik nicht still verschieben.

### Theme-Entscheidung (bewusst)

- **Skill-Pillen exakt gleich:** abgedunkelte Farbe + weißer Text + Abkürzung (`abbr`) — hintergrund-unabhängig, da die Pille eigenen Hintergrund mitbringt.
- **Display bleibt dunkel** (`bg-slate-950`). Abwesenheiten daher **nicht** 1:1 farbgleich, sondern **gleiche Icons + gleiche Farb-Familie, aufgehellt** (400er statt 600er): Urlaub `Umbrella` grün, Krank **`HeartPulse`** (nicht mehr `Thermometer`) rot, Wunsch `Heart` lila — lesbar auf dunklem Grund.

### Lektion

Darstellungs-Logik, die an zwei Orten gleich aussehen soll, gehört in **eine** geteilte Funktion (`service-marker.ts`, jetzt `pill-style.ts`). Dupliziert man sie, driftet sie garantiert auseinander — der hier behobene Fall.

## 23. Fähigkeit B — Pool-Zeiten → `time_entries` für den Lohn (30.06.2026)

Verifizierter Stand HEAD `33cdd1e` (tsc 0, eslint 0, vitest 936, prettier sauber). Migration in COCO-DB ausgeführt (ENUM-Wert `pool` + Index `time_entries_pool_key_unique`). Damit rechnet M4 die Arbeitszeit der **Nicht-Stempler** (Küche bei `kitchen_manual_only`, GL) mit: ihre `session_tip_pool_entries`-Zeiten (`shift_start/shift_end`, §21a) werden bei der Kellnerabrechnungs-Abgabe als `time_entries (source='pool')` geschrieben.

### Entscheidungen (Frank)

- **`source='pool'`** (neuer ENUM-Wert, nicht `'manual'`) — sauber separierbar, eigener Idempotenz-Index.
- **`break_minutes=0`** — volle Pool-Zeit zählt als Arbeitszeit.
- **Auslöser: bei Abrechnungs-Abgabe** (neben A's `performClockOut`), best-effort.
- **GL mit erfasster Zeit kommt mit** (Arbeitszeit für Lohn, nicht Trinkgeld); GL ohne Zeit nicht.

### Abgrenzung zu A

A (Service-Ende-Nachzug) **updated** existierende **clock**-Einträge der Stempler (`auto_clockout_time_entry_id`). B **inserted** neue Einträge nur für **Nicht-Stempler**. Keine Überschneidung.

### B-1 — Schema + reines Modul (`src/lib/cash/pool-time-writeback.ts`)

- Migration (getrennt): `ALTER TYPE … ADD VALUE 'pool'` (eigene Transaktion, vor Nutzung committet), dann partieller Unique-Index `time_entries_pool_key_unique (organization_id, import_key) WHERE source='pool'`.
- Reine Fn `buildPoolTimeEntryRows`: je Pool-Eintrag mit gesetztem `shift_start`+`shift_end`, **Kollisionsregel** (staff mit clock/manual am `business_date` → überspringen → kein Doppel), `crossesMidnight = end<start`, `start==end` → keine Row, `import_key='pool:<id>'`. Department egal (GL kommt mit).

### B-2 — Verdrahtung + TZ + Lohn-Nachrangigkeit

- **TZ:** `berlinOffsetMinutes`/`offsetString` aus `shift-hours.ts` exportiert + wiederverwendet; reine Fn `poolLocalTimeToIso(businessDate, "HH:MM", dayOffset)` baut den Berlin-korrekten ISO-Timestamp. **DST-getestet** (Winter/Sommer + beide Umstellungstage 29.03./26.10.) — bestimmt die SFN-Stunden, cent-relevant.
- **Verdrahtung** in `submitWaiterSettlementCore`: `assertBusinessDateUnlocked` (Wasserlinie → bei Sperre skip, kein Audit) → `buildPoolTimeEntryRows` → Insert mit `onConflict: organization_id,import_key, ignoreDuplicates` (idempotent) → Audit `pool_time.writeback {sessionId, businessDate, inserted}`. Best-effort: Writeback-Fehler kippt die Abrechnung **nicht**.
- **Lohn-Nachrangigkeit:** `lohn-period.functions.ts` lädt jetzt `source`; reine Fn `dropPoolWhenRealEntryExists` verwirft **vor** der Aggregation alle `pool`-Zeilen eines Tages, an dem ein `clock`/`manual`/`import`-Eintrag existiert.

### Doppelzählungs-Schutz (zwei Ebenen)

1. **Schreibseite:** `buildPoolTimeEntryRows` überspringt Stempler.
2. **Leseseite:** `dropPoolWhenRealEntryExists` lässt echte Zeit `pool` schlagen — robust auch gegen späteres Stempeln nach der Abgabe.

### Lektionen

- `ALTER TYPE … ADD VALUE` muss in **eigener** Transaktion committet sein, bevor ein Index/Code den Wert nutzt (sonst „invalid enum value").
- Geld-/zeit-kritische TZ-Konstruktion gehört in eine reine Fn **mit DST-Charakterisierung** (`poolLocalTimeToIso`) — nicht inline im I/O-Pfad.

## 24. Dienstplan & Display — Spalten-Feinschliff (30.06.2026)

Rein visuelle Angleichungen an Grid (`RosterGrid.tsx`) und öffentlichem Display (`display.$locationId.tsx`); keine Logikänderung.

- **Zweite Mitarbeiter-Spalte rechts:** Sowohl Grid als auch Display zeigen den Mitarbeiternamen jetzt links **und** rechts (vor der Σ-Spalte) — bei breiten Zeiträumen bleibt der Name am rechten Rand ablesbar.
- **Sticky-Spalten:** Linke Namensspalte, rechte Namensspalte und Σ-Spalte sind beim horizontalen Scrollen fixiert (solide Hintergründe, kein Durchscheinen).
- **Namen zentriert** in beiden Namensspalten (Grid + Display).
- **Zebra-Streifen im Display** (`even:bg-slate-900/40`); die sticky-Zellen führen den Streifen mit, damit die Zeile durchgängig wirkt.

## 25. Rolle „Planer" — eingeschränkter Dienstplan-Zugang (30.06.2026)

Verifizierter Endstand HEAD `e85943f` (tsc 0, eslint 0, vitest 943, prettier sauber). Neue **Seitenrolle** `planer`: darf Dienstpläne machen, aber nur in freigegebenen `(Standort, Bereich)`-Kombinationen. Sieht den ganzen Plan, ändert nur den eigenen Scope. SUMITR ist der erste Planer (Küche Spicery + YUM).

### P-1 — Schema + Rolle

- Migration (in COCO-DB ausgeführt): `app_role` um `'planer'` erweitert; `permission_overrides` um Spalte `area staff_department` (kitchen/service/gl), Unique-Indizes neu mit `area`.
- **`has_permission`**: neue 3-arg-Variante `has_permission(_perm, _location, _area)` (volle area-Logik: `location IS NULL` = global, `area IS NULL` = alle Bereiche; DENY > ALLOW > Default). Die bestehende 2-arg-Signatur **bleibt** und delegiert auf die 3-arg mit `_area := NULL` → RLS-Policies bit-identisch gültig, keine Ambiguität.
- `planer` trägt **Lese**-Defaults (ganzen Plan sehen), **kein** `roster.shift.manage` im Default. Schreibrecht gibt es ausschließlich als scoped ALLOW-Override (Standort + Bereich).
- `role-guard.ts`: `planer` ist **Seitenrolle** (RANK 0 wie `payroll`, **nicht** in der Hierarchie `admin > manager > staff`) → erbt keine Manager-Rechte.

### P-2 — Schreibpfad-Durchsetzung

Alle fünf Roster-Schreib-Functions prüfen `roster.shift.manage` gegen die **echte** `(location, area)` der Schicht, nie gegen `null`:

- `createRosterShift` → Input-Scope `(data.locationId, data.area)`.
- `delete`/`updateStatus`/`updateSkill` → Schicht **vor** dem Permission-Check laden (Pre-Load), dann gegen `(snap.location_id, snap.area)`.
- `moveRosterShift` → Quelle **und** Ziel: bei Bereichswechsel zusätzlich `assertPermission(snap.location_id, data.area)`.

DB-Test `roster-scope-p2.db.test.ts` deckt die Matrix ab (Planer create scoped ok/abgelehnt; „ohne area" abgelehnt = kein globaler Default; move kitchen→service Ziel abgelehnt; Manager-Regression).

### P-3a — Verwaltung + Zugang

- Rolle `planer` in der Rollen-Auswahl des Mitarbeiter-Stammblatts.
- area-Dimension im Berechtigungen-Tab (`PermissionsTab` + `setPermissionOverride`/`getStaffPermissions`): Standort **und** Bereich frei kombinierbar. **Kritisch:** das delete+insert-Upsert trifft area-genau (`data.area ? .eq("area") : .is("area", null)`) — ein (Standort, Küche)-Override reißt den (Standort, Service)-Override nicht mehr mit. DB-Test `permission-override-area.db.test.ts` beweist die Koexistenz.
- `admin/route.tsx`: `planer` darf ins Admin-Layout, aber **nur** `/admin/dienstplan` (Vorbild: `payroll` → `/admin/zeit-uebersicht`); Nav zeigt dem Planer nur den Dienstplan.

### P-3b — Fundament (UI-Spiegelung der Durchsetzung)

- Server-Fn **`getMyRosterScopes`**: prüft pro `(Standort × {kitchen,service})` via `has_permission` (mit dem **Caller**-Client, nicht `supabaseAdmin`) und liefert die schreibbaren Kombis. Für Admin/Manager automatisch alle, für Planer nur die Freigaben — das Frontend braucht **keine** Rollen-Sonderfälle.
- Reine Fns `allowedLocations`/`canEditScope` (`scope-util.ts`, unit-getestet).
- `dienstplan.tsx`: Standort-Auswahl auf erlaubte Standorte gefiltert (LocationPills + Default-Standort lösen sich automatisch); `canEdit = canEditScope(scopes, effectiveLocationId, activeArea)` — weil das Grid tab-/einzelstandort-basiert ist, greift damit jeder bestehende `if (!canEdit …)`-Gate korrekt: **sieht alles, malt nur den freigegebenen Bereich**.
- Login-Redirect: `planer` landet direkt auf `/admin/dienstplan` (kein Hub-Umweg).

### P-3c (Mehr-Standort-Ansicht) — bewusst **verworfen**

Eine gestapelte „beide Küchen auf einen Blick"-Ansicht (Multiblock) wurde geplant (P-3c-1 Vorbereitung gebaut), dann **zurückgebaut** (`e85943f` = bit-identisch zum P-3b-Zustand): zu verschachtelt (Cross-Block-Move, Freigabe pro Block). SUMITR nutzt die bestehende Umschalter-/Tab-Ansicht aus P-3b (Standortwechsel per Klick, nur erlaubte Standorte).

### Seitenrollen-Fixes (Folge von „Planer erbt keine staff-Rechte")

Functions mit `loadAdminCaller(…, "staff")` (String = `assertMinRole`, „mindestens staff-Rang") schließen `planer` (RANK 0) aus. An den Self-Service-Stellen, die ein Planer nutzen können soll, auf Array-Form `["admin","manager","staff","planer"]` umgestellt: **EasyOrder** (`getMyEasyOrderContext`/`getEasyOrderCatalog`/`placeEasyOrder`), **payslips** (`listMyPayslips` + Signed-URL), **wine-quiz** (Score speichern/lesen). Verwaltungs-Functions (`loadAdminCaller(…, "admin")`) bleiben für `planer` gesperrt. Zentrale Staff-Functions (Stempeln, Self-Service, Kasse) nutzen `loadStaffCaller` (rollen-agnostisch) — dort war nichts zu ändern.

### Auth-Feinschliff (Nebenarbeit)

`auth-attacher.ts`: abgelaufene/geleerte Session ohne Token leitet hart auf `/auth` (statt unverständlichem 401). Greift nicht im PIN-Login (läuft auf `/auth`, dort vom Redirect ausgenommen).

### Lektionen

- **Seitenrolle ⇒ keine `staff`-Vererbung.** Eine neue Seitenrolle (RANK 0) bricht jede Function, die per `loadAdminCaller(…, "staff")` (= `assertMinRole`) gated ist. Beim Einführen einer Seitenrolle für eine bisherige `staff`-Person systematisch alle solchen Gates prüfen. `loadStaffCaller` (kein Rollen-Filter) ist davon nicht betroffen.
- **Scope-Check immer gegen DB-Werte der Schicht** (Pre-Load), nie gegen `null`, nie gegen Client-Input.
- **`has_permission` 2-arg/3-arg-Koexistenz** via Delegation hält bestehende RLS-Policies gültig — neue Signatur additiv, alte delegiert.

## 26. Rolle „Planer" — Nachträge nach Live-Test (30.06.2026)

Befunde und Erweiterungen aus dem ersten Live-Test von SUMITR (erster Planer, Küche Spicery + YUM). Ergänzt §25. Verifizierter Stand HEAD `0824bcd` (tsc 0, eslint 0, vitest 943).

### a) Stammdaten-Lese-Functions für `planer` nachgezogen

§25/P-3b gab `planer` Zugriff auf `getMyRosterScopes` und die Roster-Daten-Functions (`READ_ROLES`), übersah aber die **generischen** Lese-Functions, die die Dienstplan-Seite zum **Initialladen** braucht. Folge: SUMITRs Dienstplan brach mit „Keine Periode angelegt", „(Read-only)" und App-Fehler.

Behoben — `planer` zu drei Functions ergänzt (reine Lesezugriffe): `listLocations`, `listPeriods` (je `"planer"` in die Rollen-Liste), `listSkills` (String-Gate `"manager"` → Array `["manager", "admin", "planer"]`).

**Lektion (zu §25):** Eine neue Seitenrolle braucht nicht nur die **fachspezifischen** Functions (roster), sondern auch die **generischen Stammdaten-Lese-Functions**, die die Seite beim Laden aufruft (Standorte, Perioden, Skills). Beim Freischalten einer Rolle die **komplette** Query-Liste der Seite durchgehen.

### b) „Vorschau als" (Impersonation) spiegelt Seitenrollen nicht sauber

Der Live-Test über **„Vorschau als SUMITR"** (Admin-Impersonation, `admin_impersonations`) schlug fehl, obwohl der Planer-Code korrekt ist. Über **echten PIN-Login** funktioniert alles.

Ursache: Während einer Impersonation lösen die DB-Helfer (`current_role`, `_effective_user_id`, RLS) die Identität über `admin_impersonations` auf den **Mitarbeiter** auf — `loadAdminCaller` nimmt aber weiter `context.userId` = **echter Admin**. `getMyIdentity` ist impersonation-bewusst, `loadAdminCaller` nicht → bei einer scoped Seitenrolle laufen die Ebenen auseinander.

**Merkpunkt:** Seitenrollen (planer, payroll) über **echten Login** verifizieren, nicht über „Vorschau als". Kein Produktions-Blocker. **Offen (zurückgestellt):** `loadAdminCaller` impersonation-bewusst machen (analog `getMyIdentity`).

### c) Abwesenheits-Durchsetzung scoped (P-2-Lücke geschlossen)

P-2 hatte nur `roster.shift.manage` für die fünf Schicht-Functions scoped; die **Abwesenheits**-Functions blieben offen. Nachgezogen: `setAbsence`, `clearAbsence`, `setAbsenceRange` setzen jetzt `roster.absence.manage` scoped durch.

Mechanik: Eine Abwesenheit gilt einem **Mitarbeiter** (nicht einer Schicht), hat also keinen eigenen (Standort, Bereich). Neue Helfer-Fn `resolveAllowedStaffScope(staffId, perm)` lädt die `staff_locations` des betroffenen Mitarbeiters und gibt den ersten `(location, area)` zurück, in dem der **Caller** das Recht hat (`has_permission` im Caller-Client, `staff_locations` RLS-frei via `supabaseAdmin`). Dieser Scope geht in `runWithPermission` — findet sich keiner (`{null, null}`), wirft es für den Planer (Admin/Manager bleiben global true).

**Praxis-Hinweis:** `planer` hat per Default **nur** `view`-Rechte für Abwesenheiten, **kein** `roster.absence.manage`. Soll ein Planer Abwesenheiten verwalten, braucht er dafür **eigene Overrides** (Standort+Bereich), analog zum `roster.shift.manage`-Setup. Ohne diese Overrides plant er nur Schichten — Abwesenheiten werden serverseitig abgelehnt (gewolltes Verhalten, sofern keine Override gesetzt).

### d) Bereich-Tabs auf erlaubte Bereiche beschränkt (`visibleAreas`)

Statt dem Planer beide Tabs (Küche/Service) zu zeigen und Service nur read-only zu halten (P-3b), zeigt der Dienstplan jetzt **nur die Bereiche, in denen der Planer am aktuellen Standort einen Scope hat**. `dienstplan.tsx` leitet `visibleAreas` aus `scopes` (für `effectiveLocationId`) ab; `RosterGrid` rendert nur die zugehörigen `TabsTrigger`. Ein `useEffect` schaltet `activeArea` auf den ersten sichtbaren Bereich um, falls der aktive ausgeblendet wird. Für Admin/Manager (keine spezifischen Scopes, globaler Default) bleiben beide Tabs sichtbar.

### e) Bereich-Freigabe: optimistisches Cache-Update

Der Freigabe-Toggle (`AreaReleaseControl`, „Plan freigeben") aktualisiert den `roster-release`-Cache jetzt optimistisch via `setQueryData` (vorher nur `invalidateQueries`) und invalidiert danach. Das korrigiert einen Anzeige-Abbruch beim Umschalten der Freigabe.

### f) Ist-Zustand SUMITR (Live, 30.06.2026)

SUMITR ist als erster (und bislang einziger) `planer` produktiv. Setup per SQL in der **COCO-DB**: Rolle `planer` (`role_assignments`) + vier `permission_overrides`, alle `effect='allow'`:

- `roster.shift.manage` — Spicery/Küche, YUM/Küche
- `roster.absence.manage` — Spicery/Küche, YUM/Küche

Damit plant SUMITR Schichten **und** verwaltet Abwesenheiten für Küchen-Mitarbeiter in Spicery + YUM. Die Bereich-Tabs zeigen ihm nur „Küche" (§26.d); andere Standorte/Bereiche bleiben read-only. **Verifiziert über echten PIN-Login** (nicht „Vorschau als" — §26.b). Soll ein weiterer Bereich/Standort dazukommen, je ein zusätzliches `allow`-Override pro `(Standort, Bereich)` und Permission setzen.

## 27. Trinkgeld-Pool — Arbeitszeit-Herleitung: Küche fest, Service aus Abgabe („Ablauf B") (01.07.2026)

Präzisiert §21 (Plan-Snapshot) und §23 (Pool-Zeiten → `time_entries`). Die Pool-Stunden je Mitarbeiter stammen aus einer von drei Quellen: (a) Ist-Stempelzeiten (`time_entries`), (b) manuelle Einträge, (c) Dienstplan-Snapshot mit **festen Abteilungs-Zeiten** aus `location_department_defaults` (`default_checkin`/`default_checkout` je Standort + Abteilung). „Aus Dienstplan ergänzen" nutzt (c).

### Live-Befund (30.06./01.07.): alle 0,00 Stunden

Ursache: Die Spalte `default_checkout` wurde erst am 30.06. neu angelegt und war für die Standorte leer (NULL). Der Snapshot verlangte pro Abteilung **beide** Zeiten — fehlte checkout, wurden `shift_start` **und** `shift_end` auf NULL gesetzt, und der B-2-Writeback (§23, `buildPoolTimeEntryRows`, Regel 1 „beides nötig") übersprang die Zeile. Ergebnis: 0,00, „manuell".

### Küche — feste Zeiten

Die Küche läuft über feste Defaults: `default_checkin` 15:00 (geseedet), `default_checkout` **23:30** ist unter `/admin/standortzeiten` (admin) je Standort einzutragen. Der Modus „Küchentrinkgeld manuell verteilen" (`kitchenManualOnly`, §21) ignoriert die Küchen-**Stempel** — die Zeiten kommen dann synthetisch aus den Defaults, nicht aus der Stempeluhr.

### Service — variables Ende aus der Abrechnungsabgabe („Ablauf B")

Kellner stempeln **nicht** ein. Der Snapshot setzt für `department='service'` nur noch `shift_start` = `default_checkin` (16:00); `shift_end` bleibt **offen** (checkout wird für Service NICHT benötigt). Küche/GL unverändert (Küche braucht beide, GL manuell/0).

Bei der Abrechnungsabgabe (`submitWaiterSettlement`) setzt `applyServicePoolEnd` das `shift_end` des abgebenden Service-Kellners aus dem **Abgabezeitpunkt**:

- **Stempler** (offener Eintrag vorhanden): Ende = tatsächliche Ausstempelzeit (`performClockOut`).
- **Nicht-Stempler**: Ende = Zeitpunkt der Abgabe.
- Nur wenn `shift_end` noch NULL ist (manuell gesetzte Enden bleiben).

Die reine Fn `resolveServicePoolEnd` (`src/lib/cash/service-pool-end.ts`, getestet) rechnet Berlin-lokal mit 3-Uhr-Geschäftstag-Cutoff: Ende ≥ Start → `dayOffset 0`; Ende < Start und < 03:00 → `dayOffset 1` (Wrap über Mitternacht); Ende < Start und ≥ 03:00 → `null` (Abgabe vor Schichtbeginn, kein Eintrag). Danach greift der bestehende B-2-Writeback (§23) und erzeugt den `time_entry (source='pool')` mit 16:00–Abgabe.

**Ehrlichkeitsregel:** `resolveServicePoolEnd`/`applyServicePoolEnd` **ersetzen** die frühere `syncServicePoolEndFromAutoClockout`, die an ein festes `default_checkout` gebunden war. Für Service gibt es kein festes Ende mehr.

### Verwaltung

`/admin/standortzeiten` (admin-only) pflegt `default_checkin`/`default_checkout` je Standort + Abteilung. Für Küche beide setzen (15:00/23:30); für Service reicht `default_checkin` (16:00).

### Zeiten korrigieren (Pool-Ansicht)

Die Pool-Tabelle (`TipPoolCard`, Zeilen-Komponente `PoolRow`) zeigt pro Mitarbeiter **Anfang** und **Ende** und lässt sie direkt korrigieren. Zeit-Felder sind editierbar bei Service-Zeilen (immer) und Küchen-Zeilen im Manuell-Modus (`kitchenManualOnly`); im Küchen-Stempel-Modus sind Anfang/Ende read-only. Die Stunden aktualisieren sich live aus Anfang/Ende (`kitchenShiftMinutes`); gespeichert wird pro Zeile per Button über `upsertSessionTipPoolEntry` (manager+, `assertCashWritable`, Audit). Gesperrte/finalisierte Tage bleiben schreibgeschützt. GL behält seinen eigenen Abschnitt (`GlRow`); die Anteils-/Geldberechnung ist unberührt.

### Übertrag in die Zeiterfassung (laufender Sync)

Jede Änderung einer Pool-Zeit hält den zugehörigen `time_entries`-Eintrag (`source='pool'`, `import_key = pool:<entryId>`) synchron — Grundlage für die spätere Lohnauswertung. `syncPoolTimeEntry` läuft an **beiden** Stellen: beim manuellen Speichern (`upsertSessionTipPoolEntryCore`) und bei der Abrechnungsabgabe (`submitWaiterSettlement` — ersetzt den früheren nur-erzeugenden Writeback aus §23).

Die reine Fn `resolvePoolTimeEntrySync` entscheidet: echter Stempel (`clock`/`manual`/`import`) am Tag → **delete** (Stempel gewinnt, keine Doppelzählung); Zeit unvollständig oder zurückgenommen → **delete**; sonst **upsert** — **aktualisierend** (kein `ignoreDuplicates`), mit `crossesMidnight` für Schichten über Mitternacht. Das Löschen ist dreifach gescoped (`organization_id` + `import_key` + `source='pool'`); echte Stempel werden nie angetastet. Best-effort: ein Sync-Fehler kippt weder Abgabe noch Korrektur (nur Log). Getestet inkl. Mitternachts-Wrap und DST-Wechsel (26.10.).

**Praxis:** Für bereits abgerechnete Tage ohne übertragene Zeiten (z. B. YUM vor dem Ablauf-B-Stand) die Zeiten einmal neu speichern — das löst den Sync aus.

## 28. Session wieder öffnen + Datumswähler (01.07.2026)

**`reopenSession`** (`cash.functions.ts`, admin-only via `loadAdminCaller(…, "admin")` + `runGuarded(…, "admin")`): öffnet eine **abgeschlossene** Session wieder (`status='open'`, `finalized_at`/`finalized_by` → NULL). Guards: nur `finalized` (offene und `locked` werden abgelehnt); Wasserlinie via `assertCashWritable` (`cashLockedThroughDate`) — ein gesperrter Geschäftstag bleibt gesperrt, auch für Admins. Audit-Action `cash.session.reopened`.

**Datumswähler** in `kasse.tsx`: vergangene Geschäftstage ansehen (Grundlage für Korrekturen via `reopenSession`).

## 29. Kalender-Abo für Dienstplan-Schichten (Schritt 1: Backend, 01.07.2026)

Mitarbeiter können ihre eingeteilten Schichten (`roster_shifts`) als iCalendar-Feed im Handy-Kalender abonnieren — iPhone **und** Android/Google (`.ics` ist ein universeller Standard). Persönliche, widerrufbare Abo-URL; der Kalender pollt periodisch und aktualisiert die Schichten selbst.

### Token

Über das bestehende `access_tokens`-System: neuer `token_type`-Enum-Wert `calendar_feed` (`ALTER TYPE … ADD VALUE IF NOT EXISTS`). Ein Abo-Token = Zeile mit `staff_id`, `expires_at=NULL` (dauerhaft), `used_at=NULL` (aktiv; Widerruf setzt `used_at`). Erzeugt per `generateBadgeToken` (32 Byte CSPRNG, base64url).

### Öffentliche Feed-Route

`src/routes/api/public/calendar.$token.ts` → `/api/public/calendar/<token>[.ics]` (der `/api/public/*`-Präfix bypasst die Publishing-Auth; Muster: Display-Route). Sicherheit: timing-sichere Token-Prüfung (`safeCompare` + `used_at IS NULL` + `expires_at`), generisches `404` bei jedem Fehler, Datenzugriff **doppelt gescoped** (`organization_id` + `staff_id` → nur die eigenen Schichten, kein Fremd-Leck), Token nie geloggt. Antwort `Content-Type: text/calendar`. Fenster: `heute-30 … heute+120`.

### Zeit-Modell

`roster_shifts` haben keine Uhrzeiten — die Zeiten kommen aus `location_department_defaults` je `(location, area)`: `default_checkin` **und** `default_checkout` gesetzt → zeitliches Event (`checkout < checkin` → Ende Folgetag, Mitternachts-Wrap); sonst Ganztags-Event. Für Service ist `default_checkout` eine reine **Kalender-Anzeige** (die echte Arbeitszeit bleibt via Ablauf B unberührt, §27). Lokale Zeit → UTC via `poolLocalTimeToIso` (DST-korrekt). Titel = Bereich-Label + ggf. `· <Skill>`, Ort = Standortname.

### Reine Fn + Self-Service

`buildRosterIcs` (`src/lib/calendar/roster-ics.ts`, getestet): RFC-5545-Escaping, stabile `UID` (`roster-<shiftId>@coco` → Updates/Löschungen ziehen mit), UTC-Basic / `VALUE=DATE`-Fallback. Server-Fns `getOrCreateMyCalendarToken`/`revokeMyCalendarToken` (`loadCallerLink` → `staffId` aus `auth.uid`).

### Schritt 2 (UI, umgesetzt)

Seite `/zeit/kalender` (Kachel „Kalender-Abo" im `/zeit`-Hub): holt den Token via `getOrCreateMyCalendarToken`, baut `httpsUrl = window.location.origin + feedPath` und `webcalUrl` (Schema `https`→`webcal`). „Im Kalender öffnen" (`<a href={webcalUrl}>`, öffnet den iPhone-Abo-Dialog), Kopierfeld mit der https-URL (für Android/Google Kalender), Klapp-Anleitung iPhone/Android, Geheim-Hinweis, Widerruf („Link zurückziehen & neuen erstellen" → `revokeMyCalendarToken` + `invalidateQueries`/`refetch` → neuer Token, neue URL). Kein `localStorage`.

### Betrieb

Voraussetzung für zeitliche Service-Events: `default_checkout` für Service unter `/admin/standortzeiten` eintragen (sonst ganztägig; Küche zeigt 15:00–23:30, sobald die Auscheckzeit dort steht). Android: URL-Abo geht bei Google nur am Computer (calendar.google.com → „Per URL"), nicht in der Handy-App — daher der Kopier-Weg auf der Seite.

## 30. Session-Eröffnung: ausschließlich durch Manager/Admin (02.07.2026)

Kassen-Sessions werden **nur** von Manager/Admin eröffnet — über den „Session anlegen"-Button in `/admin/kasse` (Fn `getOrCreateOpenSession`, `manager`-gated via `loadAdminCaller` + `runGuarded`; legt die Session an und erzeugt den Trinkgeld-Pool-Snapshot über `ensureOpenSessionRaw`). Kellner öffnen nichts selbst: `/zeit/abrechnung` zeigt bei fehlender Session eine read-only Hinweiskarte („… für den Geschäftstag wurde noch keine Session eröffnet, bitte an Manager/Admin wenden"). Sobald die Session existiert, rechnen die Kellner normal ab.

**Betriebsablauf:** Manager/Admin öffnet je Standort einmal pro Geschäftstag die Session in `/admin/kasse` → „Session anlegen". Danach rechnen die Kellner dort ab.

**Bewusst verworfene Alternativen (nicht wieder einbauen):**

- **Kellner-Auto-Open** (`ensureMyOpenSession` + Auto-Retry-Loop in `abrechnung.tsx`): an „wer zuerst kommt" gekoppelt, fragil — entfernt.
- **Einteilungs-Regel** „nur wer als Service im Dienstplan steht, darf eröffnen" (`resolveSessionLocation` / `resolveMySessionLocation`, Service-Schicht-Pflicht): sperrte real arbeitende Kellner aus, wenn der Dienstplan nicht tagesaktuell gepflegt war, und verursachte Session-Filter-Kollisionen bei mehreren offenen Standort-Sessions — komplett zurückgebaut.
- **Täglicher Cron-Automatismus** (`ensureDailySessions` + Route `/api/public/cron-ensure-sessions` + Supabase `pg_cron`/`pg_net`): zu komplex und fragil (URL-/Secret-/Deploy-Abhängigkeiten) — Route und Fn gelöscht, `pg_cron`-Job entfernt (`cron.job` leer).

Grundsatz für die Zukunft: bewusster, sichtbarer Handgriff (Manager öffnet) vor implizitem Automatismus — bei Geld-/Zeit-Daten ist Nachvollziehbarkeit wichtiger als Bequemlichkeit.

## 31. Kassen-Abrechnung: Fixes + Partner-Verknüpfung (02.07.2026)

Drei Fehler in der Kassen-/Kellner-Abrechnung behoben (alle Gates grün, vitest 970).

### Abgleich zählt korrigierte Abrechnungen nicht mehr doppelt

`SettlementWarningsBanner.tsx` summierte für POS-/Terminal-Differenz **alle** `overview.settlements` — auch `superseded`-Zeilen. Nach einer Kellner-Korrektur wurde dadurch jeder Betrag doppelt gezählt (Original + Korrektur). Fix: nur `activeSettlements` (`status !== "superseded"`) fließen in die Warnung. Das Backend filterte superseded bereits überall; nur dieser Frontend-Banner nicht.

### Mehrere Kellner pro Abrechnung — Verknüpfungstabelle `settlement_partners`

Die Kellner-Abgabe speicherte mitarbeitende Kellner ursprünglich nur als Text (`second_waiter_name`) — sie erschienen nicht als Paar und mussten manuell nachkorrigiert werden. Nach einem Zwischenschritt (einzelnes `partner_staff_id`) gilt jetzt das finale Modell, weil im Betrieb auch **alle** Kellner zusammen abrechnen können: **ein** Kellner gibt für die ganze Gruppe ab (Gesamt-Umsatz) und wählt **beliebig viele** Beteiligte.

- **Datenmodell:** Tabelle `settlement_partners` (`settlement_id` ↔ `staff_id`, unique, FK cascade; RLS: org-scoped SELECT, Schreiben nur serverseitig/`service_role`). Backfill hat bestehende `partner_staff_id`-Paare übernommen. Die Alt-Spalten `partner_staff_id`/`second_waiter_name`/`additional_waiters` bleiben für Alt-Daten, werden **nicht mehr geschrieben**.
- **Backend:** `submitWaiterSettlementCore`/`correctWaiterSettlement` nehmen `partnerStaffIds: string[]`; je ID validiert (≠ Haupt-Kellner, `assertStaffBoundToLocation`, Kollisions-Check `assertPartnersFree` über **beide** Quellen: `waiter_settlements` und `settlement_partners` aktiver Abrechnungen, `excludeSettlementId` für den Korrektur-Pfad). Anzeige `staffName` = „A + B + C" aus `settlement_partners`, `partnerStaffNames: string[]`.
- **UI:** dynamische Liste von `SecondWaiterSelect` („+ weiterer Kellner", Entfernen je Zeile), jede Auswahl schließt Haupt-Kellner und bereits gewählte aus. Badge: 1 Partner = „Paar", mehrere = „Gruppe".
- **Zweck der Verknüpfung:** Anzeige + Schutz vor Doppel-Abrechnung. Die **Trinkgeld-Verteilung ist unabhängig davon** — sie läuft über Arbeitszeit/`session_tip_pool_entries` (§27).

### Kassen-Eingabefelder springen nicht mehr

`SessionFieldsCard.tsx`: Der Reset-`useEffect` hing an `[overview]` und überschrieb bei **jedem** Auto-Save-Refetch die laufende Eingabe (Terminal-Beträge u. a. „sprangen" beim Tippen). Fix: Dependency `[overview.session?.id]` — Reset nur bei echtem Session-Wechsel (Standort/Tag/neu geöffnete Session), nicht bei Refetch derselben Session. Betrifft alle Felder der Karte.

### Offen / bekannt: Kellner tragen „Karte" ≈ Umsatz statt Kartenanteil

Live-Befund YUM 01.07.: Beide Kellner hatten den Kartenbetrag ≈ Gesamtumsatz eingetragen (Karte teils > Umsatz), statt nur den tatsächlichen Kartenanteil. Echte Kartensumme = Terminals (2.107,79 €); Differenz war reine Fehleingabe, kein Code-Fehler (die Korrektur übernahm die Werte 1:1). To-do Frank: betroffene Abrechnungen per Korrektur anpassen (Karte runter, Bargeld rauf, Summe bleibt). Prävention (offen, optional): klarerer Hinweis am „Karte"-Feld („nur Kartenanteil") + Warnung bei Karte > Umsatz.

Ferner: Auth-Redirect-Flow direkt in Lovable gefixt (`f8d41ad`).

## 32. D3-Display: Zebra, Legende, Symbol-Vereinheitlichung (02.07.2026)

- **Zebra im Grid:** Grid-Zellen tragen jetzt `bg-slate-950` + `group-even/row:bg-slate-800/70` — der Zeilenwechsel ist so deutlich wie in den Namensspalten. Wochenend- und Heute-Markierung sind als `ring-inset` (Rahmen) statt konkurrierender `bg`-Klasse umgesetzt, damit sie den Zebra nicht überdecken (Tailwind-`bg`-Klassen gleicher Spezifität verdrängen sich sonst gegenseitig).
- **Legende = echte Symbole:** Footer in drei Gruppen — Küche (`VS` Vorspeise · `PA` Pass · `SP` Spülen · `CO` Kochen), Service (`X` Service · `GL` Geschäftsleitung · `B` Bar · `19h` · `H` Hausmeister), Status (`−` Frei · Umbrella grün Urlaub · HeartPulse rot Krank · Heart lila Wunsch-frei). Die Status-Einträge nutzen die **echten Lucide-Icons in den Grid-Farben** (green-/red-/purple-400), kein Unicode.
- **„Verfügbar" zusammengelegt:** Der Zell-Zustand `available` rendert nicht mehr `○`, sondern `−` wie „Frei" — ein Symbol für beides; „Verfügbar" ist aus Grid und Legende entfernt (Darstellung; Datenmodell unverändert).
- Randnotiz: Spicery-Display-Settings per Direkt-Migration an YUM angeglichen (`custom_message`, `rotation_interval_seconds`).

## 33. Geld-Regel: GL-Kartenzahlungen mindern das Tages-Bargeld NICHT (02.07.2026)

**Live-Befund (Parallelbetrieb, 01.07.):** COCO und die produktive tagesabrechnung zeigten für denselben Tag abweichende Ergebnisse — Tages-Bargeld −409,03 € vs. −384,23 €, Wechselgeldbestand 675,56 € vs. 700,36 €. Differenz exakt 24,80 € = „Kredit Karten GL". Alle übrigen Eingaben und der Vortags-Fehlbetrag waren identisch; die Formeln (`computeDailyCash`, `computeWechselgeld` — Golden-Master-Portierung) korrekt.

**Regel (Referenz Legacy-tagesabrechnung):** In den Kartenabzug des Tages-Bargelds fließen **nur physische Terminals** (Terminal 1 + 2). GL-Kartenzahlungen (`payment_terminals.is_gl = true`) sind ein **Kontrollposten** — sie gehören in den Terminal-Abgleich („Σ Terminals = Kellner-Karten + GL", §31), mindern aber das Bargeld nicht.

**Umsetzung:** Beide Ladestellen der Aggregation joinen `payment_terminals!inner(is_gl)` und überspringen GL-Zeilen beim Summieren; reine, getestete Helper-Fn `sumNonGlTerminalCents` (`session-channels.ts`). **Verifikation:** COCO zeigt für 01.07. exakt die tagesabrechnung-Werte (Tages-Bargeld −384,23 €, Wechselgeldbestand 700,36 €).

**Lektion:** Der Parallelbetrieb gegen die Legacy-Referenz ist der wirksamste Abgleich — Cent-Differenzen dort sofort ausermitteln, nicht wegerklären.

**Nachzug 03.07.:** Dritter Pfad gefunden (Live-Differenz 27,80 € Spicery) — der client-seitige KONTROLLE-Block der Kassen-Eingabeseite (`CashSummaryBlock` via `SessionFieldsCard`) summierte ALLE Terminal-Formularzeilen inkl. GL; der `isGl`-Marker fehlte schon im Props-Typ. Fix: `cardDeductionFromTerminalRows` (pure, getestet) + `isGl` durch die Props-Kette. Server-Pfade (PDF/Verlauf/Tresor) waren korrekt — reiner Anzeige-Fehler, DB-Daten sauber. **Lektion:** Eine Geld-Regel hat so viele Fix-Stellen, wie es Rechenpfade gibt — bei Regel-Fixes IMMER alle Aufrufer der Größe suchen (grep nach dem Feldnamen), nicht nur die gemeldete Stelle.

**KGL-2 (04.07. spät):** Vierter Pfad — `src/lib/cash/pdfExport.ts` zog den §33-Fix nicht mit: `cardTerminalTotal` war ein roher `reduce` über ALLE `terminalAmounts` (inkl. GL). Folge: Tage mit GL-Eintrag druckten einen zu hohen Kartenabzug, PDF-Differenz und -Abzuliefern wichen vom Bildschirm ab. Fix: Join `terminalAmounts` ↔ `terminals.isGl` (Feld ergänzt in `PdfTerminal` + Aufrufer `admin/kasse.tsx`) und Summierung über `sumNonGlTerminalCents` (zentrale §33-Regel). Test `pdfExport-cardtotal.test.ts` erzwingt Bildschirm ≙ PDF. **Gemeldet, nicht still gefixt:** `src/lib/telegram/telegram-report.server.ts` (Z. 125) verwendet denselben rohen `reduce` — für den Tagesbericht des Crons wirkt der Bug identisch, ein separater Auftrag ist nötig. **Lektion (wiederholt und geschärft):** Bei Rechenregel-Fixes ALLE Konsumenten der Größe suchen (Bildschirm, PDF, Telegram, Exporte) — Aufrufer-Suche nach dem Feldnamen (`terminalAmounts`) ist Pflicht, nicht Kür.

**KGL-3 (05.07., vor dem ersten 07:05-Lauf):** Telegram-Tagesbericht (`src/lib/telegram/telegram-report.server.ts`) auf `sumNonGlTerminalCents` umgestellt — Join `ov.terminalAmounts` ↔ `payment_terminals.is_gl` je Standort, identisch zu PDF/Bildschirm. Test `telegram-report-cardtotal.test.ts` blockierend. Projektweite Konsumenten-Suche (`rg terminalAmounts`) abgeschlossen: `SettlementWarningsBanner` splittet GL/physisch bereits sauber, alle übrigen Fundstellen sind Typen/Tests/Persistenz — **§33 hat jetzt genau EINE Implementierung (`sumNonGlTerminalCents`) und N verifizierte Aufrufer** (Bildschirm `CashSummaryBlock`, PDF `pdfExport`, Telegram `telegram-report.server`).

## 34. Code-Audit Phase 1: toter Code & Dependencies (02.07.2026)

Werkzeuggestütztes Audit (knip 5, Entry-korrigiert für TanStack Start; npm audit; grep-Inventuren) über 431 Dateien / ~76k Zeilen. Gesamtbild: sehr sauber (0 `console.log`, 2 dokumentierte TODOs, keine Rollback-Reste).

### Behoben

- **`@dnd-kit/utilities`** stand nicht in `package.json`, wurde aber importiert (Dienstplan-Drag&Drop) — lief nur als transitive Dependency. Explizit aufgenommen (`^3.2.2`).
- **Toter Code entfernt:** `order-units.functions.ts` (M5-Rest, 0 Aufrufer) und der komplette **Badge-/QR-Login-Rest** aus B1c (`badges.functions.ts`, `resolveBadgeToken`, `activeBadges`-Zählung im Mitarbeiter-Index — nie mit UI verdrahtet; Entscheidung: Feature wird nicht weiterverfolgt). `@types/bcryptjs` entfernt (bcryptjs v3 bringt eigene Typen; `bcryptjs` selbst bleibt — PIN-Hashing).

### Bewusste Behalten-Entscheidungen (bei künftigen Audits NICHT erneut aufwerfen)

- **shadcn/ui-Vorrat** (`src/components/ui/*`, ~25 ungenutzte Komponenten + zugehörige Radix-Pakete): Standard-Lovable-Setup, Lovable greift beim UI-Bau darauf zu — bleibt.
- **`*Core`-/Helper-Export-Breite** (~50 „unused exports"): bewusste Konvention (reine/Core-Fns exportiert für Testbarkeit) — Feature, kein Schmutz.
- **knip-False-Positives:** `src/start.ts` (TanStack-Framework-Einstieg, lädt `auth-attacher` + `server-fn-error-logger` — alle lebendig), `tailwindcss`/`tw-animate-css` (via `src/styles.css` `@import`), `@tanstack/router-plugin` (Build-Kette).
- **`token-generator.ts` (`generateBadgeToken`)**: trotz Namens KEIN Badge-Rest — generischer CSPRNG-Generator, vom Kalender-Feed (§29) genutzt.
- **DB unangetastet:** Enum-Wert `token_type='badge_login'` und Alt-`access_tokens` bleiben (Enum-Rückbau riskant, ohne Nutzen).

### Offen / beobachten

- **npm audit:** 2× moderate via `exceljs`→`uuid` (GHSA-w5hq-g745-h8pq). Auto-Fix wäre Breaking-Downgrade → nicht angewendet; beobachten bis exceljs upstream fixt (Alternative: npm-`overrides`).
- Die 5 tolerierten `exhaustive-deps`-Warnings: weiterhin §8-Merkposten.
- **Phase 2 (DB-Audit):** RLS-Inventur + verwaiste Tabellen/Spalten per Diagnose-SQL. **Phase 3:** manuelles Review Geld-/Auth-Pfad. Beide ausstehend.

## 35. Code-Audit Phase 2: Live-DB-Inventur (02.07.2026)

Live-Inventur der COCO-DB (5 Diagnose-SQLs, CSV-verifiziert): Policies, Tabellen-Status, Referenzen, Trigger, Enums — abgeglichen gegen den Code.

### Ergebnis: DB in ausgezeichnetem Zustand

**0 anon-Policies · 0 Tabellen ohne RLS · 0 DB-Drift** (63 Live-Tabellen = exakt die 63 code-bekannten, trotz monatelanger Direkt-SQL-Arbeit) · 33 Trigger ausnahmslos Standard-Muster (updated_at/Seeds), keine Rollback-Reste · Enums decken sich mit dem Code. Die RLS-Helper sind quicklebendig: `has_min_permission` (30 Policies), `is_admin` (22), `current_staff_id` (13), `is_real_admin` (4), `_effective_user_id` (5 Function-Bodies).

### Zurückgebaut (Migration `20260702152005`)

- **Bestelleinheiten-Anschluss komplett entfernt** (Entscheidung Frank): `articles.order_unit_id` (Spalte + FK), Tabelle `order_units` (leer, count=0 live geprüft; ihre 4 Policies fielen mit) sowie `orderUnitId` aus `articles.functions.ts`/`bestellung.wein.tsx`. Begründung: nie fertiggestellt (Verwaltungs-Code war der Phase-1-Fund ohne Aufrufer), seit M5-Go-live mit 1.335 Artikeln nie befüllt; `articles.unit` + `articles.packaging_unit` sind die gelebten Einheiten-Felder.
- **Zwei referenzlose DB-Functions gedropt:** `effective_permissions(uuid)`, `has_role(app_role)`.

### Bewusste RLS-Ausnahmen (bei künftigen Audits NICHT erneut aufwerfen)

- **`permission_role_defaults` mit `USING (true)` für `authenticated`** — das einzige Flag der Inventur: globaler Berechtigungs-Katalog (nur `role`/`permission`/effect, keine `organization_id`, keine Personen-/Org-Daten) → Lesen für alle Angemeldeten ist korrekt. Dies ist die dokumentierte Ausnahme zum §7-Gesetz.
- **Zwanzig gewollte deny-all-Tabellen** (0 Client-Policies, Zugriff nur serverseitig/service_role): `access_tokens`, `article_locations`, `audit_log`, `document_templates`, `generated_documents`, `location_calendar_exceptions`, `location_rest_days`, `pin_attempts`, `recipe_items`, `recipes`, `roster_releases`, `sales_articles`, `shift_swap_declines`, `shift_swap_requests`, `sofortmeldung`, `staff_data_change_requests`, `staff_documents`, `staff_pins`, `supplier_locations`, `task_photos`.
- **`generate_order_number` LEBT** — Spalten-DEFAULT von `orders.order_number` (Bestellnummern ORD-JJJJ-MM-nnnn). Nie droppen.

**ADV1 (06.07.2026) — Supabase-Advisor-Bewertung:** Alle 29 Advisor-Meldungen (13 WARN, 16 INFO) gegen die Architektur geprüft. Ergebnis: 25 von 29 sind Absicht — die 16 „RLS enabled, no policy"-INFOs sind das deny-all-Hausmuster (Policies anlegen würde die Tabellen ÖFFNEN — Advisor-Vorschlägen hier NIE folgen); 9 WARNs zu authenticated-aufrufbaren SECURITY-DEFINER-Helfern (`has_permission`, `is_admin`, `current_*` …) sind bewusste Grants der Härtung vom 01.07. — 154 RLS-Policy-Stellen und die PL1/PL2-Scope-Auflösung hängen daran, Revoke würde RLS und Jahresplaner brechen. Behoben: Trigger-Funktion `tg_inventory_items_assert_open` für `public`/`anon`/`authenticated` revoked (Migration + Live-DB verifiziert: nur `postgres`/`service_role`). Frank-seitig: HIBP-Passwortschutz im Auth-Dashboard aktiviert (offene Aufgabe aus der 01.07.-Migration). Bekannt/kosmetisch: `pg_net` im `public`-Schema bleibt. Regel für künftige Advisor-Läufe: Meldungen erst gegen deny-all-Inventur und Grant-Absichten prüfen, nie blind remediieren.

### Audit-Lektion (Methodik)

Der Referenz-Check prüfte Policies, Function-Bodies und Trigger — aber **nicht Spalten-DEFAULTs**: `generate_order_number` war dadurch fälschlich als referenzlos eingestuft; der DROP scheiterte sauber (transaktionaler Rollback, Lovable stoppte korrekt ohne CASCADE). **Regel: DB-Referenz-Checks müssen auch `pg_attrdef` (Spalten-DEFAULTs), Views und Constraints einschließen.** Und: `drop function` bei Überladungen immer mit expliziter Signatur.

### Offen

Phase 3 (manuelles Review Geld-/Auth-Pfad) — letzter Audit-Teil.

## 36. Code-Audit Phase 3: manuelles Review Geld-/Auth-Pfad (02.07.2026)

Abschluss des dreiteiligen Audits (§34 Code, §35 DB). Geprüft: Auth-Kern (PIN-/Passwort-Login,
Shadow-User, requireSupabaseAuth, loadAdminCaller/runGuarded/runWithPermission, Impersonation,
Kalender-Token + öffentliche Feed-Route, Payslip-Storage) und Geld-Pfad (alle Kassen-ServerFns,
Settlement-Rechenkern, Trinkgeld-Pool, Superseded-Logik, EasyOrder/Orders, Lohn-Functions).

### Bestätigt

- Genau EINE ServerFn ohne Auth-Middleware im gesamten Repo: `validatePin` (dokumentiert öffentlich).
- Alle Geld-Schreibpfade: loadAdminCaller → runGuarded → loadSessionWithLock → assertCashWritable,
  Org-Scope auf jedem Query. staffId in Staff-Flows nie vom Client.
- Geld durchgängig Integer-Cents (Zod `.int()` + `Number.isInteger`-Härtung im Rechenkern),
  Rundung Half-Away-From-Zero, getestet. `superseded` an allen Lesestellen ausgeschlossen.
- Impersonation über `is_real_admin` (nicht `is_admin`), org-gescoped, auditiert.
- Kalender-Feed: timing-safe Vergleich, generisch 404.

### Behoben

- Passwort-Fallback in `validatePin` hatte KEIN App-Rate-Limit (nur der PIN-Zweig): jetzt gleiches
  5-in-15-Min-Fenster + `pin_attempts`-Logging für beide Credential-Typen
  (`isCredentialAttemptAllowed` in pin-validation.ts).
- `isPayslipPathAllowed` weist jetzt `..`/`\` ab (Defense-in-Depth; Storage-Keys sind literal,
  praktisch war es nicht ausnutzbar).

### Bewusste Akzeptanz (bei künftigen Audits NICHT erneut aufwerfen)

- **Klartext-Tokens in `access_tokens`** (calendar_feed, display): Tabelle ist deny-all/
  service-role-only; Hashing brächte nur bei einem DB-Dump-Leak Schutz. §29-Designentscheidung.
- **`listStaffForImpersonation` listet auch inaktive Mitarbeiter** — reines UX-Thema, der Start
  blockt Accountlose; keine Sicherheitsrelevanz.

## 37. Kassen-Reset + Re-Import „Cleaning Cut" (02.07.2026)

Kompletter Reset aller COCO-Kassen-/Abrechnungs-/Trinkgelddaten inkl. Tresor und
Neuimport aus tagesabrechnung (LIVE-Quelle). Grund: Test-Abrechnungen mit falschen
Zahlen (Experimente ab 16.05.) hatten die Kassendaten verunreinigt. Zugleich war
dies die Generalprobe für den Go-live-Re-Import nach der §5-Methode.

### Ablauf (wiederverwendbar für den Go-live-Import)

1. **Export zuerst** (tagesabrechnung, nur SELECT): sessions, waiter_shifts,
   kitchen_shifts komplett als CSV — Sicherung VOR jeder Löschung.
2. **Diagnose** (COCO): Bestand aller Kassen-Tabellen, time_entries nach source,
   Wasserlinie. Ergebnis: keine `pool`-/`manual`-Einträge vorhanden → Löschung
   lohnseitig unkritisch (edlohn-abgeglichene Perioden Mai/Juni unberührt).
3. **Löschen** (COCO): FK-geordnet in einer Transaktion (settlement_partners →
   waiter_settlements → session\_\* -Kinder → sessions → time_entries source='pool'),
   org-gescoped, Rest-Check im SELBEN Editor-Lauf (alle 12 Tabellen = 0).
4. **Import** (COCO, §5-Methode): Mapping-Check als Pflicht-Gate (Q1 muss leer
   sein) → Sessions → Kanäle/Terminals → Settlements → Tip-Pool in Batches →
   Abschluss-Abgleich mit eingebetteten Soll-Zahlen je Monat × Standort.

### Endstand (verifiziert, Ist = Soll)

sessions 271 · waiter_settlements 872 · session_tip_pool_entries 2363 ·
session_channel_amounts 646 · session_terminal_amounts 592.
Zeitraum: 16.02.–01.07.2026 (YUM + Spicery).

### Lektionen / Regeln für den Go-live-Re-Import

- **Laufenden Geschäftstag NIE importieren** (Stichtag = gestern): der offene Tag
  der Quelle würde als leere Hülle landen und wäre durch `WHERE NOT EXISTS` beim
  nächsten Import blockiert (§5-Hüllen-Falle).
- **Namens-Overrides Kasse** (Quelle → COCO display_name): GUNC→GUNG,
  PAE→SUMITR, jirawut.saechiang→COCO, **KRIS→KRISS** (Quelle schrieb dieselbe
  Person in zwei Schreibweisen; 47 Zeilen fielen erst im Abgleich auf).
- **Der Abschluss-Abgleich ist Pflicht**, nicht Kür: der Namens-Join lässt
  unaufgelöste Zeilen STILL fallen — nur der Soll/Ist-Vergleich je Monat ×
  Standort fängt das (hat KRIS und eine FRANK-Zeile gefunden).
- **Mitternachts-Wrap der Quelle:** kitchen_shifts mit shift_end=00:00 haben
  negative hours_worked (end−start ohne Wrap). Fix: bei h<0 → h+24.
- **Bewusst ausgelassen:** 1 Zusatzkellner-Eintrag „FRANK" (17.02., Spicery,
  0 Minuten, kein staff-Datensatz) — kein Pool-Beitrag, kein Nachtrag nötig.
- **Tresor startet bei null:** die Quelle führt kein cash_actual/opening_balance —
  die Tresor-Kette ist aus tagesabrechnung nicht rekonstruierbar und beginnt
  erst mit dem COCO-Echtbetrieb. Historie bleibt in tagesabrechnung nachschlagbar.
- `time_entries` mit source='pool' sind vollständig abgeleitete Daten: bei einem
  Kassen-Reset immer mitlöschen; echte Stempel (clock/manual/import) nie anfassen.

## 38. Kasse: Ein-Session-Garantie + Kellner-Session-Status (02.07.2026, abends)

Direkt-Commits (Frank + Lovable, ohne Claude): Fortsetzung von §30/§31.

- **Partieller Unique-Index `sessions_one_open_per_location`** (Migration
  `20260702213152`): pro `(organization_id, location_id, business_date)` höchstens
  EINE Session mit `status='open'`. Geschlossene/gesperrte Alt-Sessions unberührt.
- **Kellner-Session-Lookup gefixt** (`cash.functions.ts`) und **Kellner-UI zeigt
  Session-Status** (`zeit/abrechnung.tsx`): Kellner sehen vor der Abgabe, ob für
  ihren Standort eine offene Session existiert.
- Abgenommen im E1-Review-Lauf vom 03.07. (tsc/eslint/vitest grün über den
  Gesamtbereich).

## 39. M5 Welle E1 — Einheitenmodell Bestellung/Inventur (03.07.2026)

Artikel haben jetzt getrennte **Bestelleinheit** (Kiste/Sack/kg …) und
**Inventureinheit** (Flasche/kg/Liter …) mit Umrechnungsfaktor. Kernfall:
Coca-Cola 18,90 €/Kiste, 1 Kiste = 24 Flaschen → Inventurwert rechnet mit
78,75 Cent/Flasche (vorher fälschlich mit dem Kistenpreis).

### Designentscheidungen

- **Kein gespeicherter Normalpreis auf `articles`** — abgeleiteter Wert
  (`price_cents / order_to_inventory_factor`), berechnet ausschließlich im reinen
  Modul `src/lib/bestellung/unit-conversion.ts` (getestet, inkl.
  Coca-Cola-Abnahmefall 93 Fl. → 7324 Cent). Persistiert wird der Normalpreis nur
  in **Snapshots** (`order_items`, `inventory_items`) als `numeric(14,4)` **Cents**.
- **Neue `articles`-Felder:** `order_unit`, `inventory_unit`,
  `order_to_inventory_factor`, `quantity_step`, `allow_decimal_order_quantity`,
  `min_order_quantity`, `target_stock_total`, `target_stock_bar` (Zielbestände =
  reine Datenfelder, keine Automatik). `unit`/`packaging_unit` bleiben Legacy.
- **Snapshots:** `order_items` +3 Felder (Inventureinheit, Faktor, Normalpreis;
  `unit` trägt jetzt die Bestelleinheit — RPC `create_order_from_cart` befüllt
  alles, Freitext-Positionen → NULL). `inventory_items` +5 Felder; abgeschlossene
  Inventuren rendern aus Snapshots, nicht aus aktuellen Artikeldaten.
- **FK-Härtung:** `inventory_items.article_id` von CASCADE auf **RESTRICT** —
  Artikel-Löschung kann keine Inventurhistorie mehr wegwischen (Fehlermeldung
  verweist auf Deaktivieren). Integritätsloch im Review gefunden.
- **Read-only auf DB-Ebene:** RLS-Policy `inv_items_write_mgr` verlangt
  `status='in_progress'` + Zeilen-Trigger `tg_inventory_items_assert_open`
  (bindet auch service_role). Trigger blockt NUR `status='completed'` —
  `v_status IS NULL` (Session per CASCADE bereits gelöscht) muss durchgehen,
  sonst bricht `deleteInventorySession` (im ersten Wurf so passiert, korrigiert).
- **UI:** Lagerbereiche heißen jetzt **Bar** / **Trockenlager** (nur Labels;
  Spalten `storage_1`/`storage_2` unverändert). Inventurzeile:
  Artikel | Inventureinheit | Bar | Trockenlager | Gesamt | Gesamtwert.
  Katalog: „18,90 € / Kiste · 1 Kiste = 24 Flaschen · 0,7875 € / Flasche".
  EasyOrder: Mengen-Buttons respektieren `min_order_quantity`/`quantity_step`.
- **Bewusst NICHT gebaut:** Wareneingang, Lagerbewegungen, Bestandswirkung von
  Bestellungen (Bestellungen bleiben reine Dokumente; Inventur = einzige gezählte
  Bestandsquelle), Bestellvorschläge, Umlagerungs-Automatik, neue Order-Status.
- **Vertagt → Welle E2:** echte Dezimal-Bestellmengen (`quantity integer → numeric`
  in `cart_items`/`cart_draft_items`/`order_items` + RPC + Zod + EasyOrder +
  E-Mail-Rendering). In E1 validiert `validateOrderQuantity` serverseitig
  min/Raster, Mengen bleiben ganzzahlig.

### Live-Status

Migration `20260702233456` (+ Trigger-Korrektur) am 03.07. auf der COCO-DB
ausgeführt; Verifikations-CSV: 8 articles-Spalten / 3 + 5 Snapshots / FK=RESTRICT /
Trigger 1 / RPC-4arg 1 / 0 Altzeilen ohne Snapshot-Backfill.

### Lektion

Vorab-SQL-Skizzen aus Prompts sind NICHT die ausführbare Migration (Skizzen-§6 war
Kommentar → RPC fehlte nach dem Skizzen-Lauf in der DB; Trigger-CREATE ohne
DROP IF EXISTS brach den zweiten Lauf ab). Für die Live-DB immer die committete
Migrationsdatei bzw. das von Claude gelieferte idempotente Ausführungs-SQL nehmen.

## 40. M4 Stufe 3a — edlohn-Abgleich Härtung (03.07.2026)

Maschineller Vergleich von 166 edlohn-Entgeltabrechnungen (Feb–Mai 2026) gegen
`berechneLohn` (edlohn-eigene Entgeltzeilen als Input, Cent-Diff auf
LSt/Soli/KiSt/KV/RV/AV/PV/Netto/Auszahlung). Ergebnis: 95 cent-exakt, Rest in
sechs klar identifizierten Klassen — fünf davon jetzt gefixt, eine sauber
dokumentiert offen. Jede Änderung ist durch einen echten edlohn-Fall belegt
(Golden Master `edlohn-faelle.json`, Fälle 4–8).

### Fixes

1. **bAV-Beiträge im Auszahlungs-Abzug** (`lohn-core.ts`, Schritt F): `bav_frei`
   - `bav_sv` werden nach dem Netto ebenfalls abgezogen — edlohn bucht die
     Direktversicherung ins Gesamtbrutto (steuerfrei) und zieht sie später als
     „Beitrag / Direktvers − mtl" wieder ab. Vorher lief die Auszahlung real
     ~569 €/Monat zu hoch (belegt: Fall 4).
2. **Minijob-RV-Mindestbemessung 175 €/Monat** (`svBeitraegeMinijob`, §163 Abs. 8
   SGB VI): Gesamtbeitrag (18,6 %) auf `max(AE, 175 €)`, AG-Pauschale (15 %)
   weiterhin auf tatsächlichem AE — der AN trägt die Differenz. Guard: AE = 0
   → RV bleibt 0 (nicht auf 175 € hochziehen). Belegt: Fall 6 (AE 115,50 € →
   RV 1522 = edlohn).
3. **Minijob-Invariante**: `berechneLohn` wirft, wenn eine Minijob-Person eine
   `zeitlohn`- oder `einmalbezug`-Zeile bekommt — sonst liefen die Beträge
   still an der Minijob-SV vorbei. `buildUrlaubKrankZeilen` nimmt jetzt die
   Beschäftigungsart und bucht Urlaub/Krank bei Minijob als `aushilfe_paust`.
4. **Midijob PV-Kinderlosen-Zuschlag auf BE-Gesamt** (`sv-2026.ts`): der
   Grundanteil (1,8 % ± Kind-Abschläge) bleibt auf der reduzierten AN-Basis
   (BE_AN), der Kinderlosen-Zuschlag (0,6 PP) läuft aber auf der beitrags-
   pflichtigen Gesamt-Einnahme BE_G (Formel mit Faktor F 0,6603). EINE
   Rundung am Ende. Belegt: Fall 7 (AE 1.648,50 € → PV 3652 = edlohn).
5. **Werkstudenten mit Mindestvorsorgepauschale**: neues Personen-Flag
   `istWerkstudent` (DB-Spalte `staff_personal_details.ist_werkstudent`) →
   PAP mit `PKV=1`, `PKPV=0`. NICHT an `kvFrei` gekoppelt (freiwillig
   gesetzlich Versicherte sind ebenfalls kvFrei, bekommen aber die volle
   Vorsorgepauschale — belegt an echten Payslips). Belegt: Fall 5 (LSt 5791).
6. **Aktivrente — St-Brutto-Ausweis um Freibetrag mindern**: neues Ausgabe-
   Feld `stBruttoAusweisCent = max(0, stBruttoCent − lstFreibetragMonatCent)`
   für CSV-/Excel-Export und Lohnrechner-UI. `stBruttoCent` bleibt unverändert
   (RE4 für den PAP; LSt-Rechnung wirkt weiterhin über LZZFREIB). Belegt:
   Fall 8 (Ausweis 80.280 Cent bei 200.000 Cent Freibetrag).

### Offen (kein Blindfix)

- **KV-AN-Rundung**: in ~38 Abrechnungen weicht die KV genau ±1 Cent von
  edlohn ab; das edlohn-Rundungsverfahren ist nicht eindeutig rekonstruiert
  (Differenzmethode Gesamt − AG löst nur einen Teil der Fälle). Beim
  Lohnbüro / in der edlohn-Doku klären, bevor ein Fix eingebaut wird.
- **Sonstige Bezüge** (Tantieme, Urlaubsabgeltung) und **PKV-Vorsorge-
  pauschale** (PKPV-Beitrag als Personen-Stammdatum pflegen) bleiben
  unsupported. Für PKV-Fälle liefert der PAP heute die Mindestvorsorge-
  pauschale, solange `pkvBasisBeitragMonatCent = 0` — bei realen PKV-
  Mitarbeitern zuerst den Beitrag pflegen.

### Golden Master

`golden-master/edlohn-faelle.json` enthält jetzt 8 Fälle (1–3 unverändert,
4/5/6/8 vollassert, 7 als Teilassert pv/rv/av wegen offenem KV-Punkt). Der
Test-Loop nutzt `toMatchObject` — additive Ergebnis-Felder (z. B.
`stBruttoAusweisCent`) brechen die Altfälle damit nicht.

### Abnahme 03.07.2026

Erneuter Vollvergleich gegen alle 166 edlohn-Abrechnungen nach den Fixes:
118 cent-exakt (vorher 95). Verbleibend ausschließlich: KV-AN-Rundung ±1 Cent
(40, offener Befund — Rundungsverfahren beim Lohnbüro erfragen), PKV-Fälle (4,
`pkv_basis_beitrag_monat_cent` pflegen), 1× KiSt ±1 Cent (gleiche Rundungs-
familie), 3× sonstige Bezüge (dokumentiert nicht unterstützt). Offene
Stammdaten-Aktionen: `ist_werkstudent = true` für den betroffenen
Werkstudenten setzen; PKV-Basisbeitrag für den PKV-Mitarbeiter pflegen.

## 41. Modul M-BWA — Steuerberater-BWA in COCO: F1 Fundament + F2a Dashboard (03.07.2026)

Monatliche Steuerberater-BWA (ETL ADHOGA / eurodata, je Gesellschaft) wird in
COCO gespeichert, quersummen-geprüft und als interaktives Dashboard
ausgewertet. F1 abgenommen bei HEAD `1a9f0f4`, F2a bei HEAD `274e2b8`
(tsc/eslint/prettier/vitest 1018 grün).

### Designentscheidungen (F1 — Fundament)

- **entity-Ebene über den Kostenstellen:** BWA hängt an der Gesellschaft
  (`entity` text, z. B. 'YUM Gastronomie GmbH' mit Kostenstellen YUM +
  Spicery), NICHT an `locations`. TSB = eigene Gesellschaft mit eigener BWA,
  kommt als zweite entity dazu (genauer Name + Kostenstellen bei der ersten
  TSB-BWA klären).
- **Tabelle `bwa_monthly`** (Migration `20260703073048`): BIGINT cents,
  Unique-Key `(organization_id, entity, cost_center, month)`, `month` =
  Monatserster (Check-Constraint), `sachkosten_detail` jsonb, `source
manual|pdf|import`. Abgeleitete Werte (Gesamtleistung, Rohertrag I/II,
  Ergebnis op.) werden NICHT gespeichert — Berechnung nur in
  `src/lib/bwa/bwa-core.ts` (E1-Normalpreis-Regel).
- **RLS:** SELECT admin-only, KEINE Client-Schreib-Policies — Schreiben nur
  über Server-Fns (service_role). payroll-Lesezugriff bewusst NICHT gewährt.
- **Quersummen-Gate serverseitig:** `validateBwaMonth`
  (`BWA_TOLERANCE_CENTS = 300`, BWA-Blätter sind auf ganze Euro gerundet)
  prüft Betriebsergebnis gegen die GuV-Kaskade und Umsatz gegen die
  Erlös-Summanden; `upsertBwaMonth` lehnt bei Verletzung ab — Tippfehler
  kommen nicht in die DB. Dialog zeigt dieselbe Validierung live.
- **Server-Fns** (`bwa.functions.ts`): `listBwaMonths` / `upsertBwaMonth` /
  `deleteBwaMonth`, alle `loadAdminCaller(["admin"])`, org-Scope aus dem
  Caller, `source` bleibt bei Updates erhalten, Audit `bwa.upsert` /
  `bwa.delete` (Voll-Snapshot in `meta.snapshot`).

### Historie-Import (verifiziert)

48 Zeilen (YUM + Spicery × 24 Monate, Mai 2023 – April 2025) aus den
BWA-PDFs 04/2024 + 04/2025 („Entwicklungsübersicht der letzten 12 Monate"),
vorab gegen alle BWA-Quersummen validiert (0 Abweichungen), per idempotentem
Daten-SQL (`ON CONFLICT DO NOTHING`) eingespielt. Rest-Check-CSV Ist=Soll:
Spicery 24 Monate / 3.425.983 € Umsatz / +418.056 € Betrieb; YUM 24 /
3.007.327 € / −213.145 €. Enthält Speisen-Haus/Außer-Haus-Split;
`sachkosten_detail`: 7 große Positionen exakt, Kleinposten als Restzeile
„Übrige" (Monatssumme exakt); `source='import'`.

### F2a — Dashboard (`/admin/bwa`, Tab „Dashboard")

Recherche-basiert (moderne Finanz-Dashboards + Gastro-Benchmarks):
KPI-Karten mit doppeltem Delta (Vormonat UND Vorjahresmonat), Prime Cost
(WES + Personal, Warnschwelle 65 %; Personalquote-Warnung > 40 %),
GuV-Wasserfall MIT exakter Wertetabelle daneben (Wasserfälle werden nur
ungefähr gelesen), Zeitreihe mit Benchmark-Bändern (WES 28–32 %, Personal
30–35 %), Break-even-Karte. Bewusst KEINE Tacho-/Ampel-Diagramme.

- **Reines Modul `bwa-analytics.ts`** (getestet, UI rechnet nichts selbst):
  `aggregateGroup` (virtuelle Kostenstelle „Gruppe" = Summe je entity+Monat),
  `deriveKpis` (nutzt `deriveBwa`, keine Formel-Duplizierung), `deltas`,
  `buildWaterfall` (Recharts-Stacked-Bar-Sockel-Technik, Invariante
  getestet), `computeBreakEven`.
- **Break-even rollierend** über die letzten bis zu 12 verfügbaren Monate:
  variabel = Wareneinsatz, fix = Personal + Sach + Anlage + AfA − sonst.
  Erträge (konservativ); `OPEN_DAYS_PER_MONTH = 30` (Annahme; echte
  Öffnungstage bräuchten ein Kostenstelle→location-Mapping — bewusst
  vertagt). **Brutto-BE aus dem ECHTEN USt-Mix** (19 % auf
  Getränke/Sonstige/Speisen-Haus, 7 % auf Außer-Haus) statt Schätzung —
  möglich durch den importierten Speisen-Split.
- Tabs nach dem M-Statistik-Muster (§19); F1-Erfassung unverändert im
  Tab „Erfassung".

### Offen / Auflagen

- ~~E2E durch Frank~~ **bestanden (03.07.2026):** Kern-Beweis über den
  PDF-Import — echte BWA 04/2025 hochgeladen, der Duplikat-Vergleich im
  Review zeigte für YUM + Spicery IDENTISCHE Werte zu den per SQL
  importierten Monaten (Parser gegen den verifizierten Import bewiesen);
  Übernahme durchgeführt, Quelle der Zeilen wechselte auf `pdf`.
- ~~Auflage für F2b~~ **erledigt (F2b):** `computeBreakEven` sortiert intern
  defensiv absteigend (Kopie + `localeCompare` desc); Test verankert, dass
  asc/gemischt dasselbe Ergebnis liefern wie desc.
- ~~Welle F2b~~ **umgesetzt (03.07.2026, abgenommen bei HEAD `5a55875`,
  vitest 1062 grün):** Neue reine Funktionen `sumSachkostenDetail`
  (label-weise Summe über Roh-Zeilen; `missingMonths` +
  `coveredSachkostenCents` für den ehrlichen Abdeckungs-Hinweis — manuell
  erfasste Monate haben kein Detail, das kommt erst mit F3) und
  `compareCostCenters` (nur echte Kostenstellen, KEINE „Gruppe";
  best/worst je Quote, bei `betriebsQuote` gilt höher = besser). UI:
  Drilldown-Karte im Dashboard-Tab (Balkenliste absteigend, negative rot,
  Abdeckungs-Hinweis); dritter Tab „Vergleich" mit Kennzahl-Tabelle
  (beste Quote grün / schlechteste rot je Zeile) und Small Multiples je
  Kostenstelle mit **gemeinsamen Y-Domains über alle Spalten** (sonst ist
  der optische Vergleich wertlos). Kein Schema-/Server-Fn-Eingriff —
  `sachkostenDetail` war im `BwaRow`-Typ bereits gemappt. Der Gruppe-
  Drilldown läuft bewusst über die Roh-Zeilen (`aggregateGroup` ignoriert
  das jsonb weiterhin).
- ~~Welle F3~~ **umgesetzt (03.07.2026, abgenommen bei HEAD `cc50cb3`,
  vitest 1079 grün):** PDF wird NUR client-seitig geparst (pdfjs-dist nach
  dem split-combined-Muster, **legacy-Build** für Safari-Kompat — der
  Haupt-Build v6 nutzt `for await` auf `ReadableStream`, was WebKit nicht
  kennt; kein Storage, keine Migration). Reines Modul
  `bwa-pdf-parser.ts`: Mapping strikt über Zeilennummer PLUS
  Label-Substring — passt das Label nicht, wird das Feld als
  `missingFields` markiert statt still die nächstbeste Zahl zu nehmen
  (Negativ-Fixture getestet); kanonischer Testfall = echter YUM April 2025,
  besteht `validateBwaMonth`. Sachkosten-Detail (Hauptzeilen 30–46, ohne
  „davon") wird mitgeparst und speist den F2b-Drilldown. Review-Screen mit
  editierbaren Werten, Live-Quersummen (bwa-core), Duplikat-Vergleich
  alt/neu; Übernahme NUR per Klick, `source: "pdf"`.
  Verhaltens-Delta `upsertBwaMonth` (ehrlich benannt): `source` wird beim
  Speichern gesetzt statt erhalten (`import` bleibt SQL-exklusiv, vom
  Client nicht wählbar); `sachkostenDetail` wird nur geschrieben, wenn
  explizit übergeben — der Erfassungs-Dialog plättet vorhandenes
  PDF-Detail NICHT.
  F3-Parser-Fix (03.07.): eurodata-BWAKORE schreibt die Kostenstelle OHNE
  Label als eigene Zeile zwischen Entity und Monat (Kopf: BeraterNr /
  Report-Typ / Entity / KSt / Monat); `findCostCenter` positionsbasiert
  erweitert (Label-Variante als Fallback erhalten). Seiten-Gate hart auf
  `isBwaPage` — Übertrag-Seiten von Vorjahresvergleich/Jahresübersicht
  flossen sonst ein (Jahresübersicht hätte Januar-Werte geliefert).
  Verifiziert gegen das echte PDF BWAKORE-01290-205-0426 (17 Seiten,
  2 KSt: YUM + Spicery, 0 Warnungen). Lektion (Familie „Vorab-Skizze ≠
  Realität", vgl. §39): Parser-Fixtures NIE synthetisch erfinden — Golden
  Master kommt aus dem echten Dokument, Beträge im Repo-Fixture
  verfremdet (§6: keine Geschäftsdaten im Repo).
  F3-Fix Teil 2 (03.07.): (1) Zeilen-Assemblierung von exaktem Math.round
  auf Toleranz-Clustering (±2,5 pt) umgestellt — eurodata setzt
  Zeilennummern mit Baseline-Versatz, exaktes Runden zerriss „47" von
  „Summe Sachkosten …" (pures Modul `src/lib/bwa/pdf-lines.ts`, getestet).
  (2) Gesehene Zeile mit leerer Monatsspalte ⇒ 0 mit transparenter
  Warnung (eurodata druckt dann nur kumulierte Werte; die 4-Token-Regel
  in `extractDataRow` bleibt — kumulierte Werte nie als Monatswert raten).
  (3) `normLabel` kollabiert Bindestrich-Spaces, Label-Vergleich
  symmetrisch. Verifiziert am echten PDF: 12/12 Felder je KSt, Quersumme
  und Sachkosten-Detail innerhalb der 3-€-Toleranz (Rundung ganzer Euro
  je Zeile).
  F3-E2E bestanden (03.07.): BWAKORE-01290-205-0426.pdf → beide KSt (YUM,
  Spicery) April 2026 ohne fehlende Felder übernommen; Quersumme grün
  (1-€-eurodata-Rundung innerhalb 3-€-Toleranz), Sachkosten-Detail
  mitgespeichert. Hinweis-UX: „Überschreibt vorhandene Werte"-Banner erscheint
  auch bei identischen Werten (rot, obwohl No-Op) — Kosmetik-Merkposten,
  ebenso Button-Plural „Block/-öcke".

  Lücken-Import Mai 2025 – März 2026 (03.07.): Der Historie-Import (s. o.)
  reichte nur bis April 2025; mit dem ersten PDF-Upload (April 2026) zeigte
  das Dashboard (12-neueste-Monate-Fenster) fast nur Leere — Historie war
  NICHT gelöscht, nur außerhalb des Fensters. 22 Zeilen (11 Monate × 2 KSt)
  aus der Entwicklungsübersicht (S. 7 + 13) desselben PDFs importiert:
  X-Koordinaten-spaltengenau extrahiert (wichtig: „Speisen außer Haus"
  existiert erst ab Jan 2026 — sparse Spalten!), Goldkontrolle April-Spalte ==
  gespeicherte PDF-Blöcke exakt, alle Monatsspalten quersummen-konsistent,
  ON CONFLICT DO NOTHING, source='import', Sachkosten-Detail „Übrige".
  Verifiziert per CSV: beide KSt 36 Monate lückenlos (2023-05 – 2026-04),
  35× import + 1× pdf. Zukunfts-Merkposten (optional): Parser könnte
  Entwicklungsübersicht-Seiten automatisch mitlesen und Lücken selbst heilen.
  **M-BWA damit funktional komplett.** Monatlicher Ablauf: BWA-PDF vom
  Steuerberater in den Import-Tab laden → Review prüfen → übernehmen.
  TSB folgt als zweite entity, sobald die erste TSB-BWA vorliegt (Name +
  Kostenstellen klären — siehe Designentscheidungen oben).

- Später optional: `bwa_plan` (Soll/Ist-Vergleich, Budget-Wasserfall);
  BWA-Umsatz vs. COCO-Kassenumsatz-Abgleich (M-Statistik hat die Zahlen).

## 42. Lohn-RLS-Härtung: SELECT manager+ auf lohn_absence_days / lohn_recurring_zeilen (03.07.2026)

Finding: Beide Tabellen hatten SELECT „own-org für alle authenticated" —
jeder MA mit Login konnte per PostgREST die wiederkehrenden Lohnarten
(`betrag_cent`, Bezeichnung: Direktversicherung, Dienstrad …) und
Urlaub/Krank-Tage ALLER Kollegen lesen. Fix: SELECT auf
`has_min_permission('manager')` gehärtet — zuerst als Direkt-SQL auf der
Live-DB (Emergency-Pfad), per pg_policies-CSV verifiziert, anschließend mit
Migration `20260703083757_3f3abd12-6bd9-49b0-a15c-493d5e2bdc34.sql`
idempotent im Repo nachgezogen (Repo = DB wieder synchron). Write-Policies
waren bereits manager+. `staff_personal_details`/`staff_compensation` waren
nicht betroffen (Permission-Muster `payroll.*.view` aus committeten
Migrationen).

**Lektion:** Ein Emergency-Fix per Direkt-SQL auf der Live-DB ist ohne
sofortige Nachzieh-Migration ein stiller Drift — der nächste DB-Neuaufbau
aus den Migrationen stellt das Sicherheitsloch wieder her. Regel: Direkt-SQL
an Policies/Schema IMMER noch am selben Tag als idempotente Migration
committen; die pg_policies-Verify-Query gehört zum Abschluss beider Schritte.

## 43. Welle SP — Self-Service Stammdaten & Dokumente (03.07.2026)

Mitarbeiter pflegen Stammdaten im Portal. Zweistufiges Modell: Kontaktdaten
(Adresse/Telefon/E-Mail) direkt editierbar mit Audit; alles Lohnrelevante
(Name, Bank/IBAN, SV-Nr, Steuer-ID, Steuerklasse, Kirche/Konfession, Kinder,
Krankenkasse, Geburtsdaten, Nationalität, Anrede) nur per Änderungsantrag mit
Admin-Freigabe (`staff_data_change_requests`, EIN offener Antrag pro
Mitarbeiter via partiellem Unique-Index). Freigabe re-validiert die Payload
und schreibt nur `staff_personal_details`-Felder; Namensfelder werden NIE
automatisch auf `staff` angewendet (display_name-Mappings!) — Anzeige
„manuell übernehmen" im Admin-Review.

Dokumente (Pass, Visum, Arbeitserlaubnis, Gesundheitszeugnis) nach
Payslip-Muster: privater Bucket `staff-documents` — DENY-ALL für Clients
(Zugriff nur über Server-Functions mit Signed URLs; die zwischenzeitlichen
READ-Policies aus Migration `20260703112045` wurden nach Security-Review per
Rückbau-Migration entfernt, Entscheidung Frank 03.07.: ungenutzt +
Manager-Read war Rechteausweitung über den admin-only Server-Layer) —,
Pfad-Guard mit Traversal-Tests, base64-Upload über Server-Fn (Mime-Whitelist
JPG/PNG/PDF, 10 MB, Größe aus dekodierten Bytes), Signed URLs 60 s,
`valid_until` für die Ablauf-Ampel (SP3), Sichtvermerk `verified_by/at`.

Datenschutz: Konfession als optionales Freitextfeld (Art.-9-Datum, nur
Mitarbeiter selbst + Admin/Payroll). Audit-Verhalten zweistufig: bei
Antrag-ERSTELLUNG enthält das Audit-Meta nur Feldnamen, nie Werte (sensible
Daten). Bei der FREIGABE schreibt `profile-admin` bewusst den before/after-
Diff der angewendeten Felder ins Audit-Meta — gewollte Nachvollziehbarkeit
für den Fraud-kritischen Fall IBAN-Änderung (Konto-Umleitung); das
Audit-Log ist nur für Admins sichtbar. Feldkataloge
(`SELF_VIEW`/`DIRECT_EDIT`/`REQUEST`) sind reine, getestete Module in
`src/lib/profile/profile-fields.ts`.

SP1 (Schema + Server-Layer) abgenommen 03.07., Migration `20260703084105` +
Bucket live (Verifikation 1/2/0/1/1/2). Lektion: Bucket-Insert fehlte in der
committeten Migration — Storage-Objekte gehören mit in die Vorab-SQL-Prüfung.
Nachzieh-Versuch als Migration wurde vom Tool-Guard blockiert
(`bucket_sql_blocked`); der Bucket bleibt via Storage-Tool angelegt, die
Migrations-Datei entfällt daher bewusst. SP2 = Mitarbeiter-UI `/profil`
(Kontaktdaten direkt, Änderungsantrag mit Vorvalidierung via
`profile-fields.ts`, Antragsliste, Dokumenten-Upload/Ansicht). Offen: SP3
Admin-Review (Anträge freigeben, Dokumenten-Übersicht mit Ablauf-Ampel,
„manuell übernehmen"-Hinweis für Namensfelder).

**§3-Merkposten Konfession:** Die Spalte `konfession` ist bewusst NICHT an
den Lohnrechner angebunden (KiSt läuft weiter über `church_tax_liable`).
Falls sie je die Kirchensteuer speisen soll: Select-Liste in
`computeLohnForStaff` UND `person-mapping` zwingend mitziehen
(Phantom-Deploy-Falle, §3 / Aktivrente-Lektion).

**SP3 abgenommen (03.07.2026):** SP2 (Mitarbeiter-UI `/profil`) und SP3
(Admin-Review `/admin/personal-antraege`: Antrags-Freigabe mit Ist/Neu-
Vergleich und „manuell übernehmen"-Hinweis für Namensfelder; Dokumenten-
Übersicht mit Ablauf-Ampel rot/gelb 60 Tage/grün, Sichtvermerk, Fehlend-
Liste Gesundheitszeugnis) abgenommen. Welle SP damit komplett.
Bucket-Verankerung im Repo: NICHT als Migration (Guard-Block, siehe §3),
sondern in docs/seed-storage.sql (beide Buckets, idempotent).

## 44. Z1 „Meine Stunden" — Ist-Zeiten-Self-Service (03.07.2026)

Mitarbeiter sehen unter /zeit/stunden ihre gearbeiteten Schichten der
Abrechnungsperiode (26.–25., Navigation in frühere Perioden): pro Tag
Start/Ende/Pause/Netto, Periodensumme. Reines Lese-Feature: neue Server-Fn
`getMyPeriodEntries` (staff_id aus Caller, Perioden aus `periods`-Tabelle),
Summen im getesteten puren Modul `src/lib/time/my-period-hours.ts`
(Netto = grossMinutesBetween − break_minutes, identisch zur
Admin-Zeitübersicht; offene Einträge zählen nicht in Summen). Keine
Migration, keine Schreibpfade. Ergänzt „Meine Schichten" (Plan) um die
Ist-Sicht.

## 45. SM1 Sofortmeldung-Cockpit (§28a SGB IV) (03.07.2026)

Melde-Cockpit, KEINE elektronische Meldung (nur ITSG-zertifizierte Software
darf melden — die Meldung selbst läuft in sv.net/Lohnbüro). COCO prüft
Vollständigkeit (SV-Nr ODER Geburtsort+Nationalität als Alternative), zeigt
den sv.net-Datenblock kopierfertig und dokumentiert die erfolgte Meldung
(reported_at/by, Audit). Status wird BERECHNET (nicht_erforderlich /
unvollstaendig / bereit / gemeldet) aus required + missingFields + reported_at
— pures Modul src/lib/sofortmeldung/sofortmeldung-rules.ts, getestet.
Tabelle `sofortmeldung` (DENY-ALL, staff_id UNIQUE), Betriebsnummer in
organization_settings. Fachliche Vorlage tagesabrechnung; bewusst NICHT
übernommen: eigene Log-Tabelle (zentrales audit_log), gespeicherter Status,
USING(true)-Policies. Banner im Stammblatt + Badge-Spalte in der
Mitarbeiterliste. Onboarding-Reihenfolge: Mitarbeiter füllt /profil aus →
Antrag freigeben → Sofortmeldung „bereit" → sv.net → „gemeldet" markieren.

**MA1 (04.07.):** Mitarbeiter-Liste entschlackt — Aktiv/Inaktiv-Umschalter
(Standard: Aktive), PIN- und Aktionen-Spalte entfernt (beides im Stammblatt),
Sofortmeldung-Spalte ersetzt durch Status-Punkt am Namen (rot = unvollständig
mit Feld-Tooltip via `getSofortmeldungDetail`, gelb = bereit/ungemeldet).
Bestand wurde per SQL als gemeldet markiert (Altsystem-Meldungen, §28a greift
nur bei Einstellung).

**Bestands-Setzung (04.07.):** Alle aktiven Bestands-Mitarbeiter per SQL als
gemeldet markiert (Altsystem-Meldungen, §28a greift bei Einstellung; Vermerk in
note, Melder = perso 1). Bewusste Ausnahme: GIG SERVICE (Narisara Asasana)
bleibt offen bis Daten/Meldung komplett. Verifiziert: 39 gemeldet / 1 offen.
Direktarbeit danach: reported_at des Bestands auf das jeweilige EINTRITTSDATUM
gesetzt (statt Setzungs-Zeitpunkt) — historisch ehrlichere Abbildung.

## 46. V1 Dokumentengenerierung — Server-Layer (03.07.2026)

M4-Restposten aus thaitime portiert, bewusst vereinfacht: EIN Template-Modell
(Volltext mit {{platzhaltern}}, mehrere benannte Templates je Typ) statt des
thaitime-Textbaustein-Systems; keine Signaturen, kein Mailversand, keine
Server-PDF-Erzeugung (Druck client-seitig in V2, Cloudflare-kompatibel).
Tabellen document_templates + generated_documents (beide DENY-ALL; der
gespeicherte TEXT ist das Dokument der Wahrheit, template_id ON DELETE SET
NULL, Templates werden deaktiviert statt gelöscht). Platzhalter-Engine als
pures, getestetes Modul src/lib/dokumente/document-placeholders.ts (fehlende
Daten ⇒ unresolved-Liste statt leerer Strings; heute injizierbar).
Arbeitgeber-Stammdaten (Name/Adresse/Vertreter) in organization_settings.
staff_documents.doc_type um 'contract' erweitert (unterschriebener Scan wird
als normales Mitarbeiter-Dokument hochgeladen).
(Restfehler: die V1-Migration erweiterte nur den DB-Check; der
TS-Path-Guard `DOC_TYPES` kannte 'contract' nicht — Phantom-Zustand, in
V2/§48 geschlossen. Lektion: DB-Check-Erweiterungen immer zusammen mit
der Client-Whitelist ausliefern.)
Audit ohne Dokumentinhalte
(SV-Nr/IBAN gehören nicht ins Log-Meta). Offen: V2 UI (Template-Editor,
Generierungs-Assistent im Stammblatt-Tab „Dokumente", Druckansicht,
Scan-Upload-Verknüpfung).

## 47. Fallstudie: POS-Differenz-Warnung 27,90 € (YUM, 02.07.2026) — Diagnose, Fix, Lektionen

COCO zeigte am 02.07. für YUM eine POS-Differenz von +27,90 €
(`settlement-warnings.ts`: `pos_diff = POS-Brutto − Σ Kellner −
(Vectron-Takeaway + Souse)`); die tagesabrechnung war für denselben Tag
glatt. Diagnose-Verlauf und Ergebnis:

- **Ursache (per Legacy-DB bewiesen):** In COCO waren die Tagesbeträge von
  Wolt und Vectron-Takeaway über Kreuz erfasst (Wolt 477,60 / TA 449,70
  statt Wolt 449,70 / TA 477,60). Die Legacy-DB (`sessions.takeaway_total`
  = 477,60, `wolt_revenue` = 449,70, `adjusted_pos_diff` = 0,00) war die
  Referenz. Einmaliger Eingabefehler — die Kanal-Maske rendert dynamisch
  aus `revenue_channels`, kein System-Bug.
- **Fix:** Daten-SQL auf der COCO-DB (Absolutwerte statt Tausch-CASE —
  dadurch idempotent), Rest-Check im selben Lauf: `pos_diff = 0` ✓.
- **Formel-Verifikation über die Historie:** Bevor irgendetwas geändert
  wurde, wurde die Warnformel über alle 271 importierten Sessions mit
  Settlements getestet: aktuelle Formel (TA + Souse) trifft bei YUM an
  132/135 Tagen exakt 0 (mittl. Abw. 16 €); die Gegen-Hypothese
  (Wolt + Souse) wäre an >80 % der Tage falsch gewesen. Die Formel ist
  korrekt und bleibt unverändert; Wolt (Drittplattform) ist nicht im
  Vectron-Total enthalten.
- **Legacy-Flag geklärt:** `restaurants.ordersmart_in_takeaway` steht in
  der Legacy-DB für BEIDE Restaurants auf `false` (per CSV verifiziert).
  COCOs feste Formel (Souse wird immer abgezogen) ist damit für beide
  Standorte korrekt — das Flag wird bewusst NICHT nachgebaut. Sollte sich
  das Legacy-Setting je ändern, muss COCO eine Kanal-Konfiguration
  nachziehen.
- **Beobachtung Spicery:** In der importierten Historie geht die
  POS-Zerlegung bei Spicery nur an 76/136 Tagen exakt auf (mittl. Abw.
  ~59 €) — echte historische Tages-Fehlbeträge (Abrechnungsdisziplin),
  kein Systemfehler. Die Warnung macht genau das sichtbar.

**Lektionen (verbindlich):**

1. **Keine Formel- oder Datenkorrektur aus n=1.** Bei Soll/Ist-Abweichungen
   zuerst die Rechenregel über die gesamte importierte Historie
   verifizieren (Aggregat-Query: an wie vielen Tagen trifft welche
   Variante exakt 0?). Im Fall hier hat genau diese Query zwei falsche
   Fixes verhindert — erst einen Daten-Tausch auf Basis einer widerlegten
   Ablesung, dann einen Formel-Umbau auf Basis eines einzelnen Tages.
2. **Feld-Abgleiche nur gegen DB-Werte, nie gegen abgelesene UI-Werte.**
   Die mündliche Ablesung „Wolt 477,60 / Takeaway 449,70 im Altsystem"
   war vertauscht; erst der SQL-Export aus der Legacy-DB war belastbar.
3. **Bei System-Vergleichen die Ziel-DB doppelt prüfen:** Legacy-Queries
   gehören ins tagesabrechnung-Supabase-Projekt (`sessions.session_date`,
   `restaurants`, `waiter_shifts`, Euro-Dezimalwerte), COCO-Queries ins
   COCO-Projekt (`sessions.business_date`, `locations`, BIGINT cents).
   Ein `42P01 relation does not exist` ist das typische Symptom der
   falschen DB.

**E2E-Bestätigungen (03./04.07.):** Der GL-Terminal-Filter im
KONTROLLE-Block ist live verifiziert — Kasse Spicery zeigt −210,34 € /
490,02 €, cent-identisch zur Legacy-Tagesabrechnung; die §33-Regel gilt
damit nachweislich auf allen drei Rechenpfaden (Server-Aggregation, PDF,
Live-KONTROLLE). Anschließend wurde der KONTROLLE-Block optisch an das
Legacy-Summary-Layout angeglichen (Reihenfolge Fehlbetrag Vortag →
Ausgaben → Tages-Bargeld → NEU „Differenz zum Wechselgeldbestand"
[= Wechselgeld-Ist − Soll, reine Anzeige-Subtraktion] →
Wechselgeldbestand; Golden-Master-Formeln unangetastet). Nebenbefund
GIG: „fehlt in Kellnerabrechnung/Zeiterfassung" war kein Bug — die
Mitarbeiterin hatte sich schlicht noch nie angemeldet (kein
Shadow-User, keine Einträge).

## 48. V2 Dokumentengenerierung — UI + Konflikt-Auflösung (03.07.2026)

Abgenommen bei HEAD `d29dab0` (tsc/eslint/prettier/vitest 1131 grün, keine
Migration). UI-Welle über dem V1-Server-Layer (§46):

- **Einstellungen:** Sektion „Arbeitgeber-Stammdaten" (Name/Adresse/
  Vertreter → `organization_settings`), org-settings-Fn nach dem
  Betriebsnummer-Muster erweitert.
- **`/admin/dokumente` (Template-Verwaltung):** Liste je doc_type,
  Editor mit Platzhalter-Referenz aus `PLACEHOLDER_CATALOG`
  (Klick-Einfügen) und Live-Analyse — Platzhalter außerhalb des Katalogs
  werden rot als „unbekannt — wird nie befüllt" markiert. Deaktivieren
  statt Löschen (V1-Design, kein Delete).
- **Stammblatt-Bereich „Dokumente"** (`DokumenteTab`, section-Muster):
  Generierungs-Assistent mit Vorschau; **unresolved-Gate** — Speichern
  ist bei fehlenden Platzhaltern blockiert, bis die Checkbox „Trotz
  fehlender Angaben speichern" gesetzt ist. Dokumentenliste + Ansicht;
  **Druckansicht client-seitig** über isolierten A4-Print-Stylesheet
  (Serifen, `pre-wrap`, nur Dokumentinhalt — kein Server-PDF,
  Cloudflare-konform).
- **Konflikt-Auflösung (Lovable-Stopp, Option B):** Der V2-Prompt nahm
  fälschlich einen bestehenden Admin-Upload-Flow an. Statt Verschieben:
  (B1) `DOC_TYPES` additiv um `'contract'` erweitert + Guard-Tests in
  beide Richtungen — schließt den §46-Phantom-Restfehler; (B2) neue
  Server-Fn `adminUploadStaffDocument` exakt nach dem
  `uploadMyDocument`-Muster: admin-Gate, MIME/Größen-Checks,
  `sanitizeDocumentFileName` + `isStaffDocumentPathAllowed` vor jedem
  Storage-Zugriff, org-geprüfter Ziel-Staff (staffId vom Client, nie
  org-übergreifend), Waisen-Cleanup (Storage-remove bei Insert-Fehler),
  `uploaded_by` = Admin, KEIN automatisches `verified_by` (Sichtvermerk
  bleibt `verifyDocument`), Audit `staff_document.admin_upload` ohne
  Inhalte. Wiederverwendbare Komponente `AdminDocumentUpload`, in dieser
  Welle nur im Stammblatt eingebunden (Scan-Button, `doc_type:
'contract'` vorbelegt); Einbindung in personal-antraege bewusst
  vertagt.
- **Akzeptierte Mini-Abweichung:** je 1 Zeile in `personal-antraege.tsx`
  und `profil.tsx` (`contract: "Vertrag"` in den Label-Maps) — zwingende
  Folge von B1, keine Funktionsänderung.
- Offen: manueller E2E durch Frank (inkl. Owner-Read-Beleg: Admin-Upload
  erscheint im `/profil` des MA).

## 49. M-BWA Welle F4a — Jahresabschluss (Bilanzbericht): Parser + Server-Layer + Gate-Härtung (03.07.2026)

Ziel: ETL-ADHOGA-Bilanzberichte (PDF, je Gesellschaft) in COCO importieren
— Handelsbilanz, GuV und der Kontennachweis, der jede Position bis auf
das einzelne DATEV-Konto auflöst. Entity-Modell wie bei der Monats-BWA
(entity = 'YUM Gastronomie GmbH' etc.); Cent-Beträge, BIGINT.

**Reines Parser-Modul (`bilanz-pdf-parser.ts`):** Deterministische
Spaltenzuordnung über x-Schwellen (nicht über Token-Anzahl je Zeile),
strikter Betrags-Regex (verhindert Verwechslung von Hierarchie-Prefixen
oder 4-stelligen Kontonummern mit Beträgen), Anti-Halluzinations-Regel:
Positionen nur mit Prefix + nicht-leerem Label; Konten nur mit
Kontonummer + Label + GJ-Betrag im Geschäftsjahr-Band. Fehlt etwas →
Warnung, nie „nächstbeste Zahl".

**Konsistenz-Gates (shared Parser ↔ Server):** Damit derselbe
Wahrheitsstand geprüft wird, sind Gates 1–3 als exportierte reine
Funktionen implementiert; Parser (`computeChecks`) UND Server
(`validateReplacePayload`) rufen dieselben Funktionen.

- **Gate 1 GJ + VJ (`checkKontenSumForYear`):** Σ Konten je Blatt-Position
  = Positionsbetrag, für Geschäfts- und Vorjahr getrennt. VJ-Check wird
  übersprungen, wenn Position oder ein zugehöriges Konto keinen VJ-Wert
  trägt (mehrere PDF-Vintages ohne Vorjahresspalte).
- **Gate 2:** Σ Top-Level Aktiva = Σ Top-Level Passiva (unverändert).
- **Gate 3 staffelbewusst (`checkGuvStaffel`):** Anker-Labels
  „Ergebnis nach Steuern", „Jahresüberschuss/-fehlbetrag",
  „Gewinn-/Verlustvortrag", „Bilanzgewinn/-verlust". Bei erkannten
  Ankern werden Segmente einzeln geprüft: Σ operative = Ergebnis n. St.,
  Σ (Erg. n. St. … vor Jahresüberschuss) = Jahresüberschuss,
  Σ (Jahresüberschuss … vor Bilanzgewinn) = Bilanzgewinn. Kein Anker
  erkannt → Fallback auf die ursprüngliche „letzter Posten = Σ Rest"-Regel
  (Rückwärtskompatibilität mit älteren Fixtures). Teil-Anker → Warnung,
  keine Blockade.
- **Gate 4 rein parser-seitig (`findAnlageAnchors` +
  `checkAnlageAnchors`):** Aus den Anlage-Seiten (Handelsbilanz-Deckblatt
  bzw. GuV-Anlage) werden „Summe Aktiva", „Summe Passiva" und
  „Bilanzgewinn/-verlust" extrahiert und gegen die parsed Top-Level-
  Summen bzw. den GuV-Bilanzgewinn-Anker verglichen. Die Anlage-Anker
  gehen bewusst NICHT durchs Replace-Payload — sie bleiben in
  `checks[]` und werden nicht in `validateReplacePayload` gespiegelt;
  der Server prüft weiterhin Gates 1–3.

**Server-Fns (`bilanz.functions.ts`, Muster wie `bwa.functions.ts`):**
`listBilanzYears`, `getBilanzYear`, `replaceBilanzYear`,
`deleteBilanzYear` — alle admin-gated via `loadAdminCaller(["admin"])`,
org-Scope aus Caller-Kontext, Audit nur bei Erfolg. Schreiben
ausschließlich über die RPC `replace_bilanz_year` (delete +
bulk-insert in EINER Transaktion). `validateReplacePayload` liefert
zusätzlich `warnings[]` (Teil-Anker Gate 3), die den Server nicht
blockieren, aber der UI in F4b als Hinweis dienen können.

**Ehrlichkeits-Merkposten:**

- **Migrations-Nachzug F4a ✅ (03.07.2026):** Frank hat das SQL aus
  `docs/bilanz-schema-draft.sql` am 03.07. manuell auf der Live-DB
  ausgeführt; die zugehörige Migrationsdatei
  (`20260703…_bilanz_f4a_nachzug.sql`) ist im Repo idempotent
  (`IF NOT EXISTS` / `DROP POLICY IF EXISTS` / `CREATE OR REPLACE`) —
  läuft in CI-Fresh-Stacks, ist auf der Live-DB ein No-Op. Draft-Datei
  `docs/bilanz-schema-draft.sql` bleibt als Design-Referenz erhalten.
  Die lokale Bilanz-DB-Signatur in `bilanz.functions.ts` bleibt bis zur
  nächsten `supabase gen types`-Runde stehen.
- MCP-Server-Welle wurde in `083965a8` revertiert (rote CI);
  Wiederaufbau als eigene Welle geplant, kein Vorgriff (kein
  `.prettierignore`-Eintrag, kein `get-bilanz-year`-Tool in dieser Welle).

**Welle F4b — Jahresabschluss-UI (Frontend, 03.07.2026):**
Neue Route `/admin/bilanz` (admin-gated) mit drei Tabs:

- **Jahres-Ansicht:** KPI-Karten mit VJ-Delta (Bilanzsumme,
  Eigenkapitalquote, Liquide Mittel, Jahresüberschuss); Drill-Down
  Bilanz/GuV inkl. Kontennachweis; GuV-Wasserfall (recharts, gleiche
  Chart-Bibliothek wie F2a). KPI-Ableitung im reinen Modul
  `src/lib/bwa/bilanz-kpis.ts` (Label-Anker analog zum Parser,
  Anker fehlt → „—", nie Halluzination).
- **Mehrjahresvergleich:** Top-Level-Positionen über alle Jahre einer
  Gesellschaft; VJ-Konsistenz-Warnung, wenn die VJ-Spalte des
  N-Berichts vom GJ-Wert des N-1-Berichts abweicht (reine
  Anzeige-Warnung, keine Blockade).
- **Import:** PDF-Auswahl (client-seitig extrahiert via
  `extractTokenLines` — neue Funktion in `pdf-lines.ts`, F3-Extraktion
  unverändert) → Review-Screen (Kopf editierbar, Checks-Tabelle mit
  ok/fail, Warnungen, Zähler, Hinweis auf bereits vorhandenen Stand) →
  `replaceBilanzYear` (Server prüft Gates 1–3 erneut).

Verwaltung: Lösch-Button pro Jahr mit Bestätigungsdialog →
`deleteBilanzYear`. Verändert wurden **nicht** die Parser- oder
Server-Fn-Module aus F4a; die UI ruft ausschließlich exportierte
Funktionen.

**Erfolgs-Gate erreicht (03.07.2026):** `prettier --check .` sauber;
`vitest run` 1170 Tests grün (Bilanz-Parser 20 + Bilanz-Server 14 neu);
`tsgo --noEmit` fehlerfrei; `parseGermanAmountToCents` nicht dupliziert
(einmal in `bwa-pdf-parser.ts`, Bilanz-Parser importiert). RLS-Inventur
unverändert (Bilanz-Tabellen kommen mit der Migration).

**F4b-Fix — Parser-Geometrie (03.07.2026):** Erster echter Import ist an
drei Struktur-Eigenschaften des ETL-ADHOGA-Drucks gescheitert, die die
synthetische Fixture nicht abbildete. Nachgezogen:

- **Rechtsbündige Spalten (stabile rechte Kante!):** Die Beträge werden
  jetzt über `xEnd` gebandet (Konto-GJ im inneren Band, Positions- und
  Summenzeilen im äußeren `gjRight`, VJ auf `vjRight`). `TextItem` trägt
  jetzt die pdfjs-`width`, `LineToken` liefert `xEnd`. Vorher wurde die
  linke Kante (`x`) verglichen; das zerriss die meisten Beträge im echten
  Bericht, weil `x` mit der Zahlenlänge um bis zu 80 pt schwankt.
- **Umgebrochene Konto-Labels + separate Innere-/Äußere-Betragszeilen:**
  Ein Konto ohne Beträge bleibt „offen", Fortsetzungszeilen ohne Prefix
  werden ans Label angehängt; die erste innere Betragszeile schließt es.
  Danach kommt oft eine reine äußere Betragszeile, die die letzte
  offene Position (Stack, LIFO) mit ihrem Wert füllt. Positionen ohne
  jede gedruckte Summe (z. B. „B Eigenkapital") bekommen ihren Wert
  bottom-up per Roll-up aus den direkten Kind-Positionen (VJ nur, wenn
  alle Kinder VJ haben).
- **Spalten-Anker aus der Jahres-Kopfzeile:** Pro Kontennachweis-Seite
  werden `gjRight`/`vjRight` aus den beiden 4-stelligen Jahreszahlen
  (fiscalYear/-1) abgeleitet; Fallback: rechte Kanten der beiden
  „EUR"-Token. Die Kopfzeilen (Geschäftsjahr/Vorjahr, Jahreszeile,
  EUR EUR) werden übersprungen und **NIE** als Konto/Position
  klassifiziert (behebt „Konto 2024" im ersten E2E).

**Lektion Fixture-Realismus:** Rechtsbündige Spalten, Label-Umbrüche
und die Zwischensummen-Struktur (reine Betragszeilen im äußeren Band,
benannte Zwischensummen ohne Prefix, mehrfach-Beträge auf
„Übertrag"-Zeilen) des echten Drucks müssen in Parser-Fixtures
abgebildet sein — die erste Fixture hat alle drei Eigenschaften
verfehlt und den Fehler bis zum echten E2E verdeckt. Neu abgedeckt
durch sechs Charakterisierungs-Tests (Anker-Findung inkl. Fallback,
inneres/äußeres Band, offenes Konto mit Umbruch, Rollup GJ+VJ,
benannte Zwischensumme, Übertrag). Nicht angefasst: `checkGuvStaffel`,
`checkKontenSumForYear`, `checkAnlageAnchors`, `validateReplacePayload`
— die Gate-Logik ist korrekt und bleibt unverändert; nur die
Datenzulieferung wurde repariert.

**F4b-Fix-2 — Abschnitte über Seitengrenzen (03.07.2026):** Zweiter
E2E-Befund an allen drei echten Berichten (2022–2024): Der Anker
„Kontennachweis zur Handelsbilanz/GuV" steht nur auf der **ersten Seite**
eines Abschnitts. Fortsetzungsseiten tragen nur Entity-Kopfzeile,
Spaltenkopf (ggf. „Aktiva"/„Passiva", Jahreszahlen, „EUR EUR"),
„Übertrag"-Zeile und dann die restlichen Konten/Positionen. Vorher wurden
alle Seiten ohne Anker verworfen — Aktiva verlor Seite 2 inkl.
Bankkonten und „Summe Aktiva", die GuV brach nach Posten 3 ab, und Konten
mit umgebrochenem Label über die Seitengrenze verloren ihre Beträge.
Nachgezogen: Der Parser führt einen `currentSection`-Zustand über die
Seitenschleife; eine Seite ohne Anker, aber mit Spaltenkopf ist
Fortsetzungsseite (offener Konto- und Positions-Stack überleben den
Umbruch). Anlage-/andere Anker oder eine Seite ohne Spaltenkopf beenden
den Abschnitt. Entity-Kopfzeile, Fußzeile („Erläuterung zu den
wesentlichen Posten"), einzelnes „Aktiva"/„Passiva" und die Anker-Zeile
selbst werden nie als Konto/Position klassifiziert. Widerspricht das
Statement-Label der Folgeseite dem aktiven Abschnitt → Warnung und Label
gewinnt. Neu abgedeckt durch fünf Charakterisierungstests (offenes Konto
über die Seitengrenze, Übertrag beider Seiten ignoriert, Positions-Summe
der Folgeseite trifft die richtige offene Position, Folgeseite ohne
Spaltenkopf beendet den Abschnitt, widersprüchliches Statement-Label
erzeugt Warnung + Wechsel). Nicht angefasst: Gate-Funktionen,
`findAnlageAnchors`, Banding/Anker-Ableitung, `validateReplacePayload`,
`bilanz.functions.ts`, Schema/Migration.

**Lektion:** Abschnitte laufen über Seitengrenzen; der Anker steht nur
auf der ersten Seite — Fortsetzungsseiten erkennt man am Spaltenkopf.

**F4b-Fix-3 — Teilsummen akkumulieren + Dezimalkomma-Pflicht (03.07.2026):**
Dritter E2E-Befund an allen drei echten Berichten: zwei Restursachen.
(1) Positionen mit mehreren gestapelten Teilsummen (B.II Forderungen:
zwei Kontenblöcke, je eigene reine Betragszeile, keine finale Gesamtzeile
— B.II = Σ Teilsummen; erst B.III schließt) wurden vom Parser bei der
ersten Teilsumme geschlossen, die zweite rutschte auf die nächste offene
Position. (2) Konten mit Paragraphen-Zahlen im Label (8105
„… § 4 Nr. 12 UStG …", 2281 „… nach § 4 Abs. 5b EStG") verloren ihre
Beträge, weil die nackten Label-Zahlen „4"/„12" als GJ-Betrag gefressen
und das Konto verfrüht geschlossen wurde — die Delta-Beträge stimmten
cent-genau mit den echten Werten überein. Nachgezogen: Reine Betragszeile
im äußeren Band schließt die innerste offene Position NICHT mehr — sie
akkumuliert (GJ addiert immer; VJ addiert nur, wenn alle Teilzeilen einen
VJ trugen, sonst wird VJ auf null gesetzt). Positionen schließen erst
beim nächsten Positions-Header mit gleichem oder höherem Level bzw. am
Abschnittsende (Level-Stack). Betrags-Klassifikation umgestellt auf
Dezimalkomma-Pflicht (`^-?\d{1,3}(\.\d{3})*,\d{2}$`) — genau zwei
Nachkommastellen, wie ETL-ADHOGA ausnahmslos druckt; Jahres-Kopfzeilen-
Erkennung nutzt weiter ihr eigenes Muster. Neu abgedeckt durch vier
Charakterisierungstests (B.II-Muster mit zwei Teilsummen, 8105-Muster mit
nackten Label-Zahlen, 2281-Muster mit dreizeiligem §-Label und Kleinst-
betrag −0,20, negative Zeile mit nur nackten Ganzzahlen). Nicht ange-
fasst: Gate-Funktionen, Anker-/Band-Logik, Seitenfortsetzung aus Fix-2,
`pdf-lines.ts`, `bilanz.functions.ts`, UI, Schema/Migration.

**Lektion:** Positionen können mehrere gestapelte Teilsummen haben
(Positionsende = nächster Positions-Header, nicht erste Summenzeile).
Beträge haben im ETL-ADHOGA-Druck immer zwei Nachkommastellen — nackte
Ganzzahlen sind Label-Bestandteile (§-Zitate!), nie Beträge.

## 50. Fallstudie: „Forbidden" auf /profil unter Impersonation — fehlende Default-Rolle (04.07.2026)

**Symptom:** „Vorschau als ANDI" → alle Portal-Tabs funktionieren, nur
„Meine Daten" wirft „Fehler beim Laden: Forbidden".

**Beweiskette:** (1) Impersonation wirkt bis in die RLS — Migration
`20260617230538` definiert `current_staff_id()` effective-aware (bei
aktiver Vorschau gilt die Zielperson als Identität); die Browser-Session
bleibt die des Admins, `startImpersonation` schreibt nur die
Overlay-Zeile. (2) `/profil` ist die einzige Portal-Seite auf
`loadAdminCaller(…, "staff")` — der verlangt zwingend eine
`role_assignments`-Zeile (`role = null` ⇒ ForbiddenError). Die übrigen
Portal-Tabs laufen über `loadStaffCaller`, der KEINE Rolle prüft.
(3) ANDI hatte keine Rollen-Zuweisung ⇒ Forbidden. Derselbe Fehler
träfe sie auch beim echten PIN-Login.

**Wurzel (systemisch, OFFEN):** `createStaff` vergibt keine Default-Rolle
— jeder neue Mitarbeiter ohne manuell gesetzten Rechte-Tab läuft in
dieses Loch. Sofort-Fix pro Person: Stammblatt → Rechte → Rolle `staff`.
Geplanter Fix (Prompt wartet auf GO): `createStaff` schreibt die Rolle
`staff` im selben runGuarded-Block mit (+ Backfill-SQL für Bestands-
Mitarbeiter ohne Zeile). Bis dahin gehört „Rolle zuweisen" verbindlich
in Schritt 2 des Onboarding-Runbooks.

## 51. Fallstudie: Pool-Zeit-Rückschreibung 100 % still tot — partielle Indizes vs. PostgREST-Upsert (04.07.2026)

**Symptom:** Kellner-Abgaben liefen (Service-Pool-Endzeiten wurden gesetzt),
aber KEIN Pool-Teilnehmer bekam time_entries — Arbeitszeiten-Tab leer,
seit Einführung der Rückschreibung am 30.06. Diagnose-CSV 03.07.: 19 Pool-
Zeilen mit (fast) vollständigen Zeiten, Tag ungesperrt, 0 Zeiteinträge.

**Root Cause:** `upsert(..., { onConflict: "organization_id,import_key" })`
gegen zwei PARTIELLE Unique-Indizes (WHERE source='import' bzw. 'pool') —
PostgREST kann partielle Indizes nicht als Konfliktziel inferieren →
42P10 bei jedem Aufruf, vom Best-effort-Catch still geschluckt.

**Fix:** Ein VOLLER Unique-Index auf (organization_id, import_key) ersetzt
beide (NULLs kollidieren nie → gefahrlos für clock/manual; Key-Präfixe
disjunkt). Alt-Tage seit 30.06. per Heilungs-SQL nachgezogen (repliziert
resolvePoolTimeEntrySync inkl. Mitternachts-Wrap und Europe/Berlin;
Vorrangregel und Unvollständig-Regel respektiert). Catches schreiben jetzt
Audit-Einträge (pool_time.writeback_failed / sync_failed).

**Pflicht-Regeln daraus:**

- PostgREST-`onConflict` verlangt einen VOLLEN Unique-Index/Constraint auf
  exakt den Spalten — partielle Indizes sind damit unvereinbar und
  scheitern zur Laufzeit (42P10), nicht beim Deploy.
- Best-effort-Catches müssen IMMER eine auffindbare Spur hinterlassen
  (audit_log), nie nur console.error — vier Tage unsichtbares Scheitern
  waren die Folge.
- Offene Pool-Zeiten (kein shift_end, z. B. keine Abgabe erfolgt) erzeugen
  bewusst KEINEN Eintrag — Nachpflege in der Kassen-Pool-Zeile löst den
  Sync sofort aus.

## 52. Provision P1 — Server-Layer (04.07.2026)

Portierung der Legacy-Commission (`useCommissionData` aus tagesabrechnung)
mit drei Neuerungen: (1) an-/abschaltbar pro Standort
(`locations.commission_enabled`, Default AUS — `enabled=false` beendet die
Server-Fn VOR jeder Rechnung, also auch vor jedem Datenzugriff), (2)
Einstellungen pro Standort (Mindestumsatz je Kellner/Tag in CENTS, Satz in
%), (3) Rechnung in BIGINT cents mit centgenauer
Largest-Remainder-Verteilung (Legacy verlor Rundungscents an Floats).

Formel unverändert zur Legacy: pro Tag Kellner-Set aus Abrechnungen +
Partnern (GL immer ausgeschlossen, sowohl als Haupt- als auch als
Partner-Kellner), Schwelle `revenue / waiterCount ≥ minRevenueCents`,
Tages-Pool = `round((revenue − min × waiterCount) × pct / 100)`,
Verteilung nach Service-Minuten des Zeitraums aus `time_entries`
(Auto-Ausstempeln + Pool-Writeback stellen sicher, dass praktisch immer
ein `time_entry` existiert — der frühere Legacy-Fallback auf
Abrechnungs-Zeiteinträge ist damit nicht mehr nötig).

Pures Modul `src/lib/lohn/provision-calc.ts` ist zeitraum-agnostisch
(Periode UND Woche möglich), getestet inkl. Legacy-Kanonik (1 Tag, 2
Kellner, 3.400 € / min 1.200 € / 5 % ⇒ Pool 5.000 Cents),
Schwellen-Grenzfall, Partner-Kopfzahl, GL-Ausschluss (Haupt und Partner),
Largest-Remainder-Summen-Invariante (Pool 10.001 auf 3 Kellner ⇒ Σ =
10.001, deterministische Tie-Break-Reihenfolge nach `staffId`).

Server-Fns:

- `getProvisionOverview({ locationId, periodStart, periodEnd })` — reine
  Leseoperation, gated auf `manager | admin | payroll`. Kurzschluss bei
  deaktiviertem Standort. Rückgabe: `{ enabled, settings, poolCents,
dayBreakdown[], rows[] }` — der `dayBreakdown` ist die Grundlage für
  Franks „detailliert beschrieben"-Anforderung im P2-UI (Drilldown pro
  Tag: Umsatz, Kellnerzahl, Schwelle, Tages-Pool).
- `updateCommissionSettings({ locationId, enabled, minRevenueCents, pct })`
  — admin-only, `runGuarded` + Audit-Eintrag
  `provision.settings_changed` mit `before/after` der drei Werte (keine
  sensiblen Daten).

M4 bleibt bewusst getrennt: Provision fließt NICHT automatisch in den
Lohnrechner ein — die Übergabe ans Lohnbüro ist P2- bzw. Folge-Thema.

Offen: **P2 UI** — Provision-Tab in der Zeitübersicht (Liste + Pool +
Erklärungs-Panel mit Tages-Drilldown), Einstellungs-Dialog pro Standort
(Schalter, Mindestumsatz, Satz).

P2 UI (04.07.): Provision-Tab mit Perioden-Pool, Verteilungs-Tabelle,
Tages-Drilldown (dayBreakdown macht die Formel an echten Zahlen
nachvollziehbar), Einstellungs-Dialog (aktiv/min/pct, admin-only) und
statischem Erklärungs-Panel. Bei „Alle Standorte" bewusst kein Merge —
Provision ist standort-scoped. Status: ✅ (E2E Frank ausstehend).

04.07.: Alle-Standorte-Merge für Zusammenfassung/Buchhaltung
(Client-Merge nach Wochenplan-Muster, sfn/notes je Standort
summiert/konkateniert); Wochenplan-Layout final: Anf./Ende nebeneinander,
gleiche Tages-Spalten, Namens-Spalten 68px gespiegelt, S/U/K-Gruppe
konsistent in allen drei Tabs, Tastatur-Navigation beim Inline-Edit.

## 53. Telegram-Verknüpfung (Bot + Webhook) (04.07.2026)

Infrastruktur für Telegram-Benachrichtigungen (Direktarbeit, Security-Review
bestanden): Öffentliche Webhook-Route `/api/public/telegram/webhook`
verifiziert Telegrams `X-Telegram-Bot-Api-Secret-Token` per timingSafeEqual
(401 sonst) und verarbeitet AUSSCHLIESSLICH `/start <token>` zur
Konto-Verknüpfung — alle anderen Updates werden ignoriert. Bot-Token nur als
Env-Secret (TELEGRAM_API_KEY via Lovable-Connector), NIE in der DB.
Verknüpfungs-Token: CSPRNG (randomBytes(32) base64url) mit Ablauf;
Self-Service in /profil (Deep-Link), Verwaltung in den Einstellungen.
Tabelle `staff_telegram_links`: Self-Service-Policies (eigenen Link
lesen/löschen) + Admin-Übersicht — bewusster, eng gescopter Client-Zugriff
(Chat-ID/Username, geringe Sensibilität), Webhook schreibt via service_role.
Noch KEIN Versand-Pfad — Berichte (z. B. Tages-Summary) sind ein eigener
Folge-Baustein mit Design-Schritt (was wird an wen gesendet, Opt-in).

TG2 Tagesbericht (04.07.): Versand an angehakte verknüpfte Konten
(`staff_telegram_links.receives_daily_report`) statt fester Chat-ID.
Trigger: pg_cron ruft STÜNDLICH die Route `/api/public/telegram/daily-report`
(Prompt nannte `/api/internal/…` — Pfad bewusst unter `/api/public/`
abgelegt, weil auf TanStack Start nur dieser Prefix ohne Lovable-Auth-Wall
zuverlässig extern erreichbar ist; abgesichert wird ausschließlich per
`X-Cron-Secret`, timing-safe gegen `process.env.TELEGRAM_CRON_SECRET`;
503 wenn Env fehlt). Der Endpoint gated selbst — Berlin-Stunde ==
`telegram_report_hour` UND `telegram_report_last_sent` < heute → DST-fest
und idempotent. Inhalt aus denselben Helfern wie das Tages-PDF
(`sessionToDayInput` / `computeDailyCash` / `computeWechselgeld`);
pures Modul `src/lib/telegram/telegram-report.ts` (HTML `parse_mode`,
`escapeHtml` für alle dynamischen Strings, Vitest deckt Escaping/Flags/
Ausschluss/„Keine Daten"/Snapshot ab). Empfänger-Fehler einzeln
`try/catch` — ein toter Chat blockiert die anderen nicht. Audit
`telegram.report_sent` speichert nur Zähler + Datum, KEINE Berichts­inhalte.
Testbericht-Button in den Einstellungen umgeht das Gate ohne
`last_sent` zu setzen. pg_cron-Einrichtung: Frank-SQL (Ops, keine
Migration).

BZ1 Batch-Schichtzeiten (04.07.): Portierung des Legacy-`ShiftTimeOverride`
als Admin-Card auf `/admin/zeit-uebersicht`. Drei Modi (`override`,
`create_weekdays`, `create_daily`) — für Gehalts-/GL-Personal, das nicht
stempelt. Standardzeiten je Werktag (17:00–01:00) und Sonn-/Feiertag
(15:00–02:00) sind konfigurierbar in `organization_settings`
(`batch_weekday_start/end`, `batch_sunhol_start/end`) und werden per
Admin-Dialog gepflegt. Sonn-/Feiertagsentscheidung nutzt die kanonische
Quelle `isBavarianHoliday` aus `shift-hours.ts` (1. Mai unter der Woche
bekommt so die sunhol-Zeiten). Skip-Semantik im reinen Modul
`src/lib/time/batch-times.ts`: `locked` (Wasserlinie — Batch bricht NIE
hart ab, sondern zählt Skips), `absence` (`roster_absence`), `other-location`
(Eintrag am selben Tag an einem Fremd-Standort), `no-entry` (override-Modus
ohne bestehende Schicht — erzeugt bewusst NICHTS), `not-weekday`
(create_weekdays Sa/So). Mitternachts-Wrap (17→01 landet am Folgetag) über
`batchTimestamps`; Pausen kommen aus `arbzgMinimumBreak`. Audit-Strategie:
EIN Aggregat-Eintrag pro Lauf (`time_entry.batch_times`, meta enthält
`runId`, Modus, Periode, Zähler, `createdEntryIds`) plus separate Chunks
(`time_entry.batch_times.changes`, ~200 Vorher-Bilder je Chunk, gemeinsame
`runId`) — überschriebene Zeiten sind aus dem append-only Log
rekonstruierbar, ohne den Audit-Trail bei großen Läufen zu fluten.

## 54. Urlaubs-Stammdaten aus edlohn-PaySlips + Vorzeichen-Lektion (04.07.2026)

Aus dem Sammel-PDF „Entgeltabrechnungen YUM Gastronomie GmbH 06/2026"
(65 Seiten, 39 Personen) wurden die Urlaubsfelder für 36 Mitarbeiter in
`staff_personal_details` importiert (Join strikt über `staff.perso_nr`,
COALESCE-only-NULL — gepflegte Werte unantastbar). Semantik an Real-Fällen
verifiziert: genommen = (akt Jahr + Vorjahr) − Restanspruch, Stichtag
30.06.2026. Verifikation: 36/36 gematcht und gefüllt, 0 ohne Zuordnung.

**Sonderfälle:** 6 Personen mit NEGATIVEM Vorjahres-Übertrag (Urlaub
überzogen: perso 4, 11, 253, 320, 334, 504) — `previous_year` bewusst NULL
gelassen (App-Schema erwartet ≥ 0; Entscheidung Frank offen: Schema
erweitern vs. 0 mit Vermerk). 3 Personen ohne Urlaub-Block im PaySlip
(12, 20, 317). `vacation_days_contractual` steht in keinem PaySlip und
bleibt Handpflege. TSB ist eine eigene Entität — PaySlips folgen separat.

**Lektion (Import-Disziplin):** Vorzeichen-Audit auf ALLE extrahierten
Felder, nicht nur das Zielfeld — die erste Plausibilitätsprüfung testete
nur „genommen < 0" und übersah sechs negative Vorjahres-Werte; aufgeflogen
durch Zufalls-Review. Dieselbe Sorgfalt wie bei Geld-Importen gilt für
jede Zahlenspalte.

### Stammdaten-Voll-Import (04.07.2026, abends)

Zweiter Lauf über dieselben PaySlips: 39 Personen, importiert wurden
(NUR-NULL-Regel, Join `perso_nr`) Geburtsdatum, SV-Nummer, Steuer-ID,
Steuerklasse (arabisch→römisch I–VI gemappt!), Kinderfreibeträge,
Elterneigenschaft, Krankenkasse (edlohn kürzt lange Namen mit „…" —
trailing dots gestrippt, zweizeilige Namen zusammengeführt) +
KK-Zusatzbeitrag, Eintrittsdatum, Anrede, Adresse, IBAN (Mod-97-validiert,
kompakt normalisiert) + Bank + Kontoinhaber. Verifiziert:
geb/steuer_id/stkl/eintritt/adresse 39/39, sv 37, kk 38, iban 37.

**Bewusst NICHT importiert:** `is_midijob`, `kv/rv/av/pv_frei`,
`lst_freibetrag` — NOT-NULL-Felder (nie NULL, Nur-Lücken-Regel greift
nicht) und von der M4-Lohnprüfung bereits cent-genau gegen dieselben
PaySlips auditiert. Konfession (alle „--"), Geburtsort/Nationalität
(nicht im PaySlip), Austritte (keine im Dokument). VALUES-Import-Lektion:
untypisierte VALUES-Spalten brechen bei `COALESCE(date, text)` — immer
explizite `::casts` je Feld. TSB (eigene Entität): PaySlips folgen,
gleicher Lauf.

## 55. Schichttausch TA1 — Zustandsmaschine, DENY-ALL-RLS, kein Auto-Vollzug (04.07.2026)

Mitarbeiter können ihre eigenen zukünftigen `roster_shifts` zum Tausch
anbieten. Berechtigte Kollegen (gleicher Standort + gleicher Arbeitsbereich,
kein Tageskonflikt) sehen die Anfrage im Portal und können sie **annehmen**
oder **ablehnen**. Der Dienstplan ändert sich in TA1 NIE automatisch — der
Vollzug (Umschreibung von `roster_shifts.staff_id`) ist Aufgabe der
Manager-Genehmigung (TA2).

**Zustandsmaschine `shift_swap_requests.status`:**

```
open ──accept──▶ peer_accepted ──approve──▶ approved
  │                    │
  │                    └──reject──▶ rejected
  │
  └──cancel (nur Anfragender) ──▶ cancelled
```

Ablehnungen einzelner Kollegen leben in einer **separaten Tabelle**
`shift_swap_declines (request_id, staff_id)` und **ändern den Status
NICHT**. Auch wenn alle Berechtigten ablehnen, bleibt der Request `open` —
der Anfragende entscheidet selbst über Stornieren. Eine ANNAHME kann der
Kollege in TA1 nicht zurückziehen (nur der Anfragende storniert, der
Manager lehnt in TA2 ab). Eine ABLEHNUNG ist endgültig für diesen Request.

**Berechtigten-Regel (`eligiblePeerFilter` in `swap-rules.ts`):** aktiv,
nicht der Anfragende, hat `staff_locations`-Zeile mit
`(location_id, department) == (shift.location_id, shift.area)`, hat an
`shift_date` an genau diesem Scope KEINE eigene Schicht.

**TA4 (Datum):** Berechtigten-Regel (`eligiblePeerFilter`) und Gegentausch-
Regel (`canAcceptCounterShift`) sowie die Genehmigungs-Re-Validierung in
`decideSwapRequest` prüfen zusätzlich `roster_absence` (Typ `urlaub` oder
`krank`) an Ziel- und Gegentausch-Datum — Abwesende sind nicht
tauschberechtigt, und ein zwischen Peer-Annahme und Manager-Genehmigung
eingetragener Urlaub verhindert den Vollzug mit klarer Meldung
(„… ist an diesem Tag abwesend"). Der Request bleibt in diesem Fall
`peer_accepted`.

**RLS/Zugriff:** Beide Tabellen sind **DENY-ALL** für Clients — keine
Policies, alle Zugriffe laufen server-seitig über `supabaseAdmin` NACH
`loadStaffCaller` und expliziter Berechtigungsprüfung. `staffId` kommt
IMMER aus `auth.uid` → `user_links` und nie vom Client.

**Partieller Unique-Index:**
`shift_swap_requests_active_shift ON (shift_id) WHERE status IN ('open','peer_accepted')`
verhindert zwei aktive Anfragen pro Schicht. §51-Anmerkung: der Index ist
KEIN `onConflict`-Ziel für PostgREST-Upserts — der Konflikt wird als
`INSERT`-Fehler oben abgefangen und zusätzlich server-seitig per
`hasActiveRequestForShift`-Precheck erkannt.

**Perioden-Sperren:** Beim Anlegen einer Anfrage wird
`assertShiftDateUnlocked` gerufen — für gesperrte Perioden gibt es keine
Tausch-Anfragen.

**TA2 (04.07.2026) — Manager-Genehmigung & Vollzug:** `decideSwapRequest`
(`manager+`) re-validiert im Genehmigungsmoment (Status `peer_accepted`,
beide Schichten liegen in der Zukunft, Perioden-Sperren beider Schichten,
Slot-Konflikte) und ruft den atomaren Vollzug via RPC
`execute_shift_swap` (SECURITY DEFINER, `EXECUTE` nur `service_role`) auf.
Der Unique-Index auf `roster_shifts (staff_id, location_id, shift_date, area)`
macht einen Halbtausch unmöglich — bei Kollision rollt die gesamte Transaktion
zurück, die Anfrage bleibt `peer_accepted`. Ablehnung setzt Status +
`decided_at/by` und hängt den Grund als „Ablehnung: …" an `note` an, ohne
den Dienstplan zu berühren. Roter Punkt via `getReviewPendingCounts.swapPending`
(zählt `peer_accepted` der Org, refetch 60 s). Telegram-Ping best-effort
beim `acceptSwapRequest`-Erfolg an alle `staff_telegram_links` mit
`receives_swap_alerts = true`; Fehler werden als `audit_log`-Eintrag
`swap.alert_failed` festgehalten (§51), kippen aber die Annahme NICHT.
Genehmigungs-UI liegt in `/admin/personal-antraege` unter dem Reiter
„Schichttausch" (peer_accepted-Karten oben, offene informativ darunter).

**Status:** TA1 ✅ / TA2 ✅ (E2E Frank ausstehend).

**TA3 (04.07.2026) — Portal-UI konsolidiert:** Der komplette
Tausch-Lebenszyklus liegt jetzt in `/zeit/schichten`. Reihenfolge
mobile-first: (1) „Tauschanfragen an dich" ganz oben, nur sichtbar wenn

> 0, mit Zähler-Badge und Übernehmen/Ablehnen (inkl. optionalem
> Gegentausch); (2) eigene Schichtenliste mit „Zum Tausch anbieten" bzw.
> Status-Badge; (3) einklappbare Sektion „Meine Tauschanfragen" mit
> Status, Ablehnungs-Fortschritt „N von M" und Stornieren. Die Karten
> wurden nach `src/components/tausch/SwapRequestCards.tsx` extrahiert
> (`OpenRequestCard`, `MyRequestCard`) — Server-Fn-Aufrufe, Dialoge und
> Regeln unverändert. Hub-Karte „Schichttausch" in `/zeit` entfernt;
> `/zeit/tausch` bleibt als `beforeLoad`-Redirect auf `/zeit/schichten`
> für Lesezeichen. Auf der Hub-Karte „Meine Schichten" sitzt ein
> Zähler-Badge (offene Anfragen an mich via `listOpenSwapsForMe`, Fehler
> = Badge weglassen — Hub darf nie blockieren).

## §VA1 — Verkaufsartikel (POS) (Stand: 04.07.2026)

**Zweck.** Standort-scope Liste der POS-Verkaufsartikel mit Verkaufs- und
Mitnahmepreis als **Auswertungs-Basis** für spätere Vectron-Umsatzabgleiche.
Bewusst getrennt von `articles` (Einkauf ≠ Verkauf).

**Schema.** Neue Tabelle `public.sales_articles` mit
`organization_id`, `location_id`, `name`, `product_group` (Vectron-WG-Nr.),
`price_cents`, `takeaway_price_cents`, `is_active`. Preise sind **nullable**
(NULL = POS-Technik ohne festen Preis: Modifikator, Sammel-PLU, Rabatt) und
per CHECK auf `>= 0` gebunden. **Voller** Unique-Index auf
`(location_id, name)` als Idempotenz-Anker für den Import (§51-tauglich für
`onConflict`). **Kein Delete-Pfad** — Artikel bleiben als Anker bestehen und
werden ausschließlich über `is_active = false` deaktiviert.

**Zugriff.** RLS aktiv, **DENY-ALL** — keine Client-Policies. Reads und
Writes ausschließlich über `src/lib/bestellung/sales-articles.functions.ts`
(`loadAdminCaller("manager")` + `supabaseAdmin`). Schreibaktionen laufen
durch `runGuarded` + Audit (`sales_article.created` / `sales_article.updated`
mit `before/after` der geänderten Felder). `location_id` wird vor jedem
Schreib-/Lesezugriff gegen die Org des Aufrufers validiert.

**UI.** Neuer Tab „Verkaufsartikel" im Bestellung-Bereich
(`/admin/bestellung/verkaufsartikel`). Standort-Pills (**kein „Alle"** —
Artikel sind standort-scope), Suche, Warengruppen-Filter, Toggle „inaktive
anzeigen". Tabelle mit inline editierbaren Preisspalten (Euro-Eingabe,
Komma/Punkt tolerant, intern Cents; Enter speichert, Escape verwirft) und
Aktiv-Switch. Preis NULL wird als gedämpfter „—" gezeigt. Handpflege für
Nachzügler über Dialog „Artikel anlegen".

**Import.** Frank importiert per SQL aus Vectron-Exporten
(`ON CONFLICT (location_id, name) DO UPDATE`), YUM zuerst (261 Artikel),
Spicery/TSB folgen. Import läuft direkt über die Datenbank, nicht über
die UI.

**Status:** VA1 ✅ Schema + UI (Import Frank ausstehend).

## §VA2 — Verkaufsartikel-Hierarchie (Stand: 05.07.2026)

Der Vectron-Vollexport liefert je Artikel die drei Ebenen **Hauptgruppe**
(z. B. „Küche" #5) → **Untergruppe** (z. B. „Vorspeisen" #12) →
**Warengruppe** (z. B. „Appetizer" #43, in `product_group`).

- Felder denormalisiert an `sales_articles`: `hauptgruppe`,
  `hauptgruppe_nr`, `untergruppe`, `untergruppe_nr`, `warengruppe` (der
  Klartext-Name zur bestehenden `product_group`-Nummer).
- Index `idx_sales_articles_gruppen` auf
  `(location_id, hauptgruppe_nr, untergruppe_nr, product_group)` für
  Gruppen-Sortierung und Filter.
- **Quelle der Wahrheit ist Vectron** — Pflege ausschließlich per
  Re-Import (Frank-SQL). Bewusst KEINE Lookup-Tabellen (Verwaltung ohne
  Nutzen; gleiche Pragmatik wie das BWA-Entity-Textfeld).
- UI: drei kaskadierende Dropdowns (Hauptgruppe → Untergruppe →
  Warengruppe) mit Default „Alle", Editier-Dialog pro Artikel mit
  Hinweis „Quelle Vectron — wird beim Re-Import überschrieben".
- VA1-Grundsätze unverändert: DENY-ALL, kein Delete-Pfad (Deaktivieren
  statt Löschen), Unique `(location_id, name)`.

### VA2-Importe beider Häuser (05.07.2026)

**Spicery:** Vectron-Vollexport (5 Dateien: artikel/hauptgruppe/kategorie/
untergruppe; yuntergruppe war ein identisches Duplikat) → 397 eindeutige
Artikel mit voller Hierarchie (135 Küche / 258 Getränke; 9 Sammel-PLU-Zeilen
verlustfrei dedupliziert, 30 Leer-Slots ausgeschlossen). Verifiziert.

**Fehl-Import + verlustfreier Rollback (Lektion):** Der Spicery-Export lief
zunächst versehentlich gegen YUM (Bestand deaktiviert, 397 fremde Artikel
upsertet). Rollback in einem Lauf: heutige Neu-Inserts per created_at
gelöscht, Bestand reaktiviert, Original-Werte aus der VA1-Quelldatei
re-upsertet (heilte auch die vom Upsert überschriebenen Namens-Überlapper).
Bit-genau verifiziert gegen den Freitags-Stand (261/10/34/32).
**Regel daraus: Import-SQLs tragen den Ziel-STANDORT prominent im Dateinamen
UND in der ersten Kopfzeile** (zusätzlich zur Ziel-DB).

**YUM:** eigener Vollexport (Mappe1/yum_2/yum_3/yum_4) → 294 eindeutige
Artikel (82 Küche / 172 Getränke / 35 Infotexte; 1982 Kassen-Slots, 1 Dublette,
1 Artikel ohne WG mit NULL-Hierarchie). deaktivierte_altartikel = 0: alle 261
VA1-Artikel namensgleich aktualisiert, 33 neu. YUMs Hierarchie ist anders
geschnitten als Spicerys (eigene Hauptgruppen wie Infotexte/Liefergebühr) —
bestätigt die Denormalisierungs-Entscheidung (Vectron-Wahrheit je Standort).

**Offen:** TSB-Export beim Aufsetzen des Standorts (Pipeline steht).

### VA3 — Einkaufspreis (05.07.2026)

`ek_price_cents` (BIGINT Cents, nullable, `CHECK >= 0`) an `sales_articles`;
Auslieferung server-seitig admin-only (Margen-Wissen — Manager sehen das
Feld weder in der Liste noch im Netzwerk-Response, Update-Pfad ignoriert
`ekPriceCents` schweigend für Nicht-Admins). Werte kommen per Frank-SQL aus
den Vectron-Exporten (Spicery 209, YUM 98). **Marge** wird nur abgeleitet
(Admin-Tooltip am EK: `preis − EK`, wenn beide vorhanden) — nie gespeichert.

## §56 AF1 — Task-Fotos (04.07.2026)

Aufgaben (`tasks`) unterstützen Foto-Anhänge (Kamera am Handy oder Datei-
Upload) für Melde-Zwecke („Spülmaschine E3") und Erledigt-Nachweise.

- Privater Bucket `task-photos` (DENY-ALL, keine Client-Storage-Policies).
  Auslieferung nur über signierte URLs (60 min) aus Server-Fn.
- Tabelle `public.task_photos` (organization_id, task_id, storage_path,
  mime_type, size_bytes, uploaded_by_staff_id). RLS aktiv, keine Policies —
  Zugriff ausschließlich serverseitig über `supabaseAdmin`.
- Server-Fn (`src/lib/aufgaben/task-photos.functions.ts`):
  `uploadTaskPhoto`, `listTaskPhotos`, `deleteTaskPhoto`, `countTaskPhotos`.
  Sichtbarkeit an Task-RLS gekoppelt (Aufrufer muss die Aufgabe lesen dürfen).
- Limits: max. 10 Fotos pro Aufgabe, ≤ 8 MB pro Bild (nach Kompression),
  MIME ∈ {jpeg, png, webp}.
- Client-Kompression vor Upload: Canvas, längste Kante 1600 px, JPEG 0.8;
  Fallback Original bei nicht dekodierbarem Bild (sofern ≤ 8 MB).
- Löschen: Uploader ODER `manager+`. Storage-Objekt und Zeile werden
  gemeinsam entfernt; bei Insert-Fehler wird das Storage-Objekt zurück-
  gerollt (Muster `uploadMyDocument`).
- Audit: `task.photo_uploaded` (meta: photoId, sizeBytes) und
  `task.photo_deleted` (meta: photoId, storage_path). Kein Bildinhalt im
  Audit.
- UI: Wiederverwendbare Komponente `TaskPhotoStrip` (im `TaskDetailDialog`),
  eingebunden im Portal (`/zeit/aufgaben`) und in der Admin-Ansicht
  (`/admin/aufgaben`). Foto-Anzahl-Badge (`📷 N`) auf `KanbanCard` aus
  `countTaskPhotos`-Batch-Query.

**Bucket-Nachzug (04.07., Konflikt-Meldung Lovable):** Der Bucket `task-photos`
existiert live und ist `public: No` — Sicherheits-Gate erfüllt. Eine
SQL-Migration zur Bucket-Anlage ist in diesem Stack plattformseitig blockiert
(`bucket_sql_blocked`): Buckets entstehen ausschließlich über das
Lovable-Storage-Tool und sind daher grundsätzlich nicht migrationsfähig.
Repo-Parität für Buckets = das Inventar in §3, nicht eine Migrationsdatei.

## §57 IMP1 — Vorschau-Identität: impersonation-bewusster Staff-Caller, strikt lesend (04.07.2026)

Vor IMP1 respektierten nur `me.functions` (UI-Banner) die aktive
Admin-Vorschau (`admin_impersonations`). `loadStaffCaller` löste weiterhin
den Admin selbst auf — Folge: unter „Vorschau als ANN" zeigten alle
Portal-Seiten die Daten des Admins statt der Zielperson.

- **Zentrale Auflösung.** Neue Datei `src/lib/admin/impersonation.ts` mit
  `resolveActiveImpersonation(supabase, adminUserId)` — genau EINE
  Aktiv-Logik, genutzt von `getMyIdentity` (UI-Banner) UND `loadStaffCaller`
  (Portal). `loadStaffCaller` (in `src/lib/time/time.functions.ts`) löst
  nach dem `user_links`-Lookup die aktive Vorschau auf und wechselt bei
  Treffer auf die Ziel-Person. Guards (Defense in Depth): Ziel-Staff
  existiert, ist in DERSELBEN Organisation wie der Admin, und der reale
  Aufrufer hat admin-Rolle (per `supabaseAdmin` re-validiert — RLS würde
  die Rollenprüfung sonst über `_effective_user_id` auf die Zielperson
  umleiten). Der `Caller`/`StaffCaller`-Typ trägt neu
  `impersonatedBy: string | null` (= `staff_id` des echten Admins bei
  Vorschau, sonst `null`). Damit zeigen ALLE lesenden Staff-Fns
  automatisch die Ziel-Person — ein Fix, überall wirksam.
- **Vorschau ist schreibgeschützt.** Zentraler Guard
  `assertRealIdentity(caller)` wirft
  „Die Vorschau ist schreibgeschützt — Aktion nicht möglich." und wird als
  ERSTE Zeile in jeder mutierenden Staff-Caller-Function aufgerufen:
  `clockIn`, `clockOut`, `createSwapRequest`, `cancelSwapRequest`,
  `acceptSwapRequest`, `declineSwapRequest`, `requestLeave`,
  `cancelMyLeaveRequest`, `createDayOffWish`, `deleteDayOffWish`,
  `submitWaiterSettlement`. Lesende Fns bleiben ungeguarded. Die
  Verweigerung schreibt KEINEN `audit_log`-Eintrag (B2a-Muster).
- **Nicht angetastet.** `loadAdminCaller` (Admin-Seiten arbeiten NIE
  impersoniert), `admin_impersonations`-Schema, Start/Stop-Fns und Banner.
- **UI.** Neuer Hook `useIsPreview()` (aus `identity.impersonation.active`).
  `/zeit/stempeln` deaktiviert Ein-/Ausstempeln-Buttons in der Vorschau mit
  Tooltip „In der Vorschau deaktiviert". Weitere Portal-Buttons zeigen
  bei Auslösung die Server-Fehlermeldung als Toast — die eigentliche
  Sicherung sitzt serverseitig.
- **Tests.** `src/lib/admin/impersonation.test.ts` deckt `assertRealIdentity`
  (echte Identität erlaubt, Vorschau verweigert) ab. Bestehende DB-Tests
  wurden auf das erweiterte `Caller`-Objekt (`impersonatedBy: null`)
  angepasst.

## §58 IMP1b — Auflösung zentral, Guards vervollständigt (04.07.2026)

IMP1 wurde ursprünglich dezentral nachgezogen — die Auflösung saß in
`loadStaffCaller`, aber mehrere Module hingen noch am alten
`loadAdminCaller`, der die Vorschau nicht kannte. Folge: EasyOrder-Kachel,
„Meine Daten"/Änderungsanträge/Dokumente, Task-Fotos und Kalender-Token
liefen weiter als Admin — die Vorschau war weder korrekt noch strikt
lesend.

- **Zentrale Auflösung, ein Ort.** `loadAdminCaller`
  (`src/lib/admin/admin-context.ts`) ist jetzt genauso vorschau-bewusst wie
  `loadStaffCaller`: bei aktiver Impersonation wird auf die Ziel-`staff_id`
  gewechselt, `impersonatedBy` gesetzt, und der Role-Lookup läuft über
  `supabaseAdmin` (die RLS auf `role_assignments` würde ihn sonst über
  `_effective_user_id` auf das Vorschau-Ziel umleiten und die Rolle des
  echten Admins ausblenden — genau der Bug, der die EasyOrder-Kachel unter
  Vorschau verschwinden ließ). Guards analog `loadStaffCaller`
  (Org-Bindung, Admin-Re-Validierung).
- **Guards vervollständigt.** `assertRealIdentity(caller)` als ERSTE
  Zeile in `placeEasyOrder` (EasyOrder), `updateMyContact`,
  `submitChangeRequest`, `uploadMyDocument` (Profil),
  `getOrCreateMyCalendarToken`, `revokeMyCalendarToken` (Kalender-Token —
  zusätzlich von einem eigenen `loadCallerLink` auf `loadStaffCaller`
  umgestellt) sowie `uploadTaskPhoto`, `deleteTaskPhoto` (Task-Fotos).
  Lese-Fns bleiben ungeguarded.
- **Signatur.** `assertRealIdentity` akzeptiert jetzt
  `impersonatedBy?: string | null`, damit sowohl `StaffCaller` (Feld
  required) als auch `AdminCaller` (Feld optional aus Rückwärts-Kompat mit
  Tests) ohne Cast passen.
- **Lektion.** Querschnitts-Identität gehört in den Caller, nicht in jede
  Datei. Wer `resolveActiveImpersonation` außerhalb von `loadStaffCaller` /
  `loadAdminCaller` / `me.functions` (UI-Banner) einbaut, öffnet exakt
  diese Lücken-Klasse wieder.

## Tagesabschluss 04.07.2026

Abgenommen bei HEAD `93b40898` (tsc/eslint 0/0, prettier sauber, vitest 1303
grün). Heute gelandet: Pool-Writeback-Fix (§51), Zeitübersicht-Welle,
Provision P1+P2 (§52), Telegram TG1+TG2+Cron (§53), Urlaubs- und
Stammdaten-Import (§54), Batch-Schichtzeiten BZ1, Zeit-Vollimport-Abschluss
(§10), Display D4, BWA F5, Schichttausch TA1–TA4 (§55), Verkaufsartikel VA1,
Task-Fotos AF1 (§56), Mitarbeiterliste MA1, Jahresplaner UP1+UP2,
Stempel-Warnung + Urlaubs-Sicht UA1, Vorschau-Identität IMP1/IMP1b (§58).

Offen: Franks E2Es (Vorschau als ANN, Jahresplaner, Stempel-Warnung,
ICS-Urlaub, Schichttausch-Volltest, BZ1 Peter, Provision, Verkaufsartikel,
D4-Display, Telegram-Cron 05.07. 07:05); Entscheidungen (A/B negative
Urlaubs-Überträge, UP3 ja/nein, „Meine Stunden"-Deltas); Nachlieferungen
(TSB-PaySlips, Spicery/TSB-Verkaufsartikel); geparkt (BZ2, Welle B,
MCP-Wiedereinführung, MailerSend-DNS).

## 68. TG3 — Küchen-Zeiten im Telegram-Bericht (05.07.2026)

TG3 (05.07.): `fmtBerlinTime` akzeptiert reine `HH:MM`-Strings
(Pool-Karten-Format) — Küchen-Zeiten im Bericht repariert; vorher lief
`new Date("15:00")` in `Invalid Date` und der Bericht zeigte
`(--:-- – --:--)`. Wissens-Notiz: `session_tip_pool_entries.shift_start/-end`
sind **Berlin-Wandzeit-Strings** aus `<input type="time">`, keine Timestamps —
neue Konsumenten müssen das reine `HH:MM`-Format akzeptieren, bevor sie ein
`Date`-Parsing versuchen. Tests in `telegram-report.test.ts` blockierend
(HH:MM, HH:MM:SS, ISO, null, Küchen-Zeile).

## §26.PL1 — Planer-Scope auf Urlaub, Schichttausch, Jahresplaner (05.07.)

Die planer-Seitenrolle hat jetzt im gleichen (Standort, Bereich)-Scope, in
dem sie bereits Dienstpläne schreibt (`permission_overrides` mit
`location_id + area`), zusätzlich:

- Urlaubsanträge sehen (`roster.leave.view_all`) und entscheiden
  (`roster.leave.decide`).
- Schichttausch-Anfragen sehen (`roster.swap.view_pending` — **neuer
  Enum-Wert**) und entscheiden (`roster.swap.decide` — **neuer Enum-Wert**).
- Jahresplaner (`getVacationPlanner`) für seine Standorte, reduziert auf
  seine Bereichs-Blöcke.

**Gemeinsamer Helfer** `resolvePlanerScope(supabase, admin, orgId, perm)` in
`src/lib/roster/scope-util.ts` — parametrisiert das frühere Muster aus
`getMyRosterScopes` auf beliebige Rechte. Rückgabe: `{ all: true }` für
admin/manager (globales `has_permission`-true via `permission_role_defaults`)
oder `{ all: false, combos: [...] }` für planer. `getMyRosterScopes` ruft
diesen Helfer jetzt selbst auf; Verhalten unverändert.

**Scope-Anker:**

- Urlaubsantrag: der Antragsteller muss eine `staff_locations`-Zeile mit
  einer freigegebenen `(location, department)`-Kombination haben.
- Schichttausch: die Schicht des Anfragenden (`roster_shifts.location_id +
area`) muss in der Kombi-Liste liegen.
- Jahresplaner: gewählter Standort muss im Scope liegen; nur der
  freigegebene Bereichs-Block wird zurückgegeben.

Die Entscheid-Fns (`decideLeaveRequest`, `decideSwapRequest`) validieren den
Scope am jeweiligen Anker **VOR** dem Schreiben — planer außerhalb seiner
Kombination bekommt `ForbiddenError`, kein Halbzustand.

**Rechte-Vergabe:** die vier Schlüssel sind im Katalog jetzt `scopable=true`;
`PermissionsTab` kann sie mit Standort und Bereich freigeben. Manager und
Admin bleiben unverändert über `permission_role_defaults` (globaler Scope);
planer bekommt KEINEN Default.

**UI/Nav:** Planer sieht neben `/admin/dienstplan` jetzt auch
`/admin/urlaub`. Die roten Badge-Zähler (`getReviewPendingCounts`) sind für
manager/planer freigegeben; für planer server-seitig auf Scope reduziert.
Die Personal-Daten-/Dokumenten-Zähler bleiben Admin-only.

**Nicht angefasst:** `role-guard.ts` (planer bleibt RANK 0), Dienstplan-
Verhalten, TA4-Regeln, `execute_shift_swap`- und `approve_leave_request`-
RPCs, Portal-Seiten der Mitarbeiter, `permission_overrides`-Schema.

Tests: `scope-util.test.ts` deckt `resolvePlanerScope` (all, allow, leer) und
`scopeIncludes` ab; bestehende `roster-scope-p2.db.test.ts` bleibt
Charakterisierung für den Dienstplan.

## §26.DP-A1 — Planer-Dienstplan-Ansicht (Bereichs-Tabs, 05.07.)

Rollen-gebundene Sonderansicht des Dienstplans für `planer`. Weiche in
`src/routes/_authenticated/admin/dienstplan.tsx` läuft ausschließlich über
`identity.role === "planer"` (kein Personen-Hardcode); alle übrigen Rollen
sehen die bestehende Seite (`AdminManagerDienstplan`) verhaltensgleich.
Neue Komponenten: `src/components/roster/PlanerRosterView.tsx` (Tabs
KÜCHE|SERVICE via URL-Search-Param `?bereich=kueche|service`, gemeinsame
Zyklus-Navigation 26.–25., einmal Paint-Toolbar/Skill-Filter pro Tab) und
`src/components/roster/RosterAreaBlock.tsx` (ein Standort × ein Bereich,
eigene per-Location-Queries für staff/shifts/release, Realtime-Kanal, DnD,
`RosterGrid` mit `visibleAreas=[area]`). Editierbarkeit pro Block via
`canEditScope(scopes, locationId, area)`; nicht editierbare Blöcke zeigen
ein „Nur Lesen"-Badge und rendern das Grid in einem `pointer-events-none`-
Wrapper (No-op-Handler) — die Serverdurchsetzung (PL1) bleibt die
eigentliche Sicherung. Für SUMITR ergibt das: Küche-Tab Spicery+YUM
editierbar, Service-Tab beide read-only.

## Tagesabschluss 05.07.2026

Abgenommen bei HEAD `96bf974d` (tsc/eslint 0/0, prettier sauber, vitest 1322
grün). Heute gelandet: TP-GL Pool-Regel, DR1 Ein-Klick-Druck (HTML-Druckansicht,
ein Datenobjekt mit PDF), KAB1 v2 (Auto-Save-Status, kontextueller
Status-Button, Druck koppelt Finalisieren, Admin-Checkbox Sperren,
`unlockSession`), ST1+ST1b Standort-Lebenszyklus (`is_active`, zentrale
Filterung, Klassifizierungs-Audit, Tipp-Lösch-Bestätigung), EIN1
Einstellungs-Tabs, TG3 Küchen-Zeiten im Telegram-Bericht, PL1
Planer-Erweiterung (Urlaub/Tausch/Jahresplaner im (Standort,Bereich)-Scope,
`scope-util`), Sumitr-Generalisierung; Telegram-Tagesbericht aktiviert und
per Testbericht bewiesen (Legacy-Bot-Abschaltung Frank-seitig),
Schichttausch-Verwaltung als Tab auf `/admin/urlaub`.

Offen: Franks E2Es (TSB deaktivieren, Finalisieren-&-drucken Safari + Kiosk-PC,
SUMITRs 8 Rechte-Klicks + Login-Test, Einstellungs-Tabs, erster automatischer
Nachtbericht); TSB-PaySlips + Verkaufsartikel-Listen Spicery/TSB;
Entscheidungen (A/B-Überträge, UP3); geparkt (BZ2, Welle B, MCP, MailerSend-DNS,
`maybeSingle`-Härtung `getCashOverviewCore`).

## 2026-07-05 — Tip-Formel im Tages-PDF/Druck zentralisiert (KGL-Grundsatz)

Tip-Formel im Tages-PDF/Druck korrigiert (alte `max(0, Differenz)`-Näherung
in `SettlementsCard`/`DailyPrintView`/`pdfExport` ersetzt) und auf
`computeTipTotalCents` (`src/lib/cash/tip-pool.ts`) zentralisiert — Regel hat
wieder genau eine Implementierung. Neues Feld `kassiert_brutto_cents` mit
`pos_sales`-Fallback im `PdfExportData`-Pfad. Blockierender Gleichheits-Test
`src/lib/cash/pdfExport-tip.test.ts` verhindert Rückfall auf Inline-Reduce.

## 2026-07-05 — EKZ1: EK-Zuordnungs-Werkbank (Verkaufsartikel → Einkaufsartikel)

Verknüpfung `sales_articles → articles` mit Portions-/Gebinde-ml gespeichert
(Quelle der Wahrheit), `ek_price_cents` als bewusst materialisierter Cache
(analog Pool-Snapshots). Neue Felder: `ek_source_article_id`, `ek_portion_ml`,
`ek_source_volume_ml`, `ek_match_ignored` — mit DB-CHECKs (beide ml gemeinsam
oder gemeinsam leer; Portion ≤ Gebinde; ignored ⊕ Verknüpfung).

Server-Fns (admin-only, `runGuarded` + Audit):
`searchPurchaseArticlesForEk`, `linkSalesArticleEk`, `unlinkSalesArticleEk`,
`setEkMatchIgnored`, `recalcAllLinkedEk`. Rechenweg lebt im pur getesteten
`src/lib/bestellung/ek-linking.ts` (`computeEkFromLink` = `price × portion /
source`, kaufmännisch gerundet); `recalcAllLinkedEk` zieht bei
Preisänderungen alles verknüpfte auf einen Knopfdruck nach.

UI: neuer Unter-Reiter „EK-Zuordnung" auf der Verkaufsartikel-Seite
(admin-only). Arbeitsansicht mit Status-Filter (Offen/Verknüpft/Manueller
EK/Ignorieren), Getränke-Vorfilter, Typeahead-Dialog mit Portions-Chips
(4 cl · 5 cl · 0,1–0,5 l · 1:1) + eigener ml-Eingabe und Live-Vorschau
inkl. Marge. Ignorieren-Flag ist Übergangsweg für Aufschläge/Hausmixe, bis
die Rezept-Welle nachzieht (1-Zutat-Spezialfall = jetziger Stand).

Bestehende EK-Werte (35 automatisch + 306 Vectron-Import) bleiben als
„Manueller EK" bis zur Zuordnung — nichts gelöscht.

**EK1 — Massen-Verknüpfung Getränke (06.07.2026):** 81 Verkaufsartikel per
Offline-Abgleich (CSV-Exporte, Token-Matching ohne Volumen-/Jahrgangs-
Rauschen, Volumen-Parser analog `extractVolumeMl`, Marge-Plausibilitäts-Gate
≥ 30 %) eindeutig mit Einkaufsartikeln verknüpft — 33 davon 1:1-Flaschen,
Rest anteilig (`ek_portion_ml`/`ek_source_volume_ml`, z. B. 0,2l-Glas aus
0,75l-Flasche). SQL setzte NUR die Verknüpfungsfelder (Guards: nie über
bestehende Links/Ignorier-Flags); Preise via `recalcAllLinkedEk` durch die
App berechnet. Live verifiziert: 82/82 Verknüpfungen mit EK-Preis, 0
CHECK-Verletzungen. Restarbeit bei Frank: 268 Werkbank-Kandidaten (197
Cocktails/Tees = Rezept-/Ignorieren-Fälle, 60 mehrdeutig), 13 eindeutige
Treffer mit Einkaufspreis 0, und als größter Hebel: 61 von 130
Einkaufs-Weinen sowie alle Biere ohne Einkaufspreis. Speisen bewusst
ausgeklammert (Rezept-Welle).

**EKW1 — Wareneinsatzquote (06.07.2026):** Ampel-Spalte „WE %" in beiden
Verkaufsartikel-Tabs (Liste + EK-Werkbank), Rechenweg zentral und
getestet in `ek-linking.ts`: `wareneinsatzQuote(ekCents, vkBruttoCents)`
= EK netto ÷ VK netto × 100 (VK ist brutto → ÷ 1,19; Konstante
`EKW_VAT_RATE`). Schwellen als Konstanten: grün ≤ 25 % · gelb ≤ 35 % ·
rot darüber (`WE_GRUEN_BIS`/`WE_GELB_BIS`). Werkbank zusätzlich:
Sortierung nach WE % und ungewichteter Ø im Filterkopf (Hinweis: echte
betriebliche Quote braucht Absatzmengen aus der POS-Statistik — spätere
Welle, dann je Warengruppe gewichtbar). Abgenommen HEAD 7dd5288d, vier
Gates grün (1463 Tests).

## §Z2 — Wochenplan zeigt Mitarbeiter je Zuordnung (Analogie zu D-3)

Ein Mitarbeiter erscheint im Wochenplan-Grid der Zeitübersicht in JEDER
Sektion, der er am Standort zugeordnet ist — auch mit 0,00 Stunden. Damit
verschwinden Mehrfach-Zuordnungen (z. B. kitchen + gl) nicht mehr aus der
Sichtbarkeit.

`time_entries` hat bewusst KEINE Abteilungs-Dimension: die Stunden einer
Person laufen deshalb immer auf einer einzigen Zeile auf. Die Regel:

- Primär-Abteilung = deterministische Priorität **kitchen > service > gl**
  über alle staff_locations-Zuordnungen der Person am Standort. Zentral in
  `src/lib/time/primary-department.ts` (`primaryDepartment`). Beide
  Aufbauten in `getTimeOverview` und `getWeeklyTimeEntries` sammeln erst
  alle Abteilungen je Staff und leiten dann die Primär-Abteilung ab —
  kein Last-write-wins mehr.
- Alle time_entries laufen auf der Primär-Zeile auf (Server setzt
  `entry.department = primär`).
- Sekundär-Zeilen (weitere Zuordnungen, z. B. GL bei Küchen-Primärkräften)
  erscheinen im Grid mit 0,00 und deaktivierten „+"-Zellen; Tooltip weist
  auf die Primär-Sektion hin. Verhindert die Verwirrung, dass ein auf der
  Sekundär-Zeile angelegter Eintrag nach dem Refetch in der Primär-Zeile
  auftaucht.

Scope: NUR das Wochenplan-Grid zeigt Mehrfach-Zeilen. Zusammenfassung,
Buchhaltungs-Export, Perioden und Lohnrechner bleiben bei einer Zeile pro
Person (Primär-Abteilung) — Summen führen niemanden doppelt. Eine echte
Abteilungs-Dimension auf `time_entries` (z. B. GL-Stunden trennen) wäre
eine eigene Welle.

## §Z3 — Abteilungs-Dimension auf `time_entries` (Wochenplan voll editierbar)

Z2 zeigte Sekundär-Zeilen nur grau und schreibgeschützt — nach Frank-Feedback
aus dem Echtbetrieb unbrauchbar. Z3 ersetzt den Anzeige-Kompromiss durch
echte Daten.

- Neue Spalte `public.time_entries.department` (NULL-fähig, Enum
  `staff_department`) + Index `(staff_id, business_date, department)`.
  NULL = unbestimmt (Stempel, Batch-Times, Pool-Writeback, Bestandsdaten) →
  Anzeige auf der Primär-Zeile wie bisher. Kein Backfill.
- Attribution zentral in `entryRowDepartment(entryDept, staffDepts)`
  (`src/lib/time/primary-department.ts`):
  - `entryDept` gesetzt & ∈ `staffDepts` → Eintrag gehört zu dieser Zeile.
  - `entryDept` NULL → Primär-Zeile (`primaryDepartment`).
  - `entryDept` gesetzt, aber Person am Standort nicht (mehr) zugeordnet →
    Primär-Zeile + ⚠ Warn-Tooltip. Kein stilles Verschlucken.
- Schreibpfade: nur die Wochenplan-Dialoge setzen die Spalte.
  - `createTimeEntryShift`: neues Zod-Feld `department` (optional);
    „+" übergibt die Abteilung seiner Zeile.
  - `setTimeEntryShift`: `department` optional — `undefined` lässt
    unverändert, ein Enum-Wert (oder `null`) hängt um. Wird über die
    Popover-Aktion „umhängen" auf der Person-Zelle bedient.
  - Serverseitige Validierung: die Abteilung MUSS in
    `staff_locations(staff_id, location_id)` liegen — sonst Ablehnung, kein
    Audit.
  - Audit-Meta `before`/`after` enthält `department`.
- Unverändert: Stempeln (`clockIn/clockOut`), Batch-Times, Pool-Writeback,
  Schichttausch, Importe — alle schreiben die Spalte nicht (NULL).
  Zusammenfassung, Buchhaltungs-Export, SFN, Lohn (M4), Perioden aggregieren
  weiter pro Person über alle Einträge und ignorieren `department` — eine
  Person erscheint dort weiterhin genau einmal.

Damit ist der Wochenplan-Grid ab Z3 voll interaktiv: „+" auf jeder Zeile,
Sekundär-Zeilen editierbar wie Primär-Zeilen, MOs GL-Stunden landen auf der
GL-Zeile.

## SD1 — Personalverwaltung admin/payroll-only (05.07.)

Auslöser: Manager-Sichtbarkeits-Review. Personalverwaltung (`/admin/staff`
Liste + Detailseite) war seit B1c für Admin UND Manager sichtbar; der
Personaldaten-/Lohn-Tab und `getStaffPersonalDetails` waren bereits sauber
auf admin/payroll begrenzt (kein Datenleck) — Kontaktdaten (E-Mail,
Telefon) und PIN aber flossen über `listStaff`/`getStaff` an Manager.

Neuregelung: Personalverwaltung ist admin + payroll. Konkret:

- Route-Gate: `/admin/staff` + `/admin/staff/$staffId` erlauben nur admin
  und payroll (Layout-Redirect). Manager erhalten die bestehende
  „kein Zugriff"-Behandlung, die Nav-Kachel „Mitarbeiter" ist für sie
  ausgeblendet. Payroll erreicht die Seiten über die eigene Tab-Leiste;
  die bestehende Tab-Logik (`showPersonal`, `canEditVacation`) bleibt
  unverändert.
- Server-Guards: `getStaff` → `["admin", "payroll"]`.
  `setStaffParticipatesInPool` → `"admin"` (einzige Verwendung sitzt in
  der Personalverwaltung).
- `listStaff` bleibt `manager`-lesbar (Konsumenten: Zeit-, EasyOrder-,
  Aufgaben-, Wein-Quiz-, Personal-Anträge-, Kasse-, Migrations-Seiten),
  liefert aber KEINE `email`/`phone`-Felder mehr. Kontaktdaten der Staff-
  Seiten laufen ausschließlich über `getStaff`. Regressionsschutz:
  `staff-list-shape.test.ts` prüft das Rückgabe-Shape auf Typebene.
- Suche im Staff-Grid greift entsprechend nur noch auf Anzeigename +
  Vor-/Nachname (E-Mail-Suche entfällt bewusst).

Ersetzt die B1c-Ursprungsentscheidung „Admin/Manager" formal.

### SD1b — Geburts-/Eintrittsdatum raus aus manager-lesbaren Readern (05.07.)

Nachschärfung zu SD1: `listStaff` (manager-lesbar) hat zwischenzeitlich
`date_of_birth` (für die Alters-Anzeige) und `employment_start_date` (für
die Tenure-Klammer) an alle Manager-Konsumenten geliefert, obwohl beide
Felder nur in `staff.index.tsx` (seit SD1 admin/payroll-only) genutzt
werden. Ergebnis: PII (inkl. Jahrgang) floss unnötig durch geteilte Reader.

Änderungen:

- `listStaff` liefert weder `dateOfBirth` noch `employmentStartDate`.
- Neuer Reader `listStaffPersonalSummary` (GET, admin/payroll,
  org-scoped) liefert genau diese beiden Felder pro Staff-Zeile; die
  Staff-Verwaltung ruft ihn zusätzlich zu `listStaff` auf.
- `getStaffForRoster` liefert statt `dateOfBirth` nur noch
  `birthdayMonthDay` (MM-DD, server-seitig via `slice(5, 10)`);
  `RosterGrid` vergleicht direkt gegen `iso.slice(5, 10)`. Jahrgang
  verlässt den Server nicht mehr.
- Regressionsschutz auf Typebene: `staff-list-shape.test.ts` (keine
  `dateOfBirth`/`employmentStartDate` mehr), neu
  `roster-staff-row-shape.test.ts` (kein `dateOfBirth`, dafür
  `birthdayMonthDay`).

Lektion: **Neue Felder in geteilten Readern immer gegen die Guard-Stufe
des Readers prüfen — nicht gegen die Seite, für die man sie gerade baut.**

### §PV1 — POS-Verkaufsstatistik (05.07.)

Neuer Bereich unter **Bestellung → POS-Verkauf**. Zeigt die von Frank aus
Vectron exportierten „Artikel-Berichte" je Standort in zwei Perioden
(`d365` = letzte 365 Tage · `alltime` = Gesamt seit Aufzeichnung) mit den
drei VA2-Gruppenebenen als Filter.

- **Tabelle `sales_article_stats`** — Spalten `location_id`, `period`,
  `nummer` (Vectron-PLU), `name`, `verkauf_count` (int, kann negativ sein
  bei Storno-/Rabatt-PLUs), `umsatz_cents` (bigint), `report_date`.
  Unique `(location_id, period, nummer)`, Index
  `(organization_id, location_id, period)`. **Kein FK** auf
  `sales_articles`, weil die Gesamt-Berichte historische/deaktivierte
  Artikel enthalten. **DENY-ALL** Policy (weder anon noch authenticated
  dürfen direkt lesen/schreiben).
- **Import = Frank-SQL** (Replace je Standort × Periode, mit
  Vectron-Fußzeilen-Kontrollsumme). Kein Upload-UI in dieser Welle.
- **Server-Fn `listSalesStats`** (`manager+`, org-scoped, location gegen
  Org validiert): lädt Stats + Verkaufsartikel des Standorts parallel und
  reichert per weichem Namens-Join (`enrichSalesStats`, siehe
  `src/lib/bestellung/sales-stats.ts`) die Gruppen an. Zeilen ohne
  Treffer landen im Bucket „Ohne Zuordnung" und werden in
  `unmatchedCount` gezählt.
- **UI**: Standort-Pillen, Perioden-Tabs, Freitext-Suche (Nummer oder
  Name), Gruppen-Filter (geteilte Komponente `SalesGroupFilter` — siehe
  Refactor unten) mit Zusatz-Option „Ohne Zuordnung" auf Hauptgruppen-
  Ebene, sortierbare Tabelle (Default Umsatz absteigend), Summenzeile
  über die aktuelle Filterung, Stichtags-Badge und klickbares Hinweis-
  Badge bei `unmatchedCount > 0`.
- **Refactor**: die kaskadierende Gruppen-Filter-Logik aus VA1 wurde in
  `src/components/bestellung/SalesGroupFilter.tsx` + reines Modul
  `src/lib/bestellung/sales-group-filter.ts` (mit Tests) extrahiert. VA1
  nutzt dieselbe Komponente — Verhalten identisch (Options-Ableitung,
  Reset-Effekte, `__all__`-Sentinel bleiben 1:1).

**Merkposten**: `sales_articles` hat aktuell keine Vectron-Nummer. Falls
der Namens-Join in der Praxis zu viele „Ohne Zuordnung" liefert, wäre
`vectron_nr` an `sales_articles` eine eigene kleine Folge-Welle
(harter Join per PLU statt weichem Namens-Match).

### §PV1a — POS-WG-Überschreibung (manuelles Gruppen-Mapping)

Ergänzt §PV1 um einen manuellen Ausweg für Statistik-Artikel, die kein
Namens-Match in `sales_articles` finden (typisch: historische
`[deaktivierte]`-PLUs, Umbenennungen, Vectron-Interna). Ohne diesen
Ausweg blieben solche Zeilen dauerhaft in „Ohne Zuordnung" hängen.

- **Tabelle** `public.sales_pos_group_overrides` mit `unique
(location_id, nummer)` — je Standort × PLU-Nummer genau eine
  Zuordnung. Spalten spiegeln die drei VA2-Ebenen als Snapshot:
  `warengruppe/product_group`, `untergruppe/untergruppe_nr`,
  `hauptgruppe/hauptgruppe_nr`. **DENY-ALL RLS** — kein Client-Zugriff.
- **Pflege** ausschließlich über Server-Fns in
  `src/lib/bestellung/sales-stats.functions.ts`
  (`setSalesStatsGroupOverride`, `clearSalesStatsGroupOverride`),
  `loadAdminCaller("manager")`, `assertLocationInOrg`. Auswahl über
  `warengruppeKey` (Warengruppen-Name oder `#<productGroup>` — identisch
  zum `deriveWgOptions`-Sentinel aus §PV1) → Server liest das
  Gruppen-Exemplar aus `sales_articles` und schreibt den vollständigen
  3-Ebenen-Snapshot.
- **Anreicherung** in `enrichSalesStats` (`sales-stats.ts`) priorisiert
  Override **vor** dem Namens-Join: `overrideByNummer.get(s.nummer)` →
  falls vorhanden, wird der Snapshot direkt übernommen, `overridden:
true`, `unmatched: false`. Nur ohne Override greift das weiche
  Namens-Match. Damit ist der Override der lokale, sichtbare
  Reparaturweg — kein Eingriff in `sales_articles`/VA2.

### §PV2 — POS-Verkauf: XLSX-Upload mit Review-Screen (05.07.)

Selbstbedienungs-Import für Frank nach dem Bilanz-Muster. Der bisherige
SQL-Weg (`INSERT ... ON CONFLICT`) bleibt als dokumentierter Alternativ-
/Reparaturweg bestehen — die vier verifizierten Erst-Importe stammen von
dort und dienen weiterhin als Cent-genauer Regressionsanker.

- **Parser** `src/lib/bestellung/pos-report-parser.ts` — headless,
  exceljs-frei. Eingabe: bereits extrahierte Zellen
  (`Array<Array<string|number|null>>`). Erkennt die 4-Spalten- und die
  6-Spalten-Variante des Vectron-Berichts **über die Kopfzeile**
  („Verkauf"/„€"), nicht per Positionsraten. Klammer-Strip für
  `[deaktivierte]` Namen. Fußzeile (`Nummer='*'`, `Name='Alle (Artikel)'`)
  → Kontrollsumme. Namenlose PLU-Zeilen wandern nach `skipped` und werden
  in die Kontrollsumme miteingerechnet — Warnung + Nachvollziehbarkeit
  ohne Import der Vectron-Interna. Checks (`footer_stueck`,
  `footer_umsatz`, `nummer_unique`) blockieren das Speichern; fehlt die
  Fußzeile, gehen die footer-Checks bewusst auf `ok: false` (kein stiller
  Skip — Vectron-Exporte haben sie immer).
- **RPC** `public.replace_pos_sales_stats(org, location, period,
report_date, rows jsonb)` — `SECURITY DEFINER`, `search_path=''`,
  `EXECUTE` nur für `service_role`. Löscht atomar alle Zeilen für
  (Standort × Periode) und importiert die geprüften neu (BIGINT cents).
- **Server-Fn** `replacePosSalesStats` in `sales-stats.functions.ts` —
  `loadAdminCaller("admin")` (Import = Datenhoheit, enger als das
  `manager+`-Lesen), `assertLocationInOrg`, Zod-Schema (Periode,
  Nicht-Zukunftsdatum, nicht-leere Zeilen, nicht-leere Namen). Der
  Client sendet als `footer` die um `Σ skipped` bereinigten Sollwerte;
  serverseitig gilt **strikte Gleichheit** (`Σ rows == footer`). Bei
  Mismatch: Ablehnung ohne Audit. Bei Erfolg: `audit_log`
  `pos_sales.replaced` mit
  `{ locationId, period, reportDate, rowCount, sumVerkauf, sumCents }`.
- **UI** — Button „XLSX importieren…" oben rechts im POS-Verkauf-
  Bereich, **nur für Admins sichtbar** (UX-Gate; Sicherheit hängt am
  Server, nicht am Button). Dialog: Periode + Stichtag (Default: aktuelle
  Ansicht bzw. heute), Datei-Upload, exceljs client-seitig, Review mit
  Summen-Karten, Checks-Tabelle (Soll/Ist, OK/Fehler), skipped-Warnliste,
  Warnungen als aufklappbares Detail. „Speichern" nur bei allen Checks
  grün; danach Toast mit Zeilen/Summen und `invalidateQueries` für die
  aktuelle Liste.
- **Nicht angefasst**: Schema von `sales_article_stats`, `listSalesStats`,
  `enrichSalesStats`, `SalesGroupFilter`, VA1–VA3, EKZ1, Kasse, Lohn,
  Zeit, Bilanz. Geld bleibt BIGINT cents, kein `localStorage`, keine
  Edge Functions — der Upload läuft rein client-seitig + TanStack-
  Server-Fn.
- **Erfolgsbeleg**: eine der vier Erst-Import-Dateien erneut hochladen
  (gleicher Standort/Periode) → alle Checks grün, Summenzeile
  unverändert (Idempotenz gegen den verifizierten Erst-Import), Audit-
  Eintrag `pos_sales.replaced` vorhanden.

## §Z3 — Nachtrag (umhängen-Popover-Sichtbarkeit)

- Der „umhängen"-Trigger unter dem Namen im Wochenplan wird nur gerendert,
  wenn die Person am Standort **mehr als eine** Abteilungs-Zuordnung hat
  (`staffDepts.length > 1`) und Einträge in der Woche existieren. Bei nur
  einer Zuordnung gibt es kein sinnvolles Ziel — der Link entfällt.
- Optisch dezent: der Trigger ist per Default unsichtbar
  (`opacity-0`) und erscheint erst beim Hover/Focus auf der Namenszelle
  (`group-hover:opacity-100`). Die Zeile bleibt ruhig, die Funktion ist
  einen Hover entfernt.

## §Z4 — Wochenplan-Filter: Bereich + Skill (nur Anzeige)

- Über der Wochen-Chip-Zeile stehen zwei zusätzliche Filter neben dem
  Suchfeld: eine Pill-Gruppe **„Alle · Küche · Service · GL"** und ein
  kompaktes **Skill-Dropdown** (Optionen aus `listSkills`, nach Kategorie
  gruppiert, mit Skill-Farbe als Punkt vor dem Namen). Alle drei Filter
  (Bereich, Skill, Suche) kombinieren per **UND**; Default je Filter
  ist „Alle". State lebt nur im Component (kein `localStorage`).
- Der Filter ist rein anzeige-seitig: er wirkt nur auf das Wochenplan-
  Grid. `entryRowDepartment`/Attribution, Server-Schreibpfade,
  Zusammenfassung, Buchhaltung, Perioden, Brutto/Netto und Provision
  bleiben ungefiltert. Die **XLSX/PDF-Exporte des Wochenplans folgen
  dem Bereich-/Skill-Filter bewusst NICHT** — sie exportieren weiterhin
  alle Bereiche/Skills, damit ein Export nie ein stilles Teil-Ergebnis
  wird (Suche wirkt wie bisher auch auf den Export).
- Sektionen ohne verbleibende Zeilen werden im gefilterten Grid
  ausgeblendet; ohne Filter zeigt der Wochenplan wie zuvor alle drei
  Bereiche.
- Datenpfad: `getWeeklyTimeEntries` liefert je `assignedStaff`-Zeile
  zusätzlich `skillIds: string[]` (Join `staff_skills`, org-gescoped).
  Die reine Filterlogik ist in `src/lib/time/weekly-filter.ts`
  (`filterWeeklyRows(rows, {dept, skillId, query}, rosterByStaff)`)
  ausgelagert.

### §Z4b — Dienstplan-basierter Match (Wochen-Scope)

Bereich- und Skill-Filter matchen seit Z4b **nicht** mehr die
Skill-Stammdaten (`staff_skills`), sondern die **Dienstplan-Realität
der angezeigten Woche** aus `roster_shifts`. Auslöser: „YUM · Küche ·
SPÜLEN" soll exakt die Personen zeigen, die in dieser Woche mit
SPÜLEN eingeplant sind — nicht jede, die den Skill grundsätzlich
könnte.

- **Datenpfad:** `getWeeklyTimeEntries` liefert zusätzlich
  `rosterByStaff: Record<string, { areas: Department[]; skillIds:
string[] }>` — ein `roster_shifts`-Select für `(location_id,
shift_date ∈ [weekStart..weekEnd])`, distinct je Staff aggregiert.
  Bei „Alle Standorte" merged der bestehende Client-Merge die
  `rosterByStaff`-Buckets (Union je Person über alle Standorte).
  `assignedStaff.skillIds` (Stammdaten) bleibt im Response-Shape für
  andere Konsumenten, wird vom Filter aber nicht mehr benutzt.
- **Semantik (verbindlich):**
  - **„Alle" + kein Skill:** volle Z2-Grundmenge (alle Zugeordneten,
    auch ohne Schichten der Woche) — Eintragen für Nicht-Eingeplante
    bleibt möglich.
  - **Bereichs-Pill:** nur Personen mit mindestens einer
    `roster_shifts`-Schicht dieses `area` in der Woche am gewählten
    Standort (bzw. an irgendeinem, bei „Alle Standorte").
  - **Skill-Filter:** nur Personen mit mindestens einer Schicht der
    Woche, deren `skill_id` dem gewählten Skill entspricht. Schichten
    mit `skill_id = null` zählen für den Bereichs-, **nicht** für den
    Skill-Filter.
  - **Bereich + Skill kombiniert:** entkoppelt über die Woche
    (Bereich UND Skill, je über irgendeine Schicht — dürfen
    verschiedene sein). Einfachste konsistente Regel; strengere
    Kopplung „selbe Schicht" nur auf Zuruf.
  - **Suche** kombiniert weiterhin per UND; Sektionen ohne
    verbleibende Zeilen werden ausgeblendet.
- **Hinweis in der Filterleiste:** solange ein Filter aktiv ist,
  steht neben den Filtern der dezente Text „Zeigt nur in dieser
  Woche entsprechend Eingeplante" mit Tooltip auf die Datenquelle,
  damit niemand Personen für „verschwunden" hält.
- **Tests** (`weekly-filter.test.ts`) decken den Frank-Fall
  (Skill-Stammdaten vorhanden, aber keine passende Schicht →
  versteckt), `skill_id = null` (Bereich trifft, Skill nicht),
  Bereich geplant/nicht geplant, Bereich + Skill über
  unterschiedliche Schichten und „Alle/Alle = Grundmenge" ab.

## §49 — Lektion: zod 4 UUID-Validierung

- `z.string().uuid()` prüft in zod 4 die Versions- und Varianten-Bits
  nach RFC 4122. Test-Dummies wie
  `"11111111-1111-1111-1111-111111111111"` sind **keine** gültige UUID
  und lassen `safeParse` scheitern. Fixtures müssen RFC-4122-konform
  sein, z. B. `"11111111-1111-4111-8111-111111111111"` (Version 4,
  Varianten-Bit `8`).
- Seit Z3 gibt es **keine optische Unterscheidung** mehr zwischen
  Primär- und Sekundär-Zeilen (kein Grau, kein Kursiv). Alle Zeilen
  sind gleichwertig editierbar; `isPrimary` bleibt intern nur für die
  NULL-Attribution relevant.
- Der „umhängen"-Trigger liegt als **Overlay** in der Namenszelle
  (`absolute bottom-0 right-0.5`), damit er beim Hover keine
  Zeilenhöhe reserviert — alle Wochenplan-Zeilen bleiben gleich hoch,
  auch bei Personen mit Mehrfach-Zuordnung.

## §PV3 — POS-Stundenbericht (Vectron „Stunden-Bericht (lang)")

- Neuer Tab **„Stundenbericht"** im POS-Verkauf-Bereich (Standort-
  umschalter + Perioden-Tabs wie §PV1). Umschaltung Umsatz ↔ Buchungen,
  Balkendiagramm 0–23 Uhr mit hervorgehobener Peak-Stunde, Tabelle mit
  Anteil und Ø/Buchung, Summenzeile reproduziert die Fußzeilen-Werte.
- **Schema** `public.pos_hourly_stats` (org × loc × period × hour) mit
  BIGINT `wert_cents` und `report_date`; `%Wert` wird **nie gespeichert**
  (derived value) — Anzeige-Anteil und Ø/Buchung sind reine
  Anzeige-Ableitungen (siehe `hourShare` / `avgPerBookingCents`). RLS
  aktiv, DENY-ALL-Policy, EXECUTE der RPC nur `service_role` — exakt das
  §PV1/§PV2-Muster.
- **RPC** `public.replace_pos_hourly_stats(org, location, period,
report_date, rows jsonb)` — atomarer Replace je (Standort × Periode).
- **Parser** `pos-hourly-parser.ts` headless (Zeilen-Arrays, exceljs nur
  in der UI). Trimmt führende Leerzeichen bei einstelligen Stunden,
  leere Anzahl/Wert-Zellen = 0, negative Werte (Storno) durchgereicht,
  Füllzeile „-" wird übersprungen. Fußzeile beginnt mit „Alle (Zeit"
  und liefert Kontrollsummen (`footer_anzahl`, `footer_wert`);
  fehlt sie, sind die Footer-Checks bewusst `ok=false`. Zusätzlich
  `hour_valid` (0–23, keine Duplikate). Warnung (nicht blockierend):
  je Stunde |%-Wert Datei − berechneter Anteil| > 0,15 pp.
- **Server-Fns** in `pos-hourly.functions.ts`: `listPosHourlyStats`
  (manager, org-scoped, `assertLocationInOrg`), `replacePosHourlyStats`
  (admin, Zod incl. `hour ∈ [0..23]` + eindeutig, Nicht-Zukunftsdatum,
  strikte Fußzeilen-Gleichheit; Mismatch → Fehler ohne Audit). Erfolgs-
  Audit `pos_hourly.replaced` mit `{ locationId, period, reportDate,
hourCount, sumAnzahl, sumCents }`.
- **Import-UI** wie §PV2: Standort/Periode/Stichtag, Datei → Parser →
  Review mit Summen-Karten & Checks-Tabelle, „Speichern" nur bei
  grünen Checks; danach Toast + `invalidateQueries`.
- **d365 vs. alltime**: aktuelle Frank-Exporte sind Gesamt-Aufzeichnung
  → als `alltime` importieren; `d365` ist für spätere 365-Tage-Exporte
  reserviert (Symmetrie zu §PV1).
- **Nicht angefasst**: `sales_article_stats`, PV1/PV2-Parser & UI, WG-
  Overrides, Z3, Kasse, Lohn, Bilanz. Geld BIGINT cents. Kein
  `localStorage`, keine Edge Functions.

## Tagesabschluss 05.07.2026 (abends)

**Verifizierter Stand:** HEAD `20c5e875`, 1422 Tests grün, 05.07.2026
abends — `tsc --noEmit` 0 Fehler, `eslint src/ --max-warnings=5`,
`prettier --check .` sauber, `vitest run` komplett grün.

### Abgenommen in einem Paket bei HEAD `20c5e875`

- **§Z3** — Abteilungs-Dimension auf `time_entries`, Wochenplan-Zeilen
  voll editierbar, inkl. Nachtrag zur „umhängen"-Popover-Sichtbarkeit
  (Trigger nur bei Mehrfach-Zuordnung).
- **§Z3-Optik-Fixes (zwei Nachträge)** — Grau-/Kursiv-Optik der
  Sekundär-Zeilen entfernt und „umhängen"-Trigger als **Overlay** in
  der Namenszelle (`absolute bottom-0 right-0.5`), damit alle
  Wochenplan-Zeilen unabhängig von der Zahl der Abteilungs-
  Zuordnungen gleich hoch bleiben.
- **§Z4** — Wochenplan-Filter Bereich + Skill (nur Anzeige;
  Buchhaltungs-Tab und Wochenplan-Export bewusst ungefiltert über
  `weeklyExportInput`).
- **§PV1a** — POS-WG-Überschreibung (`sales_pos_group_overrides`,
  DENY-ALL, manager-Server-Fn, Override vor Namens-Join).
- **§PV2** — POS-Verkauf-XLSX-Upload mit Review-Screen und striktem
  Fußzeilen-Gate.
- **§PV3** — POS-Stundenbericht (Chart+Tabelle, Upload nach PV2-
  Muster).
- **zod-4-UUID-Testfix** — Fixture-UUIDs in
  `pos-report-server.test.ts` auf RFC-4122-konforme Werte gezogen
  (Schema-Code unverändert; nur die Fixture war ungültig).

### Real-Datei-Validierung PV3 (durch Claude)

Beide Vectron-Stundenberichte laufen **cent-exakt** durch
`parsePosHourly` — alle Gates grün, null Warnungen:

- Spicery (`spicery_h.xlsx`, `alltime`): **101.283 Buchungen /
  9.817.288,78 €**, Peak 19:00 (~32 %).
- YUM (`yum_h.xlsx`, `alltime`): **97.695 Buchungen /
  8.383.044,04 €**, Peak 19:00 (~29 %).

Upload durch Frank ist damit freigegeben.

### Offene E2E-Punkte (Frank)

- **§PV3** — Stundenbericht-Uploads beider `_h`-Dateien im UI.
- **§Z3** — Praxis-Check: GL-Eintrag bleibt auf GL (GERARD-Beispiel
  bereits erfolgreich).
- **§Z4** — Filter-Rundgang (Pill „Küche" + Skill „CO", Suche,
  Reset auf „Alle"/„Alle").
- **Optional §PV2** — Idempotenz-Reupload (Replace je Standort ×
  Periode).

### Berechtigungs-Kapitel des Tages

Korb-1-Aufräumen (Inaktive + Viktoria-Regel, per Rest-Check-CSV
belegt) sowie **SD1/SD1b** abgeschlossen — Details siehe die eigenen
Berechtigungs-Notizen; hier nur als Referenz-Einzeiler.

## §DP1 — Display-Erinnerungen (wiederkehrende Warnbanner)

Auf dem öffentlichen Standort-Display (`display.$locationId`) erscheinen
farbige, sanft pulsierende Warnbanner (z. B. „🗑️ Biotonne rausstellen",
„🧺 Wäsche in den Aufzug stellen"). Sie werden je Standort verwaltet, sind
rein anzeigend — kein Quittieren, kein Workflow (v1).

### Datenmodell — `public.display_reminders`

- Titel, Emoji (optional), Farbe (`grau|braun|blau|gruen|gelb|orange|rot|violett`).
- Wochentag (0=Montag … 6=Sonntag, ISO).
- Rhythmus `interval_weeks` ∈ {1, 2}; bei 2 ist `anchor_date` Pflicht
  (definiert die Parität, geprüft über `(businessDate − anchorDate) mod 14 = 0`).
- `from_time`, `until_time` (Berlin-Wandzeit), `is_active`, `sort_order`.
  DP1b: `until_time <= from_time` bedeutet Ende über Mitternacht in den
  frühen Morgen desselben Geschäftstags (Cutoff 03:00 — serverseitig per Zod
  validiert).
- RLS: DENY-ALL. Zugriffe nur über Server-Fns
  (`src/lib/display/reminders.functions.ts`), Muster analog `sales_article_stats`.

### Aktivierungs-Logik — `src/lib/display/reminders.ts`

Reines Modul, getestet, ohne DB/React — läuft server- wie clientseitig.

- `remindersForBusinessDate(list, businessDate)` — Vorfilter auf Wochentag
  und Parität, ohne Uhrzeit-Check.
- `isReminderActive(r, nowBerlin, businessDate)` — zusätzlich Uhrzeit-Gate.
  Wichtig: als Zeitpunkt-Vergleich, nicht als naive Uhrzeit — nach Mitternacht
  ist 00:30 des Folgekalendertags weiterhin ≥ 20:00 des Geschäftstags
  (3-Uhr-Cutoff-Semantik wie überall). Fenster ist halb-offen
  `[from_time, until_time)`; bei `until_time <= from_time` rutscht das
  Ende einen Kalendertag weiter (gleicher Geschäftstag).
- `nowBerlinParts(now)` — Berlin-Wandzeit-Parts für den Client.

Server (`api/public/display.$locationId`) schickt **alle heutigen** Reminder
(auch noch nicht fällige), damit der Client ohne Refetch pünktlich zur
`from_time` einblenden kann. Client re-evaluiert im 1-Sekunden-Tick (nötig
für den 15/15-Vollbild-Wechsel).

### DP1b — Vollbild-Wechsel 15/15

Sobald mindestens eine Erinnerung fällig ist, blendet das Display abwechselnd
**Phase A** (15 s Vollbild-Warnung, Tonnenfarbe, riesiges Emoji + Titel;
mehrere fällige Reminder erscheinen gestapelt) und **Phase B** (15 s normale
Dienstplan-Ansicht) ein. Der Phasen-Takt wird **deterministisch** aus der
Uhrzeit abgeleitet (`floor(sekundenSeitMitternacht / 15) % 2`), nicht aus
Component-Mount-Timern — mehrere Displays laufen synchron, Refreshes erzeugen
kein Springen. Der frühere Mittel-Balken mit `animate-pulse` bzw. das
separate `animate-reminder-blink` entfallen ersatzlos; die Aufmerksamkeit
kommt aus dem Vollbild-Wechsel.

### Verwaltung

`admin/aufgaben` bekam eine Tab-Leiste: **„Board"** (Kanban, unverändert)
und **„Aufgaben-Display"** (Reminder-CRUD). Der Standort-Umschalter der
Seite gilt für beide Tabs. Rechte: `manager`+`admin` der eigenen Organisation.
Audit-Actions: `display_reminder.created|updated|deleted`.

### Bewusst NICHT in v1

- Kein Quittieren am Display (bräuchte einen Token-Schreibpfad — eigene Welle).
- Kein Ablauf-Feld; Banner endet mit dem Geschäftstag.
- Kein localStorage/keine Edge Functions.

### Modul-Status

- `src/lib/display/reminders.ts` — pure Logik, 11 Tests grün.
- `src/lib/display/reminders.functions.ts` — Server-Fns (list/create/update/delete).
- `src/components/aufgaben/RemindersAdmin.tsx` — Verwaltungs-UI im Tab.
- `src/routes/display.$locationId.tsx` — `ReminderStack` mit `animate-pulse`.

## Nachtschicht 05./06.07.2026

**Verifizierter Stand:** HEAD `9be78c9c`, 1439 Tests grün, 06.07.2026 —
`tsc --noEmit` 0 Fehler, `eslint src/ --max-warnings=5`,
`prettier --check .` sauber, `vitest run` komplett grün.

### Abgenommen in einem Paket bei HEAD `9be78c9c`

- **§KAB2 + DR2–DR4** — Tagesabrechnungs-Feinschliff (Ein-Knopf-Druck-
  Vorbereitung, Warnbanner, Trinkgeld-Rest-Übernahme) inklusive der
  begleitenden Druck-/PDF-Anpassungen.
- **§DP1** — Display-Erinnerungen (wiederkehrende Warnbanner je Standort,
  Wochentag/Parität, Berlin-Uhrzeit-Gate, `display_reminders` DENY-ALL).
- **§DP1b** — Vollbild-Wechsel 15 / 15 mit `until_time`, deterministischer
  Phasen-Takt aus der Uhrzeit (kein Component-Timer); der frühere
  Mittel-Balken samt `animate-reminder-blink` entfällt ersatzlos.
- **§NAV1** — Navigation konsolidiert: „Stammdaten & Dokumente" heißt jetzt
  **Personal-Anträge** (admin-only); **Dokument-Vorlagen** wandern als
  Sub-Tab unter „Mitarbeiter" (Top-Gruppe „Dokumente" entfällt).
- **Struktur-Umbauten (NAV1-Welle)** — POS-Verkauf, Verkaufsartikel und Wein
  laufen als Top-Routen (`/admin/pos-verkauf`, `/admin/verkaufsartikel`,
  `/admin/wein`) statt unter `/admin/bestellung/*`; POS-Verkauf sitzt unter
  „Auswertungen", Verkaufsartikel + Wein + Mitarbeiter unter „Stammdaten",
  **Standorte** wandert unter „Einstellungen". `/admin/aufgaben` bekommt zwei
  Sub-Tabs **Board** (Kanban) und **Aufgaben-Display** (Reminder-CRUD) —
  die frühere Inline-Tabs-Leiste ist weg.
- **§TH1 — Standort-Farbthema** — `LocationThemeProvider` im
  `_authenticated`-Layout hält den Theme-Key
  (`spicery` | `yum` | `neutral`). `LocationPills` melden ihre Auswahl per
  `useLocationThemeSync`; Namens-Mapping enthält „spicery" → spicery,
  „yum" → yum, sonst neutral (TSB bleibt bewusst neutral). Aktive Pille
  färbt sich (Gelb #FACC15 / Rot #F08A7A, schwarze Schrift), Layout-Canvas
  bekommt pastelligen Hintergrund. `PillSelect` färbt nur mit `themed`-Prop;
  alle anderen PillSelect-Verwendungen bleiben pixelgleich. Druck (`@media
print`) resettet das Theme.

### Real-Datei-Validierung Stundenberichte (cent-verifiziert)

Nach den PV3-Uploads wurde per SQL gegen `sales_pos_hourly` gegengeprüft —
beide Häuser stehen cent-exakt an denselben Werten wie die Vectron-
Rohdateien:

- Spicery: **101.283 Buchungen / 9.817.288,78 €**.
- YUM: **97.695 Buchungen / 8.383.044,04 €**.

### Offene E2E-Punkte (Frank)

- **§DP1/DP1b** — Display-Erinnerungen live am Abend beobachten
  (Vollbild-Wechsel 15/15, mehrere gleichzeitig fällige Reminder).
- **§TH1** — Farb-Rundgang durch Spicery/YUM/„Alle" auf Zeit-, Kasse-,
  Dienstplan- und Aufgaben-Display-Seiten; TSB-Farbe bleibt bewusst
  neutral, endgültige Farbe noch unentschieden.
- **§KAB2** — Ein-Knopf-Druck beim nächsten echten Tagesabschluss
  (Praxistest, kein Testlauf).

## 69. Rezeptur-Modul (R1–R2b, 06.07.2026)

**Zweck.** Speisen-Kalkulation als **dritte EK-Herkunft** neben Getränke-1:1-Link
(EKZ1) und manuellem EK. `ek_price_cents` bleibt der materialisierte Cache;
`recalcAllLinkedEk` rechnet jetzt **drei Quellen** (1:1, Rezept, Manuell
unberührt) und liefert `{updated, skipped}` — Übersprungene (fehlender
Gebinde-Inhalt, Zyklus) werden in der Werkbank angezeigt. Die
Wareneinsatz-Ampel (EKW1) gilt damit **unverändert auch für Speisen**.

**Datenmodell** (Migrationen `20260706155548` Enum-only + `20260706155630`):

- `recipes` — `kind` (`dish` / `sub`), Subs mit **Pflicht-Ausbeute**
  (`yield_quantity` / `yield_unit`), Notizfeld. CHECK `recipes_yield_chk`:
  Sub ⇒ Ausbeute Pflicht, Gericht ⇒ Ausbeute verboten.
- `recipe_items` — Zutat = **Artikel ODER Sub-Rezept per XOR-CHECK**
  (`recipe_items_source_xor`), Menge, Einheit (`g` / `ml` / `stk`),
  `loss_percent 0–90`, Selbstbezugs-CHECK (`recipe_items_no_self`).
- `articles.content_quantity` / `content_unit` — „Inhalt je Inventureinheit"
  (z. B. 1 kg = 1000 g). Pflege **on demand im Editor** (kein Backfill).
- `sales_articles.recipe_id` (`ON DELETE RESTRICT`) mit XOR gegen
  `ek_source_article_id`; der bestehende Ignoriert-Guard ist erweitert.
- **RLS**: deny-all-Hausmuster auf `recipes` und `recipe_items` (keine
  Client-Policies, alle Reads/Writes über Server-Fns mit `supabaseAdmin`).
  Inventur-Liste der deny-all-Tabellen um `recipes` und `recipe_items`
  ergänzt → **achtzehn deny-all-Tabellen**.

**Rechenkern `src/lib/bestellung/recipe-costing.ts`** (rein, getestet):

- Preis je Basiseinheit über das **E1-Modul `unit-conversion.ts`**
  (wiederverwendet, kein Duplikat) ÷ `content_quantity`.
- **Verlust IMMER als Ausbeute**: `qty / (1 − loss/100)` (10 % Verlust ⇒
  ÷ 0,9, nicht × 1,1 — häufigster Rechenfehler, deshalb hier festgehalten).
- Sub-Kaskade mit **Zyklen-Erkennung** und **Tiefenlimit 5**.
- Fehlerklassen `MissingContentError` / `UnitMismatchError` / `CycleError`
  / `DepthError` / `MissingDataError`.
- **Rundung nur am Ende** (`Math.round` in `costRecipeCents`); Sub-Kaskaden
  fliessen unrudiert.
- **Einheiten-Regel**: Zeilen-Einheit MUSS `content_unit` des Artikels bzw.
  `yield_unit` des Subs entsprechen — im Editor **per Konstruktion
  erzwungen** (Einheit nicht wählbar), **keine g↔ml-Umrechnung** (ehrlich
  statt Dichte-Raterei).

**Rechte.** Neue Permission **`recipes.manage`** (Rollen-Defaults `admin` /
`manager`; im Rechte-Tab vergebbar). Für Planer (Sumitr) als **GLOBALER
Override** (`location = NULL`) — Rezepte sind org-weit, daher hier bewusst
globaler `assertPermission`-Check **OHNE** `resolvePlanerScope` (Abgrenzung
zur PL2-Regel im Code-Kommentar der Functions dokumentiert).

**Server-Fns `recipes.functions.ts`.** `listRecipes` (mit
Verwendungszählern), `getRecipe`, `upsertRecipe`, `deleteRecipe`
(RESTRICT-Fehler übersetzt), `setRecipeItems` (Replace-all,
**Zyklen-Check vor Schreiben**), `setArticleContent`,
`linkSalesArticleRecipe` / `unlinkSalesArticleRecipe` (Cross-Org-Guards,
Link setzt `ignored=false`), `listRecipeArticleCandidates` — alle
audit-geloggt, Listen via `selectAllPaged`.

**UI (R2 / R2b).** Dritter Tab „Rezepte" (Gerichte / Zwischenrezepte,
Suche, Duplizieren); Editor mit Zutaten-Typeahead (Artikel + `SUB:`-Rezepte),
Live-Kosten aus dem Rechenkern (importiert), Kosten-Breakdown absteigend,
Inline-Pflege fehlender Gebinde-Inhalte, Verknüpfungs-Sektion mit
**WE-%-Ampel**. Anlage **vom Verkaufsartikel aus** (R2b): „+ Gericht" fragt
zuerst den Verkaufsartikel ab (Name vorbefüllt, sofort verknüpft; 1:1-Fälle
ausgegraut), „Rezept anlegen"-Link in der Verkaufsartikel-Liste, „Aus
Zutaten berechnen" im Werkbank-Dialog; der freie Weg **ohne** Artikel
bleibt.

**Abnahmen.**

- **R1** HEAD `62bcf8d0` — 1479 Tests (+16 Rechenkern).
- **R2** HEAD `dbdf3f45` — 1483 Tests.
- **R2b** HEAD `8685dfb3` — vier Gates grün (`tsc`, `eslint`, `prettier`,
  `vitest`).
- **Live-DB-Verifikation R1** per CSV: Tabellen 2 / Client-Policies 0 /
  CHECKs / Rollen-Defaults 2.

**Offen.** Golden-Master-Referenzgericht **Tom Kha Gai** — Kalkulations-CSV
mit Franks Einkaufspreisen liegt vor (~2,67 €/Hauptgericht-Portion).
Ausstehend: Franks Portions-Mengen + **vier Daten-Klärungen** —
Galanga-Preisbasis, Fischsaucen-Gebinde, Kaffirlimettenblätter / Schalotten
als Artikel anlegen, Eigenfond als erstes Sub-Rezept.

## 70. Betriebskalender, Schichtbetrieb & Trinkgeld-Modell (RT1/UZ1/SP1/TG1/SP1b, 07.07.2026)

**Leitprinzip (Frank):** Alles generell gebaut, aber **schlafend** — Aktivierung nur per aktivem Schalter je Standort; YUM/Spicery verhalten sich nach dem Merge exakt wie vorher (einzige bewusste Ausnahme: die Feiertags-Urlaubsregel, siehe UZ1 — von Frank als sofort wirksame Fehlerkorrektur bestätigt).

**RT1 — Betriebskalender.** `location_rest_days` (ISO-Wochentag 1–7, unique je Standort) + `location_calendar_exceptions` (Einzeldatum, `kind` `closed`/`open` — Betriebsferien UND Sonderöffnung am Ruhetag), beide deny-all (RLS-Inventur damit **zwanzig** Tabellen — Liste um beide ergänzt). Reines Modul `business-calendar.ts`: `isClosedDay` — Ausnahme schlägt Wochentag. Serverseitiger Guard `assertDayOpen` in Schicht-Anlegen/Verschieben (**Löschen bewusst frei**); Grid zeigt geschlossene Tage grau mit blockiertem Malen, Alt-Schichten auf geschlossenen Tagen rot gerahmt; Display kennzeichnet „Ruhetag"; Stempeln bleibt frei (nur Hinweis). Einstellung: Stammdaten → Standorte → „Betriebskalender". **Bewusst offen:** Statistik-Umstellung „Ø je Öffnungstag" = Folge-Baustein RT2.

**UZ1 — Urlaubszählung.** `organization_settings.count_holidays_as_leave` (Default `false` = gesetzliche Feiertage zählen **NICHT** als Urlaubstage — korrigiert den Altzustand, in dem Feiertage Urlaubstage verbrauchten; wirkt sofort und rückwirkend in allen Anzeigen, da live gerechnet). `countLeaveDays(start, end, holidayDates?)` rückwärtskompatibel; Feiertage via `holiday-utils.ts` aus dem **wiederverwendeten** `bavarianHolidayMap` (`shift-hours.ts`, jetzt exportiert). Org-Schalter in den Einstellungen.

**SP1 — Schichtbetrieb (Servicezeiten).** `locations.day_service_enabled` (Default aus) + `roster_shifts.service_period` (`mittag`/`abend`, Default `abend`), Unique-Key erweitert auf `(staff, location, date, area, service_period)`. `mittag` serverseitig nur bei aktiviertem Tagesbetrieb. Grid: Fenster-Umschalter (Segmented Control) nur bei aktivierten Standorten; Cross-Booking fenster-bewusst via reinem Modul `cross-booking.ts` — gleiches Fenster woanders = Konflikt (rot, hat Vorrang), anderes Fenster = Info. Der Dienstplan bleibt **uhrzeiten-los** (D-1); `service_period` ist ein Planungsfenster, keine Uhrzeit.

**SP1b — Anzeige-Verfeinerungen.** Display rotiert bei Tagesbetrieb-Standorten MITTAG/ABEND als Vollbild-Blöcke mit großem Titel und zeitgesteuerter Priorität (`DISPLAY_PERIOD_SWITCH_HOUR = 15`, Konstante); Grid zeigt Gegenfenster-Marker ☀︎/☾ auf besetzten Zellen; Zeitübersicht/„Meine Schichten" tragen ein rein **abgeleitetes** „Mittag/Abend"-Badge (`derivePeriodLabel` nach Startzeit — nie gespeichert, die Uhrzeit bleibt die einzige Wahrheit; Badge nur an Tagesbetrieb-Standorten).

**TG1 — Trinkgeld-Modell je Standort.** `locations.tip_service_pool_enabled` (Default an) + drei Override-Spalten (`kitchen_tip_rate_override` ≤ 0,2, `tip_pool_min_hours_override`, `kitchen_manual_only_override`; `NULL` = Org-Standard). Loader `tip-settings.ts` mit Vererbung (Simphony-Muster: Org-Standard, Standort überschreibt). **Pool aus** (TSB-Modell „jeder behält seins, Küchen-Abgabe läuft weiter"): `serviceShares = []` und `serviceRemainder = 0` — bewusst **NICHT** „Rest = Pool" (kein Phantom-Rest); Kellner-Ansicht zeigt Hinweistext, Rest-Ansicht „—", Statistik weist „kein Pool" aus. Charakterisierung bewiesen: bestehende tip-pool-Tests unverändert (0 gelöschte Zeilen).

**Abschluss-Warnung (Lehre aus dem 423-€-Vorfall 02.07.).** `poolNeedsHoursWarning` + serverseitiger `PoolHoursWarningError` beim Finalisieren — ein Abschluss mit aktivem Pool > 0 € bei 0 anrechenbaren Minuten erfordert **explizite Bestätigung**, die als `poolHoursWarningConfirmed: true` im `audit_log.meta` landet. (Der Vorfall selbst: Service-Pool-Einträge des 02.07. hatten 0 Minuten → Rest = kompletter Pool 423,07 €; Daten-Fix per SQL, Verteilung ist reine Anzeige ohne Buchungs-Konsumenten.)

**Abnahmen.** RT1+UZ1+SP1 HEAD `8cfdbc1d` (1505 Tests, Live-CSV: Tabellen/Spalten/Policies/Setting verifiziert), TG1+SP1b HEAD `ddf6cb1a` (1522 Tests). Alle vier Gates jeweils grün.

## 71. Monitoring & Impersonation-Härtung (P1/IMP2, 07.07.2026)

**P1 — Fehler-Monitoring (Sentry).** Leichtgewichtiger Envelope-POST direkt an die Sentry-API (bewusst **KEIN** Server-SDK — Worker bleibt schlank, `sentry.server.ts`), No-op ohne `SENTRY_DSN`, „wirft nie". Angedockt am zentralen `runGuarded`-Fehlerpfad (`reportGuardedFailure` in `admin-call.ts`); Client-Init in `__root` via `@sentry/react`, DSN kommt über Server-Fn. Event-Inhalt bewusst **datensparsam**: `op`, `org_id`, `role`, `route`, `critical` — **KEINE** Personendaten, **KEINE** Payloads, **KEINE** Tokens (§7). **Ausnahme-Filter:** `ForbiddenError` (erwartetes Fachverhalten) und `PoolHoursWarningError` (erwarteter Bestätigungs-Ablauf; namensbasierter Check gegen Zyklus admin↔cash) werden **NICHT** gemeldet. **Regel für neue Fachfehler-Klassen:** erwartete Kontrollfluss-Fehler in den Filter aufnehmen, sonst verrauscht der kritische Kanal.

**IMP2 — Impersonation-Ablauf.** Admin-Vorschau verfällt automatisch nach `IMPERSONATION_MAX_MINUTES = 60` (reiner Helfer `impersonation-expiry.ts`, getestet inkl. Grenzfall); serverseitig durchgesetzt, Aufräumen über denselben Pfad wie manuelles Beenden mit Audit-Grund `expired`; Banner zeigt Restzeit.

**Abnahme.** HEAD `938ce382`, vier Gates grün (1534 Tests).

**Frank-seitig offen.** Sentry-DSN im Deployment setzen + Testfehler-Probe (und gegenprüfen, dass ein Finalize mit Pool-Warnung **KEINEN** Alarm erzeugt); Impersonation-Ablauf-Test (`started_at` per SQL 61 min zurückdatieren).

## 72. Migrations-Replayfähigkeit, E2E-Härtung & Schema-Parität (BFIX3–7, P2b–i, SP2, 07.07.2026)

**Anlass.** Der erste lokale E2E-Lauf (P2) deckte auf, dass die Migrationskette NICHT frisch replayfähig war — drei Wochen unbemerkter Drift zwischen Live-DB und Kette. Der non-blocking `db-integration`-Job (siehe §8) hatte den Drift verschluckt. In einer Vormittags-Session iterativ geheilt:

- **BFIX3.** `REVOKE` auf die plattform-eigene Event-Trigger-Funktion `rls_auto_enable` (existiert nur live) in `20260616210803` mit Existenz-Guard (DO-Block gegen `pg_proc`) versehen.
- **BFIX4.** 45 nachträgliche Enum-Werte (u. a. 38× `app_permission`) in die ursprünglichen `CREATE TYPE`-Listen aufgenommen; die späteren `ADD VALUE IF NOT EXISTS` bleiben als No-ops erhalten. Hintergrund: Postgres 55P04 — per `ADD VALUE` neu hinzugefügte Enum-Werte sind in derselben Transaktion **unbenutzbar**, `CREATE TYPE`-Werte sind es sehr wohl.
- **BFIX5.** `day_off_wishes` (live direkt angelegt, nie migriert) per `CREATE TABLE IF NOT EXISTS` in `20260618062940` zurückgeholt (Schema aus `types.ts` gespiegelt).
- **BFIX6.** `shift_swap_requests` wurde 24 min NACH ihrer ersten FK-Referenz erzeugt — CREATE-Block wortgleich in `20260704144135` vorgezogen (Original bleibt als No-op stehen).
- **BFIX7.** Vollständiger Spalten-Diff Live ↔ Kette (84 Tabellen / 912 Spalten via `information_schema`-Exporte): genau EINE echte Lücke — `payment_terminals.is_gl` (`boolean NOT NULL DEFAULT false`) — per End-of-chain-Migration mit `ADD COLUMN IF NOT EXISTS` geschlossen. Kette und Live sind damit deckungsgleich.

**Neue harte Regeln.**

1. Die Migrationskette muss **jederzeit frisch replayfähig** sein; `supabase db reset --no-seed` ist der Beweis. Direkt-Anlagen auf der Live-DB ohne Migrationsdatei sind tabu.
2. `REVOKE`/`ALTER` auf plattform-eigene Objekte nur mit Existenz-Guard (DO-Block).
3. Enum-Werte gehören in die `CREATE TYPE`-Liste der Erzeuger-Migration; `ADD VALUE` stets `IF NOT EXISTS`.
4. Nach jedem `db reset`: **PostgREST-Schema-Reload erzwingen** (`docker kill --signal=SIGUSR1 supabase_rest_<proj>` oder `NOTIFY pgrst, 'reload schema'`) — die §8-CI-Flakiness ist exakt dieser Cache (lokal reproduziert und bewiesen: PGRST204 auf die existierende Spalte `time_entries.department`).

**P2-Nachbesserungen (E2E lauffähig gemacht).**

- **P2b/P2c.** Dev-Port ist **8080** und gehört dem Lovable-Vite-Wrapper (`@lovable.dev/vite-tanstack-config`, überstimmt CLI-Flags wie `--port 3000 --strictPort`) — `playwright.config.ts` (baseURL, `webServer.url`) darauf ausgerichtet; `E2E_BASE_URL`-Weiche und `reuseExistingServer` unverändert.
- **P2d.** Seed-Inserts decken jetzt **alle non-optionalen** Insert-Typ-Felder — konkret `waiter_settlements.kitchen_tip_rate: 0.02`. Regel für den Seed: gegen die Insert-Typen aus `src/integrations/supabase/types.ts` prüfen, damit die nächste Runde desselben Fehlers ausbleibt.
- **P2e.** Seed **ohne** `time_entries.department` (der Trinkgeld-Pool liest die Abteilung aus `staff_locations.department`, siehe Kopfkommentar in `tip-pool.ts` — konstruktive Umgehung des PGRST204-Cache-Bugs). Zusätzlich exportiert der CI-`e2e`-Job `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, bevor der Dev-Server startet — sonst spricht der Test-Browser mit dem **Live-Projekt** und findet die Seed-Nutzer nicht (lokal gilt dasselbe).
- **P2f.** Seed-Nutzer werden mit `must_change_password: false` angelegt, damit sie den Erst-Login-Passwortwechsel des Route-Guards überspringen (das Verhalten selbst bleibt produktiv korrekt).
- **P2g.** `guest_count` und `vectron_daily_total_cents` im Session-Seed (der Finalize-Button sperrt bei 0 Gästen; der Vectron-Kontrollwert spiegelt die Kellner-Umsätze, damit der POS-Abgleich sauber ist). Die verbleibende Terminal-Differenz-Warnung (Karte 200 € ohne Terminal-Beträge) ist reine Anzeige und blockiert nicht — bewusst toleriert, weil die Abrechnungswerte den `db`-Test spiegeln.
- **P2i — Test 2 grün, Lehrstück.** Der Pool-Warnungs-Test scheiterte mit wechselnden Phantom-Fehlern („Forbidden" / „Session nicht gefunden", je ~11 ms), obwohl DB-Sonden (P2-Diag2) die Welt zwischen den Klicks intakt zeigten. Ursache war eine **Race im Spec selbst**: `page.once("dialog")` registriert nur; Klick 2 lief in den noch aktiven Async-Flow von Klick 1 (Button „Wird ausgeführt…" / `printBusy`), die Dialog-Handler verhakten sich. Fix: deterministische Choreografie mit `page.waitForEvent("dialog")` + `toBeEnabled()`-Gate zwischen den Klicks; alle Diagnose-Logs (`[finalize-start]`, `[finalize-catch]`, `[diag-db-*]`, `probeOrgState`) wieder entfernt. **Neue Spec-Regel:** Dialoge in E2E-Tests immer per `waitForEvent` erwarten (nie nur `once` registrieren) und Folge-Interaktionen hinter einem Zustands-Gate (Button enabled, Badge-Attribut) serialisieren.

**Endstand P2.** Alle drei Finalize-Szenarien grün — Happy Path inklusive Doppel-Finalize-Sperre, Pool-Warnung mit Abbruch/Bestätigung/Audit-Flag (`poolHoursWarningConfirmed = true`), Ruhetag-Regression (RT1 berührt Kasse nicht). HEAD `9d401acb`.

**SP2 abgenommen (HEAD `ee84264f`, 1539 Tests).** `locations.enabled_service_periods text[]` (Default `{abend}`, CHECK ⊆ `{frueh,mittag,abend}`, ≥ 1) ersetzt das alte `day_service_enabled`; drei Planungsfenster inklusive Früh (`PERIOD_FRUEH_BIS = 11`), Grid zeigt nur aktivierte Fenster mit 🌅/☀︎/☾-Markern; Kasse und Zeiterfassung sind unberührt.

**GELÖST (Nachtrag gleicher Tag).** Der lokale 3/3-Beweis wurde erbracht. Weg dorthin: manuelle Chain-Anwendung per `psql -1` (**Regel: manuelle Replays IMMER mit `-1`**, sonst rollt der abschließende `COMMIT;BEGIN;`-Enum-Trick am Dateiende lautlos zurück), ein Rechte-Rundumschlag auf dem chirurgisch neu aufgebauten Schema (Default-Privileges wandern beim `DROP SCHEMA` mit ins Grab) sowie die P2d–P2i-Seed/Spec-Fixes. Das **Docker-Doppelwelt-Phänomen** (zwei Kontexte `default` / `desktop-linux`) bleibt als lokale Mac-Eigenheit dokumentiert: für CLI-Arbeiten `DOCKER_HOST` explizit auf den Desktop-Socket setzen bzw. im Zweifel per `docker exec` direkt in den Port-Container arbeiten. **Alternativer Beweisweg ohne Mac-Docker** bleibt der CI-`e2e`-Job (gleiche Kette, eine Welt) — nach den heutigen Commits auf GitHub Actions grün prüfen, dann tickt das Promotions-Kriterium.

**P2h — Dialog-Konsolidierung.** Der KAB2-Finalize läuft jetzt vollständig über den Bestätigungs-Dialog: die Pool-Warnung (TG1) wird inline im selben Dialog als Warn-Zustand angezeigt (`data-state="warning"` am Bestätigen-Button, Label „Trotzdem finalisieren"), der frühere native `window.confirm`-Pfad ist entfernt; Server-API (`confirmPoolWarning`) und Audit-Semantik (`poolHoursWarningConfirmed`) sind unverändert. **Spec-Regel bekräftigt:** E2E-Interaktionen laufen ausschließlich über `data-testid`s (`finalize-print-button`, `finalize-confirm-button`, `finalize-cancel-button`) — keine Browser-Dialoge (`page.waitForEvent("dialog")`) mehr, das war die Race-Ursache aus P2i.

## 73. Code-Review 07/2026 — Repo-Wahrheit & Merkliste (07.07.2026)

**Volltext:** siehe [`docs/code-review-2026-07.md`](./code-review-2026-07.md) (YAGNI/KISS/DRY/SOLID + Produktionsreife-Prüfung, HEAD-Bereich `37a8b8ac`–`a17dd3e1`, jede Aussage repo-belegt).

**Kurzfassung.**

- **Muss vor Produktivstart:** (1) Sentry-DSN + Testfehler-Probe — ✅ **ERLEDIGT 07.07.** (DSN in Lovable-Secrets neben `MAILERSEND_API_KEY`; Positiv-Probe via Envelope-`curl` mit Event-Quittung; Negativ-Probe: Pool-Warnung erscheint filterbedingt **nicht** im Dashboard). (2) **P3 Restore-Probe** — **OFFEN**, letzter Muss-Punkt (Runbook-Gerüst: `docs/produktionsreife-review.md`, G6). (3) Cutover-Gates unverändert (§5-Voll-Reimport, YUM-Anker).
- **Sollte bald:** `.env`-Enttrackung + CI-Secret-Guard — ✅ **ERLEDIGT** (ENV1, `a17dd3e1`); CI-`e2e`-Job nach **10 grünen Läufen auf blockierend** heben; HIBP-Toggle bestätigen.
- **Kann später:** Groß-Dateien per Pfadfinderregel verschlanken (`zeit-uebersicht` 2805 Z., `bwa` 2468, `RezepteTab` 1486, `kasse` 1294 — funktionierend, `kasse` E2E-versiegelt; **kein eigener Refactoring-Sprint**); Geldformatierung (4 Definitionen) bei Gelegenheit nach `lib/money`; Lohn-Einmalbezug-TODO ist geplante Stufe 2.
- **Nicht anfassen (Risiko > Nutzen):** `supabaseAdmin` in den drei token-gated Public-Routen (ST1-dokumentierte Architektur); generierte `any` (62, ausschließlich `routeTree.gen`) — handgeschriebener Code: **0 `any`, 0 `ts-ignore`, 0 `console.log`**; Trinkgeld-Formel eine Definition, acht Verwender (KGL gelebt); kein Git-History-Rewrite wegen historischer Publishable-Werte; keine SaaS-Strukturumbauten vor Kassen-Go-live.

**Merkliste (persönlich Frank/Betrieb, nicht Code):** HIBP-Toggle bestätigen · Sumitr-PL2-Klicktest · TG1-Kontroll-CSV · CI-`e2e`-Promotion beobachten · TRMNL-Token setzen · ANTHROPIC_API_KEY-Secret.

**Nächster Pflichtblock.** P3 Restore-Probe (halbtags, ohne Lovable), danach Cutover-Planung.

**Gesamturteil.** Struktur gesund — die Hausregeln (KGL, BIGINT-Cents, reine Module, Review-Loop, „melden statt still lösen") operationalisieren die Prinzipien. Restarbeit ist **Betrieb, nicht Architektur**.

## 74. Direkt-Session 07.–08.07.2026 — Frag COCO, Renner & Penner, TRMNL, Offene Rechnungen

Direkt mit Lovable gebaut (153 Commits, `a17dd3e1` → `43bb6fb5`), nachträglich von Claude geprüft: tsc grün, **1604 Tests grün**, Prettier auf allen neuen Modulen sauber (ein Nachzieher in `open-invoices.test.ts`, behoben). Alle vier neuen Migrationen replayfähig (§72-Regeln eingehalten).

**KI1 — „Frag COCO" (`/admin/frag-coco`, admin-only).** Chat-Assistent mit Tool-Use-Schleife gegen die Anthropic Messages API (max. 6 Runden). Modul `src/lib/ki/`:

- **17 Werkzeuge** (`tools.ts` + `tool-dispatcher.server.ts`): stammdaten_lookup, getraenke_ranking, umsatz_zeitraum, arbeitsstunden, abwesenheiten, personalkosten_quote, kasse_tagesabschluss, bestellungen_zeitraum, inventur_aktuell, bwa_monat, bilanz_summen, dienstplan_geplant, aufgaben_status, tausch_anfragen, urlaub_antraege, branchenbenchmark_lookup, personal_bestand.
- **Pseudonymisierung** (`pseudonym.ts`, getestet): Personennamen werden vor JEDEM API-Aufruf deterministisch durch `MA-<n>`-Codes ersetzt und erst in der finalen Antwort zurückübersetzt — das Modell sieht nie Klarnamen. `staff_personal_details`/`lohn_*` werden NICHT gelesen; nur `staff` (id + display_name) und Aggregat-Tabellen.
- **System-Prompt-Regeln:** nie selbst rechnen (Zahlen nur aus Tools), Zeitraum immer nennen, deutsches Zahlenformat, bei fehlendem Werkzeug ehrlich auf den passenden COCO-Menüpunkt verweisen. Perioden-Presets aus `period-resolver.ts` (getestet).
- **Kosten-Tracking:** Tabelle `ki_usage_log` (Migration `20260707181219`) — Schreiben nur service_role, SELECT nur Admin der eigenen Org; `cost.ts` rechnet in **Microcents** (BIGINT). Monats-Summe in der Chat-Fußzeile via `getKiUsageMonth`.
- **Env/Secrets (Frank-Seite):** `ANTHROPIC_API_KEY` (Pflicht; ohne Key freundlicher Hinweis statt Fehler), optional `COCO_KI_MODEL` (Default `claude-haiku-4-5`) und `COCO_KI_BASE_URL`.

**KI2 — Spracheingabe.** Push-to-Talk-Mikrofon auf der Frag-COCO-Seite (`use-speech-input.ts`, Zustandsmaschine `speech-state.ts` getestet), Sprachtoasts, Klick-Toggle als Fallback.

**KI3 — Branchenbenchmark (`branchenbenchmark.ts`, getestet).** Kuratierte DEHOGA-Richtwerte Vollgastronomie DE als client-sicheres Modul; Pflege 1× jährlich nach neuem DEHOGA-Bericht. Tool liefert Stand-Datum + Quelle mit.

**RP1/RP2 — Renner & Penner (`/admin/pos-renner-penner`, manager+).** Auswertung auf `sales_article_stats`-Snapshots (`d365`/`alltime` — bewusst period-Wahl statt from/to, weil die Snapshots kumulativ sind und keine Tagesdaten existieren; keine RPC). Reine Merge-Logik `renner-penner-core.ts` (getestet): Zeilen mit `ek_source_article_id` werden zu EINEM Eintrag gebündelt (offene Gläser vs. Flaschen über `portionMl < ekSourceVolumeMl`), Wareneinsatz/DB/EKW je Eintrag, Standort-Slices, Ladenhüter = aktive Verkaufsartikel ohne Stats-Zeile. Snapshot-Tab mit Plan/Schl.-Anzeige; YUM-Gruppenfilter; Zuordnen-Spalte in der EK-Werkbank verbessert (`we-badge.tsx`).

**TRMNL1 — E-Ink-Display-Route (`/api/public/trmnl-tasks/<token>`).** Stille, token-geschützte HTML-Seite für TRMNL X (1872×1404): Handlungs-Badges (offene Urlaubs-/Tauschanträge, Freiwünsche, unversendete Bestellungen), „Heute/Morgen im Dienst" mit 20-Uhr-Umschlag Europe/Berlin (DST-sicher), Kanban offen/läuft (Deckel 6/Spalte + Overflow). Reine Aufbereitung `src/lib/trmnl/board.ts` (17 Tests). Sicherheit nach ST1-Muster: `organizations.trmnl_token` (Migration `20260708042403`, partieller Unique-Index), timing-safe Vergleich, generisches 404, Längen-Gate, `no-store`, escapeHtml, selectAllPaged. **Es gibt bewusst keinen UI-Erzeugungspfad** — Token setzt der Admin per SQL (32 Byte CSPRNG, base64url).

**OR1 — Offene Rechnungen mit Reservierungsnamen.** `waiter_settlements.open_invoices_details` (jsonb, Migration `20260708043308`) im Format `[{name, cents}]`; DB-Validierungs-Trigger erzwingt nicht-leere Namen, cents ≥ 0 und **Summen-Gleichheit mit `open_invoices_cents`** (leeres Array = Legacy-erlaubt). Reines Modul `open-invoices.ts` (Zod-Schema, Normalisierung defekter Einträge, getestet). UI in Abrechnung + Tagesabrechnungs-Druck integriert; geänderte Werte werden im Druck unterstrichen.

**Weiteres im Delta:** Lohn-RLS-Härtung (Migration `20260707144410`: SELECT auf `lohn_absence_days`/`lohn_recurring_zeilen` auf manager+ eingeschränkt — Lovable-„Security fixes"); Dienstplan Σ-Spalte zeigt alle Schichten; `.env.production`-Guard in CI ergänzt.

**Frank-seitig offen:** (1) `trmnl_token` per SQL setzen (Snippet im Chat vom 08.07.); (2) nach erstem Display-Abruf den Bestellungen-Badge auf Plausibilität prüfen (zählt ALLE `email_sent=false` ohne Datumsgrenze — alte Entwürfe würden mitgezählt); (3) `ANTHROPIC_API_KEY` in Lovable-Secrets für Frag COCO.

**Merkposten:** gepagte Roster-Queries der TRMNL-Route sortieren nach `staff_id` ohne id-Tiebreaker — bei Tagesdaten unkritisch, bei Wiederverwendung des Musters für größere Zeiträume BFIX2-konform machen.

## 75. Session 08.07.2026 (Vormittag) — CI-Heilung, TRMNL2 Dienstplan-Displays, TRMNL3 Kompakt-Layout

Abgenommener Anker: HEAD `a5f1967e`, vier Gates grün, **1615 Tests**.

**CI-Heilung (Runs #977–#986 rot).** Ursache war eine rollende Serie von Prettier-Versäumnissen (u. a. `open-invoices.test.ts`, `kasse.tsx`) plus ein von Lovable eingeschleppter TS-Fehler in `dienstplan.tsx` (Search-Param `bereich` optional, Prop verlangte Pflicht — Fix: `bereich ?? "kueche"` an der Übergabestelle, konsistent zur Grid-Logik). Lehre bestätigt §3: CI nach jedem Commit prüfen; Prettier-Fixes repo-weit (`prettier --write .`) beauftragen statt Datei für Datei (Whack-a-Mole). Zweite Lehre: Lovable hat einen reinen Format-Auftrag einmal NICHT ausgeführt und stattdessen einen neuen Fehler eingebaut — nach jedem Lovable-Commit zählt nur der verifizierte Ist-Zustand, nie die Commit-Message.

**TRMNL2 — Dienstplan-Route für Restaurant-Displays (`/api/public/trmnl-dienstplan/<token>?location=<uuid>`).** Serverseitig gerendertes s/w-HTML (TRMNL X 1872×1404) für die Service-Teams: **nur der per Parameter gewählte Standort, nur Bereich SERVICE, nur Fenster ABEND, rollierend 14 Tage.** Location wird gegen die Organisation validiert (fremd/fehlend → generisches 404); Sicherheitsmuster identisch TRMNL1 (gleiches `trmnl_token`, timing-safe, Längen-Gate, no-store, escapeHtml). Marker über die BESTEHENDE `service-marker.ts` (X/B/19h/GL/H), tagesbasierte Zustände U/K/♡ fensterunabhängig, Leerzeilen (14× `–`) ausgeblendet, heutige Spalte umrahmt, Wochenenden grau.

**KGL-Extraktion `src/lib/display/display-data.server.ts`:** Die Payload-Erstellung des Küchen-Displays wurde aus `display.$locationId.ts` in ein gemeinsames Modul gezogen (`buildDisplayData(supabaseAdmin, { organizationId, locationId, days })`); Küchen-Display (days=31) und TRMNL2 (days=14) nutzen dieselbe Implementierung — eine Regel, eine Implementierung. Reine E-Ink-Aufbereitung in `src/lib/trmnl/roster-grid.ts` (getestet: Fenster-Filter, 14-Tage-Schnitt, Marker-Mapping, Leerzeilen).

**TRMNL3 — Kompakt-Layout 800×480 (`?size=small` auf trmnl-tasks).** Für das klassische kleine TRMNL (1-bit) zu Hause: gleiche Daten, zweite Render-Funktion `renderPageSmall` — Badge-Zeile mit großen Zahlen (0-Badges ausgeblendet), Dienst als eine Zeile pro Standort (`K:`/`S:` + Namen, Kappung `+N` nach 9), Aufgaben als Titelzeilen (max. 4/Spalte, Überfällige mit `!`), Org-Name und Fußzeilen-Zähler entfallen. Kappungslogik als reine getestete Helfer (`truncateNames`, `ellipsize`) in `board.ts`. Ohne Parameter bleibt das große Layout byte-identisch (Diff rein additiv).

**Display-Flotte (Betrieb):** 3 Geräte, 2 Routen, 1 Token — Zuhause: `trmnl-tasks/<token>?size=small` (klein) · Spicery: `trmnl-dienstplan/<token>?location=<Spicery-ID>` · YUM: `…?location=<YUM-ID>`. Einrichtung je Gerät als TRMNL-„Screenshot"-Plugin (absolute source paths: yes, always refresh: no — Seite trägt sichtbaren Zeitstempel, HTML ändert sich je Abruf). Nach JEDEM neuen Routen-Commit gilt: erst Publish in Lovable, sonst fängt der SPA-Fallback die URL ab (Login statt Board — zweimal am 08.07. beobachtet).

**Produktions-Domain-Klarstellung:** TRMNL-URLs IMMER auf `cocoplatform.online` — `cocoplatform.lovable.app` ist die Editor-/Preview-Domain und hängt hinter Lovables Publishing-Auth (§15d). Preview-Kaltstarts („Seite nicht erreichbar", nach Wartezeit ok) sind Lovable-Sandbox-Verhalten, kein COCO-Defekt; der Produktionsausfall vom 07.07. war der separate, behobene ENV1-Fall (code-review-2026-07.md §6).

**Entschieden/zurückgestellt:** Manager-Standort-Scoping („André sieht nur YUM+TSB") ist analysiert: mit Rolle `manager` per Override NICHT abbildbar (globaler Rollen-Default schlägt Scope-Auflösung); vorgesehener Weg wäre Rolle `planer` + explizite Freigaben im PermissionsTab, Preis: Manager-Defaults (cash._/time._) müssten als Freigaben zurückgegeben werden. **Frank stellt zurück** — erst Praxiserfahrung mit dem Ist-Zustand.

**Offen:** (1) **PL3-Prompt liegt bereit, noch nicht beauftragt** — Freiwunsch-Scoping: `getDayOffWishes` filtert org-weit statt wie Urlaub über PL1-Scopes; auch `createDayOffWishFor` ohne Scope-Validierung des Ziel-Mitarbeiters. Muss VOR einer etwaigen André-Umstellung gebaut werden. (2) Bestellungen-Badge zeigte 46 — Plausibilität prüfen (§74-Punkt, zählt alle `email_sent=false` ohne Datumsgrenze). (3) P3 Restore-Probe unverändert nächster Pflichtblock.

## 76. Session 08.07.2026 (Nachmittag) — Küchen-Display-Ausfall: Diagnose, echte Ursache, Fix

Abgenommener Anker: HEAD `377ca16d`, vier Gates grün, 1615 Tests.

**Symptom:** Beide Küchen-Displays (`/display/$locationId?token=…`) zeigten statt des Schichtplans den COCO-Login; parallel reagierte der „Öffnen"-Button der Display-Einstellungen in `/admin/locations` nicht mehr. Reproduzierbar im Inkognito-Fenster, auch nach erzwungenem frischem Publish. `/api/public/*`-Routen (TRMNL-Boards) funktionierten durchgehend.

**Echte Ursache (von Lovable selbst gefunden):** Die globale Client-Middleware `attachSupabaseAuth` (`src/integrations/supabase/auth-attacher.ts`) löste bei JEDEM serverFn-RPC ohne Session ein hartes `window.location.replace("/auth")` aus. Beim ersten Rendern von `__root.tsx` feuert `startSentryClient()` die (bewusst öffentliche) `getSentryClientConfig`-Function — auf den sitzungslosen Kiosks führte das sofort zu `/auth`. Eingeführt wurde die Falle mit der Sentry-Client-Initialisierung (Sentry-Probe §73, live seit dem Vormittags-Publish); sichtbar wurde sie erst beim nächsten Kaltladen der Kiosks. **Fix (`369f96e8`):** Not-Redirect um eine Allowlist bewusst öffentlicher Pfade ergänzt (`/auth`, `/display/`, `/api/public/`, `/reset-password`). Sicherheitsbewertung: unkritisch — der Redirect war reine UX; Zugriffsschutz liegt unverändert serverseitig (requireSupabaseAuth, RLS).

**Fehldiagnose als Lehre:** Claudes Beweiskette (Route fehlt im Build-Artefakt) passte zu allen Beobachtungen, war aber falsch — die lokale `curl`-Reproduktion lieferte HTTP 200, weil curl kein JavaScript ausführt; der Redirect passiert erst clientseitig. Merksätze: (1) **Client-seitige globale Middleware kann öffentliche Seiten killen, ohne dass tsc/vitest/SSR-Probe es je sehen** — die vier Gates testen kein Browser-Verhalten. (2) Bei „Seite X leitet zum Login" immer zuerst nach `window.location`/`navigate`-Aufrufen in globalen Middlewares/Providern greppen, bevor Build/Deploy verdächtigt wird. (3) Eine curl-/SSR-Probe entlastet nur den Server-Pfad, nie den Client-Pfad.

**Nebenbefunde des Nachmittags:**

- `cocoplatform.lovable.app` leitet kanonisch auf `cocoplatform.online` um und verliert dabei den Pfad — für Routen-Tests unbrauchbar, immer direkt `.online` testen.
- Lovable-Preview-Kaltstarts („Seite nicht erreichbar", nach Wartezeit ok) sind Sandbox-Verhalten; Produktion (Cloudflare) kennt das nicht.
- `vite build` braucht inzwischen >4 GB Heap (lokal OOM) — **Arbeitspunkt Bundle-Verschlankung** (schwere Client-Brocken wie jspdf/pdfjs gezielt splitten), bevor der Build zum echten Risiko wird.
- Lovable-Prettier-Versäumnisse: heute ~10 Vorkommen inkl. der Fix-Datei selbst. Regel bestätigt: Format-Aufträge immer repo-weit.
- D4-Überbrückungs-Prompt (Küchen-Display als servergerenderte `/api/public/display-html/`-Route) liegt fertig in der Schublade — nicht gebaut, da Ursache behoben; bei erneutem Client-Bundle-Ausfall sofort einsetzbar.
- Publish-Panel „Review security 4": Lovable-Scanner-Funde bei Gelegenheit sichten und als „bewusst öffentlich" abhaken oder beheben.

**Offen (unverändert + neu):** PL3-Freiwunsch-Prompt bereit, nicht beauftragt · Bestellungen-Badge-Plausibilität (46) · P3 Restore-Probe · Bundle-Verschlankung (neu) · Security-Scanner-Review (neu).

## 77. Sessions 08.07. (Abend) – 09.07.2026 — Mobile Dienstplan, Kollegen-Anzeige, Bestellfilter, Wartung

Abgenommener Anker: HEAD `1c29b494`, vier Gates grün, 1628 Tests.

**WA2 — „Mit dir im Dienst" (`/zeit/schichten`).** Neue Server-Function `getMyShiftMates` (staffId ausschließlich aus der Session, Zeitraum serverseitig auf 62 Tage gekappt, `staff` nur `id, display_name`, BFIX2-Paging): Mitarbeiter sehen pro eigenem Arbeitstag die Kollegen desselben Standorts (beide Bereiche), Kappung `+N` nach 12 Namen. Die RLS-Härtung vom 18.06. (Staff liest nur eigene roster_shifts) bleibt unangetastet — die Kollegen-Scheibe kommt kontrolliert über die Function. Fehler der Zusatzzeile werden still geschluckt (Kernfunktion nie beeinträchtigt); reine Gruppierung in `shift-mates.ts` (getestet).

**D5 — Mobile Tagesansicht (`/admin/dienstplan?ansicht=tag`).** Das RosterGrid bleibt Desktop-Werkzeug (bewusst NICHT responsiv gemacht — Paint/DnD auf Touch wäre eine Verschlimmbesserung). Für Handys: lesende Tagesansicht, automatisch aktiv < 768px, Umschalter Grid|Tag, Tag-Navigation, je Standort Küche (farbige Skill-Pillen) + Service (Marker aus service-marker.ts), U/K-Badges, geplant gestrichelt. GLEICHER Lesepfad wie PlanerRosterView ⇒ Planer-Scopes greifen identisch. Reine Aufbereitung `day-view.ts` (getestet). Grid/PlanerRosterView: null Zeilen Änderung.

**D5b — Bearbeiten in der Tagesansicht (`DayEditSheet`).** Bottom-Sheet pro Person: Schicht anlegen (Bereich+Skill), bestätigen, Skill ändern, entfernen (mit Bestätigungs-Schritt), Urlaub/Krank als Zeitraum (Toast nennt `deletedShiftCount` wie im Grid), Abwesenheit entfernen, „+ Einteilen" für noch nicht eingeplante Personen. NULL neue Server-Logik — ausschließlich die sechs bestehenden Grid-Functions; Periodensperren/Freigaben greifen serverseitig automatisch. `canEdit` pro Standort UND Bereich aufgelöst (`canEditScope`) — feiner als bestellt, abgenommen.

**Auth-SSR-Fix (`b5060a70`, Lovable direkt).** Hydration-Mismatch der Login-Seite behoben (Mounted-Gate: leere Hülle bis zum ersten Client-Render) + `fetchPriority`-Casing. Plausible Erklärung für das „erst Fehlerseite, dann Login"-Muster vom 08.07. nachmittags. Rein präsentational, Login-Logik/Redirects unangetastet.

**BF1 — Filter „Nur offen (nicht gesendet)" (`/admin/bestellung/bestellungen?view=unsent`).** `listOrders` um `onlyUnsent` erweitert (Query identisch zum TRMNL-Zähler: `email_sent=false` UND `status≠cancelled` — Parität als Code-Kommentar-Vertrag), UI-Sentinel `"__unsent"`, Query-Key erweitert, Deep-Link via `validateSearch`/`zodValidator`, Amber-Zähler mit Paging-Warnkommentar. Prompt-Entwurf stammte von Frank+Lovable, von Claude gegen den Ist-Code verifiziert und korrigiert (Gate-Befehle, Prettier-Zeile, Zähler-Kommentar). Gerechtfertigte Abweichung: neue Dependency `@tanstack/zod-adapter` (offizieller TanStack-Adapter, durch die zodValidator-Vorgabe impliziert; 24h-Supply-Chain-Guard greift).

**Befund zu den 46 offenen Bestellungen (§75-Punkt geklärt):** Es sind **wichtige Test-Bestellungen** — KEINE SQL-Bereinigung (Frank-Entscheidung 09.07.). Der TRMNL-Badge zählt sie korrekt mit; solange COCO Testumgebung ist, ist die hohe Zahl erwartbar. Nach Produktiv-Cutover neu bewerten (Testdaten-Bereinigung gehört ohnehin zur Cutover-Checkliste).

**Wartung & Betrieb:**

- **Postgres-Patch-Upgrade** 17.6.1.127 → 17.6.1.141 (09.07., Vormittagsfenster) durchgeführt, Smoke-Test sauber. Merksatz: Patch-Upgrades = kurze Downtime für ALLES inkl. Displays; vorher Backup-Existenz prüfen. E-Ink-Displays können aus dem Downtime-Fenster ein eingefrorenes 404-Standbild behalten → Force refresh. (Kleines Heim-Terminal zeigte danach weiter 404 trotz Browser-OK — Prüfgriffe: gespeicherte Plugin-URL frisch einfügen, richtige Plugin-Instanz am Gerät, Sync-Zeitstempel; Status bei Doku-Stand offen.)
- **Git-Branches (Absprache 09.07.):** Lovable-Labs „GitHub Branch Switching" aktiviert. Konvention: Alltagsarbeit bleibt auf main (ein Baumeister, seriell, Review-Loop als Schutz); Feature-Branches NUR für Großbaustellen mit Risiko (Erstkandidat: `feature/bundle-diet`). Harte Regel: nie zwei Branches parallel in Arbeit (Migrations-Timestamps, generierte Dateien). Konvention wird erst nach der ersten Trockenübung formalisiert.

**Offen:** PL3-Freiwunsch-Prompt bereit, nicht beauftragt · P3 Restore-Probe (Pflichtblock — beim Postgres-Upgrade erneut schmerzlich als Lücke gespürt) · Bundle-Verschlankung als Branch-Trockenübung · Security-Scanner-Review („Review security 4") · Heim-Terminal-404 verifizieren · Manuelle E2E-Checks D5b/WA2/BF1 am Gerät.

## 78. 09.07.2026 — P3 Restore-Probe BESTANDEN (letzter Muss-Punkt vor Cutover-Planung)

Durchführung Frank (Terminal + Dashboard) mit Claude (Befehle, Prüf-SQL, Abgleich), ohne Lovable, ~2 h inkl. Einrichtung. Ablauf und Ergebnis: `docs/runbook-restore.md`. Kernergebnis: `pg_dump` (1,9 MB, 129 Tabellen) → Wegwerf-Projekt → **Kernzahlen-Abgleich 22/22 identisch**, inkl. Σ kassiert_brutto 133.242.780 Cents und Σ offene Rechnungen 1.396.405 Cents auf den Cent, 164 Migrationen, 85 RLS-Tabellen. Wiederherstellzeit < 15 min.

**Nebenbefunde:**

1. Backups sind PHYSICAL ohne Download → eigenständiger Ernstfall-Weg ist `pg_dump` (Runbook); der Dashboard-„Restore"-Knopf überschreibt die PRODUKTION — nie zum Üben drücken.
2. **Storage-Objekte sind in keinem DB-Backup enthalten** (Mitarbeiter-Dokumente, payslips-Bucket) → neuer Arbeitspunkt **„Backup-Strategie Stufe 2"**: (a) Storage-Sicherung, (b) zeitgesteuerter Offsite-Dump (GitHub Action, DB-Passwort als Secret — bewusste Abwägung). Entschieden: KEIN Backup-Knopf im COCO-UI (Worker können kein pg_dump; tabellenweiser API-Export wäre kein konsistentes Backup; Ein-Klick-Exfiltration wäre ein Sicherheits-Eigentor).
3. DB-Passwort wurde im Zuge der Probe rotiert (war kurz im Chat exponiert) — Rotation folgenlos, da App/Lovable über API-Keys laufen.
4. Postgres-Patch 17.6.1.141 (09.07. früh) bestätigt sauber; Supabase legt vor Upgrades automatische Zusatz-Backups an. E-Ink-Displays können aus Downtime-Fenstern eingefrorene 404-Standbilder behalten → Force refresh.

**Wegwerf-Projekt:** gelöscht (09.07.2026, nach bestandenem Abgleich; Neuaufbau bei Bedarf in <15 min per Runbook). Lokale Dump-Datei ebenfalls entsorgt bzw. bewusst als Offsite-Kopie verwahrt (Frank).

**Damit offen vor Cutover:** nur noch die Cutover-Planung selbst (§5-Voll-Reimport aus tagesabrechnung, YUM-Kassen-Anker, Testdaten-Bereinigung inkl. der 46 Test-Bestellungen). Übrige Liste: PL3 (bereit) · Bundle-Verschlankung (Branch-Übung) · Security-Scanner-Review · Backup-Strategie Stufe 2 (neu) · Heim-Terminal-404 verifizieren.

## 79. 09.07.2026 (Nachmittag) — Claude-Code-Sandbox, Bundle-Diet Schritt 1, iOS-Payslip-Fix, Branch-Mechanik

Anker: `b79cc08d` (vier Gates grün, 1628 Tests).

**Claude-Code-Sandbox etabliert (Werkzeug Nr. 3, nur Analyse/Übung).** Isolierte COCO-Kopie auf Franks Mac: Klon mit gekapptem origin (`git remote remove origin`), lokaler Supabase-Stack (Docker, leere DB), eigene `.env` auf 127.0.0.1 — Kontrolle: `grep gyvblrdhutztbkoynnrq .env` muss leer sein. **Einbahnstraßen-Regel:** aus der Sandbox wandern nur ERKENNTNISSE zurück, nie Code. Erste Ernte: Bundle-Analyse (Build braucht >4 GB Heap; große Brocken sauber lazy-geladen, Erst-Ladepfad ~212 kB gzip → Bundle-Diet ist Hygiene, kein Akutproblem; pdfjs-dist doppelt gebündelt).

**Bundle-Diet Schritt 1:** `PdfCanvasPreview.tsx` + `split-combined.ts` von Standard- auf Legacy-pdfjs vereinheitlicht (4 Zeilen) → nur noch EIN Worker-Chunk (~0,5 MB gzip gespart), Payslip-Splitter auf Safari-sicherem Pfad. Nebenbefund: `PdfCanvasPreview` ist seit KAB2 toter Code — bewusst belassen (separate Produktentscheidung, offen). Über den Plan hinaus (nachträglich abgenommen): E2E-Spec `lohn-split-worker.spec.ts` (Test-PDF in-place, prüft „genau ein Worker") + Playwright-WebKit-Projekt nur für diesen Spec.

**iOS-Payslip-Fix:** iOS-Safari verwirft `window.open` nach `await` → Tab synchron im Klick öffnen. Erstversuch scheiterte am Feature-String `"noopener"` (gibt per Spez. null zurück → weiße Seite); Fix `b79cc08d`. **Merksatz (dritter Beleg der Woche): Gates grün ≠ Browser funktioniert — Gerätetests sind bei Browser-API-Änderungen Pflicht-Gate.**

**Branch-Mechanik gelernt:** `feature/bundle-diet` wurde nie angelegt, alles landete auf main, Scope wuchs von 4 Zeilen auf E2E+CI+iOS-Fix (Scope-Drift ohne Branch-Leitplanke). Ursache: **Lovable kann Branches weder anlegen noch wechseln.** Regel: (1) Frank wechselt im Lovable-Branch-Selector, (2) Wechsel verifizieren, (3) erst dann der Prompt. PR/Merge über GitHub/Lovable-UI.

## 80. 10.07.2026 — Statistik-Ausbau (U2/U3), Stammblatt-Diät (SD2/SD3), Frag-COCO-Erweiterung (KI4)

Anker: `5657ce69`, vier Gates grün, **1662 Tests**.

**STAT-U2 — Umsatz-Tab:** Umsatzverlauf als ComposedChart mit drei Serien (Tagesumsatz-Fläche, Kreditkarten gestrichelt via `waiter_settlements.card_total_cents`, Takeaway) + neue Karte „Take Away Kanäle" (Donut aus `session_channel_amounts`+`revenue_channels`, Namen aus der DB, keine Hartkodierung; `computeChannelPercents` mit Largest-Remainder, Σ=100). Neue reine Helfer + Tests in `revenue-core.ts`.

**STAT-U3 — Standortvergleich-Tab:** Kopfkarte Gesamt, sechs ComparisonCards (Gesamtumsatz/Ø-Tag/Küchen-TG/Service-TG/Lieferumsatz/Ø-TG-Tag) mit `pctDiff`+`shareOf`-Balken, Fußkarte „Tage mit Daten"; `comparison-core.ts` getestet (pctDiff b=0→null, shareOf 0/0→0.5, pickTopTwoByTotal mit Namens-Tiebreak). **Akzeptierte Abweichung:** keine neue Server-Fn — Client-Komposition via `useQueries` über die BESTEHENDEN `getRevenueStats`/`getTipStats` (KGL-strenger: identische Zahlen wie die Nachbar-Tabs per Konstruktion; Preis: mehr Roundtrips, für Admin-Tab ok). `avgDaily` teilt bewusst durch Tage-mit-Daten. Hinweis: Charts zeigen bis zum §5-Cutover-Reimport Testdaten.

**SD2 — Standorte-Tab entfernt (Datenverlust-Falle):** Der Tab rief `assignStaffLocations`→RPC `replace_staff_locations`, die ALLE staff_locations-Zeilen löschte und je Standort eine Zeile mit fest `department='service'` neu anlegte — ein Klick vernichtete Küchen-/GL-Zuordnungen. UI+Server-Fn entfernt, RPC per Migration `20260710110213` gedroppt (Ehrlichkeits-Kommentar). Einziger Schreibpfad ist die abteilungsgenaue Pflege in der Personalliste (`setStaffLocationDepartment`).

**SD3 — Skill-Pflege an die richtigen Orte:** Zuweisung → `SkillAssignPopover` in der Personalliste; Farb-Verwaltung (global!) → `SkillsSection` als Skills-Tab der Einstellungen; Skills-Tab im Stammblatt entfernt. `assignStaffSkills`/`updateSkillColor` unverändert, je genau ein Aufrufer (KGL). Erkenntnis der zwei Umbauten: Vor dem Entfernen eines „redundanten" UI IMMER prüfen, ob es eine Alleinfunktion trägt (Skills-Tab war einziger Zuweisungsort; „Rolle & Aktiv" trägt mit `setStaffActive` die einzige Deaktivierung → SD4 nur mit Umzug, nicht ersatzlos).

**KI4 — Frag COCO A1′+A4:** `umsatz_zeitraum` liefert Zahlungswege (Karte aus Settlements, Gutscheine verkauft/eingelöst aus Sessions, `barCentsRechnerisch` = kassiert−Karte als gekennzeichnete Restgröße, Takeaway-Kanäle via `groupTakeawayByChannel`) — **bewusst OHNE Servicezeit** (Sessions sind Tages-Einheiten; Tool-Beschreibung weist das Modell an, ehrlich zu passen). Neues Tool `trinkgeld_aggregat` über `computeSessionTipPoolCore`+`aggregateTips`, nur Aggregatfelder. **Datenschutz-Kanon kanonisiert** (Kopfkommentar tools.ts): Werte, die nur für ≤3 Personen aussagekräftig sind, gelten als personenbezogen → aggregieren/weglassen; ein Test bewacht, dass kein `shares`-Feld in Tool-Antworten auftaucht.

**Betriebsnotizen:** Lovable-Preview zeigte „Konfiguration unvollständig" (Sandbox-.env von Lovable zerlegt; Produktion/`.env.production` intakt — der ENV1-Wächter funktionierte wie gebaut). Secrets-Prüfung: `GOOGLE_MAPS_BROWSER_KEY`/`_TRACKING_ID` ungenutzt, aber Connection-verwaltet → bewusst belassen; `GOOGLE_MAPS_API_KEY` wird von `geocoding.server.ts` genutzt (Korrektur früherer Annahme). Fund: `wine-research.functions.ts` (Firecrawl, Welle 3-C) existiert undokumentiert — Doku-Punkt offen.

**Offen:** SD4 („Rolle & Aktiv": Deaktivieren in die Liste umziehen, dann Tab entfernen — NICHT ersatzlos) · Gerätetests ausstehend: iPhone-Payslip (noopener-Fix), Safari-Splitter mit echtem Lohn-PDF, SD3-Popover/Farben, drei KI4-Testfragen · toter `PdfCanvasPreview` (Produktentscheidung) · WebKit-CI-Job beobachten · PL3 (bereit) · Backup-Strategie Stufe 2 · Security-Scanner-Review · Cutover-Planung als nächster großer Block.

## 81. 10.07.2026 (Nachmittag/Abend) — BK1 Bankkonto-Modul, SD4, Direkt-Commits geprüft

Anker: `ec785c5e` (Review-Fix-Commit von Claude), vier Gates grün, **1689 Tests**.

**Direkt-Commits vom Vormittag (ohne Claude, alle geprüft, sauber):** (1) **SD4 umgesetzt** (`5dbfac9d`): „Rolle & Aktiv"-Tab im Stammblatt entfernt — korrekt MIT Umzug: Deaktivieren/Aktivieren sitzt jetzt im Stammblatt-Kopf mit Bestätigungsdialog (`setStaffActive` unverändert), Rolle-Dropdown trägt die Personalliste (`staff.index.tsx`, §80-Auflage erfüllt). (2) Roter Punkt-Badge auf dem Urlaubsanträge-Tab bei offenen Anträgen (`urlaub.tsx`). (3) Wein-Beschreibungen mit Thai-Zeichen per Migration `20260710142642` genullt (idempotentes UPDATE, replayfähig).

**BK1 — Bankkonto unter Auswertungen (`a17dd3e1`→`a17f4ed9` + Review-Fixes `ec785c5e`).** Admin-only Sub-Nav-Eintrag (Muster BWA), Route `/admin/bankkonto` mit vier Bereichen: Übersicht (Kopfkarten, Monats-Chart, Kategorie×Monat-Matrix mit „Ohne Kategorie" oben, Top-Gegenparteien), Buchungen (Filter + Override-Popover), Regeln (Kategorien-CRUD, Trefferzähler), Import (CSV im Browser geparst, Review mit Saldo-Abgleich).

- **DB** (Migration `20260710154305`, BWA-RLS-Muster, Seeds idempotent): `bank_accounts` (UNIQUE org+iban), `bank_categories`, `bank_category_rules` (match_field name|zweck, case-insensitiver Substring, priority), `bank_transactions` — Geld BIGINT cents, **UNIQUE (account_id, laufende_nummer) = Idempotenz-Anker**. Seed: YUM-Konto (`DE53700700240052787900` → Location YUM) + 19 Kategorien + 49 Regeln.
- **Kern-Lektion Deutsche-Bank-CSV:** Windows-1252 (nicht UTF-8), Sammelbuchungen stehen **mehrfach im Export** (je Einzelumsatz, voller Betrag) — stumpfe Betrag-Summe liefert Unsinn (−6,9 Mio. statt −237 T€). Dedupe ausschließlich über `Laufende Nummer`; Beträge string-basiert → cents (kein parseFloat). Kategorisierung zur LESEZEIT (Override > Regel > „Ohne Kategorie"; Bank-Kategorie nur Info, kein Fallback) — Regeländerungen wirken rückwirkend ohne Reimport.
- **Verifikation:** vier Gates grün; echter Parser gegen beide Echtdateien: YUM 1221 Zeilen→1101 Buchungen, Netto −237.326,35 € == Saldo-Delta cent-genau; Spicery 906→813, Netto −4.493,40 € == Saldo-Delta. Review-Fixes durch Claude (`ec785c5e`): Prettier-Nachzieher auf 8 bank-Dateien, prefer-const, Parser-Fehlermeldung nennt CSV-Spaltennamen statt interner Keys (einziger roter Test).

**Offene BK1-Befunde (P1 zuerst, Prompt folgt als BK1b):**

1. **P1 — IBAN-Vorbelegungs-Falle im Import-Tab:** Das IBAN-Feld ist frei editierbar und mit dem ERSTEN Konto vorbelegt; die IBAN aus den geparsten Zeilen wird beim Import ignoriert. Lädt man die Spicery-CSV, während die YUM-IBAN im Feld steht, landen 813 Buchungen im falschen Konto. Fix: IBAN aus der Datei übernehmen (readonly), Fehler bei >1 IBAN in einer Datei, Import blockieren bei Feld↔Datei-Mismatch.
2. **Spicery-Nachtrag nicht umgesetzt:** Seed für Spicery-Konto (`DE26700700240052787901` → Location Spicery) fehlt, ebenso die Regeln `staatsoberkasse`→Steuern und `Otto Pachmayr`→Wareneinsatz. In BK1b-Migration nachziehen.
3. Kleiner: Kategorie-Filter in `listBankTransactions` filtert NACH dem DB-Limit (neueste 500) → ältere Treffer unsichtbar; `importBankTransactions` prüft Bestand per `.in()` über alle laufenden Nummern (bei Jahres-Exporten >>1000 Werte → URL-Länge, chunken).

**Offen (Gesamtliste):** BK1b-Fixes (P1!) · Gerätetests (iPhone-Payslip, Safari-Splitter, SD3, drei KI4-Fragen, jetzt + BK1-Import am Gerät) · toter `PdfCanvasPreview` · WebKit-CI beobachten · PL3 (bereit) · Backup-Strategie Stufe 2 · Security-Scanner-Review · `wine-research.functions.ts` undokumentiert · Cutover-Planung.

## 82. 10.07.2026 (Nachmittag) — BK1b Import-Härtung Bankkonto

Anker: `963aa0e8`, vier Gates grün.

Nachzug zu §81: Die drei BK1-Befunde sind mit BK1b geschlossen.

**IBAN-Falle (P1) entschärft:** Editierbares IBAN-Feld aus dem Import-UI entfernt; die IBAN wird jetzt serverseitig aus der CSV extrahiert (`extractSingleIban` in `src/lib/bank/bank-import-helpers.ts`). Mehrere IBANs in einer Datei → Import bricht ab; IBAN passt nicht zum gewählten Konto → Import bricht ab. Damit ist der Fehlbuchungs-Pfad („falsches Konto ausgewählt, Buchungen laufen still ins falsche Konto") baulich zu.

**Spicery-Seed:** Migration legt Bankkonto Spicery (`DE26…7901`) und die initialen Kategorisierungsregeln an — Import ohne Vorarbeit möglich.

**`.in()`-Chunking + Kategorie-Limit:** Existenz-Prüfung für Transaktionen in Chunks à 500 (`chunkArray`), um die Postgrest-URL-Länge nicht zu sprengen. `listBankTransactions` holt bei Kategorie-Filter bis 5000 Zeilen, damit die Zeilen nicht durch das Default-Limit unsichtbar werden.

**Nebenarbeiten:** Parser-Fehlermeldungen nennen jetzt die deutschen Spaltennamen („Buchungstag", „Laufende Nummer"); vorhandene `prefer-const`-Lints gefixt; Prettier grün. Cent-genauer Abgleich gegen echte YUM- und Spicery-Exporte bestanden.

**Offen bleibt** wie in §81 gelistet. **Korrektur (Claude-Prüfung, gleicher Abend):** Der hier zuvor erwähnte „weiter rote cp1252-€-Alt-Test" existiert im Repo-Stand `120daf2f` NICHT — alle vier Gates grün, **1696 Tests**, vermutlich ein Artefakt der Lovable-Sandbox. Echtdaten-Verifikation auf `120daf2f` wiederholt: YUM 1101 Buchungen/Saldo-Abgleich ok, Spicery 813 Buchungen/Saldo-Abgleich ok, `extractSingleIban` erkennt beide Konten korrekt und lehnt gemischte Dateien ab. §81-P1/P2/P3 damit bestätigt geschlossen.

## §83 — Bank-Bestand bereinigt (Fehl-Import YUM→Spicery), BK2 vorbereitet (10.07.)

**Was passiert war.** Der Dubletten-Check zur BK2-Vorbereitung zeigte 19 doppelte Buchungsgruppen am 29./30.06. Vier Theorien nacheinander (Export-Überlappung → Parser-Differenz vor/nach BK1b → Konto-Dublette → Fehl-Import), drei davon durch Lese-Selects widerlegt. Tatsächliche Ursache: Um 16:40 war die **komplette YUM-CSV (1101 Zeilen, Jan–Jun) versehentlich ins Spicery-Konto** importiert worden (Dropdown-Auswahl, keine IBAN-Prüfung) — 24 sichtbare Dubletten an zwei Tagen verdeckten 1099 Fremdzeilen über sechs Monate. Überführt per Arithmetik: 1912 = 813 (Spicery echt) + 1101 − 2. Bereinigung: kompletter 16:40-Lauf gelöscht. Kollateralschaden: Ein DELETE aus der zuvor gestoppten YUM-Hypothese war mitgelaufen und hatte 24 echte YUM-Zeilen (29./30.06.) entfernt — geheilt durch idempotenten Re-Import derselben Datei ins richtige Konto. Endstand verifiziert: Spicery 813, YUM 1101, Cross-Konto-Check zeigt nur noch legitime gemeinsame Lieferanten (Focus, Knebl, Bleyle …).

**Regel A — Lösch-Hypothesen erst per Lese-Select beweisen.** Hat zweimal vor dem Löschen legitimer Daten gerettet (YUM-15:52-Lauf war der Voll-Import, nicht das vermutete Delta). Kein DELETE ohne vorherigen SELECT mit identischem WHERE, dessen Ergebnis Frank freigibt.

**Regel B — Destruktives SQL nie in derselben Lieferung wie seine Vorbedingung.** Das mitgelaufene DELETE stand im selben Block wie sein Kontroll-SELECT; Mehrfach-Statements laufen praktisch am Stück. Getrennte Lieferungen mit Zwischenprüfung. (Regel stammt aus einem Fehler des Prüfers, nicht des Baumeisters.)

**Konsequenz für BK2:** Punkt 7 (Cross-Account-Duplikatswarnung, Fingerprint ohne Zweck-Text) und Punkt 8 (IBAN-Zwang statt Dropdown) sind direkt aus diesem Vorfall geboren. Der BK2-Bauplan implementiert die acht Anpassungen — Bau-Reihenfolge steht in `.lovable/plan.md`.

## §84 — BK2 gebaut: GoCardless-Anbindung + Cron-Skizze (10.07. abends)

Anker: BK2-Implementierung, Kern-Logik vier Gates grün.

**Was gebaut wurde.** Direkt-Bankanbindung Deutsche Bank Spicery via GoCardless (PSD2). Migration erweitert `bank_accounts` um `gocardless_requisition_id`, `gocardless_account_id`, `last_synced_at` und legt einen **partiellen Unique-Index** auf `(account_id, external_tx_id) WHERE external_tx_id IS NOT NULL` — Idempotenz-Anker für API-Buchungen, ohne das CSV-Idempotenz-Muster (`laufende_nummer`) zu stören.

- **Mapper** (`src/lib/bank/gocardless-map.ts`): Amount string→cents ohne parseFloat, ID-Präferenz `transactionId` → `internalTransactionId`. **Randfall geschlossen:** fehlen beide IDs, wird die Zeile **übersprungen und in `skipped` gezählt** — nie mit NULL-`external_tx_id` importiert (sonst greift der partielle Unique-Index nicht und Dubletten kämen zurück). Testfall in `gocardless-map.test.ts` deckt genau diesen Pfad ab.
- **`computeDateFrom`** (`src/lib/bank/date-from.ts`): Erst-Sync 90 Tage zurück (GoCardless-Grenze), Folge-Syncs `last_synced_at − 7 Tage` als Overlap-Puffer.
- **Cross-Account-Duplikate** (`src/lib/bank/cross-account-duplicates.ts`): Fingerprint aus `date|amount|counterparty` (ohne Zweck-Text — der variiert zwischen Konten), Warnung nicht Blockade. Direkte Konsequenz aus §83.
- **API-Client** (`src/lib/bank/gocardless.server.ts`, server-only): Lazy Token-Cache, Requisition-Flow.
- **Server-Funktionen** (`bank.functions.ts`): `startBankConnect`, `finalizeBankConnect` mit **striktem IBAN-Match** (Consent-Return-IBAN muss zur Konto-IBAN passen, sonst Abbruch — Konsequenz aus §83), `syncBankTransactions`, `findCrossAccountDuplicates`.
- **Public Endpoint** (`src/routes/api/public/bank/sync-spicery.ts`): timing-safe `x-cron-secret`-Check, ruft `syncBankTransactions` für das Spicery-Konto.

**Was NICHT durch Lovable ausgeführt wurde (Datenhoheit).** Das `cron.schedule`-Statement liefert Lovable als Vorab-SQL-Skizze; Frank setzt `<CRON_SECRET>` ein und führt es selbst im Supabase-Editor aus. Ziel-URL ist **`https://cocoplatform.online/api/public/bank/sync-spicery`** — die Lovable-Domain `project--<id>.lovable.app` scheidet aus (leitet pfadverlierend um, Lektion vom 08.07., TRMNL).

```sql
SELECT cron.schedule(
  'bank-sync-spicery-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cocoplatform.online/api/public/bank/sync-spicery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Offener Ehrlichkeits-Punkt (aus vorheriger Lieferung).** Der GoCardless-Consent-Redirect bringt in der Praxis nur `?ref=<reference>` zurück, nicht die `requisitionId`, die `finalizeBankConnect` aktuell erwartet. Nachzug (`finalizeBankConnectByAccount`, Auflösung `reference → requisitionId` via API) folgt vor produktivem Erst-Connect.

**Secrets, die noch fehlen:** `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`, `CRON_SECRET`. Setzen erfolgt durch Frank; Lovable erzeugt sie nicht selbst.

**Offen bleibt** wie in §83 gelistet, plus: `finalizeBankConnectByAccount` nachziehen · Secrets setzen · Cron-SQL im Supabase-Editor ausführen · produktiver Erst-Connect Spicery.

## §85 — BK2 abgenommen, Inbetriebnahme vertagt; Auth-Doppel-Fix mit Sentry-Erstbewährung (12.07.)

Abnahme-Anker: `0c46d3a1`, vier Gates grün, **1709 Tests** (+13 BK2: gocardless-map inkl. booked-only und Skip-ohne-ID, date-from, cross-account-duplicates).

**BK2-Abnahme.** Alle acht Anpassungen im Code verifiziert: Migration replayfähig (laufende_nummer nullable, partielle Unique-Indizes, GoCardless-Spalten), Sync-Route mit timingSafeEqual gegen CRON_SECRET, Mapper booked-only mit skipped-Zähler, date_from-Naht-Formel (drei Fälle), IBAN-Zwang inkl. Ablehnung gemischter Dateien, keine Secrets im Code. Prettier fehlte anfangs auf allen 11 BK2-Dateien (wiederkehrendes Lovable-Muster, per Micro-Fix nachgezogen; Fix-Commit war verifiziert reine Formatierung). Falsch betitelter Commit „GoCardless-Edge-Fns": tatsächlich reguläre Server-Fns, kein Edge-Functions-Ordner.

**BK2-Inbetriebnahme BEWUSST VERTAGT (Frank).** Code ist produktionsbereit, aber unverbunden — kein GoCardless-Konto, keine Secrets, kein Consent, kein Cron. Wiedereinstiegs-Checkliste (in dieser Reihenfolge):

1. Konto bei bankaccountdata.gocardless.com anlegen, Secret-Paar erzeugen.

2. `GOCARDLESS_BAD_SECRET_ID` + `GOCARDLESS_BAD_SECRET_KEY` von Frank direkt in Lovables Secrets-UI eintragen (nie via Chat/Prompt).

3. Publish, dann `/admin/bankkonto` → „Deutsche Bank verbinden" → PSD2-Consent; IBAN-Match muss Spicery (…7901) automatisch treffen.

4. „Jetzt Umsätze abrufen" (Hand-Sync): erwartet neue Zeilen ab 01.07. (Naht: CSV-Bestand endet 30.06.), Dubletten-Check bleibt leer.

5. ERST nach sauberem Hand-Sync: `cron.schedule`-SQL aus §84 (Platzhalter durch echten CRON_SECRET ersetzen, Frank führt aus).

Hinweis: 90-Tage-Consent läuft ab Verbindungsdatum; Status-Chip warnt <14 Tage.

**Auth-Doppel-Fix mit Sentry-Erstbewährung.** Logout-Fix (`eaf89258`, signOut-Reihenfolge) erzeugte eine Redirect-Schleife: navigate zu /auth VOR signOut → /auth leitet bei gültiger Session zurück → Endlosschleife. Sentry fing den Ernstfall (COCO-3 „Error: Aa", COCO-4 „RangeError: Maximum call stack size exceeded", beide 11.07. 23:48 auf /auth, 10 s auseinander = ein Vorfall) — erster echter Fang des P1-Monitorings. Fix (`4f7a153f`): Reihenfolge queries stoppen → Cache leeren → signOut → navigate. Sentry-Issues auf Resolved gesetzt; Wiederauftreten würde automatisch re-openen. Gerätetest Login→Logout→Login (Desktop + iPhone) Teil der offenen Testliste. Merksatz bestätigt: Auth-nahe Einzeiler sind nie „nur ein Einzeiler" — Gerätetest ist Pflicht-Gate.

**Offen:** BK2-Inbetriebnahme (Checkliste oben) · Gerätetests gesammelt: Logout-Zyklus, iPhone-Payslip, Safari-Splitter mit echtem Lohn-PDF, SD3-Popover/Farben, SD4 Deaktivieren/Reaktivieren, drei KI4-Testfragen, roter Urlaubs-Punkt · PL3 (Prompt bereit) · Backup-Strategie Stufe 2 · Security-Scanner-Review · toter PdfCanvasPreview (Produktentscheidung) · WebKit-CI beobachten · Cutover-Planung als nächster großer Block (§5-Voll-Reimport nicht vergessen).

## §86 — „COCO 2"-Frage geprüft und verworfen; Roadmap-Konvergenz zweier unabhängiger Modelle (12.07.)

**Anlass.** Frank erwog eine Überarbeitung und holte extern (ChatGPT, zunächst ohne Repo-Kenntnis) eine Einschätzung ein; Empfehlung dort: „COCO 2" als kontrollierter Neubau (Plattformkern zuerst, Module schrittweise übernehmen). Claude widersprach mit Faktenlage; ChatGPT erhielt daraufhin ein Briefing mit Repo-Zugriff, verifizierte die Behauptungen selbst und **zog die COCO-2-Empfehlung zurück**: Der empfohlene Plattformkern (organizations/locations/staff/Rollen/RLS) IST COCOs Fundament, das empfohlene Pflichtenheft IST das Gründungsdokument, der empfohlene Prüfprozess IST das Drei-Rollen-Modell mit vier Gates. Keine klassische Rewrite-Indikation trifft zu; ein Parallel-Neubau würde die doppelte Wahrheit neu erschaffen, zu deren Abschaffung COCO gebaut wurde.

**Entscheidung (Frank): Kein COCO 2. Weiterentwicklung und gezielte Renovierung auf dem Bestand.** Ein separates Neuprojekt wäre nur bei fundamental neuem Geschäftsziel gerechtfertigt (z. B. standardisiertes SaaS für viele Fremdbetriebe, Self-Service-Onboarding, Plattformwechsel) — und selbst dann erst nach Prüfung inkrementeller Plattformisierung.

**Korrekturen am eigenen Briefing (von ChatGPT zu Recht angemerkt, übernommen):**

- Präzision: Die COCO-_Produktfamilie_ und ihre Fachlogik sind ~1 Jahr gereift; die vereinte Plattform in DIESEM Repo wurde im **Juni 2026** gegründet (Gründungsdokument 12.06.2026). Macht das Anti-Rewrite-Argument eher stärker.

- Testzahl/Deployment-Details von außen nicht vollständig verifizierbar — Ankerzahlen gelten je Abnahme-SHA (aktuell 1709 auf `0c46d3a1`).

**Wertvollster externer Befund — NEUER MUSS-PUNKT für den Cutover: Betriebsmodell-Härtung.** Der heutige Modus (Lovable committet auf main; Migrationen laufen automatisch auf die einzige Supabase-Instanz; „prüfe" ist Nachkontrolle statt vorgeschaltetes Tor) war für das TEST-System ein bewusster Kompromiss — für den Live-Betrieb ist er zu riskant. Vor bzw. mit dem Cutover: Feature-Branches als Regelfall (Mechanik seit §79 bekannt), PR-Review vor Merge, Migrations-Freigabe VOR Anwendung (Ausbaustufe — reine Freigabe-Disziplin vs. separates Staging-Projekt — wird bei der Cutover-Planung entschieden).

**Bestätigte Roadmap (Konvergenz beider Modelle), in dieser Reihenfolge:**

1. **Cutover/Produktionsreife abschließen** (§5-Voll-Reimport; ergänzt um: definierte Abbruchkriterien für den Umschalttag, täglicher Alt/Neu-Summenvergleich in der Übergangsphase).

2. **Betriebsmodell-Härtung** (neuer Muss-Punkt, s. o.).

3. **Mandanten-/Standort-Audit** der indirekt gescopten Kassentabellen (waiter_settlements, tip_pool_entries, session_channels, session_terminals) als **Befundmatrix**: Tabelle × Org-Scope × Location-Scope × indirekter Anker × RLS-Abdeckung × Risiko × Maßnahme. Merksatz: Fehlendes location_id ist KEIN automatischer Fehler — bei echten Kindtabellen kann der erzwungene Session-FK der sauberere Scope sein; entscheidend ist, ob die Invariante technisch erzwungen wird und alle Policies sie nutzen.

4. **Hygiene mit Budgets:** Dead-Code-Inventur mit Verbleibsbegründung je Kandidat (PdfCanvasPreview zuerst); die 5 tolerierten exhaustive-deps-Warnungen einzeln charakterisieren; **Bundle-Budget in der CI** (Erst-Chunk, größter Route-Chunk, PDF-/Excel-Chunks) — zunächst als Vergleichs-Gate gegen unbemerkte Verschlechterung, nicht als sofortige Verkleinerung.

**Methodische Notiz.** Das Vier-Augen-Prinzip wurde hier auf die Architekturebene angewandt: zwei unabhängige Modelle (eines mit Systemhistorie, eines mit frischem Repo-Blick), konvergentes Urteil. Zweitmeinungen mit Prüfauftrag („verifiziere selbst, widersprich mit Belegen") liefern brauchbare Ergebnisse; Zweitmeinungen ohne Faktenzugang bleiben generisch.

## §87 — Nacht-Sessions 13.07.: Versand-Log, ENV2, Config-Check, Sicherheitspaket, Hygiene-Batch; Verfahrensregel für Gutachter-Vorschläge (13.07.)

Abnahme-Anker: `f1783a90`, vier Gates grün, **1717 Tests** (+8 seit BK2).

**Block 1 — Bestellwesen-Nacht (direkt mit Lovable):** `order_email_log` — persistenter Versand-Log je Bestellung (Zeitpunkt, Modus Test/Echt, Empfänger, MailerSend-Antwort, Erfolg wie Fehler; eigene Migration). Nachvollziehbarkeit vor dem Testmodus-Umschalter beim Cutover. Dazu **Config-Check** (Admin-Seite: Konfigurationsstand als ok/fehlt, nur Booleans). Erstfassung riss die CI komplett rot: `config-check.functions.ts` referenzierte den Service-Role-Key außerhalb `*.server.ts` → **Wächter-Test `server-boundary.test.ts` löste pflichtgemäß aus** (ein Verstoß, vier rote Jobs — Kaskade ist Absicht). Fix: Secret-Berührung nach `config-check.server.ts` verschoben; Regel bestätigt: Der Code passt sich dem Wächter-Test an, nie umgekehrt.

**Block 2 — ENV2:** Wiederkehrende Preview-Ausfälle („Konfiguration unvollständig") dauerhaft behoben: Publishable-Fallback (URL + Anon-Key als Konstanten, identisch zu `.env.production` — öffentliche Werte) im Supabase-Client, **Env gewinnt immer** (Claude-Code-Sandbox auf 127.0.0.1 und Produktion unberührt; nur die env-lose Lovable-Sandbox nach Recycling fällt zurück). Bewusst KEINE committete `.env.development` (hätte via Vite-Präzedenz die isolierte Sandbox auf Produktion gebogen). Service-Role ohne jeden Fallback. ENV1-Wächter bleibt (meldet fortan echte Build-Defekte).

**Block 3 — Gutachter-Pipeline (Claude Code → Lovable), Sicherheits- und Hygiene-Batch:** Frank ließ Claude Code das Repo begutachten und gab die Vorschläge als Prompts an Lovable — Einbahnstraßen-Regel korrekt gelebt (nur Erkenntnisse wanderten, kein Code). Ergebnis inhaltlich stark (79 Dateien, netto −1117 Zeilen):

- **SEC-Token:** Langlebige Zugriffs-Tokens (access_tokens/Kalender, display_settings, organizations.trmnl, telegram-links) als **SHA-256-Hash** statt Klartext; In-Place-Migration (Geräte-URLs bleiben unverändert gültig, Server hasht beim Lookup). Verhaltensänderung: bestehende Tokens im Admin nicht mehr ablesbar — bei URL-Verlust neuen Token generieren (One-Shot-Anzeige).
- **SEC-PIN:** IP-Rate-Limit am PIN-Login (30/15 min, bewusst über dem Staff-Limit — NAT/gemeinsame Kasse), neue Spalte `pin_attempts.ip`; neue PINs ≥ 6 Stellen, Bestands-PINs (4/5) bleiben am Login gültig.
- **SEC-Headers:** Erzwungenes `frame-ancestors 'self' + lovable.dev` (Clickjacking-Schutz; blockiert keine Ressourcen, Kiosks laden direkt). Haus-Test „nur Report-Only-CSP" präzisiert statt aufgeweicht: erzwungene CSP darf AUSSCHLIESSLICH frame-ancestors enthalten (Prüfer-Abnahme 13.07.). Dazu `REVOKE SELECT ON leave_requests FROM anon` (Altgrant, nur durch RLS entschärft).
- **Hygiene:** 10 ungenutzte UI-Komponenten samt Radix-Dependencies entfernt (u. a. sidebar 744 Z., chart, carousel); Batch-Server-Fns gegen N+1 (zeit-uebersicht); 5 Roster-Fixe.

**Zwischenfall daraus — Veröffentlichungs-Lücke:** Lovable wendet Migrationen sofort an; der Hash-Umbau lief in der Produktions-DB, während der alte Build noch Klartext-Spalten las → Kalender-Feeds/Display-Routen bis zum Publish gestört (E-Ink-Force-Refresh nötig wegen eingefrorener Fehlerbilder). Rückbau-Wunsch geprüft und verworfen: Hashes sind nicht zurückrechenbar, Geräte-URLs blieben gültig, Publish war die Kur. **Bestätigt §86-Härtung: Migration und Deploy gehören gekoppelt.**

**NEUE VERFAHRENSREGEL — Gutachter-Vorschläge:** Vorschlagslisten externer Gutachter (Claude Code, ChatGPT o. a.) gehen VOR der Umsetzung als Liste an den Prüfer („prüfe die Vorschläge"), dann themenweise einzeln an Lovable mit „prüfe" dazwischen — nie als Gesamt-Batch auf main. Begründung aus diesem Fall: Der Gutachter kennt weder Publish-Kopplung noch Test-Kanon; die Zwischenstation hätte Feed-Lücke und CSP-Test-Kollision vorab gefangen. (Beide Wächter — server-boundary, security-headers-Test — haben ihre Existenz doppelt gerechtfertigt.)

**Sandbox-Umgebungsnotiz:** `bank-csv-parser.test` schlägt in Lovables Sandbox fehl (Node ohne volle ICU → Windows-1252/€-Dekodierung), in CI und Prüfer-Umgebung grün — kein Code-Problem; Lovable meldete korrekt statt zu fixen.

**Offen:** Gerätetests nach Publish (Displays + Force-Refresh, Kalender-Feed, Login-Zyklus) · restliche Offen-Liste unverändert (§85/§86: BK2-Inbetriebnahme, Gerätetest-Stapel, PL3, Backup Stufe 2, Cutover-Block mit Härtung).

## §88 — Gutachter-Nachprüfung (Claude Code, 2. Runde): 18 Befunde triagiert, 13 Fixes abgenommen (13.07.)

Abnahme-Anker: `cf93f819`, vier Gates grün, **1727 Tests** (+10). Erste Anwendung der §87-Verfahrensregel: Gutachter-Liste → Prüfer-Triage (jeder Befund am Code verifiziert) → Fix-Runden per Prompt. Ergebnis der Nachprüfung selbst: alle kritischen Erst-Befunde bestätigt behoben (u. a. Sommerzeit-Rechnung über beide Umstellungsnächte 2026 nachgerechnet).

**Umgesetzt und abgenommen (13):**

- **N1** Batch-Server-Fns (Zeit/SFN/Woche) paginieren via `selectAllPaged` — die Fixes der Vorrunde hatten die 1000-Zeilen-Trunkierung in die neuen Fns kopiert; bei 3 Standorten × Monat real erreichbar → stille Lohnübersichts-Fehler. Trunkierungs-Regressionstests ergänzt.
- **N2** Kalender-Feed: „Link deaktivieren" bleibt deaktiviert (Ref-Flag; Auto-Rotate nur beim Erst-Besuch). Impersonation-Verhalten: manueller Check offen (s. u.).
- **N4** Security-Header-Test gehärtet: hartes Assert statt „falls vorhanden" — Korrektur an der Prüfer-eigenen Präzisierung aus §87 (der Prüfer wird geprüft; angenommen).
- **N5** Tauschbörse: Client nutzt `businessDateOf` (Geschäftstag, 3-Uhr-Grenze) — Client/Server nachts nicht mehr uneins.
- **N10** Bank-Liste: Vollpfad nur bei Kategorie-Filter, sonst serverseitiges Limit (Über-Korrektur der Pagination zurückgestutzt).
- **N11** Batch-Zeiten: Validierung komplett VOR erstem Schreibvorgang — ganz oder gar nicht, kein Teilzustand.
- **N12** Wochenabfragen normalisieren jedes Startdatum auf Montag (+Test).
- **N13** `format-date`: Zeitstempel einheitlich Europe/Berlin in beiden Funktionen; reine Datums-Strings unverändert (+Tests inkl. beider Umstellungsnächte).
- **N14** „⌀ pro Gast (Haus)": EINE Basis in allen vier Ansichten (Karte, Summary, PDF, Druck) über den kanonischen revenue-core-Haus-Helfer. **Fachregel Frank:** Gästezahl = Im-Haus-Gäste ⇒ Basis = Haus-Umsatz (ohne Wolt/SoUse/eigenen Außer-Haus-Verkauf). Kennzahl fällt an Takeaway-starken Tagen sichtbar niedriger aus — Korrektur, kein Fehler.
- **N15a** Totes Feld „OpenTabs-Abzug" aus Code entfernt (Fachentscheidung: Konzept durch SoUse abgelöst). **DB-Spalte bewusst belassen** bis Cutover-Mapping verifiziert → N15b auf Cutover-Checkliste.
- **N16** Excel-Lohn-Export: Zeitlohn aus vorhandenen Entgeltzeilen statt eigener Formel (KGL). Geforderter Vorher/Nachher-Regressionstest entfiel mit Prüfer-Begründung: Drift ist durch die Struktur (Summe der Zeilen) konstruktiv unmöglich; Stichprobe beim nächsten Echt-Export vereinbart.
- **N17** ICS-Zeilenfaltung nach RFC 5545 (75/74-Oktett-Budget, UTF-8-sicher, +Tests) — strikte Clients lehnen den Feed nicht mehr ab.
- **N18a** Vier UTC-„Heute"-Nachzügler auf zentrale Funktionen umgestellt; Display-Server bewusst auf `businessDateOf` (Wandtafel zeigt nachts den laufenden Abend).

**Roadmap-Einträge aus der Nachprüfung (6):**

- **N3** PIN-Rate-Limit atomar machen (Postgres-Funktion) → Sicherheitspass vor Cutover (bewusst vertagt: minimaler Angreifer-Nutzen vs. Eingriff in den Auth-Pfad).
- **N6 — Urlaubszählung auf 5-Tage-Modell (VOR Cutover, Priorität hoch):** `countLeaveDays` zählt künftig Mo–Fr-Tage des Zeitraums. **Fachregeln Frank (13.07.):** Sonntage verbrauchen NIE Urlaub; **Feiertage zählen als normale Arbeitstage** (Woche mit Feiertag = 5 Tage); `holidayDates`-Parameter und Heiligabend-Sonderregel entfallen ersatzlos. Heutiges Kalendertage-Modell zählt ~2 Tage/Urlaubswoche zu viel (nur informativ — Lohn-Wahrheit läuft über Franks manuelle Zählung an edlohn). Offen: Stichtag vs. rückwirkende Neuberechnung (Tendenz rückwirkend).
- **N7** Kalender-Token-Ablauf → Produktentscheidung im Sicherheitspass (Preis: jährliche Neueinrichtung auf allen Handys; Alternativen: Ablauf mit Erinnerung ODER bewusst kein Ablauf, dokumentiert).
- **N8** Login-Kandidatensuche org-scopen (Slug/Subdomain) → SaaS-/Mandanten-Spur (§86 P3); heute eine Org live, Risiko real null.
- **N9 + N18b** Hygiene-2: zentraler DB-Fehler-Helfer (verschluckte Fehler in Admin-Fns) + Supabase-Typen regenerieren, 15 Rest-Casts entfernen — eigener Durchgang.
- **N15b** `sessions.opentabs_deduction_cents` droppen — Cutover-Checkliste, nach Mapping-Verifikation.

**Vom Tisch (mit Begründung):** N6-Erstfassung des Gutachters („Feiertag auf Sonntag doppelt") beruhte auf der Annahme eines Werktage-Modells — der Prüfer-Check am Code zeigte das Kalendertage-Modell; die daraus gestellte Fachfrage führte zur ECHTEN Abweichung (Modell ≠ Betriebsregel) und damit zum größeren, richtigen Roadmap-Umbau. Lehre: Ein Fehlbefund kann die richtige Frage stellen.

**Abnahme-Fußnoten / offene Handgriffe (Frank):** Impersonation + Kalender-Seite öffnen (kein Toast/kein Auto-Link erwartet) · nächsten Echt-Lohn-Export stichprobenartig gegen App halten · ⌀ pro Gast (Haus) an einem Takeaway-Tag plausibilisieren · ICS einmal in strengem Client. **Prozessnotiz:** Die drei vereinbarten Fix-Runden landeten als EIN Batch auf main — ging diesmal gut (enge Prompts, Gates hielten), Gesamt-Abnahme war aber unschärfer als drei kleine; Takt-Disziplin bleibt Ziel (§86-Härtung).

## §89 — CI-Ehrlichkeit wiederhergestellt: Entstummung, sechs Test-Heilungen, E2E-Diagnose mit Produktions-Schutzriegel (13.07. abends)

Anker: `9b3bc7c8`. Erster vollständig ehrlicher CI-Lauf: format/check/**db-integration (blockierend!)** grün; e2e grün im Re-Run und weiter im dokumentierten Promotions-Modus.

**Auslöser — die Abnahme des Prüfers wurde geprüft.** Der Gutachter (Claude Code) verifizierte die §88-Abnahme und fand einen blinden Fleck: „CI grün" in den Erfolgs-Gates war nominell — die Jobs db-integration und e2e waren dauerhaft rot, aber per `continue-on-error` stummgeschaltet; der Workflow-Kommentar („alle Fehlschläge sind Schema-Cache") war inzwischen falsch und verdeckte echte Logik-Fehler. **Neue Gate-Sprache des Prüfers:** In Abnahmen zählt „check-Gates grün" (tsc/eslint/prettier/vitest); CI-Jobs werden einzeln mit Status benannt — pauschales „CI grün" nur, wenn kein Job stummgeschaltet ist.

**Sechs DB-Test-Heilungen (Produktivcode fast unangetastet):**

1. Pool-Warnungs-Test modernisiert: erwartet explizit `PoolHoursWarningError`, bestätigt mit `confirmPoolWarning: true`, läuft in den `CashLockedError`-Fall weiter. **Fachregel Frank:** Warnung mit Bestätigungspflicht gilt auch bei NEGATIVEM Abteilungs-Pool (Warnlogik unverändert — sie stammt aus dem 423-€-Vorfall 02.07.).
2. Steuerklassen-Seed: Constraint verlangt RÖMISCHE Ziffern ('I'–'VI') — Seed korrigiert. (Fund kam doppelt: Claude Code meldete den Constraint-Bruch, ein zweiter externer Bericht lieferte das Römisch/Arabisch-Detail — komplementäre Gutachter.)
3. permission_overrides-Duplicate-Key: Wurzel verstanden statt überdeckt — der Unique-Index **coalesciert `area IS NULL` zu 'kitchen'**; enger Küchen-DENY kollidiert daher mit breitem NULL-ALLOW. Test nutzt 'service' (gleiche Semantik, keine Kollision). Index-Eigenheit hiermit dokumentiert.
4. Fehlertyp vereinheitlicht (KGL): zweite Wurf-Stelle nutzt jetzt die typisierte `WaiterSettlementAlreadyExistsError` statt generischem Error.
5. - 6. **Alt-Test aus Welle 2 prüfte Vor-M4-Verhalten:** „Manager kann lesen" war seit der M4-Migration ZWANGSLÄUFIG rot (SELECT auf staff_personal_details verlangt `payroll.personal.view`; Default-Matrix: NUR admin+payroll — bewusste Personaldaten-Grenze). Er lief unter der Stummschaltung als „Schema-Cache-Flake" mit — war aber ein Feature, das auf seinen Test wartete. Umbau in zwei Fälle: Manager sieht 0 Zeilen (Negativ-Test, RLS filtert still) + Payroll liest (Positiv-Test). **Fachbestätigung Frank: Manager sehen keine Personaldaten — bleibt so.**

**Entstummung:** `continue-on-error` am db-integration-Job ENTFERNT; neuer Kommentar: „Blockierend seit 13.07. Bei PostgREST-Schema-Cache-Flake im Setup: Job re-runnen; NICHT wieder stummschalten ohne Prüfer-Entscheid." e2e-Job bleibt bewusst non-blocking bis Promotions-Kriterium (10 grüne Läufe in Folge).

**E2E-Diagnose (Playwright-Artefakte gesichtet):** Kein einziger App-Fehler. 4 Szenarien scheiterten an der ENV-Wächter-Seite (Build ohne Supabase-Werte), 1 an fehlendem WebKit-Browser. Fixes: WebKit im Install (`--with-deps chromium webkit`), Env-Export mit Fail-Fast (leere Werte brechen den Job laut ab). **Wichtigster Ertrag — Produktions-Schutzriegel `e2e/global-setup.ts`:** Seit ENV2 fiele ein env-loser Build STILL auf Produktionswerte zurück — E2E finalisiert Kassen und darf deshalb ausschließlich gegen 127.0.0.1/localhost laufen; der Riegel bricht jeden anders konfigurierten Lauf ab. Merksatz: **ENV-Fallbacks und schreibende Test-Suiten brauchen immer einen Ziel-Riegel.** Zweitbefund desselben Laufs: ghcr-Docker-Rate-Limit beim parallelen Stack-Pull beider Jobs (reiner Infrastruktur-Flake, per Re-Run bestätigt).

**Prozess-Lehren:** (a) Beim Eindampfen von Reparatur-Prompts gingen nummerierte Blöcke verloren (halber Prompt umgesetzt, Commit-Message überbehauptete) — nummerierte Fix-Listen ungekürzt senden. (b) Die Gutachter-Pipeline trägt: Abnahme-der-Abnahme fand den blinden Fleck des Prüfers; komplementäre Zweitberichte lieferten Detail-Ursachen.

**Roadmap-Nachträge (CI-Robustheit, Hygiene-Schiene):** Stack-Start mit Retry-Schleife · e2e-Job per `needs: db-integration` serialisieren (entschärft ghcr-Rate-Limit strukturell) · e2e-Promotion beobachten (Zehner-Serie), dann blockierend.

## §90 — Urlaubszählung auf 5-Tage-Modell (N6) + Feiertage im Dienstplan sichtbar (FT1) (13.07. abends)

Anker N6: `d3b5d1d1` (1725 Tests) · Anker FT1: `75307f24` (1731 Tests), vier Check-Gates jeweils grün.

**N6 — Urlaubszählung umgestellt (erster Cutover-Baustein).** Fachregel Frank (§88): Urlaubsanspruch ist auf die 5-Tage-Woche normiert — `countLeaveDays` zählt jetzt die **Mo–Fr-Tage** des Zeitraums; Sonntage/Samstage nie, **Feiertage zählen als normale Arbeitstage** (Woche mit Pfingstmontag = 5). Signatur ohne `holidayDates`; `holiday-utils.ts` komplett entfernt (kein verwaister Import). **Rückwirkung automatisch:** `leave_requests` speichert keine Tageszahl, gezählt wird beim Lesen — Bestandsanträge und Restkonten korrigierten sich mit dem Publish (Konten steigen ~2 Tage/Urlaubswoche; Team wurde informiert: Korrektur, kein Geschenk). **UZ1-Schalter `count_holidays_as_leave` gegenstandslos:** UI (`UrlaubsregelnSection`) und alle Leser entfernt; DB-Spalte bleibt nach dem opentabs-Muster bis zur Cutover-Aufräumung (nur Kommentare verweisen darauf). **SFN-Brandmauer bewiesen:** `shift-hours.ts` mit null Diff-Zeilen — Feiertagszuschläge (125/150 %) und `bavarianHolidayMap` unberührt. Kanonische Testfälle: Mo–So=5 · Di–Do=3 · 2 Wochen=10 · Feiertagswoche=5 · Sa–So=0 · einzelner Feiertag (Mi)=1 · Mo–Mo=6.

**FT1 — Feiertage im Dienstplan (thaitime-Paritätslücke geschlossen).** Befund: thaitime zeigte Feiertage im Plan, COCO nie (dreifach verifiziert: keine Tabelle, keine Planer-Komponente, keine Anzeige). Neu: reines Modul `holidays-display.ts` mit `getHolidayName(dateIso, region = "BY")` — liest die BESTEHENDE `bavarianHolidayMap` (Import, kein Umzug). Anzeige: Planer-Grid + Tagesansicht (markierte Spalte + Name), großes Display und BEIDE TRMNL-Routen (Dienstplan + Tasks). Bewusst NICHT in diesem Schritt: Schichten-Seite, ICS-Feed (spätere Runde bei Bedarf), keine Einstellungs-UI.

**SaaS-Weiche dokumentiert (Fachentscheidung Frank):** Kein Bundesland-Toggle heute (ein Mandant, drei Standorte in Bayern; deutsches Feiertagsrecht braucht gepflegte Regionsdaten, nicht nur einen Schalter). Stattdessen: Region-Parameter als typisierte Erweiterungsstelle (`HolidayRegion`-Union) im Helfer; künftig `holiday_region` **je Standort** (nicht je Org — Ketten können Länder mischen). Roadmap-Eintrag SaaS-Spur (§86 P3): „Feiertags-Regionen: holiday_region je Standort + Regionsdaten weiterer Länder + ggf. Einstellungs-UI — bei erstem Nicht-Bayern-Mandanten. Betrifft Anzeige UND SFN-Zuschläge (gleiche Quelle)."

**G1-Einordnung (Monolith-Dateien, aus externem Bericht):** Entscheidung dokumentiert — G1a `zeit-uebersicht.tsx` als risikoarmer Pilot MÖGLICH vor dem Cutover (Anzeige-Datei, kein Geld-Pfad), G1b `cash.functions.ts` erst NACH dem Cutover (keine zwei Großbewegungen gleichzeitig; Datei ist Cutover-Herzstück). Kein Beschluss zur Ausführung — Priorität liegt beim Cutover-Block.

**Offen:** Publish + Kontrollrunde (Bestandsantrag mit Feiertagswoche = 5 · Restkonten gestiegen · Feiertag im Planer/TRMNL sichtbar, z. B. 15.08.) · Team-Info Urlaubskonten · danach Cutover-Block als nächstes Groß-Thema (Härtung → Mapping → Reimport) · e2e-Zehner-Serie beobachten.

## §91 — Vergangenheit im Dienstplan: Regel geschärft, Absenzen konsistent gemacht (N19, 13.07. spät)

Anlass: Nachfrage, warum Admin/Manager rückwirkend keine Änderungen im Dienstplan machen könnten. Audit-Befund: sie können — nur war die Regel weder dokumentiert noch konsistent, und `setAbsence`/`clearAbsence` hatten die Sperrprüfung überhaupt nicht.

**Fachregel N19 (Frank bestätigt):** Admin und Manager dürfen im Dienstplan JEDEN Tag der aktuell offenen Periode bearbeiten — auch bereits vergangene. Grenze ist ausschließlich `periods.status`: `open` = editierbar, `locked` = für alle gesperrt (auch Admin muss die Sperre über Periodenwechsel zurückziehen). Kein „Wasserlinien"-Vergleich `shift_date < today` im Dienstplan; solche Regeln gelten separat für **Zeiterfassung** (`time_locked_through_date`) und **Schichttausch** (`shift_date > today`) und dürfen nicht mitrasieren.

**Was geändert wurde:**

1. `assertShiftDateUnlocked` mit Fachregel-Docblock versehen und um einen reinen Helfer `assertPeriodStatusAllowsWrite(status)` ergänzt (via `__test_assertPeriodStatusAllowsWrite` testbar). Refactor-Wächter: Wer den Vergleich zu `status !== 'open'` oder auf `today` umbaut, macht den neuen Test rot.
2. **Konsistenz-Fix:** `setAbsence` und `clearAbsence` prüften bislang GAR NICHT gegen den Periodenstatus — theoretisch konnte man Urlaub/Krank in eine gesperrte Periode schreiben oder daraus löschen. Beide rufen jetzt `assertShiftDateUnlocked` auf, wie alle `roster_shifts`-Schreibpfade und wie `setAbsenceRange` bereits (per Overlap-Check) tat.
3. Neuer Vitest `roster-past-in-open-period.test.ts` (4 Fälle): `open` erlaubt · `null/undefined` erlaubt · `locked` wirft „Periode gesperrt" · Regressions-Fall `draft` erlaubt (kein „open-only"-Refactor).

**Bewusst NICHT geändert:** Schichttausch-Regel (`swap.functions.ts`: `shift_date > today`) bleibt — eigene Fachregel. Keine UI-Änderung (Grid und DayEditSheet hingen bereits nur an `canEdit` und `periodLocked`). Kein neuer „Sperre aufheben"-Knopf.

**Konfliktmeldung statt stiller Lösung:** Die Regel „locked bleibt locked" wurde nicht heimlich aufgeweicht. Umgekehrt wurde die frühere stille Lücke bei Einzel-Absenzen als Bug offengelegt und geschlossen — Ehrlichkeitsregel angewandt.

## §92 — Hygiene-2 in vier Runden: Autoformat, Fehler-Helfer, Cast-Abbau, Dubletten-Urteil (13.07. nachts)

Abnahme-Anker je Runde: A `5c4ac220` · B `30f3c4cd` · C `4620b862` · D `2ee7406d`. Vier Check-Gates je Runde grün, Endstand **1758 Tests**.

**Prozess-Meilenstein zuerst:** Auf den Fünf-Block-Prompt antwortete der Baumeister mit einer **Konflikt-Meldung nach Projektregel** („melden statt still lösen"): Ein Turn = ein Commit → fünf Blöcke wären ein Sammel-Commit ohne Rollback-Punkte; types.ts ist Plattform-Artefakt (kein Datei-Edit); H2-Blast-Radius ehrlich beziffert (~37 Callsites). Prüfer-Entscheid: vier Runden (H1+H4 zusammen, da beide nur ci.yml), je eigener Commit + Gate + Freigabe. Die Regel-Kultur wirkt inzwischen in beide Richtungen.

**Runde A — H1 Autoformat-Wächter + H4 CI-Robustheit (nur ci.yml):** Befund: husky+lint-staged waren korrekt konfiguriert, Lovables Commit-Weg läuft an lokalen Hooks vorbei (~14 dokumentierte Prettier-Nachzügler). Lösung: CI-Job `autoformat` auf main — formatiert nach, committet als `style: prettier autofix [bot]`, doppelter Schleifenschutz (Message-Check); der blockierende format-Job bleibt Zeuge. Dazu: `supabase start` in beiden Stack-Jobs mit 3-Versuche-Retry (stop + 30 s Pause; gegen ghcr-Rate-Limit) und `needs: db-integration` am e2e-Job (serialisierte Docker-Pulls).

**Runde B — H2 Fehler-Helfer (N9):** Neues Modul `src/lib/supabase/expect-ok.ts` mit DREI Varianten (expectOk / expectMaybe mit PGRST116-Pfad / expectVoid für Schreibpfade), getestet. Anwendung in src/lib/admin/ (erster Durchgang): **19 Dateien** umgestellt; **6 dokumentierte `H2-BEFUND`-Ausnahmen**, wo stilles Weiterlaufen bewusste Kante ist (Auth-Bootstrap in admin-context: Fehler MUSS sich identisch zu „keine Verknüpfung" verhalten; Anzeige-Ränder; best-effort-Cleanup). Erste Lieferung deckte nur die zwei Startdateien — per Nachforderung mit gemessenen Zahlen je Datei vervollständigt (Lehre: Vollständigkeits-Ansage braucht Mess-Gate). cash/, lohn/, roster/ bewusst NICHT (eigene Durchgänge).

**Runde C — H3 Cast-Abbau (N18b):** **16** `as never`-Casts in **11** Dateien entfernt (3 mehr als kartiert — profile, bwa, profile-admin selbst gefunden), Ersatz durch echte Typen; bei dynamisch gebauten Payloads (bwa-Upsert, personal-details-Upsert) ehrliche Casts auf die konkreten `Insert`-Typen mit Begründung. `types.ts`-Regeneration war unnötig (Typen aktuell). Beweis: `grep "as never"` im Produktionscode → 0. H3-BEFUNDE: keine.

**Runde D — H5 Dubletten-Urteil:** Ergebnis **0 konsolidiert, 4 erklärt** — die G1a-TODOs erzwangen die Einzelprüfung; keine der vier Core-Funktionen hat ein zentrales Pendant mit identischem Verhalten (parseIsoDate/fmtIso: UTC-Mittag-Verankerung für DST-freie Wochen-Arithmetik; firstOfMonthIso: Kalendermonatsanfang ≠ Geschäftstag; periodLabelForEnd: „Monat Jahr" ≠ period-split-/Tageszeit-Label). TODOs durch `// bewusst eigenständig: <Grund>` ersetzt; Diff nachweislich kommentar-only. Merksatz: **Ein Dubletten-Verdacht endet entweder in Konsolidierung oder in einer dokumentierten Begründung — nie im Vergessen.**

**Betriebsnotizen (Direktarbeit im selben Zeitraum, abgenommen):** WeeklyPlan-Kosmetik (feste Spaltenbreiten, Zebra, Toggle im Tabellenkopf, Perioden-Anpassung) — reine UI.

**Offen/Roadmap unverändert:** H2-Folgedurchgänge für cash/ lohn/ roster/ (eigene Runden, Blast-Radius) · FK-Indizes als eigener Mini-Block (vor Cutover-Datenwachstum) · e2e-Zehner-Serie → dann blockierend · Publish + Kontrollrunde (N6/FT1/G1a/N19/Hygiene-2 gesammelt) · danach Cutover-Block.

## §93 — FK1: Foreign-Key-Indizes (Mini-Block vor Cutover) (14.07.)

Lese-Inventur der Produktions-DB (13.07.) fand **88 FK-Spalten ohne Index** (führende Spalte). Vor dem Cutover-Datenwachstum wurden die fachlich relevanten indiziert: **66 Indizes** per Migration angelegt (Namensschema `idx_<tabelle>_<spalte>`, alle `CREATE INDEX IF NOT EXISTS`, transaktional — kein `CONCURRENTLY`), **22 `organization_id`-FKs bewusst ausgenommen** (88 = 66 + 22). FK-Indizes beschleunigen Joins/Filter UND die FK-Prüfung bei Parent-DELETEs (relevant für die anstehende Testdaten-Bereinigung).

**Bewusste Ausnahme:** reine `organization_id`-FKs bleiben ohne Index — aktuell ein Mandant, keine Selektivität, der Planner würde sie nicht nutzen. Nachziehen beim ersten zweiten Mandanten (SaaS-Spur).

**Invariante ab jetzt:** jede FK-Spalte außer `organization_id` hat einen Index. Prüfskript: `scripts/check-fk-indexes.sql` (rein lesend; erwartetes Ergebnis = nur `organization_id`-Zeilen, alles andere ist Regressions-Befund). Live-verifiziert 14.07.: Prüfskript liefert exakt die 22 `organization_id`-Zeilen.

## §94 — Cutover-Plan freigegeben: T0 = 26.07.2026 (14.07.)

Der konsolidierte Cutover-Gesamtfahrplan steht in [`docs/cutover-plan.md`](./cutover-plan.md) — ab jetzt die EINE Cutover-Wahrheit (ältere Merkposten verweisen hierher). Alle fünf Entscheidungen sind getroffen (Frank, 14.07.): **E1** Härtung als Freigabe-Disziplin (kein Staging-Projekt vor SaaS) · **E2** N3 PIN-Rate-Limit wird jetzt atomar · **E3** Kalender-Token bewusst ohne Ablauf (gehasht, widerrufbar; jährliche Neueinrichtung wäre teurer als das Restrisiko) · **E4** Kassen-Anker = gezählter Tresor-Anfangsbestand je Standort am T0 (YUM zuerst) · **E5** T0 = 26.07.2026 (Periodengrenze). Phasen: 0 Härtung (bis ~18.07.) → 1 Mapping-Verifikation (bis ~21.07.) → 2 Generalprobe (19.–25.07.) → 3 Umschalttag (26.07., mit harten Abbruchkriterien) → 4 Nachlauf inkl. Spalten-Drops N15b/UZ1.

## §95 — N3: PIN-Rate-Limit atomar; 42501-Vorfall; E1-Fehlstart (14.07.)

Abnahme-Anker: `dfa6ec40`, vier Check-Gates grün (1758 Tests), **db-integration blockierend grün** inkl. der fünf neuen N3-DB-Tests (laufen NUR in CI — lokal per `SUPABASE_DB_TESTS` geskippt, die 1758 enthalten sie nicht).

**Was gebaut wurde.** `public.pin_attempt_register(org, staff, ip, window_ms, staff_max, ip_max)`: Zählen + Einfügen des PIN-Fehlversuchs atomar in EINER SECURITY-DEFINER-Funktion, serialisiert per `pg_advisory_xact_lock` je `staff_id` — schließt das Read-Modify-Write-Fenster, das SEC-RL1 (spekulativer Pre-Insert) nur verengt hatte. Beide Login-Pfade (PIN + Passwort-Fallback) rufen den RPC; Erfolgs-Delete der spekulativen Zeile, generische Fehlermeldungen, IP-Vorab-Check (SEC-RL2) und Kandidatensuche unverändert. Limits (5/15 min Staff, 30/15 min IP) bleiben als TS-Konstanten einzige Wahrheit und werden an den RPC übergeben. Fünf DB-Tests: unter Limit / Staff-Limit / IP-Limit / REVOKE-Negativtest / Fenstergrenze.

**42501-Vorfall (Prüfer-Fehler, ehrlich verbucht).** Das Vorab-SQL des Prüfers enthielt `revoke all … from public, anon, authenticated` OHNE begleitendes GRANT — Postgres vergibt EXECUTE auf Funktionen default an PUBLIC, der Revoke entzog damit auch service_role das Recht. Der blockierende db-integration-Job (seit §89 entstummt) fing den Bug: vier Tests rot mit `42501 insufficient_privilege`. Unter dem alten `continue-on-error` wäre das als „Schema-Cache-Flake" durchgerutscht — **die §89-Entstummung hat sich damit erstmals hart bezahlt gemacht.** Die Irreführung: Das Repo-Präzedenzmuster (`tg_inventory_items_assert_open`) ist eine Trigger-Funktion, die nie per RPC läuft. Fix: Migration `20260714105529` mit dem Grant; da Lovable Migrationen sofort anwendet, war die Produktions-DB automatisch geheilt (Login zu keinem Zeitpunkt gestört, solange kein Publish zwischen Bug- und Fix-Migration lag).

**NEUE MERKREGEL (Pflicht-Regeln §3):** REVOKE-from-PUBLIC auf RPC-gerufenen Funktionen braucht IMMER ein begleitendes `GRANT EXECUTE … TO service_role`. Trigger-Funktionen brauchen es nicht — das Muster ist NICHT übertragbar.

**E1-Fehlstart — geklärt (14.07., Frank):** N3 sollte als erster Block der Freigabe-Disziplin auf Feature-Branch mit PR laufen — alle Commits landeten direkt auf main. Ursache: **Lovable arbeitet nicht auf Feature-Branches** (Antwort b). Der PR-Weg ist damit tot; die E1-Mechanik ist umgestellt auf **Vorab-SQL-Freigabe VOR Prompt-Versand** (siehe Pflicht-Regel §3). Der doppelte Boden bei N3 (Migration bewusst rein additiv) hat gehalten; die neue Mechanik schützt vor UNGESEHENEN Migrationen — vor Prüfer-Fehlern im SQL schützt weiterhin der blockierende db-integration-Job (§89/§95 bewiesen).

## §96 — Mandanten-/Standort-Audit-Matrix (§86 P3) + MA1/MA2; Phase 0 komplett (14.07. abends)

Abnahme-Anker: MA1 `84a826f9` · MA2 `c4642513`, je vier Check-Gates grün (1758) + db-integration blockierend grün (MA1: 3 DENY-ALL-Tests · MA2: 3 Cross-Location-Tests).

**Matrix-Ergebnis (2 grün, 2 gelb, 0 rot).** Geprüft: Schema, RLS-Policies (inkl. Umbau 18.06.), alle Server-Schreibpfade.

| Tabelle                  | Befund                                                                                                                                                                             | Maßnahme   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| waiter_settlements       | ✅ Invariante beidseitig erzwungen: Policies mit Session-Org-Match im WITH CHECK; Server via loadSessionWithLock + assertStaffBoundToLocation (Standort-Bindung, strenger als Org) | keine      |
| session_tip_pool_entries | 🟡 einzige Geld-Satellitentabelle mit Client-Schreibgrants (Legacy Welle 2; Schreibweg seit §21 server-only) und ohne Org-FK                                                       | **MA1** ✅ |
| session_channel_amounts  | 🟡 channelId vom Client nicht gegen Org/Location des Kanals validiert (Cross-Location-Fehlbuchung möglich; Cross-Org erst mit 2. Mandant)                                          | **MA2** ✅ |
| session_terminal_amounts | 🟡 analog Terminals (zusätzlich relevant wegen is_gl in der Terminal-Identität)                                                                                                    | **MA2** ✅ |

§86-Merksatz bestätigt: Das fehlende location_id ist bei allen vieren KEIN Fehler — der erzwungene Session-FK ist der sauberere Scope; die Lücken lagen daneben (Legacy-Grants, Referenz-Validierung).

**MA1** (`84a826f9`): REVOKE insert/update/delete für authenticated + drei Schreib-Policies gedroppt (stpe_select_manager bleibt) + Org-FK nachgezogen. Live per Policy-Query verifiziert (genau 1 Policy, polcmd=r). Besonderheit: Frank hatte das freigegebene SQL bereits manuell ausgeführt (Fall-Verwechslung, s. u.) — die Migration wurde deshalb IDEMPOTENT gebaut (drop constraint if exists + add) und lief auf der Live-DB als No-Op-Erneuerung, auf frischen CI-Stacks als Aufbau. Muster für künftige „schon manuell angewandt"-Fälle.

**MA2** (`c4642513`): `assertChannelsAtLocation`/`assertTerminalsAtLocation` (Batch-Query, typisierter `CrossLocationRefError`) in `updateSessionCore` — nach Prüfer-Nachforderung VOR das sessions-UPDATE verschoben (N11 „ganz oder gar nicht": die Erstlieferung hätte bei ungültiger Referenz ein halb aktualisiertes Session-Objekt hinterlassen; Tests fehlten ebenfalls und wurden nachgefordert). DB-Tests beweisen: fremde Referenz → Fehler, Session UND Bestand unangetastet.

**Prozess-Ernte des Tages:**

1. **Baumeister-Konfliktmeldung korrigierte den Prüfer:** Der MA2-Prompt behauptete ≥2 Schreibstellen je Tabelle („~3540ff") — Lovable wies per rg nach: exakt 1, Rest sind Reads. Am Code verifiziert, Weg A mit korrigiertem Gate. Die Melde-Kultur trägt nachweislich in beide Richtungen; ein Mess-Gate kann auch falsche ANNAHMEN entlarven, nicht nur unvollständige Lieferungen.
2. **SQL-Kennzeichnung Fall 1/2/3 (neue Pflicht-Regel, s. u.):** Ausgelöst durch zwei Verwechslungen am selben Tag (Fall-3-SQL manuell ausgeführt).
3. **Test-Seed-Lehre verschärft (zwei CI-Runden):** Erst ungültiger Constraint-Wert (kind='card', Fehlerfamilie §89/Steuerklassen), dann Kollision mit Trigger-Auto-Seed (jeder Standort bekommt automatisch 4 Kanäle; Unique auf org/location/kind). Regel: **Test-Seeds gegen das VOLLSTÄNDIGE Schema-Verhalten prüfen — Constraints UND Trigger-Auto-Seeds; wo ein Auto-Seed existiert, wird geSELECTet, nicht geINSERTet.** (Der erste Fix „card→pos" war ein zu schneller Prüfer-Fix ohne Trigger-Blick.)
4. **CI-Robustheits-Merkposten:** db-integration fiel einmal im Setup („Failed to resolve latest Supabase CLI release: rate limit exceeded" — Flake-Familie §89, eine Etage vor der §92-Retry-Schleife). Beim nächsten CI-Block: Supabase-CLI-Version PINNEN statt `latest` + `GITHUB_TOKEN` an setup-cli.

**Status Cutover-Plan: Phase 0 KOMPLETT (14.07., Frist war ~18.07.)** — E1 mechanisiert (§95) · E2/N3 ✅ · E3 dokumentiert · Audit-Matrix ✅ MA1+MA2. Nächster Schritt: Phase 1 Mapping-Verifikation (Prüfer: §5-Kassen-Mapping gegen heutiges Schema; Frank: frischer Zeit-Export aus tagesabrechnung mit `restaurant`-Spalte).

## §97 — Cutover-Phase 1 abgeschlossen: Mapping verifiziert, Zeit-Import-Kette geprobt, MIG1-Bug (15.07.)

**1.1 Kassen-Mapping ✅** gegen Stand `6c1acdb3` verifiziert. Drift seit 29.06.: drei neue Spalten, keine bricht den Import — `waiter_settlements.open_invoices_details` (Default '[]', wird nicht befüllt), `session_tip_pool_entries.shift_start/shift_end` + `participates`. **F1-Entscheidung (Frank): (b)** — Küchenzeiten werden beim Reimport aus der Quelle übernommen, `hours_minutes` DARAUS abgeleitet (Wrap h<0→+24, eine Wahrheit); Service bleibt Stunden-only; `participates` bleibt NULL. Vorlage: `docs/cutover-import-vorlage.md` (Anker `41c935d7`; MA2-konform: channel/terminal NUR per (location, kind/label)-Join).

**1.2 N15 ✅** `opentabs_deduction_cents` und `count_holidays_as_leave` haben null Code-Leser (nur Kommentare) — Phase-4-Drops freigegeben.

**1.3 Zeit-Import geprobt ✅** — mit drei Funden:

_Export-Query (dokumentiert für T0):_ zt_shifts ⋈ staff ⋈ staff_restaurants (über `zt_department::text = department`) ⋈ restaurants; Stichtag `current_date - 1`. **Dedup-Pflicht:** 1115 Schichten von Doppelhaus-Mitarbeitern (SUMITR, CHEFIN, MO, DEAU, EM, APPEL, NOK, Elson) erzeugen Join-Fan-Out — Regel per GROUP BY: `restaurant` nur bei GENAU EINEM Match, sonst NULL (**F2, Frank bestätigt**: B2a-Semantik „Standort nur bei Eindeutigkeit"; die Quelle kennt das Haus wirklich nicht; nachträgliche Zuordnung via Manager-Korrektur möglich). Der Sanity-Check (quelle = export) ist PFLICHT vor jedem Export.

_R2-Nachzügler GIG SERVICE:_ Anfang Juli im Altsystem neu angelegt (nach Map-Bau) → 8 Schichten unmapped. Identity-Map-Nachtrag per name-aufgelöstem INSERT; aufgelöste staff_id `93e44abe…` = identisch mit dem §5-Kassen-Override — beide Import-Ströme zeigen auf dieselbe Person. Lehre: der T0-Export ist IMMER jünger als jede Map — „Identitäten bis alle bestätigt" ist keine Formalie.

_MIG1 — Doppel-Import-Bug (der Fund der Generalprobe):_ Der Idempotenz-Check lud Bestands-`import_key`s mit ungefiltertem `.select()` — **PostgREST kappt ohne `.range()` bei 1000 Zeilen.** Bei live 4094 importierten Altbeständen waren 3094 Schlüssel unsichtbar; ~3000 Überlappungs-Schichten galten als „importierbar" und wären beim T0-Commit DOPPELT gelandet (Zeitübersicht/Lohn verfälscht). Fingerabdruck: zwei Dry-Runs mit exakt `duplicate: 1000`. Fix `35813033`: generischer Helfer `src/lib/supabase/select-all.ts` (`selectAllPaged`, stabiles ORDER BY, Hard-Cap), `existingKeyCount` sichtbar im Run-Ergebnis, DB-Test mit 1005 Seeds (Schlüssel #1003 wird erkannt). **Sweep-Zweitfund:** der Perioden-Abgleichsbericht hätte bei >1000 Zeilen ebenfalls still trunkiert — ausgerechnet unser T0-Abbruchkriterium; ebenfalls paginiert. Sechs Kleinst-Listen als `<1000 by design` begründet.

**Sollwert-Struktur Dry-Run (Referenz 15.07., Datei 4553 Zeilen — absolute Zahlen wandern täglich, T0 zieht frisch):** gelesen = importiert + absence + invalid_time + duplicate (Bilanz-Invariante, doppelt geprüft: Kandidaten − Bestand = importierbar). Referenz: 4553 = 249 + 131 (104 Urlaub/27 krank, by design → Leave-Modul) + 79 (leere 0h-Artefakte, kein Stundenverlust) + 4094 (= exakt der Live-Bestand `source='import'`); 64 ohne Standort (F2). `existingKeyCount` MUSS dem Live-Count entsprechen.

**Status Cutover-Plan: Phase 1 KOMPLETT (15.07. vormittags, Frist war ~21.07.).** Nächster Schritt: Phase 2 Generalprobe (Kassen-Dry-Run nach §37, Testdaten-Inventur) — Zeit-Strecke ist durch die drei Dry-Runs faktisch schon generalgeprobt.

Nachtrag PLT1: Plattform-Update 2.7.3 deckte toten „urlaub"-Settings-Tab auf (stiller Fallback auf Trinkgeldpool) — Nav-Liste jetzt single-sourced aus der Zielroute (KGL).

## §98 — Phase 2: Kassen-Generalprobe bestanden; Reimport-No-Op; Testdaten klassifiziert (15.07. nachmittags)

**Verfahren:** Vier Quell-Exporte (Sanity + sessions + waiter_shifts + kitchen_shifts, alle Sanity-verifiziert bis auf den Cent: 295/943/1415, Σ pos_total 1.511.786,61 €) gegen COCO-Gegenexport (297 Sessions mit Kind-Zählern) gediffed — vollautomatische Prüfer-Diagnose ohne DB-Schreibzugriff.

**Hauptbefund — der Kassen-Voll-Reimport am T0 entfällt:**

1. Gemeinsamer Zeitraum 16.02.–01.07. (271 Sessions): **NULL Hüllen, NULL Betragsdifferenzen (vectron = pos_total×100 centgenau), NULL Kind-Differenzen** über Settlements, Pool (distinct-Personen-Logik — COCO führt Mehrfachrollen pro Session korrekt zusammen), Kanäle und Terminals. Der §37-Cleaning-Cut-Stand hat gehalten.
2. **Seit 02.07. ist COCO nativ führend:** 26 native COCO-Sessions mit vollständigen Abrechnungen; die Altsystem-Zweitschrift derselben Tage (24 Sessions, andere IDs) degradiert nachweislich (05.07. YUM = 0-€-Hülle bei 5.063 € echt in COCO; 10.+12.07. YUM fehlen der Quelle komplett). **Der De-facto-Kassen-Cutover war der 02.07.**
3. **Import-Verbot ab 02.07.:** Die 24 Quell-Sessions ab 02.07. dürfen NIE importiert werden — andere IDs, gleiche Geschäftstage → Umsatzverdopplung; `WHERE NOT EXISTS` auf id schützt hier NICHT. T0-Schritt 4 wird vom Voll-Reimport zum **Verifikationslauf** (identische Diagnose mit frischen Exporten; Erwartung: weiterhin null Differenzen ≤ 01.07.).

**Betriebsmodell bis Stilllegung (Frank, 15.07.):** tagesabrechnung läuft bewusst als Kontroll-Parallelbetrieb bis zur endgültigen Stilllegung Ende Juli — KEIN vorzeitiger Stopp. Der Vergleich läuft dafür **wöchentlich** als wiederholbarer Ablauf (4 Export-SQLs + Prüfer-Diagnose) bis T0. Team-Hinweis ohne Alarm: YUM-Zweitschrift bröckelt (s. o.) — als Kontrolle nur wirksam, wenn geführt.

**F3 (Frank): (a)** — die eine „Frank"-Zusatzkellner-Zeile (Q1-Preflight: einziger unaufgelöster Name in 943+1415 Schichten) wird bewusst NICHT importiert; deckungsgleich mit dem §37-Bestand (der Import ließ sie schon damals weg — per Distinct-Diff bewiesen).

**Quell-Anomalien dokumentiert:** YUM-Session-Lücken 17.02. (Anlauf-Artefakt Systemtag 2), 10.07., 12.07. (COCO-nativ vorhanden). Soll-Matrix Monat×Standort im Prüfer-Besitz (Feb ab 16.02. anteilig, sonst lückenlos).

**Testdaten-Klassifikation (Frank: K1+K2+K3 = ja, 15.07.):** Saubere zeitliche Trennung — alle 43 unversendeten Test-Bestellungen (sämtlich YUM, 360 Positionen, 12.449,26 €) liegen 29.12.2025–05.05.2026, die erste ECHTE versendete Bestellung kam am 05.05.; danach nur Echtbetrieb (9 versendete, bleiben unangetastet). Lösch-Umfang: 43 Test + 1 stornierte (Kriterium schlicht `email_sent = false`) + 8 carts/1 cart_item. **T0-Mappe liegt bereit:** `t0-testdaten-1-beweis` (Regel A, mit Erwartungswerten; bei Abweichung am T0 — z. B. echte frische unversendete EasyOrder-Bestellung — NICHT löschen, erst Detail-Liste prüfen) und `t0-testdaten-2-loeschen` (Regel B, Transaktion + §10-Rest-Check inkl. `echte_unveraendert`-Probe) — getrennte Dateien, Ausführung erst am 26.07.

**T0-Restumfang (deutlich geschrumpft):** Alt-System einfrieren · Zeit-Export/Dry-Run/COMMIT (Referenz: 249 importierbar) + Wasserlinie · Kassen-VERIFIKATIONSLAUF (statt Import) · Testdaten-Mappe · Tresor-Anker je Standort (E4) · Bestell-Testmodus umschalten · Abbruchkriterien-Check.

## §99a — Zeiterfassungs-Korrekturwelle, Importer-Endausbau, LG1-Design (15.–16.07.)

Abnahme-Anker: WP1 `0bc803e4` · WZ1 `b2d683db` + Nachlieferung `4c6ead05` · MIG2 `de546fb3` · MIG3 `159323f7` — je vier Check-Gates grün, Teststand 1774.

**WP1 — Wochenplan-Editor (Frank-Fund):** (1) Klick in leere Zelle setzte hart kodiert 15:00–23:00 als WERT; Blur committete → bloßes Wegklicken erzeugte echte Phantom-Schichten. Fix: Platzhalter statt Wert, Blur ohne Eingabe = still schließen; Editor-Logik als reines Modul (`weekly-editor-actions.ts`). (2) Löschen existierte im Wochenplan gar nicht — und die Server-Fn `deleteTimeEntry` aus der B2b-Spezifikation war NIE GEBAUT (nur der Kopfkommentar versprach sie): **zweite berechtigte Baumeister-Konfliktmeldung** gegen einen Prüfer-Prompt (rg-Beweis, 18 Server-Fn-Exports aufgelistet). Neubau in einem Commit: Scope-Check am Standort des Eintrags, Snapshot VOR dem Löschen, Audit `manual_delete`, Wasserlinien-Guard, 2 DB-Tests. Lehre: B2b-Spec ≠ Code-Bestand — Existenzbehauptungen im Prompt nur nach grep.

**WZ1/W2 — Zusammenfassung & GL (Frank-Fund „LAM fehlt in der GL, MO/EM-Stunden fehlen"):** Drei verschiedene Wahrheiten hinter einem Symptom: (a) EM — COCO vollständiger als die bröckelnde Alt-Zweitschrift (kein Fehler); (b) LAM/MO — Fehl-Schichten liegen im ungecommitteten T0-Batch (schließt der T0-Commit); (c) echte Code-Befunde: `.eq(location_id)` verschluckte standortlose Einträge still, `ended_at IS NULL` offene Schichten ebenso, und die Primär-Abteilungs-Priorität (kitchen>service>gl) stand im Widerspruch zur TP-GL-Hausregel des Kassen-Snapshots (gl>kitchen>service) — KGL-Verstoß. Fixes: „Alle Standorte"-Option (Default der Lohn-Sicht; `locationId` nullable, org-weit inkl. NULL), Lücken-Banner („X ohne Standort, Y offene Schichten werden hier nicht gezählt"), EINE Prioritäts-Regel gl>kitchen>service, Eintrags-Abteilung (Z3) vor Personen-Zuordnung. Nachlieferung nach Mess-Gate: fehlender DB-Test (3 Fälle) + toter GL-Bereichsknopf (verlangte Dienstplan-Bereich `gl`, den es per D-3 nicht geben KANN — strukturell unerfüllbarer Filter) + **W2 (Frank): GL-Personen-Regel** — abteilungslose Stempelungen von GL-Zugeordneten routen IMMER zur GL-Zeile; die Z3b-rosterArea-Präferenz greift bei ihnen nicht (Dienstplan-Service ist bei GL-Leuten per D-3 ein Plan-Artefakt). Regel-Kaskaden-Lehre: D-3 × Z3b × TP-GL waren einzeln richtig und kollidierten verkettet.

**Methodik-Gewinn (Frank): das Altsystem als Soll-Referenz.** Der laufende Kontroll-Parallelbetrieb lieferte die Beweisdaten für alle Zeit-Befunde (Tag-für-Tag-GL-Abdeckung, LAM-12.07.-Klärung). Wochen-Vergleich bis T0 bleibt.

**MIG2 — native_overlap (`de546fb3`):** Fund über den LAM-12.07.-„Phantomverdacht": Die Schicht war ECHT (Alt: 15:30–23:15 GL), aber die COCO-Manuell-Zeiten waren die alten Editor-Defaults (15:00–23:00) — Frank hat korrigiert. Beim Abgleich zeigte sich: Alt-Zweitschriften nativ gestempelter Tage hätten am T0 als „importierbar" gegolten (import_key-Dedup prüft nur gegen frühere IMPORTE) → Doppel-Stunden. Fix: Skip-Grund `native_overlap` (Überlappung ≥30 min, Mitternachts-Wrap-fähig, bewusst NICHT tagesbasiert — Split-Dienste bleiben importierbar), paginierte Native-Ladung, Detail-Liste der ersten 20 im Dry-Run, 4 DB-Tests. Generalprobe 22.07. sichtet die Liste (wie viele der 249 waren Zweitschriften?).

**MIG3 — Standort aus dem Dienstplan (`159323f7`, Franks Hinweis „das kannst du dem Dienstplan entnehmen"):** F2 ließ Doppelhaus-Zeilen standortlos (~64, darunter ALLE GL-Schichten von MO/CHEFIN — Quelle kennt das Haus nicht). Der bestätigte COCO-Dienstplan kennt es tagesgenau: Lookup bei `restaurant`-leer — genau EIN geplanter Standort am Tag → übernehmen (`location_from_roster`-Zähler), mehrdeutig/ungeplant → NULL (F2-Ehrlichkeit). Statusmenge `IN ('planned','confirmed')` DECKUNGSGLEICH mit dem Kassen-Pool-Snapshot (KGL; Baumeister-Rückfrage nach Freigabe-Semantik korrekt eskaliert). Quell-Angabe hat Vorrang; 4 DB-Tests.

**LG1 — Bereichs-Stundenlöhne (Design festgehalten, Bau nach 22.07. auf Startsignal):** Franks Antworten: aktuell nur LAM abweichend (änderbar) · momentan pro Person, perspektivisch pro Schicht → Modell PRO SCHICHT über die Eintrags-Abteilung · Satz JE ABTEILUNG. Design: `staff_compensation_rates` (staff × department × valid_from, Historie; hourly_rate numeric(10,2) EUR als DOKUMENTIERTE Ausnahme zur Cents-Regel — Konsistenz mit Bestandsspalte; Resolver liefert Cents), Fallback Basissatz, `hourly_rate_2` wird Legacy, Buchhaltungs-Export bekommt Stunden-Split je Abteilung (Prüfer-Ergänzung). Prüfer-Korrekturen am Lovable-Plan: KEINE authenticated-Grants (DENY-ALL, MA1-Doktrin). **Dritter E1-Riss:** Die Migration wurde trotz „Vorab-SQL liefern" vorzeitig committet und angewandt — rein additiv/leer/DENY-ALL, gefahrlos geparkt; Prüfer-Anteil: „liefern" war interpretierbar. Prompt-Formulierung geschärft: künftig „NUR ALS TEXT ZUR SICHTUNG, KEIN COMMIT". Offener LG1-Klärungspunkt: Alt bucht LAM 26./27.06. als Service, 28.06. als GL — welcher Satz an Misch-Abenden wirklich galt, klärt Franks Zahlungspraxis beim Bau; die Alt-`department`-Spalte kommt beim T0-Import mit.

**Randnotizen:** MCP: Frank fragte interessehalber — Lovable stoppte vorbildlich mit Verweis aufs Gründungsdokument (kein Public-MCP, kein service_role-Bypass); nur Dependency+bunfig geparkt, NULL Außenfläche; OAuth-Server wird bewusst NICHT aktiviert bis A1. Plattform: zod 3→4 + vite-tanstack-config 2.7.6 kamen per Direktcommit durch, alle Gates grün. UI-Direktarbeit (PayrollTab-Farben) CSS-regelkonform (Tailwind-Klassen). Wochenplan-„ד-Semantik dokumentiert: × = an anderem Standort eingeteilt (Dienstplan-Marker, keine Abwesenheit).

## §100 — Fallstudie: POS-Differenz-Warnung 27,90 € (YUM, 02.07.2026) — Diagnose, Fix, Lektionen (16.07.)

COCO zeigte am 02.07. für YUM eine POS-Differenz von +27,90 € (`settlement-warnings.ts`: `pos_diff = POS-Brutto − Σ Kellner − (Vectron-Takeaway + Souse)`); die tagesabrechnung war für denselben Tag glatt. Diagnose-Verlauf und Ergebnis:

- **Ursache (per Legacy-DB bewiesen):** In COCO waren die Tagesbeträge von Wolt und Vectron-Takeaway über Kreuz erfasst (Wolt 477,60 / TA 449,70 statt Wolt 449,70 / TA 477,60). Die Legacy-DB (`sessions.takeaway_total` = 477,60, `wolt_revenue` = 449,70, `adjusted_pos_diff` = 0,00) war die Referenz. Einmaliger Eingabefehler — die Kanal-Maske rendert dynamisch aus `revenue_channels`, kein System-Bug.
- **Fix:** Daten-SQL auf der COCO-DB (Absolutwerte statt Tausch-CASE — dadurch idempotent), Rest-Check im selben Lauf: `pos_diff = 0` ✓.
- **Formel-Verifikation über die Historie:** Bevor irgendetwas geändert wurde, wurde die Warnformel über alle 271 importierten Sessions mit Settlements getestet: aktuelle Formel (TA + Souse) trifft bei YUM an 132/135 Tagen exakt 0 (mittl. Abw. 16 €); die Gegen-Hypothese (Wolt + Souse) wäre an >80 % der Tage falsch gewesen. Die Formel ist korrekt und bleibt unverändert; Wolt (Drittplattform) ist nicht im Vectron-Total enthalten.
- **Legacy-Flag geklärt:** `restaurants.ordersmart_in_takeaway` steht in der Legacy-DB für BEIDE Restaurants auf `false` (per CSV verifiziert). COCOs feste Formel (Souse wird immer abgezogen) ist damit für beide Standorte korrekt — das Flag wird bewusst NICHT nachgebaut. Sollte sich das Legacy-Setting je ändern, muss COCO eine Kanal-Konfiguration nachziehen.
- **Beobachtung Spicery:** In der importierten Historie geht die POS-Zerlegung bei Spicery nur an 76/136 Tagen exakt auf (mittl. Abw. ~59 €) — echte historische Tages-Fehlbeträge (Abrechnungsdisziplin), kein Systemfehler. Die Warnung macht genau das sichtbar.

**Lektionen (verbindlich):**

1. **Keine Formel- oder Datenkorrektur aus n=1.** Bei Soll/Ist-Abweichungen zuerst die Rechenregel über die gesamte importierte Historie verifizieren (Aggregat-Query: an wie vielen Tagen trifft welche Variante exakt 0?). Im Fall hier hat genau diese Query zwei falsche Fixes verhindert — erst einen Daten-Tausch auf Basis einer widerlegten Ablesung, dann einen Formel-Umbau auf Basis eines einzelnen Tages.
2. **Feld-Abgleiche nur gegen DB-Werte, nie gegen abgelesene UI-Werte.** Die mündliche Ablesung „Wolt 477,60 / Takeaway 449,70 im Altsystem" war vertauscht; erst der SQL-Export aus der Legacy-DB war belastbar.
3. **Bei System-Vergleichen die Ziel-DB doppelt prüfen:** Legacy-Queries gehören ins tagesabrechnung-Supabase-Projekt (`sessions.session_date`, `restaurants`, `waiter_shifts`, Euro-Dezimalwerte), COCO-Queries ins COCO-Projekt (`sessions.business_date`, `locations`, BIGINT cents). Ein `42P01 relation does not exist` ist das typische Symptom der falschen DB.

## §101 — Zeit-Attribution final, T0-Grilling, BM1 Inbound-Mail, Einheiten-Fix (16.–17.07.)

Abnahme-Anker: WZ2 `3732df31` · Z5 `a58f81fc` + DB-Test `5ccc8eb9` · Laufkarte-Grilling (CI #1150) · BM1-Kette `b6bf8ecd`→`0557a4ab`→`acf2dd32` + Nachschliff `7e28c0e` · Mengen-× `adaf176` · E-Mail-Filter `f23aac3` · BM-A `04db618` (CI-Fix ausstehend) — Teststand 1790, CI #1150–#1157 grün.

**WZ2 — „Die Schicht hat den Typ, nicht die Person" (Frank):** Die W2-Pauschalregel (GL-Personen → immer GL-Zeile) war eine Über-Korrektur — GL-fähige Leute arbeiten teils Service-Schichten (Alt-Beleg: LAM 10./11.07. Service, 12./13.07. GL). Finale Attributions-Kette für abteilungslose Einträge: Tages-Roster mit GL-SKILL → gl · Tages-Roster ohne → geplanter Bereich (Z3b) · ungeplant → GL-Personen-Fallback, sonst Statik. Lehre: Fach-Antworten sind Momentaufnahmen, keine Regeln — die Wahrheitsquelle (Dienstplan-Skill des Tages) lag im System.

**Z5 — Planer-Zeitkorrekturen:** Rolle `planer` + Berechtigung `time.entry.edit` darf Fremdzeiten NUR im laufenden 26.–25.-Zyklus pflegen (Server-Guard, alter UND neuer Tag; rollt automatisch); UI: nur Wochenplan-Tab. `billing-cycle.ts` als reines Modul (Kalender-Regel; Perioden-Tabelle bleibt Sperr-Führungsgröße). Anlass: GERARD pflegt MOs Stunden. Wasserlinie geklärt und per SQL auf NULL — Semantik künftig G1 (T0: Auto-Set wird zurückgesetzt, kein Tag gesperrt). tagesabrechnung-Seite: Juli-Periode „open" + Nav-Freischaltung = reine Konfiguration, kein Freeze-Bruch.

**T0-Grilling (Methodik-Premiere):** mattpocock-Skills installiert (`/mnt/skills/user`, 22 Stück); `grilling` fand in 6 Fragen ZWEI echte Laufkarten-Konflikte, die kein Review sah (Wasserlinie⚔Z5; Einfrieren⚔Parallelbetrieb). Ergebnisse G1–G6 versioniert in der Laufkarte (CI #1150): G1 Wasserlinie NULL · G2 MailerSend vor T0 (ERLEDIGT + bewiesen) · G3 solo, Team-Ansage erst bei sicherem Samstag · G4 nur Kasse frieren, Zeit-Zweitschrift bis 31.07. + finaler Abgleich · G5 ALT bleibt Juli-Lohnquelle (Juli-Korrekturen NUR dort; COCO-Drift fängt der 31.07.-Abgleich; GERARD braucht Alt-Freischaltung) · G6 native_overlap-Voll-Eichung am 22.07., Abbruchkriterium ⑤. Skills-Werkzeug bleibt (nächster Kandidat: LG1-Design-Grilling).

**BM1 — Lieferanten-Antworten in COCO (Franks „brennt unter den Nägeln", in einem Vormittag von Idee zu bewiesen):** Grilling B1–B5 → to-spec → Bau. Reply-To je Bestellung `antwort+<order_number>@inbound.cocoplatform.online`; MailerSend-Inbound (MX auf Subdomain, Route Catch-all → Webhook); Zuordnung Plus-Adresse → In-Reply-To (order_email_log) → Betreff, präfix-agnostisch via DB-Lookup (EO-Lehre!); unzugeordnet → Eingang mit Hand-Zuordnung/Verwerfen + optionale buchhaltung@-Kopie; Anhänge (PDF/JPG/PNG ≤10 MB) in privatem Bucket; Telegram-Ping + zwei Org-Schalter; read-only (BM2 später). Tabellen `order_replies`/`order_reply_attachments` DENY-ALL (E1-Skizze exakt). Scharf mit T0-Testmodus-Schalter; Loop im [TEST]-Modus END-TO-END bewiesen (Franks Antwort auf EO-2026-05-0197 inkl. Hand-Zuordnung). DREI LEHREN: (1) Webhook-Auth = URL-Token nach Telegram-Muster — die Header-HMAC-Annahme war ein Prüfer-Fehler (MailerSend-Inbound-Signatur nicht als Secret vorab verfügbar; externe API-Annahmen VOR dem Prompt verifizieren); Probe-Semantik: GET/HEAD/leerer POST/fehlender Header → 200 ohne Verarbeitung, falscher Token → 401; optionale HMAC-Härtung als Merkposten BM1-H. (2) Baumeister meldete abgeschnittenen Prompt ehrlich statt still zu raten — Korrekturen (Plus-Stufe, Org-Fallback via Secret INBOUND_DEFAULT_ORGANIZATION_ID statt Erste-Org-Hardcode) sauber nachgezogen. (3) BM-A-CI-Fund: globaler fetch-Mock im DB-Test fing auch Supabase-Traffic — Mocks zielgenau auf die Fremd-API scopen (Fix zum Doku-Zeitpunkt ggf. noch offen).

**BM-A — Erstkontakt-Hinweis:** `suppliers.first_live_order_email_at` (E1-Skizze freigegeben); erste ECHT-Mail je Lieferant trägt „Adresse als Kontakt speichern"-Kasten, Testmodus unberührt. Spam-Vorsorge komplett: SPF/DKIM (Domain-Verify) + DMARC `p=none` mit rua an buchhaltung@ + Erstkontakt-Hinweis + MailerSend-Activity als Frühwarnsystem.

**Einheiten-Fix (K2-Vorbote):** Franks Fund „1 Stk statt Träger" = Stammdaten-Lücke (`articles.order_unit` leer → Fallback). bestellung.pro-Schema per information_schema-Discovery; Export 2085 Artikel → 931 eindeutige Text-Zuordnungen (Zahlen-„Einheiten" und 54 Konflikte bewusst übersprungen) → idempotentes UPDATE (nur NULL/''/Stk überschrieben): 469→386 offen; ohne Hamberger nur 80. OFFEN: Bestellt YUM bei Hamberger per Mail (306 Rest sonst unkritisch/K2)? Optional zweiter Pass mit `reference_unit`. Lehre: `order_items.unit` ist Bestellzeitpunkt-Snapshot — alte Bestellungen zeigen alte Einheiten.

**UI-Minis (Frank-Praxisblick):** Mengen als `{Menge} × {Einheit}` überall · Bestellhistorie-Filter „E-Mail-Eingang" mit Ungelesen-Badge (nutzt bestehende markRead-Mechanik, KGL) · Verwerfen im Unzugeordnet-Eingang mit Audit.

**Randnotizen:** Neuer CI-Job `e2e` (H4, needs db-integration, continue-on-error — Direktarbeit; Zehner-Serie als Blocking-Kriterium notiert). `db-integration` ist inzwischen BLOCKING (continue-on-error aus §8 entfernt). LAM 12.07. auf echte 15:30–23:15 korrigiert (Editor-Default-Zeiten waren geblieben). DMARC-Reports (XML an buchhaltung@) sind Statistik, keine Aktion nötig.

## §102 — Standorte-Tab-Layout, N3-Retry-Härtung, BM-A erledigt, Registry-Wechsel (17.07.)

Abnahme-Anker: HEAD `ca9aa7fd` — vier Gates grün (tsc 0 · eslint 0 · prettier clean · vitest 1790/1790), Prüfer-Session 17.07. vormittags.

**LOC1 — Standorte-Verwaltung als Tab-Layout (Direktarbeit Frank↔Lovable):** `admin/locations.tsx` in mehreren Runden auf ein Tab-Layout umgebaut (`1963cf4b` ff.), „+Neu"-Button nach rechts (`92661c43`), tsc-Fixes durch den Baumeister selbst (`43f34a9d`). Reine UI-Umgruppierung, keine Server-/Schema-Änderung. Vom Prüfer nachträglich abgenommen.

**N3-Retry-Härtung (`ca9aa7fd`):** `pin-attempt-register.db.test.ts` erhält `resetAttempts(staffId)` als erste Zeile JEDES Tests (löscht `pin_attempts` der Org/Person via service_role). Anlass: Die §92-CI1-Retry-Schleife wiederholt fehlgeschlagene DB-Tests — aber `pin_attempts`-Zeilen aus dem Erstlauf blieben stehen und verfälschten im Retry die Limit-Zählung (Test (a) sah plötzlich vorbelastete Versuche). **Verallgemeinerte Regel:** DB-Tests, die Zeilen ANZÄHLEN oder Limits prüfen, stellen ihren Ausgangszustand am TEST-ANFANG selbst her (retry-fest) — `afterAll`-Cleanup allein reicht nicht, weil der Retry mitten in der Suite neu ansetzt.

**BM-A erledigt:** Der in §101 offene Merkposten „CI-Fix ausstehend" ist geschlossen — fetch-Mock im DB-Test auf die Fremd-API-URL gescoped (`72218da4`), CI seither grün. Damit ist die BM1/BM-A-Kette komplett abgenommen.

**Prüfer-Umgebungsnotiz — Lovable-Registry gewechselt:** `bun.lock` zeigt nicht mehr auf `npm-registry.lovable.dev`, sondern auf regionale Google-Artifact-Registry-URLs (`europe-westN-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`, **mehrere Regionen in einer Lock-Datei**). Neuer Lokal-Install-Workaround für die Prüfer-Umgebung:

    sed -i -E 's|https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache|https://registry.npmjs.org|g' bun.lock

danach `bun install`, danach `git checkout bun.lock` (Lock-Datei nie mitcommitten). Ersetzt den alten Ein-Domain-sed.

## §103 — Standort-Tests CI-bewiesen, VA-EK-Inline, Abweichungs-Doppelfund, H1b (18.07.)

Abnahme-Anker: HEAD `5bf0bafe` — vier Gates grün (tsc 0 · eslint 0 · prettier clean inkl. `.github/` · vitest 1790/1790).

**SL2 — Standortgebundenheits-Tests in CI bewiesen (Direktarbeit):** Zwei neue DB-Test-Suiten (`send-order-email-per-location.db.test.ts`, `order-replies-per-location.db.test.ts`): (a) je Standort landen korrekte Kundennummer + Lieferadresse im Bestell-Mail-Body (mit bewusst „falscher" org-weiter Fallback-Nummer im Seed als Gegenprobe), (b) Inbound-Antworten werden über Plus-Adresse UND Betreff dem richtigen Standort/Auftrag zugeordnet, inkl. Parallel-Test gegen Kreuz-Kontamination. Der fetch-Mock ist nach der BM-A-Lehre auf `api.mailersend.com` gescoped (Pass-through für alles andere, Restore in `afterAll`). `db-integration` in CI grün → real bewiesen. Nebenbei: Bestell-Mail-Footer zweistufig verstärkt (rot/fett/größer, „Bitte bestätigen Sie den Eingang per Antwort."). **Merkposten SL2-R:** Tests (a)/(b) der Reply-Suite nutzen feste `from_email`-Adressen und erzeugen `message_id` per `Date.now()` im Test-Body — bei CI-Retry nach Teilfehler entsteht eine zweite Reply-Zeile und `toHaveLength(1)` reißt. Fix nach §102-Regel (Zustand am Test-Anfang selbst herstellen oder per-Run-eindeutige from_emails wie in Test (c)) — als Einzeiler in den nächsten Testblock aufnehmen.

**VA-EK1 — EK-Spalte inline pflegbar (`/admin/verkaufsartikel`):** Preis/Mitnahme/EK je Zeile per Klick editierbar. EK-Zelle: Chip zeigt aktive Quelle (Rezept / EK-Zuordnung / frei), Klick öffnet Popover mit drei Wegen. XOR-Enforcement clientseitig VOR dem Server: Zeile ohne Verknüpfung → direkt in den Editor; gleiche Methode → Editor ohne Dialog; Methodenwechsel (inkl. „Direkt" auf verknüpfter Zeile) → Bestätigungsdialog → `unlinkSalesArticleEk`/`unlinkSalesArticleRecipe` → Zieleditor. `clearEk`-Semantik: Wechsel auf „Direkt" behält den materialisierten EK als ehrlichen freien Startwert (`clearEk:false`), Wechsel auf Einkaufsartikel/Rezept räumt ihn (`clearEk:true`, Zelle zeigt „—" bis die neue Quelle speichert). Neue Datei nur `EkLinkDialog.tsx` (ruft `searchPurchaseArticlesForEk` + `linkSalesArticleEk` direkt, Vorbelegung aus Namens-Parsern, Live-Vorschau via `computeEkFromLink`); `EkCell` lebt inline in `verkaufsartikel.tsx` (Split-Kandidat bei weiterem Wachstum). Keine Server-Fn geändert. Akzeptierter Randfall: Lösen bestätigt + Folgedialog abgebrochen = Zeile ehrlich unverknüpft mit letztem Wert.

**Abweichungs-Doppelfund (Ehrlichkeitsregel, ohne Code-Folge):**

1. Der freigegebene Plan versprach einen `RecipeEditorDialog` (Modal-Wrapper) mit Stopp-und-melde-Klausel. Gebaut wurde stattdessen ein Tab-Wechsel in den Rezepte-Tab (+`initialOpenRecipeId`-Props in `RezepteTab.tsx`, außerhalb der „nur neue Dateien"-Zusage) — fachlich die BESSERE Lösung (kein Extraktions-Risiko, kein Zweit-Editor), aber ungemeldet umgesetzt. Vom Prüfer nachträglich abgenommen.
2. Lovable meldete auf Nachfrage selbst die `clearEk:false`-Entscheidung beim „Direkt"-Wechsel als vermeintliche Abweichung — Prüfung ergab: keine Plan-Verletzung (der Plan spezifizierte keine clearEk-Semantik), Verhalten ist fachlich richtig (Wert-Leeren würde bei Abbruch Information vernichten und die WE-Ampel blenden). **Entscheidung Frank: Verhalten bleibt.**

Konsequenz: §3-Regel um den Satz „Jede Abweichung vom freigegebenen Plan wird im Chat gemeldet, BEVOR committet wird." ergänzt — keine neue Regel, sondern die Ehrlichkeitsregel des Gründungsdokuments am Ort des Geschehens.

**H1b — CI-Selbstauslösung nach Prettier-Autofix (`5bf0bafe`):** Befund aus Run #1171: Der Autoformat-Bot pusht mit `GITHUB_TOKEN`; GitHubs Rekursionsschutz unterdrückt Folge-Runs → der Fix-Commit (= main-HEAD) blieb ohne CI-Run, der letzte sichtbare main-Status rot. Fix: `workflow_dispatch`-Trigger + `actions: write` + `gh workflow run ci.yml --ref main` nach dem Bot-Push. Schleifensicher, weil die `autoformat`-`if:`-Bedingung (`github.event_name == 'push'`) in dispatchten Runs false ist. Praxis-Beweis steht aus: Beim nächsten „prettier autofix [bot]"-Commit prüfen, ob der dispatchte Voll-Run existiert und grün ist.

## §104 — Rollen-Nachschärfung nach Payroll-UX-Ausbau (18.07.)

Prüfbefund zum Direktarbeits-Block „Payroll-Kacheln/Zeitübersicht" (bis `f5b4da2d`), Entscheidungen Frank:

**Zurückgedreht:** `assignStaffSkills` war versehentlich für `payroll` schreibbar geworden (`runAllowed(["admin","payroll"])`). Die §4-Invariante gilt unverändert: **payroll ist reine Leserolle** (externes Lohnbüro), Schreibrecht hat sie nirgends. Funktion wieder admin-only via `runGuarded`.

**Bewusst erweitert (SD1-Erweiterung):** `getStaff` ist lesend auch für `manager` und `planer` zugänglich, **inklusive email/phone** (Kontaktdaten für Führung/Planung — Entscheidung Frank 18.07.). Unverändert: `listStaff` liefert weiterhin KEINE email/phone; schreibende Personalverwaltung bleibt admin/payroll-only. Die frühere SD1-Formulierung „Manager haben keinen Zutritt" ist damit für den LESE-Pfad von `getStaff` offiziell aufgehoben.

**Neues Guard-Muster:** `runAllowed(callerRole, allowedRoles, …)` + `assertRoleAllowed` ergänzen `runGuarded` für Seitenrollen ohne Hierarchie-Rang (payroll/planer): explizite Allow-List statt Mindestrolle, sonst identische Semantik (ForbiddenError vor der Operation, Audit nur bei Erfolg). Bei jeder künftigen `runAllowed`-Verwendung mit Schreibzugriff gilt: §4-Rollendefinition gegenprüfen — Seitenrollen in einer Schreib-Allow-List sind meldepflichtige Ausnahmen, keine Routine.

**Payroll-UX (abgenommen):** payroll landet nach Login auf `/zeit-uebersicht` (Redirect), Nav-Freigaben entsprechend; Skill-Filter und ausgeblendeter „Heute"-Block in der Zeitübersicht; Logout-401-Fix im TelegramLinkBanner (Query nur bei vorhandenem Access-Token — verhindert blanke Error-Boundary in der Logout-Lücke).

## §105 — Payroll-Buchhaltung, Hermes-Triage, SEC-02, .env-Katalog, Pool-Diagnose, Preisrunde (18.07.)

Abnahme-Anker: HEAD `c368bcf2` — vier Gates grün (tsc 0 · eslint 0 · prettier clean · vitest 1790/1790).

**PY2 — Payroll-Buchhaltung vervollständigt (Direktarbeit, zwei Batches):** Neues Modul `src/lib/time/buchhaltung-export.ts` (reine Funktionen, Spalten dynamisch je §3b-Modus, `absenceNote` wird NIE gespeichert) + CSV-Export-Button; Monatsfilter im Buchhaltungstab; PayrollTab ohne Trinkgeld-Block; Personalakte für payroll ohne PIN-Tab/Pool-Checkbox (UX-Gate, Server-Guards unverändert). Excel-Export im Lovable-Preview via Download-Helper-Refactor (`prepareDownloadAnchor`/`downloadBlobWithAnchor`) gefixt. Git-Notiz: Monatsfilter-Block einmal komplett auf `aa9fc8eb` revertet (`082756d1`) und neu gebaut — der Hermes-Audit-Anker `d7f107e0` stammt aus dem verworfenen Zwischenstand. Merkposten PY2-T: `columns(mode)`-Mini-Test in den nächsten Testblock.

**Hermes-Deep-Audit 18.07. (3 Cluster, 42+ Findings) — Triage:** SEC-02 verifiziert & sofort gefixt (unten). SEC-07 bestätigt (CI-Secret-Guard greift nur exakt `.env`), Fix 27.07. Fahrplan: 27.–28.07. SEC-07 + SEC-04/05 (Payload-Limits, gebündelt) + SEC-06/COR-01/02/05 (Task-Härtung, gebündelt) + COR-03 (Telegram-Report-Atomarität — bewusst GEGEN die Audit-Empfehlung auf nach T0: M-Aufwand an live laufender Report-Logik in der Cutover-Woche riskiert mehr als die Nicht-Atomarität kostet). Erste Augustwoche: SEC-01 (Kanban-RPC-Rechte) + TS-DEPS-02 (RPC-Permission-DB-Tests) — Fix und Beweis zusammen. Vor SaaS-Pilot: SEC-03 (Tenant-Prädikat `staff_telegram_links`) + MIG-01. MIG-02 gegen §93 gegenprüfen, dann schließen. Cluster B/C: 036 sofort umgesetzt (unten); 034/035 in korrigierter Hausform auf 27.07. (034s `test:db` war doppelt defekt: Exclude-Pattern schließt eigene Dateien aus, `SUPABASE_DB_TESTS=1` fehlt). Prozess-Rückmeldung an Hermes: (1) nur auf gepushte origin/main-Stände ankern, (2) Zählinkonsistenzen, (3) Sec/Corr/Migrations vor DX priorisieren, wenn ein Cutover ansteht.

**SEC-02 — order_replies/attachments-RLS verschärft (`c368bcf2`):** Die SELECT-Policies `order_replies_select_manager`/`ora_select_manager` prüften nur die Org, keinen Rollen-Rang — jede Servicekraft mit Session konnte Lieferantenkorrespondenz lesen. Fix: beide Policies um `public.has_min_permission('manager')` ergänzt (Drops vor Creates); payroll/planer bewusst ausgeschlossen (§104-Linie). Beweis: `order-replies-rls.db.test.ts` (staff 0 Zeilen, manager beide) in `db-integration`. Prädikat statt deny-all, weil `listOrderReplies` den nutzergebundenen Client verwendet.

**ENV1 — `.env.example` als Integrationskatalog (`9904d500`):** Alle 27 code-verifizierten Env-Variablen, sektioniert nach Integration, je Datei-Referenz + Pflicht/Optional; null echte Werte; `SUPABASE_DB_TESTS` auskommentiert; beide Cron-Secrets getrennt. Beilage zu `docs/runbook-restore.md`.

**PZ1 — Pool-Ende-Diagnose (D-M2-1-Feldmeldung, aufgeklärt):** Befund aus dem Betrieb „Kellner-Stunden tragen sich nicht ein". Datenlage 7 Tage: alle 48 abgegebenen Kellner-Abrechnungen mit voller Kette (Pool-Ende + Stunden-Eintrag) — D-M2-1 funktioniert. Echte Lücke: **manuell in den Pool gesetzte Einspringer ohne Startzeit** — `applyServicePoolEnd` steigt bei fehlendem Pool-Eintrag oder fehlendem Start STILL aus (2 dokumentierte stille Returns), zusätzlich ungeprüfter End-Update und ein Fehler-verschluckendes Best-effort-Catch im Bearbeiten-Pfad. Reparatur per UI erledigt (1 Fall nachgetragen, 2 Pool-Zeilen entfernt). Scheinfall LAM 12.07.: Stunden existierten als `source='manual'` — Diagnose-Abfragen auf Zeit-Vollständigkeit dürfen NIE auf `source='pool'` filtern (echte Einträge schlagen Pool-Ableitungen, `syncPoolTimeEntry` löscht Pool-Duplikate absichtlich). Härtungs-Prompt erstellt (Fehler-Check + Sentry-Sichtbarkeit, keine Verhaltensänderung); Vollständigkeits-Check als Feature nach T0. Merkposten fürs Lohnbüro: manueller LAM-Eintrag 12.07. mit 0 min Pause bei 8:15 h (ArbZG ≥30) und Startzeit-Differenz manuell 15:00 vs. Pool 15:30.

**PR1 — Preisrunde Spicery (Karte August 2026):** Speisen: 35 Artikel (f/r/n/p/x/d) per Code-Match 35/35 eindeutig, Fall-1-UPDATE ausgeführt, Soll/Ist-Kontrolle 35/35 ok. Getränke: 97 von ~131 Kartenpositionen eindeutig gematcht (77 Preisänderungen), Abarbeitung bewusst per UI (Inline-PriceCell + Aktiv-Häkchen + „+Neu") statt SQL — Checkliste vom Prüfer; 12 Deaktivierungs-Kandidaten (dao vinho, asia cuvée, il lusio, julie rosé, la dame, nerello mascalese, champus …). Offen: Vectron-Nachzug der neuen Preise (Kassenwahrheit!), 0,1er-Glas-Preisregel, Cava-Glas-Widerspruch auf der Karte selbst (Sekt 7,10 vs. Aperitif 7,90), Verdacht `fl. ribeira` = neuer „Ribera Comenge". Regel für neue Verkaufsartikel: ZUERST Vectron, dann COCO-+Neu mit exakt identischem Namen (Namens-Unique je Standort, sonst Import-Dublette).

**Drei-Welten-Beschluss (Stammdaten-Architektur):** Ein Produkt, drei Namenswelten — Einkauf (Bestellsystem), Kasse (Vectron/COCO-Verkaufsartikel), Speisekarte. Brücke Einkauf↔Kasse = EK-Zuordnung (existiert, ID-basiert, Namen bleiben verschieden). Brücke Kasse↔Karte = bei Speisen per Code-Disziplin gelöst, bei Getränken künftig via **KM1** (`menu_label`-Spalte, Prompt geparkt für nach T0; UI-Vorgabe Frank: eindeutig + einfach — eine Inline-Spalte im PriceCell-Muster, Typeahead gegen Schreibweisen-Zwillinge, Filter „ohne Kartenname"; Seed aus dem 97er-Matching liegt beim Prüfer). EK-Coverage gemessen: Spicery 289 aktiv / 3 Rezept / 44 Zuordnung / 176 manuell / 66 ohne; YUM 257 / 0 / 39 / 76 / 142; TSB ohne aktive Verkaufsartikel. Konsequenz-Fahrplan nach T0: KM1 → Mapping-Assistent (EKZ1-Namensvorschläge; Ignorier-Infrastruktur existiert) → Fleiß-Session „manuell → verknüpft" beginnend bei den Renner-&-Penner-Topsellern.

**Offene Merkposten (Sammelstand):** SL2-R (Retry-Festigkeit Reply-Tests, §103) · PY2-T (columns-Mini-Test) · H1b-Feuertaufe im Actions-Tab bestätigen · Frank: SEC-02-Klicktest (Reply-Inbox als Manager) + `db-integration`-Grün zu `c368bcf2` · Pool-Härtungs-Prompt an Lovable · Vectron-Preisnachzug Spicery · Getränke-Checkliste abarbeiten.

## §106 — TG-Rest zweisichtig, TA-Strukturbefund, BL1, Pool-Härtung, Inventur/Theme (19.07.)

Abnahme-Anker: HEAD `069f7788` — vier Gates grün (tsc 0 · eslint 0 · prettier clean · vitest 1797/1797).

**PZ1-Härtung live (`267e058f`):** Die drei stillen Pfade aus §105 melden jetzt nach Sentry (`captureServerError` mit `reason`-Kontext an beiden Returns in `applyServicePoolEnd` und im Best-effort-Catch des Bearbeiten-Pfads), der `shift_end`-Update wirft bei Fehler. Keine Verhaltensänderung. §105-Doku + Laufkarten-Tages-Check sind committet (`cefa1c79`).

**TG1 — Trinkgeld-Rest zweisichtig (Anforderung Frank, umgesetzt):** Die Tagesabrechnungs-Ansicht zeigt „Tages-Bargeld" INKLUSIVE Trinkgeld-Rest (= physische Kassenlage; keine eigene Zeile). Die tägliche Bargeld-Übersicht (`kasse-saldo`) behält die Spalte „Bargeld" OHNE Rest (zahlenidentisch zu vorher, rechnerische Zerlegung) und führt den Rest als eigene Spalte „TG-Rest" mit Summenzeile. KGL-Konstruktion: `computeDailyCash` unverändert (Charakterisierung via bestehende + Golden-Master-Tests mit `tipRemainderCents: 0` eingefroren); daneben `computeDailyCashWithTipRemainder` als EINZIGE Additionsstelle; Rest aus derselben Quelle wie `getTipRemainderByPeriod`. +17 Ledger-Tests. Konsequenz: Abrechnungs-Tages-Bargeld und Übersichts-Bargeld desselben Tags unterscheiden sich um genau den TG-Rest — gewollt.

**TA-Strukturbefund (Ehrlichkeitsregel repo-übergreifend bewährt):** Der geplante Paritäts-Nachbau in tagesabrechnung wurde nach Agenten-STOPP verworfen. Befund: tagesabrechnung verteilt Trinkgeld CENTGENAU PRO KOPF (keine Rundung im gesamten Code); COCO verteilt NACH STUNDEN in VOLLEN EURO (`floor(pool×h/Σh/100)×100`), Rest bleibt in der Lade. Die Systeme unterscheiden sich also in Verteilschlüssel UND Rundung — Einzelbeträge waren nie deckungsgleich. **Betriebsfakt (Frank, 19.07.): Ausgezahlt wird nach COCO-Beträgen.** Beschlüsse: (1) tagesabrechnung bleibt bis zur Archivierung UNVERÄNDERT — kein Formel-Duplikat in ein sterbendes Repo (Sync-Brücken-Antipattern). (2) **Gegenkontroll-Regel bis T0: tagesabrechnung-Tages-Bargeld wird gegen die COCO-ÜBERSICHTS-Spalte „Bargeld" verglichen (beide rest-frei, formelgleich); die Zähl-Zahl für die Schublade ist das COCO-Abrechnungs-Tages-Bargeld.** (3) Historische TA-Trinkgeldwerte weichen von COCO-Werten systembedingt ab — dies ist die Erklärung, nicht ein Datenfehler.

**BL1 — Standort-Chips je Artikelzeile (Bestellwesen, `069f7788`):** In der Lieferanten-Artikelliste je Zeile Standort-Chips vor dem Bearbeiten-Stift (dynamisch aus den Org-Locations, Kurzlabel + Tooltip): Klick toggelt Bestellbarkeit optimistisch mit Rollback. „Mindestens ein Standort" doppelt gesichert (UI-Toast + serverseitige Zod-Regel). Server: `replaceArticleLocations`-Helper aus `updateArticle` extrahiert (KGL, eine Ersetzen-Logik für Dialog UND Chips), neue Fn `setArticleLocations` mit Cross-Org-Checks und Audit `article.locations_set` (before/after).

**Umgebungs-Befund cp1252:** Der Bank-CSV-Test „decodeCp1252…" ist NUR in Lovables Sandbox rot (dortiges Runtime ohne `windows-1252`-TextDecoder / abgespecktes ICU); beim Prüfer und in CI grün (17/17). Merkposten CP1: Testfall per `it.skipIf(<Decoder fehlt>)` mit Begründungskommentar umgebungs-gaten (Muster SUPABASE_DB_TESTS) — Test bleibt in CI voll wirksam, Lovables Lokal-Läufe werden wieder aussagekräftig grün.

**Direktarbeit:** Inventur gruppiert nach Lieferant und berücksichtigt nur AKTIVE Lieferanten (org- und aktiv-gefiltert, paginiert, Leerlisten-Guard). Betriebsregel daraus: **Lieferanten erst deaktivieren, wenn ihr physischer Bestand ausgezählt/aufgebraucht ist** — Artikel inaktiver Lieferanten verschwinden aus der Inventur-Maske, Restbestände würden den Bestandswert still senken. Außerdem: TSB-Location-Theme (Blautöne, Test angepasst), Org-Locations in der Admin-Ansicht, Urlaubs-Anträge um Standort-Zuordnung des Antragstellers angereichert (aus `staff_locations`, org-gescoped; UI-Ziel vermutlich Standort-Filter — bei Gelegenheit von Frank benennen lassen).

**Meldepflicht-Bilanz:** Die §104-Zeile hat sich am 19.07. doppelt bewährt — der tagesabrechnung-Agent stoppte vor einem in sich widersprüchlichen Auftrag (und deckte den Strukturbefund auf), der COCO-Agent stoppte vor einem Commit mit rotem Fremdtest und erbat Freigabe. Beide Stopps waren richtig.

**Offene Merkposten (Sammelstand):** SL2-R (§103) · PY2-T (§105) · CP1 (neu) · H1b-Feuertaufe im Actions-Tab bestätigen · Frank: SEC-02-Klicktest, TG1-Klicktest (18.07.: Abrechnung 140,08 € / Übersicht 135,81 + 4,27), BL1-Klicktest (Alveus-Tee → YUM), Vectron-Preisnachzug Spicery, Getränke-Checkliste, Urlaub-UI-Ziel benennen.

## §107 — Direktarbeit 19.–20.07. + AP1 Artikel-Massenpflege + TG1-PDF (21.07.)

Abnahme-Anker: HEAD `3e2d3df5` — vier Gates grün (tsc 0 · eslint 0 Fehler/2 Warnings · prettier clean · vitest 1842/1842). Zwischenanker: AP1-A `f2e4e07b` (1831), AP1-B `89da0df0` (1839).

**Direktarbeit 19.–20.07.** (148 Commits ohne Prüfer, nachträglich gesichtet):

**RN1 — `payroll_recurring_notes`:** Neue Tabelle für wiederkehrende Lohn-Notizen je Mitarbeiter (`kind ∈ {rate, dauer}`; Raten mit `periods_total` 1–60, Dauer unbefristet; kündbar via `canceled_at`; optional `location_id`). Zweite Migration entzieht Client-INSERT/UPDATE wieder (Policy-Drops + REVOKE) — Schreiben ausschließlich serverseitig via `time-admin.functions`, analog der `payroll_notes`-Nachhärtung vom 18.06. Modul `src/lib/time/recurring-notes.ts` + Tests, UI in `PayrollTab`/Personalakte. Abgrenzung: betrifft NICHT `lohn_recurring_zeilen` (Entgeltzeilen, weiterhin Frank per SQL) — RN1 sind Buchhaltungs-Notizen.

**RS1 — Roster-Pool-Snapshot idempotent + Nach-Sync:** `src/lib/cash/roster-pool-sync.ts` — einmalige Anwendung bei Session-Eröffnung plus additiver Nach-Sync bei Dienstplan-Änderungen nach Eröffnung (`unique(session_id, staff_id)`, `ignoreDuplicates: true`; bestehende Pool-Einträge bleiben unangetastet; aus dem Plan Entfernte bleiben bewusst im Pool). Nach-Sync best-effort, Fehler Sentry-sichtbar (§106-PZ1-Standard). DB-Test vorhanden. Adressiert die Einspringer-Lücke aus §105.

**UZ1 — Urlaubs-/Krank-Zählung:** `src/lib/time/urlaub-count.ts` als EINE Zählquelle (5-Tage-Modell Mo–Fr für Urlaub UND Krank; Feiertage zählen bewusst als normale Arbeitstage; reine Datums-Strings ohne TZ). Von `listAbsencesByStaff` genutzt, Zeitübersicht und Buchhaltungs-Export rechnen identisch. Tests vorhanden.

**PY2-T erledigt:** `buchhaltung-export-columns.test.ts` verankert `columns(mode)` — Merkposten aus §105 geschlossen.

**Bestell-UI-Runde:** Drucklisten-Dialog (`print-order-lists.ts` rein + Test), Einheiten- und Kategorie-Combobox im Artikel-Dialog, Stk/BE-Feld entfernt, Artikelname als Bearbeiten-Shortcut (LA1, gemeinsamer Öffner).

**Kleinere Direktarbeit** an `revenue-core`, `RosterGrid`, `WeeklyPlan`, Sentry-Server (gesichtet, unauffällig). Hinweis: origin trägt zusätzlich einen Branch `fix/migrationskette`.

**TG1-PDF-Nachzug (20.07., Direktarbeit):** `pdfExport`/`daily-summary-data` nutzen `computeDailyCashWithTipRemainder` statt `computeDailyCash` — PDF zeigt dasselbe inklusive Tages-Bargeld wie der Bildschirm (`CashSummaryBlock`). KGL gewahrt: dieselbe EINZIGE Additionsstelle aus §106, kein Formel-Duplikat.

**UI1 — Artikel-Dialog-Labels (Prompt-Arbeit):** Sternchen entfernt, „Preis pro Bestelleinheit (€)" → „€ pro Bestelleinheit". Lovable setzte nur 3 von 4 Labels um; das verbliebene „Name _" wurde in AP1-B nachgezogen. `SupplierForm`-„Name _" bewusst unverändert.

**AP1 — Artikel-Massenpflege** (Einstellungen → Allgemein → Tab „Artikel", admin-only), drei Runden:

- **AP1-A (`f2e4e07b`):** Migration `articles.reviewed_at` + `reviewed_by_staff_id` (kein RLS-/GRANT-Change). `setArticleReviewed` admin-gated via `runGuarded`; Update mit Org-Prädikat + `.select("id")`, 0 Zeilen → Throw vor dem Audit-Write (kein stilles Cross-Org-„Success"); Audit `article.reviewed_set`. `listArticles` additiv um `reviewed_at`. Sub-Tab single-sourced: `SUB_TABS`-Eintrag trägt `adminOnly: true`, Nav-Filter an der Render-Stelle in `route.tsx` (~Z. 428) UND Content-Gate/`?tab`-Fallback in `einstellungen.index.tsx`. `ArtikelPflegeSection`: Lieferanten-Akkordeons (genau eines offen, nur der offene Block rendert), Inaktiv-Toggle, Header „X Artikel · Y geprüft", `ARTIKEL_KEY` EINMAL definiert und identisch für cancel/Snapshot/Patch/Rollback/Invalidate. Euro über shared `fmtCents`.

- **AP1-B (`89da0df0`):** Inline-Editing aller Pflege-Felder (Kategorie, € pro BE, Einheiten, 1 BE = X IE, Mindestmenge, Bestellschritt, Dezimal-Toggle) — kein neuer Schreibpfad: Voll-Objekt-Write über bestehendes `updateArticle`, Input via getestetem `rowToArticleInput` (`packagingUnit` bewusst ausgespart — AK3: DB-Wert bleibt; `null→""` ist roundtrip-sicher, weil das `ArticleInput`-Zod `""` auf `null` zurücktransformiert). Standort-Chips via bestehendes `setArticleLocations` (Min-1-Guard UI + Server). Deutscher Dezimal-Parser nach `src/lib/bestellung/parse-de.ts` verschoben (Dialog UND Grid, KGL). Prettier-Vergessen ~Vorkommen Nr. 9 — vom Autofix-Bot committet (`style: prettier autofix`); Diskrepanz-Meldung („nichts geändert") per SHA-Beweis aufgeklärt: Bot war schneller als der Prüfstand.

- **AP1-C (`3e2d3df5`):** `ArticleForm` byte-identisch (241 Zeilen, Diff leer) nach `src/components/bestellung/ArticleForm.tsx` extrahiert, `Field`/`inputCls` mit-exportiert (`SupplierForm` importiert zurück). Neue reine Konverter in `article-draft.ts`: `articleRowToDraft` (exakt die LA1-Formatierung) und `draftToArticleUpdateInput` — Letzterer in BEIDEN Mutationen der Lieferanten-Seite UND im Grid (eine Abbildung, kein Drift), Roundtrip-Tests. Name-Klick im Grid öffnet den vorbefüllten Dialog; Speichern → `updateArticle` + Invalidate.

**Architekten-Korrektur (§104-Linie):** Die Grilling-Festlegung „`ek_price_cents`-Recalc hängt an `updateArticle`" war falsch — `recalcAllLinkedEk` ist eine eigenständige, manuell aus dem EK-Zuordnungs-Tab angestoßene Function; auch der Dialog löste nie einen Auto-Recalc aus. Betriebsregel: nach einer Massenpflege-Session mit Preis-/Umrechnungs-Änderungen einmal `recalcAllLinkedEk` im EK-Zuordnungs-Tab laufen lassen.

**CI-Verschärfung entdeckt (21.07.):** Der `check`-Job fährt `eslint . --max-warnings=0` — die §-Notiz „max-warnings auf 5" vom 15.06. ist überholt (Verschärfung erfolgte in Direktarbeit, Doku hinkte nach). Die 2 `exhaustive-deps`-Warnings aus AP1-B blockierten dadurch CI #1239–#1241; Fix: `allArticles` in eigenem `useMemo`. Prüfer-Gates laufen ab sofort ebenfalls mit `--max-warnings=0`.

**Offene Merkposten (Sammelstand, führt §106 fort):** SL2-R (§103) · CP1 (§106) · H1b-Feuertaufe · Frank-Klicktests: SEC-02, TG1, BL1, AP1-A (Häkchen + Audit + Manager-Gegenprobe), AP1-B (Preis-Edit → `article.update` im Audit; Voll-Write plättet nichts; letzter Chip), AP1-C (Lieferanten-Seite-Regression + Name-Klick) · Vectron-Preisnachzug Spicery · Getränke-Checkliste · Urlaub-UI-Ziel benennen · Branch `fix/migrationskette` klären.

## §107 — TG-Rest-Endstand, UZ1, Recurring Notes, HF1/RN1/N14b, RS1, Druck-/Display-Welle (19.–21.07.)

Abnahme-Anker: HEAD `2599b384` — vier Gates grün (tsc 0 · eslint 0 · prettier clean · vitest 1865/1865). Dichtestes Wochenende des Projekts; dieser Paragraph deckt drei Tage.

**TG-Rest-Saga, Teil 2 — Endstand (ersetzt den §106-Beschluss „TA unverändert"):** Entscheidungskette nach §106: Anzeige-Abrundung in TA (gebaut) → Referenzfeld-Idee (verworfen: manueller Aufwand) → **Voll-Port des COCO-Modells nach TA** (`tipPoolCoco.ts`, Pflicht-Kommentar „Bewusste Kopie … bis 26.07., bei Abweichungen gilt COCO", 5 Tests, beide Töpfe stundenbasiert mit Euro-Floor). Verbleibende 1-€-Differenz per Daten aufgeklärt: **Die Dienstpläne beider Systeme sind identisch, aber TAs Trinkgeld-Erfassung nutzte den eigenen Plan nie** — `kitchen_shifts.hours_worked` steht uniform auf 8,50 (Erfassungs-Default; real 9–11 h, JIT 8,5 vs. 11), Service-Stunden weichen um Pausen-Deltas ab, Teilnehmerlisten differieren (Zweitkellner-Semantik). Im Pro-Kopf-Altmodell war das folgenlos („die 8,50 waren jahrelang Deko"), der Stunden-Port machte es sichtbar. **Frank-Beschluss: „richtig so" — ±1–3 € sind dokumentierte EINGABE-Differenz, kein Prüffall.** Cent-Prüfzahl der Gegenkontrolle bleibt das rest-freie Bargeld (TA vs. COCO-Übersichts-Spalte). Merksatz: identische Formeln erzeugen nur bei identischen Eingaben identische Zahlen.

**tagesabrechnung-Regression + Regel:** Direktarbeits-Härtung („Admin-Verifizierte Policies", Migration 20260719145629) machte Arbeitszeiten unsichtbar. Hypothesen dokumentiert (RLS-Rekursion is_admin×user_roles — SECURITY-DEFINER-Falle; manager_nav_permissions admin-only; profiles.staff_id), TA-Agent fixte via „Staff-GRANT-Policy komplettiert". **Offener Frank-Check: Sichtbarkeit auch im Manager-Login bestätigen.** Daraus abgeleitete Regel bis zur Archivierung: **tagesabrechnung erhält nur noch verfügbarkeitssichernde Fixes — keine Verbesserungen.** (Der TA-Agent stoppte in dieser Phase zweimal vorbildlich vor widersprüchlichen Aufträgen — die Meldepflicht trägt repo-übergreifend.)

**UZ1 v2 — Abwesenheits-Zählung 5-Tage-Modell:** `urlaubDays` UND `krankDays` zählen nur Mo–Fr (reines Modul `urlaub-count.ts` als EINE Zählquelle für Zeitübersicht + Buchhaltungs-Export; Golden: PON-Block 26.06.–25.07. = 30 Kalendertage → 21; Krank Mo–So → 5). Merksatz: **Markierung = alle Kalendertage (Planungswahrheit), Zählung = Mo–Fr (Kontenwahrheit).** `roster_absence`-Daten unangetastet. PY2-T (columns-Test) im selben Zug erledigt. Nur Anzeige betroffen — Lohnbüro erhielt bisher manuelle Zahlen.

**Recurring Notes (Direktarbeit):** `payroll_recurring_notes` (Raten/Dauer-Notizen fürs Lohnbüro, Server-Fns in time-admin). Nachgelagert **RN1**: Die Migration hatte Client-INSERT/UPDATE-Policies erhalten — wortgleiche Wiederholung der payroll_notes-Nachhärtung vom 18.06. als Folge-Migration (REVOKE + DROP, Writes nur serverseitig). Merkposten RN1-T: Negativ-DB-Test wurde ausgelassen (ungemeldet) — offen für den Dreier-Testblock. Lehre für neue Tabellen: **DENY-ALL ab Geburt** (in TB1 bereits so spezifiziert).

**HF1 — main-Bruch gefangen:** Direktarbeits-Batch (65 Commits) hinterließ 2 tsc-Fehler (Pflicht-`search`-Param an `staff.$staffId` — Ursache: `validateSearch` lieferte `{from: undefined}` statt `{}`) + 1 eslint-Warnung. Vom ersten „prüfe" gefangen, via HF1 repariert (Param echt optional), CI-bestätigt. Erinnerung an §3: CI nach jedem Commit prüfen — die Fehler lagen mehrere Commits unbemerkt auf main.

**N14b — ⌀ pro Gast vereinheitlicht + Kanal-Semantik (wichtig!):** Zwei Implementierungen zeigten 47,32 vs. 44,73 € — Statistik- vs. Kasse-Modell. Franks Betriebs-Klarstellung, über drei Tage numerisch verifiziert (Takeaway-Marker = eigener Takeaway + Wolt): **`vectron_daily_total` enthält eigenen Takeaway, Wolt UND SoUse; `delivery_vectron`-Marker deckt eigenen Takeaway + Wolt ab; SoUse hat eigenen Marker.** Kasse-Modell-Formel (`sessionHouseCentsFromKasse`, standalone): `Σ(pos) + max(0, vectron − Σdelivery_vectron − Σdelivery_souse)` — **Wolt wird NICHT abgezogen (Doppelabzug-Falle)**; unbekannte kinds werfen. Golden-Tests 18.07. → 630.740 und 17.07. → 641.770 Cents. Alle Anzeigen (Inline, Karte, PDF, Trinkgeld-Quote-Basis) aus dem einen Helfer. `computeDailyCash` unberührt (zieht Wolt+SoUse als Plattform-Geld ab — Bargeld-Logik, konsistent).

**RS1 — Dienstplan erreicht offene Sessions:** Kurzfrist-Tausch nach Session-Eröffnung fehlte in der Kasse (Wurzel der §105-Modus-A-Fälle). Fix: Snapshot-Logik nach `roster-pool-sync.ts` extrahiert; additiver Nach-Sync (idempotent, `on conflict do nothing`) bei Dienstplan-Writes UND Tauschen für offene Sessions; Sentry-sichtbar; kein Auto-Löschen. 4 DB-Tests inkl. Bit-identisch-Beweis für bestehende Einträge.

**Druck-/Display-/Dialog-Welle (Grilling-Sessions + Direktarbeit):**

- **DL1 Drucklisten** (Grilling, 5 Entscheidungen): Auswahl-Dialog mit Lieferanten-Checkboxen + Wein-Sammelliste (nach Lieferant geblockt); alle aktiven Artikel je Standort; Zeile = Schreiblinie · Name · Einheit · Zuletzt-Datum (OHNE SKU); zweispaltig ab ~35 Artikeln; Seitenumbruch je Abschnitt; „Sonstiges"-Leerzeilen. Frank-Klicktest mit echtem Papier offen.
- **DP1 Cross-Booking-Punkt auf Displays:** Kern-Logik als gemeinsamer Helper (`cross-booking.ts`, getestet) für Admin-Grid UND Display; Display-Payload bewusst minimal (`{staffId, date}`, keine Zielorte — Datenschutz-Kante halböffentlicher Bildschirme).
- **DP2 Display-Auto-Reload:** Build-Kennung (Vite-define) im Daten-Refresh; Versions-Abweichung → `location.reload()` mit 5-Minuten-Bremse. Lehre: Wand-Displays laden Code nur beim Seiten-Load — Deploys erreichten sie nie.
- **AK1/AK3/LA1:** Kategorie-Combobox (Bestandswerte + freies Tippen, KEIN Löschen — Kategorien sterben mit ihren Artikeln); „Stk/BE (Legacy)"-Feld entfernt (Spalte bleibt, Import-Historie); Lieferanten-/Artikelname als Bearbeiten-Shortcut (stopPropagation, Rollen-Gate). Dialog dabei als `ArticleForm.tsx` extrahiert. **AK2 (Einheiten-Combobox) spezifiziert, Umsetzung offen.** Hausmuster etabliert: „Bestandswerte antippen, Neues frei tippen, nichts verwalten" (AK1/AK2/KM1/TB1).
- **AP1 (Direktarbeit):** Artikel-Review-Kennzeichnung (`reviewed_at`/`reviewed_by_staff_id`, additive Migration, admin-only Einstellungs-Tab, Nav-Filter). Zweck vom Bauherrn noch zu benennen.
- **Weitere Direktarbeit:** Release-Horizon (Staff sieht nur freigegebene Pläne, `roster_releases`-getrieben), Trinkgeld-Rest-Seite mit Monatsnavigation, Wochenplan-Kosmetik (Sonntage gelb, Standort-farbige Sub-Tabs), Inventur-Gruppierung (§106) fortgeführt.

**Geparkt für nach T0 (Prompts fertig):** KM1 (menu_label + Seed beim Prüfer) · TB1 (Telefonbuch, Grilling-Entscheidungen dokumentiert: alle Rollen lesend, eigene Route + Aufgaben-Tab, org-weit 5 Felder, Notdienst-Nummer, tel:-Links) · 034/035-Hausfassungen (Prüfer schreibt) · „Stk/BE"-Spalten-Aufräumen · Mapping-Assistent · Fleiß-Session EK-Verknüpfungen.

**Offene Merkposten (Sammelstand):** RN1-T + SL2-R + CP1 (Dreier-Testblock an Lovable) · AK2 senden · H1b-Feuertaufe · Frank-Klicktests: N14b (18.07. beidseitig 44,73 / 17.07. Basis 6.417,70), RS1 (Tausch→Pool), DL1 (Papier!), DP2 (übernächstes Deploy), SEC-02, BL1, TA-Arbeitszeiten (Admin+Manager), TA-Modell-Port · Vectron-Preisnachzug Spicery · Getränke-Checkliste · AP1-Zweck benennen.

## §108 — Generalprobe bestanden, AV1a, Account-Einladungen, Display-Nacharbeit (22.07.)

Abnahme-Anker: HEAD `9da28550` — vier Gates grün (tsc 0 · eslint 0 · prettier clean · vitest 1874/1874).

**GENERALPROBE 22.07. — BESTANDEN.** Arbeitszeiten-Abgleich 20.–21.07., alle Standorte, DB gegen DB (COCO `time_entries` vs. TA `zt_shifts`): 43 Personen-Tage → Endstand **34 zeichengenau identisch**, 5× akzeptiertes Minuten-Rauschen (Pool-Mechanik vs. Handeintrag, ±10–30 min), 4 bewusst akzeptierte Abweichungen (Frank-Entscheid „passt so": CHEFIN Mo −1 h, JOY Di −3,5 h in TA — Juli-Lohn-Relevanz benannt und akzeptiert —, PETER Mo+Di nur in COCO), **null ungeklärte Fälle**. Gefunden und geschlossen: (1) TA-Erfassungslücke Spicery-Dienstag komplett (7 Personen; per idempotentem SQL-Übertrag nach `zt_shifts` geschlossen — Juli-Lohn-Grundlage), (2) WIT Mo fehlte in COCO (per Zeit-UI nachgetragen), (3) GIG↔PONGSRI Mo: Startzeiten zwischen den Systemen exakt vertauscht (13:00↔15:00) — geklärt und korrigiert. Der Abgleich ist als wiederholbares Rezept etabliert (zwei Fall-1-Queries + Prüfer-Diff) und läuft am T0-Samstag als Abnahme erneut.

**TA-`zt_shifts`-Struktur kartiert (drei Lehr-Fehlversuche, null Schaden):** Schichten hängen an `week_id` (NOT NULL) → `weeks(period_id, week_number, start_date, end_date)`; Wochen existieren MEHRFACH je Datum (perioden-/restaurantsbezogen dupliziert); TA-`staff` hat KEINE Restaurant-Zuordnung. Robuste Auflösung im Übertrags-SQL: `week_id` aus den BESTEHENDEN Kollegen-Zeilen desselben Datums ableiten (Vorprüfung erzwingt genau eine distinct-Woche je Datum, dann `order by week_id limit 1`). Zweifach bestätigte Lektion: **`max()`/`min()` existieren nicht auf UUID** — auch der Prüfer ist hineingelaufen; bei Hand-SQL ist die Vorprüfung das einzige Netz (alle drei Fehlversuche brachen VOR jedem Schreiben kontrolliert ab). Muster-Datei: `ta-zeiten-uebertrag-v4.sql` (Prüfer-Ablage).

**Merkposten PS1 — Personalstamm-Einmal-Import TA→COCO:** TA-`staff` führt vollständige Personalstammdaten (date_of_birth, address_street/zip/city, employment_start, IBAN/BIC, Steuer-ID, SV-Nr., Krankenkasse, Steuerklasse …). Vor/bei Archivierung: Fall-1-Import nach `staff_personal_details` (Match via upper(name)) — erspart AV1-Serie und PKV-Pflege die Tipparbeit. Prüfer baut das SQL auf Zuruf.

**AV1a abgeschlossen (revidierte Fassung):** Grüne-Wiese-Auftrag nach Agenten-STOPP korrigiert — `staff_personal_details` existierte längst (47 Spalten, RLS, payroll-Zugriff als Lohn-Stammdaten-Ausnahme). Umsetzung: nur Adress-Aufspaltung `street`/`postal_code`/`city` (additiv, Freitext-`address` bleibt Migrationspuffer, in der UI nur noch lesend solange befüllt), Rollen/RLS unverändert. RLS-Review-Report des Agenten abgenommen: 1 SELECT-Policy, org-gescoped, kein `USING(true)`, Client-Schreiben implizit DENY, Server via Service-Role — kein Loch. Lehren: (1) Werkzeug-Ausfälle bei der Inventur führen zu falschen Grüne-Wiese-Prämissen — Bestand IMMER verifizieren, bevor „neue Tabelle" beauftragt wird; (2) der Agenten-Stopp war der fünfte vorbildliche der Woche. AV1b/c geparkt (Vorlagen+Generierung, Portal+Canvas-Signatur; Platzhalter-Katalog aus dem echten Vertrag extrahiert inkl. berechneter Befristung; Stundenlohn aus Vergütungs-Schicht; eine Vorlage je Gesellschaft; rechtlich trägt das Papier — Gastro-Schriftform).

**Account-Einladungen (Direktarbeit, sicherheitsgeprüft):** `account.functions.ts` — Konto anlegen, Passwort-Reset, Einladung erneut senden. Alle Writes admin-only (`runGuarded`), Status manager+, Cross-Org-Checks, Rollback bei Anlage-Fehlern, Audit ohne sensible Payload. Kernregel doppelt im Code dokumentiert: **`action_link` (Invite/Recovery) wird NIEMALS ins Audit, in Logs oder in Antworten geschrieben** — Versand ausschließlich per Mail an die Kontoadresse. Zuarbeit für künftiges Onboarding und AV1c.

**Display-Nacharbeit (21.07., Direktarbeit):** Cross-Booking-Punkt zellverankert mit TV-Kontrast (pure Funktion `shouldShowCrossBookingDot`, getestet), zusätzlich auf TRMNL ausgerollt — Punkt jetzt konsistent auf Admin-Grid, TV und e-ink.

**Offene Merkposten (Sammelstand):** RN1-T + SL2-R + CP1 (Dreier-Testblock) · AK2 senden · PS1 (oben) · 034/035-Hausfassungen (Prüfer) · Frank: DL1-Papiertest, DP2-Deploy-Beweis, SEC-02/BL1-Klicktests, Vectron-Preise, Getränke-Checkliste, AP1-Zweck benennen · Post-T0-Schlange: 034 · 035 · KM1 · TB1 · AV1b/c · Stk/BE-Spalte.

## §109 — T0-Cutover-Tag: Export-Saga, TRMNL-Vier-Tage-Welle, LG2-Dept-Split, PB1, Notfallblatt (23.–26.07.)

Abnahme-Anker: HEAD 58deea14 — vier Gates grün (tsc 0 · eslint 0/0 · prettier clean · vitest 1900/1900, 185 Dateien). Dazwischen lagen zwei Prüf-Anker: 24a5a4bb (25.07. früh, 139 Direkt-Commits seit §108, 1893 Tests) und 021d7d8e(25.07., EP2c). Wiedereinstiegs-Regel hat sich doppelt bewährt: beide Prüfungen fanden ausschließlich über git log seit Anker statt, nie über „letzten gesehenen Stand".

T0-Cutover 26.07. — vollzogen. COCO ist ab heute führendes System für Kasse und Zeit. tagesabrechnung bleibt Juli-Lohn-Quelle und geht danach in die Archivierung (nur noch availability-preserving fixes). Der in der T0-Laufkarte vorgesehene Voll-Re-Import der Kassendaten (5 Tabellen, WHERE-NOT-EXISTS-Methode) wurde vom Bauherrn GESTRICHEN — Import-SQLs werden nicht mehr geliefert; die Cutover-Vorlage in docs/cutover-import-vorlage.md bleibt als Referenz liegen.

Direktarbeit 23.–25.07. (139 Commits, Auswahl):

Export-Saga (größter Block): neue Route api/export/download.ts (Echo-Endpunkt für Safari-taugliche Downloads), weekly-export.ts +267 Z., CSV in beiden Zeit-Tabs, Lohn-Excel-Härtung, Viertelstunden-Abrundung + Quartals-Test im Buchhaltungs-Export. Merkposten SEC: api/export/download hat keinen Auth-Check; isExplicitForeignRequestlässt POSTs ohne Origin/Referer durch — begrenzt durch Content-Type-Whitelist + nosniff + attachment, aber Härtung in die Post-T0-Runde.

TRMNL Planungstafel EP1a: öffentliche Route trmnl-planungstafel.$token.ts (SHA-256-Token wie TRMNL1/2) + reines Modul planungstafel.ts mit Tests, GL-Zeile dedupliziert.

Merkposten abgearbeitet: RN1-T (payroll-recurring-notes-RLS-DB-Test), SL2-R (RLS-Seed-Suite), order-replies-DB-Tests erweitert, TB-4 RBAC/Retry, kanonische Auth-URL in config.ts.

Trinkgeld: Quote-Kachel korrigiert, Stunden-Spalte h:mm.

TRMNL-Vier-Tage-Welle EP2/EP2b/EP2c (25.07., Grilling → drei Prompts): Grilling kippte „unten füllen" zu „oben größer" — kein Urlaub/Krank auf halböffentlichen Displays (Fußnoten-Zusage bleibt wahr), keine Genehmigungs-Anzeigen (falscher Kanal). Entscheidungen: 4 Spalten gleichbreit (EP2-7b), TSB kommt nicht dazu (EP2-8), min-height 130px. EP2-Fund: dayHeader kannte nur Heute/Morgen/Übermorgen — bei 4 Spalten hätten Tag 3+4 beide „Übermorgen" geheißen; Funktion als reines Modul nach planungstafel.ts verschoben, ab Tag 3 Wochentagsname, DST-Testfall. EP2b-Fund: die vorhandenen :last-child-Randregeln waren wirkungslos (flaches Grid — :last-child trifft das letzte Kind des Containers, nicht das Zeilenende); Lösung explizite last-col-Klasse beim Rendern, bewusst kein :nth-child (loc-title-Zeilen verschieben jede Zählung). EP2c-Erkenntnis: -webkit-font-smoothing: none (für 1-Bit-e-ink korrekt) verschluckt Font-Gewichte bei kleinen Größen — auf e-ink ist Strichstärke der Lesbarkeits-Hebel, daher 28px/700 → ggf. EP2d 34px/800. Browser-Vorschau ≠ Panel (Font-Stack -apple-system existiert dort nicht). Frank-Klicktest am echten Panel offen; „Synchronisiert vor 9 Tagen"-Badge (TRMNL-seitig) nach Deploy am Gerät verifizieren. Prompt-Regel ergänzt: Behauptungen über den Vorzustand nur nach Messung gegen den Anker (Lovable meldete Bargeld-XLSX-Test fälschlich als „vorher schon rot" — war auf dem Anker nachweislich grün; Ursache Sandbox-Umgebung, dynamischer exceljs-Import). Merkposten: exceljs-Import statisch machen oder Test-Timeout setzen.

OF-Grilling „Offlinefähigkeit" (25.07.) → Notfall-Abrechnungsblatt statt Offline-Sync. R4 bleibt unangetastet (die dort verlangte belegte Offline-Stempelpflicht liegt nicht vor). Kern-Erkenntnisse: Abrechnen ist der einzige nativ aufschiebbare Vorgang (Vectron läuft lokal weiter, Geld liegt im Tresor); getOrCreateOpenSessionCore nimmt bereits manager-gated ein businessDate für Nacherfassung entgegen (Kellner-Selbstabgabe dagegen hart auf heute); lokale PIN-Validierung wäre exakt das in M5 verworfene Legacy-Modell; Offline-Queue mit rückdatierten Buchungen wäre GoBD-Frage an ADHOGA. Geliefert: COCO-Notfall-Abrechnungsblatt.pdf (2 Seiten, Feldstruktur 1:1 nach Schema sessions/channels/terminals/waiter_settlements/tip-pool/expenses/deposits/advances, Euro-Rohwerte ohne Saldieren, Unterschriften+Uhrzeit als Prüfvorteil gegenüber jeder Queue) und COCO-Notfall-Abrechnung.xlsx (35 Formeln, gegen Referenzwerte verifiziert; Rechenwege aus calcWaiterSettlement() + computeDailyCash()). WARTUNGSREGEL (KGL-Ausnahme, dokumentiert): Das Excel dupliziert computeDailyCash als Kontrollrechnung — wer die Ledger-Formel ändert, zieht das Notfallblatt nach. Verbindlich ist immer COCO. Offen: echte Kanal-/Terminalnamen je Standort eindrucken (SQL liegt beim Bauherrn).

LG-Grilling „Stundenlöhne je Schichtart" (26.07.): Bestandsaufnahme ergab drei halbe Wege (aktives staff_compensation.hourly_rate; tote Spalte hourly_rate_2 — von keiner Codezeile gelesen; tote Tabelle staff_compensation_rates— angelegt, DENY-ALL, ungenutzt). Entscheid: staff_compensation_rates wird der Weg (staff × department × valid_from), hourly_rate_2 stirbt bei der Umsetzung; Personalakte bekommt zwei beschriftete Zeilen „Stundenlohn Service"/„Stundenlohn GL". Küche/Service teilen sich vorerst den Satz (Frank-Entscheid — EM damit ohne Lohnwirkung). Juli-Handbetrieb: Stunden-Split per Prüfer-SQL (WZ2-deckungsgleich zu entryRowDepartment) — LAM 62,08 GL + 31,45 SV, MO 77,25 GL + 50,50 SV (Werte aus dem Datenstand VOR dem absichtlichen Überschreiben, CSV beim Prüfer archiviert; Frank hat die Juli-time_entries danach bewusst mit synthetischen Zeiten inkl. Pausen überschrieben). Meldeweg-Empfehlung: Differenzzulage (GL−SV)×GL-Stunden statt zweiter Personalnummer — LG-3 (kennt edlohn zwei Sätze je PN?) ist offene Lohnbüro-Frage und blockiert die August-Bauform. Klärungsbedarf Rückwirkung: seit wann GL-Schichten vor Juli?

LG2 — Dept-Split in der Buchhaltung (26.07., Prompt → Plan → Freigabe mit Auflagen → gebaut): Gesamt-Zelle zeigt bei Multi-Dept-Personen zweite Zeile GL 73,00 · SV 32,00 (Teilwerte bewusst OHNE floorToQuarterHours — Viertelstunden-Abrundung je Teilwert würde die Summe systematisch unterschreiten); Export-Spalten stunden_gl/service/kueche vor urlaubDays; Aggregation als reines Modul zeit-uebersicht-core.ts. Ablauf-Vorbild: Lovable meldete korrekt, dass weeklyData-Roster-Maps nur die aktive Woche abdecken → Option A (getTimeOverview/Batch liefern rosterAreaByStaffDate/rosterGlByStaffDate für die ganze Periode). Lehr-Fund Kommentar-Vergiftung: Lovables Plan übernahm „kitchen>service>gl" aus zwei VERALTETEN Kommentaren in time-admin.functions.ts — der Code war seit dem LAM-Fix richtig (PRIORITY = gl>kitchen>service), nur die Beschreibungen nicht. Neue Hausregel: wer eine Regel ändert, sucht ihre Beschreibungen im ganzen Repo, nicht nur an der geänderten Stelle. Prüfung 26.07. abends: Auflagen 1+3 erfüllt (primaryDepartment im Merge, staffDepts als Vereinigungsmenge über Standorte), Auflage 2 unvollständig (2 Restkommentare, davon 1 im NEUEN Code), 2 geforderte Tests fehlten → LG2-Nachrunde in DN109 Teil B nachgezogen (Kommentare korrigiert inkl. Bonus-Fund im Test-Titel; Mehrstandort-Test + Summenprobe Σ Teilwerte === totalHours mit toBe; Endstand 1902 Tests).

Pausen-Klärung + PB-Serie (26.07.): Vollinventur ergab: Lohnpfad (applyBreakProration — kürzt totalHours und skaliert SFN-Töpfe proportional), Selbstansicht, Statistik, Telegram rechnen NETTO; nur computeShiftHours(Buchhaltungs-Tab, Wochenplan-Summen, Buchhaltungs-Export!) rechnet BRUTTO. Bisher folgenlos (alle Bestandsdaten Pause=0), ab erstem echten Stempeltag Drift Anzeige↔Lohn↔Export. Prüfer-Selbstkorrektur dokumentiert: frühere Aussage „der Lohnpfad ignoriert Pausen" war falsch (Teilmessung nur auf shift-hours.ts). Frank-Entscheid: Pausen werden bezahlt (Status quo des Altsystems — verhindert stille Lohnkürzung beim Umstieg). Bauform dreigeteilt: PB1 Einstellung organization_settings.pausen_bezahlt (default true) + Sub-Tab „Arbeitszeit" in /admin/einstellungen + Bestätigungsdialog + Audit settings.pausen_bezahlt_changed — gebaut und abgenommen, nachweislich wirkungslos (grep-Beleg: kein Treffer in lib/time, lib/lohn, lib/statistics). PB2 (Verdrahtung computeShiftHours → applyBreakProration, Schalter wirkt nur auf Vergütungsstunden, SFN-Töpfe bleiben IMMER netto) blockiert durch Lohnbüro-Frage: bleiben SFN-Zuschläge auf Nettozeit gerechnet, auch wenn die Pause vergütet wird (§3b: nur tatsächlich geleistete Arbeit)? PB3 Tab „Pausenberechnung" (Statuszeile + ArbZG-Aufsicht: Pausen je MA, isArbzgShort-Fälle, >6h ohne Pause) geparkt.

Weitere Direktarbeit 26.07. (Titel erkannt, nicht tief geprüft): Anträge-Tab für Staff, Krankdaten nach 5-Tage-Modell (Review-Merkposten — berührt Mo–Fr-Zählung/Lohn), KW-Klick springt in Wochenplan, Preiskorrektur Ann-Beispiel, Info-Block, Client-Save-Patch gehärtet, Invalidation-Scope-Fix.

Offene Merkposten (Sammelstand): Lohnbüro-Doppelklärung (LG-3 edlohn-Sätze + PB2-SFN-Frage) · LAM/MO-Grundlohn-Richtung klären (steht GL- oder SV-Satz in staff_compensation?) · Krankdaten-5-Tage-Review · TRMNL-Panel-Klicktest + Sync-Badge · Kanal-/Terminalnamen ins Notfallblatt · PB2 · PB3 · exceljs-Import · export/download-Härtung · AK2 · PS1 · 034/035 · KM1 · TB1 · AV1b/c · Stk/BE-Spalte · DL1-Papiertest · AP1-Zweck.

## §110 — Tag 1 nach T0: AT1, BU1, PB2, LG3a/b, Juli-Lohnabgleich, Security-Runde (26.–27.07.)

Anker-Kette: 937fe90c (§109) → AT1 ddb78d8e (1906) → BU1 73a22ec0 → Heap-6144 a770c8d0 → LG3a 32f73b21 (1910) → PB2 708e4906 (1924) → LG3b-Spec-Stand 7d815e77 (1930 Tests, 188 Dateien). Alle Stationen mit vier grünen Gates abgenommen; eslint seit PB2 hart mit --max-warnings=0 gemessen.

AT1 — erster Produktionsfehler (26.07., 22:13, Sentry P1): „Antragsdaten sind ungültig." beim Genehmigen. Ursache: normalizeRequestValue wandelt Steuerklasse 4→"IV", validateTaxClass lehnte "IV" ab — die Normalisierung erzeugte ein Format, das die eigene Validierung nicht besteht. Fix: Validator akzeptiert beide Formen, Normalisierung idempotent, stilles null wirft jetzt. Regressionsschutz: Roundtrip-Invariante validate(normalize(x)) über alle 17 REQUEST_FIELDS — lief beim ersten Durchgang grün (IBAN/SV/Steuer-ID bestehen). Klicktest ✓, kein Folge-Event. Lehrsatz: Die erneute Validierung beim Genehmigen war richtig und bleibt — das Netz hat funktioniert, nur die Masche darüber war falsch geknüpft.

BU1 — Build-OOM: kein transienter Runner-Fehler; Build stand exakt an der 2-GB-Node-Default-Decke (auch auf §109-Anker reproduziert → AT1 entlastet). Fix NODE_OPTIONS=--max-old-space-size=3072 in beiden Build-Skripten; danach Direkt-Erhöhung auf 6144 entgegen der BU1-Meldepflicht („nicht blind erhöhen") — toleriert, aber dokumentiert: gemessener Build-Bedarf 07/2026 liegt zwischen 2 und 3 GB (2047 kippt, 3072 reicht); wächst er über ~3,5 GB, ist Chunk-Diät fällig (pdfjs-dist zuerst), nicht der nächste Deckel. 6144 > physischem RAM der 4-GB-Runner tauscht sauberen V8-OOM gegen stummen OS-Kill.

LG-Grilling-Entscheide (Frank, final): LG-8: drei Sätze je Person (gl/kitchen/service, individuell) — revidiert „Küche lassen wir raus". LG-7: Bedeutung des Alt-Satzes ist personenabhängig → Migration NUR für Ein-Bereichs-Personen automatisch, Mehrbereichs-Leute (MO/EM/LAM) von Hand. LG-9: fehlender Satz → b im Export (Blocker mit vollständiger Liste), c in der Anzeige (0-Satz + roter Marker, kein Ersatzsatz — sichtbar falsch schlägt unsichtbar falsch). LG-12: Rückwirkung von valid_from erlaubt bis zum Beginn der laufenden Abrechnungsperiode, davor serverseitig gesperrt; Fehlertext verweist auf Nachzahlung.

LG3a (Anker 32f73b21): SQL vom Bauherrn (Enum heißt public.staff_department — Prompt-Cast war falsch, Meldepflicht griff): 37 Ein-Bereichs-Sätze migriert (37 Personen × je 1 valid_from — Bestand hatte keine Historie), hourly_rate_2 gedroppt (Vorkontrolle 0). Server-Functions + Stammblatt-Block „Sätze je Arbeitsbereich", isValidFromAllowed nutzt vorhandenes currentBillingCycle (keine zweite 26.–25.-Implementierung); todayIso() rechnet Europe/Berlin. Abweichungen: Schreiben via payroll.compensation.edit statt admin-only → Frank-Entscheid: Recht für payroll-Rolle AUS, Haken gesetzt (27.07.) — payroll bleibt Lese-Rolle. Alle drei Bereichszeilen bei jeder Person statt gefiltert → Frank-Entscheid: so lassen (LAMs lebloser Küchen-Satz 22 € ist geduldeter Bestand). Fehlende DB-Tests der Rate-Functions → gesammelt nach LG3b.

PB2 (Anker 708e4906) — Pausen-Verdrahtung in zwei Runden: Runde 1 lieferte nur Schritte 1–3 und meldete „prüfe-reif" — Prüfung fand halbe Drift (Buchhaltung schalterabhängig, Lohn noch netto) + eslint-Warnung mit echtem Bug (useMemo ohne pausenBezahlt-Dependency → stale Zahlen nach Umschalten); Publish-Sperre bis Fertigstellung. Runde 2 komplett: paidHours/paidMinutes als reines Modul, ein Vergütungsstunden-Begriff für Buchhaltung/Export/Lohn-Grundlohn/Selbstansicht/Personalquote; SFN-Töpfe IMMER netto via applyBreakProration (Lohnbüro-Bestätigung 27.07.: §3b nur auf geleistete Arbeit, auch bei bezahlten Pausen); Provision netto eingefroren (explizites false, Kommentar als Verhaltens-Einfrierung — Frank 27.07.: „vorerst lassen"); Dialog-Vorschau „Σ X h über N MA"; Info-Text-Meinung „sauber: Nein" neutralisiert. Blockierende Tests: Schalter-Invarianz der SFN-Töpfe, Konsistenz Buchhaltung↔Export↔Grundlohn, Pause=0 bit-identisch. Klicktest ✓, Schalter steht auf „bezahlt". Prüfer-Fehlkorrektur dokumentiert: pap-2026-Pfad — Pfadangaben in Aufträgen sind Repo-relativ zu belegen, auch vom Prüfer (pap-2026/** = src/lib/lohn/pap-2026/**); Lovables ls-Beleg-Halt war korrekt.

LG3b (läuft): Spec vom Bauherrn nach docs/ geliefert (neue Regel: referenzierte Aufträge liefert der Bauherr — sie liegen nie von selbst im Repo; „Vorab-SQL kann bei Baubeginn bereits ausgeführt sein — DB-Zustand ≠ Abweichung"). Lohnart-Zuordnung final: Service=Zeitlohn, GL=Zeitlohn 2, Küche=Zeitlohn 3 (gedreht nach realer LAM-Juli-Abrechnung; nur „Küche=ZL3" ist dem Lohnbüro neu — Slot-Bestätigung in Vier-Punkte-Mail angefragt, da Lohnbüro bisher personenabhängig „ZL1=Hauptbereich" buchte, Beleg PN 352). SFN-Zuschläge je Lohnart getrennt mit Bereichssatz (Beleg LAM: 33,75 Nacht-25 % = 18,75 GL + 15,00 SV; Referenz-Fixture). Runde 1 gebaut: rate-resolution.ts rein (jüngstes valid_from ≤ businessDate, kein Bereichs-Fallback, null = LG-9), 6 Tests; PersoNr-Feld im Stammblatt. Spec-Ergänzungen eingepflegt: Export-Blocker-Prüfmenge = ausschließlich Personen mit ungerundeten paidHours > 0 der Exportperiode (Payroll-Accounts ohne Stunden — Viktoria Schaffer, Steuerberater-Zugang ohne PN — blockieren nie); drei Blocker-Gründe missing_rate/missing_perso_nr/unresolved_department, kombinierte Payload, keine Teil-Exporte; MO-Fixture 23,00 in allen drei Bereichen (17,50-Zeile der Juli-Abrechnung war manuelle Justage, kein Sollwert); LAM-Referenz real. Plan-Freigabe-Schleife wurde übersprungen → rückwirkender Plan-Review beim Abnahme-prüfe. Nullmessung blockierend: 37 Ein-Satz-Personen cent-identisch, bevor Mehrsatz-Verhalten gilt.

Juli-Lohnabgleich COCO ↔ edlohn (Vollabgleich, 40 Abrechnungen vs. 38 COCO-Zeilen): LAM exakt (Stunden, Sätze, SFN-Zerlegung inkl. Satz-Split auf die Viertelstunde). Abweichungs-Klassen: Viertelstunden-Rundung (erwartet) · 4 veraltete Stammblatt-Sätze gefunden und korrigiert: APPEL 14→14,50, ANN 14→15,00, SAA 14→14,50, PETER 38,50→41,50 · TSB = eigene GmbH (YUM+Spicery = eine; Cross-Standort-Anteile Andre/GERARD liegen auf TSB-Abrechnung) · Rest = manuelle edlohn-Justage durch Frank/Lohnbüro zur Wunschauszahlung. Daraus neue Betriebsregel ab August: Wunschauszahlung ändert sich → Satz im Stammblatt, NIE mehr Zahlen in edlohn drehen; Parallellauf vergleicht gegen die Probeabrechnung VOR Handkorrekturen (beim Lohnbüro angefragt). Erwartete, gewollte August-Abweichung: MO durchgängig 23,00 statt Juli-17,50-Zeile. Personalnummern nachgezogen: GIG SERVICE = 327 (eigene Person, kein GIG-Duplikat), Ursula Reichstein = 30 (Aushilfe PauSt — Export-Behandlung in Lohnbüro-Mail angefragt). Invariante fortan: jede Person mit Stunden hat eine perso_nr (nicht: jede aktive — Viktoria). Frank-Entscheid: Krankdaten-5-Tage-Review entfällt (Bauherren-Entscheidung, dokumentiert).

Security-Runde (4 Lovable-Findings, alle bewertet): ① order_replies/attachments-Policies von {public} auf {authenticated} — geschlossen (ALTER durch Bauherrn, pg_policies-Kontrolle belegt; USING-Klauseln griffen schon, reine Defense-in-Depth). ③ Leaked Password Protection ENABLED (27.07.; CAPTCHA bewusst aus — PIN-Flow). ② Realtime-Subscribe offen für jeden Authenticated bei aktiver Channel-Nutzung (Dienstplan/Tasks) und PIN-Shadow-Sessions = jeder MA ist „authenticated" → Merkposten: Payload-Prüfung (Ping vs. Inhalt) nach LG3b. ④ bun audit: 27 Vulns, 1 Critical in seroval (transitiv via TanStack Router/Start — Serialisierer der Server-Functions) → Merkposten: TanStack-Update-Runde nach LG3b, eigene Runde mit vollen Gates.

Sonstiges: TRMNL-Panel-Klicktest ✓ (vier Spalten an der Wand, Sync-Badge erklärt). LG2-Kleinlücken (2 Restkommentare/2 Tests) waren bereits in DN109 Teil B geschlossen.

Offene Merkposten (Sammelstand, ersetzt §109-Liste): LG3b-Restbau (Engine je Eintrag, SFN je Lohnart, Export mit 3 Blockern, Anzeige) + Abnahme mit Nullmessung und rückwirkendem Plan-Review · Parallellauf August gegen Probeabrechnung · Lohnbüro-Antworten (Slots, Urlaubs-/Krank-Lohnart, Probeabrechnung, Aushilfen-PauSt) · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt, netto) · exceljs-Test-Härtung · export/download-Härtung · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE-Spalte · DL1-Papiertest · AP1-Zweck · Kanal-/Terminalnamen ins Notfallblatt.

## §111 — LG3b-Serie: Bereichs-Sätze in Motor, Rechner, Export und Anzeige (27.07., ein Tag)

Abnahme-Anker: HEAD 5737cb83 — vier Gates grün (tsc 0 · eslint --max-warnings=0 0 · prettier clean · vitest 1966/1966, 194 Dateien). Anker-Kette der Serie: §110 0d063077 (1930) → E1-Grundmodule cb588731 (1947) → 2a-i G1-Modul 2adec6b5 (1957) → 2a-0 Baseline db347ea5 (1960) → 2a-ii Motor 3ffe6436 → 2a-ii-b Roster-Signale 12ae90e4 → 2a-iii Rechner b01b6257 → 2a-iii-b Mängelbehebung 5be65104 → Mehrsatz-Fixtures 261552cf (1962) → §104-Fixture-Fix + 2b-Beginn 2347a840 (1964) → 2b-Bausteine 281809b0 (1966) → 2b-Abschluss 5737cb83. Jede Station volle Gates; Prüfpunkte des Prüfers nach jedem „prüfe" mit eigenen Messungen.

Arbeitsmodus-Wechsel (dokumentierter Prozess-Entscheid): Nach mehrfacher Etappierungs-Diskussion („Hin und Her") wurde umgestellt auf durchlaufende Serie mit selbst geprüftem A8-Gate je Schritt; Halt AUSSCHLIESSLICH bei §104-Befunden, keine Rückversicherungs-Freigaben. Zwei Prüfpunkte statt sieben. Hat funktioniert: vier echte §104-Halte, null Zeremonie-Halte.

Bauform (Kurzreferenz): entry-attribution.ts (reiner Wrapper um entryRowDepartment; WZ2 sitzt in der Motor-Attribution — Roster-Signale rosterAreaByStaffDate/rosterGlByStaffDate lädt der Motor selbst aus derselben Quelle wie LG2, Nachtrag 2a-ii-b nach Prüfer-§104: die Vertagung auf 2b hätte LAMs Split unmöglich gemacht) · resolveRateCents (jüngstes valid*from ≤ business_date, kein Fallback auf staff_compensation.hourly_rate — Variante B entschieden: Alt-Lesepfad stirbt ersatzlos, fehlende Pflege ist LAUT statt still gedeckt) · drei Bereichs-Buckets + unresolved-Topf + unpriced (A1: Stunden zählen immer, nur Geld 0) · berechneSfnGeld je Bucket mit Bereichssatz · Kategorien Service=zeitlohn, GL=zeitlohn_2, Küche=zeitlohn_3 (Minijob: aushilfe_paust je Zeile, Labels unterscheiden) · Aggregat-Skalar hourlyRateCents = null bei >1 benutztem Bereich (A2; nie Mittelwert, nie Primärsatz — Letzteres war 2a-ii-Mangel M4) · G1 = Option c:U/K-Satz bei Multi-Rate = gewichteter 91-Tage-Durchschnitt (uk-rate-weighted.ts, § 11 BUrlG-Logik); missing_rate → 0 € + Blocker; no_hours → throw („Bauherren-Entscheidung ausstehend") — offener Merkposten · D4 = Option a:Aggregat-SFN = Summe der Bereichs-Beträge · Export-Gate IN buildUebersichtCsv/buildLohnXlsx (A4: LohnExportBlockedError, Panel fängt; kein Teil-Export) · drei Blocker missing_rate/missing_perso_nr/unresolved_department über Prüfmenge „ungerundete paidHours > 0" · CSV/XLSX-Spalten je Lohnart zeitlohn*<bereich>_std/\_cent/\_satz_cent + sfn_<bereich>\_cent, Alt-Spalten bleiben Summen · Panel: BlockerBanner, Bereichszeilen, A5-Zeile „Bereich nicht zuordenbar" · A7: Stammblatt-Labels gedreht („Alt-Satz — von der Lohnrechnung nicht mehr gelesen" / „Diese Sätze sind lohnwirksam").

Nullmessung (A6) als Methode: 2a-0 fror VOR jeder Motor-Änderung drei realistisch modellierte Perioden-Fälle (Service-only, Küche-only, volles SFN-Spektrum) als InlineSnapshot-Literale des Alt-Pfads ein; computeLohnForStaffdafür additiv exportiert. Die Snapshots blieben bit-identisch durch fünf Umbaustufen — Ein-Bereichs-Welt beweisbar unverändert. Mehrsatz-Fixtures gegen die reale edlohn-Juli-Abrechnung von LAM: Nacht25 33,75 h = 18,75 GL×2200 + 15,00 SV×1600, Nacht40 4,50+3,75, So 30,75 GL; Zeitlohn 118.800 + 30.000 c; SFN-Literale 48.098/8.400 c. MO: drei Zeilen à 2300 c, Skalar null, keine Rundungsdrift.

§104-Fälle der Serie (alle vier berechtigt): ① Nullmessungs-Baseline existierte nicht (edlohn-faelle.json ist Golden-Master für berechneLohn, nicht Perioden-Pfad) → 2a-0 eingeschoben. ② Rate-Fallback ungeklärt → Variante B (kein Fallback). ③ Prüfer-§104 zu 2a-ii: Roster-Signale-Vertagung nicht haltbar (WZ2 gehört in den Motor) → 2a-ii-b. ④ H1-Härtung fand Handrechnungs-Fehler: SFN-Literal 48.098 vs. Motor 48.373 — Segment 04:00–04:30 war fälschlich „neutral" gerechnet; der Motor führt 04–06 Uhr korrekt als Nacht 25 % (§3b). Auflösung: Fixture-Schicht endet 04:00 (edlohn-Topfwerte bleiben Referenz), Motor unangetastet, Kommentar dokumentiert Ur-Fassung + Befund. Lehrsatz: weiche Assertions (> 0) beweisen nichts — die Literal-Härtung fand in Minuten, was Review nicht sah. Nebenbefund 2b: Alt-Excel-Filter auf genau eine Zeitlohn-Kategorie hätte zeitlohn_2/\_3-Beträge still verloren — isZeitlohnKategorie-Fix + Doppel-Test, gefunden vor der ersten erzeugten Datei.

2a-iii-Mängel M1–M4 (Prüfung, alle behoben in 2a-iii-b): M1 ?? 0 kollabierte no_hours und missing_rate zu stillem 0-€-U/K (die G1-Lücke der Inventur) → reason-Verzweigung + braucheUkSatz-Guard. M2 Kategorien ungenutzt (nur Labels) → ZEITLOHN_KATEGORIE-Map. M3 A5-Zeile + Blocker-Payload fehlten → nachgezogen, computeExportBlockersverdrahtet. M4 Skalar = Primärsatz statt null.

Konsumenten-Inventur hourlyRateCents (Auflage 2a-1, VOR dem Bau): G1 urlaub-krank-zeilen.ts = Geldpfad (kritisch, hätte still 0 € produziert) · G2 Legacy-Einzelzeile (ersetzt) · G4/G5 Aggregat-SFN (ersatzlos zugunsten Buckets) · D1–D4 Anzeige/Export (null-tauglich). Regel bestätigt: vor Kontrakt-Änderung an Geld-Feldern alle Konsumenten klassifizieren.

BAUHERREN-ENTSCHEID: Parallellauf August GESTRICHEN — COCO ist ab August das einzige Lohn-System. Ersatz-Sicherungen: Nullmessung + LAM-Realfixture + Export-Blocker + Juli-Viertelstunden-Abgleich (§110). Neue Kontrolle: den ersten scharfen August-Export sichtet der Prüfer, bevor er ans Lohnbüro geht(Blocker leer, LAM/MO/EM gegen Stammblatt, Stichprobensummen). Die Lohnbüro-Antworten (Slots Service=ZL/GL=ZL2/Küche=ZL3, U/K-Lohnart, Aushilfen-PauSt, Probeabrechnungs-Basis) sind dadurch WICHTIGER geworden — ohne sie kein erster Export.

Offene Merkposten (Sammelstand, ersetzt §110-Liste): Lohnbüro-Antworten (4 Punkte) — Voraussetzung erster Export · Publish + Klicktest LAM/MO im Panel (2 Zeilen/3 Zeilen, Skalar „—", Blocker-Probe) · Prüfer-Sichtkontrolle erster August-Export · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Realtime-Payload-Prüfung (Security ②) · TanStack/seroval-Update-Runde (Security ④) · LG3a-DB-Tests (Rate-Functions) · PB3 Pausen-Tab · Provisions-Schalter-Frage (geparkt, netto) · Abriss staff_compensation.hourly_rate (Spalte tot, Engine liest nicht mehr) · rosterPlanned-Signaturvergleich Motor↔Buchhaltung (Skill-only-ohne-Area-Randfall) · exceljs-Härtung · export/download-Härtung · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §112 — Kellner-Endzeiten, GLD1-Tagestyp-Defaults, Repo-Vorfall (28.07.)

Abnahme-Anker: d001c641 — vier Gates grün (tsc 0 · eslint --max-warnings=0 0 · prettier clean · vitest 1976/1976, 195 Dateien).

⚠ KANONISCHES REPO GEWECHSELT: github.com/frasum/cocoplatform-13000041. Chronologie des Vorfalls: Ab ~08:05 kamen Lovable-Pushes nicht mehr auf blank-slate-react an (letzter dort gelandeter Commit: 47a6d5a4/§111); zwei Fertigmeldungen ohne Commit, ein Sandbox-Verlust (GLD1 musste neu gebaut werden). Ursache: Disconnect/Reconnect der GitHub-Verbindung — dokumentierte Lovable-Limitation: „Reconnecting to the same repository after disconnecting" wird nicht unterstützt; jeder Reconnect ERZEUGT EIN NEUES REPO. So entstanden nacheinander cocoplatform (09:20, ab 47a6d5a4) und cocoplatform-13000041 (nachmittags, vollständige Historie 6599 Commits, 47a6d5a4 nahtlos enthalten). Bauherren-Entscheid: Das neueste Repo ist kanonisch; blank-slate-react und cocoplatform werden stillgelegt/archiviert, niemand pusht mehr dorthin. Neue Regeln daraus: ① In Lovable NIE wieder Disconnect — jeder Reconnect kostet ein Repo. ② Fertigmeldungen nennen den Commit-SHA, auf dem die Gates gemessen wurden; ohne SHA auf origin/main ist nichts geliefert (zwei Phantom-Meldungen an einem Tag sind der Präzedenzfall). ③ Vercel/CI-Verkabelung nach Repo-Wechsel prüfen. Offener Merkposten Datenschutz: Auch das neue Repo ist PUBLIC, docs/arbeitsweise.md enthält Klarnamen und Stundensätze — Repo zeitnah auf privat stellen (Prüfzugang wird dann neu geregelt).

Kellner-Endzeiten (Betriebsmodell bestätigt und repariert): Modell: NIEMAND stempelt aktiv; Beginn kommt aus hinterlegten Anfangszeiten, Service-Ende entsteht durch die Abrechnungs-Abgabe am Self-Terminal — je Kellner individuell, minutengenau (Viertelstunden-Rundung erst in der Lohn-Anzeige). Der zweistufige Mechanismus (Fall 1 Auto-Clockout offener Einträge; Fall 2 applyServicePoolEnd → syncPoolTimeEntry erzeugt source='pool'-Eintrag) existierte und funktionierte — blockiert wurde er durch vorbelegte Soll-Enden: location_department_defaults.default_checkout war auch für service gefüllt (YUM 23:15), und die First-Writer-Sperre (if (entry.shift_end) return — schützt Handkorrekturen) respektierte die Vorbelegung. Diagnose 27.07.: YUM-Kellner alle auf 23:15 (Soll) statt eigener Abgabe (23:10–23:16); Spicery ohne Default → echte Abgabezeit (KRISS sekundengenau); JASMIN/TU-Werte waren Handeinträge des Bauherrn. Fix (Konfiguration, kein Code): default_checkout = null where department='service' an allen Standorten — ausgeführt 28.07. vormittags. Restlücke bewusst: Wer nie abgibt, hat ein leeres Ende (sichtbar statt erfunden). Verifikation am Folgetag: Abgabe-Abfrage 28.07., jede Abgabezeit = eigenes bis. Nebenfund: Zeitzonen-Anzeige — time_entries-Zeiten in UTC, Pool-Zeiten Berlin; bei Diagnosen 2-h-Versatz einrechnen. Offen: CHEFIN steht mit null/null im Pool (Klärung, ob gewollt).

GLD1 — tagestyp-abhängige Pool-Defaults (Anker d001c641): location_department_defaults + default_checkin/checkout_sunday_holiday (nullable, generisch je Bereich; Migration idempotent, Vorab-SQL war bereits produktiv — dokumentierter Fall „DB-Zustand ≠ Abweichung"). Reines Modul pool-defaults.ts: isSundayOrHoliday (UTC-Wochentag 0 ODER getHolidayName, Bayern — bestehender Helfer, keine zweite Feiertagsliste) + resolvePoolDefaults mit Per-Feld-Fallback sunHol ?? regulär („NULL = Werktags-Wert gilt auch dort", wie im DB-Spaltenkommentar). Verdrahtet in roster-pool-sync; Snapshot-Pfad um gl erweitert (erzeugt shift_start/end/hours_minutes analog Kitchen, sobald beide Defaults gesetzt). Mitternachts-Wrap war in kitchenShiftMinutes bereits korrekt — per Test belegt (17:00–01:00 → 480, 15:00–02:00 → 660), nichts dupliziert. Bauherren-Werte gesetzt: GL Mo–Sa 17:00–01:00, So/Feiertag 15:00–02:00, alle Standorte. §104-Fund der Prüfung: Erstfassung ließ So/Feiertag OHNE Sonderwerte auf null/null fallen (hätte sonntags Küchen-Vorbelegung und Service-Anfangszeiten gelöscht — Abgabe-Automatik ohne Beginn); Tests waren grün, weil sie das Gebaute statt das Beauftragte prüften (H1-Lehrsatz erneut). Korrigiert inkl. Mischfall-Test. Offener Folgeauftrag: calendar.$token.ts (ICS-Abo) liest nur Werktagsspalten — an So/Feiertagen zeigt der Abo-Kalender falsche GL-Sollzeiten (Lovable-Meldung, korrekt).

Sentry-Stand: COCO-9 NEU (27.07. ~09:30, 1 Event): Stammblatt-Speichern riss staff_personal_details_tax_class_check(Constraint I–VI), Server-Parser ließ freien Text durch (nullableText(8)) — die Änderung ging verloren; Klärung offen, wessen Akte betroffen war + Mini-Auftrag Schema-Härtung (Enum I–VI, ""→null, Normalisierung am Parse-Rand). COCO-8 = Samstagsserie VOR dem AT1-Fix (seit Fix kein Event — Fix hält). COCO-7 UI-Rauschen, COCO-5/6 Altbestand.

Offene Merkposten (Sammelstand, ersetzt §111-Liste): Repo auf privat + Prüfzugang regeln · blank-slate-react/cocoplatform archivieren · Verifikation Kellner-Enden 28.07. · CHEFIN-Pool-Klärung · COCO-9: betroffene Akte + tax_class-Schema-Härtung · ICS-Kalender So/Feiertag-Defaults · Lohnbüro-Antworten (4 Punkte) — Voraussetzung erster Export · Publish + Klicktest LAM/MO im Panel · Prüfer-Sichtkontrolle erster August-Export · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · Abriss staff_compensation.hourly_rate · rosterPlanned-Signaturvergleich · exceljs-Härtung · export/download-Härtung · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §113 — SE1: Sentry-Selbsttest formalisiert; Prüfer-Fehlmessung gegen stillgelegtes Repo (29.07.)

Abnahme-Anker: HEAD f11ad15a (Merge aus 2f3ea754 + e45aa12e) — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint --max-warnings=0 0 · prettier --check . clean · vitest 197 Dateien / 1991 Tests grün, 0 Skips. Die Baumeister-Meldung nannte 903e297a9 (1990/1991 + 1 Skip); das ist ein Zwischenstand der Serie, gemessen vor den Doku-Commits. Anker ist der HEAD nach Doku-Nachzug, nicht der Zwischenstand. Kette: 67d7b15a (Code) → 903e297a (routeTree) → e45aa12e (Doku) → f11ad15a (Merge).

**Befund vor dem Bau — vom Prüfer falsch gestellt, hier richtiggestellt (Prozess-Lehre, wichtiger als das Feature):** Der Prüfer meldete am Vormittag, die Sentry-Testknöpfe seien in Produktion gelaufen, ohne dass der Code in irgendeinem Commit existiere, und leitete daraus die Regel „Publish ohne Commit" ab. **Dieser Befund war falsch und die daraus abgeleitete Regel ist gestrichen.** Tatsächlich lagen die Knöpfe sauber committet auf main (`4445db86` „Test-Throw-Button hinzugefügt", `2f3ea754` „Sentry-Testfehler behoben") — nur eben im kanonischen Repo `cocoplatform-13000041`, während der Prüfer gegen das am 28.07. stillgelegte `blank-slate-react` maß (dort endet die Historie bei `47a6d5a4`/§111). Ursache ist nicht menschlich, sondern konfigurativ: die Projektanweisung des Prüfers zeigte weiterhin auf das Altrepo, also klonte jede neue Session wieder das Archiv. Zwei Folgefehler derselben Wurzel: der Orientierungsbericht behauptete „der 28.07. hat keine Commits hinterlassen" (dort liegt ein ganzer Arbeitstag: Kellner-Endzeiten, GLD1, §112), und der SE1-Prompt verlangte die Doku-Nummer §112, die längst vergeben war — daher diese Korrektur.

**Die tatsächliche Lehre, in drei Sätzen.** ① Der Prüfer belegt vor jeder Messung, dass er im **kanonischen** Repo steht — Repo-URL zuerst, Anker danach; ein korrekt geprüfter Anker im falschen Repo ist wertlos. ② Meldet der Baumeister, der im Auftrag genannte Anker sei überholt, ist das ein **Befund über den Prüfer**, kein Widerspruch in der Meldung — hier stand genau das in der Bestandsmeldung („der im Prompt genannte Anker 47a6d5a4 war überholt; Arbeitsbaum sauber, keine unversionierten Änderungen"), und der Prüfer hat es überfahren statt es zu prüfen. Die Meldepflicht hat funktioniert; die Prüfung darüber nicht. ③ Eine Fertigmeldung nennt den SHA **auf `origin/main`**, nicht die Arbeitsstand-Kennung — diese Regel aus §112 bleibt, sie war richtig, nur der Anlassfall war diesmal ein anderer. Gegenmittel umgesetzt: Repo-URL in der Projektanweisung auf `github.com/frasum/cocoplatform-13000041` gezogen.

**SE1 gebaut:** Selbsttest-Block auf `/admin/config-check` (admin-only via `beforeLoad`), zwei Knöpfe Client/Server. Gemeinsame Klasse `SentryTestError` (`src/lib/monitoring/sentry-selftest.ts`) für beide Seiten — vorher gruppierte die Client-Probe als nacktes `Error`. Tag `probe: selftest` auf beiden Events, damit Alarm-Regeln sie ausschließen können. UI zeigt denselben ISO-Zeitstempel, der im Event steht (Zuordnungsschlüssel im Dashboard), plus lokal lesbare Zeit. Knöpfe deaktiviert, wenn `SENTRY_DSN` fehlt (Amber-Hinweis darüber); 5-Sekunden-Doppelklick-Bremse pro Knopf. Server-Probe läuft bewusst **durch `runGuarded`**, nicht per Direktaufruf von `captureServerError`: nur so sind Rollen-Gate, Ausnahme-Filter und Envelope-POST gemeinsam bewiesen. `SentryTestError` wird nach `runGuarded` gefangen und in `{ ok: true, triggeredAt }` umgewandelt — kein Dev-Overlay, keine rote Client-Seite. Kein `audit_log`-Eintrag (Bauherren-Entscheid Variante a; Folge: das datensparsame Event kennt `role`, nicht `staff_id` — bei mehreren Admins keine Zuordnung, bewusst in Kauf genommen).

**Filter-Invariante (der eigentliche Härtungsgewinn):** Der Ausnahme-Filter aus `reportGuardedFailure` (ForbiddenError, PoolHoursWarningError) ist als reines `isMonitoringSuppressed(err)` herausgezogen — eine Regel, eine Implementierung (KGL), fünf blockierende Tests (`src/lib/admin/monitoring-filter.test.ts`). Der wichtigste: `SentryTestError` wird NICHT unterdrückt. Begründung: Ein Kanarienvogel, den eine spätere Filter-Erweiterung still stummschalten kann, ist schlechter als keiner. Verhalten bit-identisch, reine Extraktion; namensbasierter PoolHoursWarningError-Check (zyklischer Import admin↔cash) im Kommentar bewahrt. Repo-Suche bestätigt: nur eine Kopie der Unterdrückungs-Logik, keine Duplikate.

**Betriebsregel:** Nach jedem Publish beide Proben auslösen, im Dashboard gegen den angezeigten ISO-Zeitstempel abgleichen, danach die Issues auf Resolved setzen (Präzedenz §85). Wiederauftreten re-opent automatisch.

Offene Merkposten (Sammelstand, ersetzt §112-Liste): **Repo auf privat stellen** — `cocoplatform-13000041` ist PUBLIC und `docs/arbeitsweise.md` enthält Klarnamen, Personalnummern und Stundensätze; der Prüfer hat das Repo am 29.07. ohne Anmeldung geklont (Beleg, dass es weltlesbar ist). Danach Prüfzugang neu regeln · blank-slate-react und cocoplatform archivieren · **AC2-Befunde** (Prüfer-Durchsicht des direkt gebauten Orphan-Panels): ① `listOrphanAuthAccounts` filterte projektweite Auth-User gegen `user_links` **der eigenen Org** — bei einer zweiten Organisation hätte das Panel deren Nutzer samt E-Mail und letztem Login gezeigt; richtige Prüfmenge ist „kein `user_links`-Eintrag, irgendwo" (AC2-F, erledigt). ② Seitenschleife brach bei 10.000 Konten still ab (AC2-F, erledigt) · **DB1-Serie**: verschluckte PostgREST-Fehler in DB-Test-Setups (140 Stellen in 30 Dateien; DB1-A cash-read erledigt, DB1-B restliche Kassen-Suiten, DB1-C übrige) — Anlass ist der rote `cash-read.db.test.ts` (`TypeError: Cannot read properties of null` im beforeAll statt der echten DB-Meldung); Ursache erst nach DB1-A lesbar. Einordnung: DB1 ist keine neue Erkenntnis, sondern das Nachziehen von **H2/N9** („Diagnose-Blindflug", `src/lib/supabase/expect-ok.ts`) in die Testschicht, die damals nicht mitgenommen wurde; die Trennung `expectOk` (Produktion, mit Sentry-Reporter) ↔ `expectData` (Tests, ohne) ist **bewusst** — nicht im Namen von KGL zusammenführen, sonst landen Test-Setup-Fehler in Sentry · Klärung, ob der `cash-read`-Suite-Fehler schon zum §112-Anker `d001c641` bestand (Regression oder Altbestand) · `db-integration` steht seit §8 auf `continue-on-error` — nach dem August-Export wieder scharf stellen · **exceljs-Zweizeiler endlich ziehen** (statischer Import oder Test-Timeout): `bargeld-export.test.ts` wurde inzwischen dreimal als „vorher schon rot" gemeldet und war jedes Mal auf dem Anker grün; die Sandbox-Zeitüberschreitung kostet jedes Mal Prüfzeit · `retry()` existiert dreifach (zwei wortgleiche lokale Kopien in order-replies-Tests + `withDbInsertRetry` in `db-setup.ts`), KGL-Zusammenführung nach DB1-C · COCO-9: betroffene Akte + tax_class-Schema-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · Lohnbüro-Antworten (4 Punkte) — Voraussetzung erster Export · Publish + Klicktest LAM/MO im Panel · Prüfer-Sichtkontrolle erster August-Export · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · Abriss staff_compensation.hourly_rate · rosterPlanned-Signaturvergleich · export/download-Härtung · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §114 — AC2-Mandantenfilter, DB1-Diagnose in DB-Test-Setups, Repo privat (29.07.)

Abnahme-Anker: HEAD 0533b6c2 — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 199 Dateien / 2002 Tests grün, 0 Skips, 0 Fehler. Rechnung geht auf: 1996 (Anker §113) + 6 (AC2-F) + 0 (DB1-B) = 2002.

**AC2-F — Mandanten-Leck im Orphan-Panel geschlossen.** Das Panel „Anmeldungen ohne Mitarbeiter" war direkt gebaut worden und ging ungeprüft in Produktion. Die Prüfer-Durchsicht fand zwei Befunde. ① `listOrphanAuthAccounts` holte **projektweit** alle Auth-User und filterte sie gegen `user_links` **der eigenen Organisation**. Bei einer Organisation unauffällig — ab der zweiten hätte das Panel sämtliche Nutzer der anderen Organisation samt E-Mail und letztem Login angezeigt. Richtige Semantik: verwaist ist ein Konto, das in KEINER Organisation verknüpft ist; `user_links` wird deshalb ohne Org-Filter gelesen, und ein Konto der Org B fällt von selbst heraus. ② Die Seitenschleife brach bei 10.000 Konten still ab und hätte eine gekürzte Liste als vollständig ausgegeben — jetzt `throw` mit `lastPageWasShort`-Flag, also auch dann laut, wenn die letzte Seite zufällig genau voll war. Auswahl- und Sortierlogik liegen als reines Modul in `src/lib/admin/orphan-accounts.ts` (vorher in der Server-Function eingebacken und damit nicht prüfbar), sechs blockierende Tests; der dritte heißt wörtlich „Mandanten-Leck: Konto einer FREMDEN Organisation darf nicht als verwaist erscheinen", damit der Test selbst sagt, was er schützt. Kopfkommentar begründet die projektweite Abfrage ausdrücklich, damit niemand den Org-Filter „aus Sauberkeitsgründen" wieder einbaut. SaaS-Erweiterungspunkt notiert (Muster `holiday_region`): ab der zweiten Organisation gehört dieses Panel auf eine Plattform-Ebene, nicht in die Mandanten-Ansicht — auch ein wirklich unverknüpftes Konto ist projektweiter Zustand.

**Lehre daraus, allgemein:** Direkt gebaute Features gehen ohne Review in Produktion. Das ist zulässig und oft richtig — aber die Durchsicht bei der nächsten Gelegenheit ist keine Kür. Hier lag zwischen Bau und Fund weniger als eine Stunde; das ist der Normalfall, auf den wir uns nicht verlassen dürfen. Bemerkenswert im Kontrast: das `hasAccount`-Bit in `listStaff` war in derselben Runde korrekt personaldaten-frei gehalten (nur das Bit, keine E-Mail, mit SD1-Kommentar) — im Panel daneben fehlte dieselbe Sorgfalt.

**DB1-A/B — verschluckte PostgREST-Fehler in DB-Test-Setups.** Anlass war ein roter `cash-read.db.test.ts`, dessen Ursache nicht ermittelbar war: das Setup benutzte `const { data: s } = await …` ohne `error`, danach `s!.id` — der Test starb mit `TypeError: Cannot read properties of null (reading 'id')`, die echte Datenbank-Meldung war zu diesem Zeitpunkt verworfen. Neuer Helfer `expectData(res, label)` in `src/test/expect-data.ts` (bewusst ohne Supabase-Import, damit er im normalen `vitest run` testbar ist, nicht nur im DB-Job), re-exportiert aus `@/test/db-setup`; prüft `error`, hängt `code`/`details`/`hint` an, behandelt den `data===null && error===null`-Fall getrennt. DB1-A: Helfer + 5 Tests + `cash-read` (4 Stellen). DB1-B: die übrigen zwölf Kassen-Suiten, 52 Stellen — Gate war ausdrücklich **±0 Tests**, weil eine reine Umformulierung weder Tests erzeugt noch verliert. Danach null verbliebene `const { data … } = await` ohne Fehlerprüfung in `src/lib/cash/*.db.test.ts`. Nebengewinn: der Doppel-Cast `bd as unknown as string` bei `current_business_date` ist ersatzlos entfallen.

**Einordnung, wichtiger als der Umbau:** DB1 ist keine neue Erkenntnis, sondern das Nachziehen von H2/N9 („Diagnose-Blindflug", `src/lib/supabase/expect-ok.ts`) in die Testschicht, die damals nicht mitgenommen wurde. Dieselbe Lehre musste zweimal gelernt werden, weil sie beim ersten Mal nur im Produktionscode angewendet wurde. Die Trennung `expectOk` (Produktion, mit Sentry-Reporter) ↔ `expectData` (Tests, ohne) ist **bewusst** — nicht im Namen von KGL zusammenführen, sonst landen Test-Setup-Fehler in Sentry.

**Zulässige Reste, dokumentiert damit sie nicht „aufgeräumt" werden:** Ein `!` an einem `rows.find(…)`-Ergebnis (z. B. `cash-correct.db.test.ts`, `entry!.meta` nach `expect(entry).toBeDefined()`) bleibt stehen — das ist eine Aussage über den Testinhalt, kein verschluckter DB-Fehler. In `cash-submit` wurden 10 statt der beauftragten 9 Stellen umgestellt (ein zweiter `current_business_date`-Aufruf mit bereits vorhandener Fehlerprüfung, für Einheitlichkeit mitgenommen — regelkonform, war aber meldepflichtig gewesen).

**§104 im Positivfall.** Bei DK1 wurde eine zweite Prompt-Fassung ausgegeben, deren Änderungen 1–4 bereits eingespielt waren. Der Baumeister hielt an, meldete den Ist-Stand mit Grep-Zahlen und fragte nach, statt still zu überschreiben. Der Prüfer hat gegengemessen und jeden Punkt bestätigt; ausgeführt wurde nur der fehlende Teil (DK1-N1). Das ist der Mechanismus, wie er gedacht ist — und der Gegenfall vom selben Tag steht in §113. Prüfer-Regel daraus: **beim erneuten Ausliefern eines Prompts dazusagen, was sich gegenüber der vorigen Fassung geändert hat.**

**Repo-Zugang umgestellt.** `cocoplatform-13000041` ist seit 29.07. **privat** — vorher war es öffentlich, und `docs/arbeitsweise.md` enthält Klarnamen, Personalnummern und Stundensätze (Verstoß gegen Gründungsdokument §7.6 „keine Personaldaten im Repo", Lektion thaitime). Anonymer Klon ist verifiziert nicht mehr möglich. Prüfzugang läuft über einen fein granularen Read-only-PAT (nur dieses Repo, nur `Contents: Read-only`, kurze Laufzeit, täglich widerrufen). **Zwei Punkte bleiben offen und sind bewusst zu entscheiden, nicht zu vergessen:** ① Die Daten stehen weiterhin in der Historie über rund 6.600 Commits; Privatstellen versteckt sie, löscht sie nicht — ein History-Rewrite wäre mit der Lovable-Pipeline eine eigene Baustelle mit echtem Risiko. ② Auch in einem privaten Repo gehören Klarnamen mit Stundensätzen nicht in eine Entwicklerdatei; die saubere Lösung ist Umstellung auf Personalnummern/Kürzel mit Zuordnung außerhalb des Repos.

Offene Merkposten (Sammelstand, ersetzt §113-Liste): **History-Purge entscheiden** (Personaldaten in ~6.600 Commits; bewusst entscheiden, nicht vergessen) · **Doku auf Kürzel/PN umstellen**, Klarnamen-Zuordnung außerhalb des Repos · **CI-Antwort lesen**: nach DB1-A/B nennt `db-integration` jetzt die echte Ursache des roten `cash-read` statt `Cannot read properties of null` — und Klärung, ob der Fehler schon zum §112-Anker `d001c641` bestand (Regression oder Altbestand) · **DB1-C**: 84 Stellen in 17 Dateien (Bestellwesen, Admin, Migration, Auth) · `retry()` existiert dreifach (zwei wortgleiche lokale Kopien in order-replies-Tests + `withDbInsertRetry` in `db-setup.ts`), KGL-Zusammenführung mit DB1-C · **exceljs-Zweizeiler endlich ziehen** (statischer Import oder Test-Timeout): `bargeld-export.test.ts` wurde dreimal als „vorher schon rot" gemeldet und war jedes Mal auf dem Anker grün · `db-integration` steht seit §8 auf `continue-on-error` — nach dem August-Export wieder scharf stellen · überflüssiger Cast `u as AuthUserLike` in `orphan-accounts.functions.ts` beim nächsten Anfassen entfernen (kosmetisch) · COCO-9: betroffene Akte + tax_class-Schema-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · Lohnbüro-Antworten (4 Punkte) — Voraussetzung erster Export · Publish + Klicktest LAM/MO im Panel · Prüfer-Sichtkontrolle erster August-Export · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · Abriss staff_compensation.hourly_rate · rosterPlanned-Signaturvergleich · export/download-Härtung · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §115 — Externer Audit ausgewertet; TG3 Tagesbericht-Zustellgate; IM1/IM1a Vorschau-Schutz Kasse (30.07.)

Abnahme-Anker: HEAD 97883c0f — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 202 Dateien / 2030 Tests grün, 0 Skips. Kette der Anker seit §114: a5646ed0 (TG3) → 805b16b6 (IM1) → 97883c0f (IM1a + Wächter-Härtung, Direkt-Runde des Bauherrn).

**Externer Audit — Bilanz vor dem Bau (Methoden-Lehre, wichtiger als die Einzel-Fixes):** Der Bauherr ließ einen externen Audit erstellen; Ergebnis waren sechs Befunde mit fertigen Lovable-Prompts (SEC-01, SEC-05, CORR-01/02/03, DOC-01). Der Prüfer hat jeden Befund einzeln gegen den Anker 7d769e3e verifiziert. Bilanz: **fünf von sechs Fundstellen berechtigt — null Baupläne unverändert ausführbar.** Wären die Prompts direkt an den Baumeister gegangen: SEC-01 hätte alle Export-Downloads mit 401 abgeschaltet (Form-POST trägt keinen Authorization-Header; Session liegt in localStorage, nicht im Cookie), CORR-03 wäre am partial-Unique-Index waiter_settlements_active_per_staff gescheitert (der erklärende Kommentar stand direkt über der Stelle, die der Audit umbauen wollte), CORR-01 enthielt als Variante eine execute_sql-RPC (beliebiges SQL per String mit Service-Role = dauerhafte Hintertür; existiert nicht und darf nie existieren), SEC-05 Teil 1 war unbaubar (runGuarded erhält eine Rolle, kein Caller-Objekt — der Patch hätte 114 Aufrufstellen gebraucht, die der Prompt selbst verbot), und DOC-01 bezifferte 696 Klarnamen-Treffer, die sich als deutsches Substantiv-Groß­schreibungs-Regex entpuppten („Offene Merkposten", „Golden Master"); reale Personenbezüge: unter 25 Stellen. **Regel daraus: Ein externer Audit ist ein Metalldetektor, kein Bagger.** Fundstellen ernst nehmen, jede einzeln gegen die Code-Realität messen, Baupläne grundsätzlich selbst schreiben. Fertige Fremd-Prompts umgehen die Dreiteilung (Bauherr/Baumeister/Prüfer) an ihrer empfindlichsten Stelle: dem Abgleich mit dem Ist-Stand.

**TG3 — Tagesbericht: last_sent nur bei echter Zustellung (Audit CORR-02, bester Befund der Serie).** runDailyReportForOrg markierte den Bericht als versendet, unabhängig davon, ob eine einzige Zustellung gelang; bei Totalausfall (Bot-Token weg, API down) sah der stündliche pg_cron „already-sent" — der Tag blieb ohne Bericht und ohne dass es jemand erfuhr. Jetzt: Entscheidungsregel als reines Modul decideReportGate (src/lib/telegram/report-gate.ts, 6 blockierende Tests) — markSent nur bei !skipGate && delivered > 0; Sentry-Alarm „keine einzige Zustellung" (op telegram.daily_report, orgId als eigenes Feld) bewusst AUCH im manuellen „Jetzt senden"-Pfad. **Bauherren-Entscheid (final): kein automatischer Same-Day-Retry** — der Alarm ist das Netz, „Jetzt senden" ist der Retry mit Mensch davor; ein 14-Uhr-Bericht, der um 7 gedacht war, stiftet Verwirrung. wrong-hour-Logik unangetastet; die Audit-Idee last_attempted_at + Backoff verworfen (der stündliche Cron IST die Zeitsteuerung — eine zweite Uhr daneben wäre ein KGL-Verstoß). Kein partial_delivery-Alarm: ein geplatzter Chat unter 40 ist Alltag; ein wöchentlich harmlos feuernder Alarm trainiert Wegklicken an.

**IM1 — Vorschau-Schutz in allen Kassen-Schreibpfaden (Audit SEC-05, neu geschnitten).** Bedrohungsmodell: Die Admin-Vorschau lädt die ROLLE des Vorschau-Ziels (admin-context); bei Vorschau auf einen Manager/Admin standen alle Kassen-Schreibgates offen — Kassenbuchungen im Zustand „ich sehe die App als Sumit". Inventur (maschinell): 14 Admin-Schreibpfade in cash.functions.ts, nicht 6 wie im Audit; darunter der Sonderfall lockSession (POST ohne runGuarded, delegiert an lockSessionCore — wäre bei Mustersuche durchgerutscht). Alle 14 rufen jetzt assertRealIdentity(caller) direkt nach loadAdminCaller (grep-Beleg: 15 Aufrufe inkl. Bestand submitWaiterSettlement). Dazu statischer Wächter-Test cash-impersonation-guard.test.ts (Vorbild server-boundary.test.ts): jeder POST-Block mit loadAdminCaller/loadStaffCaller muss assertRealIdentity enthalten — schützt auch jede KÜNFTIGE Funktion; Selbstschärfe-Probe verifiziert (Aufruf testweise entfernt → Test rot mit Funktionsname). Der Audit-Teil „zentraler runGuarded-Patch" ist dokumentiert VERWORFEN: runGuarded sieht keine Impersonation, ein ctx-basierter Teilschutz sähe aus wie eine Schicht und wäre keine.

**IM1a — Direkt-Runde des Bauherrn nach zwei §104-Meldungen des Baumeisters (Muster-Beispiel für den Loop):** Der Baumeister meldete korrekt, dass assertRealIdentity ein einfaches Error wirft, nicht ForbiddenError — die Prüfer-Annahme „isMonitoringSuppressed greift" traf am Typ nicht zu. Die Prüfer-Analyse ergab: kein Rauschen, weil der Aufruf VOR runGuarded sitzt — Schutz durch Platzierung. Der Bauherr baute daraufhin direkt die robustere Form: **PreviewReadOnlyError erbt von ForbiddenError** — Unterdrückung hängt jetzt am Typ, nicht an der Position (Position ist zerbrechlich: der nächste Aufruf innerhalb eines gemeldeten Pfads hätte Rauschen erzeugt). Eigener name bleibt für Diagnose; kein Sonderfall im Filter nötig; Filter-Test ergänzt. Dazu Wächter-Härtung: Deklarations-Regex toleriert Typ-Annotationen/Umbrüche, und eine Vollständigkeits-Gegenprobe erzwingt, dass JEDES createServerFn-Vorkommen der Datei entweder Import oder erfasster Block ist — eine ungewöhnliche Schreibweise kann den Wächter nicht mehr stumm aushebeln. Lehre: **Schutz am Typ statt an der Position; und eine korrekt geformte §104-Meldung (Abweichung benennen, nicht anpassen) hat hier direkt zur besseren Lösung geführt.**

**Bewusste Priorisierung (nicht vergessen, sondern entschieden):** Kritischer Pfad bis 25.08. ist der erste scharfe August-Export — Lohnbüro-Antworten, LAM/MO-Klicktest, Prüfer-Sichtkontrolle. Deshalb NACH dem Export: **SEC-01** (Download-Endpunkt: Lovable-Preview-Origin entfernen + CSP `default-src 'none'; sandbox` — einziger Fix an einem öffentlichen Endpunkt, den alle Exporte nutzen; nicht in der Export-Woche anfassen. Verifizierter Stand: Allow-List enthält KEIN text/html entgegen Audit-Behauptung, nosniff vorhanden, Content-Disposition immer attachment, Formular-Angriff wird durch Origin-Check blockiert — Restrisiko ist Reflected-File-Download/Phishing, nicht Datenabfluss. Echte Auth ginge nur über kurzlebige signierte Tickets aus der Server-Function, da Form-POST headerlos ist — eigener Entwurf), **CORR-01** (replaceSettlementPartners: Delete-Fehler ungeprüft; Differenz-Ansatz statt delete-then-insert — unique(settlement_id,staff_id) existiert bereits; drei Aufrufer, nicht einer; loadSessionWithLock sperrt NICHTS und muss umbenannt oder echt gesperrt werden), **CORR-03** (correctWaiterSettlement: superseded-Fenster bei Insert-Fehlschlag → Option A Compensating Action, Original-Status zurücksetzen, Rücksetz-Fehler melden statt werfen; Option B SECURITY-DEFINER-RPC als spätere Endform), **DOC-01** als Handarbeit (Prüfer liefert Trefferliste <25 Stellen; Sonderfall Z. 1047 „zwei verschiedene Schumann" ist eine Lohn-LEHRE, deren Inhalt der Namenskonflikt ist — umformulieren, nicht mappen; Wächter-Test in src/, kein Grammatik-Regex).

Offene Merkposten (Sammelstand, ersetzt §114-Liste): **Domänen-Nachzug Vorschau-Schutz**: dasselbe IM1-Loch besteht in allen anderen Domänen mit loadAdminCaller-Schreibpfaden (Größenordnung 114 runGuarded-Stellen repo-weit, cash stellte 14) — pro Domäne gleiches Muster: Aufruf + Wächter-Test · **SEC-01 nach August-Export** (Umfang oben) · **CORR-01 + CORR-03 nach August-Export** (Umfang oben) · **DOC-01-Handarbeit** (Trefferliste vom Prüfer, dann DK-Runde) · History-Purge entscheiden (Personaldaten in ~6.600 Commits) · CI-Runde: actions/checkout + supabase/setup-cli auf Node-24-native Versionen heben (Deprecation-Warnung Node 20), dabei GITHUB_STEP_SUMMARY-Zeile für db-integration/e2e (nicht-blockierende Jobs sind in der Lauf-Liste unsichtbar grün — das dokumentierte Beförderungskriterium „10 grüne Läufe in Folge" ist sonst unzählbar) · db-integration nach August-Export wieder scharf stellen (continue-on-error seit §8) · e2e-Job-Status prüfen (deckt Kassen-Finalize, zweiter stiller Zeuge) · DB1-C: 84 Stellen in 17 Dateien · retry() dreifach (KGL, nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test (Fund aus XL1) · überflüssiger Cast u as AuthUserLike in orphan-accounts.functions.ts · Orphan-Panel: staff-Namensauflösung bei Mehr-Org-Betrieb org-prüfen (SaaS-Erweiterungspunkt, Kommentar an der Abfrage) · row!-Assertions in telegram.functions.ts (früher if(!row)-Return stattdessen) · Telegram-Adminliste: vierter Zustand „Einladung abgelaufen" als eigene Regel-Runde falls gewünscht · COCO-9: betroffene Akte + tax_class-Schema-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · Lohnbüro-Antworten (4 Punkte) — Voraussetzung erster Export · Publish + Klicktest LAM/MO im Panel · Prüfer-Sichtkontrolle erster August-Export · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · Abriss staff_compensation.hourly_rate · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §116 — Alt-Apps außer Betrieb; erster scharfer Juli-Lauf mit Vollabgleich; LG-12-Einmal-Ausnahme; ST1-A (30.07.)

Abnahme-Anker: HEAD 8f108ba2 — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 202 Dateien / 2033 Tests grün, 0 Skips.

**MEILENSTEIN — Alt-Apps außer Betrieb (Bauherren-Mitteilung 30.07.):** bestellung.pro, thaitime und tagesabrechnung werden aktiv nicht mehr verwendet. Damit ist die Strangler-Fig-Ziellinie des Gründungsdokuments (§6: „Die Alt-Apps laufen weiter und sterben modulweise") erreicht — eine App ersetzt vier Wahrheiten. TA-DB bleibt ruhendes Archiv. Folgen: ① Die drei Lovable-Projekte und ihre Repos sind zu ARCHIVIEREN (read-only), damit niemand versehentlich dort weiterarbeitet oder publisht — offener Handgriff des Bauherrn. ② Der Merkposten „GERARD: Planer-Rolle in COCO und tagesabrechnung" verliert seine TA-Hälfte ersatzlos; offen bleibt nur die COCO-Seite, falls dort noch nicht erledigt.

**Erster scharfer Lohnlauf aus COCO-Daten (Juli 2026) — gelaufen und vollabgeglichen.** Das Lohnbüro hat mit der Payroll-Rolle die Zusammenfassung exportiert (beide Standorte); edlohn hat daraus abgerechnet (PDF-Erstellung 27.07., 40 Personen). **Architektur-Klärung durch den Bauherrn (verbindlich): edlohn ist die maßgebliche Lohnrechnung; COCOs Lohnrechner ist Vorschau/Gegencheck** („was kommt ungefähr an Gehältern auf uns zu"). Konsequenz dokumentiert: Der Export-Blocker (LG-9) sichert damit die VORSCHAU, nicht die Abgabe — der scharfe Juli-Lauf lief am Blocker vorbei, weil die Zusammenfassung keine Sätze abfragt. Damit die Vorschau ihren Zweck erfüllt, müssen COCO-Sätze und edlohn-Stammdaten übereinstimmen; genau dafür ist der monatliche Abgleich da.

**Vollabgleich Juli (Prüfer, 30.07., edlohn-PDFs ↔ COCO-Zusammenfassungen beider Standorte):** Kreuzprobe Spicery + YUM = edlohn **auf die Viertelstunde exakt bei allen Personen mit Standort-Split (Δ = +0,00 durchgehend)**; Beispiele APPEL 17,00+118,50=135,50 · EM 30,00+150,00=180,00 · MO 100,00+80,00=180,00 · CHEFIN 17,00+193,00=210,00. Von 36 Personen mit Zeitlohn-Zeile: 32 exakt identisch; die vier Abweichungen sind vollständig erklärt: LAM +72,00 h (9 U-Tage × 8 h, systematische edlohn-Urlaubsumrechnung) · Andre −30,00 h (K-Split in Zeitlohn + Lohnfortzahlung) · **GERARD +21,75 h und ANDI +4,00 h = manuelle Netto-Anpassungen des Bauherrn IN EDLOHN** (Netto-Zielvereinbarungen: GERARD 3500, ANDI 2400; weitere Netto-Ziele laut Besonderheiten: EM 3300, JOY 2600, Andre 3000, MO 3300). **Wichtig für jeden künftigen Abgleich: Diese manuellen edlohn-Anpassungen sind GEWOLLT und wiederholen sich ggf. — ungewollte Fehler verstecken sich am liebsten hinter gewollten Abweichungen, deshalb stehen sie hier mit Person und Stundenzahl.** COCO-Zeiteinträge blieben unangetastet (MiLoG-Aufzeichnung sauber); die runden GL-Stunden (MO 116/64, EM 148/32, PETER 168, CHEFIN 210) sind eingetragene GL-Zeiten in COCO selbst, keine nachträglichen Änderungen. Vier Personen ohne Zeitlohn-Zeile plausibel (Milk 12, SORN 20, Ursula 30 — PauSt-Fall weiter offen —, PON 334 Vollmonat Urlaub). Slot-Befund fürs Lohnbüro: Zeitlohn-Slots sind NICHT einheitlich belegt (LAM: ZL=Service/ZL2=GL; MO: ZL=GL/ZL2=Service) — rechnet richtig, macht Abgleiche aber fehleranfällig; gehört auf die offene Lohnbüro-Fragenliste.

**Satz-Konflikt MO Service — Bauherren-Entscheid: 23,00 bleibt.** edlohn rechnete Juli 64 h × 17,50 (Δ 352,00 € brutto zu niedrig gegenüber dem gewollten Satz). COCO behält 23,00; das LOHNBÜRO muss die edlohn-Stammdaten auf 23,00 korrigieren, und die Juli-Differenz ist mit dem Lohnbüro zu klären, solange der Monat korrigierbar ist — offener Punkt beim Bauherrn. Bis zur edlohn-Korrektur zeigt der Vorschau↔Abrechnung-Vergleich für MO eine BEKANNTE Abweichung.

**LG-12-Einmal-Ausnahme (Bauherren-Entscheid „b", per SQL, Fall 1):** Die vier Juli-Blocker (EM Küche+Service 23,00 · GIG SERVICE Service · LAM GL 22,00/Service 16,00 · MO GL 23,00/Service 23,00, je ab 2026-06-26; GIG ab 2026-07-02) wurden per erstanlage-geschütztem Einmal-SQL rückdatiert eingetragen — die UI-/Server-Sperre (valid-from-guard) blieb unverändert hart. 7 Zeilen eingefügt, Rest-Check bestanden. Nachkorrektur GIG SERVICE: die 02.07.-Zeile von 14,50 auf **14,00** gesetzt (Bauherren-Auskunft + edlohn-Beleg: alle 140,75 h × 14,00); beide GIG-Zeilen stehen jetzt auf 14,00, die 04.07.-Zeile ist redundant-harmlos. Bewusst KEIN audit_log-Eintrag (Bauherren-SQL, Datenhoheit) — dieser Absatz ist die Dokumentation. Merkposten: Beim ZWEITEN Auftreten des Falls „Neuzugang ohne Satz für abgelaufene Periode" die LG-12-Erstanlage-Regel (Option a: Erstanlage darf vor die Periode, Änderung bleibt gesperrt) bewusst neu entscheiden. Prozess-Lehre am Rande: Das erste Skript wurde mit Platzhaltern ausgeführt (42703 — kein Schaden, Platzhalter sind kein gültiges SQL); künftig liefert der Prüfer Einmal-SQL nur noch FERTIG AUSGEFÜLLT, Werte werden vorher im Chat eingesammelt.

**ST1-A — Personalkosten-Statistik auf Bereichssätze (Abriss-Serie Alt-Skalar, 1/3):** personnel-core rechnet jetzt je Zeiteintrag mit attributeEntry + resolveRateCents aus dem Lohnpfad (KGL: Import, keine Kopie); Alt-Skalar-Load raus, selectHourlyRateEur gelöscht, Cent-genau je Eintrag, unbewertete Stunden werden als unratedNetHours AUSGEWIESEN statt genullt (Variant B; Amber-Zeile in der Statistik-Route). Zwei §104-Meldungen des Baumeisters, beide bestätigt: ① ZWEITER Aufrufer gefunden und mitumgestellt — das KI-Tool personalkostenQuote (tool-dispatcher) lud ebenfalls den Alt-Skalar; ohne den Fund hätten „Frag COCO" und die Statistik-Seite verschiedene Kostenzahlen genannt. ② Das Roster-/Rates-Lademuster war nur wörtlich kopierbar (>20 Zeilen) und wird von zwei Aufrufern gebraucht → liegt einmal in personnel-load.server.ts (mehrfach-staff-fähig), Lohnpfad unangetastet; gemeinsames Lademodul Lohn+Statistik bleibt offener Kandidat (Kopfkommentar). ERWARTUNG dokumentiert: Die Personalquote WEICHT künftig leicht von früheren Werten ab — vorher letzter bekannter Satz unabhängig vom Datum (Alt-Skalar ohne Historie), jetzt tagesgenau mit valid_from; das ist der Sinn der Umstellung, kein Fehler. Direkt-Runde des Bauherrn dazu (213e64e0): Rückwirkungssperre clientseitig gespiegelt (gleicher isValidFromAllowed-Guard) — saubere Meldung statt 500er.

**Bauherren-Entscheide für ST1-B/-C (liegen vor, noch nicht gebaut):** ② Dokumentengenerierung wird MEHRSÄTZIG — der Vertragsbaustein listet je Person ihre tatsächlich gepflegten Bereiche mit ihren individuellen Sätzen („je nach Einsatzbereich: Service X · Küche Y"); Sätze sind personenbezogen (Skills, Betriebszugehörigkeit), keine Betriebs-Standardsätze. ③ Import stellt auf staff_compensation_rates um, Alt-Skalar fliegt aus dem Import. Danach Alt-Satz-Feld und später Spalte abreißen. Bis dahin bleibt das Feld sichtbar, weil Vertragsgenerierung es noch liest.

Offene Merkposten (Sammelstand, ersetzt §115-Liste): **Alt-App-Repos/Lovable-Projekte archivieren** (read-only; Bauherren-Handgriff) · **MO-Satzkorrektur ans Lohnbüro** (edlohn-Stammdaten Service auf 23,00; Juli-Differenz 352,00 € klären) · **Lohnbüro-Fragenliste ergänzt um Slot-Vereinheitlichung** (ZL/ZL2-Belegung je Person uneinheitlich) · **ST1-B** (Verträge mehrsätzig) · **ST1-C** (Import + Alt-Satz-Feldabriss; Spaltenabriss danach) · **August-Abgleich**: gewollte edlohn-Netto-Anpassungen (GERARD, ANDI, ggf. weitere Netto-Ziel-Personen) VOR dem Abgleich beim Bauherrn einsammeln; mittelfristige Idee: Netto-Ziel-Feld in COCO · LG-12-Erstanlage-Regel beim zweiten Auftreten neu entscheiden · GERARD Planer-Rolle in COCO (TA-Hälfte entfallen) · Ursula PN 30 PauSt (offen beim Lohnbüro) · no_hours-U/K-Regel (Bauherren-Entscheid, aktuell throw) · Domänen-Nachzug Vorschau-Schutz (114 runGuarded-Stellen, cash erledigt) · SEC-01 nach August-Export · CORR-01 + CORR-03 nach August-Export · DOC-01-Handarbeit (Trefferliste vom Prüfer) · History-Purge entscheiden · CI-Runde (Node-24-Actions + GITHUB_STEP_SUMMARY für db-integration/e2e) · db-integration nach August-Export scharf stellen · e2e-Job-Status prüfen · DB1-C (84 Stellen / 17 Dateien) · retry() dreifach (KGL, nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · Cast u as AuthUserLike (kosmetisch) · Orphan-Panel Mehr-Org-Namensauflösung (SaaS-Punkt) · row!-Assertions telegram.functions.ts · Telegram-Adminliste vierter Zustand (falls gewünscht) · COCO-9: betroffene Akte + tax_class-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · Realtime-Payload-Prüfung · TanStack/seroval-Update · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §117 — Abriss-Serie ST1 komplett: der Alt-Skalar ist Geschichte; Security-Scanner-Triage; Sandbox-Skip erklärt (30.07., Nachmittag)

Abnahme-Anker: HEAD 76af79a6 — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 204 Dateien / 2041 Tests grün, 0 Skips. Anker-Kette der Serie: bc8abc13 (ST1-B) → 2bd15837 (ST1-C2) → 4c70999b (ST1-C1) → ed2b94dd (ST1-C3) → 76af79a6 (ST1-C4). **Produktions-Drop ausgeführt 30.07. ~18:40 durch den Bauherrn (Fall 1): `DROP TABLE IF EXISTS public.staff_compensation` + Kontroll-SELECT auf pg_tables = 0 Zeilen.** Vom Bauherren-Satz „warum sehe ich das Feld noch?" (08:49) bis zur nicht mehr existierenden Tabelle (18:40) ein Arbeitstag.

**Die Serie im Überblick (eine Satz-Wahrheit statt anderthalb):** ST1-B — Dokumentengenerierung mehrsätzig: reines Modul wage-lines.ts (resolveWageLines/formatWageLines, KGL-Import von resolveRateCents), Platzhalter `stundenlohn` liefert bei einem Bereich „14,50 €/h" ohne Präfix, ab zwei Bereichen „je nach Einsatzbereich: Service … · Küche … · Geschäftsleitung …" (feste Reihenfolge); V1-Unresolved-Semantik greift bei fehlendem Satz automatisch; Formatänderung „€" → „€/h" bewusst, Bauherren-Vorlage geprüft (kein doppeltes /h). ST1-C2 (lief vor C1, Runden berühren sich nicht) — SFN-Übersicht Zeit-Admin bewertet mit dem HAUPTBEREICHS-Satz (Variante a, Bauherren-Entscheid): sfn-rate.ts nutzt primaryDepartment + resolveRateCents, bewusst OHNE Bereichs-Fallback; fehlender Satz → 0 mit additivem rateMissing-Flag statt stiller Null; die bisher zweimal wortgleiche rateByStaff-Map ist durch eine Closure ersetzt; ERWARTUNG: €-Zuschlagswerte der Übersicht ändern sich für Personen mit abweichendem Alt-Skalar — die exakte bereichsgenaue SFN-Rechnung bleibt allein im Lohnrechner (D4). ST1-C1 — Personal-Import: Satz-Verarbeitung ersatzlos raus (CSV-Spalte hourly_rate wird toleriert und ignoriert, alte Dateien bleiben einlesbar); −445/+40 Zeilen; Testzahl sank beauftragt um 3 (rein Comp-Fälle, aufgeschlüsselt). ST1-C3 — CompensationSection (Stammblatt-Feld) und compensation.functions.ts ersatzlos gelöscht; Permission-Keys payroll.compensation.view/.edit BLEIBEN (Bereichssatz-Functions nutzen sie). ST1-C4 — m4-Test verschlankt (Comp-Seed/Cleanup/4 RLS-Proben raus, 28 has_permission-Proben + personal_details-Proben bleiben), Migration DROP TABLE IF EXISTS ohne CASCADE (keine abhängigen Objekte), types.ts vom Harness regeneriert.

**Drei Inventur-Lücken des Prüfers in einer Serie — verschärfte Regel:** ① time-admin.functions.ts als vierter Leser erst nach ST1-B per Repo-Grep gefunden (Modul-Vermutung statt Grep). ② import-personal.functions.ts und die Route import-zuordnungen.tsx als Typ-Konsumenten der Plan-Typen nicht mitgezählt — der Baumeister musste sie anpassen, damit überhaupt kompiliert (korrekt nachgemeldet). Regel ab jetzt: **Abriss-Inventur = Tabellen-Grep (`from("…")`) PLUS Typ-/Symbol-Konsumenten-Grep, repo-weit, vor dem ersten Prompt.** ③ Kommentar-Grabsteine-Entscheid: Herkunfts-Kommentare („vorher Alt-Skalar, seit ST1-x Bereichssätze") und Fixture-Schlüssel in lg3b-Tests bleiben BEWUSST stehen — sie sind Kontext, keine Leichen; keine Kommentar-Hygiene-Runde.

**Sandbox-Phantom-Skip endlich ERKLÄRT (Baumeister-Fund):** `describe.skipIf(!dbTestsEnabled)` zählt in der Lovable-Sandbox als EIN Skip, weil die Kinder-Tests gar nicht erst kollektiert werden. Deshalb meldet der Baumeister seit Tagen konstant „+1 Skip", wo der Prüfer „0 Skips" misst (bei ihm ist SUPABASE_DB_TESTS ebenfalls aus, aber vitest zählt dort offenbar anders kollektiert — maßgeblich: beide Zählungen sind konsistent erklärbar, keine ist ein Fehler). Vorzustands-Streit zu diesem Skip ist damit beendet; in Fertigmeldungen genügt künftig „bekannter describe.skipIf-Skip".

**Lovable-Security-Scanner (3 Warnungen + 27 ignorierte) — Triage durch den Prüfer, „Try to fix all" ausdrücklich NICHT gedrückt** (Automatik-Fix an RLS in einem DENY-ALL-System wäre eine ungeprüfte Änderung am Fundament): ① „Display authentication token hash readable by all staff" — FALSCH: display_settings trägt seit 13.07. nur den SHA-256-Hash (Klartext-Token in der Härtungsrunde entfernt), SELECT ist manager-gated + org-scoped; ein Hash unter Managern ist kein Geheimnisverlust. Kein Handlungsbedarf. ② „Any authenticated user can subscribe to any realtime broadcast topic" — sachlich richtig gelesen, Architektur ist absichtlich so: realtime.messages-Policy authenticated/USING(true), die NUTZLAST kommt ausschließlich über postgres_changes und wird durch die org-scoped SELECT-Policies der Quelltabellen gefiltert; im ganzen Code existiert KEIN Broadcast-Topic (geprüft: nur roster_shifts/roster_absence/tasks via postgres_changes). **Damit ist der Merkposten „Realtime-Payload-Prüfung" erledigt.** SaaS-Erweiterungspunkt notiert: Sollte je Broadcast (statt postgres_changes) genutzt werden, braucht es Topic-Autorisierung. ③ „Critical vulnerabilities in application dependencies" (18 Advisories in 57 Paketen) — der eine echte Punkt; ersetzt den Merkposten TanStack/seroval-Update durch eine geplante Dependency-Runde NACH dem August-Export: Prüfer sortiert vorab nach Laufzeit-Exposition (Worker) vs. Build-Tooling.

**Token-Routine geändert (Bauherren-Entscheid 30.07., ersetzt die §115-Formulierung „kurze Laufzeit, täglich widerrufen"):** Der Read-only-PAT bleibt bestehen; das tägliche Widerrufen entfällt bewusst, Restrisiko (Klartext im Chatverlauf) vom Bauherrn akzeptiert. Verfallsnetz: die 7-Tage-Expiry des Fine-grained-Tokens; bei Ablauf wird schlicht ein neuer erbeten.

Offene Merkposten (Sammelstand, ersetzt §116-Liste): **LAM-Probevertrag generieren** (ST1-B-Sichtbeweis Mehrsätzigkeit; Template beim Bauherrn in Arbeit) · **MO-Satzkorrektur ans Lohnbüro** (edlohn Service auf 23,00; Juli-Differenz 352,00 € klären) · **Alt-App-Repos/Lovable-Projekte archivieren** (read-only) · **Dependency-Runde nach August-Export** (18 Advisories, Scanner ③; Prüfer-Triage vorab; NICHT „Try to fix all") · **27 ignorierte Scanner-Issues einmal querlesen** (Ignoriert-Listen sind der Ort, wo echte Funde mitbeerdigt werden) · Broadcast-Topic-Autorisierung als SaaS-Erweiterungspunkt (nur relevant, falls je Broadcast genutzt wird) · August-Abgleich: gewollte edlohn-Netto-Anpassungen (GERARD, ANDI, ggf. weitere) VOR dem Abgleich einsammeln; Idee Netto-Ziel-Feld in COCO · Lohnbüro-Fragenliste: Slot-Vereinheitlichung (ZL/ZL2 je Person uneinheitlich) · Ursula PN 30 PauSt (offen) · LG-12-Erstanlage-Regel beim zweiten Auftreten neu entscheiden · GERARD Planer-Rolle in COCO · no_hours-U/K-Regel (aktuell throw) · Domänen-Nachzug Vorschau-Schutz (114 runGuarded-Stellen, cash erledigt) · SEC-01 nach August-Export · CORR-01 + CORR-03 nach August-Export · DOC-01-Handarbeit (Trefferliste vom Prüfer) · History-Purge entscheiden · CI-Runde (Node-24-Actions + GITHUB_STEP_SUMMARY für db-integration/e2e) · db-integration nach August-Export scharf stellen · e2e-Job-Status prüfen · DB1-C (84 Stellen / 17 Dateien) · retry() dreifach (KGL, nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · Cast u as AuthUserLike (kosmetisch) · Orphan-Panel Mehr-Org-Namensauflösung (SaaS-Punkt) · row!-Assertions telegram.functions.ts · Telegram-Adminliste vierter Zustand (falls gewünscht) · COCO-9: betroffene Akte + tax_class-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §118 — DEP1/DEP1b: seroval-CRITICAL vom Laufzeitpfad genommen; react-start-Minor; bewerteter Build-Rest (30.07., Abend)

Abnahme-Anker: HEAD 5ce1f80d — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 204 Dateien / 2041 Tests grün, 0 Skips.

**Anlass (Prüfer-Triage der 27 bun-audit-Advisories):** Zwei Befunde lagen auf dem Laufzeit-Pfad des Workers — seroval 1.5.2 (CRITICAL GHSA-mv8w, fromJSON-Type-Confusion) und @tanstack/start-server-core 1.167.22 (GHSA-9m65), beide in der Deserialisierung EINGEHENDER Server-Function-Requests, also vor jedem Auth-Check. Timing-Entscheid des Bauherrn: Fix JETZT, vier Wochen vor dem August-Export (bester Stabilisierungspuffer), statt „nach Export" — vier Wochen offenes Critical wäre die schlechtere Abwägung gewesen. Alle übrigen Advisories sind Build-Tooling → Sammelrunde nach Export.

**DEP1 (Lockfile-only-Versuch) — §104-Abbruch, sauber zurückgerollt (Lehrstück):** Auftragsannahme „die package.json-Ranges decken die Fix-Versionen ab" war ein Prüfer-Messfehler: react-start@1.167.x pinnt start-server-core EXAKT (1.167.22, kein Caret) — der Fix ≥1.167.30 war in-range unerreichbar. Zusätzlicher Baumeister-Fund: `bun update <transitives-paket>` trägt die Namen als NEUE Direkt-Dependencies in package.json ein und lässt die gescopten transitiven Pfade trotzdem auf dem Alt-Stand. Zwei Lehren: ① Lockfile-only-Annahmen gegen die PIN-STRUKTUR des Lockfiles prüfen (exakte Pins vs. Ranges), nicht nur gegen package.json-Ranges. ② `bun update` für transitive Pakete ist kein Werkzeug für gezielte Bumps.

**DEP1b (Framework-Minor) — abgenommen:** `bun update --latest @tanstack/react-start` → package.json ^1.167.50 → **^1.168.32** (einzige beabsichtigte Zeile). Familie transitiv (Auszug alt→neu): react-router 1.168.25→1.170.18 (in-range; bun schrieb den Range eigenmächtig auf ^1.170.18 um — vom Baumeister korrekt auf ^1.168.25 zurückgesetzt, Auflösung bleibt 1.170.18) · router-core 1.168.17→1.171.15 · start-server-core 1.167.22→**1.169.17** · start-client-core→1.170.14 · start-plugin-core→1.171.24 · seroval/seroval-plugins→**1.6.0** · dazu history/router-utils/start-fn-stubs/start-storage-context/react-start-client/-server/-rsc. Nichts außerhalb der TanStack-/seroval-Familie. `src/routeTree.gen.ts` vom neuen Router-Plugin regeneriert (reine Umsortierung, generierte Datei). Kein Quellcode angefasst; keine API-Drift (tsc/Tests unverändert grün, 2041/204).

**Laufzeitpfad beweisbar sauber (Prüfer-Lockfile-Zählung, nicht Audit-Anzeige):** Es existieren genau zwei router-core-Stände — 1.171.15 top-level, 1.168.17 gescoped AUSSCHLIESSLICH unter router-plugin und router-generator (Codegen zur Bauzeit). Die Request-Kette des Workers (react-start → react-start-server → start-server-core@1.169.17 → start-client-core → router-core@1.171.15) löst auf seroval **1.6.0**; start-server-core@1.167.22 und der verwundbare seroval-Stand existieren an keinem Laufzeit-Pfad mehr. Hinweis zur Werkzeug-Grenze: `bun audit` zeigt Pfade NAMENSbasiert, nicht versionsgenau — maßgeblich ist die Lockfile-Struktur. Korrektur einer Meldungs-Formulierung: router-plugin ist DEPENDENCY, nicht devDependency; die Sicherheitsbewertung hängt aber am LAUFORT (Vite-Bauzeit, verarbeitet nur eigenes Repo), nicht an der Rubrik.

**Bewerteter Rest (bekannt, KEIN Handlungsbedarf vor der Sammelrunde):** seroval@1.5.2 verbleibt an genau zwei Build-Zeit-Pfaden (router-plugin/router-generator → router-core@1.168.17). Der Lovable-Scanner wird seroval deshalb WEITER anzeigen — das ist ab jetzt ein bekannter, bewerteter Rest. Bereinigung (router-plugin-Range-Bump) fällt in die Build-Tooling-Sammelrunde nach dem August-Export; eine eigene Runde dafür wurde vom Prüfer verworfen (Sicherheitsgewinn null, Regenerierungs-Risiko klein aber real).

**Produktions-Smoke nach Deploy (Bauherr): 4 von 5 Pfaden grün** — PIN-Login, Stempeln ein/aus, Kassen-Ansicht, Lohnrechner-Vorschau ✓. Fünfter Pfad (Dokument generieren) noch offen und mit dem LAM-Probevertrag-Merkposten VERSCHMOLZEN: Ein generierter LAM-Vertrag testet in einem Akt den fünften Smoke-Pfad UND den ST1-B-Mehrsätzigkeits-Sichtbeweis („je nach Einsatzbereich: Service 16,00 €/h · Geschäftsleitung 22,00 €/h").

Offene Merkposten (Sammelstand, ersetzt §117-Liste): **LAM-Probevertrag generieren = fünfter DEP1b-Smoke-Pfad + ST1-B-Sichtbeweis** (Template beim Bauherrn in Arbeit) · **MO-Satzkorrektur ans Lohnbüro** (edlohn Service auf 23,00; Juli-Differenz 352,00 € klären) · **Alt-App-Repos/Lovable-Projekte archivieren** (read-only) · **Build-Tooling-Sammelrunde nach August-Export** (verbliebene Advisories inkl. router-plugin-Bump/seroval-Build-Rest, vite, undici, dompurify/jspdf, uuid/exceljs, brace-expansion, js-yaml, postcss, babel, fast-uri, hono-node-server; NICHT „Try to fix all") · **27 ignorierte Scanner-Issues einmal querlesen** · Broadcast-Topic-Autorisierung als SaaS-Erweiterungspunkt · August-Abgleich: gewollte edlohn-Netto-Anpassungen (GERARD, ANDI, ggf. weitere) VOR dem Abgleich einsammeln; Idee Netto-Ziel-Feld in COCO · Lohnbüro-Fragenliste: Slot-Vereinheitlichung (ZL/ZL2 je Person uneinheitlich) · Ursula PN 30 PauSt (offen) · LG-12-Erstanlage-Regel beim zweiten Auftreten neu entscheiden · GERARD Planer-Rolle in COCO · no_hours-U/K-Regel (aktuell throw) · Domänen-Nachzug Vorschau-Schutz (114 runGuarded-Stellen, cash erledigt) · SEC-01 nach August-Export · CORR-01 + CORR-03 nach August-Export · DOC-01-Handarbeit (Trefferliste vom Prüfer) · History-Purge entscheiden · CI-Runde (Node-24-Actions + GITHUB_STEP_SUMMARY für db-integration/e2e) · db-integration nach August-Export scharf stellen · e2e-Job-Status prüfen · DB1-C (84 Stellen / 17 Dateien) · retry() dreifach (KGL, nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · Cast u as AuthUserLike (kosmetisch) · Orphan-Panel Mehr-Org-Namensauflösung (SaaS-Punkt) · row!-Assertions telegram.functions.ts · Telegram-Adminliste vierter Zustand (falls gewünscht) · COCO-9: betroffene Akte + tax_class-Härtung · ICS-Kalender So/Feiertag-Defaults · CHEFIN-Pool-Klärung · Verifikation Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §119 — TG4/TG4-N1: Trinkgeld-Kopfteilung, datiert; nachversionierte Migration (31.07.)

Abnahme-Anker: HEAD e8f8a8b1 — vier Gates vom Prüfer eigenhändig gemessen: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 204 Dateien / 2055 Tests grün, 0 Skips. Kette: a101b938 (§118) → 2c343182 (TG4 + prettier autofix) → e8f8a8b1 (TG4-N1). CI #42 auf dem Liefer-SHA grün; db-integration-Job vom Bauherrn gesichtet.

**TG4** (Bauherren-Entscheid nach /grillme-Runde): Verteilung innerhalb der Trinkgeld-Pools wahlweise gleichmäßig pro Kopf statt proportional zu Stunden. Die Berechtigung bleibt vollständig unverändert: Mindeststunden (org-weit 3,00, beide Pools, inklusive Grenze), participates_in_pool + Session-Override, GL-Ausschluss, kitchen_manual_only, Brutto-Stunden ohne Pausenabzug, Euro-Abrundung mit Rest in die Kasse (/admin/trinkgeld-rest). Nur der Teilungsschritt ändert sich: headcount = floor(pool/n) auf volle Euro je Teilnehmer.

**Datiert statt rückwirkend:** Anteile werden bei jedem Aufruf neu gerechnet (session_tip_pool_entries speichert nur Eingaben, kein share_cents) — ein undatierter Schalter hätte alle historischen Tage rückwirkend umgerechnet, auch ausgezahlte und gesperrte. Deshalb tip_distribution_mode + tip_distribution_mode_from (organization_settings) mit Standort-Override-PAAR (locations): Override gesetzt → beide Standortwerte gelten, sonst beide Org-Werte — bewusste Abweichung von der feldweisen COALESCE-Vererbung der übrigen Trinkgeld-Felder (Mischzustand „Standort-Stichtag + Org-Modus" wäre nicht interpretierbar). resolveTipDistributionMode (tip-pool.ts): ISO-String-Vergleich, Stichtag zählt zum neuen Modus, from=NULL → durchgängig hours. Genau EINE Auflösungsstelle im Produktivpfad (cash.functions.ts, computeSessionTipPoolCore); alle fünf Aufrufer laden via loadTipSettings.

**Nicht-Rückwirkungs-Beweis:** Alle 36 Bestands-Tests in tip-pool.test.ts unverändert (0 entfernte Zeilen, nur distributionMode:"hours" ergänzt). Neue Tests: Kopfteilung stundeninvariant, Rest-Obergrenze 0 ≤ remainder < n×100, excludedByMinHours bit-identisch über beide Modi, Stichtags-Semantik, Paar-Vererbung inkl. Mischfall, Migrations-Neutralität.

**TG4-N1 (Prüfungsbefund):** TG4 legte die vier Spalten direkt in der Produktions-DB an, ohne Migrationsdatei — db-integration rot (frischer Stack aus Migrationen: column does not exist), Restore/zweiter Mandant hätte ein Schema ohne die Spalten erzeugt. Nachversioniert als 20260731082707 (idempotent, pg_constraint-Guards, keine Datenänderung; gegen Produktion No-op). **Regel daraus, ab sofort: Eine Schemaänderung ist erst fertig, wenn sie als Datei in supabase/migrations/ liegt** — das vom Bauherrn ausgeführte Produktions-SQL ersetzt die Datei nicht; die Vorab-SQL-Skizze im Prompt ist ihre Vorlage, nicht ihr Ersatz. Zweiter N1-Punkt: stiller "hours"-Fallback ('distributionMode' in settings) entfernt, Signatur auf TipSettings verengt — Alt-Settings-Übergabe scheitert jetzt am Compiler statt still nach Stunden zu rechnen (Variante-B-Prinzip aus LG3b). Prozessnotiz: Die N1-Fertigmeldung nannte den Ausgangs-Anker statt des Liefer-SHA und meldete 1 Skip/2054, gemessen vor dem Commit — auf dem Liefer-SHA waren es 0 Skips/2055; erneuter Beleg für §112: gemessen wird auf dem SHA auf origin/main, der geliefert wird.

**Scharfstellung (offen, Bauherren-Akt):** UPDATE auf organization_settings (mode='headcount', from=Stichtag). Empfehlung: Stichtag = 26.08. (Periodenbeginn) — kein Modus-Wechsel mitten in einer Abrechnungsperiode. TSB hat tip_service_pool_enabled=false: Kopfteilung wirkt dort nur im Küchen-Pool (korrekt, kein Fehler beim Klicktest).

Offene Merkposten (Sammelstand, ersetzt §118-Liste): **TG4-Scharfstellung zum 26.08.** (UPDATE-SQL liegt im TG4-Prompt §7) · **CHEFIN-Pool-Klärung** (im TG4-Screenshot der übersteuerte participates=false-Fall — ggf. damit erledigt, Bauherren-Bestätigung offen) · **LAM-Probevertrag generieren = fünfter DEP1b-Smoke-Pfad + ST1-B-Sichtbeweis** (Template beim Bauherrn in Arbeit) · **MO-Satzkorrektur ans Lohnbüro** (edlohn Service auf 23,00; Juli-Differenz 352,00 € klären) · **Alt-App-Repos/Lovable-Projekte archivieren** (read-only) · **Build-Tooling-Sammelrunde nach August-Export** (verbliebene Advisories inkl. router-plugin-Bump/seroval-Build-Rest, vite, undici, dompurify/jspdf, uuid/exceljs, brace-expansion, js-yaml, postcss, babel, fast-uri, hono-node-server; NICHT „Try to fix all") · **27 ignorierte Scanner-Issues einmal querlesen** · Broadcast-Topic-Autorisierung als SaaS-Erweiterungspunkt · August-Abgleich: gewollte edlohn-Netto-Anpassungen (GERARD, ANDI, ggf. weitere) VOR dem Abgleich einsammeln; Idee Netto-Ziel-Feld in COCO · Lohnbüro-Fragenliste: Slot-Vereinheitlichung (ZL/ZL2 je Person uneinheitlich) · Ursula PN 30 PauSt (offen) · LG-12-Erstanlage-Regel beim zweiten Auftreten neu entscheiden · GERARD Planer-Rolle in COCO · no_hours-U/K-Regel (aktuell throw) · Domänen-Nachzug Vorschau-Schutz (114 runGuarded-Stellen, cash erledigt) · SEC-01 nach August-Export · CORR-01 + CORR-03 nach August-Export · DOC-01-Handarbeit (Trefferliste vom Prüfer) · History-Purge entscheiden · CI-Runde (Node-24-Actions + GITHUB_STEP_SUMMARY für db-integration/e2e) · db-integration nach August-Export scharf stellen · e2e-Job-Status prüfen · DB1-C (84 Stellen / 17 Dateien) · retry() dreifach (KGL, nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · Cast u as AuthUserLike (kosmetisch) · Orphan-Panel Mehr-Org-Namensauflösung (SaaS-Punkt) · row!-Assertions telegram.functions.ts · Telegram-Adminliste vierter Zustand (falls gewünscht) · COCO-9: betroffene Akte + tax_class-Härtung · ICS-Kalender So/Feiertag-Defaults · Verifikation Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

**Korrektur (31.07., §120):** Die Scharfstellung erfolgte noch am selben Tag mit Stichtag 31.07.2026 (Bauherren-Entscheid), nicht zum empfohlenen 26.08. Periodenmix in „August" (26.07.–30.07. Stunden / ab 31.07. Kopf) ist gewollt.

## §120 — TG4 scharf; SL1/UK1 Slot-Mapping + no_hours; Lohnbüro-Klärung; AV1b-Vorlagen; LG3a-Leichen (31.07.)

Abnahmekette: e8f8a8b1 (§119-Basis) → a81da661 (SL1/UK1) → 1c3bb925 (Mikro-Fix UK1-Kommentar). Vier Gates auf 1c3bb925 vom Prüfer eigenhändig: tsc 0 · eslint . --max-warnings=0 0 · prettier --check . clean · vitest 206 Dateien / 2073 Tests, 0 Skips.

**TG4 scharf ab 31.07.:** tip_distribution_mode='headcount', \_from='2026-07-31' org-weit gesetzt (kein Standort-Override; TSB nur Küchen-Pool). Rückzieher-SQL existiert, ist aber nur sauber, solange kein Kopf-Tag bar ausgezahlt wurde. Erstkontakt-Kontrolle beim Abendabschluss 31.07.: Anteile pro Pool gleich, Summe + Rest = Pool.

**CI-Durchbruch:** db-integration auf e8f8a8b1 erstmals VOLLGRÜN — 229/229, auch die 4 PGRST-Schema-Cache-Fälle aus §8 sind verschwunden (vermutlich Supabase-CLI-Fix). Die dokumentierte Zehner-Serie fürs Scharfstellen läuft: Lauf 1 ✓. Gegenzug: e2e lief damit erstmals wirklich durch und ist ROT (exit 1, 5m54s, deckt kasse-finalize = TG4-berührter Pfad). Log noch ungesichtet (PAT hat kein Actions:Read) — Einordnung Altbestand vs. TG4-Bruch offen; Produktion nicht betroffen (CI-Stack). Aufklärung vor der nächsten TG-/Kassen-Runde Pflicht.

**SL1 — edlohn-Slot-Mapping** (ersetzt das obsolete §111-Schema): edlohn kann Slots bei Bestandspersonen nicht umhängen (starres System, seit Jahren so) → COCO passt sich an. Slot = Anlage-Reihenfolge JE PERSON (Lohnbüro: „Neuanlage = Zeitlohn, weitere = Zeitlohn 2 bzw. 3"), kein Bereichs-Schema; ein ZL3 existiert derzeit nirgends. Ist-Belegung aus Juli-PDFs (YUM GmbH, 40 Abrechnungen), Lohnbüro-bestätigt 31.07.: 38/40 Personen eine Zeile auf Slot 1; PN 320 LAM ZL=Service/ZL2=GL; PN 352 MO ZL=GL/ZL2=Service. Umsetzung: Tabelle staff_edlohn_slots (UNIQUE staff+department UND staff+slot; DENY-ALL, Muster staff_compensation_rates; Migration versioniert UND in Produktion ausgeführt; LAM/MO befüllt, 4 Zeilen verifiziert). Auflösung resolveEdlohnSlot: Mapping gewinnt; ohne Mapping Slot 1; Blocker missing_slot_mapping NUR bei ≥2 Bereichen mit Stunden UND ≥2 unterschiedlichen Sätzen ohne Mapping (Plan-Korrektur K1 — GERARD-Fall: mehrere Bereiche zum gleichen Satz aggregieren ohne Mapping auf eine Slot-1-Zeile, exakt das edlohn-Ist). Labels/Kategorien/Spalten folgen der Slot-Nummer („Slot gewinnt", Lovable-Rückfrage entschieden); Nullmessung neu gefasst: geschützt sind die RECHENWERTE, Label-/Kategorie-/Spalten-Felder durften mit Begründung angepasst werden. Bereichsname bleibt als Klammerzusatz lesbar. Neuanlagen-Prozess: edlohn-Anlage → Lohnbüro teilt Slot-Vergabe mit → COCO-Eintrag → exportfähig.

**UK1 — no_hours-Fallback** (Bauherren-Entscheid a, ersetzt den Throw): Mehrsatz-Person ohne bezahlte Stunden im 91-Tage-Fenster → Vertragssatz des Hauptbereichs (WZ1-Priorität) via resolveRateCents; Kontroll-Zuschlagszeile ENTFÄLLT (edlohn rechnet den 3M-Ø selbst, Lohnbüro-bestätigt — 0-Zeile wäre Rauschen, Plan-Korrektur K2); Basis-Zeilen tragen „(ohne 3M-Basis)" auch im Export plus explizites basis-Feld. Fehlt auch der Hauptbereichs-Satz → weiterhin missing_rate (kein zweiter stiller Fallback).

**Lohnbüro-Antworten (alle 5 Fragen, 31.07.):** ① Slot-Liste bestätigt + Anlage-Reihenfolge-Regel. ② U/K: COCO liefert nur Stunden + Tage zum Grundsatz, edlohn rechnet den Durchschnittszuschlag — COCOs 3M-Ø-Zeilen sind reine KONTROLLWERTE. Daraus offene Pflicht-Klarstellung an Viktoria: unsere Zuschlagszeilen NICHT zusätzlich buchen (sonst Doppelzählung). ③ Ursula PN 30: Stunden wie alle, Buchung auf „Aushilfe Zeitlohn - PauSt" — Merkposten erledigt. ④ Probeabrechnung VOR Handkorrekturen zugesagt (Abgleichsbasis der Prüfer-Sichtkontrolle). ⑤ MO-Satzkorrektur: unbeantwortet — Nachhaken (Service auf 23,00, Juli-Differenz 352,00 € = 64 h × 5,50, Nachzahlung abstimmen).

**Scope-Korrekturen (ersetzen §116-Aussagen):** Andre und GERARD sind NICHT bei TSB; TSB wird derzeit nicht über COCO abgerechnet — das YUM-GmbH-PDF (YUM+Spicery) ist der vollständige Export-Scope. GIG SERVICE (PN 327) ist in edlohn angelegt und abgerechnet (Narisara Asa-sa-na, 140,75 h) — Registrierungs-Merkposten erledigt; NEU offen: edlohn führt Eintritt 11.07., Doku sagte „arbeitet seit 02.07." — Differenz klären (ggf. 9 Tage Lohn).

**AV1b — zwei Vertragsvorlagen live** („Arbeitsvertrag Service/Bar", „Arbeitsvertrag Leitende", /admin/dokumente): nur Katalog-Platzhalter; Position und Befristungsende (Eintritt + 6 Monate − 1 Tag) bewusst manuelle […]-Stellen (kein Platzhalter existiert); Unterzeichnungsort fest „München" ({{standort}} löst bei Mehr-Standort-Personen nicht auf — Lektion aus dem LAM-Durchstich); Word-Ära-Tippfehler korrigiert (TYUM, Geburstdatum, Stundelohn, Provison, enfällt); Service-Vorlage standardmäßig MIT aktiver Provision (§3 + Anlage 4; provisionslose Ausnahme = manuelle Streichung). {{stundenlohn}} liefert die ST1-B-Mehrsatz-Zeilen automatisch.

**ST1-B-Sichtbeweis erbracht:** LAM-Vertragsvorschau zeigt „Service 16,00 €/h · Geschäftsleitung 22,00 €/h" aus den Stammdaten. DEP1b-Smoke-Pfad 5 (Druckdialog) zur Bestätigung durch den Bauherrn offen.

**LG3a-Datenleichen entdeckt und bereinigt:** Die Vorschau leuchtete LAMs leblosen Küchen-Satz aus (LG3a legte flächig alle drei Bereichszeilen an — ein unterschriebener Vertrag hätte einen nie vereinbarten Küchen-Einsatz zu 22,00 vereinbart). Systematische Suche über roster_shifts (Fenster ab 26.06.; LG2-Logik: kitchen/service aus area, gl aus GL-Skill): 4 Kandidaten → LAM kitchen, MO kitchen, EM gl GELÖSCHT (Rest-Checks verifiziert); PETER gl und Ursula kitchen BLEIBEN (ungeplante Personen = Roster-Artefakt; Peters GL-Satz real). Erste SELECT-Fassung über time_entries.department war wertlos — Lektion: t.department ist Z3-only (NULL bei normalen Stempeln, Fallback Primärbereich/Roster); Bereichs-Wahrheit für Auswertungen ist der Dienstplan.

**Prüfer-Arbeitsregel** (nach zwei Spaltenfehlern an einem Tag — rate_cents, s.active): Ad-hoc-SQL unterliegt derselben Disziplin wie Prompt-SQL: Spaltennamen VOR der Ausgabe gegen die Migration geprüft, nie aus dem Gedächtnis. Zweite Lektion desselben Tages (§113-Verwandtschaft): Fehler im Batch rollt die GANZE Editor-Ausführung zurück — auch das DELETE davor; nach einem Batch-Fehler gilt der Batch als nicht gelaufen.

Offene Merkposten (Stand §120, ersetzt durch die Liste in §121): **e2e-Rot aufklären** (Log aus CI #42 oder Actions:Read für PAT; kasse-finalize, vor nächster Kassen-Runde) · **DEP1b Smoke 5/5 bestätigen** (LAM-Druckdialog) · **Erstkontakt-Kontrolle Kopfteilung Abendabschluss 31.07.** · **Nachhak-Mail Viktoria** (MO-Satz 23,00 + Nachzahlung 352,00 € + Klarstellung Kontroll-Zuschlagszeilen nicht doppelt buchen) · **PN 327 Eintrittsdatum** (02.07. vs. edlohn 11.07.) · Prüfer-Sichtkontrolle August-Export vor Abgabe · August-Abgleich: gewollte Netto-Anpassungen (GERARD, ANDI, ggf. EM/JOY/Andre/MO) vorab einsammeln; Idee Netto-Ziel-Feld · LG-12-Erstanlage-Regel beim zweiten Auftreten · GERARD Planer-Rolle in COCO · CHEFIN-Pool-Klärung (vermutlich durch TG4 erledigt — Bauherren-Wort aussteht) · Alt-App-Repos archivieren · Build-Tooling-Sammelrunde nach August-Export (Advisories-Liste §118) · 27 ignorierte Scanner-Issues querlesen · Broadcast-Topic-Autorisierung (SaaS) · SEC-01 · CORR-01 + CORR-03 · DOC-01-Handarbeit · History-Purge entscheiden · CI-Runde (Node-24 + STEP_SUMMARY) · db-integration scharf stellen (Zehner-Serie läuft, 1/10) · DB1-C (84 Stellen / 17 Dateien) · retry() dreifach (nach DB1-C) · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · Cast u as AuthUserLike · Orphan-Panel Mehr-Org-Namensauflösung (SaaS) · row!-Assertions telegram.functions.ts · Telegram-Adminliste vierter Zustand · COCO-9 (Akte + tax_class) · ICS So/Feiertag-Defaults · Verifikation Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Schalter-Frage (geparkt) · rosterPlanned-Signaturvergleich · KM1 · TB1 · 034/035 · AV1b/c-Rest (Küche-/TSB-Vorlagen bei Bedarf; Provisions-Schalter-Frage aus §114 durch Standard-MIT-Provision pragmatisch entschieden) · Stk/BE · DL1 · AP1 · Kanal-/Terminalnamen Notfallblatt.

## §121 — Statistik-Doppelzählung behoben (STAT1/1b); Sammelexport; U/K-Erfassung; GRANT-Lücke; Export-Generalprobe (01.08.)

Abnahmekette: 1c3bb925 (§120) → 39dd519d (§120-Doku + E2E-G1) → ff0a9b4b (EX1) → d83c42e7 (EX1-N1) → 60f2a012 (UK2) → f7a7b03d (STAT1) → 5acd561d (STAT1b). Gates auf 5acd561d vom Prüfer eigenhändig: tsc 0 · eslint 0 · prettier clean · vitest 210 Dateien / 2099 Tests, 0 Skips · `bun install --frozen-lockfile` Exit 0.

**STAT1 — Umsatz-Doppelzählung** (Bauherren-Fund an Realzahlen): Das Statistik-Modell (`sessionRevenue`) behandelte Umsatzkanäle als additiv (Gesamt = Vectron + alle Kanäle), während der Kassen-Adapter (N14-Fachentscheid 13.07.) die Wahrheit kannte: Kanäle sind ZERLEGUNG des Vectron-Tagesumsatzes — Marker (`delivery_vectron`) und SoUse werden abgezogen, `delivery_wolt` steckt bereits im Marker, `pos` ist additive Zweitkasse (TSB). Folge: Dashboard/Statistik-PDF zeigten Juli-Gesamt 178.931,96 statt real 160.192,68 (+18.739,28 doppelt gezählter Takeaway) und Wolt zusätzlich doppelt innerhalb des Takeaway. Drei Belege vor dem Fix (n=1-Regel): N14-Code-Kommentar, Bauherren-Monatszahlen, Live-Tag 18.07. Spicery (vectron 6.672,50 · Marker 365,10 · Wolt 172,10 ≤ Marker). Fix: EINE Kernzerlegung `decomposeRevenue` (Gesamt = vectron + posSum; Takeaway = min(vectron, marker+souse); Haus = Differenz; Wolt = reines Info-Feld; unbekannter `kind` wirft); `sessionHouseCentsFromKasse` ist nur noch dünne Hülle darüber — bestehende Adapter-Tests unangetastet grün = Bitgleichheits-Beweis der Kasse. 18.07. als Regressions-Fixture. Statistik-PDF: eigene (dritte) Summenlogik abgeschafft, konsumiert die Kernfunktion. Lovable-Mitnahme über den Auftrag hinaus, nachträglich gebilligt: `tool-dispatcher.server.ts` („Frag COCO") enthielt eine VIERTE Formel über das alte `is_takeaway`-Flag — auf `kind`-Zerlegung umgestellt; die KI erzählt nicht mehr die Doppelzählung. `revenue_channels.is_takeaway` hat damit null Code-Nutzer (deprecated, Drop-Merkposten). Alte `sessionRevenue`-Erwartungswerte wurden mit STAT1-Verweis angepasst — dokumentierte Ausnahme: sie kodifizierten den Fehler. Der widerlegte Kommentar „Verifizierte Umsatzdefinition … disjunkte Zeilen" ist ersetzt; Lehre: Eine Verifikation an Tagen ohne Kanalbuchungen verifiziert nichts.

**STAT1b — Donut-Dreiteilung** (Bauherren-Wunsch): Takeaway-Donut zeigt jetzt Wolt / „Takeaway direkt (Telefon/Abholung)" (= Marker − Wolt) / SoUse als echte Segmente; Segmentsumme bleibt exakt Marker + SoUse. Reine Funktion `takeawayDonutSegments` (UI rechnet nicht), Guard: Wolt > Marker → Wolt auf Marker gedeckelt, Direkt nie negativ, Flag + Hinweis; `checkDonutSegments` prüft die Anzeige automatisch gegen die Zerlegung (rote Warnung „Zahlen nicht verwenden" bei Abweichung). Live-Zahlen als Fixture. Statistik-PDF gleiche Dreiteilung.

**EX1/EX1-N1 — Lohn-Sammelexport:** Übersicht hat neben CSV den Knopf „Excel-ZIP": je Person das unveränderte Einzel-Excel (`buildLohnXlsx`), gebündelt via `jszip` (lag transitiv im Lock; als direkte Dependency deklariert). Blocker-Regel wie CSV (ein Blocker → kein Export), Personen ohne Entgeltzeilen ausgelassen, Fehler bricht laut ab, Kollisions-Suffix deterministisch. N1-Lehre: Lovable deklarierte die Dependency ohne Lockfile-Nachzug — `--frozen-lockfile` hätte JEDEN CI-Job gebrochen; Regel: package.json-Änderung ist erst fertig, wenn `bun.lock` mitcommittet ist (dritte Ausprägung der Versionierungs-Regel nach Spalten §119 und GRANTs §120).

**UK2 — U/K-Erfassungs-UI:** Die harten U/K-Tage kommen aus `lohn_absence_days` (Periodenerfassung); est-Werte sind nur der Kalender-Vorschlag. Es gab KEINE schreibende UI — im Generalproben-ZIP fehlten deshalb LAM/EUROPE/DEREJE komplett. Gebaut: `saveAbsenceDays` (Haus-Muster: `requireSupabaseAuth` → `loadAdminCaller` admin/payroll → `runWithPermission`, Org-Prüfung, Audit alt→neu, DB-CHECK-Spiegel 0–31, Perioden-Guard) + Block im Lohnrechner-Detail (gespeicherte Werte vorbelegt, est-Vorschlag mit Übernehmen-Knopf, Query-Invalidierung). 0/0 ≡ keine Zeile (bit-identisch, getestet). Erfassung ist ab sofort Pflichtschritt des Periodenabschlusses (Checkliste Block A0). Offene Zähldifferenz est vs. Buchhaltung (DEREJE 5 vs. 4, Andre 2 vs. 1) wird bei der ersten scharfen Erfassung durch Bauherren-Zählung entschieden.

**E2E-G1 — GRANT-Lücke:** Alle vier e2e-Failures aus CI #42 hatten eine Wurzel: `shift_swap_requests` hatte RLS, aber kein versioniertes GRANT (Produktion manuell erteilt, frischer CI-Stack nicht) → `getReviewPendingCounts`-Kaskade auf jeder Kassen-Seite riss kasse-finalize mit. TG4 entlastet, Produktion nie betroffen. Fix-Migration 20260801062842 (`GRANT ALL … TO service_role`). Sweep vom Prüfer nachgezählt: 73 Tabellen / 74 GRANT-Ziele in den Migrationen, `shift_swap_requests` war die einzige Lücke — Lovables Fertigmeldung nannte 97/127 (erfundene Kennzahlen, Muster bleibt unter Beobachtung). CI-Beweislauf (kasse-finalize grün? lohn-split-worker eigenständig rot?) steht aus.

**Export-Generalprobe** (vorgezogen, laufende Periode): Lohn-CSV der ersten sechs August-Tage geprüft — MO-Kronzeugin exakt (16,5 Service × 23 / 17,5 GL × 23, keine Küche, SFN getrennt, Summenkette bis Brutto), unresolved 0, kein Slot-Blocker. Excel-ZIP: Slot-Labels live bestätigt (MO ZL=GL/ZL2=Service; GERARD und GLAU schlicht „Zeitlohn" — §111-Korrektur sichtbar wirksam). Einziger Zeilen-Fehler: Ursula PN 30 „Steuerklasse fehlt" = die gesuchte COCO-9-Akte (Stammdaten-Pflege beim Bauherrn). Prüf-Fragezeichen offen: SUMITR Auszahlung −288,94 und CHEFIN −30,71 (Bauherren-Bestätigung der Konstellation aussteht).

**Prüfer-Arbeitsregel verschärft** (nach vier Spaltenfehlern an einem Tag — `rate_cents`, `s.active`, `kassiert_brutto`, `rc.name`): Vor JEDEM Ad-hoc-SQL wird jede verwendete Spalte per Grep über ALLE Migrationen belegt — Ersttabelle UND spätere `ADD COLUMN`s; die Prüfung nur der CREATE-TABLE-Definition reicht nicht. Zweite bestätigte Lehre: Ein Fehler im Editor-Batch rollt die gesamte Ausführung zurück, auch erfolgreiche Statements davor.

Offene Merkposten (Sammelstand, ersetzt §120-Liste): **CI-Beweislauf E2E-G1 sichten** (kasse-finalize; lohn-split-worker ggf. eigenständiger Befund) · **DEREJE-U/K-Erstverprobung in UK2** (entscheidet est-Zähldifferenz) · **Ursula Steuerklasse pflegen** (COCO-9-Akte; danach COCO-9-Härtung einplanen) · **SUMITR/CHEFIN Negativ-Auszahlung bestätigen** · Pool-Blick Erstkontakt Kopfteilung 31.07. (aussteht) · Nachhak-Mail Viktoria (MO-Satz + 352 € + Kontrollwert-Klarstellung + YUMMY-Nachberechnung) · PN 327 Eintrittsdatum · korrigiertes Statistik-PDF an Peter/Bank, falls alte Fassung versendet · Netto-Sextett-Analyse ~10.08. (GERARD 3500 · ANDI 2400 · JOY 2600 · EM 3300 · MO 3300 · Andre 3000 „mit Mutter" — Konstrukt klären) · staff_locations-Leichen (MO/Ursula Küche 0,00 in Buchhaltungsansicht) · `revenue_channels.is_takeaway` droppen (deprecated, null Nutzer) · Elson „Sunji"/„Shaji" Stammblatt-Tippfehler · Prüfer-Sichtkontrolle August-Export (Checkliste liegt vor, Block A0 = U/K-Erfassung) · LG-12-Erstanlage-Regel · GERARD Planer-Rolle · CHEFIN-Pool-Klärung (Bauherren-Wort) · Alt-Repos archivieren · Build-Tooling-Runde nach Export · 27 Scanner-Issues · Broadcast-Topic (SaaS) · SEC-01 · CORR-01/03 · DOC-01 · History-Purge · CI-Runde (Node-24 + STEP_SUMMARY) · db-integration scharf (Zehner-Serie läuft) · DB1-C · retry()-KGL · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · AuthUserLike-Cast · Orphan-Panel (SaaS) · row!-Assertions telegram · Telegram-Adminliste · ICS So/Feiertag · Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Frage (geparkt) · rosterPlanned-Signatur · KM1 · TB1 · 034/035 · AV1b/c-Rest · Stk/BE · DL1 · AP1 · Kanal-/Terminal-Notfallblatt.

---

## §122 — MB-Serie Monatsentwicklung; MB3/MB3b laufender Monat; Repo privat vollzogen (01.08.)

**Abnahme-Anker:** HEAD `5256f3a5` — vier Gates vom Prüfer eigenhändig gemessen: `tsc` 0 · `eslint . --max-warnings=0` 0 · `prettier --check .` clean · `vitest` 219 Dateien / 2161 Tests grün, 0 Skips · `bun install --frozen-lockfile` Exit 0. Rechnung: 2099 (§121) + 62 = 2161.

**Bauherren-Tag** (110 Direkt-Commits seit `5acd561d`, 08:15–14:5x): Statistik-Ausbau in einem Zug — **MB1 Monatsentwicklung** (`monthly_revenue_history`: Vor-COCO-Monatsumsätze aus Excel 2002ff., Migration `20260801102355`; `LIVE_FROM 2026-03-01`, weil die Sessions am 16.02. beginnen und der Februar angeschnitten ist; Live-Monate werden NICHT gespeichert — kein abgeleiteter Wert, Matrix entsteht zur Laufzeit über `decomposeRevenue`/KGL), **MB2 Ansicht Gesamt|Takeaway** (Takeaway ist TEILMENGE — Umschalter statt Zusatzspalte, damit niemand addiert), **STAT2c Standortvergleich-Karten** (`comparison-labels`: EIN zentrales Standort-Delta + Trendzeile je Standort, getrennt weil vorher verwechselbar; „—" statt NaN/0-Fake), Personal-/Gäste-Kacheln, Dichte-Balken, work-minutes-Modul, Monatsbericht-PDF. TA-Umschalter-UI. E2E-Pool-/Worker-Fix (`f73561f2`, betrifft `lohn-split-worker.spec` + `seed` — Teil des offenen CI-Beweislauf-Merkpostens). Namens-Stolperfalle notiert: `comparison-label.ts` (Fensterformat) und `comparison-labels.ts` (Delta-Beschriftung) liegen nebeneinander — beim nächsten Anfassen umbenennen, kein eigener Auftrag.

**MB3 — laufender Monat fiel doppelt falsch an** (Bauherren-Fund am 01.08.): ① Der Jahresverlauf zeichnete den laufenden Monat als vollen Punkt — Spicery hatte am 01.08. eine offene Session (Vectron 0, CSV-belegt) und stürzte auf 0 T€ ab; YUM ohne August-Session endete still nach Juli. Zwei Bilder für denselben Sachverhalt. ② Die YTD-Kachel verglich Jan–Jul (laufend) gegen Jan–Aug (Vorjahr) — Spicery zeigte −12,1 %, real ≈ −0,5 %; YUM −22,1 %, real ≈ −13,7 %. **WICHTIG:** ② trat auch OHNE partial-Zelle auf (YUM hatte keine August-Zelle) — das Kriterium ist „Fokusmonat = laufender Kalendermonat" (`currentMonthKey` durchgereicht bis `viewHeadline`), NICHT das partial-Flag. Fix: `chartValues` als reine Funktion in `monthly-view.ts` (partial ⇒ `null`; `values` bleibt für Tabelle/Heatmap mit „läuft noch"), `ytdThroughMonth` klemmt BEIDE Jahressummen auf den Vormonat, Kachel und Monatsbericht-PDF beschriften „bis <Monat>". Fünf blockierende Tests, darunter Bit-Identität für abgeschlossene Monate (Regressionsschutz historischer Monatsberichte) und der YUM-Fall. Sessions-Query bewusst OHNE Statusfilter gelassen (Bauherren-Entscheid): die offene Session ist korrektes Tagesgeschäft, der Fehler lag in der Anzeige. Die Verzerrung ist am Monatsersten maximal und löst sich zum Monatsende selbst auf — deshalb war sie bis heute unsichtbar.

**MB3b — Filterleiste tab-abhängig:** Die globale Leiste (Monat/Zeitraum, Standort, PDF) wirkte im Monatsentwicklungs-Tab gar nicht (eigener Datenpfad) und im Standortvergleich nur teilweise (Zeitraum wirkt, Standort-Pills werden ignoriert — Compare-Queries laden absichtlich alle Standorte). Doppelter Standort-Umschalter und doppelter PDF-Knopf waren irreführend. Fix: Tabs kontrolliert; `monat` = Leiste komplett ausgeblendet, `vergleich` = nur Standort-Pills ausgeblendet, übrige Tabs unverändert. Filter-State bleibt erhalten (Tab-Rückwechsel stellt die Auswahl wieder her). Unbeauftragter Bauherren-Commit in der Serie geprüft: `ebd508e6` = reine Karten-Umsortierung, keine Logik.

**Repo-privat-Merkposten VOLLZOGEN:** `cocoplatform-13000041` ist privat (Prüfer-Beleg 01.08.: anonymer API-Zugriff 403, `visibility private`). Prüfzugang läuft über Read-only-PAT je Session — Widerrufs-Routine per Bauherren-Entscheid 30.07. bewusst abgeschafft, Token bleibt stehen. Projektanweisung und neue Projekt-Kopfdatei (claude.ai-Wissensdatenbank) auf das kanonische Repo umgestellt; die veralteten Doku-Vollkopien (Stand 15.06.) aus der Wissensdatenbank entfernt — Repo ist die einzige Wahrheit, die Kopfdatei trägt nur änderungsarme Fakten ohne Personendaten.

Offene Merkposten (Sammelstand, ersetzt §121-Liste): **MB1-Produktions-Vollzug bestätigen** (Migration `20260801102355` ausgeführt + Excel-Historie importiert — Bauherren-Wort für die Akte) · CI-Beweislauf E2E-G1 sichten (kasse-finalize; lohn-split-worker nach `f73561f2` neu bewerten) · DEREJE-U/K-Erstverprobung in UK2 · Ursula Steuerklasse pflegen (COCO-9-Akte) · SUMITR/CHEFIN Negativ-Auszahlung bestätigen · Pool-Blick Erstkontakt Kopfteilung 31.07. · Nachhak-Mail Viktoria (MO-Satz + 352 € + Kontrollwert-Klarstellung + YUMMY-Nachberechnung) · PN 327 Eintrittsdatum · korrigiertes Statistik-PDF an Peter/Bank, falls alte Fassung versendet (jetzt inkl. YTD-Schiefstand aus MB3: −12,1 %/−22,1 % waren ≈ −0,5 %/−13,7 %) · Netto-Sextett-Analyse ~10.08. · staff_locations-Leichen · `revenue_channels.is_takeaway` droppen · Elson Stammblatt-Tippfehler · comparison-label(s)-Umbenennung beim nächsten Anfassen · Prüfer-Sichtkontrolle August-Export (Checkliste liegt vor, Block A0 = U/K-Erfassung) · LG-12-Erstanlage-Regel · GERARD Planer-Rolle · CHEFIN-Pool-Klärung · Alt-Repos archivieren · Build-Tooling-Runde nach Export · 27 Scanner-Issues · Broadcast-Topic (SaaS) · SEC-01 · CORR-01/03 · DOC-01 · History-Purge · CI-Runde (Node-24 + STEP_SUMMARY) · db-integration scharf (Zehner-Serie läuft) · DB1-C · retry()-KGL · buildWeeklyXlsx/buildBuchhaltungXlsx ohne Test · AuthUserLike-Cast · Orphan-Panel (SaaS) · row!-Assertions telegram · Telegram-Adminliste · ICS So/Feiertag · Kellner-Enden 28.07. · LG3a-DB-Tests · PB3 · Provisions-Frage (geparkt) · rosterPlanned-Signatur · KM1 · TB1 · 034/035 · AV1b/c-Rest · Stk/BE · DL1 · AP1 · Kanal-/Terminal-Notfallblatt.

---

## §123 — Lokaler E2E-Beweislauf: 5/5 grün; Pool-Befund als Test-Altbestand aufgelöst (01.08., abends)

**Abnahme-Anker E2E-G2:** HEAD `3495cc22` — vier Gates grün (`tsc` 0 · `eslint` 0 · `prettier` clean · `vitest` 219/2161, 0 Skips; Testzahl unverändert, da nur Playwright-Seed + Fehlertext).

**Lokaler Playwright-Lauf des Bauherrn** (Mac, Docker + `supabase start`/`db reset`, Env via `supabase status -o env`): **5 passed (25,8 s)** — Chromium 4/4, WebKit 1/1. Damit:

- **E2E-G1 bewiesen:** `kasse-finalize` 3/3 grün. Der CI-Beweislauf-Merkposten ist erbracht (lokal statt CI — gleichwertig, der CI-Runner bleibt als Zweitbeweis wünschenswert).
- **Pool-„Befund A“ AUFGELÖST — nie ein Produktbug.** Chronologie: Spec vom 07.07. wurde gegen die TG1-Warnlogik von damals gebaut (nur Gesamt-Minuten = 0 warnt); am 13.07. wurde bewusst auf `poolFullyUnallocated` JE POOL verschärft. Der Seed füllte seit jeher 20 € Küchen-Pool (`kitchen_tip_cents: 2000`) ohne Küchen-Personal — die Warnung feuerte zu Recht (423-€-Lehre in Aktion), der Test erwartete keinen Warn-Dialog. Die E2E-G2b-Diagnose widerlegte vorab beide ursprünglichen Kandidaten (te-hits=1, prod-axis-hits=1, `staff_locations` service korrekt) und lenkte auf die Pool-Rechnung. **Fix E2E-G2:** Seed füllt den Küchen-Pool nur noch in der `poolwarn`-Variante; `PoolHoursWarningError`-Text nennt jetzt je warnenden Pool Betrag + „0 € verteilt“ (die alte Zahl `eligibleMinutes` summierte nur MANUELLE `poolEntries` — Stempel fehlten, daher die irreführende Meldung „0 anrechenbare Stunden“ trotz vorhandener Stempel). Wortfolge „anrechenbare Stunden“ bewusst erhalten (Dialog- und Spec-Regex).
- **WebKit-Redirect-Verdacht begraben:** `lohn-split-worker` auf echtem WebKit grün (pdf.worker-Chunk einzeln, Split fehlerfrei, Diagnose `linkStatus=200 role=admin`). Der alte Verdacht stammte aus einer Umgebung ohne installiertes WebKit-Binary.
- **Worker-Regex-Fix `f73561f2` verifiziert** (Chromium grün, bereits im Mittags-Lauf).

**Lokaler-Beweisstand-Laufkarte** (etabliert, für Wiederholung): Clone `~/Documents/coco-plans/cocoplatform-13000041` (origin trägt Token-URL, Bauherren-Entscheid 30.07.); Docker Desktop starten; `supabase start` (+ `db reset` nach Migrationen oder unsauberem Container-Exit); Lauf mit `eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')" && SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" bun run e2e`. Stolpersteine aus der Erstfahrt: Befehle einzeln, nicht als Block; Container schläft bei Mac-Ruhezustand ein („fetch failed“ im Seed = DB weg → stop/start/reset); WebKit-Binary einmalig via `bunx playwright install webkit`. Der Schutzriegel (`global-setup`) hat im Erstlauf korrekt gegriffen (leere Env → Abbruch statt Produktions-Risiko) — Design bestätigt. Alt-Clones `~/coco-sandbox` und `~/Desktop/coco-local` sind ungepflegt — bei Gelegenheit löschen, nie als Prüfstand verwenden.

**MB1-Produktions-Vollzug BESTÄTIGT** (Bauherren-Wort 01.08.): Migration `20260801102355` ist in der Produktion ausgeführt, die Excel-Monatshistorie ist importiert. Datei und Produktion sind deckungsgleich — Merkposten geschlossen.

**Offene Merkposten:** unverändert gegenüber §122, MINUS „CI-Beweislauf E2E-G1 sichten“ (erbracht, s. o.), MINUS „MB1-Produktions-Vollzug bestätigen“ (s. o.), PLUS: **⚠ PRIORITÄR — korrigiertes Statistik-PDF an Peter/Bank nachreichen:** Das Monatsbericht-PDF mit den unbereinigten YTD-Zahlen IST versendet (Bauherren-Auskunft 01.08.). Die Zahlen darin überzeichnen den Rückgang erheblich (Spicery −12,1 % statt real ≈ −0,5 %; YUM −22,1 % statt ≈ −13,7 %), weil sieben laufende Monate gegen acht volle verglichen wurden (MB3-Befund). Seit `3495cc22` erzeugt der Monatsbericht-Knopf die korrekte Fassung („Jahressumme bis Jul“, beide Jahre gleich geklemmt) — neu ziehen und mit kurzem Korrekturhinweis nachsenden, bevor jemand auf Basis der alten Zahlen Schlüsse zieht. · CI-Runner-Zweitbeweis bei nächstem Push beiläufig sichten · **CODE-AUDIT-1** (nach dem August-Export): Stufe-0-Messung, reine Analyse ohne Code-Änderung — ① Tot-Code-Verifikation: `ts-prune` auf `3495cc22` lieferte 51 Kandidaten (u. a. `reopenSession`, `getCashLedger`, `findCrossAccountDuplicates`, `deleteInventorySession` — mutmaßlich nie verdrahtete Server-Functions); jede Fundstelle einzeln gegen git-Historie und dynamische Importe messen (Metalldetektor, kein Bagger). ② Bundle-Analyse via `rollup-visualizer` (Vorbild pdf.worker/Bundle-Diet). ③ Supabase Advisors im Dashboard durch den Bauherrn (Indizes, langsame Queries, RLS-Hinweise auf der Produktions-DB). ④ Sentry-Performance-Traces: real langsamste Routen. Erst danach EINE Aufräum-Runde aus den bestätigten Funden — räumt zugleich die 27 Scanner-Issues und die `comparison-label(s)`-Umbenennung mit ab. Kein Blind-Refactoring ohne Messung.

---

## §124 — STAT3-Serie komplett; DL2 Abmahnung; PG-Prognose beschlossen (01.08., spätabends)

**Abnahme-Anker:** HEAD `794a1b30` — vier Gates grün (`tsc` 0 · `eslint` 0 · `prettier` clean · `vitest` 221 Dateien / 2199 Tests, 0 Skips; 2181 + 18).

**STAT3-Serie — Statistik-PDF vom 6-Seiten-Datenfriedhof zum 1-Seiten-Management-Blick** (drei Runden, Bauherren-QA am gerenderten PDF zwischen den Runden):

- **STAT3:** KPI-Kacheln (Leitwert Δ **VORJAHRESMONAT** aus MB1 — Vormonat ist im Saisongeschäft irreführend), kompakte Standort-Tabelle, Trinkgeld/Personal nur als Summen (37 Klarnamen mit Beträgen aus dem Bank-/Gesellschafter-PDF entfernt — Datenschutz-Nebengewinn), Tagesbalken- und 13-Monats-Grafik. Chart-Geometrie als reines Modul `statistik-pdf-charts.ts`. Deutsche Zahlformate mit Test (`fmtHoursDe`: „5.464,48 h“ — die Punkt-Dezimalen des Juli-PDFs waren der Anlass).
- **STAT3b:** Take-Away-Kanaltabelle (Wolt/Direkt/SoUse × Standorte + Gesamt + Anteil % + Δ Vorperiode). Server-Eingriff minimal: `previousTakeawayComponents` nur als Rückgabefeld ergänzt — `loadWindow` berechnete die Vorfenster-Komponenten bereits, U5a-Klemmung gilt automatisch mit. Reines Modul `takeaway-channels.ts` auf `takeawayDonutSegments`/`growthPct` (eine Wahrheit). Ehrliche Grenze als PDF-Fußnote: Vorjahresvergleich je Kanal unmöglich (MB1 speichert keine Kanal-Zerlegung). Bauherren-Fund am Render: Personalquote-Kachel trug „Takeaway: <Umsatz>“ — Umsatzwert in Lohnkosten-Kachel, ersetzt durch Fachhinweis „Basis-Brutto ohne AG-SV/SFN“ (Commit „Zufallskacheln-Text korrigiert“).
- **STAT3c:** Tagesbalken im Alle-Standorte-Scope nach Standort **GESTAPELT** (Farben identisch zur 13-Monats-Legende, keine Segment-Zahlen — nur die optische Verteilung, Bauherren-Vorgabe). `stackedBarChartGeometry` rein, mit Tests: Segmente summieren exakt zur Stapelhöhe (kein Rundungs-Spalt), Ein-Reihen-Fall bit-identisch zu `barChartGeometry`, ungleiche Reihenlängen werfen laut. Sonntags-Aufhellung im Stapelmodus bewusst entfallen (fette Tagesnummer markiert weiter).

**DL2 — Dokumentvorlage „Abmahnung (unentschuldigtes Fehlen)“:** Vierter `doc_type`; Migration `20260801201020` erweitert NUR den `document_templates`-Check — vom Prüfer gegen alle Ablage-Constraints gemessen: `generated_documents.doc_type` hat keinen CHECK, `staff_documents` ist der Upload-Pfad der Akte, nicht der Generierungs-Pfad; die Ein-Tabellen-Migration ist vollständig. Neu und GENERISCH: Platzhalter-Kategorie **„vorgang“** (Einzelfall-Daten wie der Fehltag, kein Stammdatum) — der Generieren-Dialog fragt Vorgangs-Platzhalter des Templates als Pflichtfelder ab, `resolveVorgangOrThrow` blockiert serverseitig („ein Dokument mit sichtbarem `{{fehltag}}` darf nie entstehen“). Standard-Text in `default-templates.ts` mit ausdrücklicher Rüge, doppelter Kündigungsandrohung (Fernbleiben + Anzeigepflicht) und Empfangsbestätigung inkl. „kein Anerkenntnis“-Klausel. ⚠ Vor dem ersten scharfen Einsatz: Text vom Arbeitsrechtler/Lohnbüro gegenlesen lassen (Merkposten). Produktions-SQL der Migration: **vom Bauherrn ausgeführt und belegt** (01.08., 23:15 — Kontrollabfrage `pg_get_constraintdef` zeigt alle vier Typen inkl. `'abmahnung'`; CSV-Beleg liegt vor). Datei und Produktion deckungsgleich, §119 erfüllt.

**PG-Serie Umsatzprognose — Grilling abgeschlossen, Beschlussprotokoll liegt vor** (13 Entscheide + 2 Nachträge; Datei beim Bauherrn, Kernpunkte hier): Zweck = Dienstplan-Besetzung; voller Schnitt Standort × Haus/Takeaway; 14 Tage rollierend; Backtest-Tor MAE Tag ≤ 12 % / Woche ≤ 6 % auf allen verfügbaren vollen Tages-Monaten (min. 4, Ziel 6), **TOR JE REIHE** mit Teilfreischaltung (nicht bestandene Reihen sichtbar „experimentell“); eigene Prognose-Ansicht, NUR Umsatz als **SPANNE** (aus dem Backtest-Fehler, keine erfundene ±-Konstante), sichtbar für `admin` + `planer`; Events = Großlagen + Großmessen mit Je-Standort-Flag, Sport nur bei automatischem Feed (OpenLigaDB-Prüfung), Konzerte gestrichen; Wetter = Hauptfaktor (beide Häuser Terrasse); COVID 03/2020–05/2021 ausgeschlossen; Prognose-Archiv append-only + Trefferquoten-Kachel als Pflichtteil. **Zweistufen-Modell (N1):** Saisonfaktoren aus der 24-Jahre-MONATSHISTORIE, Wochentag/Wetter/Events aus TAGESDATEN (erst ab 16.02.2026 — erster tagesgenauer Wiesn-Zyklus Sep/Okt 2026, Winterwetter ab Feb 2027). **Vectron-Option (N2):** `daily_revenue_history` als eigene Tabelle (NIE Fake-Sessions), Merge-Grenze nach `mergeMonthlyCells`-Muster, Faktoren gegen die vereinigte Tagesachse — TA-Archiv- und Vectron-Tagesexport-Prüfung als PG0-Block. Reihenfolge: August-Export → CODE-AUDIT-1 → PG0/PG1/PG2.

**Offene Merkposten:** wie §123, MINUS „⚠ PRIORITÄR korrigiertes Statistik-PDF an Peter/Bank“ — **ERLEDIGT** (Bauherren-Meldung 01.08., spätabends): korrigierte Fassung mit geklemmten YTD-Zahlen samt Korrekturhinweis an Peter und die Bank versendet; zwischen Befund (nachmittags), Fix (`3495cc22`) und Nachreichung lag EIN Tag. PLUS: Abmahnungstext juristisch gegenlesen · PG-Serie (Beschlussprotokoll liegt vor; Start nach CODE-AUDIT-1) · Vectron-/TA-Tageshistorien-Prüfung (PG0) · STAT3c visuelle QA der gestapelten Balken durch den Bauherrn am nächsten gerenderten PDF.
