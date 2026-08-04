// WX1 — Server-Functions der Wetter-Erfassung (admin).
//
// Dünne Wrapper-Datei: Modul-Scope hält nur Imports, Zod-Schemata und die
// Server-Function-Deklarationen. Die reine Logik (Mapper, Überschreib-Regel,
// URL-Bau, Bereichsprüfung) lebt in weather-core.ts; `supabaseAdmin` wird
// erst im Handler geladen (Client-Bundle-Grenze).
//
// Cloudflare-tauglich: ausschließlich globales fetch, kein SDK.
// WX3-a: Der Sync-Kern liegt in weather-sync.server.ts und wird von dieser
// Server-Function UND vom pg_cron-Endpoint /api/public/weather/sync genutzt.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { makeAuditWriter } from "@/lib/admin/audit";
import { businessDateOf } from "@/lib/business-date";
import { backfillInputSchema, validateRange } from "./weather-core";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format YYYY-MM-DD erwartet");

const rangeInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, { message: "Von-Datum darf nicht nach dem Bis-Datum liegen." });

export type WeatherRangeRow = {
  businessDate: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  source: string;
};

/**
 * WX2 — Lese-Function für die Kassen-Kopfzeile (heute + Folgetage).
 *
 * Rollenprüfung wie bei listEventNoticesForToday (Bauherren-Revision 02.08.):
 * admin, manager UND planer erhalten Inhalte; alle anderen eine leere Liste
 * statt eines Fehlers.
 */
export const listWeatherRange = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeInput.parse(input))
  .handler(async ({ data, context }): Promise<WeatherRangeRow[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "admin",
      "manager",
      "staff",
      "payroll",
      "planer",
    ]);
    if (caller.role !== "admin" && caller.role !== "manager" && caller.role !== "planer") return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("weather_days")
      .select("business_date, temp_max_c, temp_min_c, precipitation_mm, weather_code, source")
      .eq("organization_id", caller.organizationId)
      .gte("business_date", data.from)
      .lte("business_date", data.to)
      .order("business_date", { ascending: true });
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      businessDate: r.business_date,
      tempMaxC: r.temp_max_c,
      tempMinC: r.temp_min_c,
      precipitationMm: r.precipitation_mm,
      weatherCode: r.weather_code,
      source: r.source,
    }));
  });

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
    const { runWeatherSyncForOrg } = await import("./weather-sync.server");
    const result = await runWeatherSyncForOrg(caller.organizationId);
    await makeAuditWriter(caller)({
      action: "weather.sync",
      entity: "weather_days",
      meta: { ...result, today },
    });
    return result;
  });

export const backfillWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => backfillInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const today = businessDateOf(new Date());
    const check = validateRange(data.from, data.to, today);
    if (!check.ok) throw new Error(check.message);

    const { archiveUrl, mapOpenMeteoDaily } = await import("./weather-core");
    const { fetchDaily, upsertRows } = await import("./weather-sync.server");
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
