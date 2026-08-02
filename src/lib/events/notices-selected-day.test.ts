// EV1-R4 — Durchreichung des GEWÄHLTEN Geschäftstags an die Notices-Logik.
// Die Kernlogik selbst ist unverändert; getestet wird die Tagesabhängigkeit.
import { describe, expect, it } from "vitest";
import { schoolHolidayNotices } from "./school-holiday-notices";
import { firstColumnLabel } from "@/components/cash/WeatherWidget";

describe("schoolHolidayNotices am gewählten Tag", () => {
  it("2026-08-01 (Vortag des Vortags) → kein Hinweis", () => {
    expect(schoolHolidayNotices("2026-08-01")).toEqual([]);
  });

  it("2026-08-02 → Sommerferien beginnen morgen", () => {
    expect(schoolHolidayNotices("2026-08-02")).toEqual([
      { kind: "holiday_tomorrow", name: "Sommerferien" },
    ]);
  });

  it("2026-08-03 → laufend, Tag 1/43", () => {
    expect(schoolHolidayNotices("2026-08-03")).toEqual([
      { kind: "holiday_running", name: "Sommerferien", dayIndex: 1, dayCount: 43 },
    ]);
  });
});

describe("firstColumnLabel", () => {
  it("gewählt = heute → Heute", () => {
    expect(firstColumnLabel("2026-08-02", "2026-08-02")).toBe("Heute");
  });

  it("gewählt = Vortag (Samstag) → Sa", () => {
    expect(firstColumnLabel("2026-08-01", "2026-08-02")).toBe("Sa");
  });
});
