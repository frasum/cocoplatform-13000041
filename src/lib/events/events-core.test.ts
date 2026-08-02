import { describe, expect, it } from "vitest";
import { detectTermChanges, importKey, mapImpact } from "./events-core";

describe("mapImpact", () => {
  it("mappt tolerant", () => {
    expect(mapImpact("SEHR HOCH")).toBe("sehr_hoch");
    expect(mapImpact("sehr-hoch")).toBe("sehr_hoch");
    expect(mapImpact("Hoch")).toBe("hoch");
    expect(mapImpact(" Mittel-Hoch ")).toBe("mittel_hoch");
    expect(mapImpact("mittel_hoch")).toBe("mittel_hoch");
    expect(mapImpact("Mittel")).toBe("mittel");
  });

  it("gibt null bei unbekannten Werten", () => {
    expect(mapImpact("niedrig")).toBeNull();
    expect(mapImpact("")).toBeNull();
    expect(mapImpact(null)).toBeNull();
  });
});

describe("importKey", () => {
  it("trennt gleichnamige Events verschiedener Termine", () => {
    expect(importKey("OKTOBERFEST 2026", "2026-09-19")).not.toBe(
      importKey("OKTOBERFEST 2027", "2027-09-18"),
    );
  });

  it("ignoriert umgebende Leerzeichen im Namen", () => {
    expect(importKey(" Messe A ", "2026-05-01")).toBe(importKey("Messe A", "2026-05-01"));
  });
});

describe("detectTermChanges", () => {
  const existing = [
    { id: "e1", name: "Messe A", dateFrom: "2026-05-01" },
    { id: "e2", name: "OKTOBERFEST 2026", dateFrom: "2026-09-19" },
  ];

  it("erkennt ein verschobenes Von-Datum im selben Kalenderjahr", () => {
    const hints = detectTermChanges([{ name: "Messe A", dateFrom: "2026-05-02" }], existing);
    expect(hints).toEqual([
      { name: "Messe A", dateFrom: "2026-05-02", existingId: "e1", existingDateFrom: "2026-05-01" },
    ]);
  });

  it("meldet unveränderte Bestandszeilen nicht", () => {
    expect(detectTermChanges([{ name: "Messe A", dateFrom: "2026-05-01" }], existing)).toEqual([]);
  });

  it("meldet ein Folgejahr nicht als Terminwechsel", () => {
    expect(detectTermChanges([{ name: "Messe A", dateFrom: "2027-05-04" }], existing)).toEqual([]);
  });

  it("meldet neue Events ohne Namensgleichheit nicht", () => {
    expect(detectTermChanges([{ name: "Konzert B", dateFrom: "2026-06-11" }], existing)).toEqual(
      [],
    );
  });
});
