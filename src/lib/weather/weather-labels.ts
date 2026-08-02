// EV1-R4 — Spaltenbeschriftungen des Wetter-Widgets (reine Logik).
// „Heute" nur, wenn der GEWÄHLTE Geschäftstag der echte aktuelle ist; sonst
// das Wochentagskürzel wie in den übrigen Spalten.

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

export function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).getUTCDay();
  return WEEKDAYS[idx] ?? "—";
}

export function firstColumnLabel(selectedIso: string, actualTodayIso: string): string {
  return selectedIso === actualTodayIso ? "Heute" : weekdayShort(selectedIso);
}
