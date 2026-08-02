// WX1 — Server-Functions der Wetter-Erfassung (admin).
//
// Dünne Wrapper-Datei: Modul-Scope hält nur Imports, Zod-Schemata und die
// Server-Function-Deklarationen. Die reine Logik (Mapper, Überschreib-Regel,
// URL-Bau, Bereichsprüfung) lebt in weather-core.ts; `supabaseAdmin` wird
// erst im Handler geladen (Client-Bundle-Grenze).
//
// Cloudflare-tauglich: ausschließlich globales fetch, kein SDK.
// Automatischer täglicher Sync (Cron) ist NICHT Teil dieser Runde — Merkposten.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { makeAuditWriter } from "@/lib/admin/audit";
import { businessDateOf } from "@/lib/business-date";
import {
  ARCHIVE_LOOKBACK_DAYS,
  FORECAST_DAYS_AHEAD,
  archiveUrl,
  forecastUrl,
  mapOpenMeteoDaily,
  mayOverwrite,
  shiftIsoDate,
  validateRange,
  type OpenMeteoDaily,
  type WeatherDayRow,
  type WeatherSource,
} from "./weather-core";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format YYYY-MM-DD erwartet");

const backfillInput = z.object({ from: isoDate, to: isoDate });

type WeatherInsert = Database["public"]["Tables"]["weather_days"]["Insert"];

async function fetchDaily(url: string): Promise<OpenMeteoDaily> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Open-Meteo antwortete mit HTTP ${res.status}.`);
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
    source: row.source,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Upsert unter Beachtung von mayOverwrite. Liest die Bestands-Quellen des
 * Fensters EINMAL und entscheidet je Tag; Rückgabe: geschrieben / übersprungen.
 */
async function upsertRows(
  organizationId: string,
  rows: readonly WeatherDayRow[],
): Promise<{ written: number; skipped: number }> {
  if (rows.length === 0) return { written: 0, skipped: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dates = rows.map((r) => r.businessDate);
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("weather_days")
    .select("business_date, source")
    .eq("organization_id", organizationId)
    .in("business_date", dates);
  if (readErr) throw readErr;

  const bySource = new Map<string, WeatherSource>();
  for (const r of existing ?? []) {
    bySource.set(r.business_date, r.source === "archive" ? "archive" : "forecast");
  }

  const writable = rows.filter((r) => mayOverwrite(bySource.get(r.businessDate), r.source));
  const skipped = rows.length - writable.length;
  if (writable.length === 0) return { written: 0, skipped };

  const { error: upsertErr } = await supabaseAdmin.from("weather_days").upsert(
    writable.map((r) => insertPayload(organizationId, r)),
    { onConflict: "organization_id,business_date" },
  );
  if (upsertErr) throw upsertErr;
  return { written: writable.length, skipped };
}

export const getWeatherStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("weather_days")
      .select("business_date, source")
      .eq("organization_id", caller.organizationId)
      .order("business_date", { ascending: true });
    if (error) throw error;
    const rows = data ?? [];
    return {
      dayCount: rows.length,
      oldest: rows[0]?.business_date ?? null,
      newest: rows[rows.length - 1]?.business_date ?? null,
      forecastCount: rows.filter((r) => r.source === "forecast").length,
      today: businessDateOf(new Date()),
    };
  });

export const syncWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const today = businessDateOf(new Date());

    // Forecast: heute … +16 Tage.
    const forecastJson = await fetchDaily(
      forecastUrl(today, shiftIsoDate(today, FORECAST_DAYS_AHEAD)),
    );
    const forecastRows = mapOpenMeteoDaily(forecastJson, "forecast");

    // Archiv: die letzten 10 Tage. Die Archive-API hinkt einige Tage nach —
    // deshalb das Fenster; leere Tage filtert der Mapper heraus.
    const archiveJson = await fetchDaily(
      archiveUrl(shiftIsoDate(today, -ARCHIVE_LOOKBACK_DAYS), shiftIsoDate(today, -1)),
    );
    const archiveRows = mapOpenMeteoDaily(archiveJson, "archive");

    // Archiv zuerst: gemessene Werte dürfen Vorhersagen ersetzen.
    const archiveRes = await upsertRows(caller.organizationId, archiveRows);
    const forecastRes = await upsertRows(caller.organizationId, forecastRows);

    const result = {
      forecastWritten: forecastRes.written,
      archiveWritten: archiveRes.written,
      skipped: forecastRes.skipped + archiveRes.skipped,
    };
    await makeAuditWriter(caller)({
      action: "weather.sync",
      entity: "weather_days",
      meta: { ...result, today },
    });
    return result;
  });

export const backfillWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => backfillInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const today = businessDateOf(new Date());
    const check = validateRange(data.from, data.to, today);
    if (!check.ok) throw new Error(check.message);

    const json = await fetchDaily(archiveUrl(data.from, data.to));
    const rows = mapOpenMeteoDaily(json, "archive");
    const res = await upsertRows(caller.organizationId, rows);

    const result = { written: res.written, skipped: res.skipped, days: rows.length };
    await makeAuditWriter(caller)({
      action: "weather.backfill",
      entity: "weather_days",
      meta: { ...result, from: data.from, to: data.to },
    });
    return result;
  });
