# LG3b FINAL — Bereichs-Sätze lohnwirksam + Export je Lohnart

Aufbauend auf PB2 (Anker 708e4906, 1924 Tests). Keine Migration, keine SQL. `staff_compensation_rates` ist gefüllt (37 migriert + MO/LAM/EM handgepflegt).

## Ablage
- Diese Spec 1:1 nach `docs/LG3b-bereichs-saetze.md` (analog PB2-Doku).

## Schritt 0 — Nullmessungs-Fixture (blockierendes Gate, VOR Verhaltensänderung)
Vor jeder Engine-Änderung: `src/lib/lohn/lg3b-nullmessung.test.ts`, das mindestens 3 reale Golden-Master-Personen-Perioden aus dem Bestand nimmt (Ein-Bereich-Fälle) und die neue Engine gegen den alten Weg auf cent-identisches Ergebnis prüft. Solange dieser Test nicht existiert und rot→grün belegt ist, wird `aggregateSfnPeriod` nicht umgestellt.

## Schritt 1 — Reines Rate-Resolution-Modul
Neu `src/lib/lohn/rate-resolution.ts`:
```ts
export type RateRow = { department: Department; validFrom: string; hourlyRateCents: number };
export function resolveRateCents(rates: RateRow[], department: Department, businessDate: string): number | null;
```
Jüngstes `validFrom ≤ businessDate` im passenden Bereich; kein Bereichs-Fallback; `null` = fehlt. Tests: leere Liste, historische Staffel, Bereichsisolation, Grenztag.

## Schritt 2 — WZ2-Attribution serverfähig machen
`entryRowDepartment` und `primaryDepartment` sind heute in `zeit-uebersicht-core.ts` client-orientiert. In ein serverfähiges Modul auslagern (`src/lib/time/entry-department.ts`), Signatur unverändert, alle Aufrufer umbiegen. Kein Verhaltenswechsel — Attributionslogik bleibt bit-identisch (LG2-Anzeige/Buchhaltung dürfen sich nicht ändern; separater Regressionstest gegen bestehende LG2-Fixtures).

## Schritt 3 — `lohn-period.functions.ts` umstellen
- Statt `staff_compensation.hourly_rate` alle `staff_compensation_rates`-Zeilen der Person laden.
- Je Eintrag: WZ2-Bereich (dieselbe Datenbasis wie LG2 — `roster_shifts`, `time_entries.department`) → `resolveRateCents`.
- **SFN je Bereichs-Gruppe** (Korrektur v2): `berechneSfnGeld` läuft je Bereichs-Bucket mit dem Bereichssatz, nicht mehr einmal je Person auf Mischsatz. `berechneSfnGeld`-Formel und `applyBreakProration` bleiben unangetastet.
- 50-€-Grundlohngrenze: prüft je Bereichs-Satz (Verhalten am selben Prüfort, nur Eingangswert wechselt).
- Rückgabe erweitert:
  ```
  perDepartment: Array<{ department, paidHours, rateCents, grundlohnCents, sfn: SfnGeldErgebnis }>
  missingRates: Array<{ staffId, department }>
  ```
  Alt-Felder (`hourlyRateCents`, `totalHours`, `simple`, `extended`) bleiben additiv erhalten für Kompatibilität mit Anzeige-Konsumenten in dieser Runde; Werte weiterhin sinnvoll aggregiert (Mischsatz-Feld = 0 wenn mehrere Bereiche, damit niemand versehentlich damit rechnet — konsumierende Views werden in Schritt 4/5 auf `perDepartment` umgestellt).

## Schritt 4 — Export je Lohnart
`lohn-csv-export.ts` und `lohn-excel-export.ts`:

**Lohnart-Mapping (Lohnbüro 27.07.):**
| Bereich | Lohnart |
|---|---|
| Service | Zeitlohn |
| GL | Zeitlohn 2 |
| Küche | Zeitlohn 3 |

- Zeilen je Lohnart mit Stundenzahl (Summe `paidHours` der Bereichs-Einträge, PB2) und Bereichssatz.
- **SFN je Lohnart getrennt**: pro Bereich mit SFN-Stunden eigene Zuschlagszeilen (Nacht 25/40, Sonntag, Feiertag, Feiertag-150), Satz = Bereichssatz. LAM-Juli-Referenz im Test-Kommentar: 33,75 h N25 = 18,75 (GL) + 15,00 (Service); 8,25 h N40 = 4,50 + 3,75; Sonntag 30,75 vollständig GL.
- Urlaub/Krank wie bisher (Lohnart-Zuordnung offen, siehe „Offen").
- **LG-9b Abbruch**: vor dem Schreiben `missingRates` prüfen; wenn nicht leer → Fehler mit vollständiger Liste `"Satz fehlt für <Person> / <Bereich>"` (alle Fälle, nicht nur der erste). Test deckt Mehrfachfehler ab.

## Schritt 5 — Anzeige (Lohn-Tab, `LohnrechnerPanel.tsx` bzw. `PayrollTab.tsx`)
- Personensumme wie bisher; darunter Zweitzeile je Bereich (Muster LG2).
- **LG-9c**: fehlender Satz → Bereich rechnet mit 0, roter Hinweis je Person („Satz fehlt: Küche — Beträge unvollständig"), Summenzeile trägt „unvollständig", solange irgendwo fehlt. Kein stiller Ersatzsatz.
- Stammblatt „aktuell lohnwirksam" auf `staff_compensation_rates` umbiegen; Label anpassen. Legacy `staff_compensation.hourly_rate` bleibt in der DB, wird von der Engine nicht mehr gelesen (Abriss = späterer eigener Schritt).

## Schritt 6 — Tests
- Nullmessung (Schritt 0) — blockierend.
- Mehrsatz-Fixtures: LAM (GL+Service), MO (3 Bereiche) mit handgerechneten Referenzwerten im Kommentar.
- LG-9-Export-Abbruch: fehlender Satz → Exception mit vollständiger Liste.
- LG-9-Anzeige: fehlender Satz → 0-Betrag + Marker.
- LG2-Regression: Buchhaltungs-Split unverändert nach Extraktion von `entryRowDepartment`.
- Golden-Master (`lohn-core.test.ts`, `stufe3a.test.ts`) muss grün bleiben — bei Berührung §104-Meldung.

## Nicht anfassen
`pap-2026/**`, `berechneSfnGeld`-Formelinhalte, `applyBreakProration`, PB1/PB2-Verdrahtung, `staff_compensation`-Tabelle+RLS, LG2/Buchhaltungs-Split, `entryRowDepartment`-Logik (nur verschieben).

## Erfolgs-Gate
- `npx prettier --write` + `npx eslint --fix`
- `tsc` 0 · `eslint` 0/0 · `prettier` clean
- `npx vitest run` grün: 1924 (Anker 708e4906) + neue Tests, keine grüne Golden-Master-Regression
- Nullmessungs-Fixture und LG-9-Tests blockierend
- §104-Meldepflicht bei Golden-Master-Berührung

## Offen (nicht in diesem Auftrag)
- Urlaubs-/Krankstunden-Zuordnung zu Lohnarten (§11 BUrlG-Durchschnitt, Lohnbüro entscheidet). Frage in Zuordnungs-Mail; bis Klärung weist COCO nur gearbeitete Stunden je Lohnart aus, Urlaub/Krank wie bisher.
- Frank-seitig: Parallel-Lohnlauf August alt/neu nach Deploy.
- Abriss `staff_compensation.hourly_rate`-Legacy-Feld.

## Klicktest (Bauherr)
1. Ein-Bereich-Person: Werte identisch zum alten Export (Stichprobe).
2. LAM: Grundlohn splittet GL/Service mit korrekten Sätzen; GL-Nacht-SFN auf GL-Satz.
3. Satz löschen → Anzeige rot + „unvollständig", Export verweigert mit Personen-/Bereichsliste; Satz zurück → beides verschwindet.
