// Aggregation der Session-Einnahmen aus den DB-Tabellen
// `session_channel_amounts` + `session_terminal_amounts` (B3-Modellkorrektur,
// Teil B). Der Reader liefert für jede Session-Reihe ein `kind` mit, das
// aus dem zugehörigen `revenue_channels.kind` stammt. Diese Aggregation
// gruppiert die Kanal-Beträge nach Kind und macht die Formel-Eingaben
// für `cash-ledger` direkt verfügbar — die UI muss keine kind-Splittung
// machen. `kind` ist technisch-neutral (kein Anbietername — der
// historische "ordersmart"-Kanal heißt jetzt `delivery_souse`).

import type { DayInput } from "./cash-ledger";

export type ChannelKind =
  | "pos"
  | "delivery_souse"
  | "delivery_wolt"
  | "delivery_vectron"
  | "voucher_sold"
  | "voucher_redeemed"
  | "finedine"
  | "einladung"
  | "sonstige";

export const CHANNEL_KINDS: readonly ChannelKind[] = [
  "pos",
  "delivery_souse",
  "delivery_wolt",
  "delivery_vectron",
  "voucher_sold",
  "voucher_redeemed",
  "finedine",
  "einladung",
  "sonstige",
] as const;

export type ChannelAmountRow = { kind: ChannelKind; amountCents: number };
export type TerminalAmountRow = { amountCents: number };
export type TerminalAmountRowWithGl = { amountCents: number; isGl: boolean };

/**
 * Summiert nur die Beträge physischer Terminals (nicht GL). GL-Karten
 * sind Kontrollposten (Guthaben-/Kreditkarten für Terminal-Abgleich)
 * und dürfen das Tages-Bargeld NICHT mindern — Referenz: Legacy-
 * `tagesabrechnung` (Kreditkarten = Terminal 1 + 2, GL separat).
 */
export function sumNonGlTerminalCents(rows: TerminalAmountRowWithGl[]): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.isGl) continue;
    if (!Number.isInteger(r.amountCents)) {
      throw new Error(`terminals[${i}].amount must be integer cents`);
    }
    sum += r.amountCents;
  }
  return sum;
}

/** §33: Kartenabzug aus Terminal-Formularzeilen — GL-Zeilen zählen NICHT. */
export function cardDeductionFromTerminalRows(
  rows: { euro: string; isGl: boolean }[],
  parse: (s: string) => number | null,
): number {
  let sum = 0;
  for (const r of rows) {
    if (r.isGl) continue;
    sum += parse(r.euro) ?? 0;
  }
  return sum;
}

export type ChannelTotalsByKind = Record<ChannelKind, number>;

/**
 * KA1 — kind-Auflösung für Session-Kanal-Beträge.
 *
 * Die Landkarte MUSS aus dem ungefilterten Kanalbestand entstehen
 * (inkl. inaktiver — historische Sessions referenzieren sie legitim).
 * Bei echtem Lookup-Miss (Kanal-ID gehört zu keinem bekannten Kanal)
 * wird ein Fehler mit der ID geworfen — kein stilles `?? ""`, damit die
 * Strenge von `sessionHouseCentsFromKasse` an der Quelle bleibt.
 */
export function resolveChannelKind(
  kindById: ReadonlyMap<string, string>,
  channelId: string,
): string {
  const k = kindById.get(channelId);
  if (k === undefined) {
    throw new Error(`unbekannter Kanal ${channelId}`);
  }
  return k;
}

export type AggregatedChannels = {
  byKind: ChannelTotalsByKind;
  cardTotalCents: number;
};

function emptyByKind(): ChannelTotalsByKind {
  return {
    pos: 0,
    delivery_souse: 0,
    delivery_wolt: 0,
    delivery_vectron: 0,
    voucher_sold: 0,
    voucher_redeemed: 0,
    finedine: 0,
    einladung: 0,
    sonstige: 0,
  };
}

function asInt(v: number, name: string): number {
  if (!Number.isInteger(v)) throw new Error(`${name} must be integer cents`);
  return v;
}

/**
 * Summiert die Kanal-Beträge je `kind` und den Karten-Topf separat.
 * Liefert nur die Aggregation — die Übersetzung in DayInput-Felder
 * macht `buildDayInputFromAggregation` weiter unten.
 */
export function aggregateChannelAmounts(
  channels: ChannelAmountRow[],
  terminals: TerminalAmountRow[],
): AggregatedChannels {
  const byKind = emptyByKind();
  for (let i = 0; i < channels.length; i += 1) {
    const r = channels[i];
    byKind[r.kind] += asInt(r.amountCents, `channels[${i}].amount`);
  }
  let cardTotalCents = 0;
  for (let i = 0; i < terminals.length; i += 1) {
    cardTotalCents += asInt(terminals[i].amountCents, `terminals[${i}].amount`);
  }
  return { byKind, cardTotalCents };
}

/**
 * Baut die `DayInput`-Felder, die aus Session-Kanälen und -Terminals
 * direkt ableitbar sind. Restliche Felder (`einladungCents`,
 * `vouchersSoldCents` etc.) können wahlweise aus dem aggregierten
 * `byKind` ODER aus den Pauschal-Spalten der Session kommen — beides
 * darf nicht doppelt zählen. Wir entscheiden uns für die kind-basierte
 * Quelle, damit es genau eine Eingabe pro Größe gibt.
 */
export function buildDayInputFromAggregation(
  agg: AggregatedChannels,
): Pick<
  DayInput,
  | "grossRevenueCents"
  | "cardTotalCents"
  | "deliverySouseCents"
  | "deliveryWoltCents"
  | "vouchersSoldCents"
  | "vouchersRedeemedCents"
  | "finedineVouchersCents"
  | "einladungCents"
  | "sonstigeEinnahmeCents"
> {
  return {
    grossRevenueCents: agg.byKind.pos,
    cardTotalCents: agg.cardTotalCents,
    deliverySouseCents: agg.byKind.delivery_souse,
    deliveryWoltCents: agg.byKind.delivery_wolt,
    vouchersSoldCents: agg.byKind.voucher_sold,
    vouchersRedeemedCents: agg.byKind.voucher_redeemed,
    finedineVouchersCents: agg.byKind.finedine,
    einladungCents: agg.byKind.einladung,
    sonstigeEinnahmeCents: agg.byKind.sonstige,
  };
}
