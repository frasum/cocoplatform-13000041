// Excel-Export für die tägliche Bargeldübersicht.
// Spiegelt das Muster aus src/lib/time/weekly-export.ts (exceljs, bereits Dep).
//
// EX2 (03.08.) — Struktur folgt der Bankeinzahlungs-Vorlage
// („bankeinzahlung 0726.xls"): EINE Arbeitsmappe, ein Blatt je Standort,
// Zeile 1 Standortname, Zeile 2 Kopfzeilen, letzte Zeile „summe" mit echten
// Excel-SUM-Formeln. Bewusste Abweichung von der Vorlage: „offene rechnungen"
// statt des Vorlagen-Tippfehlers „offene rechnunge".

import type { CashDailyRow } from "@/lib/cash/cash.functions";
import { sessionFieldVisible, type SessionFieldKey } from "@/lib/cash/session-fields";

/**
 * EX2-c — Kanal-Spalten je Blatt.
 *
 * `channelKinds` ist die Kanal-Zuordnung des Standorts aus dem KANALKATALOG
 * (`revenue_channels.kind`, aktiv UND inaktiv). Die Auswahl ist bewusst
 * KANALBASIERT, nicht wertbasiert: ein umsatzloser Monat behält seine Spalte,
 * das Blatt-Layout bleibt über Monate stabil.
 */
export type BargeldSheet = {
  locationName: string;
  rows: CashDailyRow[];
  channelKinds: ReadonlySet<string>;
  /**
   * FS1 — am Standort deaktivierte SESSION-FELDER (heute: 'finedine'). Die
   * Spalte entfällt dann — dieselbe Wahrheit wie die Kassenmaske. Trägt ein
   * HISTORISCHER Tag des Zeitraums doch einen Wert, erscheint sie trotzdem
   * (kein Geld verstecken).
   */
  disabledSessionFields?: readonly string[];
};

/** Spalten-Bauplan: Reihenfolge exakt wie die Bankeinzahlungs-Vorlage. */
type ColumnSpec = {
  header: string;
  /** Kanal-Spalte: nur auf Blättern mit dieser Kanal-Zuordnung. */
  channelKind?: string;
  /** FS1: Session-Feld-Spalte — entfällt, wenn das Feld am Standort aus ist. */
  sessionFieldKey?: SessionFieldKey;
  /** Vorzeichen in der Bargeld-Formel (0 = keine Rechengröße). */
  sign: -1 | 0 | 1;
  value: (r: CashDailyRow) => number;
};

const COLUMNS: readonly ColumnSpec[] = [
  { header: "tagesumsatz", sign: 1, value: (r) => r.tagesumsatzCents },
  { header: "kreditkarten", sign: -1, value: (r) => r.kreditkartenCents },
  { header: "SoUse", channelKind: "delivery_souse", sign: -1, value: (r) => r.deliverySouseCents },
  { header: "Wolt", channelKind: "delivery_wolt", sign: -1, value: (r) => r.deliveryWoltCents },
  { header: "gutscheine", sign: -1, value: (r) => r.vouchersRedeemedCents },
  // FS1 (04.08.): FineDine ist ein SESSION-FELD (kein Katalog-Kanal) — die
  // Spalte folgt der Standort-Konfiguration `disabled_session_fields`.
  { header: "FineDine", sessionFieldKey: "finedine", sign: -1, value: (r) => r.finedineCents },
  { header: "Gutscheine VK", sign: 1, value: (r) => r.vouchersSoldCents },
  { header: "einladung gäste", sign: -1, value: (r) => r.einladungCents },
  { header: "offene rechnungen", sign: -1, value: (r) => r.openInvoicesCents },
  { header: "personal", sign: -1, value: (r) => r.vorschussCents },
  { header: "barausgaben", sign: -1, value: (r) => r.expensesCents },
  { header: "bargeld", sign: 0, value: (r) => betriebsBargeldCents(r) },
] as const;

/**
 * Spalten dieses Blatts: Struktur-Spalten immer, Kanal-Spalten nach Katalog,
 * Session-Feld-Spalten nach Standort-Konfiguration (mit Historien-Ausnahme).
 */
export function columnsForSheet(
  channelKinds: ReadonlySet<string>,
  disabledSessionFields: readonly string[] = [],
  rows: readonly CashDailyRow[] = [],
): readonly ColumnSpec[] {
  return COLUMNS.filter((c) => {
    if (c.channelKind !== undefined && !channelKinds.has(c.channelKind)) return false;
    if (c.sessionFieldKey !== undefined) {
      const hasHistory = rows.some((r) => c.value(r) !== 0);
      return sessionFieldVisible(c.sessionFieldKey, disabledSessionFields, hasHistory);
    }
    return true;
  });
}

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
export function bargeldFromRowCents(
  r: CashDailyRow,
  channelKinds: ReadonlySet<string> = ALL_CHANNEL_KINDS,
): number {
  let sum = 0;
  // FS1: Für die Rechnung zählen ALLE Session-Felder — eine ausgeblendete
  // Spalte trägt per Konstruktion 0, ein historischer Wert ≠ 0 wird gezeigt.
  for (const c of columnsForSheet(channelKinds, [], [r])) {
    if (c.sign !== 0) sum += c.sign * c.value(r);
  }
  return sum;
}

/** Alle in COLUMNS geführten Kanal-Arten (Default: nichts wird weggelassen). */
export const ALL_CHANNEL_KINDS: ReadonlySet<string> = new Set(
  COLUMNS.flatMap((c) => (c.channelKind ? [c.channelKind] : [])),
);

/** Betriebs-Bargeld der Tageszeile (ohne sonstige Einnahmen). */
export function betriebsBargeldCents(r: CashDailyRow): number {
  return r.bargeldCents - r.sonstigeEinnahmeCents;
}

export function assertBargeldFormula(
  rows: CashDailyRow[],
  sheetName: string,
  channelKinds: ReadonlySet<string> = ALL_CHANNEL_KINDS,
): void {
  for (const r of rows) {
    // EX2-c: Ein standortfremder Kanal kann per Konstruktion keinen Betrag
    // tragen. Taucht doch einer auf, ist das ein Datenfehler — werfen, nicht
    // stillschweigend aus der Rechnung fallen lassen.
    for (const c of COLUMNS) {
      if (c.channelKind && !channelKinds.has(c.channelKind) && c.value(r) !== 0) {
        throw new Error(
          `Datenfehler (${sheetName}, ${r.businessDate}): Kanal „${c.header}" ist dem Standort ` +
            `nicht zugeordnet, trägt aber ${c.value(r)} Cent.`,
        );
      }
    }
    const expected = bargeldFromRowCents(r, channelKinds);
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
    assertBargeldFormula(sheet.rows, sheet.locationName, sheet.channelKinds);
    const cols = columnsForSheet(sheet.channelKinds);
    const headers = ["datum", ...cols.map((c) => c.header)];
    const ws = wb.addWorksheet(sheet.locationName.slice(0, 31) || "Standort");

    ws.addRow([sheet.locationName]);
    ws.getRow(1).font = { bold: true };
    ws.addRow(headers);
    ws.getRow(2).font = { bold: true };

    const firstDataRow = 3;
    for (const r of sheet.rows) {
      ws.addRow([isoToDate(r.businessDate), ...cols.map((c) => money(c.value(r)))]);
    }
    const lastDataRow = firstDataRow + sheet.rows.length - 1;

    const sumRow = ws.addRow(["summe"]);
    const sumRowNumber = sumRow.number;
    if (sheet.rows.length > 0) {
      for (let col = 2; col <= headers.length; col++) {
        const letter = ws.getColumn(col).letter;
        sumRow.getCell(col).value = {
          formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        };
      }
    }
    sumRow.font = { bold: true };

    // EX2-b/SE1 — Herkunftstrennung: sonstige Einnahmen unten extra
    // ausgewiesen, je POSITION eine Zeile (Datum · Beschreibung · Betrag).
    const bargeldLetter = ws.getColumn(headers.length).letter;
    const sonstige = sheet.rows.flatMap((r) =>
      r.otherIncomes.map((o) => ({ businessDate: r.businessDate, ...o })),
    );
    ws.addRow([]);
    const blockHeader = ws.addRow(["sonstige einnahmen"]);
    blockHeader.font = { bold: true };
    const firstSonstigeRow = blockHeader.number + 1;
    for (const p of sonstige) {
      const row = ws.addRow([isoToDate(p.businessDate), p.description]);
      row.getCell(headers.length).value = money(p.amountCents);
    }
    const lastSonstigeRow = firstSonstigeRow + sonstige.length - 1;
    const sonstigeSumRow = ws.addRow(["summe sonstige einnahmen"]);
    sonstigeSumRow.getCell(headers.length).value =
      sonstige.length > 0
        ? {
            formula: `SUM(${bargeldLetter}${firstSonstigeRow}:${bargeldLetter}${lastSonstigeRow})`,
          }
        : 0;
    sonstigeSumRow.font = { bold: true };

    const totalRow = ws.addRow(["einzahlung gesamt"]);
    totalRow.getCell(headers.length).value = {
      formula: `${bargeldLetter}${sumRowNumber}+${bargeldLetter}${sonstigeSumRow.number}`,
    };
    totalRow.font = { bold: true };

    for (let col = 2; col <= headers.length; col++) {
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
