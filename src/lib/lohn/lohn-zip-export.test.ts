// EX1 — Bündelung des Sammelexports: Dateianzahl, Auslassen leerer Personen,
// Kollisionsschutz bei gleich normalisierten Namen.

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildLohnFileName } from "./lohn-excel-export";
import {
  buildLohnZip,
  buildLohnZipFileName,
  hasEntgeltzeilen,
  uniqueFileName,
  type LohnZipPerson,
} from "./lohn-zip-export";

function person(label: string, ok = true): LohnZipPerson {
  return {
    staffLabel: label,
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    hasEntgeltzeilen: ok,
    blob: new Blob([`xlsx:${label}`]),
  };
}

async function names(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).sort();
}

describe("buildLohnZip", () => {
  it("bündelt drei Personen mit den buildLohnFileName-Namen", async () => {
    const zip = await buildLohnZip([person("LAM"), person("GERARD"), person("DERAU")]);
    expect(await names(zip)).toEqual(
      ["LAM", "GERARD", "DERAU"].map((l) => buildLohnFileName(l, "2026-07-01", "2026-07-31")).sort(),
    );
  });

  it("lässt Personen ohne Entgeltzeilen aus", async () => {
    const zip = await buildLohnZip([person("LAM"), person("PETER", false)]);
    expect(await names(zip)).toEqual([buildLohnFileName("LAM", "2026-07-01", "2026-07-31")]);
  });

  it("unterscheidet kollidierende Dateinamen deterministisch", async () => {
    const zip = await buildLohnZip([person("A B"), person("A/B")]);
    const list = await names(zip);
    expect(list).toHaveLength(2);
    expect(new Set(list).size).toBe(2);
    expect(list).toContain("lohn_A_B_2026-07-01_2026-07-31.xlsx");
    expect(list).toContain("lohn_A_B_2026-07-01_2026-07-31_2.xlsx");
  });
});

describe("hasEntgeltzeilen", () => {
  it("erkennt Stunden und U/K-Tage, verwirft Nullpersonen", () => {
    expect(hasEntgeltzeilen({ totalHours: 3 })).toBe(true);
    expect(hasEntgeltzeilen({ totalHours: 0, urlaubTage: 2 })).toBe(true);
    expect(hasEntgeltzeilen({ totalHours: 0, krankTage: 1 })).toBe(true);
    expect(hasEntgeltzeilen({ totalHours: 0, urlaubTage: 0, krankTage: null })).toBe(false);
    expect(hasEntgeltzeilen({})).toBe(false);
  });
});

describe("uniqueFileName / buildLohnZipFileName", () => {
  it("zählt Suffixe hoch", () => {
    const taken = new Set<string>();
    expect(uniqueFileName("a.xlsx", taken)).toBe("a.xlsx");
    expect(uniqueFileName("a.xlsx", taken)).toBe("a_2.xlsx");
    expect(uniqueFileName("a.xlsx", taken)).toBe("a_3.xlsx");
  });

  it("benennt das ZIP nach dem Zeitraum", () => {
    expect(buildLohnZipFileName("2026-07-01", "2026-07-31")).toBe(
      "lohn_alle_2026-07-01_2026-07-31.zip",
    );
  });
});
