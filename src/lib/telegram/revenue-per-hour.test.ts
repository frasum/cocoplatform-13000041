import { describe, expect, it } from "vitest";
import { fmtEuroPerHour, revenuePerWorkHourCents } from "./revenue-per-hour";
import { buildDailyReport, DEFAULT_REPORT_FLAGS } from "./telegram-report";

describe("TG5 — Umsatz je Arbeitsstunde", () => {
  it("rechnet Umsatz / Netto-Arbeitsstunden", () => {
    // 760,00 € auf 10 Stunden ⇒ 76,00 €/Std
    expect(revenuePerWorkHourCents({ totalCents: 76_000, workMinutes: 600 })).toBe(7_600);
  });

  it("Stunden 0 ⇒ null (kein 0, kein Fehler)", () => {
    expect(revenuePerWorkHourCents({ totalCents: 76_000, workMinutes: 0 })).toBeNull();
    expect(revenuePerWorkHourCents({ totalCents: 0, workMinutes: 0 })).toBeNull();
  });

  it("negative Minuten zählen als keine Stunden", () => {
    expect(revenuePerWorkHourCents({ totalCents: 100, workMinutes: -30 })).toBeNull();
  });

  it("formatiert ganze Euro bzw. Gedankenstrich", () => {
    expect(fmtEuroPerHour(7_600)).toBe("76 €/Std");
    expect(fmtEuroPerHour(7_649)).toBe("76 €/Std");
    expect(fmtEuroPerHour(123_400)).toBe("1.234 €/Std");
    expect(fmtEuroPerHour(null)).toBe("— €/Std");
    expect(fmtEuroPerHour(undefined)).toBe("— €/Std");
  });
});

describe("TG5 — Berichtszeile", () => {
  const loc = (perHour: number | null | undefined) => ({
    businessDate: "2026-08-03",
    locations: [
      {
        locationId: "l1",
        name: "Spicery",
        hasSession: true,
        vectronCents: 100_000,
        revenuePerWorkHourCents: perHour,
      },
    ],
  });

  it("hängt den Wert an die Umsatzzeile", () => {
    expect(buildDailyReport(loc(7_600), DEFAULT_REPORT_FLAGS)).toContain(
      "Vectron: 1.000,00 € · 76 €/Std",
    );
  });

  it("zeigt Gedankenstrich ohne erfasste Stunden", () => {
    expect(buildDailyReport(loc(null), DEFAULT_REPORT_FLAGS)).toContain(
      "Vectron: 1.000,00 € · — €/Std",
    );
  });

  it("ohne Kennzahl bleibt die Zeile unverändert", () => {
    const text = buildDailyReport(loc(undefined), DEFAULT_REPORT_FLAGS);
    expect(text).toContain("Vectron: 1.000,00 €");
    expect(text).not.toContain("€/Std");
  });
});
