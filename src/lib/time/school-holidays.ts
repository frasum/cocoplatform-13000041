// FK1 — Bayerische SCHULFERIEN als Code-Wahrheit (keine Tabelle, kein Import).
//
// Begründung (Prüfer-Entscheid 02.08.2026): Ferientermine sind amtlich Jahre im
// Voraus fix, ändern sich nie rückwirkend und sind klein — exakt das Muster von
// bavarianHolidayMap. Die events-Tabelle bleibt für dynamische Termine.
//
// WICHTIG: Schulferien sind KEINE gesetzlichen Feiertage. Dieses Modul hat
// KEINE Lohn-/SFN-Wirkung und importiert bewusst nichts aus shift-hours.ts.
//
// Quelle für ALLE Zeiträume unten: Bekanntmachung des Bayerischen
// Staatsministeriums für Unterricht und Kultus zur Ferienordnung für die
// Schuljahre 2024/2025 bis 2029/2030, BayMBl. 2022 Nr. 747 vom 21.12.2022
// (veröffentlicht unter km.bayern.de/termine/ferien-und-feiertage).
// Nicht veröffentlichte Schuljahre (ab 2030/2031) fehlen hier bewusst —
// es wird NICHT extrapoliert.

export type SchoolHolidayPeriod = {
  name: string; // „Sommerferien", „Herbstferien", …
  from: string; // ISO inklusive
  to: string; // ISO inklusive
};

/** SaaS-Erweiterungspunkt analog holiday_region / WEATHER_COORDS. */
export type SchoolHolidayRegion = "BY";

// Schuljahrweise, in amtlicher Reihenfolge. Namen wie vom KM geführt.
const BY_PERIODS: readonly SchoolHolidayPeriod[] = [
  // Schuljahr 2024/2025 — BayMBl. 2022 Nr. 747, Nr. 1.1
  { name: "Sommerferien", from: "2024-07-29", to: "2024-09-09" },
  { name: "Herbstferien", from: "2024-10-28", to: "2024-10-31" },
  { name: "Weihnachtsferien", from: "2024-12-23", to: "2025-01-03" },
  { name: "Frühjahrsferien", from: "2025-03-03", to: "2025-03-07" },
  { name: "Osterferien", from: "2025-04-14", to: "2025-04-25" },
  { name: "Pfingstferien", from: "2025-06-10", to: "2025-06-20" },
  // Schuljahr 2025/2026 — BayMBl. 2022 Nr. 747, Nr. 1.2
  { name: "Sommerferien", from: "2025-08-01", to: "2025-09-15" },
  { name: "Herbstferien", from: "2025-11-03", to: "2025-11-07" },
  { name: "Weihnachtsferien", from: "2025-12-22", to: "2026-01-05" },
  { name: "Frühjahrsferien", from: "2026-02-16", to: "2026-02-20" },
  { name: "Osterferien", from: "2026-03-30", to: "2026-04-10" },
  { name: "Pfingstferien", from: "2026-05-26", to: "2026-06-05" },
  // Schuljahr 2026/2027 — BayMBl. 2022 Nr. 747, Nr. 1.3
  { name: "Sommerferien", from: "2026-08-03", to: "2026-09-14" },
  { name: "Herbstferien", from: "2026-11-02", to: "2026-11-06" },
  { name: "Weihnachtsferien", from: "2026-12-24", to: "2027-01-08" },
  { name: "Frühjahrsferien", from: "2027-02-08", to: "2027-02-12" },
  { name: "Osterferien", from: "2027-03-22", to: "2027-04-02" },
  { name: "Pfingstferien", from: "2027-05-18", to: "2027-05-28" },
  // Schuljahr 2027/2028 — BayMBl. 2022 Nr. 747, Nr. 1.4
  { name: "Sommerferien", from: "2027-08-02", to: "2027-09-13" },
  { name: "Herbstferien", from: "2027-11-02", to: "2027-11-05" },
  { name: "Weihnachtsferien", from: "2027-12-24", to: "2028-01-07" },
  { name: "Frühjahrsferien", from: "2028-02-28", to: "2028-03-03" },
  { name: "Osterferien", from: "2028-04-10", to: "2028-04-21" },
  { name: "Pfingstferien", from: "2028-06-06", to: "2028-06-16" },
  // Schuljahr 2028/2029 — BayMBl. 2022 Nr. 747, Nr. 1.5
  { name: "Sommerferien", from: "2028-07-31", to: "2028-09-11" },
  { name: "Herbstferien", from: "2028-10-30", to: "2028-11-03" },
  { name: "Weihnachtsferien", from: "2028-12-23", to: "2029-01-05" },
  { name: "Frühjahrsferien", from: "2029-02-12", to: "2029-02-16" },
  { name: "Osterferien", from: "2029-03-26", to: "2029-04-06" },
  { name: "Pfingstferien", from: "2029-05-22", to: "2029-06-01" },
  // Schuljahr 2029/2030 — BayMBl. 2022 Nr. 747, Nr. 1.6
  { name: "Sommerferien", from: "2029-07-30", to: "2029-09-10" },
  { name: "Herbstferien", from: "2029-10-29", to: "2029-11-02" },
  { name: "Weihnachtsferien", from: "2029-12-24", to: "2030-01-04" },
  { name: "Frühjahrsferien", from: "2030-03-04", to: "2030-03-08" },
  { name: "Osterferien", from: "2030-04-15", to: "2030-04-26" },
  { name: "Pfingstferien", from: "2030-06-11", to: "2030-06-21" },
  // Letzter amtlich bekanntgegebener Zeitraum dieser Bekanntmachung
  // („Die Sommerferien 2030 beginnen am 29. Juli 2030 und enden am
  //  9. September 2030."). Danach ist NICHTS veröffentlicht — es wird nicht
  // extrapoliert, schoolHolidayOn liefert dort null.
  { name: "Sommerferien", from: "2030-07-29", to: "2030-09-09" },
];

// Buß- und Bettag: in Bayern kein gesetzlicher Feiertag, aber vom
// Kultusministerium als unterrichtsfreier Tag geführt (Art. 5 BayEUG,
// km.bayern.de „Ferien und Feiertage"). Datum amtlich definiert als der
// Mittwoch vor dem 23. November — deterministisch, keine Schätzung.
// Nur für die Schuljahre, die oben erfasst sind (2024–2029).
const BUSS_UND_BETTAG_YEARS: readonly number[] = [2024, 2025, 2026, 2027, 2028, 2029];

function bussUndBettag(year: number): SchoolHolidayPeriod {
  // Rückwärts vom 22.11. den letzten Mittwoch suchen.
  const d = new Date(Date.UTC(year, 10, 22, 12, 0, 0));
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() - 1);
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  return { name: "Buß- und Bettag (unterrichtsfrei)", from: iso, to: iso };
}

function allPeriods(region: SchoolHolidayRegion): readonly SchoolHolidayPeriod[] {
  if (region !== "BY") return [];
  return [...BY_PERIODS, ...BUSS_UND_BETTAG_YEARS.map(bussUndBettag)].sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : 0,
  );
}

/**
 * Alle bayerischen Ferienzeiträume, die das Kalenderjahr `year` berühren
 * (Weihnachtsferien laufen über den Jahreswechsel und erscheinen in beiden
 * Jahren). Nicht erfasste Jahre ergeben eine leere Liste.
 */
export function schoolHolidays(
  year: number,
  region: SchoolHolidayRegion = "BY",
): SchoolHolidayPeriod[] {
  const prefix = String(year);
  return allPeriods(region).filter(
    (p) => p.from.startsWith(prefix) || p.to.startsWith(prefix),
  ) as SchoolHolidayPeriod[];
}

/** Ferienzeitraum, in dem `dateISO` liegt (Grenzen inklusive), sonst null. */
export function schoolHolidayOn(
  dateISO: string,
  region: SchoolHolidayRegion = "BY",
): SchoolHolidayPeriod | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  return allPeriods(region).find((p) => p.from <= dateISO && dateISO <= p.to) ?? null;
}
