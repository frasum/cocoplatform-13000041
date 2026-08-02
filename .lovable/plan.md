## EV1-R4 — Notices folgen dem gewählten Geschäftstag

### Befund (belegt)
- `listEventNoticesForToday` (src/lib/events/events.functions.ts:292 ff.) berechnet `const today = businessDateOf(new Date())` und nimmt keinen Parameter — die Karte zeigt also immer die Heute-Sicht.
- `kasse.tsx` ruft sie ohne Argument, Query-Key `["events","notices-today"]` ohne Datum (Zeile 211-215), während `weatherQ` (Zeile 217-222) das Seiten-`businessDate` nutzt. Genau die gemeldete Diskrepanz.
- `WeatherWidget` labelt Spalte 0 hart mit „Heute" (Zeile 89).

### Änderungen

**1. Server — `src/lib/events/events.functions.ts`**
- Umbenennen auf `listEventNotices` (alter Name lügt), Methode bleibt GET, Rollen-Gate (`admin/manager/staff/payroll/planer` laden, Inhalte nur admin/manager/planer) unverändert.
- Neuer `inputValidator`: `z.object({ businessDate: isoDate.optional() }).optional()` → `const today = data?.businessDate ?? businessDateOf(new Date())`. Fenster (`shiftIsoDay(today, ±1)`), `eventNotices(rows, today)` und `schoolHolidayNotices(today)` rechnen mit diesem Tag.
- Kernlogik in `event-notices.ts` / `school-holiday-notices.ts` bleibt unangetastet.

**2. `src/routes/_authenticated/admin/kasse.tsx`**
- Import/`useServerFn` auf `listEventNotices`; Aufruf `fetchEventNotices({ data: { businessDate } })`; Query-Key `["events", "notices", businessDate]`.
- Kein weiterer Aufrufer vorhanden (wird vor dem Commit per Suche bestätigt).

**3. `WeatherWidget` — Label Spalte 1**
- Kleine pure Helferfunktion (in `src/lib/weather/weather-core.ts` oder neben dem Widget): `firstColumnLabel(selectedIso, actualTodayIso)` → `"Heute"` nur bei Gleichheit, sonst Wochentagskürzel.
- Widget erhält den echten aktuellen Geschäftstag (`defaultCashBusinessDate(new Date())`) als Prop `actualToday` von `kasse.tsx`; Datenpfad und Layout unverändert.

**4. Tests**
- Notices-Durchreichung (Unit auf der Kombination, ohne DB): gewählter Tag `2026-08-01` ⇒ keine Ferien-Zeile; `2026-08-02` ⇒ `holiday_tomorrow` (Sommerferien ab 2026-08-03); `2026-08-03` ⇒ `holiday_running` 1/43.
- Neue Label-Helferlogik: gewählt = heute ⇒ „Heute"; gewählt = Vortag (2026-08-01, Samstag) ⇒ „Sa".

### Gates
tsc, eslint, prettier --write, vitest — eine Runde, ein Commit. `pap-2026/**`, `noticesTone`, Wetter-Datenpfad und Rollen-Gates bleiben unberührt.
