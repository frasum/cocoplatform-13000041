// WX2 — Wetter-Widget der Tagesabrechnung: heute + drei Folgetage.
// Reine Anzeige der in weather_days gesammelten Werte (Open-Meteo). Kein
// Fetch-Fallback, kein Raten: fehlt ein Tag, steht dort „—".

import { Card } from "@/components/ui/card";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  HelpCircle,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { weatherSymbol, type LucideIconName } from "@/lib/weather/weather-symbol";
import { shiftIsoDate } from "@/lib/weather/weather-core";
import type { WeatherRangeRow } from "@/lib/weather/weather.functions";

const ICONS: Record<LucideIconName, LucideIcon> = {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudRainWind,
  CloudLightning,
  HelpCircle,
};

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).getUTCDay();
  return WEEKDAYS[idx] ?? "—";
}

function temps(row: WeatherRangeRow): string {
  if (row.tempMaxC === null && row.tempMinC === null) return "—";
  const fmt = (v: number | null) => (v === null ? "—" : `${Math.round(v)}°`);
  return `${fmt(row.tempMaxC)}/${fmt(row.tempMinC)}`;
}

function rain(row: WeatherRangeRow): string | null {
  if (row.precipitationMm === null || row.precipitationMm <= 0) return null;
  return `${row.precipitationMm.toFixed(1).replace(".", ",")} mm`;
}

export function WeatherWidget({
  today,
  rows,
}: {
  today: string;
  rows: readonly WeatherRangeRow[];
}) {
  const days = [0, 1, 2, 3].map((offset) => shiftIsoDate(today, offset));
  const byDate = new Map(rows.map((r) => [r.businessDate, r]));
  return (
    <Card className="h-full space-y-1 p-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Wetter
        </span>
        <span className="text-[10px] text-muted-foreground">Open-Meteo</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {days.map((iso, i) => {
          const row = byDate.get(iso);
          const sym = weatherSymbol(row?.weatherCode ?? null);
          const Icon = ICONS[sym.icon];
          const mm = row ? rain(row) : null;
          return (
            <div
              key={iso}
              className="flex flex-col items-center gap-0.5 text-center"
              title={row ? sym.label : "kein Sync-Datenstand"}
            >
              <span className="text-[10px] font-medium text-muted-foreground">
                {i === 0 ? "Heute" : weekdayShort(iso)}
              </span>
              <Icon className="h-4 w-4 text-foreground" aria-label={sym.label} />
              <span className="text-xs leading-tight text-foreground">
                {row ? temps(row) : "—"}
              </span>
              {mm && <span className="text-[10px] leading-tight text-muted-foreground">{mm}</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
