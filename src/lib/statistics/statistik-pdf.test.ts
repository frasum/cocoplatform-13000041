// STAT1-Wächter (STAT3-Fassung): die im PDF gerenderten Summen müssen
// bit-identisch aus den Kernfunktionen (decomposeRevenue →
// aggregateByBusinessDate → summarize) stammen. statistik-pdf.ts darf keine
// eigene Summenlogik enthalten.
//
// Seit STAT3 ist der Export ein Einseiter: Summen stehen in gezeichneten
// KPI-Boxen (doc.text), nicht mehr in autoTable-Zeilen. Der Wächter prüft
// deshalb Tabellen UND gezeichneten Text.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateByBusinessDate,
  summarize,
  derivedKpis,
  type SessionRevenueInput,
} from "./revenue-core";
import { takeawayMatrix, takeawaySharePctOfTotal } from "./takeaway-channels";
import {
  deltaTone,
  fmtDeltaPctDe,
  fmtEurRounded,
  fmtHoursDe,
  fmtHoursRoundedDe,
  fmtPctDe,
  generateStatistikPdf,
  pdfChannelLabel,
  type StatistikPdfData,
} from "./statistik-pdf";

type Cell = string | { content: string };
type Captured = { head?: Cell[][]; body: Cell[][] };
const captured: Captured[] = [];
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
    getTextWidth(t: string) {
      return t.length * 3;
    }
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

/** Ein gezeichneter Textblock, der alle Teilstrings enthält. */
function drawn(...parts: string[]): string {
  const hit = texts.find((t) => parts.every((p) => t.includes(p)));
  if (hit === undefined) {
    throw new Error(`Kein gezeichneter Text mit [${parts.join(" | ")}] gefunden`);
  }
  return hit;
}

// STAT3d — im PDF stehen gerundete Beträge; der Wächter vergleicht deshalb
// die gerundete Darstellung des centgenauen Kernwerts.
const eur = (c: number) => fmtEurRounded(c);

function baseData(over: Partial<StatistikPdfData> = {}): StatistikPdfData {
  return {
    monthLabel: "Juli 2026",
    scopeLabel: "Alle Standorte",
    generatedAtLabel: "01.08.2026, 10:00",
    calendarMonth: true,
    revenue: { houseCents: 0, takeawayCents: 0, totalCents: 0, daysWithRevenue: 0 },
    takeaway: takeawayMatrix([], {
      current: { markerSumCents: 0, souseSumCents: 0, woltInfoCents: 0 },
      previous: null,
    }),
    takeawaySharePct: null,
    tips: { serviceCents: 0, kitchenCents: 0, totalCents: 0 },
    personnel: { netHours: 0, laborCostCents: 0, ratioPct: null, staffWithoutRateNames: [] },
    dailyRevenue: [],
    comparison: [],
    ...over,
  };
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
  it("KPI-Box und Umsatzaufteilung spiegeln decomposeRevenue-Werte", async () => {
    captured.length = 0;
    texts.length = 0;
    const daily = aggregateByBusinessDate(sessions);
    const sum = summarize(daily);
    const current = { markerSumCents: 36_510, souseSumCents: 0, woltInfoCents: sum.woltInfoCents };

    await generateStatistikPdf(
      baseData({
        revenue: {
          houseCents: sum.houseCents,
          takeawayCents: sum.takeawayCents,
          totalCents: sum.totalCents,
          daysWithRevenue: sum.daysWithRevenue,
        },
        takeaway: takeawayMatrix([{ locationName: "Spicery", current }], {
          current,
          previous: { markerSumCents: 30_000, souseSumCents: 0, woltInfoCents: 12_000 },
        }),
        takeawaySharePct: takeawaySharePctOfTotal(sum.takeawayCents, sum.totalCents),
        dailyRevenue: daily.map((d) => ({
          businessDate: d.businessDate,
          totalCents: d.totalCents,
        })),
      }),
    );

    // Kern-Erwartung (STAT1): Gesamt = Σ vectron + pos, Takeaway darin enthalten.
    expect(sum).toEqual({
      houseCents: 830_740,
      takeawayCents: 36_510,
      totalCents: 867_250,
      woltInfoCents: 17_210,
      daysWithRevenue: 2,
    });

    // Gesamtumsatz-Kachel und Kopfzeile der Kanal-Tabelle — exakt die Kernwerte.
    expect(texts).toContain(eur(sum.totalCents));
    const split = drawn("Haus ", "Takeaway ");
    expect(split).toContain(`Haus ${eur(sum.houseCents)}`);
    expect(split).toContain(`Takeaway ${eur(sum.takeawayCents)}`);
    // STAT3b — Kanalzeilen: Wolt-Betrag steht in der Tabelle, nicht im Text.
    const wolt = findRow("Wolt");
    expect(wolt[1]).toBe(eur(17_210));
    expect(wolt[2]).toBe(eur(17_210));
    expect(findRow("Take-Away gesamt")[2]).toBe(eur(sum.takeawayCents));
    expect(drawn("Tage mit Umsatz")).toBe(`Tage mit Umsatz: ${sum.daysWithRevenue}`);

    // Wolt-additive Altsumme darf nirgends auftauchen.
    expect(texts.join(" ")).not.toContain(eur(667_250 + 17_210));
  });

  it("Quellcode enthält keine eigene Summen-/Umsatzlogik", () => {
    const src = readFileSync("src/lib/statistics/statistik-pdf.ts", "utf8");
    expect(src).not.toMatch(/\.reduce\(/);
    expect(src).not.toMatch(/Cents\s*[+\-*/]\s*\w*Cents/);
    expect(src).not.toMatch(/vectron|delivery_|houseCents\s*=/);
  });

  it("Einseiter: keine Tages- und keine Mitarbeiter-Tabelle mehr", async () => {
    captured.length = 0;
    texts.length = 0;
    const daily = aggregateByBusinessDate(sessions);
    await generateStatistikPdf(
      baseData({
        dailyRevenue: daily.map((d) => ({
          businessDate: d.businessDate,
          totalCents: d.totalCents,
        })),
        comparison: [
          {
            locationName: "Spicery",
            totalCents: 260_000,
            tipTotalCents: 0,
            ratioPct: null,
            netHours: 0,
            laborCostCents: 0,
            hasMissingRate: false,
          },
        ],
      }),
    );
    // STAT3f — genau zwei Tabellen: Standort-Vergleich und Kanal-Matrix.
    expect(captured).toHaveLength(2);
    const bodies = captured.flatMap((t) => t.body.map((r) => r.map(cell)));
    expect(bodies.some((r) => r[0] === "2026-07-18")).toBe(false);
  });
});

// STAT3 — Standort-Vergleich: Δ Vorjahr/Δ Vormonat, Summenzeile, deutsche Zahlen.
describe("statistik-pdf — Standort-Vergleich (STAT3)", () => {
  const kA = derivedKpis({
    houseCents: 200_000,
    totalCents: 260_000,
    guestCount: 80,
    workMinutes: 2_400,
  });
  const kB = derivedKpis({
    houseCents: 100_000,
    totalCents: 100_000,
    guestCount: 0,
    workMinutes: 0,
  });

  const comparison: StatistikPdfData["comparison"] = [
    {
      locationName: "Spicery",
      totalCents: 260_000,
      tipTotalCents: 5_000,
      ratioPct: 28.8,
      netHours: 5_464.475,
      laborCostCents: 74_880,
      hasMissingRate: false,
      guestTotal: 80,
      perGuestCents: kA.revenuePerGuestCents,
      perHourCents: kA.revenuePerWorkHourCents,
      prevYearTotalCents: 200_000,
      prevTotalCents: 250_000,
      tipRatePct: 2.5,
    },
    {
      locationName: "TSB",
      totalCents: 100_000,
      tipTotalCents: 0,
      ratioPct: null,
      netHours: 0,
      laborCostCents: 0,
      hasMissingRate: false,
      guestTotal: 0,
      perGuestCents: kB.revenuePerGuestCents,
      perHourCents: kB.revenuePerWorkHourCents,
      tipRatePct: null,
    },
  ];

  it("Kalendermonat: acht Kennzahlen je Standort + Summenzeile", async () => {
    captured.length = 0;
    texts.length = 0;
    await generateStatistikPdf(
      baseData({
        revenue: {
          houseCents: 300_000,
          takeawayCents: 60_000,
          totalCents: 360_000,
          daysWithRevenue: 31,
        },
        previousYearTotalCents: 300_000,
        previousPeriodTotalCents: 350_000,
        tips: {
          serviceCents: 4_000,
          kitchenCents: 1_000,
          totalCents: 5_000,
        },
        personnel: {
          netHours: 5_464.475,
          laborCostCents: 74_880,
          ratioPct: 28.8,
          staffWithoutRateNames: [],
        },
        guestHours: {
          guestTotal: 80,
          workHours: 40,
          revenuePerGuestCents: kA.revenuePerGuestCents,
          revenuePerWorkHourCents: kA.revenuePerWorkHourCents,
        },
        comparison,
      }),
    );

    const rowA = findRow("Spicery");
    expect(rowA).toEqual([
      "Spicery",
      eur(260_000),
      "+30,0 %",
      "+4,0 %",
      eur(5_000),
      "2,5 %",
      "28,8 %",
      "5.464 h",
      eur(2_500),
      eur(6_500),
    ]);

    // Ohne Vergleichsbasis bleiben beide Delta-Spalten Gedankenstriche.
    const rowB = findRow("TSB");
    expect(rowB.slice(2, 4)).toEqual(["—", "—"]);
    // STAT2d — ohne Haus-Umsatz bleibt die TG-Quote ein Gedankenstrich.
    expect(rowB[5]).toBe("—");
    // Beide Nenner 0 ⇒ Dichte-Kennzahlen „—".
    expect(rowB.slice(8)).toEqual(["—", "—"]);

    // Summenzeile aus den fertigen Gesamtwerten.
    const total = findRow("Gesamt");
    expect(total[1]).toBe(eur(360_000));
    expect(total[2]).toBe("+20,0 %");
    expect(total[3]).toBe("+2,9 %");

    // STAT3f — die Trinkgeld-Matrix ist entfallen (kumulierter Jahresvergleich).
    const allRows = captured.flatMap((t) => t.body.map((r) => r.map(cell)));
    expect(allRows.some((r) => r[0] === "Service")).toBe(false);
  });

  it("freier Zeitraum: Δ-Spalten neutral, kein Monatsverlauf", async () => {
    captured.length = 0;
    texts.length = 0;
    await generateStatistikPdf(
      baseData({
        monthLabel: "01.07.2026 – 15.07.2026",
        calendarMonth: false,
        previousYearTotalCents: 200_000,
        previousPeriodTotalCents: 250_000,
        revenue: {
          houseCents: 0,
          takeawayCents: 0,
          totalCents: 260_000,
          daysWithRevenue: 15,
        },
        comparison,
      }),
    );
    expect(findRow("Spicery").slice(2, 4)).toEqual(["—", "—"]);
    expect(drawn("Freier Zeitraum")).toContain("entfallen");
  });
});

// STAT3 — deutsche Zahlformate: Anlass sind die Punkt-Dezimalen im Juli-PDF.
describe("statistik-pdf — deutsche Zahlformate", () => {
  it("Stunden mit Tausenderpunkt und Komma-Dezimalen", () => {
    expect(fmtHoursDe(5_464.475)).toBe("5.464,48 h");
    expect(fmtHoursDe(0)).toBe("0,00 h");
    expect(fmtHoursDe(40)).toBe("40,00 h");
    expect(fmtHoursDe(null)).toBe("—");
    expect(fmtHoursDe(Number.NaN)).toBe("—");
  });

  it("Prozente mit Komma-Dezimale", () => {
    expect(fmtPctDe(28.8)).toBe("28,8 %");
    expect(fmtPctDe(1234.56)).toBe("1.234,6 %");
    expect(fmtPctDe(null)).toBe("—");
  });

  it("Deltas mit Vorzeichen", () => {
    expect(fmtDeltaPctDe(12.05)).toBe("+12,1 %");
    expect(fmtDeltaPctDe(-12.05)).toBe("-12,1 %");
    expect(fmtDeltaPctDe(0)).toBe("±0,0 %");
    expect(fmtDeltaPctDe(null)).toBe("—");
  });
});

// STAT3d — Rundung ist reine Formatschicht.
describe("statistik-pdf — gerundete Beträge (STAT3d)", () => {
  it("Euro kaufmännisch auf ganze Euro", () => {
    expect(fmtEurRounded(34_477_418)).toBe("344.774 €");
    expect(fmtEurRounded(250)).toBe("3 €");
    expect(fmtEurRounded(4_260)).toBe("43 €");
    expect(fmtEurRounded(-250)).toBe("-3 €");
    expect(fmtEurRounded(-4_260)).toBe("-43 €");
    expect(fmtEurRounded(null)).toBe("—");
  });

  it("Stunden ohne Nachkommastellen", () => {
    expect(fmtHoursRoundedDe(5_464.48)).toBe("5.464 h");
    expect(fmtHoursRoundedDe(5_464.5)).toBe("5.465 h");
    expect(fmtHoursRoundedDe(null)).toBe("—");
  });

  it("Standort-Tabelle ohne Cent-Nachkommastellen, Quoten bleiben einstellig", async () => {
    captured.length = 0;
    texts.length = 0;
    await generateStatistikPdf(
      baseData({
        comparison: [
          {
            locationName: "Spicery",
            totalCents: 34_477_418,
            tipTotalCents: 3_073_912,
            ratioPct: 28.8,
            netHours: 5_464.475,
            laborCostCents: 74_880,
            hasMissingRate: false,
            guestTotal: 80,
            perGuestCents: 4_260,
            perHourCents: 6_512,
            tipRatePct: 8.9,
          },
        ],
      }),
    );
    const row = findRow("Spicery");
    expect(row).toEqual([
      "Spicery",
      "344.774 €",
      "—",
      "—",
      "30.739 €",
      "8,9 %",
      "28,8 %",
      "5.464 h",
      "43 €",
      "65 €",
    ]);
    expect(row.some((c) => /\d,\d{2}\s*€/.test(c))).toBe(false);
  });
});

// STAT3e — Vorzeichen ⇒ Farbe an EINER Stelle; Bestandswerte bleiben neutral.
describe("statistik-pdf — Delta-Färbung und Labels (STAT3e)", () => {
  const NEUTRAL: [number, number, number] = [20, 20, 20];

  it("färbt anhand der echten Ausgabe der PDF-Formatierer", () => {
    const up = deltaTone(fmtDeltaPctDe(12.05));
    const down = deltaTone(fmtDeltaPctDe(-12.05));
    expect(up).not.toEqual(NEUTRAL);
    expect(down).not.toEqual(NEUTRAL);
    expect(up).not.toEqual(down);
    // Gedeckte, druckfeste Töne (kein Signalgrün/-rot).
    expect(Math.max(...up)).toBeLessThan(160);
    expect(Math.max(...down)).toBeLessThan(180);
  });

  it("erkennt das typografische Minus der Bildschirm-Formatierer", () => {
    // ppTrendLabel & Co. setzen U+2212 statt ASCII — beide müssen rot werden.
    expect(deltaTone(`\u2212${fmtPctDe(12.1)}`)).toEqual(deltaTone(fmtDeltaPctDe(-12.1)));
  });

  it("neutrale Werte behalten die Standardfarbe", () => {
    expect(deltaTone(fmtDeltaPctDe(0))).toEqual(NEUTRAL);
    expect(deltaTone(fmtDeltaPctDe(null))).toEqual(NEUTRAL);
    // Bestandswerte (Quoten, Beträge) werden nie eingefärbt.
    expect(deltaTone(fmtPctDe(8.9))).toEqual(NEUTRAL);
    expect(deltaTone(fmtEurRounded(34_477_418))).toEqual(NEUTRAL);
    expect(deltaTone(undefined)).toEqual(NEUTRAL);
  });

  it("Kanalname wird nur im PDF gekürzt", () => {
    expect(pdfChannelLabel("Takeaway direkt (Telefon/Abholung)")).toBe("Direkt (Tel./Abholung)");
    expect(pdfChannelLabel("Wolt")).toBe("Wolt");
  });

  it("Spaltenkopf der Personalquote ist eindeutig benannt", async () => {
    captured.length = 0;
    texts.length = 0;
    await generateStatistikPdf(
      baseData({
        comparison: [
          {
            locationName: "Spicery",
            totalCents: 100_000,
            tipTotalCents: 1_000,
            ratioPct: 28.8,
            netHours: 10,
            laborCostCents: 1_000,
            hasMissingRate: false,
            tipRatePct: 8.9,
          },
        ],
      }),
    );
    const heads = captured.flatMap((t) =>
      (t.head ?? []).map((r) => r.map((c) => (typeof c === "string" ? c : c.content))),
    );
    const locationHead = heads.find((h) => h[0] === "Standort");
    expect(locationHead).toContain("Pers.-Quote");
    expect(locationHead).not.toContain("Quote");
  });
});
