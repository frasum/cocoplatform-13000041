## Bestandsmeldung

Anker: `e9ca6641f` ("Backfill-Grenzen & UI gehärtet", origin/main nach WX1-b).

**§104-Klärung (blockierend für den planer-Teil):** Die Rolle `planer` kann `/admin/kasse` **nicht** erreichen. Der Routen-Guard in `src/routes/_authenticated/admin/route.tsx` leitet planer auf alles außer `/admin/dienstplan`, `/admin/urlaub`, `/admin/zeit-uebersicht` nach `/admin/dienstplan` um; die planer-Navigation zeigt die Tagesabrechnung auch nicht an. Ich bohre den Routen-Zugriff **nicht** eigenmächtig auf.

Vorschlag: Rollenlogik in Server-Function und UI-Gate wie beauftragt auf `admin/manager/planer` erweitern (wirkungslos, aber vorbereitet); der Routen-Guard bleibt unverändert, bis du entscheidest (Nur-Lese-Zugang zur Kasse vs. Info erst mit der PG-Prognoseansicht).

## Schritt 1 — Mini-Migration `weather_code`

- Migrationsdatei via Migrations-Tool: `ALTER TABLE public.weather_days ADD COLUMN IF NOT EXISTS weather_code smallint;` (nullable, WMO-Code). Ausführung durch dich.
- `weather-core.ts`: `weather_code` in `DAILY_FIELDS` (wirkt auf beide URL-Builder), in `OpenMeteoDaily`, in `WeatherDayRow` (`weatherCode: number | null`) und in `mapOpenMeteoDaily` (ganzzahlig oder null; ein Tag gilt weiter nur als leer, wenn auch die Messwerte fehlen).
- `weather.functions.ts`: `insertPayload` schreibt `weather_code`. `mayOverwrite`, Sync-/Backfill-Fensterlogik unverändert — ein erneuter Backfill füllt die Spalte rückwirkend.

## Schritt 2 — WMO-Symbol-Mapping (rein, getestet)

Neue Datei `src/lib/weather/weather-symbol.ts`:
`weatherSymbol(code: number | null): { icon: LucideIconName; label: string }`
Gruppen: 0–1 klar (Sun) · 2 heiter (CloudSun) · 3 bedeckt (Cloud) · 45/48 Nebel (CloudFog) · 51–67 Regen (CloudDrizzle/CloudRain, leicht/mäßig) · 71–77/85–86 Schnee (CloudSnow) · 80–82 Schauer (CloudRainWind) · 95–99 Gewitter (CloudLightning) · null/unbekannt ⇒ `HelpCircle`, Label „—".
Tests je Gruppe + null in `weather-symbol.test.ts`.

## Schritt 3 — Lese-Function `listWeatherRange`

In `weather.functions.ts`: `listWeatherRange({ from, to })`, GET, `requireSupabaseAuth`, `loadAdminCaller(..., ["admin","manager","planer","staff","payroll"])` mit anschließendem Rollenfilter → nur admin/manager/planer erhalten Zeilen, sonst leere Liste (Muster von `listEventNoticesForToday`). Zod: zwei ISO-Daten, `from <= to`. Liest `business_date, temp_max_c, temp_min_c, precipitation_mm, weather_code, source` der Organisation.

## Schritt 4 — Kassen-Kopfzeile

- `listEventNoticesForToday`: Rollenfilter um `planer` erweitern (staff bleibt leer).
- `kasse.tsx`: `noticesEnabled` → `headerCardsEnabled` (admin/manager/planer). Statt der Vollbreiten-`EventNoticesBlock` eine zweispaltige Zeile (`grid gap-3 md:grid-cols-2`, mobil gestapelt), weiter nur bei bestehender Session. Ohne Notices entfällt die Event-Karte und das Wetter nimmt die volle Breite.
- `EventNoticesBlock` kompakter + blau getönt: Hintergrund-Tint über bestehende Design-Tokens (`bg-primary/8`-Äquivalent aus `styles.css`, Rand eine Stufe kräftiger), engere Paddings/kleinere Schrift ⇒ ca. halbe Höhe. Inhalt unverändert (Name, Impact-Badge, „(Termin vorläufig)").
- Neue `src/components/cash/WeatherWidget.tsx`: vier Mini-Spalten „Heute" + drei Wochentagskürzel; je Spalte Symbol, „28°/17°", Regen-mm nur bei > 0 („2,4 mm"); fehlender Tag ⇒ „—" mit Tooltip „kein Sync-Datenstand"; Fußzeile klein „Open-Meteo".

Keine Änderung an Kassen-Rechenlogik, Finalize, Dienstplan, `eventNotices`, `mayOverwrite`, events-Schema, Statistik-PDF.

## Erfolgs-Gate

`tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` grün; `prettier --write` vor dem Commit; eine Runde = ein Commit.
