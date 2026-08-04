// DR1 — HTML-Druckansicht für die Tagesabrechnung (Safari-fest).
//
// Warum HTML statt PDF-iframe: Safari (Mac/Frank) druckt eingebettete PDFs
// unzuverlässig (Leerseiten-Bug). Ein `srcdoc`-iframe mit statischem HTML +
// `@media print`-CSS wird von Safari UND Chrome zuverlässig gedruckt.
//
// Datenquelle: dasselbe `PdfExportData`, das auch `generateDailySummaryPdf`
// konsumiert. Die Zahlen (Kartenabzug via §33-Regel, Tages-Bargeld via
// computeDailyCash, Wechselgeldbestand via computeWechselgeld) werden hier
// erneut mit denselben reinen Modulen berechnet — also KEIN eigenständiger
// Ledger-Pfad, sondern derselbe wie im PDF (KGL-Lektion).

import { computeDailyCashWithTipRemainder, type DayInput } from "@/lib/cash/cash-ledger";
import { computeWechselgeld } from "@/lib/cash/cash-summary";
import { sessionToDayInput } from "@/lib/cash/session-day-input";
import { buildChannelKindMap } from "@/lib/cash/channel-mapping";
import { sumNonGlTerminalCents, resolveChannelKind } from "@/lib/cash/session-channels";
import { sessionHouseCentsFromKasse } from "@/lib/statistics/revenue-core";
import { computeTipTotalCents } from "@/lib/cash/tip-pool";
import type { PdfExportData } from "@/lib/cash/pdfExport";

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtEur(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
}

// DR4: Vorzeichen-Formatter für die Wechselgeld-Differenz. Positiv (in Tresor
// zu legen) mit „+"-Präfix, negativ mit Minus (Intl liefert es automatisch),
// 0 ohne Vorzeichen.
function fmtEurSigned(cents: number | null | undefined): string {
  const c = cents ?? 0;
  const s = fmtEur(c);
  return c > 0 ? `+${s}` : s;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "---";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "---";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDateLong(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtDeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

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

function channelLabel(data: PdfExportData, kind: ChannelKindKey, fallback: string): string {
  return data.channels.find((c) => (c.kind as ChannelKindKey) === kind)?.label ?? fallback;
}

const PRINT_CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #111;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 18pt; margin: 0; text-align: center; font-weight: 700; }
  .sub { text-align: center; font-size: 8pt; color: #666; margin: 2mm 0 6mm; }
  .cols { display: grid; grid-template-columns: 45fr 55fr; gap: 6mm; }
  section { page-break-inside: avoid; break-inside: avoid; }
  h2 {
    font-size: 9pt; text-transform: uppercase; letter-spacing: .04em;
    color: #334155; background: #f1f5f9; padding: 1.2mm 2mm;
    margin: 3mm 0 1mm; border-radius: 1mm;
  }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  td, th { padding: 0.8mm 2mm; vertical-align: top; }
  th { text-align: left; background: #f1f5f9; color: #334155; font-weight: 700; font-size: 9pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mid, th.mid { text-align: center; }
  tr.total td { font-weight: 700; }
  tr.row + tr.row td { border-top: 1px solid #f1f5f9; }
  .box { border: 1px solid #111; padding: 2mm 2.5mm; display: flex; justify-content: space-between; font-weight: 700; margin-top: 2mm; }
  .highlight { padding: 1.5mm 2mm; display: flex; justify-content: space-between; font-weight: 700; margin-top: 1mm; border-radius: 1mm; }
  .highlight.pos { background: #dcfce7; color: #166534; }
  .highlight.neg { background: #fee2e2; color: #b91c1c; }
  .cut { border-top: 1px dashed #999; margin-top: 6mm; padding-top: 4mm; text-align: center; }
  .cut h3 { font-size: 14pt; margin: 0; font-weight: 700; }
  .cut .who { font-size: 9pt; color: #666; margin-top: 2mm; }
  .notes { margin-top: 3mm; }
  .notes h4 { font-size: 8pt; text-transform: uppercase; color: #334155; margin: 0 0 1mm; }
  .notes p { font-size: 8.5pt; white-space: pre-wrap; margin: 0; }
  .quittung { page-break-before: always; padding: 20mm 0 0; text-align: center; }
  .quittung .head { color: #666; font-size: 11pt; margin-bottom: 8mm; }
  .quittung h2 { background: transparent; color: #111; font-size: 22pt; letter-spacing: 0; text-transform: none; margin: 0 0 6mm; }
  .quittung hr { border: none; border-top: 1px solid #ccc; margin: 6mm 20mm; }
  .quittung .lbl { color: #555; font-size: 12pt; margin-top: 4mm; }
  .quittung .val { font-size: 18pt; font-weight: 700; margin-top: 2mm; }
  .quittung .val.big { font-size: 24pt; }
  .quittung .confirm { font-size: 10pt; margin-top: 10mm; padding: 0 15mm; }
  .quittung .sig { border-top: 1px solid #111; margin: 24mm 30mm 0; padding-top: 2mm; font-size: 8.5pt; color: #666; }
  @media print { .no-print { display: none !important; } }
`;

/**
 * Reines HTML für den Druck. Verwendet für Zahlen dieselben reinen Module wie
 * das PDF (sumNonGlTerminalCents, sessionToDayInput, computeDailyCash,
 * computeWechselgeld). Reihenfolge folgt dem PDF-Layout.
 */
export function renderDailyPrintHtml(data: PdfExportData): string {
  const sess = data.session;
  const totals = totalsByKind(data);
  const active = data.settlements.filter((s) => s.status !== "superseded");

  const posTotal = Number(sess.vectron_daily_total_cents ?? 0);
  // N14 (Fachentscheidung Frank 13.07.): ⌀ pro Gast = Haus-Umsatz / Gäste
  // — Wolt/SoUse/eigener Außer-Haus raus. Gemeinsamer Helfer mit
  // Bildschirm und PDF.
  const kindById = buildChannelKindMap(data.channelKinds ?? data.channels);
  const houseCentsForAvg = sessionHouseCentsFromKasse({
    vectronCents: posTotal,
    channels: data.channelAmounts.map((a) => ({
      kind: resolveChannelKind(kindById, a.channelId),
      amountCents: a.amountCents,
    })),
  });

  // §33: GL-Terminals mindern das Bargeld nicht → identische Regel wie im PDF.
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

  const vouchersSold = Number(sess.vouchers_sold_cents ?? 0);
  const vouchersRedeemed = Number(sess.vouchers_redeemed_cents ?? 0);
  const finedine = Number(sess.finedine_vouchers_cents ?? 0);
  const einladung = Number(sess.einladung_cents ?? 0);
  const sonstige = Number(sess.sonstige_einnahme_cents ?? 0);

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

  const cashTarget = data.cashBalanceTargetCents ?? 200_000;
  const previousDeficit = data.previousDeficitCents ?? 0;
  const { wechselgeldbestandCents, diffToTargetSignedCents } = computeWechselgeld({
    tagesBargeldCents: bargeldCents,
    previousDeficitCents: previousDeficit,
    cashTargetCents: cashTarget,
  });

  const hasTakeAway =
    totals.delivery_souse !== 0 ||
    totals.delivery_wolt !== 0 ||
    totals.delivery_vectron !== 0 ||
    data.channels.some((c) => c.kind.startsWith("delivery_"));

  const headline = data.locationName
    ? `${esc(data.locationName)} · ${esc(fmtDateLong(sess.business_date))}`
    : esc(fmtDateLong(sess.business_date));

  const now = new Date();
  const nowStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}.${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;

  const subParts: string[] = [];
  if (data.createdByName) subParts.push(`Erstellt von: ${esc(data.createdByName)}`);
  if (data.managerOnDutyNames && data.managerOnDutyNames.length > 0) {
    subParts.push(`Manager: ${esc(data.managerOnDutyNames.join(", "))}`);
  }
  subParts.push(`Export: ${esc(nowStr)}`);

  const rowKV = (label: string, value: string, extra = ""): string =>
    `<tr class="row"><td${extra}>${label}</td><td class="num"${extra}>${value}</td></tr>`;

  const leftRows: string[] = [];
  leftRows.push(`<h2>Umsatz</h2><table>`);
  leftRows.push(rowKV("POS-Umsatz", fmtEur(posTotal)));
  if ((sess.guest_count ?? 0) > 0) {
    const avg = houseCentsForAvg / sess.guest_count!;
    leftRows.push(
      `<tr class="row"><td colspan="2" style="font-size:8pt;color:#64748b;">Gäste: ${sess.guest_count} · ⌀ pro Gast (Haus) ${fmtEur(avg)}</td></tr>`,
    );
  }
  leftRows.push(`</table>`);

  leftRows.push(`<h2>Kartenzahlung</h2><table>`);
  leftRows.push(rowKV("KK (Terminal)", fmtEur(cardTerminalTotal)));
  leftRows.push(`</table>`);

  if (hasTakeAway) {
    leftRows.push(`<h2>Take Away</h2><table>`);
    if (data.channels.some((c) => c.kind === "delivery_souse")) {
      leftRows.push(
        rowKV(esc(channelLabel(data, "delivery_souse", "SoUse")), fmtEur(totals.delivery_souse)),
      );
    }
    if (data.channels.some((c) => c.kind === "delivery_wolt")) {
      leftRows.push(
        rowKV(esc(channelLabel(data, "delivery_wolt", "Wolt")), fmtEur(totals.delivery_wolt)),
      );
    }
    if (data.channels.some((c) => c.kind === "delivery_vectron")) {
      leftRows.push(
        rowKV(
          esc(channelLabel(data, "delivery_vectron", "Vectron")),
          fmtEur(totals.delivery_vectron),
        ),
      );
    }
    leftRows.push(`</table>`);
  }

  leftRows.push(`<h2>Gutscheine &amp; Abzüge</h2><table>`);
  leftRows.push(rowKV("Gutscheine EL", fmtEur(vouchersRedeemed)));
  leftRows.push(rowKV("Gutschein Verkauf", fmtEur(vouchersSold)));
  if (finedine !== 0) leftRows.push(rowKV("FineDine", fmtEur(finedine)));
  leftRows.push(rowKV("Offen", fmtEur(sumOpen)));
  {
    // Namen der offenen Rechnungen als dezente Unterzeile — hilft bei der
    // Zuordnung, wenn am nächsten Tag jemand nachzahlt.
    const openNames: string[] = [];
    for (const s of active) {
      for (const e of s.openInvoiceEntries ?? []) {
        if (e.name) openNames.push(e.name);
      }
    }
    if (openNames.length > 0) {
      leftRows.push(
        `<tr class="row"><td colspan="2" style="font-size:8pt;color:#64748b;padding-top:0;">${esc(openNames.join(" · "))}</td></tr>`,
      );
    }
  }
  leftRows.push(rowKV("Personal", fmtEur(sumAdvances)));
  leftRows.push(rowKV("Einladung", fmtEur(einladung)));
  leftRows.push(rowKV("Sonstige Einnahmen", fmtEur(sonstige)));
  leftRows.push(rowKV("Bar Ausgaben", fmtEur(sumExpenses)));
  leftRows.push(`</table>`);

  leftRows.push(`<h2>Ergebnis</h2>`);
  leftRows.push(
    `<div class="highlight ${bargeldCents >= 0 ? "pos" : "neg"}"><span>Tages-Bargeld</span><span>${fmtEur(bargeldCents)}</span></div>`,
  );
  leftRows.push(`<table><tbody>${rowKV("Hilf Mahl", fmtEur(sumHilf))}</tbody></table>`);
  if (previousDeficit < 0) {
    const dateLabel = data.previousDeficitSourceDate
      ? ` (${fmtDeShort(data.previousDeficitSourceDate)})`
      : "";
    leftRows.push(
      `<div class="highlight neg"><span>Fehlbetrag Vortag${esc(dateLabel)}</span><span>${fmtEur(previousDeficit)}</span></div>`,
    );
  }
  leftRows.push(
    // WG1: ungekappte, beidseitige Differenz aus dem Core.
    `<div class="box"><span>Differenz zum Wechselgeldbestand</span><span>${fmtEurSigned(
      diffToTargetSignedCents,
    )}</span></div>`,
  );
  leftRows.push(
    `<div class="highlight ${wechselgeldbestandCents >= cashTarget ? "pos" : "neg"}"><span>Wechselgeldbestand</span><span>${fmtEur(wechselgeldbestandCents)}</span></div>`,
  );

  // ---- Right column ----
  const rightParts: string[] = [];
  if (active.length > 0) {
    rightParts.push(
      `<section><table><thead><tr><th>Mitarbeiter</th><th class="num">Umsatz</th><th class="mid">Abgabe</th><th class="mid">Geänd.</th><th class="num">TG</th></tr></thead><tbody>`,
    );
    for (const s of active) {
      rightParts.push(
        `<tr class="row"><td>${esc(s.staffName)}</td><td class="num">${fmtEur(s.pos_sales_cents)}</td><td class="mid">${fmtTime(s.submitted_at)}</td><td class="mid">${s.corrected_from_id ? fmtTime(s.updated_at) : "---"}</td><td class="num">${fmtEur(s.kitchen_tip_cents)}</td></tr>`,
      );
    }
    rightParts.push(`</tbody></table>`);

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
        kassiertBruttoCents:
          (s as unknown as { kassiert_brutto_cents?: number }).kassiert_brutto_cents ??
          s.pos_sales_cents,
      })),
    );
    const servicePoolEnabled = data.servicePoolEnabled !== false;
    // Kanonischen Service-Pool bevorzugen (siehe pdfExport.ts). An Standorten
    // ohne Service-Pool wird die Zeile weggelassen — ein „Mitarbeiter-Pool:
    // 0,00 €" wäre irreführend.
    const sumServicePool = servicePoolEnabled
      ? (data.servicePoolCents ?? Math.max(0, sumTipAll - sumKitchenTip))
      : 0;
    const tipPercent = sumPos > 0 ? (sumTipAll / sumPos) * 100 : 0;
    rightParts.push(
      servicePoolEnabled
        ? `<p style="font-size:9pt;margin:2mm 0 0;">Mitarbeiter-Pool: ${fmtEur(sumServicePool)} · Küchen-Pool: ${fmtEur(sumKitchenTip)}</p>`
        : `<p style="font-size:9pt;margin:2mm 0 0;">Küchen-Pool: ${fmtEur(sumKitchenTip)}</p>`,
      `<p style="font-size:9pt;margin:1mm 0 0;font-weight:700;">Ø Trinkgeld: ${fmtEur(sumTipAll)} von ${fmtEur(sumPos)} Umsatz = ${tipPercent.toFixed(1).replace(".", ",")}%</p>`,
      `</section>`,
    );
  }

  if (data.expenses.length > 0) {
    rightParts.push(
      `<section><h2>Ausgaben</h2><table><thead><tr><th>Beschreibung</th><th class="num">Betrag</th></tr></thead><tbody>`,
    );
    for (const e of data.expenses) {
      rightParts.push(
        `<tr class="row"><td>${esc(e.description ?? "")}</td><td class="num">${fmtEur(e.amountCents)}</td></tr>`,
      );
    }
    rightParts.push(
      `<tr class="total"><td>Summe</td><td class="num">${fmtEur(sumExpenses)}</td></tr></tbody></table></section>`,
    );
  }

  if (data.advances.length > 0) {
    rightParts.push(
      `<section><h2>Vorschuss</h2><table><thead><tr><th>Mitarbeiter</th><th class="num">Betrag</th></tr></thead><tbody>`,
    );
    for (const a of data.advances) {
      rightParts.push(
        `<tr class="row"><td>${esc(a.staffName)}</td><td class="num">${fmtEur(a.amountCents)}</td></tr>`,
      );
    }
    rightParts.push(
      `<tr class="total"><td>Summe</td><td class="num">${fmtEur(sumAdvances)}</td></tr></tbody></table></section>`,
    );
  }

  if (sess.notes && sess.notes.trim().length > 0) {
    rightParts.push(`<section class="notes"><h4>Notizen</h4><p>${esc(sess.notes)}</p></section>`);
  }

  // Vorschussquittungen (je ein Blatt) – identisch zum PDF
  const quittungen: string[] = [];
  if (data.advances.length > 0) {
    const dateLong = fmtDateLong(sess.business_date);
    for (const adv of data.advances) {
      quittungen.push(
        `<section class="quittung">`,
        `<div class="head">${data.locationName ? esc(data.locationName) + " · " : ""}${esc(dateLong)}</div>`,
        `<h2>Vorschussquittung</h2>`,
        `<hr />`,
        `<div class="lbl">Mitarbeiter:</div>`,
        `<div class="val">${esc(adv.staffName)}</div>`,
        `<div class="lbl">Betrag:</div>`,
        `<div class="val big">${fmtEur(adv.amountCents)}</div>`,
        adv.note && adv.note.trim().length > 0
          ? `<div class="lbl">Notiz: ${esc(adv.note)}</div>`
          : "",
        `<hr />`,
        `<div class="confirm">Hiermit bestätige ich, den oben genannten Vorschuss bar erhalten zu haben.</div>`,
        `<div class="sig">Datum, Unterschrift</div>`,
        `</section>`,
      );
    }
  }

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Tagesabrechnung ${esc(sess.business_date)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>${headline}</h1>
<div class="sub">${subParts.join(" · ")}</div>
<div class="cols">
  <div>${leftRows.join("")}</div>
  <div>${rightParts.join("")}</div>
</div>
<div class="cut">
  <h3>Wechselgeldbestand: ${fmtEur(wechselgeldbestandCents)}</h3>
  <div class="who">${esc(nowStr)}${data.createdByName ? " – Abrechnung von " + esc(data.createdByName) : ""}</div>
</div>
${quittungen.join("")}
</body>
</html>`;
}

/**
 * Öffnet den System-Druckdialog Safari-fest via unsichtbarem srcdoc-iframe.
 * KEIN `window.open` (Popup-Blocker), KEIN Datei-Download.
 */
export function printDailySummary(data: PdfExportData): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const html = renderDailyPrintHtml(data);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      iframe.parentNode?.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  iframe.onload = () => {
    try {
      const w = iframe.contentWindow;
      if (!w) {
        cleanup();
        return;
      }
      // Safari-Timing: winziges Warten, damit Fonts/Layout fertig sind, bevor
      // `print()` den Dialog aufruft.
      w.addEventListener("afterprint", () => window.setTimeout(cleanup, 500));
      window.setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          cleanup();
        }
        // Fallback-Cleanup falls `afterprint` nicht feuert (manche Safari-Versionen).
        window.setTimeout(cleanup, 60_000);
      }, 50);
    } catch {
      cleanup();
    }
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}
