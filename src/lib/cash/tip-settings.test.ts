import { describe, expect, it } from "vitest";
import { mergeTipSettings } from "./tip-settings";

const org = {
  kitchenTipRate: 0.02,
  tipPoolMinHours: 2.5,
  kitchenManualOnly: false,
  distributionMode: "hours" as const,
  distributionModeFrom: null,
};

// TG4-Basis für Standort-Overrides: Modus-Paar ungesetzt = Org erbt.
const locBase = {
  distributionModeOverride: null,
  distributionModeFromOverride: null,
};

describe("mergeTipSettings — COALESCE-Vererbung", () => {
  it("kein Standort → alle Org-Standards, servicePool default an", () => {
    const r = mergeTipSettings({ org, location: null });
    expect(r).toEqual({
      servicePoolEnabled: true,
      kitchenTipRate: 0.02,
      tipPoolMinHours: 2.5,
      kitchenManualOnly: false,
      distributionMode: "hours",
      distributionModeFrom: null,
    });
  });

  it("Overrides alle NULL → Org-Standards, aber servicePoolEnabled aus DB", () => {
    const r = mergeTipSettings({
      org,
      location: {
        tipServicePoolEnabled: false,
        kitchenTipRateOverride: null,
        tipPoolMinHoursOverride: null,
        kitchenManualOnlyOverride: null,
        ...locBase,
      },
    });
    expect(r).toEqual({
      servicePoolEnabled: false,
      kitchenTipRate: 0.02,
      tipPoolMinHours: 2.5,
      kitchenManualOnly: false,
      distributionMode: "hours",
      distributionModeFrom: null,
    });
  });

  it("Overrides gesetzt → Overrides gewinnen", () => {
    const r = mergeTipSettings({
      org,
      location: {
        tipServicePoolEnabled: true,
        kitchenTipRateOverride: 0.03,
        tipPoolMinHoursOverride: 4,
        kitchenManualOnlyOverride: true,
        ...locBase,
      },
    });
    expect(r).toEqual({
      servicePoolEnabled: true,
      kitchenTipRate: 0.03,
      tipPoolMinHours: 4,
      kitchenManualOnly: true,
      distributionMode: "hours",
      distributionModeFrom: null,
    });
  });

  it("false-Overrides überschreiben nicht per Wahrheitswert (nur NULL fällt zurück)", () => {
    const r = mergeTipSettings({
      org: { ...org, kitchenManualOnly: true },
      location: {
        tipServicePoolEnabled: true,
        kitchenTipRateOverride: 0,
        tipPoolMinHoursOverride: 0,
        kitchenManualOnlyOverride: false,
        ...locBase,
      },
    });
    expect(r.kitchenTipRate).toBe(0);
    expect(r.tipPoolMinHours).toBe(0);
    expect(r.kitchenManualOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------
// TG4 — Verteilmodus + Stichtag erben als PAAR (bewusste Abweichung von
// der feldweisen COALESCE-Regel, siehe Kommentar in tip-settings.ts).
// ---------------------------------------------------------------------
describe("mergeTipSettings — TG4 Paar-Vererbung Verteilmodus", () => {
  const orgTg4 = {
    ...org,
    distributionMode: "headcount" as const,
    distributionModeFrom: "2026-08-01",
  };

  it("kein Standort-Override → Org-Paar gilt", () => {
    const r = mergeTipSettings({ org: orgTg4, location: null });
    expect(r.distributionMode).toBe("headcount");
    expect(r.distributionModeFrom).toBe("2026-08-01");
  });

  it("Standort-Override gesetzt → BEIDE Standortwerte gelten (auch Stichtag NULL)", () => {
    const r = mergeTipSettings({
      org: orgTg4,
      location: {
        tipServicePoolEnabled: true,
        kitchenTipRateOverride: null,
        tipPoolMinHoursOverride: null,
        kitchenManualOnlyOverride: null,
        distributionModeOverride: "hours",
        distributionModeFromOverride: null,
      },
    });
    expect(r.distributionMode).toBe("hours");
    expect(r.distributionModeFrom).toBeNull();
  });

  it("nur Standort-Stichtag ohne Modus → Org-Paar gewinnt (kein Misch-Zustand)", () => {
    const r = mergeTipSettings({
      org: orgTg4,
      location: {
        tipServicePoolEnabled: true,
        kitchenTipRateOverride: null,
        tipPoolMinHoursOverride: null,
        kitchenManualOnlyOverride: null,
        distributionModeOverride: null,
        distributionModeFromOverride: "2026-09-01",
      },
    });
    expect(r.distributionMode).toBe("headcount");
    expect(r.distributionModeFrom).toBe("2026-08-01");
  });
});

// TG4-N1 — Migrations-Neutralität: Default-Zustand rechnet durchgängig
// nach Stunden, unabhängig vom Geschäftstag.
describe("TG4-N1 — Default-Zustand ist verhaltensneutral", () => {
  it("mode='hours' + from=null ergibt an jedem Geschäftstag 'hours'", () => {
    const merged = mergeTipSettings({
      org: {
        kitchenTipRate: 0.02,
        tipPoolMinHours: 2.5,
        kitchenManualOnly: false,
        distributionMode: "hours",
        distributionModeFrom: null,
      },
      location: null,
    });
    expect(merged.distributionMode).toBe("hours");
    expect(merged.distributionModeFrom).toBeNull();
    for (const d of ["2025-01-01", "2026-07-30", "2030-12-31"]) {
      expect(
        resolveTipDistributionMode(d, merged.distributionMode, merged.distributionModeFrom),
      ).toBe("hours");
    }
  });
});
