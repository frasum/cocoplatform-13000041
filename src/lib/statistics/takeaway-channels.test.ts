// STAT3b — blockierende Tests der Kanal-Tabelle. Prüft, dass das Modul die
// Zerlegung aus revenue-core konsumiert (keine zweite Formel), Kanäle immer
// vollständig belegt sind und fehlende Vorperioden zu null werden.

import { describe, expect, it } from "vitest";
import {
  TAKEAWAY_CHANNEL_ORDER,
  takeawayChannelRows,
  takeawayMatrix,
  takeawaySharePctOfTotal,
} from "./takeaway-channels";
import { fmtPctDe } from "./statistik-pdf";

const cur = { markerSumCents: 36_510, souseSumCents: 10_000, woltInfoCents: 17_210 };
const prev = { markerSumCents: 30_000, souseSumCents: 5_000, woltInfoCents: 12_000 };

describe("takeawayChannelRows", () => {
  it("Zerlegt Marker in Wolt + Direkt, SoUse unverändert", () => {
    const { rows, sum } = takeawayChannelRows(cur, null);
    expect(rows.map((r) => [r.name, r.amountCents])).toEqual([
      ["Wolt", 17_210],
      ["Takeaway direkt (Telefon/Abholung)", 19_300],
      ["SoUse", 10_000],
    ]);
    expect(sum.amountCents).toBe(46_510);
  });

  it("Anteile summieren auf 100 %", () => {
    const { rows, sum } = takeawayChannelRows(cur, null);
    const total = rows.reduce((a, r) => a + (r.sharePct ?? 0), 0);
    expect(total).toBeCloseTo(100, 8);
    expect(sum.sharePct).toBe(100);
  });

  it("Δ je Kanal gegen die Vorperiode", () => {
    const { rows, sum } = takeawayChannelRows(cur, prev);
    expect(rows[0]!.prevCents).toBe(12_000);
    expect(fmtPctDe(rows[0]!.deltaPct)).toBe("43,4 %");
    expect(rows[2]!.prevCents).toBe(5_000);
    expect(fmtPctDe(rows[2]!.deltaPct)).toBe("100,0 %");
    expect(sum.prevCents).toBe(35_000);
  });

  it("Fehlende Vorperiode ⇒ null (kein 0-Fake)", () => {
    const { rows, sum } = takeawayChannelRows(cur, null);
    expect(rows.every((r) => r.prevCents === null && r.deltaPct === null)).toBe(true);
    expect(sum.deltaPct).toBeNull();
  });

  it("Alles leer ⇒ Zeilen bleiben vorhanden, Anteil null", () => {
    const { rows, sum } = takeawayChannelRows(
      { markerSumCents: 0, souseSumCents: 0, woltInfoCents: 0 },
      null,
    );
    expect(rows).toHaveLength(TAKEAWAY_CHANNEL_ORDER.length);
    expect(rows.every((r) => r.amountCents === 0 && r.sharePct === null)).toBe(true);
    expect(sum.sharePct).toBeNull();
  });

  it("Wolt > Marker: Warnung bleibt erhalten, Direkt nie negativ", () => {
    const { rows, warning } = takeawayChannelRows(
      { markerSumCents: 10_000, souseSumCents: 0, woltInfoCents: 25_000 },
      null,
    );
    expect(warning).toMatch(/übersteigt den Takeaway-Marker/);
    expect(rows[0]!.amountCents).toBe(10_000);
    expect(rows[1]!.amountCents).toBe(0);
  });
});

describe("takeawayMatrix", () => {
  it("Kanal fehlt in einem Standort ⇒ 0 statt Lücke", () => {
    const m = takeawayMatrix(
      [
        { locationName: "Spicery", current: cur },
        {
          locationName: "Ja",
          current: { markerSumCents: 5_000, souseSumCents: 0, woltInfoCents: 0 },
        },
      ],
      { current: cur, previous: prev },
    );
    expect(m.locationNames).toEqual(["Spicery", "Ja"]);
    const soUse = m.rows.find((r) => r.name === "SoUse")!;
    expect(soUse.perLocationCents).toEqual([10_000, 0]);
    const wolt = m.rows.find((r) => r.name === "Wolt")!;
    expect(wolt.perLocationCents).toEqual([17_210, 0]);
    expect(m.sum.perLocationCents).toEqual([46_510, 5_000]);
    expect(m.sum.totalCents).toBe(46_510);
  });

  it("Einzelstandort-Scope: nur die Gesamt-Spalte", () => {
    const m = takeawayMatrix([], { current: cur, previous: null });
    expect(m.locationNames).toEqual([]);
    expect(m.rows.every((r) => r.perLocationCents.length === 0)).toBe(true);
    expect(m.sum.deltaPct).toBeNull();
  });
});

describe("takeawaySharePctOfTotal", () => {
  it("Anteil am Gesamtumsatz, Nenner 0 ⇒ null", () => {
    expect(fmtPctDe(takeawaySharePctOfTotal(36_510, 867_250))).toBe("4,2 %");
    expect(takeawaySharePctOfTotal(0, 0)).toBeNull();
  });
});
