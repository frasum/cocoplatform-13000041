import { describe, expect, it } from "vitest";
import type { RateRow } from "@/lib/lohn/rate-resolution";
import { aggregatePersonnel, personnelRatioPct, type WorkEntry } from "./personnel-core";

const entry = (p: Partial<WorkEntry> & Pick<WorkEntry, "staffId" | "netMinutes">): WorkEntry => ({
  businessDate: "2026-06-01",
  department: "service",
  unresolved: false,
  ...p,
});

describe("aggregatePersonnel — Bereichs-Sätze (ST1-A)", () => {
  it("zwei Bereiche, zwei Sätze → bereichsgenaue Produkte", () => {
    const rates: Record<string, RateRow[]> = {
      a: [
        { department: "service", validFrom: "2026-01-01", hourlyRateCents: 1500 },
        { department: "gl", validFrom: "2026-01-01", hourlyRateCents: 2200 },
      ],
    };
    const entries = [
      entry({ staffId: "a", netMinutes: 120, department: "service" }), // 2h × 15,00
      entry({ staffId: "a", netMinutes: 60, department: "gl" }), // 1h × 22,00
    ];
    const agg = aggregatePersonnel(entries, rates);
    expect(agg.totalNetHours).toBe(3);
    expect(agg.totalLaborCostCents).toBe(3000 + 2200);
    expect(agg.unratedNetHours).toBe(0);
    expect(agg.staffWithoutRate).toEqual([]);
  });

  it("Satzwechsel per valid_from wirkt tagesgenau", () => {
    const rates: Record<string, RateRow[]> = {
      a: [
        { department: "service", validFrom: "2026-01-01", hourlyRateCents: 1400 },
        { department: "service", validFrom: "2026-06-15", hourlyRateCents: 1600 },
      ],
    };
    const entries = [
      entry({ staffId: "a", netMinutes: 60, businessDate: "2026-06-14" }),
      entry({ staffId: "a", netMinutes: 60, businessDate: "2026-06-15" }),
    ];
    const agg = aggregatePersonnel(entries, rates);
    expect(agg.totalLaborCostCents).toBe(1400 + 1600);
  });

  it("kein Satz gepflegt → unratedNetHours statt 0-Kosten-Mischung", () => {
    const rates: Record<string, RateRow[]> = {
      a: [{ department: "service", validFrom: "2026-01-01", hourlyRateCents: 1500 }],
    };
    const entries = [
      entry({ staffId: "a", netMinutes: 60, department: "service" }),
      entry({ staffId: "a", netMinutes: 90, department: "kitchen" }), // kein Küchensatz
    ];
    const agg = aggregatePersonnel(entries, rates);
    expect(agg.totalLaborCostCents).toBe(1500);
    expect(agg.unratedNetHours).toBe(1.5);
    expect(agg.staffWithoutRate).toEqual(["a"]);
    expect(agg.perStaff[0].unratedNetHours).toBe(1.5);
    expect(agg.totalNetHours).toBe(2.5);
  });

  it("unresolved-Eintrag wird nicht bewertet, auch wenn ein Satz existiert", () => {
    const rates: Record<string, RateRow[]> = {
      a: [{ department: "service", validFrom: "2026-01-01", hourlyRateCents: 1500 }],
    };
    const agg = aggregatePersonnel(
      [entry({ staffId: "a", netMinutes: 120, department: "service", unresolved: true })],
      rates,
    );
    expect(agg.totalLaborCostCents).toBe(0);
    expect(agg.unratedNetHours).toBe(2);
    expect(agg.staffWithoutRate).toEqual(["a"]);
  });

  it("Cent-genaue Rundung je Eintrag", () => {
    const rates: Record<string, RateRow[]> = {
      a: [{ department: "service", validFrom: "2026-01-01", hourlyRateCents: 1000 }],
    };
    // 20 min = 1/3 h → 333,33 ct → 333 ct je Eintrag, dreimal = 999 ct
    const entries = [1, 2, 3].map(() => entry({ staffId: "a", netMinutes: 20 }));
    const agg = aggregatePersonnel(entries, rates);
    expect(agg.totalLaborCostCents).toBe(999);
  });

  it("Sortierung perStaff absteigend nach laborCostCents", () => {
    const rates: Record<string, RateRow[]> = {
      a: [{ department: "service", validFrom: "2026-01-01", hourlyRateCents: 1500 }],
      b: [{ department: "service", validFrom: "2026-01-01", hourlyRateCents: 2000 }],
    };
    const agg = aggregatePersonnel(
      [entry({ staffId: "a", netMinutes: 60 }), entry({ staffId: "b", netMinutes: 60 })],
      rates,
    );
    expect(agg.perStaff.map((p) => p.staffId)).toEqual(["b", "a"]);
  });
});

describe("personnelRatioPct", () => {
  it("normaler Fall", () => {
    expect(personnelRatioPct(30_000, 100_000)).toBe(30);
  });
  it("revenue 0 → null", () => {
    expect(personnelRatioPct(30_000, 0)).toBeNull();
  });
});
