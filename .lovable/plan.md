## Ziel
Auf `/admin/staff` auf einen Blick sehen, welcher Mitarbeiter ein Online-Konto hat, und daneben eine Auffangliste für Personen, die sich per Auth angemeldet haben, aber keinem Mitarbeiter zugeordnet sind.

## Änderungen

### 1. `listStaff` um Kontostatus erweitern
`src/lib/admin/staff.functions.ts`: Select um `user_links(user_id)` erweitern (bereits FK vorhanden) und im Rückgabe-Objekt `hasAccount: boolean` mitliefern. Keine E-Mail, keine user_id – nur das Bit, damit die Listen-DTO-Regel (SD1: keine Personaldaten in listStaff) erhalten bleibt.

### 2. Anzeige in der Matrix
`src/routes/_authenticated/admin/staff.index.tsx`: In der Namens-Zelle ein kleines Konto-Icon/Badge neben Display-Name rendern (mit Tooltip „Online-Konto vorhanden" bzw. „Kein Konto"). Kein neuer Spalten-Header, damit die Matrix nicht schmaler wird. Farbe: `text-emerald-600` (hat Konto) vs. gedämpftes Grau (kein Konto). Optional in Hero-Zeile Zählwert „X mit Konto" ergänzen.

### 3. Neue Server-Function `listOrphanAuthAccounts`
Neue Datei `src/lib/admin/orphan-accounts.functions.ts`, admin-only via `runGuarded`:
- `supabaseAdmin.auth.admin.listUsers()` seitenweise abrufen
- Alle `user_links.user_id` der Organisation laden
- Differenz bilden → für jeden verwaisten Auth-User: `{ userId, email, createdAt, lastSignInAt }`
- Rückgabe sortiert nach `lastSignInAt` desc

Hinweis zur Semantik: auth.users ist nicht org-gebunden. „Verwaist" heißt hier: existiert in Auth, aber es gibt keinen `user_links`-Eintrag in dieser Organisation. Da in diesem Projekt aktuell nur eine Organisation existiert (Bestand), deckt das den Bedarf ab; Mehr-Org-Feinschliff kann später folgen.

### 4. Auffang-Karte auf der Staff-Seite
Unter dem Sofort­meldung-Alert eine ausklappbare Karte „Anmeldungen ohne Mitarbeiter (N)" rendern, nur wenn `N > 0` und `isAdmin`. Tabelle mit E-Mail, Erstellt-am, Zuletzt angemeldet, plus Hinweis „Bitte Mitarbeiter anlegen und Konto verknüpfen oder Konto entfernen." Keine Löschen-Aktion in diesem Schritt — nur Sichtbarmachung.

## Nicht enthalten
- Keine Schema-Änderung, keine Migration, keine RLS-Änderung.
- Keine Aktion „verwaistes Konto löschen/zuordnen" — bewusst nur Anzeige, damit der Schritt klein und rückrollbar bleibt.
- Kein Umbau von `getStaffAccountStatus` / Konto-Tab.

## Gates
`tsgo`, `eslint --max-warnings=0`, `prettier --check`, `vitest run`. Keine neuen Tests nötig (reine Anzeige-Ergänzung); bestehende Tests für `listStaff` bleiben grün, weil das neue Feld additiv ist.
