import { describe, expect, it } from "vitest";
import {
  berlinLocalToIso,
  berlinOffsetMinutesAt,
  computeShiftHours,
  isBavarianHoliday,
  isSundayOrHoliday,
} from "./shift-hours";

// Hinweis: ISO-Strings mit explizitem Berlin-Offset (Sommerzeit "+02:00", Winterzeit "+01:00").
// 15.06.2026 ist ein Montag (Sommerzeit).

describe("shift-hours", () => {
  it("(a) Normalschicht 15:00–23:30 → Ges=8,5h, Abend=3,5h, Nacht=0", () => {
    const r = computeShiftHours(
      "2026-06-15T15:00:00+02:00",
      "2026-06-15T23:30:00+02:00",
      "2026-06-15",
    );
    expect(r.totalHours).toBeCloseTo(8.5, 5);
    expect(r.eveningHours).toBeCloseTo(3.5, 5);
    expect(r.nightHours).toBeCloseTo(0, 5);
    expect(r.sundayHolidayHours).toBe(0);
  });

  it("(b) Mitternachtsschicht 16:00–00:15 → Ges=8,25h, Abend=4h, Nacht=0,25h", () => {
    const r = computeShiftHours(
      "2026-06-15T16:00:00+02:00",
      "2026-06-16T00:15:00+02:00",
      "2026-06-15",
    );
    expect(r.totalHours).toBeCloseTo(8.25, 5);
    expect(r.eveningHours).toBeCloseTo(4, 5);
    expect(r.nightHours).toBeCloseTo(0.25, 5);
  });

  it("(c) Sonntagsschicht überschreibt Abend-Zuschlag", () => {
    // 14.06.2026 ist ein Sonntag.
    const r = computeShiftHours(
      "2026-06-14T15:00:00+02:00",
      "2026-06-14T23:00:00+02:00",
      "2026-06-14",
    );
    expect(r.totalHours).toBeCloseTo(8, 5);
    expect(r.sundayHolidayHours).toBeCloseTo(8, 5);
    expect(r.eveningHours).toBe(0);
    expect(r.nightHours).toBe(0);
  });

  it("(d) 01.05. ist Feiertag (Tag der Arbeit)", () => {
    const d = new Date("2026-05-01T12:00:00Z");
    expect(isBavarianHoliday(d)).toBe(true);
    expect(isSundayOrHoliday(d)).toBe(true);
  });

  it("(e) Ostermontag 2026 = 06.04.2026", () => {
    const ostermontag = new Date("2026-04-06T12:00:00Z");
    const normaler = new Date("2026-04-07T12:00:00Z");
    expect(isBavarianHoliday(ostermontag)).toBe(true);
    expect(isBavarianHoliday(normaler)).toBe(false);
  });

  it("(f) Schicht ohne Mitternachtsüberschreitung → nightHours=0", () => {
    const r = computeShiftHours(
      "2026-06-15T10:00:00+02:00",
      "2026-06-15T18:00:00+02:00",
      "2026-06-15",
    );
    expect(r.nightHours).toBe(0);
    expect(r.eveningHours).toBe(0);
    expect(r.totalHours).toBeCloseTo(8, 5);
  });

  // DST-Umstellungsnächte: 2026-03-29 (CET→CEST) und 2026-10-25 (CEST→CET).
  it("(g) DST März: Mitternacht am Umstellungstag ist CET (+01:00)", () => {
    // 00:00 Berlin am 2026-03-29 liegt VOR der 02:00→03:00-Umstellung,
    // also noch Winterzeit (+01:00) = 2026-03-28T23:00:00Z.
    expect(berlinLocalToIso("2026-03-29", 0, 0)).toBe("2026-03-28T23:00:00.000Z");
    // 12:00 desselben Tages ist bereits Sommerzeit (+02:00).
    expect(berlinLocalToIso("2026-03-29", 12, 0)).toBe("2026-03-29T10:00:00.000Z");
  });

  it("(h) DST Oktober: Mitternacht am Umstellungstag ist CEST (+02:00)", () => {
    // 00:00 Berlin am 2026-10-25 liegt VOR der 03:00→02:00-Umstellung,
    // also noch Sommerzeit (+02:00) = 2026-10-24T22:00:00Z.
    expect(berlinLocalToIso("2026-10-25", 0, 0)).toBe("2026-10-24T22:00:00.000Z");
    // 12:00 desselben Tages ist bereits Winterzeit (+01:00).
    expect(berlinLocalToIso("2026-10-25", 12, 0)).toBe("2026-10-25T11:00:00.000Z");
  });

  it("(i) Schicht Sa 17:00 → So 01:00 über Oktober-Umstellung: 8h (Wanduhr)", () => {
    // Sa 2026-10-24 17:00 CEST = 15:00Z. So 2026-10-25 01:00 CEST = 23:00Z
    // (Vortag UTC — DST-Switch erst um 03:00 lokal). Buggy Altcode nahm
    // Mittags-Offset des 25.10. (+01:00) und ergab fälschlich 9h.
    const startedAt = berlinLocalToIso("2026-10-24", 17, 0);
    const endedAt = berlinLocalToIso("2026-10-25", 1, 0);
    expect(startedAt).toBe("2026-10-24T15:00:00.000Z");
    expect(endedAt).toBe("2026-10-24T23:00:00.000Z");
    const r = computeShiftHours(startedAt, endedAt, "2026-10-24", 0, true);
    expect(r.totalHours).toBeCloseTo(8, 5);
    expect(r.eveningHours).toBeCloseTo(4, 5);
    expect(r.nightHours).toBeCloseTo(1, 5);
  });

  it("(j) Schicht Sa 17:00 → So 01:00 über März-Umstellung: 8h (Wanduhr)", () => {
    // Sa 2026-03-28 17:00 CET = 16:00Z. So 2026-03-29 01:00 CET = 00:00Z.
    // Buggy Altcode nahm Mittags-Offset des 29.03. (+02:00) und ergab
    // fälschlich 7h — 1h Lohn zu wenig.
    const startedAt = berlinLocalToIso("2026-03-28", 17, 0);
    const endedAt = berlinLocalToIso("2026-03-29", 1, 0);
    expect(startedAt).toBe("2026-03-28T16:00:00.000Z");
    expect(endedAt).toBe("2026-03-29T00:00:00.000Z");
    const r = computeShiftHours(startedAt, endedAt, "2026-03-28", 0, true);
    expect(r.totalHours).toBeCloseTo(8, 5);
    expect(r.eveningHours).toBeCloseTo(4, 5);
    expect(r.nightHours).toBeCloseTo(1, 5);
  });

  it("(k) berlinOffsetMinutesAt liefert Instant-genauen Offset", () => {
    // 2026-10-25T00:30:00Z liegt zwischen den 02:00-CEST-Wiederholungen,
    // hier ist Berlin bereits auf +02:00 (00:30Z = 02:30 CEST).
    expect(berlinOffsetMinutesAt(new Date("2026-10-25T00:30:00Z"))).toBe(120);
    // 2026-10-25T02:00:00Z = 03:00 CET (nach Umstellung).
    expect(berlinOffsetMinutesAt(new Date("2026-10-25T02:00:00Z"))).toBe(60);
  });
});
