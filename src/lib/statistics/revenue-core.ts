/**
 * M-Statistik — reine Umsatz-/Aggregations-Funktionen.
 *
 * Alle Beträge sind ganzzahlige Cent (number). Keine Float-Cent-Rechnung,
 * keine Seiteneffekte, keine DB-Zugriffe. Die DB-Anbindung
 * (Server-Fn, sessions/revenue_channels/session_channel_amounts) lebt
 * außerhalb und speist diese Funktionen mit bereits normalisierten Inputs.
 *
 * STAT1 — Umsatzdefinition (N14-Zerlegung, Fachentscheidung Frank 13.07.,
 * einzige Wahrheit für Statistik UND Kasse). Kanäle sind KEINE additiven
 * disjunkten Zeilen: `delivery_vectron` (Marker) und `delivery_souse` sind
 * Teilmengen des Vectron-Tagesumsatzes und werden abgezogen, `delivery_wolt`
 * steckt bereits im Marker (reine Info, nie Summand). `pos` ist eine
 * additive Zweitkasse (TSB).
 *
 *   Gesamt   = vectronCents + posSum
 *   Takeaway = min(vectronCents, markerSum + souseSum)   // Guard: Haus ≥ 0
 *   Haus     = Gesamt − Takeaway
 *
 * Unbekannte/leere `kind` werfen absichtlich — kein stilles No-op.
 */

export type ChannelAmount = { kind: string; amountCents: number };

export type SessionRevenueInput = {
  sessionId: string;
  businessDate: string; // "YYYY-MM-DD"
  locationId: string;
  vectronCents: number;
  channels: ChannelAmount[];
};

export type SessionRevenue = {
  houseCents: number;
  takeawayCents: number;
  totalCents: number;
  /** Nur Anzeige („davon Wolt") — nie Summand. */
  woltInfoCents: number;
};

export type DailyRevenue = {
  businessDate: string; // "YYYY-MM-DD"
  houseCents: number;
  takeawayCents: number;
  totalCents: number;
  woltInfoCents: number;
  cardCents: number;
  sessionCount: number;
};

export type PeriodSummary = {
  houseCents: number;
  takeawayCents: number;
  totalCents: number;
  woltInfoCents: number;
  daysWithRevenue: number; // Tage mit totalCents > 0
};

export type Trend = {
  deltaCents: number; // current - previous
  pct: number | null; // null, wenn previous === 0 (kein definierter Prozentwert)
};

/**
 * STAT1 — Kernzerlegung (KGL). Einzige Stelle, an der Vectron-Betrag und
 * Kanal-`kind` zu Gesamt/Takeaway/Haus verrechnet werden.
 */
export type RevenueDecomposition = {
  posSum: number;
  markerSum: number;
  souseSum: number;
  woltSum: number;
  totalCents: number;
  takeawayCents: number;
  houseCents: number;
};

export function decomposeRevenue(input: {
  vectronCents: number;
  channels: readonly { kind: string; amountCents: number }[];
}): RevenueDecomposition {
  let posSum = 0;
  let markerSum = 0;
  let souseSum = 0;
  let woltSum = 0;
  for (const c of input.channels) {
    switch (c.kind) {
      case "pos":
        posSum += c.amountCents;
        break;
      case "delivery_vectron":
        markerSum += c.amountCents;
        break;
      case "delivery_souse":
        souseSum += c.amountCents;
        break;
      case "delivery_wolt":
        // Reine Info: steckt bereits im delivery_vectron-Marker.
        woltSum += c.amountCents;
        break;
      default:
        throw new Error(`decomposeRevenue: unbekannter kind "${c.kind}"`);
    }
  }
  const totalCents = input.vectronCents + posSum;
  const takeawayCents = Math.min(input.vectronCents, markerSum + souseSum);
  return {
    posSum,
    markerSum,
    souseSum,
    woltSum,
    totalCents,
    takeawayCents,
    houseCents: totalCents - takeawayCents,
  };
}

export function sessionRevenue(input: SessionRevenueInput): SessionRevenue {
  const d = decomposeRevenue({ vectronCents: input.vectronCents, channels: input.channels });
  return {
    houseCents: d.houseCents,
    takeawayCents: d.takeawayCents,
    totalCents: d.totalCents,
    woltInfoCents: d.woltSum,
  };
}

/**
 * Kasse-Adapter (N14, Fachentscheidung Frank 13.07.):
 * „Take-Away" heißt im Kasse-/Sessions-Modell konsistent: der Kanal-`kind`
 * beginnt mit `"delivery_"` (SoUse, Wolt, eigener Vectron-Außer-Haus-Kanal).
 * Alles andere (POS-Kanäle und Vectron-Direktumsatz) ist Haus-Umsatz.
 * Bewusst nur EINE Ableitung — Statistik und Kasse dürfen hier nicht
 * auseinanderlaufen.
 */
export function isTakeawayKind(kind: string): boolean {
  return kind.startsWith("delivery_");
}

/**
 * Reiner Helfer für Kassen-UI/PDF/Print (N14, N14b — Kanal-Modell 19.07.).
 * Seit STAT1 nur noch dünne Hülle über `decomposeRevenue` — Kasse und
 * Statistik dürfen hier nicht auseinanderlaufen. Ergebnis unverändert:
 * posSum + max(0, vectron − marker − souse).
 */
export function sessionHouseCentsFromKasse(input: {
  vectronCents: number;
  channels: { kind: string; amountCents: number }[];
}): number {
  return decomposeRevenue(input).houseCents;
}

export function aggregateByBusinessDate(
  sessions: SessionRevenueInput[],
  cardBySession?: ReadonlyMap<string, number> | Record<string, number>,
): DailyRevenue[] {
  const getCard = (id: string): number => {
    if (!cardBySession) return 0;
    if (cardBySession instanceof Map) return cardBySession.get(id) ?? 0;
    return (cardBySession as Record<string, number>)[id] ?? 0;
  };
  const byDate = new Map<string, DailyRevenue>();
  for (const s of sessions) {
    const rev = sessionRevenue(s);
    const card = getCard(s.sessionId);
    const existing = byDate.get(s.businessDate);
    if (existing) {
      existing.houseCents += rev.houseCents;
      existing.takeawayCents += rev.takeawayCents;
      existing.totalCents += rev.totalCents;
      existing.woltInfoCents += rev.woltInfoCents;
      existing.cardCents += card;
      existing.sessionCount += 1;
    } else {
      byDate.set(s.businessDate, {
        businessDate: s.businessDate,
        houseCents: rev.houseCents,
        takeawayCents: rev.takeawayCents,
        totalCents: rev.totalCents,
        woltInfoCents: rev.woltInfoCents,
        cardCents: card,
        sessionCount: 1,
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0,
  );
}

export function summarize(daily: DailyRevenue[]): PeriodSummary {
  let houseCents = 0;
  let takeawayCents = 0;
  let totalCents = 0;
  let woltInfoCents = 0;
  let daysWithRevenue = 0;
  for (const d of daily) {
    houseCents += d.houseCents;
    takeawayCents += d.takeawayCents;
    totalCents += d.totalCents;
    woltInfoCents += d.woltInfoCents;
    if (d.totalCents > 0) daysWithRevenue += 1;
  }
  return { houseCents, takeawayCents, totalCents, woltInfoCents, daysWithRevenue };
}

export function computeTrend(currentCents: number, previousCents: number): Trend {
  const deltaCents = currentCents - previousCents;
  const pct = previousCents === 0 ? null : (deltaCents / previousCents) * 100;
  return { deltaCents, pct };
}

// STAT-U2 — Take-Away je Kanal.
// Summiert `amountCents` je Kanal-Name und sortiert absteigend. Reihenfolge
// bei Gleichstand: stabil nach Kanal-Name (aufsteigend), damit die UI und
// Tests deterministisch bleiben.
export type TakeawayChannel = { name: string; amountCents: number };

export function groupTakeawayByChannel(
  rows: readonly { name: string; amountCents: number }[],
): TakeawayChannel[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    acc.set(r.name, (acc.get(r.name) ?? 0) + r.amountCents);
  }
  return Array.from(acc.entries())
    .map(([name, amountCents]) => ({ name, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
}

// Prozent-Verteilung mit Largest-Remainder-Rundung. Σ der ganzzahligen
// `pct`-Werte ist genau 100, außer bei leerer Liste oder Gesamtsumme 0
// (dann alle 0 bzw. leeres Ergebnis).
export type TakeawayChannelPct = TakeawayChannel & { pct: number };

export function computeChannelPercents(items: readonly TakeawayChannel[]): TakeawayChannelPct[] {
  if (items.length === 0) return [];
  const total = items.reduce((s, i) => s + i.amountCents, 0);
  if (total <= 0) return items.map((i) => ({ ...i, pct: 0 }));
  const raw = items.map((i, idx) => {
    const exact = (i.amountCents / total) * 100;
    const floor = Math.floor(exact);
    return { idx, floor, frac: exact - floor };
  });
  const assigned = raw.reduce((s, r) => s + r.floor, 0);
  let remainder = 100 - assigned;
  // Größte Fraktion zuerst; Gleichstand → höherer Betrag → kleinerer idx.
  const order = [...raw].sort(
    (a, b) =>
      b.frac - a.frac || items[b.idx].amountCents - items[a.idx].amountCents || a.idx - b.idx,
  );
  const bonus = new Array(items.length).fill(0);
  for (let k = 0; k < order.length && remainder > 0; k++) {
    bonus[order[k].idx] = 1;
    remainder--;
  }
  return items.map((i, idx) => ({ ...i, pct: raw[idx].floor + bonus[idx] }));
}
