import { describe, it, expect } from "vitest";
import {
  entryNetMinutes,
  groupEntriesByDay,
  periodTotalMinutes,
  formatMinutes,
  type EntryInput,
} from "./my-period-hours";

function entry(overrides: Partial<EntryInput> & Pick<EntryInput, "businessDate">): EntryInput {
  return {
    startedAt: "2026-06-26T10:00:00Z",
    endedAt: "2026-06-26T18:30:00Z",
    breakMinutes: 30,
    ...overrides,
  };
}

describe("entryNetMinutes", () => {
  it("10:00–18:30 mit 30 Pause = 480 Netto", () => {
    expect(entryNetMinutes(entry({ businessDate: "2026-06-26" }))).toBe(480);
  });
  it("offener Eintrag = null", () => {
    expect(entryNetMinutes(entry({ businessDate: "2026-06-26", endedAt: null }))).toBeNull();
  });
  it("klemmt negative Netto (Pause > Brutto) auf 0", () => {
    expect(
      entryNetMinutes(
        entry({
          businessDate: "2026-06-26",
          startedAt: "2026-06-26T10:00:00Z",
          endedAt: "2026-06-26T10:20:00Z",
          breakMinutes: 30,
        }),
      ),
    ).toBe(0);
  });
});

describe("groupEntriesByDay", () => {
  it("summiert zwei Einträge am selben business_date (geteilte Schicht)", () => {
    const es: EntryInput[] = [
      entry({
        businessDate: "2026-06-26",
        startedAt: "2026-06-26T10:00:00Z",
        endedAt: "2026-06-26T13:00:00Z",
        breakMinutes: 0,
      }),
      entry({
        businessDate: "2026-06-26",
        startedAt: "2026-06-26T18:00:00Z",
        endedAt: "2026-06-26T22:00:00Z",
        breakMinutes: 0,
      }),
    ];
    const days = groupEntriesByDay(es);
    expect(days).toHaveLength(1);
    expect(days[0].netMinutes).toBe(180 + 240);
    expect(days[0].entries).toHaveLength(2);
  });
  it("offener Eintrag fließt nicht in Tages-Summe", () => {
    const es: EntryInput[] = [
      entry({
        businessDate: "2026-06-26",
        startedAt: "2026-06-26T10:00:00Z",
        endedAt: "2026-06-26T13:00:00Z",
        breakMinutes: 0,
      }),
      entry({ businessDate: "2026-06-26", endedAt: null }),
    ];
    expect(groupEntriesByDay(es)[0].netMinutes).toBe(180);
  });
  it("Mitternachts-Wrap 18:00–02:00 = 8h und bleibt EIN business_date", () => {
    const es: EntryInput[] = [
      entry({
        businessDate: "2026-06-26",
        startedAt: "2026-06-26T18:00:00Z",
        endedAt: "2026-06-27T02:00:00Z",
        breakMinutes: 0,
      }),
    ];
    const days = groupEntriesByDay(es);
    expect(days).toHaveLength(1);
    expect(days[0].businessDate).toBe("2026-06-26");
    expect(days[0].netMinutes).toBe(480);
  });
  it("sortiert Tage aufsteigend", () => {
    const es: EntryInput[] = [
      entry({ businessDate: "2026-06-28" }),
      entry({ businessDate: "2026-06-26" }),
      entry({ businessDate: "2026-06-27" }),
    ];
    expect(groupEntriesByDay(es).map((d) => d.businessDate)).toEqual([
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
    ]);
  });
});

describe("periodTotalMinutes", () => {
  it("leere Liste = 0", () => {
    expect(periodTotalMinutes([])).toBe(0);
  });
  it("ignoriert offene Einträge", () => {
    const es: EntryInput[] = [
      entry({ businessDate: "2026-06-26" }),
      entry({ businessDate: "2026-06-27", endedAt: null }),
    ];
    expect(periodTotalMinutes(es)).toBe(480);
  });
});

// PB2 — Doppelt-Case: pausenBezahlt=true zählt Pause mit, =false zieht sie ab.
// Default (Parameter weggelassen) muss bit-identisch zum vor-PB2-Verhalten
// bleiben.
describe("PB2 — pausenBezahlt-Schalter", () => {
  const e = entry({
    businessDate: "2026-06-26",
    startedAt: "2026-06-26T10:00:00Z",
    endedAt: "2026-06-26T18:30:00Z",
    breakMinutes: 30,
  });

  it("entryNetMinutes: false → 480 (Netto), true → 510 (brutto)", () => {
    expect(entryNetMinutes(e, false)).toBe(480);
    expect(entryNetMinutes(e, true)).toBe(510);
  });

  it("Default (kein Parameter) bit-identisch zu false", () => {
    expect(entryNetMinutes(e)).toBe(entryNetMinutes(e, false));
    expect(periodTotalMinutes([e])).toBe(periodTotalMinutes([e], false));
    expect(groupEntriesByDay([e])[0].netMinutes).toBe(groupEntriesByDay([e], false)[0].netMinutes);
  });

  it("break=0: beide Stellungen bit-identisch", () => {
    const noBreak = entry({
      businessDate: "2026-06-26",
      startedAt: "2026-06-26T10:00:00Z",
      endedAt: "2026-06-26T18:00:00Z",
      breakMinutes: 0,
    });
    expect(entryNetMinutes(noBreak, true)).toBe(entryNetMinutes(noBreak, false));
    expect(periodTotalMinutes([noBreak], true)).toBe(periodTotalMinutes([noBreak], false));
  });

  it("klemmt auf 0, wenn Pause > Brutto (Modus false)", () => {
    const tiny = entry({
      businessDate: "2026-06-26",
      startedAt: "2026-06-26T10:00:00Z",
      endedAt: "2026-06-26T10:20:00Z",
      breakMinutes: 30,
    });
    expect(entryNetMinutes(tiny, false)).toBe(0);
    expect(entryNetMinutes(tiny, true)).toBe(20);
  });
});

describe("formatMinutes", () => {
  it("450 = 7:30 h", () => expect(formatMinutes(450)).toBe("7:30 h"));
  it("65 = 1:05 h", () => expect(formatMinutes(65)).toBe("1:05 h"));
  it("0 = 0:00 h", () => expect(formatMinutes(0)).toBe("0:00 h"));
  it("negativ = 0:00 h", () => expect(formatMinutes(-10)).toBe("0:00 h"));
});
