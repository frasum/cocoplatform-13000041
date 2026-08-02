## FK1 — Schulferien Bayern: Code-Kalender + Hinweis in der Tagesabrechnung

### Bestandsmeldung (verifiziert)
- `listEventNoticesForToday` (src/lib/events/events.functions.ts, Z. 287–313) berechnet `today = businessDateOf(new Date())`, filtert `events` im ±1-Tag-Fenster und gibt `eventNotices(rows, today)` zurück; Rollen-Gate: nur `admin`/`manager`/`planer`.
- `kasse.tsx` konsumiert genau eine Query (`["events","notices-today"]`) und rendert `<EventNoticesBlock notices={…} />`.
- `EventNoticesBlock` rendert `null` bei leerer Liste und nutzt `ImpactBadge` je Zeile.
- Amtliche Quelle geprüft: km.bayern.de / BayMBl. 2022 Nr. 747 (Ferienordnung 2024/2025–2029/2030) — alle Zeiträume bis 2029/2030 sind veröffentlicht.

Den Liefer-SHA melde ich vor dem ersten Edit.

### Schritt 1 — `src/lib/time/school-holidays.ts` (neu, reines Modul)
- Typen und Signaturen exakt wie beauftragt (`SchoolHolidayPeriod`, `schoolHolidays(year, region?)`, `schoolHolidayOn(dateISO, region?)`), Region heute nur `"BY"`, andere Werte ⇒ leer/`null`.
- Datenbasis: schuljahrweise Konstanten, Quellvermerk je Schuljahr (BayMBl. 2022 Nr. 747, veröffentlicht 21.12.2022), erfasst 2024/2025 bis 2029/2030 mit Sommer-, Allerheiligen-, Weihnachts-, Frühjahrs-, Oster- und Pfingstferien (Grenzen inklusive, exakt die amtlichen Tabellenwerte).
- `schoolHolidays(year)` liefert alle Zeiträume, die das Kalenderjahr `year` berühren (Weihnachtsferien laufen über den Jahreswechsel). Keine Extrapolation: ab 2030 fehlen Daten, `schoolHolidayOn` ⇒ `null`.
- Buß- und Bettag (Mittwoch vor dem 23. November) wird als eigener, einTägiger Zeitraum „Buß- und Bettag (unterrichtsfrei)" geführt, weil das KM ihn in Bayern als unterrichtsfreien Tag ausweist; er steht in der Ferienordnung nicht in der Tabelle, deshalb kommentiere ich Herleitung und Quelle offen an der Konstante. Wenn du diesen Tag nicht möchtest, sag es — dann bleibt er raus.
- `bavarianHolidayMap` und alle SFN-/Lohnpfade werden nicht angefasst; keine Kreuzimporte.

Tests (`school-holidays.test.ts`): erster Sommerferientag und letzter Weihnachtsferientag je erfasstem Schuljahr, Mitte der Sommerferien, Tag nach Ferienende, Grenztage (from/to) inklusive, nicht erfasstes Jahr ⇒ `null`, unbekannte Region ⇒ `null`.

### Schritt 2 — Ferien-Notices (reine Logik)
Neues Schwestermodul `src/lib/events/school-holiday-notices.ts` (hält `event-notices.ts` frei von der Feiertags-/Ferien-Domäne, nutzt aber dessen `shiftIsoDay`):
- `schoolHolidayNotices(todayISO, region?)` ⇒ `{ kind: "holiday_running"; name; dayIndex; dayCount }` bzw. `{ kind: "holiday_tomorrow"; name }`.
- Regeln wie EV1-R2: läuft der Zeitraum heute ⇒ nur `running` mit Tag x/y (auch am ersten Tag); sonst Beginn morgen ⇒ `tomorrow`. Kalendertag wird injiziert, kein `new Date()` im Kern.

Tests: Vortag, Tag 1 (nur running), Mitte, letzter Tag, Tag danach, Jahr ohne Daten.

### Schritt 3 — Anzeige und Server
- `listEventNoticesForToday` gibt künftig ein Objekt `{ events: EventNotice[]; schoolHolidays: SchoolHolidayNotice[] }` zurück (ein Roundtrip, gleiche Rollenlogik, gleicher `businessDateOf`-Tag).
- `EventNoticesBlock` bekommt zusätzlich `schoolHolidays` und rendert deren Zeilen NACH den Event-Zeilen: Text „Sommerferien — Tag 12/44" bzw. „Morgen beginnen die Sommerferien", dazu ein eigener dezenter `FERIEN`-Badge (Slate-Ton über Design-Tokens, keine Impact-Farbe).
- `null` nur noch, wenn beide Listen leer sind — die blaue Karte erscheint also auch bei ausschließlich Ferien-Hinweisen.
- `kasse.tsx`: gleiche Query, neue Props durchgereicht.

### Nicht angefasst
`bavarianHolidayMap`/SFN/Lohn, Statistik-PDF-`dayBands`, `events`-Tabelle und -Import, Wetter-Widget, Dienstplan, `pap-2026/**`.

### Erfolgs-Gate
`tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .` (nach `--write`), `vitest run` — alle grün, eine Runde = ein Commit.

Hinweis zur Sichtprüfung: Heute ist der 02.08.2026, die Sommerferien 2026 beginnen amtlich am 03.08.2026. Die Kasse zeigt nach der Lieferung deshalb korrekt „Morgen beginnen die Sommerferien"; „Sommerferien — Tag 1/43" erscheint ab morgen.
