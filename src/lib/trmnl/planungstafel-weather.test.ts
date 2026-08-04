import { describe, expect, it } from "vitest";
import { buildWeatherRow, type PtWeatherRow } from "./planungstafel-weather";

function row(partial: Partial<PtWeatherRow> & { business_date: string }): PtWeatherRow {
  return {
    temp_max_c: 20,
    temp_min_c: 10,
    precipitation_mm: null,
    weather_code: 0,
    ...partial,
  };
}

const days = ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"];

describe("buildWeatherRow", () => {
  it("liefert eine Zelle je Tag; der fehlende Tag trägt „—“ und null-Werte", () => {
    const cells = buildWeatherRow(days, [
      row({ business_date: "2026-08-05" }),
      row({ business_date: "2026-08-06" }),
      row({ business_date: "2026-08-08" }),
    ]);
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.date)).toEqual(days);
    expect(cells[2]).toEqual({
      date: "2026-08-07",
      tempMaxC: null,
      tempMinC: null,
      label: "—",
      rainMm: null,
    });
  });

  it("rundet Temperaturen ganzzahlig", () => {
    const [cell] = buildWeatherRow(["2026-08-05"], [
      row({ business_date: "2026-08-05", temp_max_c: 23.6, temp_min_c: 12.4 }),
    ]);
    expect(cell?.tempMaxC).toBe(24);
    expect(cell?.tempMinC).toBe(12);
  });

  it("0 mm Regen wird null, 0.4 mm bleibt 0.4", () => {
    const [zero] = buildWeatherRow(["2026-08-05"], [
      row({ business_date: "2026-08-05", precipitation_mm: 0 }),
    ]);
    expect(zero?.rainMm).toBeNull();
    const [some] = buildWeatherRow(["2026-08-05"], [
      row({ business_date: "2026-08-05", precipitation_mm: 0.4 }),
    ]);
    expect(some?.rainMm).toBe(0.4);
  });

  it("fehlender Wettercode wird nicht geraten (Label „—“)", () => {
    const [cell] = buildWeatherRow(["2026-08-05"], [
      row({ business_date: "2026-08-05", weather_code: null }),
    ]);
    expect(cell?.label).toBe("—");
    expect(cell?.tempMaxC).toBe(20);
  });

  it("nutzt das Kurzlabel aus weatherSymbol", () => {
    const [cell] = buildWeatherRow(["2026-08-05"], [
      row({ business_date: "2026-08-05", weather_code: 63 }),
    ]);
    expect(cell?.label).toBe("Regen");
  });

  it("die Reihenfolge folgt days, auch bei unsortierten DB-Zeilen", () => {
    const cells = buildWeatherRow(days, [
      row({ business_date: "2026-08-08", temp_max_c: 28 }),
      row({ business_date: "2026-08-06", temp_max_c: 26 }),
      row({ business_date: "2026-08-07", temp_max_c: 27 }),
      row({ business_date: "2026-08-05", temp_max_c: 25 }),
    ]);
    expect(cells.map((c) => c.tempMaxC)).toEqual([25, 26, 27, 28]);
  });
});
