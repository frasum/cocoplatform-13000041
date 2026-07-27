/**
 * LG3b 2b — Export-Mapping der Zeitlohn-Kategorien.
 *
 * Sicherstellen, dass die Übersicht-Zeile „Zeitlohn (Stunden × Satz)" die
 * volle Summe der vom Lohn-Kern erzeugten A3-Zeitlohn-Zeilen ausweist —
 * also `zeitlohn` + `zeitlohn_2` + `zeitlohn_3` (Nicht-Minijob) bzw.
 * `aushilfe_paust` (Minijob). Der Alt-Filter auf genau eine Kategorie
 * verlor die _2/_3-Beträge bei Mehr-Bereichs-Personen.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildLohnXlsx, type LohnExportInput } from "./lohn-excel-export";
import type { Entgeltzeile, LohnErgebnis, PersonenParameter } from "./types";
import type { SfnGeldErgebnis } from "./sfn-geld/types";

const person: PersonenParameter = {
  steuerklasse: 3,
  zkf: 0,
  kvzProzent: 1.7,
  kirchensteuerBayern: false,
  kinderzahl: 0,
  elterneigenschaft: false,
  pvKinderlosZuschlag: false,
  beschaeftigung: "normal",
  rvFrei: false,
  avFrei: false,
  lstFreibetragMonatCent: 0,
  istMidijob: false,
  kvFrei: false,
  pvFrei: false,
  istPkv: false,
  pkvBasisBeitragMonatCent: 0,
};

const ergebnis: LohnErgebnis = {
  gesamtbruttoCent: 0,
  stBruttoCent: 0,
  stBruttoAusweisCent: 0,
  svBruttoCent: 0,
  stSvBruttoCent: 0,
  lstCent: 0,
  soliCent: 0,
  kistCent: 0,
  kvCent: 0,
  rvCent: 0,
  avCent: 0,
  pvCent: 0,
  gesamtnettoCent: 0,
  auszahlungCent: 0,
};

const buckets: SfnGeldErgebnis = {
  night25Hours: 0,
  night40Hours: 0,
  sundayHours: 0,
  holidayHours: 0,
  holiday150Hours: 0,
  zuschlagCents: 0,
};

function baseInput(zeilen: Entgeltzeile[]): LohnExportInput {
  return {
    staffLabel: "Test",
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    mode: "extended",
    totalHours: 72.75,
    hourlyRateCents: 0,
    entryCount: 0,
    zuschlagCents: 0,
    buckets,
    person,
    zeilen,
    ergebnis,
  };
}

async function readZeitlohnSum(blob: Blob): Promise<number> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const s = wb.getWorksheet("Übersicht")!;
  // Zeile mit Schlüssel "Zeitlohn (Stunden × Satz)" suchen.
  for (let r = 1; r <= s.rowCount; r++) {
    const key = s.getCell(`A${r}`).value;
    if (typeof key === "string" && key.startsWith("Zeitlohn (Stunden")) {
      const v = s.getCell(`B${r}`).value;
      return typeof v === "number" ? v : Number(v);
    }
  }
  throw new Error("Zeitlohn-Zeile nicht gefunden");
}

describe("LG3b 2b — Export-Mapping der Zeitlohn-Kategorien", () => {
  it("Nicht-Minijob: Summe umfasst zeitlohn + zeitlohn_2 + zeitlohn_3", async () => {
    const zeilen: Entgeltzeile[] = [
      { kategorie: "zeitlohn", bezeichnung: "Zeitlohn (Service)", betragCent: 30_000 },
      { kategorie: "zeitlohn_2", bezeichnung: "Zeitlohn 2 (GL)", betragCent: 118_800 },
      { kategorie: "zeitlohn_3", bezeichnung: "Zeitlohn 3 (Küche)", betragCent: 18_400 },
      { kategorie: "zuschlag_frei", bezeichnung: "SFN GL", betragCent: 48_098 },
      { kategorie: "aushilfe_paust", bezeichnung: "Fremd (Minijob)", betragCent: 99_999 },
    ];
    const blob = await buildLohnXlsx(baseInput(zeilen));
    const eur = await readZeitlohnSum(blob);
    expect(Math.round(eur * 100)).toBe(30_000 + 118_800 + 18_400);
  });

  it("Minijob: Summe umfasst nur aushilfe_paust, nicht zeitlohn_*", async () => {
    const zeilen: Entgeltzeile[] = [
      { kategorie: "aushilfe_paust", bezeichnung: "Aushilfe (Service)", betragCent: 20_000 },
      { kategorie: "zeitlohn", bezeichnung: "Fremd Zeitlohn", betragCent: 99_999 },
      { kategorie: "zeitlohn_2", bezeichnung: "Fremd Zeitlohn 2", betragCent: 99_999 },
    ];
    const blob = await buildLohnXlsx({
      ...baseInput(zeilen),
      person: { ...person, beschaeftigung: "minijob" },
    });
    const eur = await readZeitlohnSum(blob);
    expect(Math.round(eur * 100)).toBe(20_000);
  });
});
