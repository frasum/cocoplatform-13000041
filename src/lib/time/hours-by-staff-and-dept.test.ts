// LG2 — Unit-Tests für aggregateHoursByStaffAndDept.
// Deckt: (a) Multi-Dept-Person mit Tages-GL-Skill → GL-Zeile, (b) Person mit
// nur einer Dept-Zuordnung → alles auf einer Zeile, (c) NULL-rawDept + Roster-
// Area → geplanter Bereich.

import { describe, expect, it } from "vitest";
import { aggregateHoursByStaffAndDept, type Department } from "@/lib/time/zeit-uebersicht-core";

describe("aggregateHoursByStaffAndDept", () => {
  it("routet abteilungslose Schicht mit Tages-GL-Skill auf die GL-Zeile", () => {
    const out = aggregateHoursByStaffAndDept({
      entries: [
        {
          staffId: "s1",
          businessDate: "2026-07-01",
          hoursWorked: 8,
          rawDepartment: null,
        },
      ],
      staffDeptsByStaff: new Map<string, Department[]>([["s1", ["service", "gl"]]]),
      rosterAreaByStaffDate: { s1: { "2026-07-01": "service" } },
      rosterGlByStaffDate: { s1: { "2026-07-01": true } },
    });
    expect(out.get("s1")?.get("gl")).toBe(8);
    expect(out.get("s1")?.get("service") ?? 0).toBe(0);
  });

  it("summiert eine Ein-Dept-Person komplett auf ihrer Dept-Zeile", () => {
    const out = aggregateHoursByStaffAndDept({
      entries: [
        { staffId: "s2", businessDate: "2026-07-01", hoursWorked: 5, rawDepartment: "kitchen" },
        { staffId: "s2", businessDate: "2026-07-02", hoursWorked: 3, rawDepartment: "kitchen" },
      ],
      staffDeptsByStaff: new Map<string, Department[]>([["s2", ["kitchen"]]]),
      rosterAreaByStaffDate: {},
      rosterGlByStaffDate: {},
    });
    expect(out.get("s2")?.get("kitchen")).toBe(8);
    expect(out.get("s2")?.size).toBe(1);
  });

  it("splittet Multi-Dept-Person nach Tages-Roster-Area (kitchen + service)", () => {
    const out = aggregateHoursByStaffAndDept({
      entries: [
        { staffId: "s3", businessDate: "2026-07-01", hoursWorked: 6, rawDepartment: null },
        { staffId: "s3", businessDate: "2026-07-02", hoursWorked: 4, rawDepartment: null },
      ],
      staffDeptsByStaff: new Map<string, Department[]>([["s3", ["kitchen", "service"]]]),
      rosterAreaByStaffDate: {
        s3: { "2026-07-01": "kitchen", "2026-07-02": "service" },
      },
      rosterGlByStaffDate: {},
    });
    expect(out.get("s3")?.get("kitchen")).toBe(6);
    expect(out.get("s3")?.get("service")).toBe(4);
  });
});
