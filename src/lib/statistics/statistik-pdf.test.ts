// STAT1-Wächter: die im PDF gerenderten Summen müssen bit-identisch aus den
// Kernfunktionen (decomposeRevenue → aggregateByBusinessDate → summarize)
// stammen. statistik-pdf.ts darf keine eigene Summenlogik enthalten.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fmtCents } from "@/lib/format";
import {
  aggregateByBusinessDate,
  summarize,
  type SessionRevenueInput,
} from "./revenue-core";
import { generateStatistikPdf, type StatistikPdfData } from "./statistik-pdf";

type Cell = string | { content: string };
type Captured = { head?: Cell[][]; body: Cell[][] };
const captured: Captured[] = [];

vi.mock("jspdf", () => {
  class FakeDoc {
    lastAutoTable = { finalY: 0 };
    internal = { pageSize: { getWidth: () => 595 } };
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

// Fixture 18.07. Spicery + TSB-Zweitkasse — Wolt ist reine Info, nie Summand.
const sessions: SessionRevenueInput[] = [
  {
    sessionId: "a",
    businessDate: "2026-07-18",
    locationId: "spicery",
    vectronCents: 667_250,
    channels: [
      { kind: "delivery_vectron", amountCents: 36_510 },
      { kind: "delivery_wolt", amountCents: 17_210 },
    ],
  },
  {
    sessionId: "b",
    businessDate: "2026-07-19",
    locationId: "tsb",
    vectronCents: 0,
    channels: [{ kind: "pos", amountCents: 200_000 }],
  },
];

describe("statistik-pdf — Summen kommen aus der Kernfunktion", () => {
  it("Umsatz-Block und Umsatzverlauf spiegeln decomposeRevenue-Werte", async () => {
    captured.length = 0;
    const daily = aggregateByBusinessDate(sessions);
    const sum = summarize(daily);

    const data: StatistikPdfData = {
      monthLabel: "Juli 2026",
      scopeLabel: "Alle Standorte",
      revenue: {
        houseCents: sum.houseCents,
        takeawayCents: sum.takeawayCents,
        totalCents: sum.totalCents,
        daysWithRevenue: sum.daysWithRevenue,
      },
      tips: { serviceCents: 0, kitchenCents: 0, totalCents: 0, perStaff: [] },
      personnel: { netHours: 0, laborCostCents: 0, ratioPct: null, staffWithoutRateNames: [] },
      dailyRevenue: daily.map((d) => ({
        businessDate: d.businessDate,
        houseCents: d.houseCents,
        takeawayCents: d.takeawayCents,
        totalCents: d.totalCents,
      })),
      comparison: [],
    };

    await generateStatistikPdf(data);

    // Kern-Erwartung (STAT1): Gesamt = Σ vectron + pos, Takeaway darin enthalten.
    expect(sum).toEqual({
      houseCents: 830_740,
      takeawayCents: 36_510,
      totalCents: 867_250,
      woltInfoCents: 17_210,
      daysWithRevenue: 2,
    });

    expect(findRow("Haus")[1]).toBe(`${fmtCents(sum.houseCents)} €`);
    expect(findRow("Takeaway")[1]).toBe(`${fmtCents(sum.takeawayCents)} €`);
    expect(findRow("Gesamt")[1]).toBe(`${fmtCents(sum.totalCents)} €`);
    expect(findRow("Tage mit Umsatz")[1]).toBe(String(sum.daysWithRevenue));

    // Verlaufszeilen exakt = Tageswerte der Kernaggregation, keine Neuberechnung.
    for (const d of daily) {
      const row = findRow(d.businessDate);
      expect(row.slice(1)).toEqual([
        `${fmtCents(d.houseCents)} €`,
        `${fmtCents(d.takeawayCents)} €`,
        `${fmtCents(d.totalCents)} €`,
      ]);
    }
  });

  it("Quellcode enthält keine eigene Summen-/Umsatzlogik", () => {
    const src = readFileSync("src/lib/statistics/statistik-pdf.ts", "utf8");
    expect(src).not.toMatch(/\.reduce\(/);
    expect(src).not.toMatch(/Cents\s*[+\-*/]\s*\w*Cents/);
    expect(src).not.toMatch(/vectron|delivery_|houseCents\s*=/);
  });
});
