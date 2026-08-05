// WX3-a — Prüfungen des Sync-Kerns. Kein Netz, keine Datenbank: fetchDaily und
// upsertRows werden eingespritzt.

import { describe, expect, it } from "vitest";
import {
  runWeatherSyncForOrg,
  runWeatherSyncForOrgs,
  needsForecastRefresh,
  type WeatherSyncDeps,
} from "./weather-sync.server";
import type { OpenMeteoDaily, WeatherDayRow } from "./weather-core";

function daily(dates: readonly string[]): OpenMeteoDaily {
  return {
    daily: {
      time: [...dates],
      temperature_2m_max: dates.map(() => 20),
      temperature_2m_min: dates.map(() => 10),
      precipitation_sum: dates.map(() => 0),
      sunshine_duration: dates.map(() => 3600),
      weather_code: dates.map(() => 1),
    },
  };
}

function makeDeps(counts: {
  archive: { written: number; skipped: number };
  forecast: { written: number; skipped: number };
}): { deps: WeatherSyncDeps; order: string[] } {
  const order: string[] = [];
  const deps: WeatherSyncDeps = {
    today: () => "2026-08-05",
    fetchDaily: async (url) =>
      url.includes("archive") ? daily(["2026-08-04"]) : daily(["2026-08-05", "2026-08-06"]),
    upsertRows: async (_org: string, rows: readonly WeatherDayRow[]) => {
      const source = rows[0]?.source ?? "forecast";
      order.push(source);
      return source === "archive" ? counts.archive : counts.forecast;
    },
  };
  return { deps, order };
}

describe("runWeatherSyncForOrg", () => {
  it("schreibt das Archiv VOR dem Forecast", async () => {
    const { deps, order } = makeDeps({
      archive: { written: 1, skipped: 0 },
      forecast: { written: 2, skipped: 0 },
    });
    await runWeatherSyncForOrg("org-1", deps);
    expect(order).toEqual(["archive", "forecast"]);
  });

  it("gibt die drei Zähler unverändert durch", async () => {
    const { deps } = makeDeps({
      archive: { written: 3, skipped: 1 },
      forecast: { written: 5, skipped: 2 },
    });
    await expect(runWeatherSyncForOrg("org-1", deps)).resolves.toEqual({
      archiveWritten: 3,
      forecastWritten: 5,
      skipped: 3,
    });
  });
});

describe("runWeatherSyncForOrgs", () => {
  it("ein Org-Fehler bricht die Schleife nicht ab", async () => {
    const seen: string[] = [];
    const seen: string[] = [];
    const results = await runWeatherSyncForOrgs(["a", "b", "c"], async (id) => {
      seen.push(id);
      if (id === "b") throw new Error("Open-Meteo antwortete mit HTTP 429.");
      return { forecastWritten: 1, archiveWritten: 1, skipped: 0 };
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(results).toEqual([
      { organizationId: "a", forecastWritten: 1, archiveWritten: 1, skipped: 0 },
      { organizationId: "b", error: "Open-Meteo antwortete mit HTTP 429." },
      { organizationId: "c", forecastWritten: 1, archiveWritten: 1, skipped: 0 },
    ]);
  });
});
