import { describe, expect, it } from "vitest";
import { computeSettlementWarnings } from "./settlement-warnings";

function base() {
  return {
    hasSettlements: true,
    posTotalCents: 0,
    deliveryVectronCents: 0,
    deliverySouseCents: 0,
    terminalsTotalCents: 0,
    glCardCents: 0,
    deliveryWoltCents: 0,
    waiterPosSalesCents: [] as number[],
    waiterCardTotalCents: [] as number[],
  };
}

describe("computeSettlementWarnings", () => {
  it("returns [] when there are no settlements, even with huge diffs", () => {
    const r = computeSettlementWarnings({
      ...base(),
      hasSettlements: false,
      posTotalCents: 100_000,
      terminalsTotalCents: 50_000,
    });
    expect(r).toEqual([]);
  });

  it("returns [] when everything matches exactly", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 14_000,
      deliverySouseCents: 2_000,
      deliveryVectronCents: 500,
      terminalsTotalCents: 8_000,
      waiterPosSalesCents: [6_000, 5_500],
      waiterCardTotalCents: [3_000, 5_000],
    });
    expect(r).toEqual([]);
  });

  it("returns single pos_diff with correct sign when only POS is off (+)", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 10_050,
      waiterPosSalesCents: [10_000],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "pos_diff", diffCents: 50 });
  });

  it("returns single pos_diff with correct sign when only POS is off (-)", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 10_000,
      waiterPosSalesCents: [10_050],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "pos_diff", diffCents: -50 });
  });

  it("returns single terminal_diff when only terminals off", () => {
    const r = computeSettlementWarnings({
      ...base(),
      terminalsTotalCents: 8_000,
      waiterCardTotalCents: [7_900],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "terminal_diff", diffCents: 100 });
  });

  it("returns both warnings in order pos_diff, terminal_diff", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 10_100,
      waiterPosSalesCents: [10_000],
      terminalsTotalCents: 5_000,
      waiterCardTotalCents: [4_950],
    });
    expect(r.map((w) => w.kind)).toEqual(["pos_diff", "terminal_diff"]);
  });

  it("warns at exactly 1 cent diff", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 10_001,
      waiterPosSalesCents: [10_000],
    });
    expect(r).toHaveLength(1);
    expect(r[0].diffCents).toBe(1);
  });

  it("does not warn at 0 cent diff", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 10_000,
      waiterPosSalesCents: [10_000],
    });
    expect(r).toEqual([]);
  });

  it("throws on non-integer input", () => {
    expect(() =>
      computeSettlementWarnings({
        ...base(),
        posTotalCents: 10.5,
        waiterPosSalesCents: [10],
      }),
    ).toThrow();
    expect(() =>
      computeSettlementWarnings({
        ...base(),
        waiterCardTotalCents: [1.2],
        terminalsTotalCents: 1,
      }),
    ).toThrow();
  });

  // Spicery 10.06.2026 — Live-Regressions-Guards.
  it("Spicery 10.06.2026: POS — Wolt (77200) ist gar kein Input mehr, keine POS-Warnung", () => {
    const r = computeSettlementWarnings({
      ...base(),
      posTotalCents: 607_740,
      waiterPosSalesCents: [152_140, 177_120, 185_150],
      deliveryVectronCents: 79_790,
      deliverySouseCents: 13_540,
    });
    expect(r.find((w) => w.kind === "pos_diff")).toBeUndefined();
  });

  it("Spicery 10.06.2026: Terminal — GL (1590) auf Kellner-Seite, keine Terminal-Warnung", () => {
    const r = computeSettlementWarnings({
      ...base(),
      terminalsTotalCents: 425_062,
      waiterCardTotalCents: [160_254, 177_142, 86_076],
      glCardCents: 1_590,
    });
    expect(r.find((w) => w.kind === "terminal_diff")).toBeUndefined();
  });

  it("Spicery 10.06.2026 Gegenprobe: ohne glCardCents → Terminal-Warnung diff=1590", () => {
    const r = computeSettlementWarnings({
      ...base(),
      terminalsTotalCents: 425_062,
      waiterCardTotalCents: [160_254, 177_142, 86_076],
      glCardCents: 0,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "terminal_diff", diffCents: 1_590, glCardCents: 0 });
  });
});

describe("wolt_exceeds_marker", () => {
  it("warns when Wolt exceeds the vectron takeaway marker", () => {
    const r = computeSettlementWarnings({
      ...base(),
      deliveryVectronCents: 24_000,
      deliveryWoltCents: 224_000,
      posTotalCents: 24_000,
      waiterPosSalesCents: [0],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "wolt_exceeds_marker",
      woltCents: 224_000,
      markerCents: 24_000,
      diffCents: 200_000,
    });
  });

  it("does not warn when Wolt equals the marker", () => {
    const r = computeSettlementWarnings({
      ...base(),
      deliveryVectronCents: 24_000,
      deliveryWoltCents: 24_000,
      posTotalCents: 24_000,
      waiterPosSalesCents: [0],
    });
    expect(r).toEqual([]);
  });

  it("warns even without settlements", () => {
    const r = computeSettlementWarnings({
      ...base(),
      hasSettlements: false,
      deliveryVectronCents: 100,
      deliveryWoltCents: 500,
      posTotalCents: 999_999,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "wolt_exceeds_marker", diffCents: 400 });
  });

  it("throws on non-integer wolt cents", () => {
    expect(() => computeSettlementWarnings({ ...base(), deliveryWoltCents: 1.5 })).toThrow(
      /deliveryWoltCents/,
    );
  });
});
