import { describe, expect, it } from "vitest";
import {
  mapTimeEntryRows,
  totalWorkMinutes,
  workMinutesByDate,
  type TimeEntryRow,
} from "./work-minutes";

// STAT2 — Fixture: zwei Personen, zwei Tage, ein offener Eintrag.
// Beweist, dass Umsatz-Tab und Personalquote dieselbe Quelle nutzen: der
// Personalquote-Pfad ruft genau `mapTimeEntryRows` (über work-minutes.server).
const rows: TimeEntryRow[] = [
  {
    staff_id: "s1",
    business_date: "2026-07-01",
    started_at: "2026-07-01T16:00:00Z",
    ended_at: "2026-07-01T22:00:00Z",
    break_minutes: 30,
    department: "service",
  },
  {
    staff_id: "s2",
    business_date: "2026-07-01",
    started_at: "2026-07-01T15:00:00Z",
    ended_at: "2026-07-01T20:30:00Z",
    break_minutes: 0,
    department: null,
  },
  {
    staff_id: "s1",
    business_date: "2026-07-02",
    started_at: "2026-07-02T17:00:00Z",
    ended_at: "2026-07-02T21:00:00Z",
    break_minutes: 0,
    department: "kitchen",
  },
  // offener Eintrag — wird ausgelassen (wie im Personalquote-Pfad)
  {
    staff_id: "s2",
    business_date: "2026-07-02",
    started_at: "2026-07-02T17:00:00Z",
    ended_at: null,
    break_minutes: 0,
    department: "service",
  },
];

describe("mapTimeEntryRows", () => {
  it("lässt offene Einträge aus und zählt Brutto bei pausen_bezahlt = true", () => {
    const entries = mapTimeEntryRows(rows, true);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.netMinutes)).toEqual([360, 330, 240]);
    expect(entries[0].rawDepartment).toBe("service");
    expect(entries[1].rawDepartment).toBeNull();
  });

  it("zieht Pausen ab, wenn pausen_bezahlt = false", () => {
    const entries = mapTimeEntryRows(rows, false);
    expect(entries.map((e) => e.netMinutes)).toEqual([330, 330, 240]);
  });

  it("überspringt Zeilen ohne Pflichtfelder", () => {
    expect(
      mapTimeEntryRows(
        [{ staff_id: null, business_date: null, started_at: null, ended_at: null, break_minutes: 0 }],
        true,
      ),
    ).toEqual([]);
  });
});

describe("workMinutesByDate / totalWorkMinutes", () => {
  it("aggregiert je Geschäftstag über mehrere Personen", () => {
    const entries = mapTimeEntryRows(rows, true);
    const byDate = workMinutesByDate(entries);
    expect(byDate.get("2026-07-01")).toBe(690);
    expect(byDate.get("2026-07-02")).toBe(240);
    expect(byDate.get("2026-07-03")).toBeUndefined();
    expect(totalWorkMinutes(entries)).toBe(930);
  });

  it("leere Eingabe ergibt leere Aggregation", () => {
    expect(workMinutesByDate([]).size).toBe(0);
    expect(totalWorkMinutes([])).toBe(0);
  });
});