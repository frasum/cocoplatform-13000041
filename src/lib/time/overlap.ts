// ZS1 — Überlappungs-Guard für Zeiteinträge (reines Modul).
//
// Gerechnet wird auf echten Zeitstempeln (Date/ISO), NICHT auf
// Uhrzeit-Strings. Damit fallen Mitternachts-Schichten (23:00–02:00)
// automatisch korrekt aus.
//
// Intervalle sind halb-offen [start, end): Ende == Anfang der Folgeschicht
// ist KEINE Überlappung — getrennte Doppelschichten am selben Tag bleiben
// erlaubt.

export type TimeSpan = {
  id: string;
  startedAt: string;
  endedAt: string | null;
};

export type ConflictKind = "identical" | "overlap";

export type TimeConflict = {
  kind: ConflictKind;
  entry: TimeSpan;
};

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Halb-offene Überlappung zweier Intervalle. Offenes Ende (null) zählt als „läuft noch". */
export function overlaps(
  a: { startedAt: string; endedAt: string | null },
  b: { startedAt: string; endedAt: string | null },
): boolean {
  const aStart = ms(a.startedAt);
  const bStart = ms(b.startedAt);
  const aEnd = a.endedAt === null ? Number.POSITIVE_INFINITY : ms(a.endedAt);
  const bEnd = b.endedAt === null ? Number.POSITIVE_INFINITY : ms(b.endedAt);
  return aStart < bEnd && bStart < aEnd;
}

function isIdentical(
  a: { startedAt: string; endedAt: string | null },
  b: { startedAt: string; endedAt: string | null },
): boolean {
  const sameStart = ms(a.startedAt) === ms(b.startedAt);
  const sameEnd =
    a.endedAt === null || b.endedAt === null
      ? a.endedAt === b.endedAt
      : ms(a.endedAt) === ms(b.endedAt);
  return sameStart && sameEnd;
}

/**
 * Findet den ersten Konflikt des Kandidaten mit bestehenden Einträgen
 * derselben Person. `excludeId` schließt den eigenen Eintrag beim
 * Bearbeiten aus.
 */
export function findTimeConflict(
  existing: TimeSpan[],
  candidate: { startedAt: string; endedAt: string | null },
  excludeId?: string,
): TimeConflict | null {
  for (const e of existing) {
    if (excludeId && e.id === excludeId) continue;
    if (isIdentical(e, candidate)) return { kind: "identical", entry: e };
  }
  for (const e of existing) {
    if (excludeId && e.id === excludeId) continue;
    if (overlaps(e, candidate)) return { kind: "overlap", entry: e };
  }
  return null;
}

function hhmm(iso: string | null): string {
  if (!iso) return "offen";
  // Europe/Berlin — gleiche Zone wie die gesamte Zeiterfassung.
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function conflictMessage(conflict: TimeConflict, staffName: string): string {
  const span = `${hhmm(conflict.entry.startedAt)}–${hhmm(conflict.entry.endedAt)}`;
  if (conflict.kind === "identical") {
    return `Für ${staffName} existiert an diesem Tag bereits ein Eintrag ${span}.`;
  }
  return `Für ${staffName} überlappt dieser Eintrag mit einem bestehenden Eintrag ${span}. Getrennte Doppelschichten sind möglich, Überlappungen nicht.`;
}