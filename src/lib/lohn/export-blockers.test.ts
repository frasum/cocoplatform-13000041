import { describe, it, expect } from "vitest";
import {
  assertExportUnblocked,
  computeExportBlockers,
  LohnExportBlockedError,
  type StaffExportPayload,
} from "./export-blockers";

function payload(over: Partial<StaffExportPayload>): StaffExportPayload {
  return {
    staffId: "s1",
    staffLabel: "TEST",
    persoNr: "000123",
    buckets: [],
    unresolvedHoursUnrounded: 0,
    ...over,
  };
}

describe("LG3b · export-blockers", () => {
  it("keine Stunden, kein Blocker (Viktoria-Regel: Payroll-Zugang ohne Stunden)", () => {
    const b = computeExportBlockers([payload({ persoNr: null, buckets: [] })]);
    expect(b).toEqual([]);
  });

  it("alles gepflegt → keine Blocker", () => {
    const b = computeExportBlockers([
      payload({
        buckets: [{ department: "service", paidHoursUnrounded: 40, rateCents: 1400 }],
      }),
    ]);
    expect(b).toEqual([]);
  });

  it("fehlender Satz mit Stunden > 0 → missing_rate je Bucket", () => {
    const b = computeExportBlockers([
      payload({
        buckets: [
          { department: "service", paidHoursUnrounded: 40, rateCents: 1400 },
          { department: "kitchen", paidHoursUnrounded: 3.5, rateCents: null },
        ],
      }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].reasons).toEqual([
      { reason: "missing_rate", department: "kitchen", hoursUnrounded: 3.5 },
    ]);
  });

  it("winzige, aber echte Stunden (0.2 h) triggern missing_rate", () => {
    const b = computeExportBlockers([
      payload({
        buckets: [{ department: "gl", paidHoursUnrounded: 0.2, rateCents: null }],
      }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].reasons[0].reason).toBe("missing_rate");
  });

  it("Fließkomma-Rauschen unter Epsilon triggert NICHT", () => {
    const b = computeExportBlockers([
      payload({
        buckets: [{ department: "gl", paidHoursUnrounded: 1e-12, rateCents: null }],
      }),
    ]);
    expect(b).toEqual([]);
  });

  it("leere Personalnummer + Stunden → missing_perso_nr", () => {
    const b = computeExportBlockers([
      payload({
        persoNr: "",
        buckets: [{ department: "service", paidHoursUnrounded: 40, rateCents: 1400 }],
      }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].reasons.map((r) => r.reason)).toContain("missing_perso_nr");
  });

  it("unresolved_department bei Stunden im Unresolved-Topf", () => {
    const b = computeExportBlockers([
      payload({
        buckets: [{ department: "service", paidHoursUnrounded: 20, rateCents: 1400 }],
        unresolvedHoursUnrounded: 2.5,
      }),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0].reasons).toContainEqual({
      reason: "unresolved_department",
      hoursUnrounded: 2.5,
    });
  });

  it("mehrere Gründe je Person werden alle geliefert", () => {
    const b = computeExportBlockers([
      payload({
        persoNr: null,
        buckets: [{ department: "service", paidHoursUnrounded: 10, rateCents: null }],
        unresolvedHoursUnrounded: 1,
      }),
    ]);
    expect(b).toHaveLength(1);
    const kinds = b[0].reasons.map((r) => r.reason).sort();
    expect(kinds).toEqual(["missing_perso_nr", "missing_rate", "unresolved_department"]);
  });

  it("assertExportUnblocked wirft LohnExportBlockedError mit vollständiger Liste", () => {
    const payloads: StaffExportPayload[] = [
      payload({
        staffId: "s1",
        persoNr: null,
        buckets: [{ department: "service", paidHoursUnrounded: 10, rateCents: 1400 }],
      }),
      payload({
        staffId: "s2",
        buckets: [{ department: "kitchen", paidHoursUnrounded: 5, rateCents: null }],
      }),
    ];
    let caught: unknown = null;
    try {
      assertExportUnblocked(payloads);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LohnExportBlockedError);
    const err = caught as LohnExportBlockedError;
    expect(err.blockers).toHaveLength(2);
    expect(err.blockers.map((b) => b.staffId).sort()).toEqual(["s1", "s2"]);
  });

  it("assertExportUnblocked ist ein No-Op ohne Blocker", () => {
    expect(() =>
      assertExportUnblocked([
        payload({
          buckets: [{ department: "service", paidHoursUnrounded: 40, rateCents: 1400 }],
        }),
      ]),
    ).not.toThrow();
  });
});
