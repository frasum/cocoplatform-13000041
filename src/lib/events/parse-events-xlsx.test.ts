import { describe, expect, it } from "vitest";
import { parseEventsSheet, parseSheetDate, type SheetRow } from "./parse-events-xlsx";

const HEADER: SheetRow = [
  null,
  "Von",
  "Bis",
  "Event",
  "Kategorie",
  "Location",
  "Distanz Yum Thai",
  "Erwarteter Impact",
  "Empfehlung Personal/Reservierung",
  "Quelle",
];

function sheet(...rows: SheetRow[]): SheetRow[] {
  return [["München-Eventkalender"], HEADER, ...rows];
}

describe("parseSheetDate", () => {
  it("liest ISO-Strings", () => {
    expect(parseSheetDate("2026-09-19")).toBe("2026-09-19");
  });

  it("liest deutsches Datum", () => {
    expect(parseSheetDate("1.10.2026")).toBe("2026-10-01");
  });

  it("liest Excel-Seriennummern (1900-System)", () => {
    expect(parseSheetDate(25569)).toBe("1970-01-01");
    expect(parseSheetDate(46284)).toBe("2026-09-19");
  });

  it("liest Date-Objekte", () => {
    expect(parseSheetDate(new Date(Date.UTC(2026, 8, 19)))).toBe("2026-09-19");
  });

  it("gibt null bei Unlesbarem", () => {
    expect(parseSheetDate("demnächst")).toBeNull();
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });
});

describe("parseEventsSheet", () => {
  it("liest eine vollständige Zeile", () => {
    const res = parseEventsSheet(
      sheet([
        null,
        "2026-09-19",
        "2026-10-04",
        "OKTOBERFEST 2026",
        "Volksfest",
        "Theresienwiese",
        "~4 km",
        "SEHR HOCH",
        "Maximalbesetzung",
        "muenchen.de",
      ]),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      sheetRow: 3,
      name: "OKTOBERFEST 2026",
      dateFrom: "2026-09-19",
      dateTo: "2026-10-04",
      category: "Volksfest",
      locationText: "Theresienwiese",
      distanceText: "~4 km",
      impact: "sehr_hoch",
      recommendation: "Maximalbesetzung",
      source: "muenchen.de",
    });
  });

  it("erkennt Mehrtages- und Eintages-Events", () => {
    const res = parseEventsSheet(
      sheet(
        [null, "2026-05-01", "2026-05-03", "Messe A", "Fachmesse", "Riem", "~8 km", "Hoch"],
        [null, "2026-06-11", null, "Konzert B", "Konzert", "Olympiahalle", "~5 km", "Mittel"],
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows.map((r) => [r.dateFrom, r.dateTo])).toEqual([
      ["2026-05-01", "2026-05-03"],
      ["2026-06-11", "2026-06-11"],
    ]);
  });

  it("überspringt leere Zeilen", () => {
    const res = parseEventsSheet(
      sheet(
        [],
        [null, null, null, null],
        [null, "2026-07-01", "2026-07-01", "Sommerfest", "Volksfest", "Olympiapark", "", "Mittel"],
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(1);
  });

  it("listet unbekannten Impact als Fehler statt zu raten", () => {
    const res = parseEventsSheet(
      sheet([null, "2026-07-01", "2026-07-01", "Fest X", "Volksfest", "Ort", "", "explosiv"]),
    );
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.sheetRow).toBe(3);
    expect(res.errors[0]?.message).toContain("explosiv");
  });

  it("listet unlesbares Von-Datum und fehlende Kategorie als Fehler", () => {
    const res = parseEventsSheet(
      sheet(
        [null, "irgendwann", "2026-07-01", "Fest Y", "Volksfest", "Ort", "", "Hoch"],
        [null, "2026-07-02", "2026-07-02", "Fest Z", "", "Ort", "", "Hoch"],
      ),
    );
    expect(res.rows).toEqual([]);
    expect(res.errors.map((e) => e.sheetRow)).toEqual([3, 4]);
  });

  it("findet Spalten auch bei verschobenem Kopf", () => {
    const res = parseEventsSheet([
      ["irgendwas"],
      ["noch was"],
      ["Von", "Bis", "Event", "Kategorie", "Location", "Distanz", "Impact", "Empfehlung", "Quelle"],
      ["2026-08-01", "2026-08-02", "Fest Q", "Volksfest", "Ort", "~1 km", "Mittel-Hoch", "", ""],
    ]);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ name: "Fest Q", impact: "mittel_hoch", sheetRow: 4 });
  });
});
