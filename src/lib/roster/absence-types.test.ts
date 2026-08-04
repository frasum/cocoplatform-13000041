import { describe, expect, it } from "vitest";
import {
  ABSENCE_LABEL,
  ABSENCE_TYPE_FILTER,
  absenceBlockingType,
  isAbsenceType,
  isPaidVacation,
  normalizeAbsenceType,
} from "./absence-types";

describe("UB1 — Abwesenheitstypen", () => {
  it("führt genau die drei Kalendertypen im Filter", () => {
    expect(ABSENCE_TYPE_FILTER).toEqual(["urlaub", "krank", "urlaub_unbezahlt"]);
  });

  it("erkennt gültige Typen", () => {
    expect(isAbsenceType("urlaub_unbezahlt")).toBe(true);
    expect(isAbsenceType("sonstiges")).toBe(false);
    expect(isAbsenceType(null)).toBe(false);
  });

  it("normalisiert Unbekanntes auf urlaub (Altverhalten)", () => {
    expect(normalizeAbsenceType(null)).toBe("urlaub");
    expect(normalizeAbsenceType("krank")).toBe("krank");
    expect(normalizeAbsenceType("urlaub_unbezahlt")).toBe("urlaub_unbezahlt");
  });

  it("blockt unbezahlten Urlaub wie Urlaub", () => {
    expect(absenceBlockingType("urlaub_unbezahlt")).toBe("urlaub");
    expect(absenceBlockingType("urlaub")).toBe("urlaub");
    expect(absenceBlockingType("krank")).toBe("krank");
  });

  it("zählt nur bezahlten Urlaub als fortzahlungsrelevant", () => {
    expect(isPaidVacation("urlaub")).toBe(true);
    expect(isPaidVacation("urlaub_unbezahlt")).toBe(false);
    expect(isPaidVacation("krank")).toBe(false);
  });

  it("hat für jeden Typ ein Label", () => {
    expect(ABSENCE_LABEL.urlaub_unbezahlt).toBe("Urlaub (unbezahlt)");
    expect(Object.keys(ABSENCE_LABEL)).toHaveLength(3);
  });
});
