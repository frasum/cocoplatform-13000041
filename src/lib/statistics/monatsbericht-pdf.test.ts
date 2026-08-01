// MB1-Wächter: der Monatsbericht rendert ausschließlich Werte, die aus
// monthly-core stammen (mergeMonthlyCells → toYearRows → monthlyHeadline).
// monatsbericht-pdf.ts darf keine eigene Summenlogik enthalten.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fmtCents } from "@/lib/format";
import { mergeMonthlyCells, monthlyHeadline, toYearRows } from "./monthly-core";
import { generateMonatsberichtPdf, type MonatsberichtPdfData } from "./monatsbericht-pdf";

type Cell = string | { content: string };
type Captured = { head?: Cell[][]; body: Cell[][] };
const captured: Captured[] = [];

vi.mock("jspdf", () => {
  class FakeDoc {
    lastAutoTable = { finalY: 0 };
    internal = { pageSize: { getWidth: () => 842 } };
    setFontSize() {}
    setFont() {}
    text() {}
    splitTextToSize(s: string) {
      return [s];
    }
    output() {
      return new Blob(["pdf"]);
    }
  }
  return { default: FakeDoc };
});

vi.mock("jspdf-autotable", () => ({
  default: (doc: { lastAutoTable: { finalY: number } }, opts: Captured & { startY: number }) => {
    captured.push({ head: opts.head, body: opts.body });
    doc.lastAutoTable.finalY = opts.startY + 40;
  },
}));

function cell(c: Cell): string {
  return typeof c === "string" ? c : c.content;
}

function findRow(label: string): string[] {
  for (const t of captured) {
    for (const row of t.body) {
      if (cell(row[0]) === label) return row.map(cell);
    }
  }
  throw new Error(`Zeile "${label}" nicht im PDF gefunden`);
}

describe("monatsbericht-pdf — Werte kommen aus monthly-core", () => {
  it("Kennzahlen, Matrix in T€ und Takeaway je Jahr", async () => {
    captured.length = 0;
    const cells = mergeMonthlyCells({
      legacy: [
        { year: 2025, month: 3, totalCents: 15_000_000, takeawayCents: 700_000 },
        { year: 2026, month: 1, totalCents: 11_000_000, takeawayCents: 600_000 },
        { year: 2026, month: 2, totalCents: 13_000_000, takeawayCents: null },
      ],
      live: [{ year: 2026, month: 3, totalCents: 18_000_000, takeawayCents: 900_000 }],
      currentMonthKey: "2026-04",
    });
    const years = toYearRows(cells);
    const headline = monthlyHeadline(cells, 2026, 3);

    const data: MonatsberichtPdfData = {
      monthLabel: "März 2026",
      monthKey: "2026-03",
      scopeLabel: "Alle Standorte",
      headline,
      years,
    };

    const { fileName } = await generateMonatsberichtPdf(data);
    expect(fileName).toBe("monatsbericht_2026-03.pdf");

    expect(findRow("Monatsumsatz")[1]).toBe(`${fmtCents(18_000_000)} €`);
    expect(findRow("Vorjahresmonat")[1]).toBe(`${fmtCents(15_000_000)} €`);
    expect(findRow("Veränderung ggü. Vorjahresmonat")[1]).toBe("+20.0 %");
    expect(findRow("Jahressumme bis Mär (YTD)")[1]).toBe(`${fmtCents(42_000_000)} €`);
    expect(findRow("Vorjahres-YTD (bis Mär)")[1]).toBe(`${fmtCents(15_000_000)} €`);
    expect(findRow("Bestes Jahr für diesen Monat")[1]).toBe(`2026 · ${fmtCents(18_000_000)} €`);

    // Matrix: Jahreszeile 2026 in T€ (Jan 110, Feb 130, Mär 180, Gesamt 420).
    const row2026 = findRow("2026");
    expect(row2026[1]).toBe("110");
    expect(row2026[2]).toBe("130");
    expect(row2026[3]).toBe("180");
    expect(row2026[13]).toBe("420");

    // Takeaway je Jahr: 2026 nur die Monate mit Wert, Feb bleibt außen vor.
    const takeawayTable = captured.find((t) =>
      (t.head?.[0] ?? []).map(cell).includes("davon Takeaway"),
    );
    expect(takeawayTable).toBeDefined();
    const takeaway2026 = (takeawayTable as Captured).body
      .map((r) => r.map(cell))
      .find((r) => r[0] === "2026");
    expect(takeaway2026?.[2]).toBe(`${fmtCents(1_500_000)} €`);
  });

  it("Quellcode enthält keine eigene Summen-/Umsatzlogik", () => {
    const src = readFileSync("src/lib/statistics/monatsbericht-pdf.ts", "utf8");
    expect(src).not.toMatch(/\.reduce\(/);
    expect(src).not.toMatch(/Cents\s*[+\-*/]\s*\w*Cents/);
    expect(src).not.toMatch(/decomposeRevenue|vectron|delivery_/);
  });
});
