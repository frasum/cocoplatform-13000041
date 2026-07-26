import { describe, expect, it } from "vitest";
import { entryRowDepartment, primaryDepartment } from "./primary-department";

describe("primaryDepartment", () => {
  it("WZ1/KGL: prefers gl over kitchen and service", () => {
    expect(primaryDepartment(["kitchen", "service", "gl"])).toBe("gl");
    expect(primaryDepartment(["gl", "kitchen"])).toBe("gl");
  });
  it("WZ1/KGL: LAM-Fall (service+gl) → gl", () => {
    expect(primaryDepartment(["service", "gl"])).toBe("gl");
    expect(primaryDepartment(["gl", "service"])).toBe("gl");
  });
  it("prefers kitchen over service when no gl", () => {
    expect(primaryDepartment(["kitchen", "service"])).toBe("kitchen");
    expect(primaryDepartment(["service", "kitchen"])).toBe("kitchen");
  });
  it("returns gl when only gl is assigned", () => {
    expect(primaryDepartment(["gl"])).toBe("gl");
  });
  it("returns kitchen or service on their own", () => {
    expect(primaryDepartment(["kitchen"])).toBe("kitchen");
    expect(primaryDepartment(["service"])).toBe("service");
  });
  it("falls back to service on empty input", () => {
    expect(primaryDepartment([])).toBe("service");
  });
  it("is order-independent (gl priority)", () => {
    expect(primaryDepartment(["service", "gl", "kitchen"])).toBe("gl");
    expect(primaryDepartment(["kitchen", "gl"])).toBe("gl");
  });
});

describe("entryRowDepartment", () => {
  it("routes NULL entries to the primary row without warning", () => {
    expect(entryRowDepartment(null, ["kitchen", "gl"])).toEqual({
      department: "gl",
      mismatched: false,
    });
  });
  it("keeps entry on its own department when assigned", () => {
    expect(entryRowDepartment("gl", ["kitchen", "gl"])).toEqual({
      department: "gl",
      mismatched: false,
    });
  });
  it("falls back to primary row + warning if entry dept not assigned", () => {
    expect(entryRowDepartment("gl", ["kitchen"])).toEqual({
      department: "kitchen",
      mismatched: true,
    });
  });
  it("handles empty staff dept list", () => {
    expect(entryRowDepartment(null, [])).toEqual({
      department: "service",
      mismatched: false,
    });
    expect(entryRowDepartment("gl", [])).toEqual({
      department: "service",
      mismatched: true,
    });
  });
  it("Z3b: NULL entry uses rosterArea over static PRIORITY (gl > kitchen > service)", () => {
    // Non-GL-Fall: kitchen + service zugeordnet, Dienstplan = service.
    // (Der GL-Fall wird durch die W2-Ausnahme abgedeckt — siehe unten.)
    expect(entryRowDepartment(null, ["kitchen", "service"], { rosterArea: "service" })).toEqual({
      department: "service",
      mismatched: false,
    });
  });
  it("Z3b: rosterArea ignored when not in staffDepts", () => {
    expect(entryRowDepartment(null, ["service"], { rosterArea: "kitchen" })).toEqual({
      department: "service",
      mismatched: false,
    });
  });
  it("Z3b: entryDept still wins over rosterArea when both set", () => {
    expect(
      entryRowDepartment("kitchen", ["kitchen", "service"], { rosterArea: "service" }),
    ).toEqual({ department: "kitchen", mismatched: false });
  });
  it("Z3b: rosterArea does not fire without staffDepts membership", () => {
    expect(entryRowDepartment(null, ["kitchen", "gl"], { rosterArea: "service" })).toEqual({
      department: "gl",
      mismatched: false,
    });
  });
  // WZ2 — Korrektur der W2-Regel: der DIENSTPLAN-SKILL des Tages bestimmt
  // die GL-Attribution; die W2-Pauschal-Übersteuerung für GL-Personen fällt
  // hier weg. Frank 16.07.: „Die Schicht hat den Typ, nicht die Person."
  it("WZ2 (a): GL-Person + Tages-Roster mit Service-Skill → SERVICE-Zeile", () => {
    expect(
      entryRowDepartment(null, ["service", "gl"], {
        rosterArea: "service",
        rosterHasGlSkill: false,
      }),
    ).toEqual({ department: "service", mismatched: false });
  });
  it("WZ2 (b): GL-Person + Tages-Roster mit GL-Skill (area=null) → GL-Zeile", () => {
    expect(
      entryRowDepartment(null, ["service", "gl"], {
        rosterArea: null,
        rosterHasGlSkill: true,
      }),
    ).toEqual({ department: "gl", mismatched: false });
  });
  it("WZ2 (c): GL-Person ohne Tages-Roster → GL-Zeile (W2-Fallback, GERARD/Andre)", () => {
    expect(entryRowDepartment(null, ["service", "gl"])).toEqual({
      department: "gl",
      mismatched: false,
    });
  });
  it("WZ2 (d): Nicht-GL-Person + Tages-Roster kitchen → kitchen (Z3b unverändert)", () => {
    expect(
      entryRowDepartment(null, ["kitchen", "service"], {
        rosterArea: "kitchen",
        rosterHasGlSkill: false,
      }),
    ).toEqual({ department: "kitchen", mismatched: false });
  });
  it("WZ2 (e): expliziter Eintrags-service schlägt GL-Skill-Roster (Vorrangordnung)", () => {
    expect(
      entryRowDepartment("service", ["service", "gl"], {
        rosterArea: null,
        rosterHasGlSkill: true,
      }),
    ).toEqual({ department: "service", mismatched: false });
  });
  it("WZ2: GL-Person mit explizitem service-Eintrag → Service-Zeile (rawDepartment gewinnt)", () => {
    expect(entryRowDepartment("service", ["service", "gl"], { rosterArea: "service" })).toEqual({
      department: "service",
      mismatched: false,
    });
  });
  it("W2: Nicht-GL-Person + rosterArea → Z3b unverändert", () => {
    expect(entryRowDepartment(null, ["kitchen", "service"], { rosterArea: "service" })).toEqual({
      department: "service",
      mismatched: false,
    });
  });
  it("W2: GL-Person ohne Roster → GL-Zeile (Bestand)", () => {
    expect(entryRowDepartment(null, ["service", "gl"])).toEqual({
      department: "gl",
      mismatched: false,
    });
  });
});
