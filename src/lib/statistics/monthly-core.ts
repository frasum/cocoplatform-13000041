/**
 * MB1 — Monatsentwicklung: reine Zusammenführung von Legacy-Historie und
 * live gerechneten Monaten.
 *
 * Keine DB-Zugriffe, keine Seiteneffekte. Alle Beträge in ganzen Cent.
 *
 * Datenlage (Bauherren-Auftrag 01.08.2026):
 *  - 2002 – Feb 2026: Excel-Historie, einmalig importiert
 *    (`monthly_revenue_history`, source = 'legacy').
 *  - ab März 2026: COCO rechnet die Monate live aus den Sessions über
 *    `decomposeRevenue` (KGL, dieselbe Zerlegung wie Dashboard und PDF).
 *    Live-Monate werden NICHT gespeichert — kein abgeleiteter Wert.
 */

import { decomposeRevenue, type SessionRevenueInput } from "./revenue-core";

/**
 * Grenze zwischen Legacy-Historie und Live-Rechnung.
 *
 * Begründung: die Sessions beginnen am 16.02.2026, der Februar 2026 ist also
 * angeschnitten und würde live zu niedrig ausfallen. Deshalb gilt der Februar
 * (und alles davor) als Legacy, ab dem 01.03.2026 rechnet COCO selbst.
 */
export const LIVE_FROM = "2026-03-01";

/** "YYYY-MM" der Live-Grenze — Vergleiche laufen lexikografisch. */
export const LIVE_FROM_MONTH = LIVE_FROM.slice(0, 7);

export type MonthSource = "legacy" | "live";

export type MonthlyCell = {
  year: number;
  month: number; // 1..12
  totalCents: number;
  /** Legacy-Zeilen können ohne Takeaway-Wert vorliegen ⇒ null. */
  takeawayCents: number | null;
  source: MonthSource;
  /** true für den laufenden Monat (noch nicht abgeschlossen). */
  partial: boolean;
};

export type LegacyRow = {
  year: number;
  month: number;
  totalCents: number;
  takeawayCents: number | null;
};

export type LiveMonthRow = {
  locationId: string;
  year: number;
  month: number;
  totalCents: number;
  takeawayCents: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

export function isLiveMonth(year: number, month: number): boolean {
  return monthKey(year, month) >= LIVE_FROM_MONTH;
}

/**
 * Monatssummen je Standort aus Session-Inputs — ausschließlich über
 * `decomposeRevenue`. Die Monatssumme ist damit per Konstruktion die Summe
 * der Tageswerte (Wolt ist nie Summand).
 */
export function aggregateLiveMonths(sessions: readonly SessionRevenueInput[]): LiveMonthRow[] {
  const acc = new Map<string, LiveMonthRow>();
  for (const s of sessions) {
    const year = Number(s.businessDate.slice(0, 4));
    const month = Number(s.businessDate.slice(5, 7));
    const d = decomposeRevenue({ vectronCents: s.vectronCents, channels: s.channels });
    const key = `${s.locationId}|${monthKey(year, month)}`;
    const existing = acc.get(key);
    if (existing) {
      existing.totalCents += d.totalCents;
      existing.takeawayCents += d.takeawayCents;
    } else {
      acc.set(key, {
        locationId: s.locationId,
        year,
        month,
        totalCents: d.totalCents,
        takeawayCents: d.takeawayCents,
      });
    }
  }
  return Array.from(acc.values()).sort(
    (a, b) =>
      a.locationId.localeCompare(b.locationId) ||
      monthKey(a.year, a.month).localeCompare(monthKey(b.year, b.month)),
  );
}

/**
 * Legacy- und Live-Monate zu einer lückenlosen, doppelfreien Reihe verbinden.
 * Die Grenze ist hart: Legacy zählt nur vor `LIVE_FROM_MONTH`, Live nur ab
 * `LIVE_FROM_MONTH`. Zeilen auf der falschen Seite werden verworfen (die
 * Legacy-Historie enthält bewusst keine COCO-Monate).
 */
export function mergeMonthlyCells(args: {
  legacy: readonly LegacyRow[];
  live: readonly Omit<LiveMonthRow, "locationId">[];
  /** "YYYY-MM" des laufenden Monats — dieser wird als `partial` markiert. */
  currentMonthKey: string;
}): MonthlyCell[] {
  const byKey = new Map<string, MonthlyCell>();
  for (const r of args.legacy) {
    if (isLiveMonth(r.year, r.month)) continue;
    byKey.set(monthKey(r.year, r.month), {
      year: r.year,
      month: r.month,
      totalCents: r.totalCents,
      takeawayCents: r.takeawayCents,
      source: "legacy",
      partial: false,
    });
  }
  for (const r of args.live) {
    if (!isLiveMonth(r.year, r.month)) continue;
    const key = monthKey(r.year, r.month);
    byKey.set(key, {
      year: r.year,
      month: r.month,
      totalCents: r.totalCents,
      takeawayCents: r.takeawayCents,
      source: "live",
      partial: key === args.currentMonthKey,
    });
  }
  return Array.from(byKey.values()).sort((a, b) =>
    monthKey(a.year, a.month).localeCompare(monthKey(b.year, b.month)),
  );
}

export type YearRow = {
  year: number;
  /** 12 Einträge (Jan..Dez); fehlende Monate sind null. */
  months: (MonthlyCell | null)[];
  totalCents: number;
  /** Σ Takeaway der Monate mit Wert; null, wenn kein Monat einen Wert hat. */
  takeawayCents: number | null;
};

export function toYearRows(cells: readonly MonthlyCell[]): YearRow[] {
  const byYear = new Map<number, YearRow>();
  for (const c of cells) {
    let row = byYear.get(c.year);
    if (!row) {
      row = { year: c.year, months: new Array(12).fill(null), totalCents: 0, takeawayCents: null };
      byYear.set(c.year, row);
    }
    row.months[c.month - 1] = c;
    row.totalCents += c.totalCents;
    if (c.takeawayCents !== null) {
      row.takeawayCents = (row.takeawayCents ?? 0) + c.takeawayCents;
    }
  }
  return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
}

export function findCell(
  cells: readonly MonthlyCell[],
  year: number,
  month: number,
): MonthlyCell | null {
  return cells.find((c) => c.year === year && c.month === month) ?? null;
}

/** Σ Jan..`throughMonth` eines Jahres. */
export function ytdCents(
  cells: readonly MonthlyCell[],
  year: number,
  throughMonth: number,
): number {
  let sum = 0;
  for (const c of cells) {
    if (c.year === year && c.month <= throughMonth) sum += c.totalCents;
  }
  return sum;
}

/** Prozentuale Veränderung; null, wenn keine Basis vorhanden (kein 0-Fake). */
export function growthPct(currentCents: number, previousCents: number | null): number | null {
  if (previousCents === null || previousCents === 0) return null;
  return ((currentCents - previousCents) / previousCents) * 100;
}

export type MonthlyHeadline = {
  monthKey: string;
  currentCents: number | null;
  previousYearCents: number | null;
  /** null bei fehlendem Vorjahresmonat ODER wenn der Monat `partial` ist. */
  yoyPct: number | null;
  /** true, wenn der YoY-Vergleich wegen eines laufenden Monats entfällt. */
  yoyExcludedPartial: boolean;
  ytdCents: number;
  previousYearYtdCents: number | null;
  ytdPct: number | null;
  /** Bestes Jahr für diesen Kalendermonat (ohne den laufenden Monat). */
  bestForMonth: { year: number; totalCents: number } | null;
};

export function monthlyHeadline(
  cells: readonly MonthlyCell[],
  year: number,
  month: number,
): MonthlyHeadline {
  const cur = findCell(cells, year, month);
  const prev = findCell(cells, year - 1, month);
  const partial = cur?.partial === true;
  const prevYtdRaw = cells.some((c) => c.year === year - 1)
    ? ytdCents(cells, year - 1, month)
    : null;
  const candidates = cells.filter((c) => c.month === month && !c.partial);
  const best = candidates.reduce<MonthlyCell | null>(
    (acc, c) => (acc === null || c.totalCents > acc.totalCents ? c : acc),
    null,
  );
  const currentCents = cur ? cur.totalCents : null;
  return {
    monthKey: monthKey(year, month),
    currentCents,
    previousYearCents: prev ? prev.totalCents : null,
    yoyPct: partial || currentCents === null ? null : growthPct(currentCents, prev?.totalCents ?? null),
    yoyExcludedPartial: partial,
    ytdCents: ytdCents(cells, year, month),
    previousYearYtdCents: prevYtdRaw,
    ytdPct: growthPct(ytdCents(cells, year, month), prevYtdRaw),
    bestForMonth: best ? { year: best.year, totalCents: best.totalCents } : null,
  };
}
