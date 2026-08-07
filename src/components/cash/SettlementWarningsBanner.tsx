import { Card } from "@/components/ui/card";
import { fmtCents } from "@/lib/format";
import { fmtSignedCents } from "@/lib/cash/kasse-helpers";
import { aggregateChannelAmounts, type ChannelKind } from "@/lib/cash/session-channels";
import { computeSettlementWarnings } from "@/lib/cash/settlement-warnings";
import type { Overview } from "@/lib/cash/kasse-types";

export function SettlementWarningsBanner({
  overview,
  channels,
  terminals,
}: {
  overview: Overview;
  channels: { id: string; kind: string }[];
  terminals: { id: string; isGl: boolean }[];
}) {
  const channelById = Object.fromEntries(channels.map((c) => [c.id, c]));
  const kindRows = (overview.channelAmounts ?? [])
    .map((a) => {
      const k = channelById[a.channelId]?.kind as ChannelKind | undefined;
      return k ? { kind: k, amountCents: Number(a.amountCents) } : null;
    })
    .filter((r): r is { kind: ChannelKind; amountCents: number } => r !== null);
  const agg = aggregateChannelAmounts(
    kindRows,
    (overview.terminalAmounts ?? []).map((t) => ({ amountCents: Number(t.amountCents) })),
  );

  // Terminal-Beträge in physisch vs. GL (Kredit Karten GL) aufsplitten.
  // GL-Karten gehören buchhalterisch auf die Kellner-Karten-Seite.
  const terminalById = Object.fromEntries(terminals.map((t) => [t.id, t]));
  let physicalTerminalCents = 0;
  let glCardCents = 0;
  for (const t of overview.terminalAmounts ?? []) {
    if (terminalById[t.terminalId]?.isGl) glCardCents += Number(t.amountCents);
    else physicalTerminalCents += Number(t.amountCents);
  }

  const activeSettlements = overview.settlements.filter((s) => s.status !== "superseded");

  const warnings = computeSettlementWarnings({
    hasSettlements: activeSettlements.length > 0,
    posTotalCents: Number(overview.session?.vectron_daily_total_cents ?? 0),
    deliveryVectronCents: agg.byKind.delivery_vectron,
    deliverySouseCents: agg.byKind.delivery_souse,
    terminalsTotalCents: physicalTerminalCents,
    glCardCents,
    deliveryWoltCents: agg.byKind.delivery_wolt,
    waiterPosSalesCents: activeSettlements.map((s) => Number(s.pos_sales_cents)),
    waiterCardTotalCents: activeSettlements.map((s) => Number(s.card_total_cents)),
  });

  if (warnings.length === 0) return null;

  return (
    <Card className="border-destructive/40 bg-destructive/10 p-4 text-destructive">
      <div className="mb-2 text-sm font-semibold">Abgleichs-Warnungen</div>
      <ul className="space-y-1 text-sm">
        {warnings.map((w) => {
          if (w.kind === "pos_diff") {
            return (
              <li key="pos">
                <strong>POS-Differenz</strong> — Vectron-Total ({fmtCents(w.posTotalCents)} €) ≠
                Kellner-Umsätze ({fmtCents(w.waiterPosCents)} €) + Take-away/Lieferungen (
                {fmtCents(w.deliveryCents)} €). Differenz: {fmtSignedCents(w.diffCents)}.
              </li>
            );
          }
          if (w.kind === "wolt_exceeds_marker") {
            return (
              <li key="wolt">
                <strong>Wolt über Takeaway-Marker</strong> — Wolt ({fmtCents(w.woltCents)} €)
                übersteigt den Vectron-Takeaway-Betrag ({fmtCents(w.markerCents)} €). Differenz:{" "}
                {fmtSignedCents(w.diffCents)}. Erfassung prüfen.
              </li>
            );
          }
          return (
            <li key="term">
              <strong>Terminal-Differenz</strong> — Σ Terminals ({fmtCents(w.terminalsCents)} €) ≠
              Kellner-Karten ({fmtCents(w.waiterCardCents)} €) + GL ({fmtCents(w.glCardCents)} €).
              Differenz: {fmtSignedCents(w.diffCents)}.
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
