## Bestand

Basis `af16af5b2` auf origin/main (Stand nach STAT3l + Veranstaltungs-Export). `src/lib/weather/` existiert noch nicht, es gibt keine Wetter-Tabelle. Admin-Server-Functions folgen durchgehend dem Muster `requireSupabaseAuth` + `loadAdminCaller(...)` + `makeAuditWriter`, `supabaseAdmin` wird erst im Handler geladen. Die Einstellungen-Tabs sind in `einstellungen.index.tsx` als `SUB_TABS` single-sourced (Nav in `admin/route.tsx` leitet sich daraus ab).

## Schritt 1 — Migration (Ausführung Bauherr)

Neue Migration mit `public.weather_days` exakt nach Skizze: `organization_id` → `organizations(id)`, `business_date`, `temp_max_c/temp_min_c numeric(4,1)`, `precipitation_mm numeric(5,1)`, `sunshine_hours numeric(4,1)`, `source text CHECK IN ('forecast','archive')`, `fetched_at`, `UNIQUE (organization_id, business_date)`. Kommentar begründet `numeric` (Messwerte, keine Geldgrößen).

Reihenfolge wie im Projekt üblich: CREATE TABLE → GRANTs → RLS enable → Policies (Drops vor Creates).
- `GRANT SELECT ON public.weather_days TO authenticated;` `GRANT ALL ... TO service_role;` kein `anon`.
- Policy: SELECT für `authenticated` mit `organization_id = public.current_organization_id()`.
- Kein INSERT/UPDATE/DELETE für `authenticated` (DENY-ALL beim Schreiben) — Schreiben ausschließlich über die Server-Functions mit Service-Role.

## Schritt 2 — `src/lib/weather/`

- `weather-core.ts` (rein, getestet):
  - `WEATHER_COORDS = { lat: 48.137, lon: 11.575 }` mit Kommentar „SaaS-Erweiterungspunkt, analog holiday_region".
  - `mapOpenMeteoDaily(json, source)` → Zeilen `{ businessDate, tempMaxC, tempMinC, precipitationMm, sunshineHours, source }`. `sunshine_duration` (Sekunden) → Stunden, 1 Nachkommastelle. `null` bleibt `null` (kein 0-Fake). Tage ohne jeden Messwert werden übersprungen (Archive-Nachhinken).
  - `mayOverwrite(existing, incoming)`: `archive` überschreibt `forecast` und `archive`; `forecast` überschreibt nur `forecast`, nie `archive`.
  - URL-Builder für Forecast- und Archive-Endpoint (Datumsfenster, `timezone=Europe/Berlin`).
- `weather-core.test.ts`: Fixture-JSON (Forecast + Archive, inkl. `null`-Werten und Sekunden-Umrechnung), alle vier `mayOverwrite`-Kombinationen, Bereichsvalidierung.
- `weather.functions.ts` (dünner Wrapper: nur Imports, Zod, Deklarationen):
  - `syncWeather` (admin): Forecast heute…+16 Tage, Archive letzte 10 Tage; vorhandene Zeilen des Fensters lesen, `mayOverwrite` anwenden, Upsert auf `(organization_id, business_date)`; Rückgabe `{ forecastWritten, archiveWritten, skipped }`.
  - `backfillWeather({ from, to })` (admin): Zod-Validierung `from <= to`, `to <= heute` (Geschäftstag-Logik via `businessDateOf`), Archive-Abruf, `source: 'archive'`, Batch-Upsert; Rückgabe `{ written, skipped }`.
  - `getWeatherStatus` (admin, read): `{ dayCount, oldest, newest, forecastCount }`.
  - Reines `fetch` (kein SDK), Worker-tauglich; `supabaseAdmin` per `await import(...)` im Handler; Audit-Eintrag über `makeAuditWriter`.

## Schritt 3 — Verwaltungs-UI

Neuer Sub-Tab `{ key: "wetter", label: "Wetterdaten", adminOnly: true }` in `SUB_TABS` (Nav zieht automatisch nach) mit Karte `src/components/settings/WetterSection.tsx`:
- Statuszeile: Anzahl Tage, ältester/neuester Tag, davon Forecast.
- Knopf „Jetzt synchronisieren" → `syncWeather`, Ergebnis als Toast.
- Backfill-Dialog Von/Bis, vorbelegt `2026-02-16` … gestern, Ergebnis-Meldung.
- Kein Chart, keine Auswertung. Kommentar hält den Merkposten „täglicher Cron-Sync = späterer Baustein".

## Nicht angefasst

PG-/Statistik-/Kassen-Module, `events`, Dienstplan, `pap-2026/**`. Keine Prognoselogik.

## Gates

`prettier --write` vor Commit, dann `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` — alle vier grün auf dem Liefer-SHA. Eine Runde = ein Commit. Migration führt der Bauherr aus, danach Backfill (2026-02-16..gestern) + einmal Sync.
