## LG3b — Ergänzung vor Export-Teil

Zwei präzisierende Auflagen zum bestehenden LG3b-Plan (Anker: `docs/LG3b-bereichs-saetze.md`, `src/lib/lohn/rate-resolution.ts` bereits gelegt). Kein Neuaufsatz — nur Anpassungen an Blocker-Logik und Fixtures.

### 1. Export-Blocker: perso_nr zusätzlich zur fehlenden Satz-Prüfung

**Prüfmenge (verbindlich):** ausschließlich Personen mit `paidHours > 0` in mindestens einem Bereich der Exportperiode. Payroll-Accounts ohne Stunden (z. B. Viktoria Schaffer) dürfen den Export **nie** blockieren.

**Zwei Blocker-Bedingungen, gleiche Prüfmenge:**
- `staff_compensation_rates`: kein Satz in einem Bereich, in dem die Person Stunden hat (bestehende LG-9-b-Regel).
- `staff.perso_nr`: `null` oder leer.

**Fehler-Payload:** eine kombinierte Liste, pro Person mit Grund (`missing_rate: [dept, …]` und/oder `missing_perso_nr: true`). Bricht Export ab, zeigt vollständige Liste — keine Teil-Exporte.

**Anzeige (LG-9-c bleibt):** unabhängig vom Export rechnet die Bildschirmanzeige weiter (0 bei fehlendem Satz, roter Marker je Person, Summenzeile „unvollständig"). Fehlende perso_nr wird analog markiert.

### 2. MO-Fixture: 23,00 in allen drei Bereichen

Referenzfall MO im Test-Kommentar zu `staff_compensation_rates`-Fixtures:
- `gl = 2300` Cent
- `kitchen = 2300` Cent
- `service = 2300` Cent

Die 17,50-Zeile aus der Juli-Abrechnung war manuelle Justage im Lohnbüro, kein Sollwert. Fixtures und handgerechnete Referenzwerte in `src/lib/lohn/lg3b-*.test.ts` verwenden ausschließlich 23,00 für MO. LAM (GL+Service) unverändert nach realer edlohn-Juli-Abrechnung.

### Betroffene Stellen (nur Delta zu bestehendem Plan)

- `src/lib/lohn/lohn-period.functions.ts` (oder Nachbarmodul mit Export-Aufbereitung): Blocker-Check erweitern — Prüfmenge = Personen mit Stunden, zweite Bedingung `perso_nr`.
- `src/components/lohn/LohnrechnerPanel.tsx` (Anzeige): roter Marker auch für fehlende perso_nr; keine Rechenwirkung.
- LG3b-Mehrsatz-Testfixtures: MO auf `23,00 / 23,00 / 23,00` setzen inkl. handgerechneter Referenzwerte im Kommentar.
- `docs/LG3b-bereichs-saetze.md`: Absatz „Fehlender Satz" um perso_nr-Blocker ergänzen, MO-Sollwert-Klarstellung ergänzen.

### Nicht anfassen

- PB2-Verdrahtung, `berechneSfnGeld`-Formelinhalte, `applyBreakProration`, `pap-2026/**`.
- LG-9-c-Anzeigelogik in der Rechenfunktion selbst (weiter 0 bei fehlendem Satz).
- LAM-Referenzwerte (real, edlohn Juli).
