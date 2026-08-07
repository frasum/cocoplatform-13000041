# Änderungs-Log für nachträgliche Kassen-Änderungen

Ziel: Wird eine bereits abgeschlossene Tagesabrechnung wieder geöffnet und korrigiert (Fall Wolt 2.240 → 240), entsteht ein nachvollziehbarer Eintrag mit **Benutzer, Zeitpunkt und betroffenen Feldern (vorher → nachher)**, sichtbar als Karte in der Tagesabrechnung.

Umfang laut Abstimmung: nur Tagesabrechnung (Kasse), Anzeige als Karte im Tag, Feld-Diff nur für Änderungen **nach dem ersten Abschluss**.

## 1. Marker „war schon abgeschlossen"

Heute setzt `reopenSession` `finalized_at` auf NULL zurück — danach ist nicht mehr erkennbar, dass der Tag schon einmal fertig war.

- Migration: `sessions.reopened_at timestamptz`, `sessions.reopened_by uuid` (Muster wie `finalized_by`), `sessions.reopen_reason text`.
- `reopenSessionCore` setzt diese Felder beim Wiederöffnen.
- Der Wiederöffnen-Dialog verlangt einen **Pflicht-Grund** (Freitext, mindestens 5 Zeichen). Ohne Grund bleibt der Knopf gesperrt, und der Server weist die Anfrage ohne Grund ab. Der Grund landet im Audit-Eintrag `cash.session.reopened` und in `sessions.reopen_reason`, damit die Karte ihn auch bei den Folgeänderungen des Tages anzeigen kann.
- Ein Tag gilt als „nachträglich geändert", solange `reopened_at` gesetzt ist.

## 2. Feld-Diff beim Speichern

- Neues reines Modul `src/lib/cash/session-change-diff.ts`: vergleicht den Zustand vor dem Speichern (Session-Kopfzahlen, Kanal-Beträge, Terminal-Beträge) mit den neuen Werten und liefert eine Liste `{ field, label, before, after }`. Unveränderte Felder erscheinen nicht.
- Kanäle/Terminals werden mit ihrem Anzeigenamen (z. B. „Wolt") in den Eintrag geschrieben, damit die Historie auch nach späteren Umbenennungen lesbar bleibt.
- `updateSessionCore` lädt die Vorher-Werte nur dann zusätzlich, wenn `reopened_at` gesetzt ist, und schreibt in diesem Fall den Audit-Eintrag `cash.session.updated_after_finalize` mit `meta.changes` und dem Grund aus `reopen_reason` (statt des bisherigen inhaltslosen `cash.session.updated`). Läuft nichts auseinander, wird kein Eintrag geschrieben (Log-Hygiene wie beim Personal-Import).
- Der Ablauf am laufenden, noch nie abgeschlossenen Tag bleibt exakt wie heute.
- Unit-Tests für das Diff-Modul: geänderter Kanal-Betrag, neu hinzugekommener Kanal, entfernter Kanal, Kopfzahl geändert, „keine Änderung".

## 3. Lesepfad

- Neue Server-Function `listSessionChangeLog` (`src/lib/cash/cash-changelog.functions.ts`): admin + manager, liest über `supabaseAdmin` aus `audit_log` alle Einträge zu `entity = 'session'` / dieser `entity_id` mit den Aktionen `reopened`, `updated_after_finalize`, `finalized` und löst den Benutzernamen über `staff` auf.
- `audit_log` bleibt für Clients DENY-ALL; nur diese geprüfte Function liest.

## 4. Anzeige in der Tagesabrechnung

- Neue Komponente `src/components/cash/SessionChangeLogCard.tsx`: aufklappbare Karte „Änderungen nach Abschluss" mit einer Zeile je Ereignis (Zeitpunkt, Benutzer, Aktion), darunter dem angegebenen Grund und einer schlanken Feld-Tabelle Feld / Vorher / Nachher — Optik und Formatierung analog `ChangeRequestsTab`.
- Einbau in `src/routes/_authenticated/admin/kasse.tsx` unterhalb der bestehenden Blöcke; die Karte wird nur gerendert, wenn Einträge existieren.
- Nach Wiederöffnen und nach Speichern wird die Abfrage mit invalidiert, damit die Karte sofort aktuell ist.

## Nicht angefasst

Finalisieren/Sperren/Wasserlinie, Kellner-Abrechnungs-Korrektur (`correctWaiterSettlement`), Trinkgeld-Pool, PDF-/Druckansicht, bestehende Audit-Aktionen anderer Module.

## Gates

`tsc --noEmit` 0 · `eslint . --max-warnings=0` 0 · `prettier --check .` clean · `vitest run` grün (bekannter Baseline-Skip bleibt).
