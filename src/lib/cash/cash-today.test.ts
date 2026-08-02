import { describe, expect, it } from "vitest";
import { cashBusinessMonthAnchor, defaultCashBusinessDate } from "./cash-today";

// Berlin-Sommerzeit: UTC+2 → 21:59Z entspricht 23:59 Ortszeit.
const berlin = (iso: string) => new Date(iso);

describe("defaultCashBusinessDate", () => {
  it("23:59 ⇒ heute", () => {
    expect(defaultCashBusinessDate(berlin("2026-08-02T21:59:00Z"))).toBe("2026-08-02");
  });
  it("00:30 ⇒ Vortag", () => {
    expect(defaultCashBusinessDate(berlin("2026-08-02T22:30:00Z"))).toBe("2026-08-02");
    expect(defaultCashBusinessDate(berlin("2026-08-03T22:30:00Z"))).toBe("2026-08-03");
  });
  it("02:59 Ortszeit ⇒ Vortag", () => {
    expect(defaultCashBusinessDate(berlin("2026-08-03T00:59:00Z"))).toBe("2026-08-02");
  });
  it("03:00 Ortszeit ⇒ heute", () => {
    expect(defaultCashBusinessDate(berlin("2026-08-03T01:00:00Z"))).toBe("2026-08-03");
  });
});

describe("cashBusinessMonthAnchor", () => {
  it("01. um 01:00 Ortszeit zeigt auf den Vormonat", () => {
    const anchor = cashBusinessMonthAnchor(berlin("2026-08-31T23:00:00Z")); // 01.09. 01:00
    expect(anchor.getFullYear()).toBe(2026);
    expect(anchor.getMonth()).toBe(7); // August
    expect(anchor.getDate()).toBe(31);
  });
  it("nach 03:00 zeigt auf den Kalendertag", () => {
    const anchor = cashBusinessMonthAnchor(berlin("2026-09-01T01:30:00Z")); // 01.09. 03:30
    expect(anchor.getMonth()).toBe(8);
    expect(anchor.getDate()).toBe(1);
  });
});
