// WX1 — Tests der reinen Wetter-Logik (Fixture-JSON, kein Netz).

import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LOOKBACK_DAYS,
  FORECAST_DAYS_AHEAD,
  WEATHER_BACKFILL_MIN,
  archiveUrl,
  backfillInputSchema,
  friendlyWeatherError,
  forecastUrl,
  mapOpenMeteoDaily,
  mayOverwrite,
  shiftIsoDate,
  sunshineSecondsToHours,
  validateRange,
} from "./weather-core";

describe("backfillInputSchema (WX1-b)", () => {
  it("lehnt ein Jahr aus dem nativen Datepicker-Tippfehler ab", () => {
    const res = backfillInputSchema.safeParse({ from: "0025-01-01", to: "2026-08-01" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain(WEATHER_BACKFILL_MIN);
    }
  });

  it("akzeptiert die Untergrenze 2000-01-01", () => {
    expect(backfillInputSchema.safeParse({ from: "2000-01-01", to: "2026-08-01" }).success).toBe(
      true,
    );
  });

  it("lehnt 1999-12-31 ab", () => {
    expect(backfillInputSchema.safeParse({ from: "1999-12-31", to: "2026-08-01" }).success).toBe(
      false,
    );
  });

  it("lehnt Nicht-ISO-Datumsformate ab", () => {
    expect(backfillInputSchema.safeParse({ from: "16.02.2026", to: "2026-08-01" }).success).toBe(
      false,
    );
  });
});

describe("friendlyWeatherError (WX1-b)", () => {
  it("übersetzt HTTP 400 in einen verständlichen Satz mit Detail", () => {
    const out = friendlyWeatherError("Open-Meteo antwortete mit HTTP 400. Grund: bad range");
    expect(out).toContain("Datumsbereich prüfen");
    expect(out).toContain("HTTP 400");
  });

  it("lässt Meldungen ohne HTTP-Status unverändert", () => {
    expect(friendlyWeatherError("fetch failed")).toBe("fetch failed");
  });
});

const FORECAST_FIXTURE = {
  daily: {
    time: ["2026-08-02", "2026-08-03", "2026-08-04"],
    temperature_2m_max: [28.44, 31.0, null],
    temperature_2m_min: [16.06, 18.2, null],
    precipitation_sum: [0, 4.25, null],
    // 8 h, 0 h, fehlend
    sunshine_duration: [28800, 0, null],
  },
};

const ARCHIVE_FIXTURE = {
  daily: {
    time: ["2026-07-28", "2026-07-29", "2026-07-30"],
    temperature_2m_max: [24.1, null, null],
    temperature_2m_min: [12.9, null, null],
    precipitation_sum: [1.24, null, null],
    sunshine_duration: [36000, null, null],
  },
};

describe("mapOpenMeteoDaily", () => {
  it("mappt Forecast-Tage inkl. Sekunden→Stunden und behält 0 als Aussage", () => {
    const rows = mapOpenMeteoDaily(FORECAST_FIXTURE, "forecast");
    expect(rows).toHaveLength(2); // dritter Tag ist komplett leer
    expect(rows[0]).toEqual({
      businessDate: "2026-08-02",
      tempMaxC: 28.4,
      tempMinC: 16.1,
      precipitationMm: 0,
      sunshineHours: 8,
      source: "forecast",
    });
    expect(rows[1]?.precipitationMm).toBe(4.3);
    expect(rows[1]?.sunshineHours).toBe(0);
  });

  it("überspringt nachhinkende Archiv-Tage ohne jeden Messwert", () => {
    const rows = mapOpenMeteoDaily(ARCHIVE_FIXTURE, "archive");
    expect(rows.map((r) => r.businessDate)).toEqual(["2026-07-28"]);
    expect(rows[0]?.source).toBe("archive");
    expect(rows[0]?.sunshineHours).toBe(10);
    expect(rows[0]?.precipitationMm).toBe(1.2);
  });

  it("gibt bei fehlendem daily-Block eine leere Liste zurück", () => {
    expect(mapOpenMeteoDaily({}, "archive")).toEqual([]);
    expect(mapOpenMeteoDaily({ daily: { time: "kaputt" } }, "archive")).toEqual([]);
  });

  it("macht aus fehlenden Einzelwerten null, nicht 0", () => {
    const rows = mapOpenMeteoDaily(
      {
        daily: {
          time: ["2026-08-02"],
          temperature_2m_max: [21.0],
          temperature_2m_min: [null],
          precipitation_sum: ["4.0"],
          sunshine_duration: [undefined],
        },
      },
      "forecast",
    );
    expect(rows[0]).toEqual({
      businessDate: "2026-08-02",
      tempMaxC: 21,
      tempMinC: null,
      precipitationMm: null,
      sunshineHours: null,
      source: "forecast",
    });
  });
});

describe("sunshineSecondsToHours", () => {
  it("rundet auf eine Nachkommastelle", () => {
    expect(sunshineSecondsToHours(3600)).toBe(1);
    expect(sunshineSecondsToHours(5400)).toBe(1.5);
    expect(sunshineSecondsToHours(4000)).toBe(1.1);
    expect(sunshineSecondsToHours(null)).toBeNull();
  });
});

describe("mayOverwrite — alle vier Kombinationen", () => {
  it("archive über forecast: ja", () => {
    expect(mayOverwrite("forecast", "archive")).toBe(true);
  });
  it("archive über archive: ja (neuere Messung gewinnt)", () => {
    expect(mayOverwrite("archive", "archive")).toBe(true);
  });
  it("forecast über forecast: ja", () => {
    expect(mayOverwrite("forecast", "forecast")).toBe(true);
  });
  it("forecast über archive: NEIN", () => {
    expect(mayOverwrite("archive", "forecast")).toBe(false);
  });
  it("kein Bestand: immer schreiben", () => {
    expect(mayOverwrite(null, "forecast")).toBe(true);
    expect(mayOverwrite(undefined, "archive")).toBe(true);
  });
});

describe("validateRange", () => {
  it("akzeptiert einen gültigen Bereich", () => {
    expect(validateRange("2026-02-16", "2026-08-01", "2026-08-02")).toEqual({ ok: true });
  });
  it("lehnt from > to ab", () => {
    expect(validateRange("2026-08-02", "2026-08-01", "2026-08-02").ok).toBe(false);
  });
  it("lehnt Zukunft ab", () => {
    expect(validateRange("2026-08-01", "2026-08-03", "2026-08-02").ok).toBe(false);
  });
});

describe("shiftIsoDate", () => {
  it("verschiebt über Monats- und DST-Grenzen korrekt", () => {
    expect(shiftIsoDate("2026-08-02", -1)).toBe("2026-08-01");
    expect(shiftIsoDate("2026-08-02", FORECAST_DAYS_AHEAD)).toBe("2026-08-17");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2026-03-30", -ARCHIVE_LOOKBACK_DAYS)).toBe("2026-03-20");
  });
});

describe("URL-Builder", () => {
  it("baut Forecast- und Archive-URLs mit Fenster und Zeitzone", () => {
    const f = forecastUrl("2026-08-02", "2026-08-18");
    expect(f).toContain("api.open-meteo.com/v1/forecast");
    expect(f).toContain("start_date=2026-08-02");
    expect(f).toContain("end_date=2026-08-18");
    expect(f).toContain("timezone=Europe%2FBerlin");
    expect(f).toContain("sunshine_duration");
    expect(archiveUrl("2026-02-16", "2026-08-01")).toContain(
      "archive-api.open-meteo.com/v1/archive",
    );
  });
});
