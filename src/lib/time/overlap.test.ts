import { describe, expect, it } from "vitest";
import { conflictMessage, findTimeConflict, overlaps, type TimeSpan } from "./overlap";

// Alle Zeiten als UTC-ISO; Europe/Berlin im Sommer = UTC+2.
const span = (id: string, s: string, e: string | null): TimeSpan => ({
  id,
  startedAt: s,
  endedAt: e,
});

describe("overlaps", () => {
  it("Ende == Anfang der Folgeschicht ist KEINE Überlappung", () => {
    expect(
      overlaps(
        { startedAt: "2026-08-03T10:00:00Z", endedAt: "2026-08-03T14:00:00Z" },
        { startedAt: "2026-08-03T14:00:00Z", endedAt: "2026-08-03T20:00:00Z" },
      ),
    ).toBe(false);
  });

  it("echte Überlappung wird erkannt", () => {
    expect(
      overlaps(
        { startedAt: "2026-08-03T10:00:00Z", endedAt: "2026-08-03T14:00:00Z" },
        { startedAt: "2026-08-03T13:00:00Z", endedAt: "2026-08-03T20:00:00Z" },
      ),
    ).toBe(true);
  });

  it("offenes Ende überlappt mit allem danach", () => {
    expect(
      overlaps(
        { startedAt: "2026-08-03T10:00:00Z", endedAt: null },
        { startedAt: "2026-08-03T23:00:00Z", endedAt: "2026-08-04T01:00:00Z" },
      ),
    ).toBe(true);
  });
});

describe("findTimeConflict", () => {
  const existing = [
    span("a", "2026-08-03T13:00:00Z", "2026-08-03T21:00:00Z"), // 15–23 Berlin
  ];

  it("identischer Eintrag ⇒ identical", () => {
    const c = findTimeConflict(existing, {
      startedAt: "2026-08-03T13:00:00Z",
      endedAt: "2026-08-03T21:00:00Z",
    });
    expect(c?.kind).toBe("identical");
  });

  it("Nachtschicht 23–02 gegen 15–23 ist konfliktfrei", () => {
    const c = findTimeConflict(existing, {
      startedAt: "2026-08-03T21:00:00Z",
      endedAt: "2026-08-04T00:00:00Z",
    });
    expect(c).toBeNull();
  });

  it("Nachtschicht 23–02 gegen 01–03 des Folgetags überlappt", () => {
    const night = [span("n", "2026-08-03T21:00:00Z", "2026-08-04T00:00:00Z")];
    const c = findTimeConflict(night, {
      startedAt: "2026-08-03T23:00:00Z",
      endedAt: "2026-08-04T01:00:00Z",
    });
    expect(c?.kind).toBe("overlap");
  });

  it("excludeId ignoriert den eigenen Eintrag", () => {
    const c = findTimeConflict(
      existing,
      { startedAt: "2026-08-03T13:00:00Z", endedAt: "2026-08-03T21:00:00Z" },
      "a",
    );
    expect(c).toBeNull();
  });
});

describe("conflictMessage", () => {
  it("nennt Name und Zeitspanne", () => {
    const c = findTimeConflict(
      [span("a", "2026-08-03T13:00:00Z", "2026-08-03T21:00:00Z")],
      { startedAt: "2026-08-03T13:00:00Z", endedAt: "2026-08-03T21:00:00Z" },
    )!;
    const msg = conflictMessage(c, "Derau");
    expect(msg).toContain("Derau");
    expect(msg).toContain("15:00");
    expect(msg).toContain("23:00");
  });
});