import { describe, expect, it } from "vitest";
import { sumGuestsByDate } from "./revenue-core";

describe("sumGuestsByDate (STAT2)", () => {
  it("summiert mehrere Sessions am selben Tag (zwei Standorte, Filter alle)", () => {
    const { byDate, total } = sumGuestsByDate([
      { businessDate: "2026-07-01", guestCount: 42 }, // Spicery
      { businessDate: "2026-07-01", guestCount: 18 }, // TSB
      { businessDate: "2026-07-02", guestCount: 30 },
    ]);
    expect(byDate.get("2026-07-01")).toBe(60);
    expect(byDate.get("2026-07-02")).toBe(30);
    expect(total).toBe(90);
  });

  it("null-Zählungen gelten als 0", () => {
    const { byDate, total } = sumGuestsByDate([
      { businessDate: "2026-07-01", guestCount: null },
      { businessDate: "2026-07-01", guestCount: 12 },
    ]);
    expect(byDate.get("2026-07-01")).toBe(12);
    expect(total).toBe(12);
  });

  it("leere Eingabe ⇒ 0", () => {
    const { byDate, total } = sumGuestsByDate([]);
    expect(byDate.size).toBe(0);
    expect(total).toBe(0);
  });
});