// DR1 — gemeinsamer Builder für die Tagesabrechnungs-Ausgabe.
// Nimmt die Roh-Objekte aus der Kasse-Overview + Kontext und liefert das
// `PdfExportData`-Objekt, das sowohl `generateDailySummaryPdf` als auch die
// HTML-Druckansicht (`renderDailyPrintHtml`) konsumieren. Damit gibt es
// EINE Zahlen-Wahrheit (KGL-Lektion: kein zweites reduce, kein zweiter
// Karten-/Bargeld-Pfad) — Layout-Regeln (§33/GL, KONTROLLE-Reihenfolge)
// stecken weiterhin in den PDF-/Print-Rendern; hier passiert nur die
// Zusammenstellung der Datenzeilen.

import type { PdfExportData } from "./pdfExport";
import type { Overview } from "./kasse-types";

export interface BuildDailySummaryDataInput {
  overview: Overview;
  channels: { id: string; label: string; kind: string }[];
  /**
   * CH1 — org-weite Kanal-Landkarte (alle Standorte, aktiv+inaktiv), NUR für
   * die kind-Auflösung. Ohne Angabe wird `channels` verwendet.
   */
  channelKinds?: { id: string; kind: string }[];
  terminals: { id: string; label: string; isGl: boolean }[];
  staffById: Map<string, string>;
  locationName: string | undefined;
  createdByName?: string | null;
  managerOnDutyNames?: string[];
  cashBalanceTargetCents: number;
  previousDeficitCents: number;
  previousDeficitSourceDate: string | null;
  /** Standort-Regel „Service-Pool aktiv?" (aus dem Tip-Pool-Overview). */
  servicePoolEnabled?: boolean;
  /** Kanonischer Service-Pool-Wert (aus dem Tip-Pool-Overview). */
  servicePoolCents?: number;
  /**
   * Trinkgeld-Rest des Tages (kitchen + service). Fließt in „Tages-Bargeld"
   * ein — physische Kassenlage. Bildschirm und PDF müssen dieselbe Zahl
   * zeigen.
   */
  tipRemainderCents?: number;
}

export function buildDailySummaryData(input: BuildDailySummaryDataInput): PdfExportData {
  const { overview: ov, channels, terminals, staffById } = input;
  const sess = ov.session!;
  return {
    session: {
      business_date: sess.business_date,
      guest_count: sess.guest_count,
      cash_actual_cents: sess.cash_actual_cents,
      notes: sess.notes,
      vectron_daily_total_cents: sess.vectron_daily_total_cents,
      vouchers_sold_cents: sess.vouchers_sold_cents,
      vouchers_redeemed_cents: sess.vouchers_redeemed_cents,
      finedine_vouchers_cents: sess.finedine_vouchers_cents,
      einladung_cents: sess.einladung_cents,
      vorschuss_cents: sess.vorschuss_cents,
    },
    locationName: input.locationName,
    createdByName: input.createdByName ?? null,
    managerOnDutyNames: input.managerOnDutyNames ?? [],
    channels,
    channelKinds: input.channelKinds,
    channelAmounts: ov.channelAmounts,
    terminals,
    terminalAmounts: ov.terminalAmounts,
    settlements: ov.settlements.map((s) => ({
      staffName: s.staffName,
      status: s.status as string,
      pos_sales_cents: Number(s.pos_sales_cents),
      card_total_cents: Number(s.card_total_cents),
      hilf_mahl_cents: Number(s.hilf_mahl_cents),
      open_invoices_cents: Number(s.open_invoices_cents),
      cash_handed_in_cents: Number(s.cash_handed_in_cents),
      kassiert_brutto_cents: Number(
        (s as { kassiert_brutto_cents?: number | string | null }).kassiert_brutto_cents ??
          s.pos_sales_cents,
      ),
      differenz_cents: Number(s.differenz_cents),
      kitchen_tip_cents: Number(s.kitchen_tip_cents),
      submitted_at: s.submitted_at,
      updated_at: (s as { updated_at?: string | null }).updated_at ?? null,
      corrected_from_id: s.corrected_from_id,
      openInvoiceEntries:
        (s as { openInvoiceEntries?: Array<{ name: string; cents: number }> }).openInvoiceEntries ??
        [],
    })),
    expenses: ov.expenses.map((e) => ({
      description: e.description,
      amountCents: e.amountCents,
    })),
    // SE1: sonstige Einnahmen als Positionsliste (Muster `expenses`).
    otherIncomes: ov.otherIncomes.map((o) => ({
      description: o.description,
      amountCents: o.amountCents,
    })),
    advances: ov.advances.map((a) => ({
      staffName: staffById.get(a.staffId) ?? a.staffId.slice(0, 8),
      amountCents: a.amountCents,
      note: a.note,
    })),
    cashBalanceTargetCents: input.cashBalanceTargetCents,
    previousDeficitCents: input.previousDeficitCents,
    previousDeficitSourceDate: input.previousDeficitSourceDate,
    servicePoolEnabled: input.servicePoolEnabled,
    servicePoolCents: input.servicePoolCents,
    tipRemainderCents: input.tipRemainderCents ?? 0,
  };
}
