// Excel-Export für die tägliche Bargeldübersicht.
// Spiegelt das Muster aus src/lib/time/weekly-export.ts (exceljs, bereits Dep).
//
// EX2 (03.08.) — Struktur folgt der Bankeinzahlungs-Vorlage
// („bankeinzahlung 0726.xls"): EINE Arbeitsmappe, ein Blatt je Standort,
// Zeile 1 Standortname, Zeile 2 Kopfzeilen, letzte Zeile „summe" mit echten
// Excel-SUM-Formeln. Bewusste Abweichung von der Vorlage: „offene rechnungen"
// statt des Vorlagen-Tippfehlers „offene rechnunge".

import type { CashDailyRow } from "@/lib/cash/cash.functions";

export type BargeldSheet = { locationName: string; rows: CashDailyRow[] };

const HEADERS = [
  "datum",
  "tagesumsatz",
  "kreditkarten",
  "SoUse",
  "Wolt",
  "gutscheine",
  "FineDine",
  "Gutscheine VK",
  "einladung gäste",
  "offene rechnungen",
  "personal",
  "barausgaben",
  "bargeld",
] as const;

/**
 * Formeltreue-Selbsttest (blockierend): die Bargeld-Spalte muss exakt der
 * Vorlagen-Formel über die eigenen Zeilenspalten entsprechen. Keine neue
 * Rechenlogik — nur Absicherung, dass Spaltenauswahl und Bargeld
 * zusammenpassen.
 */
export function bargeldFromRowCents(r: CashDailyRow): number {
  return (
    r.tagesumsatzCents -
    r.kreditkartenCents -
    r.deliverySouseCents -
    r.deliveryWoltCents -
    r.vouchersRedeemedCents -
    r.finedineCents +
    r.vouchersSoldCents -
    r.einladungCents -
    r.openInvoicesCents -
    r.vorschussCents -
    r.expensesCents
  );
}

export function assertBargeldFormula(rows: CashDailyRow[], sheetName: string): void {
  for (const r of rows) {
    const expected = bargeldFromRowCents(r);
    if (expected !== r.bargeldCents) {
      throw new Error(
        `Formeltreue verletzt (${sheetName}, ${r.businessDate}): Spalten ergeben ${expected} Cent, ` +
          `Bargeld ist ${r.bargeldCents} Cent.`,
      );
    }
  }
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export async function buildBargeldXlsx(sheets: BargeldSheet[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coco";

  const money = (c: number) => c / 100;

  for (const sheet of sheets) {
    assertBargeldFormula(sheet.rows, sheet.locationName);
    const ws = wb.addWorksheet(sheet.locationName.slice(0, 31) || "Standort");

    ws.addRow([sheet.locationName]);
    ws.getRow(1).font = { bold: true };
    ws.addRow([...HEADERS]);
    ws.getRow(2).font = { bold: true };

    const firstDataRow = 3;
    for (const r of sheet.rows) {
      ws.addRow([
        isoToDate(r.businessDate),
        money(r.tagesumsatzCents),
        money(r.kreditkartenCents),
        money(r.deliverySouseCents),
        money(r.deliveryWoltCents),
        money(r.vouchersRedeemedCents),
        money(r.finedineCents),
        money(r.vouchersSoldCents),
        money(r.einladungCents),
        money(r.openInvoicesCents),
        money(r.vorschussCents),
        money(r.expensesCents),
        money(r.bargeldCents),
      ]);
    }
    const lastDataRow = firstDataRow + sheet.rows.length - 1;

    const sumRow = ws.addRow(["summe"]);
    if (sheet.rows.length > 0) {
      for (let col = 2; col <= HEADERS.length; col++) {
        const letter = ws.getColumn(col).letter;
        sumRow.getCell(col).value = {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        };
      }
    }
    sumRow.font = { bold: true };

    for (let col = 2; col <= HEADERS.length; col++) {
      ws.getColumn(col).numFmt = '#,##0.00 "€"';
      ws.getColumn(col).width = 13;
    }
    // Wochentag über Zellformat, nicht als Text (Vorlagen-Verhalten).
    ws.getColumn(1).numFmt = "ddd DD.MM.YYYY";
    ws.getColumn(1).width = 18;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
