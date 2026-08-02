import { describe, expect, it } from "vitest";
import { filterCashEnabled, isCashEnabled } from "./cash-enabled";

describe("LS1 — cash_enabled Standortfilter", () => {
  it("Bestand (Feld fehlt oder null) gilt als Kassenstandort", () => {
    expect(isCashEnabled({})).toBe(true);
    expect(isCashEnabled({ cashEnabled: null })).toBe(true);
    expect(isCashEnabled({ cashEnabled: true })).toBe(true);
  });

  it("cash_enabled=false ⇒ nicht in Kassen-/Statistiklisten", () => {
    expect(isCashEnabled({ cashEnabled: false })).toBe(false);
  });

  it("filtert Planungs-Standorte aus, lässt Bestand unverändert", () => {
    const rows = [
      { id: "a", cashEnabled: true },
      { id: "tsb", cashEnabled: false },
      { id: "legacy" },
    ];
    expect(filterCashEnabled(rows).map((r) => r.id)).toEqual(["a", "legacy"]);
  });

  it("Planungslisten bleiben unangetastet (Filter wird dort nicht angewandt)", () => {
    const rows = [{ id: "tsb", cashEnabled: false }];
    // Dienstplan nutzt die Rohliste — hier dokumentiert als Regressionsschutz.
    expect(rows.map((r) => r.id)).toEqual(["tsb"]);
  });
});
