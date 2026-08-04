// UB1 — gemischter Monat: nur bezahlte Urlaubstage sind fortzahlungsrelevant.
import { describe, expect, it } from "vitest";
import { splitAbsenceCalDays, estimateWorkdays, workRate } from "./urlaub-krank-core";

/** August-Fixture: 10 Tage bezahlter Urlaub, 21 Tage unbezahlt, 2 Tage krank. */
const AUGUST = [
  ...Array.from({ length: 10 }, () => ({ type: "urlaub" })),
  ...Array.from({ length: 21 }, () => ({ type: "urlaub_unbezahlt" })),
  ...Array.from({ length: 2 }, () => ({ type: "krank" })),
];

describe("splitAbsenceCalDays", () => {
  it("trennt bezahlt / unbezahlt / krank", () => {
    expect(splitAbsenceCalDays(AUGUST)).toEqual({ urlaub: 10, krank: 2, urlaubUnbezahlt: 21 });
  });

  it("ignoriert unbekannte Typen", () => {
    expect(splitAbsenceCalDays([{ type: "sonstiges" }])).toEqual({
      urlaub: 0,
      krank: 0,
      urlaubUnbezahlt: 0,
    });
  });

  it("Vorschlag zählt nur bezahlte Tage, unbezahlte werden separat ausgewiesen", () => {
    const rate = workRate(78, 91);
    const s = splitAbsenceCalDays(AUGUST);
    expect(estimateWorkdays(s.urlaub, rate)).toBe(9);
    expect(estimateWorkdays(s.urlaubUnbezahlt, rate)).toBe(18);
    // Ohne die Trennung wären es alle 31 Kalendertage — zu hoher Vorschlag.
    expect(estimateWorkdays(s.urlaub + s.urlaubUnbezahlt, rate)).toBe(27);
  });
});
