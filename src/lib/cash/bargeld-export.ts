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
 *
 * EX2-b (04.08.) — Sonstige Einnahmen sind bar und im gespeicherten Tages-
 * Bargeld enthalten (Tagesabrechnung bleibt so). Für Bank/Export wird das
 * BETRIEBS-Bargeld gezeigt: bargeld − sonstige Einnahmen. Sonstige Einnahmen
 * erscheinen unten als eigener Block.
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

/** Betriebs-Bargeld der Tageszeile (ohne sonstige Einnahmen). */
export function betriebsBargeldCents(r: CashDailyRow): number {
  return r.bargeldCents - r.sonstigeEinnahmeCents;
}

export function assertBargeldFormula(rows: CashDailyRow[], sheetName: string): void {
  for (const r of rows) {
    const expected = bargeldFromRowCents(r);
    const actual = betriebsBargeldCents(r);
    if (expected !== actual) {
      throw new Error(
        `Formeltreue verletzt (${sheetName}, ${r.businessDate}): Spalten ergeben ${expected} Cent, ` +
          `Betriebs-Bargeld ist ${actual} Cent (Bargeld ${r.bargeldCents} − sonstige Einnahmen ` +
          `${r.sonstigeEinnahmeCents}).`,
      );
    }
    // SE1: Die Positionsliste MUSS die ausgewiesene Summe ergeben — sonst
    // stimmt der Block „sonstige einnahmen" nicht mit der Einzahlung überein.
    const positionsSum = r.otherIncomes.reduce((s, o) => s + o.amountCents, 0);
    if (positionsSum !== r.sonstigeEinnahmeCents) {
      throw new Error(
        `Formeltreue verletzt (${sheetName}, ${r.businessDate}): Positionen der sonstigen ` +
          `Einnahmen ergeben ${positionsSum} Cent, ausgewiesen sind ${r.sonstigeEinnahmeCents} Cent.`,
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
        money(betriebsBargeldCents(r)),
      ]);
    }
    const lastDataRow = firstDataRow + sheet.rows.length - 1;

    const sumRow = ws.addRow(["summe"]);
    const sumRowNumber = sumRow.number;
    if (sheet.rows.length > 0) {
      for (let col = 2; col <= HEADERS.length; col++) {
        const letter = ws.getColumn(col).letter;
        sumRow.getCell(col).value = {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        };
      }
    }
    sumRow.font = { bold: true };

    // EX2-b/SE1 — Herkunftstrennung: sonstige Einnahmen unten extra
    // ausgewiesen, je POSITION eine Zeile (Datum · Beschreibung · Betrag).
    const bargeldLetter = ws.getColumn(HEADERS.length).letter;
    const sonstige = sheet.rows.flatMap((r) =>
      r.otherIncomes.map((o) => ({ businessDate: r.businessDate, ...o })),
    );
    ws.addRow([]);
    const blockHeader = ws.addRow(["sonstige einnahmen"]);
    blockHeader.font = { bold: true };
    const firstSonstigeRow = blockHeader.number + 1;
    for (const p of sonstige) {
      const row = ws.addRow([isoToDate(p.businessDate), p.description]);
      row.getCell(HEADERS.length).value = money(p.amountCents);
    }
    const lastSonstigeRow = firstSonstigeRow + sonstige.length - 1;
    const sonstigeSumRow = ws.addRow(["summe sonstige einnahmen"]);
    sonstigeSumRow.getCell(HEADERS.length).value =
      sonstige.length > 0
        ? {
            formula: `SUM(${bargeldLetter}${firstSonstigeRow}:${bargeldLetter}${lastSonstigeRow})`,
          }
        : 0;
    sonstigeSumRow.font = { bold: true };

    const totalRow = ws.addRow(["einzahlung gesamt"]);
    totalRow.getCell(HEADERS.length).value = {
      formula: `${bargeldLetter}${sumRowNumber}+${bargeldLetter}${sonstigeSumRow.number}`,
    };
    totalRow.font = { bold: true };

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
