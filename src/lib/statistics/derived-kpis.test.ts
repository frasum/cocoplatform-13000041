import { describe, expect, it } from "vitest";
import { derivedKpis, ppDelta, tipRatePct } from "./revenue-core";

describe("derivedKpis (STAT2)", () => {
  it("Normalfall: € je Gast aus HAUS, € je Stunde aus GESAMT", () => {
    const k = derivedKpis({
      houseCents: 200_000,
      totalCents: 260_000,
      guestCount: 80,
      workMinutes: 2_400, // 40 h
    });
    expect(k.revenuePerGuestCents).toBe(2_500);
    expect(k.revenuePerWorkHourCents).toBe(6_500);
    expect(k.workHours).toBe(40);
  });

  it("0 Gäste ⇒ null (kein NaN/Infinity)", () => {
    const k = derivedKpis({
      houseCents: 200_000,
      totalCents: 200_000,
      guestCount: 0,
      workMinutes: 600,
    });
    expect(k.revenuePerGuestCents).toBeNull();
    // 200.000 Cent auf 10 h ⇒ 20.000 Cent je Stunde
    expect(k.revenuePerWorkHourCents).toBe(20_000);
  });

  it("0 Arbeitsminuten ⇒ null", () => {
    const k = derivedKpis({
      houseCents: 100_000,
      totalCents: 100_000,
      guestCount: 50,
      workMinutes: 0,
    });
    expect(k.revenuePerWorkHourCents).toBeNull();
    expect(k.workHours).toBe(0);
    expect(k.revenuePerGuestCents).toBe(2_000);
  });

  it("beide Nenner 0 ⇒ beide null", () => {
    const k = derivedKpis({ houseCents: 0, totalCents: 0, guestCount: 0, workMinutes: 0 });
    expect(k.revenuePerGuestCents).toBeNull();
    expect(k.revenuePerWorkHourCents).toBeNull();
  });

  it("Rundung deterministisch (ganze Cent, Stunden auf 2 Dezimalen)", () => {
    const k = derivedKpis({
      houseCents: 10_000,
      totalCents: 10_000,
      guestCount: 3,
      workMinutes: 100,
    });
    expect(k.revenuePerGuestCents).toBe(3_333);
    expect(k.revenuePerWorkHourCents).toBe(6_000);
    expect(k.workHours).toBe(1.67);
  });

  it("negative Nenner werden als 0 behandelt (defensiv)", () => {
    const k = derivedKpis({
      houseCents: 1_000,
      totalCents: 1_000,
      guestCount: -5,
      workMinutes: -60,
    });
    expect(k.revenuePerGuestCents).toBeNull();
    expect(k.revenuePerWorkHourCents).toBeNull();
  });
});

// STAT2d — Trinkgeld-Quote (Bezug: HAUS-Umsatz) und pp-Delta.
describe("tipRatePct (STAT2d)", () => {
  it("Juli-Kontrollwert spicery: ca. 8,9 %", () => {
    const pct = tipRatePct(1_496_187, 16_790_690);
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(8.9105, 3);
    // Rundung passiert erst im Format, nicht in der Funktion.
    expect(pct!.toFixed(1)).toBe("8.9");
  });

  it("Haus-Umsatz 0 oder negativ ⇒ null", () => {
    expect(tipRatePct(10_000, 0)).toBeNull();
    expect(tipRatePct(10_000, -5_000)).toBeNull();
  });

  it("kein Trinkgeld ⇒ 0 (kein null)", () => {
    expect(tipRatePct(0, 100_000)).toBe(0);
  });
});

describe("ppDelta (STAT2d)", () => {
  it("Punktdifferenz zweier Quoten", () => {
    expect(ppDelta(8.3, 8.1)).toBeCloseTo(0.2, 10);
    expect(ppDelta(8.1, 8.3)).toBeCloseTo(-0.2, 10);
  });

  it("null-Eingaben ⇒ null", () => {
    expect(ppDelta(null, 8.1)).toBeNull();
    expect(ppDelta(8.1, null)).toBeNull();
    expect(ppDelta(null, null)).toBeNull();
  });
});
