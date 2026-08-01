import { describe, expect, it } from "vitest";
import { derivedKpis } from "./revenue-core";

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
