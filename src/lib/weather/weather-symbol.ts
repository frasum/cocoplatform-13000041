// WX2 — WMO-Wettercode → Symbol + deutsches Kurzlabel. Reine Funktion:
// keine React-Abhängigkeit, nur der NAME des Lucide-Icons. Die Zuordnung
// Name → Komponente lebt in der Anzeige (WeatherWidget).
//
// Bewusst grob gruppiert (Gruppen des EV1-R3/WX2-Auftrags). Unbekannte oder
// fehlende Codes werden NICHT geraten: Fragezeichen-Icon und Label „—".

export type LucideIconName =
  | "Sun"
  | "CloudSun"
  | "Cloud"
  | "CloudFog"
  | "CloudDrizzle"
  | "CloudRain"
  | "CloudSnow"
  | "CloudRainWind"
  | "CloudLightning"
  | "HelpCircle";

export type WeatherSymbol = { icon: LucideIconName; label: string };

export function weatherSymbol(code: number | null): WeatherSymbol {
  if (code === null || !Number.isFinite(code)) return { icon: "HelpCircle", label: "—" };
  const c = Math.round(code);
  if (c === 0 || c === 1) return { icon: "Sun", label: "klar" };
  if (c === 2) return { icon: "CloudSun", label: "heiter" };
  if (c === 3) return { icon: "Cloud", label: "bedeckt" };
  if (c === 45 || c === 48) return { icon: "CloudFog", label: "Nebel" };
  if (c >= 51 && c <= 57) return { icon: "CloudDrizzle", label: "leichter Regen" };
  if (c >= 61 && c <= 67) return { icon: "CloudRain", label: "Regen" };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: "CloudSnow", label: "Schnee" };
  if (c >= 80 && c <= 82) return { icon: "CloudRainWind", label: "Schauer" };
  if (c >= 95 && c <= 99) return { icon: "CloudLightning", label: "Gewitter" };
  return { icon: "HelpCircle", label: "—" };
}
