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
});
