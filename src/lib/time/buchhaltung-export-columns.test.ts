// PY2-T (§105-Merkposten) — Mini-Test für Spalten-Set je §3b-Modus.
import { describe, it, expect } from "vitest";
import { columns } from "./buchhaltung-export";

describe("buchhaltung-export columns(mode)", () => {
  it("simple → 'SO/FEI', keine §3b-Spalten", () => {
    const keys = columns("simple").map((c) => c.key);
    expect(keys).toContain("sunHol");
    expect(keys).not.toContain("sonntag");
    expect(keys).not.toContain("feiertag");
    expect(keys).not.toContain("feiertag150");
  });

  it("section3b → 'sonntag/feiertag/feiertag150', kein 'SO/FEI'", () => {
    const keys = columns("section3b").map((c) => c.key);
    expect(keys).toContain("sonntag");
    expect(keys).toContain("feiertag");
    expect(keys).toContain("feiertag150");
    expect(keys).not.toContain("sunHol");
  });

  it("beide Modi enthalten Basis- und Schlusspalten in dieser Reihenfolge", () => {
    for (const mode of ["simple", "section3b"] as const) {
      const keys = columns(mode).map((c) => c.key);
      expect(keys[0]).toBe("name");
      expect(keys.slice(1, 3)).toEqual(["fullName", "persoNr"]);
      expect(keys.slice(3, 10)).toEqual([
        "totalHours",
        "stundenGl",
        "stundenKueche",
        "stundenService",
        "shifts",
        "evening",
        "night",
      ]);
      expect(keys.slice(-4)).toEqual(["urlaubDays", "krankDays", "vorschussEUR", "besonderheiten"]);
    }
  });

  // PY2-T (§105): `absenceNote` wird nur in `cellValue` in das
  // Besonderheiten-Feld eingemischt und ist NIE eine eigene Spalte.
  it("absenceNote ist niemals eine Spalte (nur Merge in 'besonderheiten')", () => {
    for (const mode of ["simple", "section3b"] as const) {
      expect(columns(mode).map((c) => c.key)).not.toContain("absenceNote");
    }
  });
});
