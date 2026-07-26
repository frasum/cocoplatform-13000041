// BH1 (24.07.2026) — Export rundet Stunden-Spalten auf Viertelstunden AB
// und die Summenzeile entspricht der Summe der GERUNDETEN Personenwerte.
import { describe, it, expect } from "vitest";
import {
  buildBuchhaltungCsv,
  type BuchhaltungExportInput,
  type BuchhaltungExportRow,
} from "./buchhaltung-export";

function mkRow(over: Partial<BuchhaltungExportRow>): BuchhaltungExportRow {
  return {
    displayName: "Test",
    totalHours: 0,
    shifts: 0,
    evening: 0,
    night: 0,
    sunHol: 0,
    sonntag: 0,
    feiertag: 0,
    feiertag150: 0,
    urlaubDays: 0,
    krankDays: 0,
    vorschussEUR: 0,
    besonderheiten: "",
    ...over,
  };
}

describe("buchhaltung-export — Viertelstunden-Abrundung", () => {
  it("rundet totalHours ab (178,37 → 178,25) und Summenzeile = Σ gerundet", () => {
    const input: BuchhaltungExportInput = {
      locationLabel: "Spicery",
      periodLabel: "Juli 2026",
      rangeLabel: "26.06.–25.07.2026",
      mode: "simple",
      rowsByDept: [
        {
          dept: "kitchen",
          deptLabel: "Küche",
          rows: [
            mkRow({ displayName: "A", totalHours: 178.37, evening: 12.49, sunHol: 7.99 }),
            mkRow({ displayName: "B", totalHours: 30.24, evening: 0.24, sunHol: 0.5 }),
          ],
        },
      ],
    };
    const csv = buildBuchhaltungCsv(input);
    // LG3 — die Stunden-je-Abteilung-Spalten entfallen; Zellen: name;fullName;
    // persoNr;totalHours;shifts;evening;night;sunHol;U;K;Vorschuss;Notiz.
    // Person A: 178.37 → 178.25; 12.49 → 12.25; 7.99 → 7.75
    expect(csv).toMatch(/A;;;178,25;0;12,25;0,00;7,75/);
    // Person B: 30.24 → 30.00; 0.24 → 0.00; 0.50 → 0.50
    expect(csv).toMatch(/B;;;30,00;0;0,00;0,00;0,50/);
    // Summenzeile = 178.25 + 30.00 = 208.25 (nicht 208.61 aus Rohsummen)
    expect(csv).toMatch(/Summe;;;208,25;0;12,25;0,00;8,25/);
  });
});
