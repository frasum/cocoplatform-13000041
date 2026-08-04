// UB2 — Regeltests der Konto-Rechnung und des Aufteilungs-Vorschlags.
import { describe, expect, it } from "vitest";
import {
  availablePaidVacationDays,
  isVacationWorkday,
  splitVacationProposal,
} from "./vacation-balance";

describe("UB2 — availablePaidVacationDays", () => {
  it("rechnet Vorjahr + laufendes Jahr − genommen", () => {
    expect(
      availablePaidVacationDays({
        previousYear: 5,
        currentYear: 24,
        taken: 12,
        confirmedNotInTaken: 0,
      }),
    ).toBe(17);
  });

  it("zieht bestätigte, nicht in `taken` enthaltene Tage ab (Doppelzählungs-Schutz)", () => {
    expect(
      availablePaidVacationDays({
        previousYear: 0,
        currentYear: 24,
        taken: 10,
        confirmedNotInTaken: 2,
      }),
    ).toBe(12);
  });

  it("zählt bereits in `taken` verbuchte Tage NICHT doppelt", () => {
    const inTaken = availablePaidVacationDays({
      previousYear: 0,
      currentYear: 24,
      taken: 12,
      confirmedNotInTaken: 0,
    });
    const separat = availablePaidVacationDays({
      previousYear: 0,
      currentYear: 24,
      taken: 10,
      confirmedNotInTaken: 2,
    });
    expect(inTaken).toBe(separat);
  });

  it("liefert null, wenn ein Kontofeld nicht gepflegt ist", () => {
    const base = { previousYear: 0, currentYear: 24, taken: 0, confirmedNotInTaken: 0 };
    expect(availablePaidVacationDays({ ...base, previousYear: null })).toBeNull();
    expect(availablePaidVacationDays({ ...base, currentYear: null })).toBeNull();
    expect(availablePaidVacationDays({ ...base, taken: null })).toBeNull();
  });

  it("wird nicht negativ", () => {
    expect(
      availablePaidVacationDays({
        previousYear: 0,
        currentYear: 10,
        taken: 12,
        confirmedNotInTaken: 3,
      }),
    ).toBe(0);
  });
});

describe("UB2 — splitVacationProposal", () => {
  const days = ["2026-08-03", "2026-08-04", "2026-08-05"];

  it("teilt chronologisch: erste N bezahlt, Rest unbezahlt", () => {
    expect(splitVacationProposal(days, 2)).toEqual({
      paid: ["2026-08-03", "2026-08-04"],
      unpaid: ["2026-08-05"],
    });
  });

  it("available 0 ⇒ alles unbezahlt", () => {
    expect(splitVacationProposal(days, 0)).toEqual({ paid: [], unpaid: days });
  });

  it("available ≥ Tage ⇒ alles bezahlt", () => {
    expect(splitVacationProposal(days, 3)).toEqual({ paid: days, unpaid: [] });
    expect(splitVacationProposal(days, 99)).toEqual({ paid: days, unpaid: [] });
  });

  it("leere Liste bleibt leer", () => {
    expect(splitVacationProposal([], 5)).toEqual({ paid: [], unpaid: [] });
  });

  it("sortiert unsortierte Eingaben", () => {
    expect(splitVacationProposal(["2026-08-05", "2026-08-03"], 1).paid).toEqual(["2026-08-03"]);
  });

  it("negative oder gebrochene Werte werden geklemmt/abgeschnitten", () => {
    expect(splitVacationProposal(days, -3).paid).toEqual([]);
    expect(splitVacationProposal(days, 1.9).paid).toEqual(["2026-08-03"]);
  });
});

describe("UB2 — isVacationWorkday", () => {
  it("Mo–Fr ohne Feiertag ist Arbeitstag", () => {
    expect(isVacationWorkday("2026-08-03")).toBe(true);
  });
  it("Wochenende nicht", () => {
    expect(isVacationWorkday("2026-08-08")).toBe(false);
    expect(isVacationWorkday("2026-08-09")).toBe(false);
  });
  it("Feiertag nicht (Mariä Himmelfahrt 15.08. ist ein Samstag 2026 — Neujahr prüfen)", () => {
    expect(isVacationWorkday("2027-01-01")).toBe(false);
  });
});
