# Admin-Button „Session wieder öffnen" (Tagesabrechnung)

## Befund (geprüft)

- spicery, Geschäftstag 06.08.2026: Session `37fe6707…`, Status `finalized`, `locked_at` leer.
- Kanal `Wolt` steht in `session_channel_amounts` auf 224000 Cent (2.240,00 €); korrekt wären 24000 Cent (240,00 €).
- `cash_locks` ist leer — es gibt keine Wasserlinie, die den Tag blockiert.
- Die Server-Funktion `reopenSession` (admin-only, Audit-Eintrag `cash.session.reopened`, blockt bei `locked` und unter der Wasserlinie) existiert schon in `src/lib/cash/cash.functions.ts` — sie ist nur in der Oberfläche nirgends verdrahtet. Deshalb gibt es aktuell keinen Weg, einen finalisierten Tag im Browser zu korrigieren.

## Was gebaut wird

In der Kopfzeile der Tagesabrechnung, neben „Session sperren", erscheint für Admins bei Status `finalized` ein zusätzlicher Button „Session wieder öffnen":

- Sichtbar nur für Rolle `admin`, nur bei Status `finalized`, nicht unterhalb der Wasserlinie (gleiche Bedingung wie „Session sperren").
- Klick öffnet einen Bestätigungsdialog im Stil der bestehenden Sperr-/Entsperr-Dialoge, mit Hinweis, dass Finalisierung und Druckstand verfallen und der Tag danach wieder bearbeitbar ist.
- Nach Erfolg: Toast „Session wieder geöffnet.", Neuladen der Übersicht; die Eingabefelder (u. a. Take-away-Kanäle) sind wieder editierbar.
- Fehler der Server-Funktion (z. B. gesperrt, Wasserlinie) werden als Fehler-Toast im Klartext angezeigt.

Danach korrigierst du Wolt selbst auf 240,00 €, speicherst und druckst die Tagesabrechnung erneut (das Finalisieren passiert wie gewohnt beim Druck).

## Nicht Teil dieser Runde

- Keine Änderung an `reopenSessionCore`, an Guards oder an der Wasserlinie.
- Keine direkte Datenkorrektur an der Datenbank vorbei an der App.
- Kein Wiederöffnen von `locked`-Sessions (dafür bleibt „Session entsperren").

## Technische Details

- `src/routes/_authenticated/admin/kasse.tsx`: `reopenSession` per `useServerFn` einbinden, Mutation analog `lockMut`/`unlockMut`, State `reopenConfirm`, Button + Dialog, Invalidierung derselben Query-Keys wie beim Entsperren.
- Gates: `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` (Baseline-Skip bleibt unverändert).
