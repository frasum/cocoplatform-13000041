// EV1-R1 — Parser für den München-Eventkalender (XLSX) des Bauherrn.
//
// Headless wie pos-hourly-parser.ts: Eingabe sind bereits extrahierte
// Zeilen-Arrays, die exceljs-Extraktion lebt in der UI-Schicht. So ist der
// Parser in Node/Vitest testbar und ohne Browser-Bindings.
//
// Blatt „Event-Kalender", Kopfzeile in Zeile 2, Spalten B–J:
//   Von | Bis | Event | Kategorie | Location | Distanz Yum Thai |
//   Erwarteter Impact | Empfehlung Personal/Reservierung | Quelle
// Der Kopf wird über die Spaltentitel gesucht (tolerant); ohne erkennbaren
// Kopf gilt die feste Position B–J als Fallback.
//
// `provisional` (F11) setzt der Bauherr in der Import-UI je Zeile per Hand —
// der Parser rät NICHT aus Texten.

import { mapImpact, type EventImpact } from "./events-core";

export type SheetCell = string | number | Date | null | undefined;
export type SheetRow = readonly SheetCell[];

export type ParsedEventRow = {
  /** 1-basierte Zeilennummer im Blatt (für Fehler- und Vorschau-Bezug). */
  sheetRow: number;
  name: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  locationText: string | null;
  distanceText: string | null;
  impact: EventImpact;
  recommendation: string | null;
  source: string | null;
};

export type ParseEventsResult = {
  rows: ParsedEventRow[];
  errors: { sheetRow: number; message: string }[];
};

type ColumnMap = {
  headerIdx: number;
  from: number;
  to: number;
  name: number;
  category: number;
  location: number;
  distance: number;
  impact: number;
  recommendation: number;
  source: number;
};

// Fallback nach Vorgabe: Spalten B–J (0-basiert 1…9).
const DEFAULT_COLUMNS: Omit<ColumnMap, "headerIdx"> = {
  from: 1,
  to: 2,
  name: 3,
  category: 4,
  location: 5,
  distance: 6,
  impact: 7,
  recommendation: 8,
  source: 9,
};

function text(v: SheetCell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoFromDate(v);
  return String(v).trim();
}

function isoFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Datum aus einer Zelle: ISO-String (YYYY-MM-DD), deutsches Datum
 * (TT.MM.JJJJ), Excel-Seriennummer (1900-System) oder Date-Objekt.
 * Ergebnis immer `YYYY-MM-DD`; `null` wenn nicht deutbar.
 */
export function parseSheetDate(v: SheetCell): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isoFromDate(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    // Excel-1900-System: Seriennummer 25569 entspricht 1970-01-01.
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return isoFromDate(d);
  }
  const raw = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (de) {
    const day = String(Number(de[1])).padStart(2, "0");
    const month = String(Number(de[2])).padStart(2, "0");
    return `${de[3]}-${month}-${day}`;
  }
  return null;
}

function findColumns(raw: readonly SheetRow[]): ColumnMap {
  const maxScan = Math.min(raw.length, 10);
  for (let i = 0; i < maxScan; i++) {
    const cells = (raw[i] ?? []).map((c) => text(c).toLowerCase());
    const find = (pred: (c: string) => boolean) => cells.findIndex(pred);
    const from = find((c) => c === "von" || c.startsWith("von"));
    const to = find((c) => c === "bis" || c.startsWith("bis"));
    const name = find((c) => c === "event" || c.startsWith("event"));
    if (from < 0 || to < 0 || name < 0) continue;
    const category = find((c) => c.startsWith("kategorie"));
    const location = find((c) => c.startsWith("location") || c.startsWith("ort"));
    const distance = find((c) => c.startsWith("distanz") || c.startsWith("entfernung"));
    const impact = find((c) => c.includes("impact"));
    const recommendation = find((c) => c.startsWith("empfehlung"));
    const source = find((c) => c.startsWith("quelle"));
    return {
      headerIdx: i,
      from,
      to,
      name,
      category: category >= 0 ? category : DEFAULT_COLUMNS.category,
      location: location >= 0 ? location : DEFAULT_COLUMNS.location,
      distance: distance >= 0 ? distance : DEFAULT_COLUMNS.distance,
      impact: impact >= 0 ? impact : DEFAULT_COLUMNS.impact,
      recommendation: recommendation >= 0 ? recommendation : DEFAULT_COLUMNS.recommendation,
      source: source >= 0 ? source : DEFAULT_COLUMNS.source,
    };
  }
  // Kein Kopf erkennbar: Vorgabe-Layout, Kopfzeile in Zeile 2 (Index 1).
  return { headerIdx: 1, ...DEFAULT_COLUMNS };
}

function orNull(s: string): string | null {
  return s === "" ? null : s;
}

export function parseEventsSheet(raw: readonly SheetRow[]): ParseEventsResult {
  const cols = findColumns(raw);
  const rows: ParsedEventRow[] = [];
  const errors: { sheetRow: number; message: string }[] = [];

  for (let i = cols.headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] ?? [];
    const sheetRow = i + 1;
    const name = text(row[cols.name]);
    const fromRaw = row[cols.from];
    const toRaw = row[cols.to];
    const impactRaw = row[cols.impact];

    const allEmpty = row.every((c) => text(c) === "");
    if (allEmpty) continue;
    if (name === "" && text(fromRaw) === "") continue;

    if (name === "") {
      errors.push({ sheetRow, message: "Kein Event-Name." });
      continue;
    }
    const dateFrom = parseSheetDate(fromRaw);
    if (!dateFrom) {
      errors.push({ sheetRow, message: `„${name}“: Von-Datum nicht lesbar.` });
      continue;
    }
    const dateTo = parseSheetDate(toRaw) ?? dateFrom;
    if (dateTo < dateFrom) {
      errors.push({ sheetRow, message: `„${name}“: Bis-Datum liegt vor dem Von-Datum.` });
      continue;
    }
    const impact = mapImpact(impactRaw);
    if (!impact) {
      errors.push({
        sheetRow,
        message: `„${name}“: Impact „${text(impactRaw)}“ nicht zuordenbar.`,
      });
      continue;
    }
    const category = text(row[cols.category]);
    if (category === "") {
      errors.push({ sheetRow, message: `„${name}“: Keine Kategorie.` });
      continue;
    }

    rows.push({
      sheetRow,
      name,
      dateFrom,
      dateTo,
      category,
      locationText: orNull(text(row[cols.location])),
      distanceText: orNull(text(row[cols.distance])),
      impact,
      recommendation: orNull(text(row[cols.recommendation])),
      source: orNull(text(row[cols.source])),
    });
  }

  return { rows, errors };
}
