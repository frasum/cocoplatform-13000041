import { describe, expect, it } from "vitest";
import { sfnOverviewRateCents } from "./sfn-rate";
import type { RateRow } from "@/lib/lohn/rate-resolution";

const rates: RateRow[] = [
  { department: "service", validFrom: "2026-01-01", hourlyRateCents: 1500 },
  { department: "gl", validFrom: "2026-01-01", hourlyRateCents: 2200 },
  { department: "gl", validFrom: "2026-08-01", hourlyRateCents: 2400 },
];

describe("sfnOverviewRateCents", () => {
  it("gl+service: Hauptbereich gl gewinnt", () => {
    expect(sfnOverviewRateCents(["service", "gl"], rates, "2026-07-31")).toBe(2200);
  });

  it("nur service → Service-Satz", () => {
    expect(sfnOverviewRateCents(["service"], rates, "2026-07-31")).toBe(1500);
  });

  it("Hauptbereich ohne Satz → null (kein Bereichs-Fallback)", () => {
    expect(sfnOverviewRateCents(["kitchen", "service"], rates, "2026-07-31")).toBeNull();
  });

  it("valid_from-Historie: jüngste Zeile ≤ onDate, Zukunft wirkt nicht", () => {
    expect(sfnOverviewRateCents(["gl"], rates, "2026-07-31")).toBe(2200);
    expect(sfnOverviewRateCents(["gl"], rates, "2026-08-01")).toBe(2400);
    expect(sfnOverviewRateCents(["gl"], rates, "2025-12-31")).toBeNull();
  });

  it("leere Bereichs-Liste → Fallback-Hauptbereich service", () => {
    expect(sfnOverviewRateCents([], rates, "2026-07-31")).toBe(1500);
    expect(
      sfnOverviewRateCents([], [{ department: "gl", validFrom: "2026-01-01", hourlyRateCents: 2200 }], "2026-07-31"),
    ).toBeNull();
  });
});