// LG2 — Unit-Tests für aggregateHoursByStaffAndDept.
// Deckt: (a) Multi-Dept-Person mit Tages-GL-Skill → GL-Zeile, (b) Person mit
// nur einer Dept-Zuordnung → alles auf einer Zeile, (c) NULL-rawDept + Roster-
// Area → geplanter Bereich.

import { describe, expect, it } from "vitest";
import { aggregateHoursByStaffAndDept, type Department } from "@/lib/time/zeit-uebersicht-core";
import { computeShiftHours } from "@/lib/time/shift-hours";

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

  it("Mehrstandort: staffDepts=service+gl, ein Tag GL-Skill, ein Tag Roster-Area service — beide Zeilen befüllt, kein Fallback", () => {
    const out = aggregateHoursByStaffAndDept({
      entries: [
        { staffId: "s4", businessDate: "2026-07-01", hoursWorked: 7, rawDepartment: null },
        { staffId: "s4", businessDate: "2026-07-02", hoursWorked: 5, rawDepartment: null },
      ],
      staffDeptsByStaff: new Map<string, Department[]>([["s4", ["service", "gl"]]]),
      rosterAreaByStaffDate: { s4: { "2026-07-02": "service" } },
      rosterGlByStaffDate: { s4: { "2026-07-01": true } },
    });
    expect(out.get("s4")?.get("gl")).toBe(7);
    expect(out.get("s4")?.get("service")).toBe(5);
    expect(out.get("s4")?.get("kitchen") ?? 0).toBe(0);
  });

  it("Summenprobe: Σ Teilwerte === Σ computeShiftHours(entry).totalHours (exakt, kein toBeCloseTo)", () => {
    const shifts = [
      {
        businessDate: "2026-07-01",
        startedAt: "2026-07-01T09:00:00+02:00",
        endedAt: "2026-07-01T15:30:00+02:00",
      },
      {
        businessDate: "2026-07-02",
        startedAt: "2026-07-02T17:00:00+02:00",
        endedAt: "2026-07-02T23:15:00+02:00",
      },
      {
        businessDate: "2026-07-03",
        startedAt: "2026-07-03T11:00:00+02:00",
        endedAt: "2026-07-03T14:45:00+02:00",
      },
    ];
    const entries = shifts.map((s) => ({
      staffId: "s5",
      businessDate: s.businessDate,
      hoursWorked: computeShiftHours(s.startedAt, s.endedAt, s.businessDate, 0, true).totalHours,
      rawDepartment: null as Department | null,
    }));
    const totalExpected = entries.reduce((a, e) => a + e.hoursWorked, 0);
    const out = aggregateHoursByStaffAndDept({
      entries,
      staffDeptsByStaff: new Map<string, Department[]>([["s5", ["service", "gl"]]]),
      rosterAreaByStaffDate: {
        s5: { "2026-07-01": "service", "2026-07-03": "service" },
      },
      rosterGlByStaffDate: { s5: { "2026-07-02": true } },
    });
    const byDept = out.get("s5")!;
    const sum =
      (byDept.get("kitchen") ?? 0) + (byDept.get("service") ?? 0) + (byDept.get("gl") ?? 0);
    expect(sum).toBe(totalExpected);
  });
});
