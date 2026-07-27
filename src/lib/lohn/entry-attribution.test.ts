import { describe, it, expect } from "vitest";
import { attributeEntry } from "./entry-attribution";

describe("LG3b · attributeEntry", () => {
  it("bestätigter Bereich landet auf der Bereichs-Zeile (unresolved=false)", () => {
    const r = attributeEntry({
      rawDepartment: "kitchen",
      staffDepts: ["kitchen", "service"],
    });
    expect(r).toEqual({ department: "kitchen", unresolved: false });
  });

  it("Bereich, den die Person am Standort nicht hat, markiert unresolved=true", () => {
    const r = attributeEntry({
      rawDepartment: "gl",
      staffDepts: ["service"],
    });
    // fällt auf die Primär-Zeile (service), Flag bleibt gesetzt.
    expect(r.department).toBe("service");
    expect(r.unresolved).toBe(true);
  });

  it("NULL-Eintrag mit Roster-GL-Skill → GL (WZ2)", () => {
    const r = attributeEntry({
      rawDepartment: null,
      staffDepts: ["service"],
      rosterHasGlSkill: true,
    });
    expect(r).toEqual({ department: "gl", unresolved: false });
  });

  it("NULL-Eintrag mit rosterArea in staffDepts → Roster-Bereich", () => {
    const r = attributeEntry({
      rawDepartment: null,
      staffDepts: ["kitchen", "service"],
      rosterArea: "kitchen",
    });
    expect(r).toEqual({ department: "kitchen", unresolved: false });
  });

  it("NULL-Eintrag ohne Plan → GL-Person landet auf GL (W2-Fallback)", () => {
    const r = attributeEntry({
      rawDepartment: null,
      staffDepts: ["service", "gl"],
    });
    expect(r).toEqual({ department: "gl", unresolved: false });
  });

  it("NULL-Eintrag ohne Plan, ohne GL → statische Priorität (kitchen>service)", () => {
    const r = attributeEntry({
      rawDepartment: null,
      staffDepts: ["service", "kitchen"],
    });
    expect(r).toEqual({ department: "kitchen", unresolved: false });
  });

  it("staffDepts leer → service-Default, unresolved je nach rawDepartment", () => {
    const nulled = attributeEntry({ rawDepartment: null, staffDepts: [] });
    expect(nulled).toEqual({ department: "service", unresolved: false });
    const raw = attributeEntry({ rawDepartment: "kitchen", staffDepts: [] });
    expect(raw).toEqual({ department: "service", unresolved: true });
  });
});