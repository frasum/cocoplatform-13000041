// Tagesabrechnung-PDF im zweispaltigen YUM-Layout (eine Seite, jsPDF + autoTable).
// Reine Präsentationsschicht — keine Geld-Logik, keine Server-Aufrufe.

import { format } from "date-fns";
import { de } from "date-fns/locale";
import type jsPDF from "jspdf";
import type { RowInput } from "jspdf-autotable";
import { computeDailyCashWithTipRemainder, type DayInput } from "./cash-ledger";
import { computeWechselgeld } from "./cash-summary";
import { sessionToDayInput } from "./session-day-input";
import { buildChannelKindMap } from "./channel-mapping";
import { sumNonGlTerminalCents, resolveChannelKind } from "./session-channels";
import { computeTipTotalCents } from "./tip-pool";
import { sessionHouseCentsFromKasse } from "@/lib/statistics/revenue-core";

type Cents = number;

export interface PdfChannel {
  id: string;
  label: string;
  kind: string;
}
export interface PdfTerminal {
  id: string;
  label: string;
  /** §33: GL-Terminals (Guthaben-/Kreditkarten-Kontrollposten) mindern das
   *  Bargeld NICHT. Muss aus payment_terminals.is_gl gespeist werden — sonst
   *  weicht die Karten-Summe im PDF vom Bildschirm ab (Bug KGL-2 04.07.). */
  isGl: boolean;
}

export interface PdfSession {
  business_date: string;
  guest_count?: number | null;
  cash_actual_cents?: number | null;
  notes?: string | null;
  vectron_daily_total_cents?: Cents | null;
  vouchers_sold_cents?: Cents | null;
  vouchers_redeemed_cents?: Cents | null;
  finedine_vouchers_cents?: Cents | null;
  einladung_cents?: Cents | null;
  sonstige_einnahme_cents?: Cents | null;
  vorschuss_cents?: Cents | null;
}

export interface PdfSettlement {
  staffName: string;
  status: string;
  pos_sales_cents: Cents;
  card_total_cents: Cents;
  hilf_mahl_cents: Cents;
  open_invoices_cents: Cents;
  cash_handed_in_cents: Cents;
  kassiert_brutto_cents?: Cents;
  differenz_cents: Cents;
  kitchen_tip_cents: Cents;
  submitted_at?: string | null;
  updated_at?: string | null;
  corrected_from_id?: string | null;
  // Offene Rechnungen mit Reservierungsname pro Position (optional, weil
  // Alt-Zeilen vor Einführung der Namen kein Detail haben).
  openInvoiceEntries?: Array<{ name: string; cents: number }>;
}

export interface PdfExportData {
  session: PdfSession;
  locationName?: string;
  createdByName?: string | null;
  /** DR2: Namen der Personen, die an diesem Tag im Dienstplan-Bereich GL
   *  (Geschäftsleitung) am Standort eingeplant waren. */
  managerOnDutyNames?: string[];
  channels: PdfChannel[];
  /**
   * CH1 — org-weite Kanal-Landkarte (alle Standorte, aktiv+inaktiv), NUR für
   * die kind-Auflösung. Ohne Angabe wird `channels` verwendet.
   */
  channelKinds?: { id: string; kind: string }[];
  channelAmounts: { channelId: string; amountCents: Cents }[];
  terminals: PdfTerminal[];
  terminalAmounts: { terminalId: string; amountCents: Cents }[];
  settlements: PdfSettlement[];
  expenses: { description: string | null; amountCents: Cents }[];
  advances: { staffName: string; amountCents: Cents; note: string | null }[];
  /** Soll-Wechselgeldbestand (resolved: Location ?? Org) in Cents. */
  cashBalanceTargetCents?: Cents;
  /** Rollender operativer Saldo der Vortage (≤ 0). */
  previousDeficitCents?: Cents;
  /** Datum, das in der Summary-Zeile "Fehlbetrag Vortag (…)" angezeigt wird. */
  previousDeficitSourceDate?: string | null;
  /**
   * Ob am Standort ein Mitarbeiter-/Service-Trinkgeldpool aktiv ist. Wird für
   * die Anzeige der Pool-Zeile im Tagesbeleg gebraucht: an Standorten ohne
   * Service-Pool (z. B. YUM) wird "Mitarbeiter-Pool" NICHT gedruckt.
   */
  servicePoolEnabled?: boolean;
  /**
   * Kanonischer Service-Pool-Wert (aus dem Trinkgeld-Pool-Overview). Nur
   * gesetzt, wenn der Aufrufer den echten Wert liefern kann. Wenn nicht
   * gesetzt, fällt der Beleg auf die frühere Näherung
   * `max(0, tipAll − kitchen)` zurück (Legacy-Verhalten).
   */
  servicePoolCents?: Cents;
  /**
   * Trinkgeld-Rest des Tages (kitchen + service). Fließt in „Tages-Bargeld"
   * ein — spiegelt die Bildschirmanzeige (CashSummaryBlock).
   */
  tipRemainderCents?: Cents;
}

function fmtEur(cents: Cents | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
}

// DR4: Vorzeichen-Formatter für die Wechselgeld-Differenz. Positiv (in Tresor
// zu legen) mit „+"-Präfix, negativ automatisch mit Minus, 0 ohne Vorzeichen.
function fmtEurSigned(cents: Cents | null | undefined): string {
  const c = cents ?? 0;
  const s = fmtEur(c);
  return c > 0 ? `+${s}` : s;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "---";
  try {
    return format(new Date(iso), "HH:mm", { locale: de });
  } catch {
    return "---";
  }
}

const SLATE_BG: [number, number, number] = [241, 245, 249];
const SLATE_FG: [number, number, number] = [51, 65, 85];
const GREEN: [number, number, number] = [22, 163, 74];
const RED: [number, number, number] = [220, 38, 38];

type ChannelKindKey =
  | "pos"
  | "delivery_souse"
  | "delivery_wolt"
  | "delivery_vectron"
  | "voucher_sold"
  | "voucher_redeemed"
  | "finedine"
  | "einladung"
  | "sonstige";

function totalsByKind(data: PdfExportData): Record<ChannelKindKey, number> {
  const out: Record<ChannelKindKey, number> = {
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
  // CH1: Map org-weit, alle Standorte, aktiv+inaktiv (Standort-Race CH1);
  // Lookup-Miss wirft mit ID.
  const idToKind = buildChannelKindMap(data.channelKinds ?? data.channels);
  for (const a of data.channelAmounts) {
    const k = resolveChannelKind(idToKind, a.channelId) as ChannelKindKey;
    if (!(k in out)) {
      throw new Error(`unbekannter Kanal-kind "${k}" (Kanal ${a.channelId})`);
    }
    out[k] += a.amountCents;
  }
  return out;
}

function labelForKind(data: PdfExportData, kind: ChannelKindKey, fallback: string): string {
  const ch = data.channels.find((c) => (c.kind as ChannelKindKey) === kind);
  return ch?.label ?? fallback;
}

function sectionHeader(title: string): RowInput {
  return [
    {
      content: title,
      colSpan: 2,
      styles: {
        fillColor: SLATE_BG,
        fontStyle: "bold",
        fontSize: 10,
        textColor: SLATE_FG,
      },
    },
  ];
}

export async function generateDailySummaryPdf(data: PdfExportData): Promise<{
  doc: jsPDF;
  blob: Blob;
  fileName: string;
}> {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new JsPDF("portrait");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = 14;

  const sess = data.session;
  const totals = totalsByKind(data);
  const active = data.settlements.filter((s) => s.status !== "superseded");

  // ---- Header (zentriert) -------------------------------------------------
  const dateStr = format(new Date(sess.business_date + "T00:00:00"), "EEEE, d. MMMM", {
    locale: de,
  });
  const headerText = data.locationName ? `${data.locationName}  ·  ${dateStr}` : dateStr;
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(headerText, pageWidth / 2, y, { align: "center" });
  y += 6;

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.setFont("helvetica", "normal");
  const parts: string[] = [];
  if (data.createdByName) parts.push(`Erstellt von: ${data.createdByName}`);
  if (data.managerOnDutyNames && data.managerOnDutyNames.length > 0) {
    parts.push(`Manager: ${data.managerOnDutyNames.join(", ")}`);
  }
  parts.push(`Export: ${format(new Date(), "dd.MM.yyyy HH:mm", { locale: de })}`);
  doc.text(parts.join("  ·  "), pageWidth / 2, y, { align: "center" });
  doc.setTextColor(0);
  y += 5;

  // ---- Layout ------------------------------------------------------------
  const gap = 4;
  const leftColWidth = (pageWidth - 2 * margin - gap) * 0.45;
  const rightColWidth = (pageWidth - 2 * margin - gap) * 0.55;
  const leftX = margin;
  const rightX = margin + leftColWidth + gap;
  const columnsStartY = y;

  // ---- LEFT COLUMN -------------------------------------------------------
  // POS-Umsatz kommt aus dem Session-Feld vectron_daily_total_cents
  // (NICHT aus den Channels — YUM/Spicery hat keinen pos-Channel).
  const posTotal = Number(sess.vectron_daily_total_cents ?? 0);
  // N14 (Fachentscheidung Frank 13.07.): ⌀ pro Gast IMMER auf den
  // Haus-Umsatz (ohne Wolt/SoUse/eigener Außer-Haus-Verkauf) — identische
  // Ableitung wie Bildschirm und Druckansicht.
  const kindById = buildChannelKindMap(data.channelKinds ?? data.channels);
  const houseCentsForAvg = sessionHouseCentsFromKasse({
    vectronCents: posTotal,
    channels: data.channelAmounts.map((a) => ({
      kind: resolveChannelKind(kindById, a.channelId),
      amountCents: a.amountCents,
    })),
  });
  // §33 (KGL-2): GL-Terminals sind Kontrollposten und dürfen den Kartenabzug
  // NICHT erhöhen. Join Terminal-Beträge ↔ Terminals (isGl) und Summe über
  // die zentrale Regel `sumNonGlTerminalCents` — identisch zum Bildschirm-
  // Pfad (`cardDeductionFromTerminalRows` in CashSummaryBlock).
  const terminalGlById = new Map(data.terminals.map((t) => [t.id, t.isGl]));
  const terminalRowsWithGl = data.terminalAmounts.map((a) => ({
    amountCents: a.amountCents,
    isGl: terminalGlById.get(a.terminalId) ?? false,
  }));
  const cardTerminalTotal = sumNonGlTerminalCents(terminalRowsWithGl);
  const sumOpen = active.reduce((a, s) => a + s.open_invoices_cents, 0);
  const sumHilf = active.reduce((a, s) => a + s.hilf_mahl_cents, 0);
  const sumAdvances = data.advances.reduce((a, b) => a + b.amountCents, 0);
  const sumExpenses = data.expenses.reduce((a, b) => a + b.amountCents, 0);

  // Anzeigewerte aus den Session-Feldern (gleiche Quelle wie aggToDayInput),
  // damit die im PDF gedruckten Zahlen identisch mit der Bargeld-Berechnung sind.
  const vouchersSold = Number(sess.vouchers_sold_cents ?? 0);
  const vouchersRedeemed = Number(sess.vouchers_redeemed_cents ?? 0);
  const finedine = Number(sess.finedine_vouchers_cents ?? 0);
  const einladung = Number(sess.einladung_cents ?? 0);
  const sonstige = Number(sess.sonstige_einnahme_cents ?? 0);

  // Tages-Bargeld: 1:1 über computeDailyCash (cash-ledger), Einzel-Session-DayInput
  // über den geteilten Helper (verhalten-identisch zur vorigen Inline-Variante).
  const dayInput: DayInput = sessionToDayInput(sess, {
    cardTotalCents: cardTerminalTotal,
    deliverySouseCents: totals.delivery_souse,
    deliveryWoltCents: totals.delivery_wolt,
    openInvoicesCents: active.map((s) => s.open_invoices_cents),
    expensesCents: data.expenses.map((e) => e.amountCents),
    advancesCents: data.advances.map((a) => a.amountCents),
    tipRemainderCents: data.tipRemainderCents ?? 0,
  });
  const bargeldCents = computeDailyCashWithTipRemainder(dayInput);

  const summaryRows: RowInput[] = [];
  summaryRows.push(sectionHeader("Umsatz"));
  summaryRows.push(["POS-Umsatz", fmtEur(posTotal)]);
  if ((sess.guest_count ?? 0) > 0) {
    const avg = houseCentsForAvg / sess.guest_count!;
    summaryRows.push([
      {
        content: `Gäste: ${sess.guest_count}  ·  ⌀ pro Gast (Haus) ${fmtEur(avg)}`,
        colSpan: 2,
        styles: { fontSize: 6.5, textColor: [100, 116, 139] },
      },
    ]);
  }

  summaryRows.push(sectionHeader("Kartenzahlung"));
  summaryRows.push(["KK (Terminal)", fmtEur(cardTerminalTotal)]);

  const hasTakeAway =
    totals.delivery_souse !== 0 ||
    totals.delivery_wolt !== 0 ||
    totals.delivery_vectron !== 0 ||
    data.channels.some((c) => c.kind.startsWith("delivery_"));
  if (hasTakeAway) {
    summaryRows.push(sectionHeader("Take Away"));
    if (data.channels.some((c) => c.kind === "delivery_souse")) {
      summaryRows.push([
        labelForKind(data, "delivery_souse", "SoUse"),
        fmtEur(totals.delivery_souse),
      ]);
    }
    if (data.channels.some((c) => c.kind === "delivery_wolt")) {
      summaryRows.push([labelForKind(data, "delivery_wolt", "Wolt"), fmtEur(totals.delivery_wolt)]);
    }
    if (data.channels.some((c) => c.kind === "delivery_vectron")) {
      summaryRows.push([
        labelForKind(data, "delivery_vectron", "Vectron"),
        fmtEur(totals.delivery_vectron),
      ]);
    }
  }

  summaryRows.push(sectionHeader("Gutscheine & Abzüge"));
  summaryRows.push(["Gutscheine EL", fmtEur(vouchersRedeemed)]);
  summaryRows.push(["Gutschein Verkauf", fmtEur(vouchersSold)]);
  if (finedine !== 0) summaryRows.push(["FineDine", fmtEur(finedine)]);
  summaryRows.push(["Offen", fmtEur(sumOpen)]);
  {
    const openNames: string[] = [];
    for (const s of active) {
      for (const e of s.openInvoiceEntries ?? []) {
        if (e.name) openNames.push(e.name);
      }
    }
    if (openNames.length > 0) {
      // Dezente Unterzeile mit den Reservierungsnamen — Layout identisch
      // zum HTML-Print (klein, grau, über beide Spalten, ohne Präfix).
      summaryRows.push([
        {
          content: openNames.join(" · "),
          colSpan: 2,
          styles: { fontSize: 6.5, textColor: [100, 116, 139] },
        },
      ]);
    }
  }
  summaryRows.push(["Personal", fmtEur(sumAdvances)]);
  summaryRows.push(["Einladung", fmtEur(einladung)]);
  summaryRows.push(["Sonstige Einnahmen", fmtEur(sonstige)]);
  summaryRows.push(["Bar Ausgaben", fmtEur(sumExpenses)]);

  summaryRows.push(sectionHeader("Ergebnis"));
  const bargeldColor = bargeldCents >= 0 ? GREEN : RED;
  // DR3: „Differenz zum Wechselgeldbestand" = Wechselgeldbestand − Soll-Bestand
  // (identisch zur Bildschirmberechnung in CashSummaryBlock). Vorher wurde
  // fälschlich `bargeldCents` gedruckt, was bei Location-Targets ≠ 0
  // (z. B. Spicery) einen falschen Wert ergab.
  const _cashTargetForDiff = data.cashBalanceTargetCents ?? 200_000;
  const _wechselForDiff = computeWechselgeld({
    tagesBargeldCents: bargeldCents,
    previousDeficitCents: data.previousDeficitCents ?? 0,
    cashTargetCents: _cashTargetForDiff,
  });
  // WG1: ungekappte, beidseitige Differenz aus dem Core (Bestand bleibt gekappt).
  const _diffToTargetCents = _wechselForDiff.diffToTargetSignedCents;
  const _diffColor = _diffToTargetCents < 0 ? RED : _diffToTargetCents > 0 ? GREEN : undefined;
  summaryRows.push([
    {
      content: "Tages-Bargeld",
      styles: { fontStyle: "bold", textColor: bargeldColor },
    },
    {
      content: fmtEur(bargeldCents),
      styles: { fontStyle: "bold", halign: "right", textColor: bargeldColor },
    },
  ]);
  summaryRows.push(["Hilf Mahl", fmtEur(sumHilf)]);
  const _prevDeficitForRow = data.previousDeficitCents ?? 0;
  if (_prevDeficitForRow < 0) {
    const dateLabel = (() => {
      const iso = data.previousDeficitSourceDate;
      if (!iso) return "";
      const [y, m, d] = iso.split("-");
      return ` (${d}.${m}.${y})`;
    })();
    summaryRows.push([
      {
        content: `Fehlbetrag Vortag${dateLabel}`,
        styles: { textColor: RED },
      },
      {
        content: fmtEur(_prevDeficitForRow),
        styles: { halign: "right", textColor: RED },
      },
    ]);
  }
  summaryRows.push([
    {
      content: "Differenz zum Wechselgeldbestand",
      styles: {
        fontStyle: "bold",
        fontSize: 10,
        fillColor: [255, 255, 255],
        lineWidth: 0.5,
        lineColor: [0, 0, 0],
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      },
    },
    {
      content: fmtEurSigned(_diffToTargetCents),
      styles: {
        fontStyle: "bold",
        fontSize: 10,
        fillColor: [255, 255, 255],
        halign: "right",
        ...(_diffColor ? { textColor: _diffColor } : {}),
        lineWidth: 0.5,
        lineColor: [0, 0, 0],
        cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
      },
    },
  ]);

  autoTable(doc, {
    startY: columnsStartY,
    margin: { left: leftX, right: pageWidth - leftX - leftColWidth },
    body: summaryRows,
    theme: "plain",
    bodyStyles: {
      fontSize: 9,
      cellPadding: { top: 1, bottom: 1, left: 2, right: 2 },
      overflow: "ellipsize",
    },
    columnStyles: { 1: { halign: "right" } },
    tableWidth: leftColWidth,
  });
  let leftEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Wechselgeldbestand (berechnet) als Highlight unter Summary
  {
    const cashTarget = data.cashBalanceTargetCents ?? 200_000;
    const { wechselgeldbestandCents } = computeWechselgeld({
      tagesBargeldCents: bargeldCents,
      previousDeficitCents: data.previousDeficitCents ?? 0,
      cashTargetCents: cashTarget,
    });
    leftEndY += 1;
    const fillColor: [number, number, number] =
      wechselgeldbestandCents >= cashTarget ? [220, 252, 231] : [254, 226, 226];
    doc.setFillColor(...fillColor);
    doc.rect(leftX, leftEndY - 4, leftColWidth, 8, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("Wechselgeldbestand", leftX + 2, leftEndY);
    doc.text(fmtEur(wechselgeldbestandCents), leftX + leftColWidth - 2, leftEndY, {
      align: "right",
    });
    leftEndY += 8;
  }

  // ---- RIGHT COLUMN: Mitarbeiter -----------------------------------------
  let rightEndY = columnsStartY;
  if (active.length > 0) {
    const waiterRows: RowInput[] = active.map((s) => [
      s.staffName,
      fmtEur(s.pos_sales_cents),
      fmtTime(s.submitted_at),
      s.corrected_from_id ? fmtTime(s.updated_at) : "---",
      fmtEur(s.kitchen_tip_cents),
    ]);

    autoTable(doc, {
      startY: columnsStartY,
      margin: { left: rightX, right: margin },
      head: [["Mitarbeiter", "Umsatz", "Abgabe", "Geänd.", "TG"]],
      body: waiterRows,
      theme: "plain",
      headStyles: {
        fillColor: SLATE_BG,
        fontSize: 9,
        fontStyle: "bold",
        textColor: SLATE_FG,
      },
      bodyStyles: { fontSize: 9, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "center" },
        3: { halign: "center" },
        4: { halign: "right" },
      },
      tableWidth: rightColWidth,
    });
    rightEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    const sumPos = active.reduce((a, s) => a + s.pos_sales_cents, 0);
    const sumKitchenTip = active.reduce((a, s) => a + s.kitchen_tip_cents, 0);
    // Tip = Pool-Formel (Spicery-Abrechnung): kanonisch in computeTipTotalCents.
    const sumTipAll = computeTipTotalCents(
      active.map((s) => ({
        cardTotalCents: s.card_total_cents,
        cashHandedInCents: s.cash_handed_in_cents,
        posSalesCents: s.pos_sales_cents,
        openInvoicesCents: s.open_invoices_cents,
        hilfMahlCents: s.hilf_mahl_cents,
        kassiertBruttoCents: s.kassiert_brutto_cents ?? s.pos_sales_cents,
      })),
    );
    const servicePoolEnabled = data.servicePoolEnabled !== false;
    // Kanonischer Service-Pool aus dem Overview bevorzugen; nur wenn der
    // Aufrufer keinen Wert durchreicht, auf die frühere Näherung
    // `max(0, tipAll − kitchen)` zurückfallen (kann negativ werden, wurde
    // historisch auf 0 geklippt — bewusst gleiches Verhalten wie zuvor).
    const sumServicePool = servicePoolEnabled
      ? (data.servicePoolCents ?? Math.max(0, sumTipAll - sumKitchenTip))
      : 0;
    const tipPercent = sumPos > 0 ? (sumTipAll / sumPos) * 100 : 0;

    rightEndY += 4;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.text(
      servicePoolEnabled
        ? `Mitarbeiter-Pool: ${fmtEur(sumServicePool)}  ·  Küchen-Pool: ${fmtEur(sumKitchenTip)}`
        : `Küchen-Pool: ${fmtEur(sumKitchenTip)}`,
      rightX + 2,
      rightEndY,
    );
    rightEndY += 4;
    doc.setFont("helvetica", "bold");
    doc.text(
      `Ø Trinkgeld: ${fmtEur(sumTipAll)} von ${fmtEur(sumPos)} Umsatz = ${tipPercent
        .toFixed(1)
        .replace(".", ",")}%`,
      rightX + 2,
      rightEndY,
    );
    rightEndY += 4;
    doc.setFont("helvetica", "normal");
  }

  // Ausgaben (rechte Spalte)
  if (data.expenses.length > 0) {
    autoTable(doc, {
      startY: rightEndY + 2,
      margin: { left: rightX, right: margin },
      head: [["Ausgaben", "Betrag"]],
      body: [
        ...data.expenses.map((e) => [e.description ?? "", fmtEur(e.amountCents)] as RowInput),
        [
          { content: "Summe", styles: { fontStyle: "bold" } },
          { content: fmtEur(sumExpenses), styles: { fontStyle: "bold", halign: "right" } },
        ],
      ],
      theme: "plain",
      headStyles: { fillColor: SLATE_BG, fontSize: 9, fontStyle: "bold", textColor: SLATE_FG },
      bodyStyles: { fontSize: 9, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } },
      columnStyles: { 1: { halign: "right" } },
      tableWidth: rightColWidth,
    });
    rightEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }

  // Vorschüsse (rechte Spalte)
  if (data.advances.length > 0) {
    autoTable(doc, {
      startY: rightEndY + 2,
      margin: { left: rightX, right: margin },
      head: [["Vorschuss", "Betrag"]],
      body: [
        ...data.advances.map((a) => [a.staffName, fmtEur(a.amountCents)] as RowInput),
        [
          { content: "Summe", styles: { fontStyle: "bold" } },
          { content: fmtEur(sumAdvances), styles: { fontStyle: "bold", halign: "right" } },
        ],
      ],
      theme: "plain",
      headStyles: { fillColor: SLATE_BG, fontSize: 9, fontStyle: "bold", textColor: SLATE_FG },
      bodyStyles: { fontSize: 9, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } },
      columnStyles: { 1: { halign: "right" } },
      tableWidth: rightColWidth,
    });
    rightEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }

  // Notizen
  if (sess.notes && sess.notes.trim().length > 0) {
    rightEndY += 4;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...SLATE_FG);
    doc.text("Notizen", rightX + 2, rightEndY);
    rightEndY += 3;
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    const noteLines = doc.splitTextToSize(sess.notes, rightColWidth - 4) as string[];
    doc.text(noteLines, rightX + 2, rightEndY);
    rightEndY += noteLines.length * 3;
  }

  // ---- Schnittlinie + Wechselgeldbestand-Footer --------------------------
  y = Math.max(leftEndY, rightEndY) + 6;
  {
    const cutLineY = y;
    doc.setDrawColor(120);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([3, 2], 0);
    doc.line(margin, cutLineY, pageWidth - margin, cutLineY);
    doc.setLineDashPattern([], 0);

    const cashTarget = data.cashBalanceTargetCents ?? 200_000;
    const { wechselgeldbestandCents } = computeWechselgeld({
      tagesBargeldCents: bargeldCents,
      previousDeficitCents: data.previousDeficitCents ?? 0,
      cashTargetCents: cashTarget,
    });
    const textY = cutLineY + 12;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text(`Wechselgeldbestand: ${fmtEur(wechselgeldbestandCents)}`, pageWidth / 2, textY, {
      align: "center",
    });

    const now = new Date();
    const ts = `${format(now, "dd.MM.yyyy", { locale: de })} um ${format(now, "HH:mm", {
      locale: de,
    })} Uhr`;
    const by = data.createdByName ? `  –  Abrechnung von ${data.createdByName}` : "";
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`${ts}${by}`, pageWidth / 2, textY + 7, { align: "center" });
    doc.setTextColor(0);
  }

  // Seitenzahl
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(`Seite 1`, pageWidth - margin, pageHeight - 6, { align: "right" });
  doc.setTextColor(0);

  // ---- Vorschuss-Quittungsblätter (je ein Blatt pro Vorschuss) ------------
  if (data.advances.length > 0) {
    const dateLong = format(new Date(sess.business_date + "T00:00:00"), "EEEE, d. MMMM yyyy", {
      locale: de,
    });
    for (const adv of data.advances) {
      doc.addPage();
      let qy = 30;

      // Kopf: Restaurant · Datum
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      const qHeader = data.locationName ? `${data.locationName}  ·  ${dateLong}` : dateLong;
      doc.text(qHeader, pageWidth / 2, qy, { align: "center" });
      qy += 16;

      // Titel
      doc.setFontSize(24);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text("Vorschussquittung", pageWidth / 2, qy, { align: "center" });
      qy += 20;

      doc.setDrawColor(200);
      doc.setLineWidth(0.5);
      doc.line(margin + 20, qy, pageWidth - margin - 20, qy);
      qy += 16;

      // Mitarbeiter
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80);
      doc.text("Mitarbeiter:", pageWidth / 2, qy, { align: "center" });
      qy += 10;
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text(adv.staffName, pageWidth / 2, qy, { align: "center" });
      qy += 16;

      // Betrag
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80);
      doc.text("Betrag:", pageWidth / 2, qy, { align: "center" });
      qy += 10;
      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text(fmtEur(adv.amountCents), pageWidth / 2, qy, { align: "center" });
      qy += 16;

      // optional: Notiz
      if (adv.note && adv.note.trim().length > 0) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100);
        doc.text(`Notiz: ${adv.note}`, pageWidth / 2, qy, { align: "center" });
        doc.setTextColor(0);
        qy += 10;
      }

      qy += 8;
      doc.setDrawColor(200);
      doc.line(margin + 20, qy, pageWidth - margin - 20, qy);
      qy += 16;

      // Bestätigungstext
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0);
      const confirm = "Hiermit bestätige ich, den oben genannten Vorschuss bar erhalten zu haben.";
      const cl = doc.splitTextToSize(confirm, pageWidth - 2 * margin - 40) as string[];
      doc.text(cl, pageWidth / 2, qy, { align: "center" });
      qy += cl.length * 6 + 30;

      // Unterschriftslinie (unten am Blatt)
      const sigY = Math.max(qy, pageHeight - 50);
      doc.setDrawColor(0);
      doc.setLineWidth(0.5);
      doc.line(margin + 30, sigY, pageWidth - margin - 30, sigY);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text("Datum, Unterschrift", pageWidth / 2, sigY + 5, { align: "center" });
      doc.setTextColor(0);
    }
  }

  const fileName = `Tagesabrechnung_${sess.business_date}.pdf`;
  const blob = doc.output("blob");
  return { doc, blob, fileName };
}
