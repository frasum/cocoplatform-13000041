// Reine Vergleichslogik für Settlement-Warnungen (POS- und Terminal-Differenz).
// Keine Geld-Berechnung — nur ein Soll/Ist-Abgleich auf bereits aggregierten
// Werten. Eingabevalidierung analog `waiter-settlement.ts`: alle Beträge
// müssen ganzzahlige Cents sein.

export type SettlementWarning =
  | {
      kind: "pos_diff";
      posTotalCents: number;
      waiterPosCents: number;
      deliveryCents: number;
      diffCents: number;
    }
  | {
      kind: "terminal_diff";
      terminalsCents: number;
      waiterCardCents: number;
      glCardCents: number;
      diffCents: number;
    }
  | {
      // Wolt steckt fachlich IM Vectron-Takeaway-Marker. Ist Wolt größer,
      // ist die Erfassung fehlerhaft (Tippfehler in einer der beiden Zeilen).
      kind: "wolt_exceeds_marker";
      woltCents: number;
      markerCents: number;
      diffCents: number;
    };

export type SettlementWarningInput = {
  hasSettlements: boolean;
  posTotalCents: number;
  deliveryVectronCents: number;
  deliverySouseCents: number;
  // Wolt = Drittplattform, NICHT im Vectron-Tagesumsatz enthalten —
  // Legacy `adjustedPosDiff` (tagesabrechnung DailySummary) zieht
  // `wolt_revenue` nie vom POS-Total ab. Daher kein deliveryWoltCents hier.
  terminalsTotalCents: number;
  // Nur physische Terminals (OHNE GL). GL-Karten gehören auf die
  // Kellner-Seite und werden via glCardCents addiert.
  glCardCents: number;
  // Nur für die Plausibilitätswarnung „Wolt > Marker" — nie ein Summand.
  deliveryWoltCents: number;
  waiterPosSalesCents: number[];
  waiterCardTotalCents: number[];
};

function asInt(v: number, name: string): number {
  if (!Number.isInteger(v)) throw new Error(`${name} must be integer cents`);
  return v;
}

function sumInts(arr: number[], name: string): number {
  let s = 0;
  for (let i = 0; i < arr.length; i += 1) s += asInt(arr[i], `${name}[${i}]`);
  return s;
}

export function computeSettlementWarnings(input: SettlementWarningInput): SettlementWarning[] {
  const warnings: SettlementWarning[] = [];

  // Erfassungsfehler-Warnung: unabhängig von Kellner-Abrechnungen, damit sie
  // direkt beim Eintippen der Kanäle auffällt.
  const woltCents = asInt(input.deliveryWoltCents, "deliveryWoltCents");
  const markerCents = asInt(input.deliveryVectronCents, "deliveryVectronCents");
  if (woltCents > markerCents) {
    warnings.push({
      kind: "wolt_exceeds_marker",
      woltCents,
      markerCents,
      diffCents: woltCents - markerCents,
    });
  }

  if (!input.hasSettlements) return warnings;

  const posTotal = asInt(input.posTotalCents, "posTotalCents");
  const deliveryVectron = markerCents;
  const deliverySouse = asInt(input.deliverySouseCents, "deliverySouseCents");
  const terminalsTotal = asInt(input.terminalsTotalCents, "terminalsTotalCents");
  const glCard = asInt(input.glCardCents, "glCardCents");
  const waiterPos = sumInts(input.waiterPosSalesCents, "waiterPosSalesCents");
  const waiterCard = sumInts(input.waiterCardTotalCents, "waiterCardTotalCents");

  const delivery = deliveryVectron + deliverySouse;
  const posDiff = posTotal - waiterPos - delivery;
  const terminalDiff = terminalsTotal - (waiterCard + glCard);

  if (Math.abs(posDiff) >= 1) {
    warnings.push({
      kind: "pos_diff",
      posTotalCents: posTotal,
      waiterPosCents: waiterPos,
      deliveryCents: delivery,
      diffCents: posDiff,
    });
  }
  if (Math.abs(terminalDiff) >= 1) {
    warnings.push({
      kind: "terminal_diff",
      terminalsCents: terminalsTotal,
      waiterCardCents: waiterCard,
      glCardCents: glCard,
      diffCents: terminalDiff,
    });
  }
  return warnings;
}
