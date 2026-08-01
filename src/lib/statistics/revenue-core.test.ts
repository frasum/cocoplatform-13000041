import { describe, it, expect } from "vitest";
import {
  sessionRevenue,
  aggregateByBusinessDate,
  summarize,
  computeTrend,
  groupTakeawayByChannel,
  computeChannelPercents,
  checkDonutSegments,
  sessionHouseCentsFromKasse,
  type SessionRevenueInput,
} from "./revenue-core";

describe("sessionRevenue — STAT1 (N14-Zerlegung)", () => {
  // STAT1: Erwartungswerte angepasst. Die alte Fassung rechnete Kanäle
  // additiv (Gesamt = vectron + Σ Kanäle) und zählte Takeaway doppelt.
  it("Fixture 18.07. Spicery (echte Zahlen): Marker + Wolt", () => {
    const input: SessionRevenueInput = {
      sessionId: "s1",
      businessDate: "2026-07-18",
      locationId: "spicery",
      vectronCents: 667250,
      channels: [
        { kind: "delivery_vectron", amountCents: 36510 },
        { kind: "delivery_wolt", amountCents: 17210 },
      ],
    };
    expect(sessionRevenue(input)).toEqual({
      totalCents: 667250,
      takeawayCents: 36510,
      houseCents: 630740,
      woltInfoCents: 17210,
    });
  });

  // STAT1: SOUSE ist NICHT im Marker enthalten und wird zusätzlich
  // abgezogen; Wolt bleibt reine Info.
  it("Tag mit SOUSE: Takeaway = Marker + SoUse, Wolt nie Summand", () => {
    expect(
      sessionRevenue({
        sessionId: "s2",
        businessDate: "2026-07-19",
        locationId: "spicery",
        vectronCents: 500000,
        channels: [
          { kind: "delivery_vectron", amountCents: 40000 },
          { kind: "delivery_wolt", amountCents: 15000 },
          { kind: "delivery_souse", amountCents: 10000 },
        ],
      }),
    ).toEqual({
      totalCents: 500000,
      takeawayCents: 50000,
      houseCents: 450000,
      woltInfoCents: 15000,
    });
  });

  // STAT1: `pos` ist additive Zweitkasse (TSB) — Adapter-Semantik.
  it("TSB-Form: vectron + pos-Kanal → Gesamt = vectron + pos", () => {
    expect(
      sessionRevenue({
        sessionId: "s3",
        businessDate: "2026-06-01",
        locationId: "tsb",
        vectronCents: 120000,
        channels: [{ kind: "pos", amountCents: 200000 }],
      }),
    ).toEqual({
      totalCents: 320000,
      takeawayCents: 0,
      houseCents: 320000,
      woltInfoCents: 0,
    });
  });

  it("Guard: Marker + SoUse > vectron → Takeaway gedeckelt, Haus ≥ 0", () => {
    const res = sessionRevenue({
      sessionId: "s4",
      businessDate: "2026-06-02",
      locationId: "x",
      vectronCents: 10000,
      channels: [
        { kind: "delivery_vectron", amountCents: 9000 },
        { kind: "delivery_souse", amountCents: 5000 },
      ],
    });
    expect(res).toEqual({
      totalCents: 10000,
      takeawayCents: 10000,
      houseCents: 0,
      woltInfoCents: 0,
    });
    expect(res.houseCents).toBeGreaterThanOrEqual(0);
  });

  it("unbekannter kind wirft", () => {
    expect(() =>
      sessionRevenue({
        sessionId: "s5",
        businessDate: "2026-06-02",
        locationId: "x",
        vectronCents: 100,
        channels: [{ kind: "voucher_sold", amountCents: 50 }],
      }),
    ).toThrow(/unbekannter kind/);
  });

  it("leere Kanäle: nur vectron", () => {
    expect(
      sessionRevenue({
        sessionId: "s6",
        businessDate: "2026-06-01",
        locationId: "x",
        vectronCents: 12345,
        channels: [],
      }),
    ).toEqual({
      houseCents: 12345,
      takeawayCents: 0,
      totalCents: 12345,
      woltInfoCents: 0,
    });
  });
});

describe("aggregateByBusinessDate", () => {
  it("zwei Sessions am selben Tag (zwei Standorte) summieren zu einer Tageszeile", () => {
    const sessions: SessionRevenueInput[] = [
      {
        sessionId: "a",
        businessDate: "2026-06-01",
        locationId: "yum",
        vectronCents: 100000,
        channels: [{ kind: "delivery_vectron", amountCents: 20000 }],
      },
      {
        sessionId: "b",
        businessDate: "2026-06-01",
        locationId: "spicery",
        vectronCents: 50000,
        channels: [{ kind: "delivery_vectron", amountCents: 10000 }],
      },
    ];
    expect(aggregateByBusinessDate(sessions)).toEqual([
      {
        businessDate: "2026-06-01",
        // STAT1: Gesamt = Σ vectron (150.000), Takeaway ist darin enthalten.
        houseCents: 120000,
        takeawayCents: 30000,
        totalCents: 150000,
        woltInfoCents: 0,
        cardCents: 0,
        sessionCount: 2,
      },
    ]);
  });

  it("sortiert mehrere Tage aufsteigend", () => {
    const sessions: SessionRevenueInput[] = [
      {
        sessionId: "c",
        businessDate: "2026-06-03",
        locationId: "x",
        vectronCents: 300,
        channels: [],
      },
      {
        sessionId: "a",
        businessDate: "2026-06-01",
        locationId: "x",
        vectronCents: 100,
        channels: [],
      },
      {
        sessionId: "b",
        businessDate: "2026-06-02",
        locationId: "x",
        vectronCents: 200,
        channels: [],
      },
    ];
    expect(aggregateByBusinessDate(sessions).map((d) => d.businessDate)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });
});

describe("summarize", () => {
  it("summiert und zählt nur Tage mit totalCents > 0", () => {
    const res = summarize([
      {
        businessDate: "2026-06-01",
        houseCents: 100,
        takeawayCents: 50,
        totalCents: 150,
        woltInfoCents: 0,
        cardCents: 0,
        sessionCount: 1,
      },
      {
        businessDate: "2026-06-02",
        houseCents: 0,
        takeawayCents: 0,
        totalCents: 0,
        woltInfoCents: 0,
        cardCents: 0,
        sessionCount: 1,
      },
      {
        businessDate: "2026-06-03",
        houseCents: 200,
        takeawayCents: 0,
        totalCents: 200,
        woltInfoCents: 0,
        cardCents: 0,
        sessionCount: 1,
      },
    ]);
    expect(res).toEqual({
      houseCents: 300,
      takeawayCents: 50,
      totalCents: 350,
      woltInfoCents: 0,
      daysWithRevenue: 2,
    });
  });

  it("leere Liste", () => {
    expect(summarize([])).toEqual({
      houseCents: 0,
      takeawayCents: 0,
      totalCents: 0,
      woltInfoCents: 0,
      daysWithRevenue: 0,
    });
  });
});

describe("computeTrend", () => {
  it("positiver Trend", () => {
    expect(computeTrend(150, 100)).toEqual({ deltaCents: 50, pct: 50 });
  });
  it("negativer Trend", () => {
    expect(computeTrend(80, 100)).toEqual({ deltaCents: -20, pct: -20 });
  });
  it("previous=0 → pct=null (kein willkürliches 100 %)", () => {
    expect(computeTrend(500, 0)).toEqual({ deltaCents: 500, pct: null });
  });
  it("current===previous → delta 0, pct 0", () => {
    expect(computeTrend(100, 100)).toEqual({ deltaCents: 0, pct: 0 });
  });
});

describe("aggregateByBusinessDate — cardCents", () => {
  it("ohne Card-Map → cardCents = 0", () => {
    const rows = aggregateByBusinessDate([
      {
        sessionId: "a",
        businessDate: "2026-06-01",
        locationId: "x",
        vectronCents: 1000,
        channels: [],
      },
    ]);
    expect(rows[0].cardCents).toBe(0);
  });
  it("Map summiert Card pro Session und mergt pro Tag", () => {
    const rows = aggregateByBusinessDate(
      [
        {
          sessionId: "a",
          businessDate: "2026-06-01",
          locationId: "x",
          vectronCents: 100,
          channels: [],
        },
        {
          sessionId: "b",
          businessDate: "2026-06-01",
          locationId: "y",
          vectronCents: 200,
          channels: [],
        },
      ],
      new Map([
        ["a", 400],
        ["b", 600],
      ]),
    );
    expect(rows[0].cardCents).toBe(1000);
  });
  it("Record-Form (Session ohne Eintrag = 0)", () => {
    const rows = aggregateByBusinessDate(
      [
        {
          sessionId: "a",
          businessDate: "2026-06-01",
          locationId: "x",
          vectronCents: 100,
          channels: [],
        },
      ],
      { b: 999 },
    );
    expect(rows[0].cardCents).toBe(0);
  });
});

describe("groupTakeawayByChannel", () => {
  it("summiert je Name und sortiert absteigend", () => {
    const out = groupTakeawayByChannel([
      { name: "Wolt", amountCents: 1000 },
      { name: "SoUse", amountCents: 500 },
      { name: "Wolt", amountCents: 250 },
    ]);
    expect(out).toEqual([
      { name: "Wolt", amountCents: 1250 },
      { name: "SoUse", amountCents: 500 },
    ]);
  });
  it("leere Liste", () => {
    expect(groupTakeawayByChannel([])).toEqual([]);
  });
});

describe("computeChannelPercents", () => {
  it("Σ pct = 100 auch bei 1/3-Kanten", () => {
    const out = computeChannelPercents([
      { name: "A", amountCents: 100 },
      { name: "B", amountCents: 100 },
      { name: "C", amountCents: 100 },
    ]);
    expect(out.reduce((s, i) => s + i.pct, 0)).toBe(100);
    expect(out.map((i) => i.pct).sort()).toEqual([33, 33, 34]);
  });
  it("exakte Aufteilung", () => {
    const out = computeChannelPercents([
      { name: "A", amountCents: 250 },
      { name: "B", amountCents: 750 },
    ]);
    expect(out).toEqual([
      { name: "A", amountCents: 250, pct: 25 },
      { name: "B", amountCents: 750, pct: 75 },
    ]);
  });
  it("leere Liste", () => {
    expect(computeChannelPercents([])).toEqual([]);
  });
  it("Gesamtsumme 0 → alle pct=0", () => {
    const out = computeChannelPercents([
      { name: "A", amountCents: 0 },
      { name: "B", amountCents: 0 },
    ]);
    expect(out.every((i) => i.pct === 0)).toBe(true);
  });
});

describe("sessionHouseCentsFromKasse — Kasse-Modell (N14b, 19.07.)", () => {
  it("Spicery 18.07.: Wolt-Zeile wird ignoriert (kein Doppelabzug)", () => {
    expect(
      sessionHouseCentsFromKasse({
        vectronCents: 667_250,
        channels: [
          { kind: "delivery_vectron", amountCents: 36_510 },
          { kind: "delivery_wolt", amountCents: 17_210 },
          { kind: "delivery_souse", amountCents: 0 },
        ],
      }),
    ).toBe(630_740);
  });

  it("Spicery 17.07. (SoUse-Fall): SoUse wird abgezogen", () => {
    expect(
      sessionHouseCentsFromKasse({
        vectronCents: 690_840,
        channels: [
          { kind: "delivery_vectron", amountCents: 34_030 },
          { kind: "delivery_wolt", amountCents: 28_750 },
          { kind: "delivery_souse", amountCents: 15_040 },
        ],
      }),
    ).toBe(641_770);
  });

  it("TSB-Stil: vectron=0, pos zählt, delivery_wolt ignoriert", () => {
    expect(
      sessionHouseCentsFromKasse({
        vectronCents: 0,
        channels: [
          { kind: "pos", amountCents: 200_000 },
          { kind: "delivery_wolt", amountCents: 50_000 },
        ],
      }),
    ).toBe(200_000);
  });

  it("Vectron ohne Kanäle → Vectron unverändert", () => {
    expect(sessionHouseCentsFromKasse({ vectronCents: 100_000, channels: [] })).toBe(100_000);
  });

  it("unbekannter kind wirft (kein stilles No-op)", () => {
    expect(() =>
      sessionHouseCentsFromKasse({
        vectronCents: 100_000,
        channels: [{ kind: "voucher_sold", amountCents: 500 }],
      }),
    ).toThrow();
  });

  it("leerer kind wirft", () => {
    expect(() =>
      sessionHouseCentsFromKasse({
        vectronCents: 100_000,
        channels: [{ kind: "", amountCents: 0 }],
      }),
    ).toThrow();
  });
});

describe("checkDonutSegments — UI-Validierung der Donut-Segmente", () => {
  it("ok ohne Meldung, wenn Segmentsumme = Marker + SoUse und keine Deckelung", () => {
    const r = checkDonutSegments({
      segmentSumCents: 40_000,
      markerSumCents: 36_510,
      souseSumCents: 3_490,
      takeawayCents: 40_000,
    });
    expect(r.ok).toBe(true);
    expect(r.capped).toBe(false);
    expect(r.message).toBeNull();
  });

  it("meldet Fehler mit Differenz, wenn Segmente nicht aufgehen", () => {
    const r = checkDonutSegments({
      segmentSumCents: 36_510,
      markerSumCents: 36_510,
      souseSumCents: 3_490,
      takeawayCents: 40_000,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Donut-Prüfung fehlgeschlagen");
    expect(r.message).toContain("34,90 €");
  });

  it("weist bei Deckelung auf min(vectron, marker+souse) hin, bleibt aber ok", () => {
    const r = checkDonutSegments({
      segmentSumCents: 50_000,
      markerSumCents: 50_000,
      souseSumCents: 0,
      takeawayCents: 40_000,
    });
    expect(r.ok).toBe(true);
    expect(r.capped).toBe(true);
    expect(r.message).toContain("gedeckelt");
  });
});
