import { describe, expect, it } from "vitest";
import {
  aggregateGroup,
  buildWaterfall,
  computeBreakEven,
  compareCostCenters,
  deltas,
  deriveKpis,
  estimatedPreTaxResultCents,
  findPrevMonth,
  findYoy,
  OPEN_DAYS_PER_MONTH,
  INHOUSE_FOOD_REDUCED_FROM,
  sumRows,
  sumSachkostenDetail,
} from "./bwa-analytics";
import type { BreakEven } from "./bwa-analytics";
import type { BwaRow } from "./bwa.functions";

function row(overrides: Partial<BwaRow>): BwaRow {
  return {
    id: overrides.id ?? "r",
    entity: overrides.entity ?? "YUM",
    costCenter: overrides.costCenter ?? "01",
    month: overrides.month ?? "2025-04-01",
    umsatzCents: 0,
    getraenkeCents: 0,
    speisenHausCents: 0,
    speisenAusserHausCents: 0,
    sonstigeErloeseCents: 0,
    sonstErtraegeCents: 0,
    wareneinsatzCents: 0,
    personalCents: 0,
    sachkostenCents: 0,
    anlageCents: 0,
    abschreibungCents: 0,
    betriebsergebnisCents: 0,
    sachkostenDetail: null,
    source: "import",
    ...overrides,
  };
}

describe("aggregateGroup", () => {
  it("summiert YUM + Spicery pro Monat elementweise zur virtuellen Kostenstelle 'Gruppe'", () => {
    const rows = [
      row({ entity: "YUM", costCenter: "01", month: "2025-04-01", umsatzCents: 100_00 }),
      row({ entity: "YUM", costCenter: "02", month: "2025-04-01", umsatzCents: 200_00 }),
      row({ entity: "YUM", costCenter: "01", month: "2025-03-01", umsatzCents: 50_00 }),
    ];
    const g = aggregateGroup(rows).sort((a, b) => b.month.localeCompare(a.month));
    expect(g).toHaveLength(2);
    expect(g[0].costCenter).toBe("Gruppe");
    expect(g[0].month).toBe("2025-04-01");
    expect(g[0].umsatzCents).toBe(300_00);
    expect(g[1].umsatzCents).toBe(50_00);
  });
});

describe("deriveKpis + deltas", () => {
  it("liefert Personal-/WES-/PrimeCost-Quoten in Prozent", () => {
    const r = row({
      umsatzCents: 100_000_00,
      wareneinsatzCents: 30_000_00,
      personalCents: 40_000_00,
      sachkostenCents: 10_000_00,
      anlageCents: 2_000_00,
      abschreibungCents: 1_000_00,
      betriebsergebnisCents: 17_000_00,
    });
    const k = deriveKpis(r);
    expect(k.wesQuote).toBeCloseTo(30, 6);
    expect(k.personalQuote).toBeCloseTo(40, 6);
    expect(k.primeCostQuote).toBeCloseTo(70, 6);
    expect(k.rohertrag1Quote).toBeCloseTo(70, 6);
    expect(k.betriebsQuote).toBeCloseTo(17, 6);
  });

  it("deltas: cur - prev absolut und prozentual; prev undefined => null", () => {
    expect(deltas(120, 100)).toEqual({ absCents: 20, pct: 20 });
    expect(deltas(80, 100)).toEqual({ absCents: -20, pct: -20 });
    expect(deltas(50, undefined)).toBeNull();
    expect(deltas(10, 0)).toEqual({ absCents: 10, pct: null });
  });
});

describe("buildWaterfall", () => {
  it("Endsumme = Betriebsergebnis; Summe(plus) - Summe(minus) = Betriebsergebnis-Soll", () => {
    const r = row({
      umsatzCents: 100_000_00,
      sonstErtraegeCents: 5_000_00,
      wareneinsatzCents: 20_000_00,
      personalCents: 40_000_00,
      sachkostenCents: 15_000_00,
      anlageCents: 3_000_00,
      abschreibungCents: 2_000_00,
      betriebsergebnisCents: 25_000_00,
    });
    const steps = buildWaterfall(r);
    const last = steps[steps.length - 1];
    expect(last.label).toBe("Betriebsergebnis");
    expect(last.kind).toBe("total");
    expect(last.signedCents).toBe(25_000_00);

    const plus = steps.filter((s) => s.kind === "plus").reduce((a, s) => a + s.signedCents, 0);
    const minus = steps.filter((s) => s.kind === "minus").reduce((a, s) => a + s.signedCents, 0);
    expect(plus + minus).toBe(25_000_00);
  });
});

describe("computeBreakEven", () => {
  it("Referenzfall: ΣUmsatz 1 Mio €, ΣWES 200k, ΣPersonal 500k, ΣSach 200k, ΣAnlage 80k, ΣAfA 20k, ΣSonstErtr 50k → BE/Tag ≈ 260.417 Cent, MoS 6,25 %", () => {
    // 12 Monatszeilen: nur Zeile 0 trägt die Σ-Werte, restliche 11 sind leer.
    // Für die Analytik zählt nur die Summe der 12 (rollierendes Fenster).
    const rows: BwaRow[] = [];
    rows.push(
      row({
        month: "2025-04-01",
        umsatzCents: 1_000_000_00,
        wareneinsatzCents: 200_000_00,
        personalCents: 500_000_00,
        sachkostenCents: 200_000_00,
        anlageCents: 80_000_00,
        abschreibungCents: 20_000_00,
        sonstErtraegeCents: 50_000_00,
      }),
    );
    for (let i = 1; i < 12; i++) rows.push(row({ month: `2024-${String(i).padStart(2, "0")}-01` }));

    const be = computeBreakEven(rows);
    expect(be).not.toBeNull();
    if (!be) throw new Error("unreachable");
    expect(be.months).toBe(12);
    expect(be.v).toBeCloseTo(0.2, 6);
    expect(be.db).toBeCloseTo(0.8, 6);
    // bePeriod = (Fix - SonstErtr) / db = (800k - 50k)/0.8 = 937.500 €
    // BE/Monat = 937.500/12 = 78.125 €
    expect(be.netMonthCents).toBe(78_125_00);
    // BE/Tag = 78.125/30 = 2604,1666... € → gerundet 260.417 Cent
    expect(be.netDayCents).toBe(260_417);
    expect(be.marginOfSafety).toBeCloseTo(0.0625, 6);
    expect(OPEN_DAYS_PER_MONTH).toBe(30);
  });

  it("USt-Mix-Faktor aus tatsächlichen Erlösen: 800k @19% + 200k @7% → 1,166", () => {
    const r = row({
      umsatzCents: 1_000_000_00,
      getraenkeCents: 400_000_00,
      sonstigeErloeseCents: 100_000_00,
      speisenHausCents: 300_000_00,
      speisenAusserHausCents: 200_000_00,
      wareneinsatzCents: 200_000_00,
      personalCents: 500_000_00,
      sachkostenCents: 100_000_00,
    });
    const be = computeBreakEven([r]);
    expect(be).not.toBeNull();
    if (!be) throw new Error("unreachable");
    expect(be.factor).toBeCloseTo(1.166, 3);
  });

  it("liefert null bei leerem Input und bei db <= 0", () => {
    expect(computeBreakEven([])).toBeNull();
    const bad = row({ umsatzCents: 100_00, wareneinsatzCents: 200_00 });
    expect(computeBreakEven([bad])).toBeNull();
  });

  it("F2b: Sortierung des Inputs egal — asc / gemischt liefert dasselbe Ergebnis wie desc", () => {
    const mk = (m: string, u: number, w: number) =>
      row({
        month: m,
        umsatzCents: u,
        wareneinsatzCents: w,
        personalCents: 10_000_00,
        sachkostenCents: 2_000_00,
      });
    // 13 Monate — nur die 12 neuesten dürfen zählen.
    const months = [
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
      "2024-06-01",
      "2024-07-01",
      "2024-08-01",
      "2024-09-01",
      "2024-10-01",
      "2024-11-01",
      "2024-12-01",
      "2025-01-01",
    ];
    const rows = months.map((m, i) => mk(m, 50_000_00 + i * 100_00, 10_000_00));
    const desc = [...rows].sort((a, b) => b.month.localeCompare(a.month));
    const asc = [...rows].sort((a, b) => a.month.localeCompare(b.month));
    const mixed = [
      rows[5],
      rows[0],
      rows[12],
      rows[3],
      ...rows.slice(6, 12),
      rows[1],
      rows[2],
      rows[4],
    ];
    expect(computeBreakEven(asc)).toEqual(computeBreakEven(desc));
    expect(computeBreakEven(mixed)).toEqual(computeBreakEven(desc));
  });
});

describe("BWA-V1: USt-Zuordnung Haus-Speisen ab 2026-01", () => {
  // Ein Monat mit fixem Erlösmix; Kosten so, dass db > 0.
  const mk = (month: string) =>
    row({
      month,
      umsatzCents: 100_000_00,
      getraenkeCents: 40_000_00,
      sonstigeErloeseCents: 10_000_00,
      speisenHausCents: 30_000_00,
      speisenAusserHausCents: 20_000_00,
      wareneinsatzCents: 30_000_00,
      personalCents: 40_000_00,
      sachkostenCents: 10_000_00,
    });

  const months = (year: number, count: number, from = 1) =>
    Array.from({ length: count }, (_, i) => mk(`${year}-${String(from + i).padStart(2, "0")}-01`));

  it("Stichtags-Konstante ist 2026-01", () => {
    expect(INHOUSE_FOOD_REDUCED_FROM).toBe("2026-01");
  });

  it("reine Alt-Periode (12 × 2025): factor wie bisher (Haus-Speisen 19 %)", () => {
    const be = computeBreakEven(months(2025, 12));
    if (!be) throw new Error("unreachable");
    // Σ pro Monat: rev19 = 40+10+30 = 80k, rev7 = 20k
    const vatPerMonth = 80_000_00 * 0.19 + 20_000_00 * 0.07;
    const expected = (100_000_00 * 12 + vatPerMonth * 12) / (100_000_00 * 12);
    expect(be.factor).toBeCloseTo(expected, 12);
    expect(be.factorCurrent).toBeNull();
    // Netto-Pfade unberührt
    expect(be.db).toBeCloseTo(0.7, 12);
    expect(be.netMonthCents).toBe(Math.round(50_000_00 / 0.7));
  });

  it("reine Neu-Periode (12 × 2026): Haus-Speisen mit 7 %, factorCurrent === factor", () => {
    const be = computeBreakEven(months(2026, 12));
    if (!be) throw new Error("unreachable");
    const vatPerMonth = 50_000_00 * 0.19 + 50_000_00 * 0.07;
    const expected = (100_000_00 * 12 + vatPerMonth * 12) / (100_000_00 * 12);
    expect(be.factor).toBeCloseTo(expected, 12);
    expect(be.factorCurrent).not.toBeNull();
    expect(be.factorCurrent).toBeCloseTo(be.factor, 12);
  });

  it("Mischperiode 5 × 2025 + 7 × 2026: monatsgenaue Summe, factorCurrent nur aus 2026", () => {
    const rows = [...months(2025, 5, 8), ...months(2026, 7)];
    const be = computeBreakEven(rows);
    if (!be) throw new Error("unreachable");
    const vatOld = 80_000_00 * 0.19 + 20_000_00 * 0.07;
    const vatNew = 50_000_00 * 0.19 + 50_000_00 * 0.07;
    const rev = 100_000_00 * 12;
    expect(be.factor).toBeCloseTo((rev + (5 * vatOld + 7 * vatNew)) / rev, 12);
    expect(be.factorCurrent).toBeCloseTo((100_000_00 * 7 + 7 * vatNew) / (100_000_00 * 7), 12);
  });

  it("Fenster komplett vor Stichtag: factorCurrent null ⇒ STAT3h liefert null", () => {
    const be = computeBreakEven(months(2025, 12));
    if (!be) throw new Error("unreachable");
    expect(be.factorCurrent).toBeNull();
    expect(estimatedPreTaxResultCents(300_000_00, be)).toBeNull();
  });

  it("STAT3h rechnet mit factorCurrent: höheres Ergebnis als mit dem Misch-factor", () => {
    const rows = [...months(2025, 5, 8), ...months(2026, 7)];
    const be = computeBreakEven(rows);
    if (!be) throw new Error("unreachable");
    const gross = 344_774_00;
    const withCurrent = estimatedPreTaxResultCents(gross, be);
    const withMix = Math.round(be.db * (gross / be.factor - be.netMonthCents));
    expect(withCurrent).not.toBeNull();
    expect(withCurrent ?? 0).toBeGreaterThan(withMix);
  });
});

describe("estimatedPreTaxResultCents (STAT3h)", () => {
  const be = (o: Partial<BreakEven>): BreakEven => ({
    v: 0.3,
    db: 0.7,
    factor: 1.163,
    factorCurrent: 1.163,
    months: 12,
    netMonthCents: 280_835_00,
    netDayCents: 0,
    grossMonthCents: 0,
    grossDayCents: 0,
    actualDayCents: 0,
    marginOfSafety: 0,
    ...o,
  });

  it("Handrechnung: db 0,7 · factor 1,163 · BE 280.835 € · Umsatz 344.774 € brutto", () => {
    const gross = 344_774_00;
    const expected = Math.round(0.7 * (gross / 1.163 - 280_835_00));
    expect(estimatedPreTaxResultCents(gross, be({}))).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("Monat exakt am Break-even ⇒ 0", () => {
    const gross = Math.round(280_835_00 * 1.163);
    const r = estimatedPreTaxResultCents(gross, be({}));
    expect(r).not.toBeNull();
    expect(Math.abs(r ?? 0)).toBeLessThanOrEqual(1);
  });

  it("Monat unter Break-even ⇒ negativ", () => {
    expect(estimatedPreTaxResultCents(200_000_00, be({}))).toBeLessThan(0);
  });

  it("be = null ⇒ null", () => {
    expect(estimatedPreTaxResultCents(300_000_00, null)).toBeNull();
  });

  it("Umsatz 0 ⇒ negatives Ergebnis = −db × BE (Fixkostenlast)", () => {
    expect(estimatedPreTaxResultCents(0, be({}))).toBe(Math.round(-0.7 * 280_835_00));
  });
});

describe("sumRows / findYoy / findPrevMonth", () => {
  it("sumRows summiert alle Cent-Felder", () => {
    const a = row({ umsatzCents: 100, personalCents: 40 });
    const b = row({ umsatzCents: 200, personalCents: 60 });
    const s = sumRows([a, b]);
    expect(s.umsatzCents).toBe(300);
    expect(s.personalCents).toBe(100);
  });

  it("findYoy findet Vorjahresmonat", () => {
    const rows = [row({ month: "2025-04-01" }), row({ month: "2024-04-01" })];
    expect(findYoy(rows, "2025-04-01")?.month).toBe("2024-04-01");
    expect(findYoy(rows, "2023-04-01")).toBeUndefined();
  });

  it("findPrevMonth findet den chronologisch vorherigen Datenpunkt", () => {
    const rows = [
      row({ month: "2025-04-01" }),
      row({ month: "2025-03-01" }),
      row({ month: "2025-01-01" }),
    ];
    expect(findPrevMonth(rows, "2025-04-01")?.month).toBe("2025-03-01");
    expect(findPrevMonth(rows, "2025-03-01")?.month).toBe("2025-01-01");
    expect(findPrevMonth(rows, "2025-01-01")).toBeUndefined();
  });
});

describe("sumSachkostenDetail", () => {
  it("summiert überlappende + disjunkte Labels; null-Zeilen zählen als missing", () => {
    const rs = [
      row({
        month: "2025-03-01",
        sachkostenCents: 1_000_00,
        sachkostenDetail: { Energie: 400_00, Miete: 600_00 },
      }),
      row({
        month: "2025-04-01",
        sachkostenCents: 1_200_00,
        sachkostenDetail: { Energie: 500_00, Reinigung: 700_00 },
      }),
      row({ month: "2025-05-01", sachkostenCents: 900_00, sachkostenDetail: null }),
    ];
    const s = sumSachkostenDetail(rs);
    expect(s.detail).toEqual({ Energie: 900_00, Miete: 600_00, Reinigung: 700_00 });
    expect(s.coveredSachkostenCents).toBe(2_200_00);
    expect(s.missingMonths).toBe(1);
  });

  it("negative Beträge bleiben erhalten (z. B. Gutschrift Beratung)", () => {
    const s = sumSachkostenDetail([
      row({ sachkostenCents: 100_00, sachkostenDetail: { Beratung: -50_00 } }),
    ]);
    expect(s.detail.Beratung).toBe(-50_00);
  });

  it("leere Liste → alles Null/0", () => {
    const s = sumSachkostenDetail([]);
    expect(s.detail).toEqual({});
    expect(s.coveredSachkostenCents).toBe(0);
    expect(s.missingMonths).toBe(0);
  });
});

describe("compareCostCenters", () => {
  it("markiert YUM (schlechte Personalquote) rot, Spicery (bessere Prime Cost) grün", () => {
    const rs = [
      row({
        entity: "YUM",
        costCenter: "YUM",
        month: "2025-04-01",
        umsatzCents: 100_000_00,
        wareneinsatzCents: 30_000_00,
        personalCents: 45_000_00,
        betriebsergebnisCents: 5_000_00,
      }),
      row({
        entity: "YUM",
        costCenter: "Spicery",
        month: "2025-04-01",
        umsatzCents: 100_000_00,
        wareneinsatzCents: 28_000_00,
        personalCents: 30_000_00,
        betriebsergebnisCents: 20_000_00,
      }),
    ];
    const c = compareCostCenters(rs, ["2025-04-01"]);
    expect(c.entries).toHaveLength(2);
    expect(c.worstByMetric.personalQuote).toBe("YUM");
    expect(c.bestByMetric.personalQuote).toBe("Spicery");
    expect(c.worstByMetric.primeCostQuote).toBe("YUM");
    expect(c.bestByMetric.betriebsQuote).toBe("Spicery");
  });

  it("Einzelkostenstelle → keine Markierungen", () => {
    const rs = [row({ costCenter: "Solo", umsatzCents: 100_00 })];
    const c = compareCostCenters(rs, ["2025-04-01"]);
    expect(c.entries).toHaveLength(1);
    expect(c.bestByMetric).toEqual({});
    expect(c.worstByMetric).toEqual({});
  });

  it("ignoriert virtuelle Kostenstelle 'Gruppe' und leere Liste", () => {
    const rs = [row({ costCenter: "Gruppe", month: "2025-04-01" })];
    const c = compareCostCenters(rs, ["2025-04-01"]);
    expect(c.entries).toHaveLength(0);
    expect(compareCostCenters([], []).entries).toHaveLength(0);
  });
});
