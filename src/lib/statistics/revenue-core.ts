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

import { fmtCents } from "@/lib/format";

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

// STAT2 — abgeleitete Kennzahlen „Ø Umsatz je Gast" und „Umsatz je
// Arbeitsstunde". Rein und getestet; die UI rechnet nicht.
//
// Fachentscheid 01.08.2026: € je Gast bezieht sich auf den HAUS-Umsatz —
// Takeaway-Besteller sind keine Gäste am Tisch. € je Stunde bezieht sich auf
// den Gesamtumsatz (die Arbeitszeit trägt beide Kanäle).
//
// Nenner 0 ⇒ `null` (die UI zeigt „—"; kein NaN, kein Infinity, kein 0-Fake).
export type DerivedKpis = {
  /** Haus-Umsatz je Gast in ganzen Cent, oder null bei 0 Gästen. */
  revenuePerGuestCents: number | null;
  /** Gesamtumsatz je Arbeitsstunde in ganzen Cent, oder null bei 0 Minuten. */
  revenuePerWorkHourCents: number | null;
  /** Arbeitsstunden (Minuten/60), auf zwei Dezimalen gerundet. */
  workHours: number;
};

export function derivedKpis(input: {
  houseCents: number;
  totalCents: number;
  guestCount: number;
  workMinutes: number;
}): DerivedKpis {
  const guests = input.guestCount > 0 ? input.guestCount : 0;
  const minutes = input.workMinutes > 0 ? input.workMinutes : 0;
  return {
    revenuePerGuestCents: guests === 0 ? null : Math.round(input.houseCents / guests),
    revenuePerWorkHourCents:
      minutes === 0 ? null : Math.round((input.totalCents * 60) / minutes),
    workHours: Math.round((minutes / 60) * 100) / 100,
  };
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

// STAT1 — Donut-Konsistenzprüfung (rein, ohne UI).
// Die Donut-Segmente sind per Definition genau die Marker- und SoUse-Zeilen.
// Läuft die Segmentsumme von `markerSum + souseSum` auseinander, ist der
// Datenpfad kaputt (z.B. ein Kanal fällt beim Laden raus) — das darf nicht
// still passieren. Abweichung von `takeawayCents` ist dagegen NUR dann
// erwartbar, wenn die Deckelung `min(vectron, marker + souse)` greift.
export type DonutCheck =
  | { ok: true; capped: boolean; message: string | null }
  | { ok: false; capped: boolean; message: string };

export function checkDonutSegments(input: {
  segmentSumCents: number;
  markerSumCents: number;
  souseSumCents: number;
  takeawayCents: number;
}): DonutCheck {
  const eur = (c: number) => `${fmtCents(c)} €`;
  const expected = input.markerSumCents + input.souseSumCents;
  const capped = expected > input.takeawayCents;
  if (input.segmentSumCents !== expected) {
    const diff = input.segmentSumCents - expected;
    return {
      ok: false,
      capped,
      message:
        `Donut-Prüfung fehlgeschlagen: Segmentsumme ${eur(input.segmentSumCents)} ` +
        `≠ Marker + SoUse ${eur(expected)} (Differenz ${diff > 0 ? "+" : "−"}${eur(Math.abs(diff))}). ` +
        `Die angezeigten Kanäle passen nicht zur Take-Away-Zerlegung — Zahlen nicht verwenden.`,
    };
  }
  if (capped) {
    return {
      ok: true,
      capped: true,
      message:
        `Hinweis: Marker + SoUse (${eur(expected)}) übersteigen den Vectron-Tagesumsatz; ` +
        `Take-Away ist auf ${eur(input.takeawayCents)} gedeckelt (Haus ≥ 0). ` +
        `Die Segment-Prozente beziehen sich auf die ungedeckelte Summe.`,
    };
  }
  return { ok: true, capped: false, message: null };
}

// STAT1b — Darstellungszerlegung der Take-Away-Segmente (rein, ohne UI).
// Der Vectron-Takeaway-Marker enthält Wolt; fachlich zerfällt er in
// „Wolt" und „Takeaway direkt (Telefon/Abholung)". SoUse bleibt unverändert.
// Die Segmentsumme ist per Konstruktion immer `markerSum + souseSum` — es
// wird nichts neu gerechnet, nur aufgeteilt.
export const TAKEAWAY_SEGMENT_WOLT = "Wolt";
export const TAKEAWAY_SEGMENT_DIRECT = "Takeaway direkt (Telefon/Abholung)";
export const TAKEAWAY_SEGMENT_SOUSE = "SoUse";

export type TakeawayDonutResult = {
  segments: TakeawayChannel[];
  segmentSumCents: number;
  /** true, wenn `woltInfoCents` den Marker übersteigt (Erfassungsfehler). */
  woltExceedsMarker: boolean;
  warning: string | null;
};

export function takeawayDonutSegments(
  markerSumCents: number,
  souseSumCents: number,
  woltInfoCents: number,
): TakeawayDonutResult {
  const marker = Math.max(0, markerSumCents);
  const souse = Math.max(0, souseSumCents);
  const woltRaw = Math.max(0, woltInfoCents);
  const woltExceedsMarker = woltRaw > marker;
  // Guard: Wolt-Segment auf den Marker deckeln, Direkt-Segment nie negativ.
  const wolt = Math.min(woltRaw, marker);
  const direct = marker - wolt;

  const segments: TakeawayChannel[] = [];
  if (wolt > 0) segments.push({ name: TAKEAWAY_SEGMENT_WOLT, amountCents: wolt });
  if (direct > 0) segments.push({ name: TAKEAWAY_SEGMENT_DIRECT, amountCents: direct });
  if (souse > 0) segments.push({ name: TAKEAWAY_SEGMENT_SOUSE, amountCents: souse });

  return {
    segments,
    segmentSumCents: marker + souse,
    woltExceedsMarker,
    warning: woltExceedsMarker
      ? `Wolt-Betrag (${fmtCents(woltRaw)} €) übersteigt den Takeaway-Marker ` +
        `(${fmtCents(marker)} €) — Erfassung prüfen.`
      : null,
  };
}
