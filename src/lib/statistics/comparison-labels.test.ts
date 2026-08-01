import { describe, expect, it } from "vitest";

import { formatPctDe, leadDelta, previousTrendLabel } from "./comparison-labels";

describe("formatPctDe", () => {
  it("deutsche Nachkommastelle, ohne Vorzeichen", () => {
    expect(formatPctDe(15.24)).toBe("15,2");
    expect(formatPctDe(-13.2)).toBe("13,2");
  });
});

describe("leadDelta", () => {
  it("führender Standort links", () => {
    const d = leadDelta({ aName: "spicery", bName: "YUM", aValue: 11_520, bValue: 10_000 });
    expect(d.leader).toBe("a");
    expect(d.text).toBe("spicery +15,2 % vs. YUM");
    expect(d.tone).toBe("up");
  });

  it("führender Standort rechts", () => {
    const d = leadDelta({ aName: "spicery", bName: "YUM", aValue: 10_000, bValue: 11_520 });
    expect(d.leader).toBe("b");
    expect(d.text).toBe("YUM +15,2 % vs. spicery");
  });

  it("Gleichstand ⇒ 0 %", () => {
    const d = leadDelta({ aName: "A", bName: "B", aValue: 500, bValue: 500 });
    expect(d).toEqual({ leader: null, pct: 0, text: "Gleichstand (±0,0 %)", tone: "neutral" });
  });

  it("ein Wert 0 ⇒ Richtung ohne Prozentwert", () => {
    const d = leadDelta({ aName: "A", bName: "B", aValue: 900, bValue: 0 });
    expect(d.leader).toBe("a");
    expect(d.pct).toBeNull();
    expect(d.text).toBe("A führt vs. B — kein Prozentwert (Vergleichswert 0)");
  });

  it("fehlender Wert ⇒ Gedankenstrich", () => {
    expect(leadDelta({ aName: "A", bName: "B", aValue: null, bValue: 10 }).text).toBe("—");
    expect(leadDelta({ aName: "A", bName: "B", aValue: 10, bValue: null }).text).toBe("—");
  });
});

describe("previousTrendLabel", () => {
  const range = { startDate: "2026-06-01", endDate: "2026-06-30" };

  it("Normalfall mit Fensterlabel", () => {
    expect(previousTrendLabel(11_200, 10_000, range).text).toBe("+12,0 % vs. 01.–30.06.2026");
  });

  it("negativer Trend", () => {
    const t = previousTrendLabel(8_000, 10_000, range);
    expect(t.text).toBe("−20,0 % vs. 01.–30.06.2026");
    expect(t.tone).toBe("down");
  });

  it("Vormonat fehlt ⇒ Gedankenstrich", () => {
    expect(previousTrendLabel(10_000, null, range).text).toBe("—");
    expect(previousTrendLabel(10_000, undefined, range).text).toBe("—");
    expect(previousTrendLabel(null, 10_000, range).text).toBe("—");
  });

  it("Vormonat 0 ⇒ Gedankenstrich (kein Infinity)", () => {
    const t = previousTrendLabel(10_000, 0, range);
    expect(t.pct).toBeNull();
    expect(t.text).toBe("—");
  });

  it("ohne Fenster: neutraler Zusatz", () => {
    expect(previousTrendLabel(11_200, 10_000, null).text).toBe("+12,0 % vs. Vormonat");
  });

  it("Teilmonat wird im Fensterlabel markiert", () => {
    expect(
      previousTrendLabel(
        11_200,
        10_000,
        { startDate: "2026-06-01", endDate: "2026-06-18" },
        {
          partial: true,
        },
      ).text,
    ).toBe("+12,0 % vs. 01.–18.06.2026 (gleicher Tagesausschnitt)");
  });
});
