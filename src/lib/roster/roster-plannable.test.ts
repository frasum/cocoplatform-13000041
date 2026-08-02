import { describe, it, expect } from "vitest";
import { filterPlannable, isPlannable } from "./roster-plannable";

describe("RS1 — roster_plannable-Filter", () => {
  it("schließt roster_plannable=false aus", () => {
    expect(isPlannable({ isActive: true, rosterPlannable: false })).toBe(false);
  });

  it("lässt roster_plannable=true zu", () => {
    expect(isPlannable({ isActive: true, rosterPlannable: true })).toBe(true);
  });

  it("behandelt fehlendes Merkmal (Bestand) als planbar", () => {
    expect(isPlannable({ isActive: true })).toBe(true);
    expect(isPlannable({ isActive: true, rosterPlannable: null })).toBe(true);
  });

  it("schließt inaktive Personen wie bisher aus", () => {
    expect(isPlannable({ isActive: false, rosterPlannable: true })).toBe(false);
  });

  it("filtert eine Liste und behält die übrigen Felder", () => {
    const rows = [
      { id: "a", isActive: true, rosterPlannable: true },
      { id: "b", isActive: true, rosterPlannable: false },
      { id: "c", isActive: true },
      { id: "d", isActive: false, rosterPlannable: true },
    ];
    // Planungsliste: nur a und c.
    expect(filterPlannable(rows).map((r) => r.id)).toEqual(["a", "c"]);
    // Allgemeine Personalliste (ungefilterter Pfad) enthält alle weiterhin.
    expect(rows).toHaveLength(4);
  });
});
