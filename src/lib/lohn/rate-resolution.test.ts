import { describe, expect, it } from "vitest";
import { resolveRateCents, type RateRow } from "./rate-resolution";

const rates: RateRow[] = [
  { department: "service", validFrom: "2025-01-01", hourlyRateCents: 1400 },
  { department: "service", validFrom: "2026-01-01", hourlyRateCents: 1600 },
  { department: "gl", validFrom: "2026-01-01", hourlyRateCents: 2200 },
  { department: "kitchen", validFrom: "2026-06-01", hourlyRateCents: 1700 },
];

describe("resolveRateCents", () => {
  it("liefert null bei leerer Liste", () => {
    expect(resolveRateCents([], "service", "2026-07-01")).toBeNull();
  });

  it("liefert null wenn Bereich nicht gepflegt", () => {
    expect(resolveRateCents(rates, "kitchen", "2026-01-01")).toBeNull();
  });

  it("liefert null wenn businessDate vor jüngstem validFrom", () => {
    expect(resolveRateCents(rates, "kitchen", "2026-05-31")).toBeNull();
  });

  it("wählt jüngstes validFrom ≤ businessDate", () => {
    expect(resolveRateCents(rates, "service", "2025-12-31")).toBe(1400);
    expect(resolveRateCents(rates, "service", "2026-01-01")).toBe(1600);
    expect(resolveRateCents(rates, "service", "2026-07-15")).toBe(1600);
  });

  it("isoliert Bereiche (kein Fallback über Bereiche)", () => {
    expect(resolveRateCents(rates, "gl", "2026-07-01")).toBe(2200);
    expect(resolveRateCents(rates, "kitchen", "2026-06-01")).toBe(1700);
  });

  it("Grenztag: validFrom == businessDate ist gültig", () => {
    expect(resolveRateCents(rates, "gl", "2026-01-01")).toBe(2200);
  });
});
