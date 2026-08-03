import { describe, expect, it } from "vitest";
import { chartDaySlots, spanDays } from "./chart-days";
import type { DailyPoint } from "./chart-fill";

function pt(businessDate: string, totalCents: number): DailyPoint {
  return {
    businessDate,
    houseCents: totalCents,
    takeawayCents: 0,
    totalCents,
    cardCents: 0,
    guestCount: totalCents === 0 ? 0 : 10,
    workMinutes: 0,
  };
}

describe("spanDays", () => {
  it("voller August (31 Tage)", () => {
    const days = spanDays("2026-08-01", "2026-08-31");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-08-01");
    expect(days[30]).toBe("2026-08-31");
  });

  it("Monatswechsel und Schaltjahr-Februar", () => {
    expect(spanDays("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
    expect(spanDays("2024-02-01", "2024-02-29")).toHaveLength(29);
  });

  it("umgekehrtes Fenster ⇒ leer", () => {
    expect(spanDays("2026-08-05", "2026-08-01")).toEqual([]);
  });
});

describe("chartDaySlots", () => {
  it("laufender Monat: Achse bleibt voll, fehlende Tage sind null", () => {
    const slots = chartDaySlots([pt("2026-08-01", 120_000), pt("2026-08-02", 90_000)], {
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(slots).toHaveLength(31);
    expect(slots[0].point?.totalCents).toBe(120_000);
    expect(slots[1].point?.totalCents).toBe(90_000);
    expect(slots.slice(2).every((s) => s.point === null)).toBe(true);
    expect(slots[30].day).toBe("31");
  });

  it("echter 0-Umsatz-Tag bleibt 0 und wird nicht zur Lücke", () => {
    const slots = chartDaySlots([pt("2026-08-02", 0)], {
      startDate: "2026-08-01",
      endDate: "2026-08-03",
    });
    expect(slots[0].point).toBeNull();
    expect(slots[1].point?.totalCents).toBe(0);
    expect(slots[2].point).toBeNull();
  });

  it("Datentage außerhalb des Fensters werden ignoriert", () => {
    const slots = chartDaySlots([pt("2026-07-31", 500), pt("2026-08-01", 700)], {
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    expect(slots.map((s) => s.point?.totalCents ?? null)).toEqual([700, null]);
  });
});
