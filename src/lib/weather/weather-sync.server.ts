// WX3-a: Der Sync-Kern, den BEIDE Wege nutzen — die Admin-Server-Function
// (Knopf in WetterSection) und der pg_cron-Endpoint
// /api/public/weather/sync. Keine zweite Implementierung.
//
// Bewusst *.server.ts: lädt supabaseAdmin und darf darum nie ins
// Client-Bundle geraten (siehe tanstack-supabase-import-graph).

import type { Database } from "@/integrations/supabase/types";
import { businessDateOf } from "@/lib/business-date";
import {
  ARCHIVE_LOOKBACK_DAYS,
  FORECAST_DAYS_AHEAD,
  archiveUrl,
  forecastUrl,
  mapOpenMeteoDaily,
  mayOverwrite,
  shiftIsoDate,
  type OpenMeteoDaily,
  type WeatherDayRow,
  type WeatherSource,
} from "./weather-core";

type WeatherInsert = Database["public"]["Tables"]["weather_days"]["Insert"];

export type WeatherSyncResult = {
  forecastWritten: number;
  archiveWritten: number;
  skipped: number;
};

export async function fetchDaily(url: string): Promise<OpenMeteoDaily> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    // Open-Meteo liefert den Grund im Body ("reason") — ohne ihn ist ein 400
    // nicht diagnostizierbar (z. B. end_date außerhalb des erlaubten Fensters).
    const body = await res.text().catch(() => "");
    let reason = "";
    try {
      const parsed = JSON.parse(body) as { reason?: unknown };
      if (typeof parsed.reason === "string") reason = parsed.reason;
    } catch {
      reason = body.slice(0, 200);
    }
    throw new Error(
      `Open-Meteo antwortete mit HTTP ${res.status}.${reason ? ` Grund: ${reason}` : ""}`,
    );
  }
  return (await res.json()) as OpenMeteoDaily;
}

function insertPayload(organizationId: string, row: WeatherDayRow): WeatherInsert {
  return {
    organization_id: organizationId,
    business_date: row.businessDate,
    temp_max_c: row.tempMaxC,
    temp_min_c: row.tempMinC,
    precipitation_mm: row.precipitationMm,
    sunshine_hours: row.sunshineHours,
    weather_code: row.weatherCode,
    source: row.source,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Blockgröße für Lesen/Upsert. Ein einzelner `.in(...)`-Filter über mehrere
 * Jahre sprengt die PostgREST-Header-Grenze (~16 kB URL) — daher stückeln.
 */
const CHUNK_SIZE = 120;

/**
 * Upsert unter Beachtung von mayOverwrite. Liest die Bestands-Quellen des
 * Fensters EINMAL und entscheidet je Tag; Rückgabe: geschrieben / übersprungen.
 */
export async function upsertRows(
  organizationId: string,
  rows: readonly WeatherDayRow[],
): Promise<{ written: number; skipped: number }> {
  if (rows.length === 0) return { written: 0, skipped: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bySource = new Map<string, WeatherSource>();
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const dates = rows.slice(i, i + CHUNK_SIZE).map((r) => r.businessDate);
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("weather_days")
      .select("business_date, source")
      .eq("organization_id", organizationId)
      .in("business_date", dates);
    if (readErr) throw readErr;
    for (const r of existing ?? []) {
      bySource.set(r.business_date, r.source === "archive" ? "archive" : "forecast");
    }
  }

  const writable = rows.filter((r) => mayOverwrite(bySource.get(r.businessDate), r.source));
  const skipped = rows.length - writable.length;
  if (writable.length === 0) return { written: 0, skipped };

  for (let i = 0; i < writable.length; i += CHUNK_SIZE) {
    const { error: upsertErr } = await supabaseAdmin.from("weather_days").upsert(
      writable.slice(i, i + CHUNK_SIZE).map((r) => insertPayload(organizationId, r)),
      { onConflict: "organization_id,business_date" },
    );
    if (upsertErr) throw upsertErr;
  }
  return { written: writable.length, skipped };
}

/**
 * Einspritzbare Abhängigkeiten — ausschließlich für Tests. Produktion nutzt
 * die Standardwerte (echtes fetch, echter Upsert).
 */
export type WeatherSyncDeps = {
  fetchDaily: (url: string) => Promise<OpenMeteoDaily>;
  upsertRows: (
    organizationId: string,
    rows: readonly WeatherDayRow[],
  ) => Promise<{ written: number; skipped: number }>;
  today: () => string;
};

const defaultDeps: WeatherSyncDeps = {
  fetchDaily,
  upsertRows,
  today: () => businessDateOf(new Date()),
};

/**
 * Wortgleiche Logik des früheren syncWeather-Handlers: Forecast heute …
 * heute+FORECAST_DAYS_AHEAD, Archiv heute−ARCHIVE_LOOKBACK_DAYS … gestern.
 * Archiv wird ZUERST geschrieben (gemessene Werte dürfen Vorhersagen
 * ersetzen), danach der Forecast.
 */
export async function runWeatherSyncForOrg(
  organizationId: string,
  deps: WeatherSyncDeps = defaultDeps,
): Promise<WeatherSyncResult> {
  const today = deps.today();

  // Forecast: heute … +16 Tage.
  const forecastJson = await deps.fetchDaily(
    forecastUrl(today, shiftIsoDate(today, FORECAST_DAYS_AHEAD)),
  );
  const forecastRows = mapOpenMeteoDaily(forecastJson, "forecast");

  // Archiv: die letzten 10 Tage. Die Archive-API hinkt einige Tage nach —
  // deshalb das Fenster; leere Tage filtert der Mapper heraus.
  const archiveJson = await deps.fetchDaily(
    archiveUrl(shiftIsoDate(today, -ARCHIVE_LOOKBACK_DAYS), shiftIsoDate(today, -1)),
  );
  const archiveRows = mapOpenMeteoDaily(archiveJson, "archive");

  // Archiv zuerst: gemessene Werte dürfen Vorhersagen ersetzen.
  const archiveRes = await deps.upsertRows(organizationId, archiveRows);
  const forecastRes = await deps.upsertRows(organizationId, forecastRows);

  return {
    forecastWritten: forecastRes.written,
    archiveWritten: archiveRes.written,
    skipped: forecastRes.skipped + archiveRes.skipped,
  };
}

/** Alle Organisationen — der Cron arbeitet serviceseitig ohne Caller. */
/**
 * WX3-c: Braucht die Tafel frische Vorhersagedaten?
 * Regel: höchstens EIN Abruf je Geschäftstag (3-Uhr-Grenze, KA1).
 */
export function needsForecastRefresh(
  lastForecastFetchedAt: string | null,
  todayBusinessDate: string,
): boolean {
  if (!lastForecastFetchedAt) return true;
  const parsed = new Date(lastForecastFetchedAt);
  if (Number.isNaN(parsed.getTime())) return true;
  return businessDateOf(parsed) < todayBusinessDate;
}

export async function listAllOrganizationIds(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("organizations").select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

export type WeatherSyncOrgResult =
  | ({ organizationId: string } & WeatherSyncResult)
  | { organizationId: string; error: string };

/**
 * Cron-Schleife: ein Fehler in einer Organisation bricht den Lauf NICHT ab —
 * er wird als Ergebniszeile gesammelt.
 */
export async function runWeatherSyncForOrgs(
  organizationIds: readonly string[],
  run: (organizationId: string) => Promise<WeatherSyncResult> = (id) => runWeatherSyncForOrg(id),
): Promise<WeatherSyncOrgResult[]> {
  const results: WeatherSyncOrgResult[] = [];
  for (const organizationId of organizationIds) {
    try {
      results.push({ organizationId, ...(await run(organizationId)) });
    } catch (e) {
      results.push({
        organizationId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
