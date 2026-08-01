// M-Statistik — Chart-Lückenfüllung.
//
// Reine Funktion. Schließt Kalendertag-Lücken im Umsatzverlauf, damit die
// X-Achse linear bleibt (fehlende Tage als Null-Balken). UTC-sicher, keine
// lokale Zeitzone.

export type DailyPoint = {
  businessDate: string; // "YYYY-MM-DD"
  houseCents: number;
  takeawayCents: number;
  totalCents: number;
  cardCents?: number;
  /** STAT2 — optional; fehlende Tage bleiben undefined (Konsument liest ?? 0). */
  guestCount?: number;
  workMinutes?: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toUtcMs(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function fillDailyGaps(daily: DailyPoint[]): DailyPoint[] {
  if (daily.length === 0) return [];
  // Letzter Eintrag gewinnt bei Duplikaten — Map über businessDate.
  const byDate = new Map<string, DailyPoint>();
  for (const p of daily) byDate.set(p.businessDate, p);
  const dates = Array.from(byDate.keys()).sort();
  const startMs = toUtcMs(dates[0]);
  const endMs = toUtcMs(dates[dates.length - 1]);
  const out: DailyPoint[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const iso = fromUtcMs(ms);
    const existing = byDate.get(iso);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        businessDate: iso,
        houseCents: 0,
        takeawayCents: 0,
        totalCents: 0,
        cardCents: 0,
      });
    }
  }
  return out;
}
