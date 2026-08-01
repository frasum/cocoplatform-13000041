// MB1 — Wächter für die Monatsentwicklung: Grenze Legacy/Live, Monatssummen
// über decomposeRevenue (Wolt nie Summand), YoY/YTD inkl. „—"-Fälle.

import { describe, expect, it } from "vitest";
import type { SessionRevenueInput } from "./revenue-core";
import {
  LIVE_FROM,
  LIVE_FROM_MONTH,
  aggregateLiveMonths,
  displayEuros,
  displayTsd,
  formatDisplayEuros,
  findCell,
  growthPct,
  mergeMonthlyCells,
  monthlyHeadline,
  toYearRows,
  ytdCents,
} from "./monthly-core";

describe("MB1 — Live-Grenze", () => {
  it("LIVE_FROM ist der 01.03.2026", () => {
    expect(LIVE_FROM).toBe("2026-03-01");
    expect(LIVE_FROM_MONTH).toBe("2026-03");
  });

  it("Februar 2026 bleibt legacy, März 2026 ist live — keine Doppelmonate", () => {
    const cells = mergeMonthlyCells({
      legacy: [
        { year: 2026, month: 1, totalCents: 100_000, takeawayCents: 10_000 },
        { year: 2026, month: 2, totalCents: 200_000, takeawayCents: null },
        // Legacy-Zeile jenseits der Grenze wird verworfen:
        { year: 2026, month: 3, totalCents: 999_999, takeawayCents: 0 },
      ],
      live: [
        // Live-Zeile vor der Grenze wird verworfen:
        { year: 2026, month: 2, totalCents: 555_555, takeawayCents: 1 },
        { year: 2026, month: 3, totalCents: 300_000, takeawayCents: 30_000 },
        { year: 2026, month: 4, totalCents: 400_000, takeawayCents: 40_000 },
      ],
      currentMonthKey: "2026-04",
    });

    expect(cells.map((c) => [c.month, c.source, c.totalCents, c.partial])).toEqual([
      [1, "legacy", 100_000, false],
      [2, "legacy", 200_000, false],
      [3, "live", 300_000, false],
      [4, "live", 400_000, true],
    ]);
    expect(findCell(cells, 2026, 2)?.takeawayCents).toBeNull();
  });
});

describe("MB1 — Monatsaggregation über decomposeRevenue", () => {
  it("zwei Tage ergeben Monatssumme und Takeaway; Wolt ist nie Summand", () => {
    const sessions: SessionRevenueInput[] = [
      {
        sessionId: "a",
        businessDate: "2026-03-01",
        locationId: "spicery",
        vectronCents: 667_250,
        channels: [
          { kind: "delivery_vectron", amountCents: 36_510 },
          { kind: "delivery_wolt", amountCents: 17_210 },
        ],
      },
      {
        sessionId: "b",
        businessDate: "2026-03-02",
        locationId: "spicery",
        vectronCents: 500_000,
        channels: [{ kind: "delivery_souse", amountCents: 10_000 }],
      },
      {
        sessionId: "c",
        businessDate: "2026-04-02",
        locationId: "yum",
        vectronCents: 0,
        channels: [{ kind: "pos", amountCents: 200_000 }],
      },
    ];

    expect(aggregateLiveMonths(sessions)).toEqual([
      {
        locationId: "spicery",
        year: 2026,
        month: 3,
        totalCents: 1_167_250,
        takeawayCents: 46_510,
      },
      { locationId: "yum", year: 2026, month: 4, totalCents: 200_000, takeawayCents: 0 },
    ]);
  });
});

describe("MB1 — Jahreszeilen / YTD / YoY", () => {
  const cells = mergeMonthlyCells({
    legacy: [
      { year: 2025, month: 1, totalCents: 100_000, takeawayCents: 5_000 },
      { year: 2025, month: 2, totalCents: 120_000, takeawayCents: null },
      { year: 2025, month: 3, totalCents: 150_000, takeawayCents: 7_000 },
      { year: 2026, month: 1, totalCents: 110_000, takeawayCents: 6_000 },
      { year: 2026, month: 2, totalCents: 130_000, takeawayCents: 6_500 },
    ],
    live: [{ year: 2026, month: 3, totalCents: 180_000, takeawayCents: 9_000 }],
    currentMonthKey: "2026-04",
  });

  it("toYearRows füllt 12 Monatsslots und summiert Takeaway nur über Werte", () => {
    const rows = toYearRows(cells);
    expect(rows.map((r) => r.year)).toEqual([2025, 2026]);
    expect(rows[0].months.length).toBe(12);
    expect(rows[0].months[11]).toBeNull();
    expect(rows[0].totalCents).toBe(370_000);
    expect(rows[0].takeawayCents).toBe(12_000);
    expect(rows[1].takeawayCents).toBe(21_500);
  });

  it("YTD und YoY im Normalfall", () => {
    expect(ytdCents(cells, 2026, 3)).toBe(420_000);
    const h = monthlyHeadline(cells, 2026, 3);
    expect(h.currentCents).toBe(180_000);
    expect(h.previousYearCents).toBe(150_000);
    expect(h.yoyPct).toBeCloseTo(20, 6);
    expect(h.ytdPct).toBeCloseTo((420_000 / 370_000 - 1) * 100, 6);
    expect(h.bestForMonth).toEqual({ year: 2026, totalCents: 180_000 });
    expect(h.yoyExcludedPartial).toBe(false);
  });

  it("Vorjahr ohne Monat ⇒ null (Strich)", () => {
    const h = monthlyHeadline(cells, 2025, 4);
    expect(h.currentCents).toBeNull();
    expect(h.previousYearCents).toBeNull();
    expect(h.yoyPct).toBeNull();
    expect(h.previousYearYtdCents).toBeNull();
    expect(h.ytdPct).toBeNull();
    expect(growthPct(100, 0)).toBeNull();
  });

  it("partial-Monat ist aus dem YoY-Vergleich ausgenommen", () => {
    const withPartial = mergeMonthlyCells({
      legacy: [{ year: 2025, month: 4, totalCents: 100_000, takeawayCents: null }],
      live: [{ year: 2026, month: 4, totalCents: 40_000, takeawayCents: 0 }],
      currentMonthKey: "2026-04",
    });
    const h = monthlyHeadline(withPartial, 2026, 4);
    expect(h.currentCents).toBe(40_000);
    expect(h.previousYearCents).toBe(100_000);
    expect(h.yoyPct).toBeNull();
    expect(h.yoyExcludedPartial).toBe(true);
    // Der laufende Monat zählt auch nicht als „bestes Jahr".
    expect(h.bestForMonth).toEqual({ year: 2025, totalCents: 100_000 });
  });
});

describe("MB1-N1 — Anzeige-Rundung vs. Rechnung", () => {
  it("16019268 Cents ergeben Anzeige 160.193 und T€ 160", () => {
    expect(displayEuros(16_019_268)).toBe(160_193);
    expect(formatDisplayEuros(16_019_268)).toBe("160.193");
    expect(displayTsd(16_019_268)).toBe(160);
  });

  it("die Cent-Werte bleiben für YoY/YTD unverändert", () => {
    const cells = mergeMonthlyCells({
      legacy: [
        { year: 2024, month: 5, totalCents: 16_019_268, takeawayCents: null },
        { year: 2025, month: 5, totalCents: 16_019_368, takeawayCents: null },
      ],
      live: [],
      currentMonthKey: "2026-06",
    });
    const h = monthlyHeadline(cells, 2025, 5);
    expect(h.currentCents).toBe(16_019_368);
    expect(h.previousYearCents).toBe(16_019_268);
    expect(h.ytdCents).toBe(16_019_368);
    expect(h.yoyPct).toBeCloseTo((16_019_368 / 16_019_268 - 1) * 100, 9);
  });
});

describe("MB3 — YTD klemmt auf gleiche Monatsabdeckung", () => {
  // Realnahe Spicery-Lage: Jan–Jul beide Jahre, Vorjahr zusätzlich August.
  const base: LegacyRow[] = [
    ...[1, 2, 3, 4, 5, 6, 7].map((m) => ({
      year: 2025,
      month: m,
      totalCents: 2_000_000,
      takeawayCents: null,
    })),
    { year: 2025, month: 8, totalCents: 1_905_100, takeawayCents: null },
    ...[1, 2, 3, 4, 5, 6, 7].map((m) => ({
      year: 2026,
      month: m,
      totalCents: 1_990_000,
      takeawayCents: null,
    })),
  ];

  it("Fokusmonat läuft: beide Summen enden bei month - 1", () => {
    const cells = mergeMonthlyCells({
      legacy: base,
      live: [{ year: 2026, month: 8, totalCents: 0, takeawayCents: 0 }],
      currentMonthKey: "2026-08",
    });
    const h = monthlyHeadline(cells, 2026, 8, "2026-08");
    expect(h.ytdThroughMonth).toBe(7);
    expect(h.ytdCents).toBe(7 * 1_990_000);
    // Der Vorjahres-August (19.051 €) fällt aus der Vorjahressumme heraus.
    expect(h.previousYearYtdCents).toBe(7 * 2_000_000);
    expect(h.ytdPct).toBeCloseTo((7 * 1_990_000) / (7 * 2_000_000) * 100 - 100, 6);
  });

  it("Fokusmonat läuft ohne eigene Zelle (YUM-Fall): Klemmen greift trotzdem", () => {
    const cells = mergeMonthlyCells({ legacy: base, live: [], currentMonthKey: "2026-08" });
    const h = monthlyHeadline(cells, 2026, 8, "2026-08");
    expect(h.currentCents).toBeNull();
    expect(h.ytdThroughMonth).toBe(7);
    expect(h.previousYearYtdCents).toBe(7 * 2_000_000);
  });

  it("abgeschlossener Fokusmonat: bit-identisch zu vorher", () => {
    const cells = mergeMonthlyCells({ legacy: base, live: [], currentMonthKey: "2026-08" });
    const withNow = monthlyHeadline(cells, 2026, 7, "2026-08");
    const legacyCall = monthlyHeadline(cells, 2026, 7);
    expect(withNow).toEqual({ ...legacyCall, ytdThroughMonth: 7 });
    expect(withNow.ytdThroughMonth).toBe(7);
  });

  it("Januar-Randfall: ytdThroughMonth 0, ytdPct null, kein Wurf", () => {
    const cells = mergeMonthlyCells({
      legacy: [{ year: 2025, month: 1, totalCents: 500_000, takeawayCents: null }],
      live: [],
      currentMonthKey: "2026-01",
    });
    const h = monthlyHeadline(cells, 2026, 1, "2026-01");
    expect(h.ytdThroughMonth).toBe(0);
    expect(h.ytdCents).toBe(0);
    expect(h.previousYearYtdCents).toBe(0);
    expect(h.ytdPct).toBeNull();
  });
});
