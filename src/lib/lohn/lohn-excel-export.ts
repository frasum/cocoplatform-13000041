// Excel-Export der Brutto/Netto-Vorschau (2c).
// Nutzt die im Projekt bereits vorhandene `exceljs`-Lib, läuft im Browser.

import type ExcelJS from "exceljs";
import type { Entgeltzeile, LohnErgebnis, PersonenParameter } from "./types";
import type { SfnGeldErgebnis } from "./sfn-geld/types";
import { isZeitlohnKategorie } from "./kategorie";
import { downloadBlob as downloadBrowserBlob } from "@/lib/time/weekly-export";
import { LohnExportBlockedError, type StaffBlocker } from "./export-blockers";

export interface LohnExportInput {
  staffLabel: string;
  fromDate: string;
  toDate: string;
  mode: "simple" | "extended";
  totalHours: number;
  hourlyRateCents: number;
  entryCount: number;
  zuschlagCents: number;
  buckets: SfnGeldErgebnis;
  person: PersonenParameter;
  zeilen: Entgeltzeile[];
  ergebnis: LohnErgebnis;
  /**
   * LG3b A4 — Export-Gate. Ist die Liste nicht leer, wirft `buildLohnXlsx`
   * `LohnExportBlockedError` vor dem Erzeugen der Mappe. Panel prüft für die
   * ausgewählte Person; Übersichts-Gate sitzt in `buildUebersichtCsv`.
   */
  blockers?: readonly StaffBlocker[];
}

const EUR = '#,##0.00\\ "€";[Red]-#,##0.00\\ "€"';
const HRS = "#,##0.00";

function setKv(
  sheet: ExcelJS.Worksheet,
  row: number,
  key: string,
  value: string | number,
  fmt?: string,
  strong = false,
) {
  const a = sheet.getCell(`A${row}`);
  const b = sheet.getCell(`B${row}`);
  a.value = key;
  b.value = value;
  if (fmt) b.numFmt = fmt;
  if (strong) {
    a.font = { bold: true };
    b.font = { bold: true };
  }
}

function sectionHeader(sheet: ExcelJS.Worksheet, row: number, title: string) {
  const cell = sheet.getCell(`A${row}`);
  cell.value = title;
  cell.font = { bold: true, size: 12 };
  sheet.mergeCells(`A${row}:B${row}`);
}

export async function buildLohnXlsx(d: LohnExportInput): Promise<Blob> {
  if (d.blockers && d.blockers.length > 0) {
    throw new LohnExportBlockedError(d.blockers);
  }
  const ExcelJSRuntime = (await import("exceljs")).default;
  const wb = new ExcelJSRuntime.Workbook();
  wb.creator = "COCO";
  wb.created = new Date();

  // --- Übersicht ---
  const s = wb.addWorksheet("Übersicht");
  s.columns = [{ width: 38 }, { width: 22 }];

  sectionHeader(s, 1, "Lohnabrechnung (Vorschau)");
  let r = 2;
  setKv(s, r++, "Mitarbeiter", d.staffLabel);
  setKv(s, r++, "Periode", `${d.fromDate} – ${d.toDate}`);
  setKv(s, r++, "SFN-Modus", d.mode);
  setKv(s, r++, "Einträge", d.entryCount);
  r++;

  sectionHeader(s, r++, "Periode");
  setKv(s, r++, "Stunden gesamt", d.totalHours, HRS);
  setKv(s, r++, "Stundensatz", d.hourlyRateCents / 100, EUR);
  // N16 (13.07.): Zeitlohn NICHT hier zweitberechnen — den bereits vom
  // Lohn-Kern erzeugten Betrag der Entgeltzeile ausgeben. Eine Lohnformel,
  // ein Ort (`lohn-rechner.functions.ts`); der Excel-Export ist reine
  // Ausgabe. Regressionstest: `lohn-excel-export.regression.test.ts`.
  // LG3b 2b — alle vom Lohn-Kern erzeugten Zeitlohn-Zeilen (A3) aufsummieren.
  // Bei Mehr-Bereichs-Personen sind das `zeitlohn` + `zeitlohn_2` + `zeitlohn_3`;
  // der Alt-Filter auf genau eine Kategorie verlor die _2/_3-Beträge.
  const zeitlohnCent = d.zeilen
    .filter((z) => isZeitlohnKategorie(z.kategorie, d.person.beschaeftigung))
    .reduce((sum, z) => sum + z.betragCent, 0);
  setKv(s, r++, "Zeitlohn (Stunden × Satz)", zeitlohnCent / 100, EUR);
  setKv(s, r++, "SFN-Zuschläge", d.zuschlagCents / 100, EUR);
  r++;

  sectionHeader(s, r++, "SFN-Töpfe (Stunden)");
  setKv(s, r++, "Nacht 25 %", d.buckets.night25Hours, HRS);
  setKv(s, r++, "Nacht 40 %", d.buckets.night40Hours, HRS);
  setKv(s, r++, "Sonntag", d.buckets.sundayHours, HRS);
  setKv(s, r++, "Feiertag", d.buckets.holidayHours, HRS);
  setKv(s, r++, "Feiertag 150 %", d.buckets.holiday150Hours, HRS);
  r++;

  // LG3b 2b — Lohnart-Split je Bereich, direkt aus den A3-Entgeltzeilen.
  // Zeigt für Mehr-Bereichs-Personen alle Zeitlohn-Zeilen einzeln;
  // Ein-Bereichs-Personen erhalten wie bisher eine Zeile. Neben dem Betrag
  // wird der Bereichssatz (€/h) ausgewiesen — edlohn spielt Stunden + Satz
  // je Lohnart ein, der Betrag ist ableitbar, der Satz nicht (0-€-Zeilen).
  const zeitlohnZeilen = d.zeilen.filter((z) =>
    isZeitlohnKategorie(z.kategorie, d.person.beschaeftigung),
  );
  if (zeitlohnZeilen.length > 0) {
    sectionHeader(s, r++, "Lohnart-Split (Bereich)");
    for (const z of zeitlohnZeilen) {
      setKv(s, r++, z.bezeichnung ?? z.kategorie, z.betragCent / 100, EUR);
      setKv(
        s,
        r++,
        `${z.bezeichnung ?? z.kategorie} — Satz`,
        z.satzCent != null ? z.satzCent / 100 : "—",
        z.satzCent != null ? EUR : undefined,
      );
    }
    r++;
  }

  sectionHeader(s, r++, "Personenparameter");
  setKv(s, r++, "Steuerklasse", d.person.steuerklasse);
  setKv(s, r++, "Kinderfreibeträge (ZKF)", d.person.zkf);
  setKv(s, r++, "KV-Zusatzbeitrag (%)", d.person.kvzProzent);
  setKv(s, r++, "Kirchensteuer (BY)", d.person.kirchensteuerBayern ? "ja" : "nein");
  setKv(s, r++, "Anzahl Kinder", d.person.kinderzahl);
  setKv(s, r++, "Elterneigenschaft", d.person.elterneigenschaft ? "ja" : "nein");
  setKv(s, r++, "PV-Kinderlosen-Zuschlag", d.person.pvKinderlosZuschlag ? "ja" : "nein");
  setKv(s, r++, "Beschäftigung", d.person.beschaeftigung);
  r++;

  sectionHeader(s, r++, "Ergebnis");
  setKv(s, r++, "Gesamtbrutto", d.ergebnis.gesamtbruttoCent / 100, EUR);
  setKv(s, r++, "St-/SV-Brutto", d.ergebnis.stSvBruttoCent / 100, EUR);
  setKv(s, r++, "St-Brutto (Ausweis)", d.ergebnis.stBruttoAusweisCent / 100, EUR);
  setKv(s, r++, "Lohnsteuer", d.ergebnis.lstCent / 100, EUR);
  setKv(s, r++, "Soli", d.ergebnis.soliCent / 100, EUR);
  setKv(s, r++, "Kirchensteuer", d.ergebnis.kistCent / 100, EUR);
  setKv(s, r++, "KV (AN)", d.ergebnis.kvCent / 100, EUR);
  setKv(s, r++, "RV (AN)", d.ergebnis.rvCent / 100, EUR);
  setKv(s, r++, "AV (AN)", d.ergebnis.avCent / 100, EUR);
  setKv(s, r++, "PV (AN)", d.ergebnis.pvCent / 100, EUR);
  setKv(s, r++, "Gesamtnetto", d.ergebnis.gesamtnettoCent / 100, EUR, true);
  setKv(s, r++, "Auszahlung", d.ergebnis.auszahlungCent / 100, EUR, true);

  // --- Entgeltzeilen ---
  const z = wb.addWorksheet("Entgeltzeilen");
  z.columns = [
    { header: "Kategorie", key: "kategorie", width: 20 },
    { header: "Bezeichnung", key: "bezeichnung", width: 40 },
    { header: "Stunden", key: "stunden", width: 12, style: { numFmt: HRS } },
    { header: "Satz (€)", key: "satz", width: 14, style: { numFmt: EUR } },
    { header: "Betrag (€)", key: "betrag", width: 16, style: { numFmt: EUR } },
  ];
  z.getRow(1).font = { bold: true };
  for (const zl of d.zeilen) {
    z.addRow({
      kategorie: zl.kategorie,
      bezeichnung: zl.bezeichnung ?? "",
      stunden: zl.stunden ?? null,
      satz: zl.satzCent != null ? zl.satzCent / 100 : null,
      betrag: zl.betragCent / 100,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function buildLohnFileName(staffLabel: string, fromDate: string, toDate: string): string {
  const safe = staffLabel.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return `lohn_${safe || "mitarbeiter"}_${fromDate}_${toDate}.xlsx`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  downloadBrowserBlob(blob, filename);
}
