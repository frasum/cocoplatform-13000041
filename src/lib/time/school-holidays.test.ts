import { describe, expect, it } from "vitest";
import { schoolHolidayOn, schoolHolidays } from "./school-holidays";

describe("schoolHolidays (Bayern, BayMBl. 2022 Nr. 747)", () => {
  it("liefert die Zeiträume, die ein Kalenderjahr berühren", () => {
    const names = schoolHolidays(2026).map((p) => `${p.name} ${p.from}`);
    expect(names).toContain("Weihnachtsferien 2025-12-22"); // Ende im Januar 2026
    expect(names).toContain("Sommerferien 2026-08-03");
    expect(names).toContain("Weihnachtsferien 2026-12-24");
  });

  it("nicht erfasstes Jahr ergibt leere Liste", () => {
    expect(schoolHolidays(2031)).toEqual([]);
  });

  it("Sortierung nach Beginn", () => {
    const froms = schoolHolidays(2027).map((p) => p.from);
    expect([...froms]).toEqual([...froms].sort());
  });
});

describe("erster Sommerferientag je erfasstem Schuljahr", () => {
  const firstSummerDay: ReadonlyArray<[string, string]> = [
    ["2024-07-29", "2024-07-28"],
    ["2025-08-01", "2025-07-31"],
    ["2026-08-03", "2026-08-02"],
    ["2027-08-02", "2027-08-01"],
    ["2028-07-31", "2028-07-30"],
    ["2029-07-30", "2029-07-29"],
    ["2030-07-29", "2030-07-28"],
  ];
  for (const [start, dayBefore] of firstSummerDay) {
    it(`${start} ist Ferientag, ${dayBefore} nicht`, () => {
      expect(schoolHolidayOn(start)?.name).toBe("Sommerferien");
      expect(schoolHolidayOn(dayBefore)).toBeNull();
    });
  }
});

describe("letzter Weihnachtsferientag je erfasstem Schuljahr", () => {
  const lastChristmasDay: ReadonlyArray<[string, string]> = [
    ["2025-01-03", "2025-01-04"],
    ["2026-01-05", "2026-01-06"],
    ["2027-01-08", "2027-01-09"],
    ["2028-01-07", "2028-01-08"],
    ["2029-01-05", "2029-01-06"],
    ["2030-01-04", "2030-01-05"],
  ];
  for (const [last, dayAfter] of lastChristmasDay) {
    it(`${last} ist Ferientag, ${dayAfter} nicht`, () => {
      expect(schoolHolidayOn(last)?.name).toBe("Weihnachtsferien");
      expect(schoolHolidayOn(dayAfter)).toBeNull();
    });
  }
});

describe("schoolHolidayOn", () => {
  it("mitten in den Sommerferien 2026", () => {
    expect(schoolHolidayOn("2026-08-20")).toEqual({
      name: "Sommerferien",
      from: "2026-08-03",
      to: "2026-09-14",
    });
  });

  it("letzter Sommerferientag inklusive, Tag danach null", () => {
    expect(schoolHolidayOn("2026-09-14")?.name).toBe("Sommerferien");
    expect(schoolHolidayOn("2026-09-15")).toBeNull();
  });

  it("nicht erfasstes Jahr ⇒ null", () => {
    expect(schoolHolidayOn("2031-08-10")).toBeNull();
  });

  it("Buß- und Bettag 2026 (18.11.) ist unterrichtsfrei", () => {
    expect(schoolHolidayOn("2026-11-18")?.name).toBe("Buß- und Bettag (unterrichtsfrei)");
    expect(schoolHolidayOn("2026-11-17")).toBeNull();
    expect(schoolHolidayOn("2026-11-19")).toBeNull();
  });

  it("Herbstferien 2026 als eigener Zeitraum", () => {
    expect(schoolHolidayOn("2026-11-02")?.name).toBe("Herbstferien");
    expect(schoolHolidayOn("2026-11-06")?.name).toBe("Herbstferien");
  });

  it("ungültiges Datum ⇒ null", () => {
    expect(schoolHolidayOn("kaputt")).toBeNull();
  });

  it("unbekannte Region ⇒ null bzw. leer", () => {
    // @ts-expect-error Region-Erweiterungspunkt: heute nur "BY".
    expect(schoolHolidayOn("2026-08-20", "NRW")).toBeNull();
    // @ts-expect-error Region-Erweiterungspunkt: heute nur "BY".
    expect(schoolHolidays(2026, "NRW")).toEqual([]);
  });
});
