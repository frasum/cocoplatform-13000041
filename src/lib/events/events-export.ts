// EX-EV1 — Export der Veranstaltungsliste als CSV und XLSX.
//
// Reine Bauteile: `buildEventsCsv` ist eine pure Funktion (testbar), die
// XLSX-Erzeugung lädt exceljs dynamisch (nur im Browser-Pfad genutzt).

import { IMPACT_LABEL, type EventRow } from "./events-core";

export const EVENT_EXPORT_HEADERS = [
  "Von",
  "Bis",
  "Name",
  "Kategorie",
  "Impact",
  "Location",
  "Distanz",
  "Empfehlung",
  "Quelle",
  "Vorläufig",
] as const;

export function eventExportRow(row: EventRow): string[] {
  return [
    row.dateFrom,
    row.dateTo,
    row.name,
    row.category,
    IMPACT_LABEL[row.impact],
    row.locationText ?? "",
    row.distanceText ?? "",
    row.recommendation ?? "",
    row.source ?? "",
    row.provisional ? "ja" : "nein",
  ];
}

function csvCell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Semikolon-getrennt (Excel-DE) mit BOM, damit Umlaute korrekt ankommen. */
export function buildEventsCsv(rows: EventRow[]): string {
  const lines = [
    EVENT_EXPORT_HEADERS.map(csvCell).join(";"),
    ...rows.map((r) => eventExportRow(r).map(csvCell).join(";")),
  ];
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

export function eventsCsvBlob(rows: EventRow[]): Blob {
  return new Blob([buildEventsCsv(rows)], { type: "text/csv" });
}

export async function eventsXlsxBlob(rows: EventRow[]): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Veranstaltungen");
  ws.addRow([...EVENT_EXPORT_HEADERS]);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(eventExportRow(r));
  ws.columns.forEach((col, i) => {
    col.width = [12, 12, 38, 16, 14, 26, 12, 44, 22, 10][i] ?? 16;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
