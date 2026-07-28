import { describe, expect, it } from "vitest";
import { isSundayOrHoliday, resolvePoolDefaults } from "./pool-defaults";

describe("isSundayOrHoliday", () => {
  it("Sonntag → true", () => {
    // 2026-07-26 = Sonntag
    expect(isSundayOrHoliday("2026-07-26")).toBe(true);
  });
  it("Montag → false", () => {
    expect(isSundayOrHoliday("2026-07-27")).toBe(false);
  });
  it("Bayerischer Feiertag (Mariä Himmelfahrt 15.08.) → true", () => {
    expect(isSundayOrHoliday("2026-08-15")).toBe(true);
  });
  it("ungültiges Format → false", () => {
    expect(isSundayOrHoliday("2026/07/26")).toBe(false);
    expect(isSundayOrHoliday("")).toBe(false);
  });
});

describe("resolvePoolDefaults", () => {
  const row = {
    default_checkin: "17:00",
    default_checkout: "01:00",
    default_checkin_sunday_holiday: "15:00",
    default_checkout_sunday_holiday: "02:00",
  };

  it("Werktag → reguläre Werte", () => {
    expect(resolvePoolDefaults(row, "2026-07-27")).toEqual({
      checkin: "17:00",
      checkout: "01:00",
    });
  });
  it("Sonntag → So/Feiertag-Werte", () => {
    expect(resolvePoolDefaults(row, "2026-07-26")).toEqual({
      checkin: "15:00",
      checkout: "02:00",
    });
  });
  it("Feiertag → So/Feiertag-Werte", () => {
    expect(resolvePoolDefaults(row, "2026-08-15")).toEqual({
      checkin: "15:00",
      checkout: "02:00",
    });
  });
  it("Sonntag ohne gepflegte So/Feiertag-Werte → null/null (kein Fallback auf Werktag)", () => {
    expect(
      resolvePoolDefaults(
        {
          default_checkin: "17:00",
          default_checkout: "01:00",
          default_checkin_sunday_holiday: null,
          default_checkout_sunday_holiday: null,
        },
        "2026-07-26",
      ),
    ).toEqual({ checkin: null, checkout: null });
  });
  it("null-Row → null/null", () => {
    expect(resolvePoolDefaults(null, "2026-07-27")).toEqual({
      checkin: null,
      checkout: null,
    });
  });
});
