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

// TG5-Härtung: Zeichen und Locale des Formats sind Vertrag gegenüber dem
// Telegram-Client. Diese Tests schlagen fehl, sobald Trennzeichen, Dezimalen,
// Leerzeichen oder der Gedankenstrich versehentlich getauscht werden.
describe('TG5 — Format „76 €/Std" ist zeichengenau festgenagelt', () => {
  it("rundet kaufmännisch auf ganze Euro, ohne Dezimalstellen", () => {
    expect(fmtEuroPerHour(7_600)).toBe("76 €/Std");
    expect(fmtEuroPerHour(7_649)).toBe("76 €/Std");
    expect(fmtEuroPerHour(7_650)).toBe("77 €/Std");
    expect(fmtEuroPerHour(7_699)).toBe("77 €/Std");
    expect(fmtEuroPerHour(0)).toBe("0 €/Std");
    expect(fmtEuroPerHour(49)).toBe("0 €/Std");
    expect(fmtEuroPerHour(50)).toBe("1 €/Std");
    expect(fmtEuroPerHour(7_612)).not.toContain(",");
  });

  it("nutzt de-DE-Tausenderpunkt, keinen Komma- oder Apostroph-Trenner", () => {
    expect(fmtEuroPerHour(123_400)).toBe("1.234 €/Std");
    expect(fmtEuroPerHour(1_234_500)).toBe("12.345 €/Std");
    expect(fmtEuroPerHour(123_456_700)).toBe("1.234.567 €/Std");
    expect(fmtEuroPerHour(123_400)).not.toContain("1,234");
    expect(fmtEuroPerHour(123_400)).not.toContain("’");
  });

  it("verwendet genau ein normales Leerzeichen vor dem Euro-Zeichen", () => {
    const out = fmtEuroPerHour(7_600);
    // Codepoints: "76" + U+0020 + U+20AC ("€") + "/Std"
    expect([...out].map((c) => c.codePointAt(0))).toEqual([
      0x37, 0x36, 0x20, 0x20ac, 0x2f, 0x53, 0x74, 0x64,
    ]);
    expect(out).not.toMatch(/\u00a0|\u202f|\u2009/); // kein geschütztes/schmales Leerzeichen
    expect(out.endsWith("€/Std")).toBe(true);
  });

  it("Stunden 0 ⇒ Gedankenstrich U+2014, kein Bindestrich und keine 0", () => {
    const cents = revenuePerWorkHourCents({ totalCents: 76_000, workMinutes: 0 });
    expect(cents).toBeNull();
    const out = fmtEuroPerHour(cents);
    expect(out).toBe("— €/Std");
    expect([...out].map((c) => c.codePointAt(0))).toEqual([
      0x2014, 0x20, 0x20ac, 0x2f, 0x53, 0x74, 0x64,
    ]);
    expect(out).not.toContain("-"); // kein ASCII-Bindestrich
    expect(out).not.toContain("–"); // kein Halbgeviertstrich U+2013
    expect(out).not.toContain("0");
  });

  it("unsaubere Zahlen fallen auf den Gedankenstrich zurück", () => {
    expect(fmtEuroPerHour(Number.NaN)).toBe("— €/Std");
    expect(fmtEuroPerHour(Number.POSITIVE_INFINITY)).toBe("— €/Std");
    expect(fmtEuroPerHour(Number.NEGATIVE_INFINITY)).toBe("— €/Std");
  });

  it("die Berichtszeile trägt exakt dieselben Zeichen", () => {
    const text = buildDailyReport(
      {
        businessDate: "2026-08-03",
        locations: [
          {
            locationId: "l1",
            name: "Spicery",
            hasSession: true,
            vectronCents: 100_000,
            revenuePerWorkHourCents: 7_600,
          },
        ],
      },
      DEFAULT_REPORT_FLAGS,
    );
    // Mitteltrenner U+00B7 mit je einem normalen Leerzeichen, dann das Format.
    expect(text).toContain("\u0020\u00b7\u0020" + fmtEuroPerHour(7_600));
  });
});
