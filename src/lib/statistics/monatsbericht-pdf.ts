// MB1 — PDF „Monatsbericht" (Partner-Versand). Reine Präsentation, keine
// Berechnungslogik: alle Werte kommen fertig aus `getMonthlyRevenueMatrix`
// bzw. `monthly-core.ts`. Muster wie `statistik-pdf.ts` (dynamische
// jspdf/jspdf-autotable-Imports, läuft komplett im Browser).

import type jsPDF from "jspdf";
import { fmtCents } from "@/lib/format";
import type { MonthlyCell, MonthlyHeadline, YearRow } from "./monthly-core";

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

export type MonatsberichtPdfData = {
  /** z. B. „Juli 2026" */
  monthLabel: string;
  /** "YYYY-MM" — bestimmt den Dateinamen. */
  monthKey: string;
  scopeLabel: string;
  headline: MonthlyHeadline;
  /** Jahreszeilen (aufsteigend) — der Aufrufer schneidet auf ~10 Jahre zu. */
  years: YearRow[];
};

function fmtEur(cents: number): string {
  return `${fmtCents(cents)} €`;
}

function fmtEurOrDash(cents: number | null): string {
  return cents === null ? "—" : fmtEur(cents);
}

function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)} %`;
}

/** Zellwert in T€ — die kompakte Heatmap-Darstellung der Excel-Tabelle. */
export function fmtTsdEuro(cell: MonthlyCell | null): string {
  if (cell === null) return "";
  const tsd = Math.round(cell.totalCents / 100_000);
  return `${tsd}${cell.partial ? "*" : ""}`;
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export async function generateMonatsberichtPdf(
  data: MonatsberichtPdfData,
): Promise<{ doc: jsPDF; blob: Blob; fileName: string }> {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPDF("landscape", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Monatsbericht ${data.monthLabel}`, pageWidth / 2, 44, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(data.scopeLabel, pageWidth / 2, 60, { align: "center" });

  let cursorY = 80;

  // 1) Kennzahlen-Kopf
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Kennzahlen", marginX, cursorY);
  autoTable(doc, {
    startY: cursorY + 6,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles: { 1: { halign: "right" } },
    head: [["Position", "Wert"]],
    body: [
      ["Monatsumsatz", fmtEurOrDash(data.headline.currentCents)],
      ["Vorjahresmonat", fmtEurOrDash(data.headline.previousYearCents)],
      [
        "Veränderung ggü. Vorjahresmonat",
        data.headline.yoyExcludedPartial
          ? "— (laufender Monat)"
          : fmtPct(data.headline.yoyPct),
      ],
      ["Jahressumme bis Monat (YTD)", fmtEur(data.headline.ytdCents)],
      ["Vorjahres-YTD", fmtEurOrDash(data.headline.previousYearYtdCents)],
      ["Veränderung YTD", fmtPct(data.headline.ytdPct)],
      [
        "Bestes Jahr für diesen Monat",
        data.headline.bestForMonth
          ? `${data.headline.bestForMonth.year} · ${fmtEur(data.headline.bestForMonth.totalCents)}`
          : "—",
      ],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 18;

  // 2) Monatsmatrix (Jahre × Monate) in T€
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Monatsumsätze in T€", marginX, cursorY);
  if (data.years.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Keine Monatsdaten vorhanden.", marginX, cursorY + 14);
    cursorY += 24;
  } else {
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 8, cellPadding: 2, halign: "right" },
      headStyles: { fillColor: [230, 230, 230], textColor: 20, halign: "right" },
      columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
      head: [["Jahr", ...MONTH_LABELS, "Gesamt"]],
      body: data.years.map((y) => [
        String(y.year),
        ...y.months.map((m) => fmtTsdEuro(m)),
        String(Math.round(y.totalCents / 100_000)),
      ]),
      theme: "grid",
    });
    cursorY = lastY(doc) + 10;
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Werte in Tausend Euro · * laufender Monat (unvollständig)", marginX, cursorY);
    cursorY += 18;

    // 3) Takeaway je Jahr
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Takeaway je Jahr", marginX, cursorY);
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      head: [["Jahr", "Gesamtumsatz", "davon Takeaway"]],
      body: data.years.map((y) => [
        String(y.year),
        fmtEur(y.totalCents),
        fmtEurOrDash(y.takeawayCents),
      ]),
      theme: "grid",
    });
  }

  const blob = doc.output("blob");
  const fileName = `monatsbericht_${data.monthKey}.pdf`;
  return { doc, blob, fileName };
}
