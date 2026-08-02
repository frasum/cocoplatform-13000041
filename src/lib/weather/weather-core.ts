// WX1 — Reine Wetter-Logik (Open-Meteo). Keine IO, keine Supabase-Zugriffe:
// alles hier ist testbar ohne Netz. Die Server-Functions in
// weather.functions.ts holen die JSON-Antworten und wenden diese Mapper an.
//
// Zweck dieser Runde: Daten SAMMELN. Keine Auswertung, kein Chart, keine
// Prognose-Logik (das ist PG1/PG2).

/**
 * München Zentrum. SaaS-Erweiterungspunkt: analog holiday_region wird das
 * später je Organisation konfigurierbar (Spalte in organization_settings);
 * heute bewusst eine Konstante, weil beide Häuser im selben Wetter stehen.
 */
export const WEATHER_COORDS = { lat: 48.137, lon: 11.575 } as const;

export const WEATHER_TIMEZONE = "Europe/Berlin";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const DAILY_FIELDS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "sunshine_duration",
] as const;

export type WeatherSource = "forecast" | "archive";

export type WeatherDayRow = {
  businessDate: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationMm: number | null;
  sunshineHours: number | null;
  source: WeatherSource;
};

export type OpenMeteoDaily = {
  daily?: {
    time?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    precipitation_sum?: unknown;
    sunshine_duration?: unknown;
  };
};

function buildUrl(base: string, from: string, to: string): string {
  const params = new URLSearchParams({
    latitude: String(WEATHER_COORDS.lat),
    longitude: String(WEATHER_COORDS.lon),
    daily: DAILY_FIELDS.join(","),
    timezone: WEATHER_TIMEZONE,
    start_date: from,
    end_date: to,
  });
  return `${base}?${params.toString()}`;
}

export function forecastUrl(from: string, to: string): string {
  return buildUrl(FORECAST_URL, from, to);
}

export function archiveUrl(from: string, to: string): string {
  return buildUrl(ARCHIVE_URL, from, to);
}

/** Messwert oder null — Strings/undefined/NaN werden zu null (kein 0-Fake). */
function numOrNull(value: unknown, decimals: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** sunshine_duration liefert SEKUNDEN → Stunden mit einer Nachkommastelle. */
export function sunshineSecondsToHours(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round((value / 3600) * 10) / 10;
}

function at(arr: unknown, i: number): unknown {
  return Array.isArray(arr) ? arr[i] : undefined;
}

/**
 * Open-Meteo-Antwort → weather_days-Zeilen.
 *
 * Fehlende Werte (null) bleiben null — 0 mm Regen ist eine Aussage, null ist
 * keine. Tage ohne JEDEN Messwert werden übersprungen: die Archive-API hinkt
 * einige Tage nach und liefert für die jüngsten Tage leere Zeilen.
 */
export function mapOpenMeteoDaily(json: OpenMeteoDaily, source: WeatherSource): WeatherDayRow[] {
  const times = json.daily?.time;
  if (!Array.isArray(times)) return [];
  const rows: WeatherDayRow[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const date = times[i];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const row: WeatherDayRow = {
      businessDate: date,
      tempMaxC: numOrNull(at(json.daily?.temperature_2m_max, i), 1),
      tempMinC: numOrNull(at(json.daily?.temperature_2m_min, i), 1),
      precipitationMm: numOrNull(at(json.daily?.precipitation_sum, i), 1),
      sunshineHours: sunshineSecondsToHours(at(json.daily?.sunshine_duration, i)),
      source,
    };
    const empty =
      row.tempMaxC === null &&
      row.tempMinC === null &&
      row.precipitationMm === null &&
      row.sunshineHours === null;
    if (empty) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * Überschreib-Regel:
 *   archive  → überschreibt forecast UND archive (neuere Messung gewinnt)
 *   forecast → überschreibt NUR forecast, NIE archive
 * Kein Bestand (undefined/null) → immer schreiben.
 */
export function mayOverwrite(
  existing: WeatherSource | null | undefined,
  incoming: WeatherSource,
): boolean {
  if (!existing) return true;
  if (incoming === "archive") return true;
  return existing === "forecast";
}

export type DateRangeCheck = { ok: true } | { ok: false; message: string };

/** Bereichs-Validierung für backfillWeather: from <= to, to <= heute. */
export function validateRange(from: string, to: string, today: string): DateRangeCheck {
  if (from > to) return { ok: false, message: "Von-Datum darf nicht nach dem Bis-Datum liegen." };
  if (to > today) return { ok: false, message: "Bis-Datum darf nicht in der Zukunft liegen." };
  return { ok: true };
}

/** Verschiebt ein ISO-Datum um `days` Tage (UTC-Mittag vermeidet DST-Sprünge). */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const next = new Date(base + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Fenster-Konstanten dieser Runde (Kommentar in der Spec: 16 Tage / 10 Tage). */
export const FORECAST_DAYS_AHEAD = 16;
export const ARCHIVE_LOOKBACK_DAYS = 10;
