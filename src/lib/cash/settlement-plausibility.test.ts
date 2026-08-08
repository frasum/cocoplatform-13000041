// KA3 Teil 1 — Entscheidungslogik der lauten Rückfrage.
import { describe, it, expect } from "vitest";
import {
  isTripleNegative,
  needsForeignConfirmation,
  foreignConfirmationAccepted,
  type SettlementPlausibility,
} from "./settlement-plausibility";

const p = (o: Partial<SettlementPlausibility> = {}): SettlementPlausibility => ({
  hasOpenTimeEntry: false,
  hasPoolEntry: false,
  hasRosterShift: false,
  ...o,
});

describe("settlement plausibility", () => {
  it("dreifach-negativ ⇒ Rückfrage", () => {
    expect(isTripleNegative(p())).toBe(true);
    expect(needsForeignConfirmation(p(), undefined)).toBe(true);
  });

  it("nur EIN Signal fehlt (kein Stempler, aber Pool-Eintrag) ⇒ KEINE Rückfrage", () => {
    expect(needsForeignConfirmation(p({ hasPoolEntry: true }), undefined)).toBe(false);
    expect(needsForeignConfirmation(p({ hasRosterShift: true }), undefined)).toBe(false);
    expect(needsForeignConfirmation(p({ hasOpenTimeEntry: true }), undefined)).toBe(false);
  });

  it("Bestätigung hebt die Rückfrage auf", () => {
    expect(needsForeignConfirmation(p(), true)).toBe(false);
    expect(foreignConfirmationAccepted(p(), true)).toBe(true);
  });

  it("Bestätigung ohne dreifach-negative Lage wird ignoriert", () => {
    expect(foreignConfirmationAccepted(p({ hasPoolEntry: true }), true)).toBe(false);
    expect(foreignConfirmationAccepted(p(), false)).toBe(false);
    expect(foreignConfirmationAccepted(p(), undefined)).toBe(false);
  });
});
