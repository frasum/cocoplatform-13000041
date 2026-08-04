// WX3-b — Reine Aufbereitung der Wetterzeile für die TRMNL-Planungstafel.
// Kein Netz, keine Supabase-Zugriffe, keine React-Abhängigkeit: der Endpoint
// rendert nur HTML, deshalb ausschließlich Text (Lucide-Icons stehen dort
// nicht zur Verfügung — der icon-Name aus weatherSymbol wird ignoriert).
//
// Fehlende Vorhersage ist LAUTE LEERE („—"), niemals ein 0-Fake.

import { weatherSymbol } from "@/lib/weather/weather-symbol";

export type PtWeatherCell = {
  date: string;
  /** Ganzzahlig gerundet; null ⇒ Anzeige „—". */
  tempMaxC: number | null;
  tempMinC: number | null;
  /** Kurzlabel aus weatherSymbol(code).label. */
  label: string;
  /** Auf 1 Nachkommastelle; null oder 0 ⇒ keine Regenangabe. */
  rainMm: number | null;
};

export type PtWeatherRow = {
  business_date: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
};

function roundOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/** Regen: <= 0 ⇒ null (keine „0 mm"-Zeile), sonst eine Nachkommastelle. */
function rainOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10) / 10;
}

export function buildWeatherRow(
  days: readonly string[],
  rows: readonly PtWeatherRow[],
): PtWeatherCell[] {
  const byDate = new Map<string, PtWeatherRow>();
  for (const r of rows) byDate.set(r.business_date, r);

  return days.map((date) => {
    const r = byDate.get(date);
    if (!r) {
      return { date, tempMaxC: null, tempMinC: null, label: "—", rainMm: null };
    }
    return {
      date,
      tempMaxC: roundOrNull(r.temp_max_c),
      tempMinC: roundOrNull(r.temp_min_c),
      label: weatherSymbol(r.weather_code).label,
      rainMm: rainOrNull(r.precipitation_mm),
    };
  });
}
