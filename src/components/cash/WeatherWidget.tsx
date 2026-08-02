// WX2 — Wetter-Widget der Tagesabrechnung: heute + sechs Folgetage (7 Spalten).
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
  Cloudy,
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
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => shiftIsoDate(today, offset));
  const byDate = new Map(rows.map((r) => [r.businessDate, r]));
  return (
    <Card className="h-full space-y-1 overflow-hidden rounded-l-none border-l-4 border-amber-200 border-l-amber-500 bg-amber-50/80 p-2.5 dark:border-amber-900 dark:border-l-amber-500 dark:bg-amber-950/30">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100">
          <Cloudy className="h-3 w-3" />
          Wetter
        </span>
        <span className="text-[10px] text-amber-900/60 dark:text-amber-100/60">Open-Meteo</span>
      </div>
      {/* 7 Spalten in halber Zeilenbreite: sehr enge Abstände; auf schmalen
          Viewports darf horizontal gescrollt werden statt abzuschneiden. */}
      <div className="-mx-0.5 flex gap-0 overflow-x-auto px-0.5">
        {days.map((iso, i) => {
          const row = byDate.get(iso);
          const sym = weatherSymbol(row?.weatherCode ?? null);
          const Icon = ICONS[sym.icon];
          const mm = row ? rain(row) : null;
          return (
            <div
              key={iso}
              className="flex min-w-[2.1rem] flex-1 shrink-0 flex-col items-center gap-0.5 text-center"
              title={row ? sym.label : "kein Sync-Datenstand"}
            >
              <span className="text-[9px] font-medium leading-tight text-amber-900/70 dark:text-amber-100/70">
                {i === 0 ? "Heute" : weekdayShort(iso)}
              </span>
              <Icon
                className="h-3.5 w-3.5 text-amber-900 dark:text-amber-100"
                aria-label={sym.label}
              />
              <span className="text-[10px] leading-tight text-amber-950 dark:text-amber-50">
                {row ? temps(row) : "—"}
              </span>
              {mm && (
                <span className="text-[9px] leading-tight text-amber-900/70 dark:text-amber-100/70">
                  {mm}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
