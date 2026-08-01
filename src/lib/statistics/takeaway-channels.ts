// STAT3b — Take-Away-Kanäle als Tabellenmodell (Kanal × Standort + Gesamt).
//
// Reines Modul: keine UI, keine Abfragen, keine eigene Umsatzformel. Die
// Kanal-Zerlegung kommt unverändert aus `takeawayDonutSegments` (revenue-core),
// die Prozent-Deltas aus `growthPct` (monthly-core). Hier wird ausschließlich
// umsortiert, aufgefüllt und auf feste Kanalzeilen normalisiert.
//
// Vergleichsbasis ist die Vorperiode (Vormonat bzw. Vorfenster). Die
// U5a-Klemmung passiert bereits beim Laden des Vorfensters und gilt daher
// automatisch je Kanal. Ein Vorjahresvergleich je Kanal ist nicht möglich —
// die MB1-Monatshistorie kennt nur Gesamt- und Takeaway-Summen.

import {
  TAKEAWAY_SEGMENT_DIRECT,
  TAKEAWAY_SEGMENT_SOUSE,
  TAKEAWAY_SEGMENT_WOLT,
  takeawayDonutSegments,
} from "./revenue-core";
import { growthPct } from "./monthly-core";

/** Rohbestandteile eines Fensters, exakt wie `getRevenueStats` sie liefert. */
export type TakeawayWindow = {
  markerSumCents: number;
  souseSumCents: number;
  woltInfoCents: number;
};

/** Feste Zeilenreihenfolge: fehlt ein Kanal, steht 0 — nie eine Lücke. */
export const TAKEAWAY_CHANNEL_ORDER: readonly string[] = [
  TAKEAWAY_SEGMENT_WOLT,
  TAKEAWAY_SEGMENT_DIRECT,
  TAKEAWAY_SEGMENT_SOUSE,
];

export type TakeawayChannelRow = {
  name: string;
  amountCents: number;
  /** Anteil am Take-Away-Gesamt des Fensters; Nenner 0 ⇒ null („—"). */
  sharePct: number | null;
  prevCents: number | null;
  deltaPct: number | null;
};

export type TakeawayChannelRows = {
  rows: TakeawayChannelRow[];
  /** Summenzeile „Take-Away gesamt". */
  sum: TakeawayChannelRow;
  warning: string | null;
};

function sharePct(amountCents: number, totalCents: number): number | null {
  if (totalCents === 0) return null;
  return (amountCents / totalCents) * 100;
}

/** Kanal → Betrag, immer alle Kanäle belegt (fehlende Segmente = 0). */
function byChannel(win: TakeawayWindow | null): {
  map: Map<string, number>;
  totalCents: number;
  warning: string | null;
} {
  const map = new Map<string, number>(TAKEAWAY_CHANNEL_ORDER.map((n) => [n, 0]));
  if (!win) return { map, totalCents: 0, warning: null };
  const donut = takeawayDonutSegments(win.markerSumCents, win.souseSumCents, win.woltInfoCents);
  for (const seg of donut.segments) map.set(seg.name, seg.amountCents);
  return { map, totalCents: donut.segmentSumCents, warning: donut.warning };
}

/**
 * Kanalzeilen eines Scopes inkl. Anteil und Δ gegen die Vorperiode.
 * `previous === null` ⇒ alle Vergleichswerte null (kein 0-Fake).
 */
export function takeawayChannelRows(
  current: TakeawayWindow,
  previous: TakeawayWindow | null,
): TakeawayChannelRows {
  const cur = byChannel(current);
  const prev = previous ? byChannel(previous) : null;

  const rows = TAKEAWAY_CHANNEL_ORDER.map((name) => {
    const amountCents = cur.map.get(name) ?? 0;
    const prevCents = prev ? (prev.map.get(name) ?? 0) : null;
    return {
      name,
      amountCents,
      sharePct: sharePct(amountCents, cur.totalCents),
      prevCents,
      deltaPct: growthPct(amountCents, prevCents),
    };
  });

  return {
    rows,
    sum: {
      name: "Take-Away gesamt",
      amountCents: cur.totalCents,
      sharePct: cur.totalCents === 0 ? null : 100,
      prevCents: prev ? prev.totalCents : null,
      deltaPct: growthPct(cur.totalCents, prev ? prev.totalCents : null),
    },
    warning: cur.warning,
  };
}

export type TakeawayMatrixRow = {
  name: string;
  /** Beträge in derselben Reihenfolge wie `locationNames`. */
  perLocationCents: number[];
  totalCents: number;
  sharePct: number | null;
  deltaPct: number | null;
};

export type TakeawayMatrix = {
  locationNames: string[];
  rows: TakeawayMatrixRow[];
  sum: TakeawayMatrixRow;
  /** Erfassungshinweis (Wolt > Marker) aus dem Gesamt-Scope. */
  warning: string | null;
};

/**
 * Kanäle × Standorte + Spalte „Gesamt". Anteil und Δ beziehen sich immer auf
 * die Gesamt-Spalte; die Standortspalten zeigen nur Beträge (die Δ-Spalte je
 * Standort würde die eine A4-Seite sprengen).
 *
 * `locations` leer (Einzelstandort-Scope) ⇒ nur die Gesamt-Spalte.
 */
export function takeawayMatrix(
  locations: Array<{ locationName: string; current: TakeawayWindow }>,
  total: { current: TakeawayWindow; previous: TakeawayWindow | null },
): TakeawayMatrix {
  const totals = takeawayChannelRows(total.current, total.previous);
  const perLoc = locations.map((l) => byChannel(l.current));

  const rows: TakeawayMatrixRow[] = totals.rows.map((r) => ({
    name: r.name,
    perLocationCents: perLoc.map((p) => p.map.get(r.name) ?? 0),
    totalCents: r.amountCents,
    sharePct: r.sharePct,
    deltaPct: r.deltaPct,
  }));

  return {
    locationNames: locations.map((l) => l.locationName),
    rows,
    sum: {
      name: totals.sum.name,
      perLocationCents: perLoc.map((p) => p.totalCents),
      totalCents: totals.sum.amountCents,
      sharePct: totals.sum.sharePct,
      deltaPct: totals.sum.deltaPct,
    },
    warning: totals.warning,
  };
}

/** Anteil des Take-Away am Gesamtumsatz (für die PDF-Kopfzeile). */
export function takeawaySharePctOfTotal(takeawayCents: number, totalCents: number): number | null {
  return sharePct(takeawayCents, totalCents);
}
