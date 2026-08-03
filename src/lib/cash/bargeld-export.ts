// Excel-Export für die tägliche Bargeldübersicht.
// Spiegelt das Muster aus src/lib/time/weekly-export.ts (exceljs, bereits Dep).

import { formatShortDate } from "@/lib/format-date";
import type { CashDailyRow } from "@/lib/cash/cash.functions";

export async function buildBargeldXlsx(rows: CashDailyRow[], monthLabel: string): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coco";
  const ws = wb.addWorksheet(monthLabel);

  // EX2 — Spaltensatz/Reihenfolge/Labels folgen der Bankeinzahlungs-Vorlage
  // („bankeinzahlung 0726.xls"). Bewusste Abweichung: „offene rechnungen"
  // statt des Vorlagen-Tippfehlers „offene rechnunge".
  ws.addRow([
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
  ]);
  ws.getRow(1).font = { bold: true };

  const money = (c: number) => c / 100;
  for (const r of rows) {
    ws.addRow([
      formatShortDate(r.businessDate),
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

  const sum = (sel: (r: CashDailyRow) => number) => money(rows.reduce((s, r) => s + sel(r), 0));
  ws.addRow([
    "Summe",
    sum((r) => r.tagesumsatzCents),
    sum((r) => r.kreditkartenCents),
    sum((r) => r.deliverySouseCents),
    sum((r) => r.deliveryWoltCents),
    sum((r) => r.vouchersRedeemedCents),
    sum((r) => r.finedineCents),
    sum((r) => r.vouchersSoldCents),
    sum((r) => r.einladungCents),
    sum((r) => r.openInvoicesCents),
    sum((r) => r.vorschussCents),
    sum((r) => r.expensesCents),
    sum((r) => r.bargeldCents),
  ]);
  ws.lastRow!.font = { bold: true };

  for (let col = 2; col <= 13; col++) {
    ws.getColumn(col).numFmt = '#,##0.00 "€"';
    ws.getColumn(col).width = 13;
  }
  ws.getColumn(1).width = 14;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
