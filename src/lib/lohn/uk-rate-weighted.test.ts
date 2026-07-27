import { describe, it, expect } from "vitest";
import { computeWeightedUkRate } from "./uk-rate-weighted";

describe("computeWeightedUkRate (LG3b G1)", () => {
  it("liefert null (no_hours) wenn keine bezahlten Stunden im Fenster liegen", () => {
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 0, rateCents: 2300 },
      { department: "service", paidHours: 0, rateCents: 1500 },
    ]);
    expect(r).toEqual({ rateCents: null, reason: "no_hours" });
  });

  it("liefert null (missing_rate) wenn ein Bereich mit Stunden keinen Satz hat", () => {
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 30, rateCents: 2300 },
      { department: "service", paidHours: 20, rateCents: null },
    ]);
    expect(r.rateCents).toBeNull();
    expect(r.reason).toBe("missing_rate");
    expect(r.missingDepartments).toEqual(["service"]);
  });

  it("listet alle fehlenden Bereiche auf, deduped und in Eingabereihenfolge", () => {
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 1, rateCents: null },
      { department: "kitchen", paidHours: 2, rateCents: null },
      { department: "gl", paidHours: 3, rateCents: null },
    ]);
    expect(r.reason).toBe("missing_rate");
    expect(r.missingDepartments).toEqual(["gl", "kitchen"]);
  });

  it("ignoriert Bereiche ohne Stunden bei der Blocker-Prüfung", () => {
    // service hat 0 Stunden — sein fehlender Satz darf nicht blockieren.
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 40, rateCents: 2300 },
      { department: "service", paidHours: 0, rateCents: null },
    ]);
    expect(r).toEqual({ rateCents: 2300 });
  });

  it("Ein-Bereich mit Stunden: liefert exakt den Bereichssatz", () => {
    const r = computeWeightedUkRate([
      { department: "service", paidHours: 173.55, rateCents: 1500 },
    ]);
    expect(r).toEqual({ rateCents: 1500 });
  });

  it("Zwei Bereiche: gewichteter Mittelsatz (LAM-artig)", () => {
    // 60 h GL @ 22,00 €  +  20 h Service @ 15,00 €
    // = (60*2200 + 20*1500) / 80 = (132000 + 30000) / 80 = 2025
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 60, rateCents: 2200 },
      { department: "service", paidHours: 20, rateCents: 1500 },
    ]);
    expect(r).toEqual({ rateCents: 2025 });
  });

  it("Drei Bereiche gleich (MO-Sollwert 23,00 €): identischer Cent-Satz", () => {
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 10, rateCents: 2300 },
      { department: "kitchen", paidHours: 15, rateCents: 2300 },
      { department: "service", paidHours: 25, rateCents: 2300 },
    ]);
    expect(r).toEqual({ rateCents: 2300 });
  });

  it("rundet halbe Cent auf ganze Cent (banker/nearest via Math.round)", () => {
    // (1*100 + 1*101) / 2 = 100.5  → 101 (Math.round rundet 0.5 → 1)
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 1, rateCents: 100 },
      { department: "service", paidHours: 1, rateCents: 101 },
    ]);
    expect(r.rateCents).toBe(101);
  });

  it("respektiert ungerundete Bruchstunden im 91-Tage-Fenster", () => {
    // 0,2 h GL @ 2000  +  0,8 h Service @ 1000
    // = (0.2*2000 + 0.8*1000) / 1.0 = (400 + 800) / 1 = 1200
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: 0.2, rateCents: 2000 },
      { department: "service", paidHours: 0.8, rateCents: 1000 },
    ]);
    expect(r).toEqual({ rateCents: 1200 });
  });

  it("negative paidHours werden wie 0 behandelt (defensive)", () => {
    const r = computeWeightedUkRate([
      { department: "gl", paidHours: -5, rateCents: 2200 },
      { department: "service", paidHours: 10, rateCents: 1500 },
    ]);
    expect(r).toEqual({ rateCents: 1500 });
  });
});