import { describe, expect, it } from "vitest";
import { eventNotices } from "./event-notices";
import type { EventRow } from "./events-core";

function ev(partial: Partial<EventRow> & { name: string; dateFrom: string }): EventRow {
  return {
    id: partial.name,
    name: partial.name,
    dateFrom: partial.dateFrom,
    dateTo: partial.dateTo ?? partial.dateFrom,
    category: "Volksfest",
    locationText: null,
    distanceText: null,
    impact: partial.impact ?? "hoch",
    recommendation: null,
    source: null,
    provisional: partial.provisional ?? false,
  };
}

describe("eventNotices", () => {
  it("leere Liste ergibt keine Hinweise", () => {
    expect(eventNotices([], "2026-09-18")).toEqual([]);
  });

  it("Vortag: Event startet morgen", () => {
    const out = eventNotices([ev({ name: "Wiesn", dateFrom: "2026-09-19" })], "2026-09-18");
    expect(out).toEqual([
      {
        kind: "tomorrow",
        name: "Wiesn",
        impact: "hoch",
        provisional: false,
        dateFrom: "2026-09-19",
      },
    ]);
  });

  it("Starttag: nur running Tag 1/y, kein Doppel-Hinweis", () => {
    const out = eventNotices(
      [ev({ name: "Wiesn", dateFrom: "2026-09-19", dateTo: "2026-10-04" })],
      "2026-09-19",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "running", dayIndex: 1, dayCount: 16 });
  });

  it("Lauftag Mitte: Tag 5/16", () => {
    const out = eventNotices(
      [ev({ name: "Wiesn", dateFrom: "2026-09-19", dateTo: "2026-10-04" })],
      "2026-09-23",
    );
    expect(out[0]).toMatchObject({ kind: "running", dayIndex: 5, dayCount: 16 });
  });

  it("letzter Tag: 16/16", () => {
    const out = eventNotices(
      [ev({ name: "Wiesn", dateFrom: "2026-09-19", dateTo: "2026-10-04" })],
      "2026-10-04",
    );
    expect(out[0]).toMatchObject({ dayIndex: 16, dayCount: 16 });
  });

  it("Tag danach: nichts", () => {
    expect(
      eventNotices(
        [ev({ name: "Wiesn", dateFrom: "2026-09-19", dateTo: "2026-10-04" })],
        "2026-10-05",
      ),
    ).toEqual([]);
  });

  it("Eintages-Event: Tag 1/1", () => {
    const out = eventNotices([ev({ name: "Konzert", dateFrom: "2026-05-01" })], "2026-05-01");
    expect(out[0]).toMatchObject({ kind: "running", dayIndex: 1, dayCount: 1 });
  });

  it("provisional wird durchgereicht", () => {
    const out = eventNotices(
      [ev({ name: "Messe", dateFrom: "2027-03-02", provisional: true })],
      "2027-03-01",
    );
    expect(out[0]).toMatchObject({ kind: "tomorrow", provisional: true });
  });

  it("Sortierung: sehr_hoch vor mittel, dann date_from", () => {
    const out = eventNotices(
      [
        ev({ name: "Mittel-Lauf", dateFrom: "2026-05-01", dateTo: "2026-05-03", impact: "mittel" }),
        ev({ name: "Sehr", dateFrom: "2026-05-03", impact: "sehr_hoch" }),
        ev({ name: "Mittel-Morgen", dateFrom: "2026-05-03", impact: "mittel" }),
      ],
      "2026-05-02",
    );
    expect(out.map((n) => n.name)).toEqual(["Sehr", "Mittel-Lauf", "Mittel-Morgen"]);
  });
});
