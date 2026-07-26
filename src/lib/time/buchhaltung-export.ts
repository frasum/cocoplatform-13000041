// Buchhaltung-Export (PDF + Excel). Reine Funktionen, ohne React-Abhängigkeit.
// Spalten je nach §3b-Modus dynamisch. Provisions-Parameter bewusst weggelassen.

export type BuchhaltungMode = "simple" | "section3b";

import { floorToQuarterHours } from "./zeit-uebersicht-core";

// BH1 (24.07.2026) — payroll-relevante Stunden-Spalten (totalHours, evening,
// night, sunHol/sonntag/feiertag/feiertag150) runden Anzeige UND Export auf
// volle Viertelstunden AB (edlohn-Übergabe). Detail-Zellen der
// Zusammenfassung, Zähler (Schichten, U, K) und Vorschuss bleiben exakt.

export type BuchhaltungExportRow = {
  displayName: string;
  /** Voller Name „Vorname Nachname" (leer, wenn identisch mit Rufnamen). */
  fullName?: string;
  /** Personalnummer (int) — nur im Export sichtbar. */
  persoNr?: number | null;
  totalHours: number;
  shifts: number;
  evening: number; // 20–24
  night: number; // 24–X
  sunHol: number; // SO/FEI (simple)
  sonntag: number; // §3b
  feiertag: number; // §3b 125 %
  feiertag150: number; // §3b 150 %
  urlaubDays: number;
  krankDays: number;
  vorschussEUR: number;
  besonderheiten: string;
  /** Auto-Teil aus Urlaub/Krank (siehe formatAbsenceNote). Wird NIE gespeichert. */
  absenceNote?: string;
};

export type BuchhaltungExportInput = {
  locationLabel: string;
  periodLabel: string;
  rangeLabel: string; // "26.05.–25.06.2026"
  mode: BuchhaltungMode;
  rowsByDept: { dept: string; deptLabel: string; rows: BuchhaltungExportRow[] }[];
};

function fmtDec(n: number): string {
  return n.toFixed(2).replace(".", ",");
}
function fmtEUR(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function columns(
  mode: BuchhaltungMode,
): { key: keyof BuchhaltungExportRow | "name"; label: string }[] {
  const base: { key: keyof BuchhaltungExportRow | "name"; label: string }[] = [
    { key: "name", label: "Mitarbeiter" },
    { key: "fullName", label: "Vollname" },
    { key: "persoNr", label: "Pers.-Nr." },
    { key: "totalHours", label: "Gesamt" },
    { key: "shifts", label: "Schichten" },
    { key: "evening", label: "20–24" },
    { key: "night", label: "24–X" },
  ];
  if (mode === "section3b") {
    base.push(
      { key: "sonntag", label: "Sonntag" },
      { key: "feiertag", label: "Feiertag" },
      { key: "feiertag150", label: "Feiertag 150%" },
    );
  } else {
    base.push({ key: "sunHol", label: "SO/FEI" });
  }
  base.push(
    { key: "urlaubDays", label: "U" },
    { key: "krankDays", label: "K" },
    { key: "vorschussEUR", label: "Vorschuss" },
    { key: "besonderheiten", label: "Besonderheiten" },
  );
  return base;
}

function cellValue(row: BuchhaltungExportRow, key: string): string | number {
  switch (key) {
    case "name":
      return row.displayName;
    case "fullName":
      return row.fullName ?? "";
    case "persoNr":
      return row.persoNr != null ? row.persoNr : "";
    case "totalHours":
      return fmtDec(floorToQuarterHours(row.totalHours));
    case "shifts":
      return row.shifts;
    case "evening":
      return fmtDec(floorToQuarterHours(row.evening));
    case "night":
      return fmtDec(floorToQuarterHours(row.night));
    case "sunHol":
      return fmtDec(floorToQuarterHours(row.sunHol));
    case "sonntag":
      return fmtDec(floorToQuarterHours(row.sonntag));
    case "feiertag":
      return fmtDec(floorToQuarterHours(row.feiertag));
    case "feiertag150":
      return fmtDec(floorToQuarterHours(row.feiertag150));
    case "urlaubDays":
      return row.urlaubDays > 0 ? row.urlaubDays : "";
    case "krankDays":
      return row.krankDays > 0 ? row.krankDays : "";
    case "vorschussEUR":
      return row.vorschussEUR > 0 ? fmtEUR(row.vorschussEUR) : "";
    case "besonderheiten":
      return [row.absenceNote ?? "", row.besonderheiten ?? ""]
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join(" | ");
    default:
      return "";
  }
}

function totals(rows: BuchhaltungExportRow[]): BuchhaltungExportRow {
  // BH1 — Summe = Σ der GERUNDETEN Personenwerte (die Fußzeile ist exakt
  // das, was das Lohnbüro überträgt). Für Zähler (shifts/urlaub/krank) und
  // Vorschuss bleibt es bei der Rohsumme.
  const sum = (sel: (r: BuchhaltungExportRow) => number) => rows.reduce((a, r) => a + sel(r), 0);
  const sumQ = (sel: (r: BuchhaltungExportRow) => number) =>
    rows.reduce((a, r) => a + floorToQuarterHours(sel(r)), 0);
  return {
    displayName: "",
    totalHours: sumQ((r) => r.totalHours),
    shifts: sum((r) => r.shifts),
    evening: sumQ((r) => r.evening),
    night: sumQ((r) => r.night),
    sunHol: sumQ((r) => r.sunHol),
    sonntag: sumQ((r) => r.sonntag),
    feiertag: sumQ((r) => r.feiertag),
    feiertag150: sumQ((r) => r.feiertag150),
    urlaubDays: sum((r) => r.urlaubDays),
    krankDays: sum((r) => r.krankDays),
    vorschussEUR: sum((r) => r.vorschussEUR),
    besonderheiten: "",
  };
}

export function buildBuchhaltungFileBase(input: BuchhaltungExportInput): string {
  const loc = input.locationLabel.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const per = input.periodLabel.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const suffix = input.mode === "section3b" ? "_3b" : "";
  return `Buchhaltung_${loc}_${per}${suffix}`;
}

// ---------- CSV ----------
//
// Reine Serialisierung analog `lohn-csv-export.ts`: UTF-8 BOM, Trenner `;`,
// Zeilenende `\r\n`. Zahlen in deutscher Notation (Komma). Abteilungs-
// Zwischenüberschriften als Kommentarzeile (`# …`). Für Payroll gedacht,
// damit die Werte 1:1 in Excel/edlohn übernommen werden können.

const CSV_SEP = ";";
const CSV_EOL = "\r\n";
const CSV_BOM = "\uFEFF";

function csvEscape(v: string | number): string {
  const s = String(v);
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildBuchhaltungCsv(input: BuchhaltungExportInput): string {
  const cols = columns(input.mode);
  const lines: string[] = [];

  const modeLabel = input.mode === "section3b" ? "§3b" : "Einfach";
  lines.push(
    `# COCO Buchhaltung${CSV_SEP} Standort=${input.locationLabel}${CSV_SEP} Periode=${input.periodLabel}${CSV_SEP} Zeitraum=${input.rangeLabel}${CSV_SEP} Modus=${modeLabel}`,
  );
  lines.push(cols.map((c) => csvEscape(c.label)).join(CSV_SEP));

  const allRows: BuchhaltungExportRow[] = [];
  for (const grp of input.rowsByDept) {
    if (grp.rows.length === 0) continue;
    lines.push(`# ${grp.deptLabel.toUpperCase()}`);
    for (const row of grp.rows) {
      lines.push(cols.map((c) => csvEscape(cellValue(row, c.key as string))).join(CSV_SEP));
      allRows.push(row);
    }
  }

  if (allRows.length > 0) {
    const sum = totals(allRows);
    const sumCells = cols.map((c, idx) =>
      csvEscape(idx === 0 ? "Summe" : cellValue(sum, c.key as string)),
    );
    lines.push(sumCells.join(CSV_SEP));
  }

  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

// ---------- Excel ----------

export async function buildBuchhaltungXlsx(input: BuchhaltungExportInput): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Coco";
  const ws = wb.addWorksheet("Buchhaltung");
  const cols = columns(input.mode);

  ws.addRow(cols.map((c) => c.label)).font = { bold: true };

  const allRows: BuchhaltungExportRow[] = [];
  for (const grp of input.rowsByDept) {
    if (grp.rows.length === 0) continue;
    const h = ws.addRow([grp.deptLabel.toUpperCase()]);
    h.font = { bold: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
    for (const row of grp.rows) {
      ws.addRow(cols.map((c) => cellValue(row, c.key as string)));
      allRows.push(row);
    }
  }
  if (allRows.length > 0) {
    const sum = totals(allRows);
    const row = ws.addRow(
      cols.map((c, idx) => (idx === 0 ? "Summe" : cellValue(sum, c.key as string))),
    );
    row.font = { bold: true };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  }

  ws.getColumn(1).width = 24;
  for (let i = 2; i <= cols.length; i++) {
    ws.getColumn(i).width = cols[i - 1].key === "besonderheiten" ? 28 : 12;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------- PDF ----------

export async function buildBuchhaltungPdf(input: BuchhaltungExportInput): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  type RowInput = Parameters<typeof autoTable>[1]["body"] extends ReadonlyArray<infer R> | undefined
    ? R
    : never;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(
    `Buchhaltung — ${input.locationLabel} · ${input.periodLabel} (${input.rangeLabel})${
      input.mode === "section3b" ? "  ·  §3b" : ""
    }`,
    40,
    36,
  );

  const cols = columns(input.mode);
  const head = [cols.map((c) => c.label)];
  type Body = (string | number | { content: string; styles?: object; colSpan?: number })[];
  const body: Body[] = [];
  const allRows: BuchhaltungExportRow[] = [];
  for (const grp of input.rowsByDept) {
    if (grp.rows.length === 0) continue;
    body.push([
      {
        content: grp.deptLabel.toUpperCase(),
        colSpan: cols.length,
        styles: { fontStyle: "bold", fillColor: [237, 237, 237] },
      },
    ]);
    for (const r of grp.rows) {
      body.push(cols.map((c) => cellValue(r, c.key as string)));
      allRows.push(r);
    }
  }
  if (allRows.length > 0) {
    const sum = totals(allRows);
    const sumRow: Body = cols.map((c, idx) =>
      idx === 0
        ? { content: "Summe", styles: { fontStyle: "bold", fillColor: [243, 244, 246] } }
        : {
            content: String(cellValue(sum, c.key as string)),
            styles: { fontStyle: "bold", fillColor: [243, 244, 246], halign: "right" },
          },
    );
    body.push(sumRow);
  }

  autoTable(doc, {
    head: head as RowInput[],
    body: body as RowInput[],
    startY: 56,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, halign: "center" },
    columnStyles: Object.fromEntries(
      cols.map((c, i) => [i, { halign: i === 0 || c.key === "besonderheiten" ? "left" : "right" }]),
    ),
    theme: "grid",
  });

  return doc.output("blob");
}
