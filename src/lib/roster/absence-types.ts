// UB1 — Abwesenheitstypen des Kalenders (`roster_absence.type`).
//
// Eine Wahrheit für Typliste, Labels und Blockier-Verhalten. Neu ist
// `urlaub_unbezahlt`: unbezahlter Urlaub (z. B. Heimaturlaub über den
// bezahlten Anspruch hinaus). Für die Planung ist die Person weg wie im
// bezahlten Urlaub — an der Bezahlung hängt kein Planungs-Sonderweg.
// Fortzahlungsrelevant ist er NICHT (siehe urlaub-krank-diagnose.ts).

export const ABSENCE_TYPES = ["urlaub", "krank", "urlaub_unbezahlt"] as const;

export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** Für `.in("type", …)`-Filter: alle im Kalender geführten Typen. */
export const ABSENCE_TYPE_FILTER: string[] = [...ABSENCE_TYPES];

export const ABSENCE_LABEL: Record<AbsenceType, string> = {
  urlaub: "Urlaub",
  krank: "Krank",
  urlaub_unbezahlt: "Urlaub (unbezahlt)",
};

export function isAbsenceType(value: unknown): value is AbsenceType {
  return typeof value === "string" && (ABSENCE_TYPES as readonly string[]).includes(value);
}

/** Unbekannte/leere Werte gelten wie bisher als `urlaub`. */
export function normalizeAbsenceType(value: unknown): AbsenceType {
  return isAbsenceType(value) ? value : "urlaub";
}

/**
 * Blockier-/Anzeige-Klasse für Pfade, die nur zwei Typen kennen (Display,
 * TRMNL, Kalender-Feed, Stempel-Warnung): unbezahlter Urlaub verhält sich
 * dort exakt wie Urlaub.
 */
export function absenceBlockingType(type: AbsenceType): "urlaub" | "krank" {
  return type === "krank" ? "krank" : "urlaub";
}

/** Nur bezahlter Urlaub ist fortzahlungsrelevant. */
export function isPaidVacation(type: AbsenceType): boolean {
  return type === "urlaub";
}
