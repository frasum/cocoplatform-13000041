// ST1-B — Bereichs-Sätze einer Person am Stichtag, formatiert für den
// Vertragsbaustein. Bauherren-Entscheid §116: mehrsätzig, personenbezogen.
//
// Auflösungsregel je Bereich = dieselbe wie überall (KGL):
// jüngstes valid_from <= Stichtag gewinnt; kein Bereichs-Fallback;
// Bereich ohne gültige Zeile erscheint NICHT (er ist nicht vereinbart).

import { resolveRateCents, type RateRow } from "@/lib/lohn/rate-resolution";
import type { Department } from "@/lib/time/primary-department";
import { formatEuroFromCents } from "./document-placeholders";

export const DEPT_LABEL_DE: Record<Department, string> = {
  service: "Service",
  kitchen: "Küche",
  gl: "Geschäftsleitung",
};

/** Feste, lesbare Reihenfolge im Vertragstext. */
export const DEPT_ORDER: readonly Department[] = ["service", "kitchen", "gl"];

export type WageLine = { department: Department; label: string; rateCents: number };

export function resolveWageLines(rates: readonly RateRow[], onDate: string): WageLine[] {
  const out: WageLine[] = [];
  for (const dept of DEPT_ORDER) {
    const cents = resolveRateCents(rates, dept, onDate);
    if (cents !== null)
      out.push({ department: dept, label: DEPT_LABEL_DE[dept], rateCents: cents });
  }
  return out;
}

/**
 * "14,50 €/h" bzw. mehrsätzig
 * "je nach Einsatzbereich: Service 14,50 €/h · Küche 15,00 €/h".
 * Leere Liste → null (Platzhalter bleibt unresolved — V1-Semantik).
 */
export function formatWageLines(lines: readonly WageLine[]): string | null {
  if (lines.length === 0) return null;
  const amount = (cents: number) => `${formatEuroFromCents(cents) ?? ""}/h`;
  if (lines.length === 1) return amount(lines[0].rateCents);
  return (
    "je nach Einsatzbereich: " +
    lines.map((l) => `${l.label} ${amount(l.rateCents)}`).join(" · ")
  );
}
