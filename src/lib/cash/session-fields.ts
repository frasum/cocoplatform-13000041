// FS1 — Session-Feld-Sichtbarkeit je Standort.
//
// „Finedine-Gutscheine" ist ein SESSION-FELD (feste Eingabemaske), KEIN
// Katalog-Kanal (KGL: keine zweite Wahrheit). Standorte, die ein Feld nie
// nutzen, schalten es über `locations.disabled_session_fields` ab. Maske,
// Export und Druck folgen GENAU dieser einen Wahrheit.
//
// Deaktivierung wirkt AB JETZT, nicht rückwirkend: historische Werte bleiben
// lesbar und sichtbar (siehe `sessionFieldVisible`).

export const SESSION_FIELD_KEYS = ["finedine"] as const;
export type SessionFieldKey = (typeof SESSION_FIELD_KEYS)[number];

export const SESSION_FIELD_LABELS: Record<SessionFieldKey, string> = {
  finedine: "Finedine-Gutscheine",
};

/** Rohwert aus der DB (text[]) in bekannte Schlüssel filtern. */
export function parseDisabledSessionFields(raw: unknown): SessionFieldKey[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(SESSION_FIELD_KEYS);
  return raw.filter((v): v is SessionFieldKey => typeof v === "string" && known.has(v));
}

/** Feld am Standort aktiv? (Eingabemaske, Schreibpfad) */
export function isSessionFieldEnabled(
  key: SessionFieldKey,
  disabled: readonly string[] | undefined | null,
): boolean {
  return !(disabled ?? []).includes(key);
}

/**
 * Sichtbarkeit in Export/Druck: aktives Feld immer; deaktiviertes Feld nur,
 * wenn im betrachteten Zeitraum ein HISTORISCHER Wert ≠ 0 liegt — kein Geld
 * verstecken.
 */
export function sessionFieldVisible(
  key: SessionFieldKey,
  disabled: readonly string[] | undefined | null,
  hasHistoricalValue: boolean,
): boolean {
  return isSessionFieldEnabled(key, disabled) || hasHistoricalValue;
}