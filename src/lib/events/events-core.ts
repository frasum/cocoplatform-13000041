// EV1-R1 — Kern-Typen und reine Helfer der Events-Tabelle.
//
// Die Tabelle `public.events` ist zugleich die vorgezogene PG0-Events-Tabelle
// der Prognose-Serie (eine Tabelle, zwei Verbraucher). Deshalb leben Mapping
// und Schlüsselbildung hier headless — testbar ohne Browser und ohne DB.

export const EVENT_IMPACTS = ["sehr_hoch", "hoch", "mittel_hoch", "mittel"] as const;

export type EventImpact = (typeof EVENT_IMPACTS)[number];

export type EventRow = {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  locationText: string | null;
  distanceText: string | null;
  impact: EventImpact;
  recommendation: string | null;
  source: string | null;
  provisional: boolean;
};

export const IMPACT_LABEL: Record<EventImpact, string> = {
  sehr_hoch: "Sehr hoch",
  hoch: "Hoch",
  mittel_hoch: "Mittel-Hoch",
  mittel: "Mittel",
};

export function isEventImpact(value: unknown): value is EventImpact {
  return typeof value === "string" && (EVENT_IMPACTS as readonly string[]).includes(value);
}

/**
 * Impact-Mapping, tolerant gegen Groß-/Kleinschreibung, Bindestrich,
 * Unterstrich und Mehrfach-Leerzeichen. Unbekannte Werte ergeben `null` —
 * der Aufrufer listet die Zeile als Fehler, es wird NICHT geraten.
 */
export function mapImpact(raw: unknown): EventImpact | null {
  if (raw === null || raw === undefined) return null;
  const norm = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ")
    .trim();
  if (norm === "sehr hoch") return "sehr_hoch";
  if (norm === "hoch") return "hoch";
  if (norm === "mittel hoch") return "mittel_hoch";
  if (norm === "mittel") return "mittel";
  return null;
}

/** Idempotenz-Schlüssel (F10): Name (getrimmt) + Von-Datum. */
export function importKey(name: string, dateFrom: string): string {
  return `${name.trim()}\u0000${dateFrom}`;
}

export type ExistingEventKey = {
  id: string;
  name: string;
  dateFrom: string;
};

export type TermChangeHint = {
  /** Name der Import-Zeile. */
  name: string;
  /** Von-Datum der Import-Zeile (neuer Termin). */
  dateFrom: string;
  /** Bestandszeile im selben Kalenderjahr mit ANDEREM Von-Datum. */
  existingId: string;
  existingDateFrom: string;
};

/**
 * Erkennt mögliche Terminwechsel: eine Import-Zeile, deren Schlüssel
 * (Name + Von-Datum) NICHT existiert, deren Name aber im selben Kalenderjahr
 * bereits mit einem anderen Von-Datum in der Tabelle steht.
 *
 * Reine Anzeige-Information — der Upsert löscht NICHTS, die Entscheidung
 * trifft der Bauherr per CRUD.
 */
export function detectTermChanges(
  incoming: readonly { name: string; dateFrom: string }[],
  existing: readonly ExistingEventKey[],
): TermChangeHint[] {
  const exactKeys = new Set(existing.map((e) => importKey(e.name, e.dateFrom)));
  const hints: TermChangeHint[] = [];
  for (const row of incoming) {
    const name = row.name.trim();
    if (exactKeys.has(importKey(name, row.dateFrom))) continue;
    const year = row.dateFrom.slice(0, 4);
    const match = existing.find(
      (e) =>
        e.name.trim().toLowerCase() === name.toLowerCase() &&
        e.dateFrom.slice(0, 4) === year &&
        e.dateFrom !== row.dateFrom,
    );
    if (!match) continue;
    hints.push({
      name,
      dateFrom: row.dateFrom,
      existingId: match.id,
      existingDateFrom: match.dateFrom,
    });
  }
  return hints;
}