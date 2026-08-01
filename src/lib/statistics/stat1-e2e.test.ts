// STAT1 End-to-End-Wächter (18.07. Spicery, echte Zahlen).
//
// Eine Fixture, ein Datenpfad: DB-Rows → mapToSessionInputs →
// aggregateByBusinessDate → summarize. Daraus lesen Dashboard-Kacheln,
// Umsatzverlauf (fillDailyGaps) UND PDF-Export dieselben Werte.
// Wenn irgendeine Schicht wieder eigene Summen bildet (z.B. Wolt additiv
// zählt), weicht sie hier von Gesamt/Takeaway/Haus ab und der Test bricht.

import { describe, expect, it, vi } from "vitest";
import { fmtCents } from "@/lib/format";
import { fillDailyGaps } from "./chart-fill";
import { aggregateByBusinessDate, summarize, takeawayDonutSegments } from "./revenue-core";
import { mapToSessionInputs, type ChannelAmountRow, type SessionRow } from "./revenue-map";
import { generateStatistikPdf, type StatistikPdfData } from "./statistik-pdf";

type Cell = string | { content: string };
type Captured = { body: Cell[][] };
const captured: Captured[] = [];
/** STAT3 — der Einseiter zeichnet die Summen als Text statt als Tabelle. */
const texts: string[] = [];

vi.mock("jspdf", () => {
  class FakeDoc {
    lastAutoTable = { finalY: 0 };
    internal = { pageSize: { getWidth: () => 595 } };
    setFontSize() {}
    setFont() {}
    setDrawColor() {}
    setFillColor() {}
    setTextColor() {}
    setLineWidth() {}
    rect() {}
    line() {}
    circle() {}
    text(value: string | string[]) {
      if (Array.isArray(value)) texts.push(...value);
      else texts.push(value);
    }
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
    captured.push({ body: opts.body });
    doc.lastAutoTable.finalY = opts.startY + 40;
  },
}));

function cell(c: Cell): string {
  return typeof c === "string" ? c : c.content;
}

/** Ein gezeichneter Textblock, der alle Teilstrings enthält. */
function drawn(...parts: string[]): string {
  const hit = texts.find((t) => parts.every((p) => t.includes(p)));
  if (hit === undefined) {
    throw new Error(`Kein gezeichneter Text mit [${parts.join(" | ")}] gefunden`);
  }
  return hit;
}

const eur = (c: number) => `${fmtCents(c)} €`;

// Fixture 18.07. Spicery: Vectron-Tagesumsatz 6.672,50 €, Marker 365,10 €,
// Wolt 172,10 € (im Marker enthalten, reine Info).
const SESSION_ROWS: SessionRow[] = [
  {
    id: "sess-spicery-0718",
    businessDate: "2026-07-18",
    locationId: "loc-spicery",
    vectronCents: 667_250,
  },
];

const CHANNEL_ROWS: ChannelAmountRow[] = [
  { sessionId: "sess-spicery-0718", amountCents: 36_510, kind: "delivery_vectron" },
  { sessionId: "sess-spicery-0718", amountCents: 17_210, kind: "delivery_wolt" },
];

// STAT1-Erwartung (N14-Zerlegung) — einzige Wahrheit dieses Tests.
const EXPECTED = { totalCents: 667_250, takeawayCents: 36_510, houseCents: 630_740 };

describe("STAT1 E2E — Dashboard, Verlauf und PDF zeigen identische Werte", () => {
  it("Fixture 18.07. Spicery: Gesamt/Takeaway/Haus überall gleich, Wolt nie Summand", async () => {
    captured.length = 0;
    texts.length = 0;

    // 1) Datenpfad wie in getRevenueStats (ohne DB).
    const inputs = mapToSessionInputs(SESSION_ROWS, CHANNEL_ROWS);
    const daily = aggregateByBusinessDate(inputs);
    const summary = summarize(daily);

    // 2) Dashboard-Kacheln
    expect({
      totalCents: summary.totalCents,
      takeawayCents: summary.takeawayCents,
      houseCents: summary.houseCents,
    }).toEqual(EXPECTED);
    expect(summary.woltInfoCents).toBe(17_210);
    expect(summary.daysWithRevenue).toBe(1);
    // Haus + Takeaway = Gesamt (keine Doppelzählung, kein Rest).
    expect(summary.houseCents + summary.takeawayCents).toBe(summary.totalCents);

    // 3) Umsatzverlauf (Chart) — Lückenfüllung verändert echte Tage nicht.
    const chart = fillDailyGaps(daily);
    expect(chart).toHaveLength(1);
    expect({
      totalCents: chart[0].totalCents,
      takeawayCents: chart[0].takeawayCents,
      houseCents: chart[0].houseCents,
    }).toEqual(EXPECTED);
    expect(chart[0].businessDate).toBe("2026-07-18");

    // 4) Donut (STAT1b): Marker in Wolt + Direkt zerlegt, SoUse unverändert.
    const donut = takeawayDonutSegments(36_510, 0, summary.woltInfoCents);
    expect(donut.segments).toEqual([
      { name: "Wolt", amountCents: 17_210 },
      { name: "Takeaway direkt (Telefon/Abholung)", amountCents: 19_300 },
    ]);
    expect(donut.segmentSumCents).toBe(summary.takeawayCents);
    expect(donut.woltExceedsMarker).toBe(false);

    // 5) PDF-Export aus genau diesen Werten.
    const data: StatistikPdfData = {
      monthLabel: "Juli 2026",
      scopeLabel: "Spicery",
      generatedAtLabel: "01.08.2026, 10:00",
      calendarMonth: true,
      revenue: {
        houseCents: summary.houseCents,
        takeawayCents: summary.takeawayCents,
        totalCents: summary.totalCents,
        daysWithRevenue: summary.daysWithRevenue,
      },
      takeawaySegments: donut.segments,
      takeawaySegmentsWarning: donut.warning,
      tips: { serviceCents: 0, kitchenCents: 0, totalCents: 0, perLocation: [] },
      personnel: { netHours: 0, laborCostCents: 0, ratioPct: null, staffWithoutRateNames: [] },
      dailyRevenue: daily.map((d) => ({
        businessDate: d.businessDate,
        totalCents: d.totalCents,
      })),
      comparison: [],
    };
    await generateStatistikPdf(data);

    // STAT3 — Summen und Segmente stehen im gezeichneten Einseiter-Text.
    const split = drawn("Haus ", "Takeaway ");
    expect(split).toContain(`Haus ${eur(EXPECTED.houseCents)}`);
    expect(split).toContain(`Takeaway ${eur(EXPECTED.takeawayCents)}`);
    expect(split).toContain(`Wolt ${eur(17_210)}`);
    expect(split).toContain(`Takeaway direkt (Telefon/Abholung) ${eur(19_300)}`);
    expect(texts).toContain(eur(EXPECTED.totalCents));

    // 6) Kein Pfad zeigt die Wolt-additive Altsumme (667.250 + 17.210).
    const allPdfCells = captured.flatMap((t) => t.body.flatMap((r) => r.map(cell)));
    expect(allPdfCells).not.toContain(eur(667_250 + 17_210));
    expect(texts.join(" ")).not.toContain(eur(667_250 + 17_210));
  });
});
