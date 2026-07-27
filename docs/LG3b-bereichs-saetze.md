# LG3b — Bereichs-Sätze lohnwirksam + Export je Lohnart

Aufbauend auf **PB2** (Anker 708e4906, 1924 Tests). Keine Migration, keine SQL.
`staff_compensation_rates` ist gefüllt (37 migriert + MO/LAM/EM handgepflegt).

## Entscheidungen (aus dem LG-Grilling, verbindlich)

- **Drei Sätze je Person** (LG-8): `gl`, `kitchen`, `service`.
- **Satzauflösung je Zeiteintrag, nicht je Person** (LG-10): Bereich per WZ2
  (`entryRowDepartment`, identisch zu Buchhaltung/LG2). Satz = jüngstes
  `valid_from ≤ business_date` aus `staff_compensation_rates`.
- **SFN auf Schicht-Grundlohn** (LG-10): `berechneSfnGeld` läuft je
  Bereichs-Bucket mit dem Bereichssatz, nicht mehr einmal je Person auf
  Mischsatz. Formelinhalte unangetastet.
- **Fehlender Satz** (LG-9):
  - **b** Export bricht mit vollständiger Liste ab.
  - **c** Anzeige rechnet 0, roter Marker je Person, Summenzeile
    „unvollständig". Kein stiller Ersatzsatz.
- **Export-Blocker — Prüfmenge** (Ergänzung): geprüft werden
  ausschließlich Personen mit `paidHours > 0` in mindestens einem
  Bereich der Exportperiode. Payroll-Accounts ohne Stunden (z. B.
  Viktoria Schaffer) dürfen den Export nie blockieren.
- **Export-Blocker — zwei Bedingungen** über derselben Prüfmenge:
  1. `staff_compensation_rates`: kein Satz in einem Bereich, in dem die
     Person Stunden hat (LG-9-b).
  2. `staff.perso_nr`: `null` oder leer.
  Fehler-Payload ist eine kombinierte Liste, pro Person mit Grund
  (`missing_rate: [dept, …]` und/oder `missing_perso_nr: true`). Bricht
  den gesamten Export ab — keine Teil-Exporte. Anzeige (LG-9-c) läuft
  unabhängig weiter; fehlende `perso_nr` wird analog rot markiert, ohne
  Rechenwirkung.
- **Rückwirkung**: `isValidFromAllowed` bleibt unverändert (LG-12).
- **Stundenbasis je Lohnart** = `paidHours(...)` aus PB2 (respektiert
  `pausen_bezahlt`; SFN-Töpfe bleiben in beiden Stellungen netto).
- **Legacy `staff_compensation.hourly_rate`**: Engine liest nicht mehr;
  Feld bleibt, Abriss = separater späterer Schritt.

## Lohnart-Zuordnung (Lohnbüro 27.07., LAM-Juli-Abrechnung als Referenz)

| Bereich | edlohn-Lohnart |
| ------- | -------------- |
| Service | Zeitlohn       |
| GL      | Zeitlohn 2     |
| Küche   | Zeitlohn 3     |

Je Lohnart: Stundenzahl (Summe der `paidHours` der Bereichs-Einträge) und
Stundensatz — kein Zulagen-Modell. SFN-Zuschläge je Bereichs-Satz getrennt
ausgewiesen; Referenz LAM Juli: 33,75 h N25 = 18,75 (GL) + 15,00 (Service),
8,25 h N40 = 4,50 + 3,75, Sonntag 30,75 vollständig GL.

## Nicht anfassen

- `pap-2026/**`
- `berechneSfnGeld`-Formelinhalte, `applyBreakProration`
- PB1-Einstellung / PB2-Verdrahtung
- `staff_compensation`-Tabelle + RLS
- Buchhaltungs-Export / LG2-Anzeige
- `entryRowDepartment` / `primaryDepartment` — nutzen, nicht ändern.

## Paritätsmessung

- **Nullmessung** (Ein-Bereich-Fälle, Bereichssatz = altes `hourly_rate`):
  cent-identisch zum bisherigen Ergebnis. Blockierender Test:
  `src/lib/lohn/lg3b-nullmessung.test.ts`.
- **Mehrsatz-Fixtures**: LAM (GL+Service), MO (3 Bereiche) mit
  handgerechneten Referenzwerten im Test-Kommentar.
  - **MO-Sollwert**: `gl = kitchen = service = 2300` Cent (23,00 € in
    allen drei Bereichen). Die 17,50-Zeile aus der Juli-Abrechnung war
    manuelle Justage im Lohnbüro und ist **kein** Sollwert für
    Fixtures oder handgerechnete Referenzwerte.
  - **LAM**: unverändert nach realer edlohn-Juli-Abrechnung.
- **Frank-seitig nach Deploy**: Parallel-Lohnlauf August alt/neu; Abgleich
  wie ursprüngliche edlohn-Verifikation.

## Offen (nicht in diesem Auftrag)

- Urlaubs-/Krankstunden-Zuordnung zu Lohnarten (§11 BUrlG-Durchschnitt,
  Lohnbüro entscheidet). Bis dahin nur gearbeitete Stunden je Lohnart;
  Urlaub/Krank wie bisher.
- Abriss `staff_compensation.hourly_rate`.
