import { describe, expect, it } from "vitest";
import { buildAbsenceIcsEvents } from "./absence-ics";
import { buildRosterIcs } from "./roster-ics";

describe("buildAbsenceIcsEvents", () => {
  it("trennt bezahlten und unbezahlten Urlaub in eigene Events", () => {
    const events = buildAbsenceIcsEvents(
      [
        { date: "2026-08-03", type: "urlaub" },
        { date: "2026-08-04", type: "urlaub" },
        { date: "2026-08-05", type: "urlaub_unbezahlt" },
        { date: "2026-08-06", type: "urlaub_unbezahlt" },
      ],
      "s1",
    );
    expect(events).toEqual([
      {
        uid: "absence-urlaub-s1-2026-08-03@coco",
        summary: "Urlaub",
        location: "",
        allDay: true,
        date: "2026-08-03",
        endDateExclusive: "2026-08-05",
        categories: ["URLAUB"],
      },
      {
        uid: "absence-urlaub_unbezahlt-s1-2026-08-05@coco",
        summary: "Urlaub (unbezahlt)",
        location: "",
        allDay: true,
        date: "2026-08-05",
        endDateExclusive: "2026-08-07",
        categories: ["URLAUB_UNBEZAHLT"],
      },
    ]);
  });

  it("krank bleibt eigener Typ, unbekannte Werte gelten als Urlaub", () => {
    const events = buildAbsenceIcsEvents(
      [
        { date: "2026-08-10", type: "krank" },
        { date: "2026-08-12", type: "quatsch" },
      ],
      "s2",
    );
    expect(events.map((e) => [e.summary, e.categories])).toEqual([
      ["Krank", ["KRANK"]],
      ["Urlaub", ["URLAUB"]],
    ]);
  });

  it("schreibt CATEGORIES in den ICS-Text", () => {
    const ics = buildRosterIcs({
      calendarName: "T",
      events: buildAbsenceIcsEvents([{ date: "2026-08-05", type: "urlaub_unbezahlt" }], "s1"),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    expect(ics).toContain("SUMMARY:Urlaub (unbezahlt)");
    expect(ics).toContain("CATEGORIES:URLAUB_UNBEZAHLT");
  });
  // UID-Stabilität/Eindeutigkeit: die UID ist aus Typ + staffId + Start-Datum
  // gebildet, also deterministisch (gleiche Eingabe => gleiche UID) und je
  // Event eindeutig — bezahlt und unbezahlt kollidieren nie.
  it("erzeugt eindeutige UIDs pro Event, auch bei gleichem Startdatum verschiedener Typen", () => {
    const events = buildAbsenceIcsEvents(
      [
        { date: "2026-08-03", type: "urlaub" },
        { date: "2026-08-03", type: "urlaub_unbezahlt" },
        { date: "2026-08-03", type: "krank" },
        { date: "2026-08-10", type: "urlaub" },
        { date: "2026-08-11", type: "urlaub_unbezahlt" },
      ],
      "s1",
    );
    const uids = events.map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids).toContain("absence-urlaub-s1-2026-08-03@coco");
    expect(uids).toContain("absence-urlaub_unbezahlt-s1-2026-08-03@coco");
    expect(uids).toContain("absence-krank-s1-2026-08-03@coco");
  });

  it("UIDs sind stabil über Wiederholungen und Zeilen-Reihenfolge", () => {
    const rows = [
      { date: "2026-08-04", type: "urlaub_unbezahlt" },
      { date: "2026-08-03", type: "urlaub" },
      { date: "2026-08-05", type: "urlaub_unbezahlt" },
    ];
    const a = buildAbsenceIcsEvents(rows, "s1").map((e) => e.uid);
    const b = buildAbsenceIcsEvents([...rows].reverse(), "s1").map((e) => e.uid);
    expect([...a].sort()).toEqual([...b].sort());
    expect(buildAbsenceIcsEvents(rows, "s1").map((e) => e.uid)).toEqual(a);
  });

  it("UIDs sind je Mitarbeiter verschieden und trennen Blöcke mit Lücke", () => {
    const rows = [
      { date: "2026-08-03", type: "urlaub_unbezahlt" },
      { date: "2026-08-06", type: "urlaub_unbezahlt" },
    ];
    const s1 = buildAbsenceIcsEvents(rows, "s1").map((e) => e.uid);
    const s2 = buildAbsenceIcsEvents(rows, "s2").map((e) => e.uid);
    expect(s1).toEqual([
      "absence-urlaub_unbezahlt-s1-2026-08-03@coco",
      "absence-urlaub_unbezahlt-s1-2026-08-06@coco",
    ]);
    expect(s1.some((u) => s2.includes(u))).toBe(false);
  });

  it("UID landet unverändert im ICS-Text", () => {
    const ics = buildRosterIcs({
      calendarName: "T",
      events: buildAbsenceIcsEvents(
        [
          { date: "2026-08-05", type: "urlaub_unbezahlt" },
          { date: "2026-08-05", type: "urlaub" },
        ],
        "s1",
      ),
      now: new Date("2026-08-01T00:00:00Z"),
    });
    expect(ics).toContain("UID:absence-urlaub-s1-2026-08-05@coco");
    expect(ics).toContain("UID:absence-urlaub_unbezahlt-s1-2026-08-05@coco");
  });
});
