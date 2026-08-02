import { describe, expect, it } from "vitest";
import { schoolHolidayNotices } from "./school-holiday-notices";

describe("schoolHolidayNotices", () => {
  it("Vortag: Ferien beginnen morgen", () => {
    expect(schoolHolidayNotices("2026-08-02")).toEqual([
      { kind: "holiday_tomorrow", name: "Sommerferien" },
    ]);
  });

  it("Tag 1: nur running, kein Doppel-Hinweis", () => {
    expect(schoolHolidayNotices("2026-08-03")).toEqual([
      { kind: "holiday_running", name: "Sommerferien", dayIndex: 1, dayCount: 43 },
    ]);
  });

  it("Mitte: Tag 18/43", () => {
    expect(schoolHolidayNotices("2026-08-20")).toEqual([
      { kind: "holiday_running", name: "Sommerferien", dayIndex: 18, dayCount: 43 },
    ]);
  });

  it("letzter Tag: 43/43", () => {
    expect(schoolHolidayNotices("2026-09-14")).toEqual([
      { kind: "holiday_running", name: "Sommerferien", dayIndex: 43, dayCount: 43 },
    ]);
  });

  it("Tag danach: nichts", () => {
    expect(schoolHolidayNotices("2026-09-15")).toEqual([]);
  });

  it("Einzeltag Buß- und Bettag: Tag 1/1", () => {
    expect(schoolHolidayNotices("2026-11-18")).toEqual([
      {
        kind: "holiday_running",
        name: "Buß- und Bettag (unterrichtsfrei)",
        dayIndex: 1,
        dayCount: 1,
      },
    ]);
  });

  it("Jahr ohne Daten: nichts", () => {
    expect(schoolHolidayNotices("2031-08-10")).toEqual([]);
  });

  it("über den Jahreswechsel: Weihnachtsferien laufen weiter", () => {
    expect(schoolHolidayNotices("2027-01-01")).toEqual([
      { kind: "holiday_running", name: "Weihnachtsferien", dayIndex: 9, dayCount: 16 },
    ]);
  });
});
