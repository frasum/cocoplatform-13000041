## Ziel

Kontaktdaten von GIG SERVICE (Narisara Asa-sa-na, `93e44abe-d1d8-4763-b0a6-63cea7313687`) aus dem Audit-Log wiederherstellen und danach klären, warum die Admin-Speicherung sie überschrieben hat.

## Diagnose (bestätigt)

- Change-Request vom 26.07.: enthielt nur 12 Felder (Bank, Steuer, Geburts- und Kassendaten, Namen). Diese sind sauber in `staff_personal_details` gelandet.
- Direktbearbeitung am 03.07. via Self-Service (`profile.contact_update`): setzte `address`, `email`, `phone`.
- Zwischen 26.07. 16:30 und 27.07. 07:27 vier `staff_personal_details.upsert`-Vorgänge aus der Admin-Maske. Aktuell stehen `address`, `email`, `phone` auf NULL — sie wurden dabei überschrieben.
- Nie eingereicht (bleibt leer): Anrede, Straße/PLZ/Ort, Kirchensteuer, Minijob, SV-frei, Kinderfreibeträge, Eintritts-/Austrittsdatum, Personalgruppe, Berufsbezeichnung, Urlaubstage.

## Schritt 1 — Datenwiederherstellung (Migration)

Update auf `staff_personal_details` für `staff_id = 93e44abe-d1d8-4763-b0a6-63cea7313687`, ausschließlich diese drei Felder aus dem Audit-Log setzen:

- `address = 'Max-kraus-str. 46\n85435 Erding'`
- `email = 'muguggig93@gmail.com'`
- `phone = '17663784147'`

Kein weiteres Feld anfassen. Danach Verifikation per Read-Query.

## Schritt 2 — Ursachenanalyse Sparse-Patch

Der Sparse-Patch aus dem letzten Runden-Fix (`PersonalDetailsTab.toSparsePatch`) sollte genau diesen Fall verhindern. Er hat offensichtlich bei GIG SERVICE nicht gegriffen. Zu klären:

1. Konsole/Sentry: haben die 26.07./27.07.-Saves auf diesem Staff-Datensatz Fehler geworfen?
2. Wurde die Maske geöffnet, bevor die `getStaffPersonalDetails`-Query vollständig geladen war? Dann wäre die Baseline leer und ALLE Felder würden als „changed" gelten (Audit zeigt genau dieses Muster).
3. Reproduktion: PersonalDetailsTab öffnen, sofort „Bearbeiten" klicken, ohne zu tippen speichern. Ergebnis prüfen.

Wenn (2) bestätigt: Fix ist, `setBaseline` erst nach vollständigem Laden zu setzen und den Bearbeiten-Button so lange zu deaktivieren, bis `detailsQ.isSuccess` true ist. Dieser Fix landet erst nach der Wiederherstellung — Schritt 1 ist unabhängig.

## Nicht-Ziele

- Keine Änderung an den Antrags-/Freigabepfaden.
- Keine Übernahme von Vor-/Nachname auf `staff` (die Werte stimmen bereits: „Narisara" / „Asa-sa-na").
- Keine Ergänzung von Feldern, die die Mitarbeiterin nie gemeldet hat.

## Reihenfolge

1. Migration mit dem drei-Felder-Update ausführen (Approval erforderlich).
2. Read-Query zur Bestätigung: `address`, `email`, `phone` befüllt.
3. Kurze Rückmeldung mit dem Ergebnis und dem Vorschlag zu Schritt 2 (Reproduktion + Bearbeiten-Guard) als separates Häppchen.
