// V1 Dokumentengenerierung — pure Platzhalter-Engine.
//
// Kein I/O, kein `new Date()` im Kern: `today` wird injiziert (Testbarkeit).
// Fehlende / leere Datenfelder werden NICHT als leerer String eingesetzt,
// sondern lassen den Platzhalter im Text sichtbar (und listen ihn als
// unresolved). Cents → "13,50 €"; Datum "1995-03-07" → "07.03.1995".
//
// DL2 — zwei Platzhalter-Kategorien:
//   * "stammdaten" (Default): kommt aus DB-Daten (staff/details/org/location).
//   * "vorgang": gehört zum Einzelfall, nicht zur Person (z. B. Fehltag einer
//     Abmahnung). Wird beim Generieren im Dialog erfasst und als Wert in die
//     Auflösung injiziert. Der Kern bleibt pure — keine Eingabe-Logik hier.

export type PlaceholderKey =
  | "vorname"
  | "nachname"
  | "anrede"
  | "geburtsdatum"
  | "geburtsort"
  | "nationalitaet"
  | "adresse"
  | "sv_nummer"
  | "steuer_id"
  | "steuerklasse"
  | "krankenkasse"
  | "eintrittsdatum"
  | "iban"
  | "stundenlohn"
  | "wochenstunden"
  | "monatsstunden"
  | "arbeitgeber_name"
  | "arbeitgeber_adresse"
  | "arbeitgeber_vertreter"
  | "standort"
  | "heute"
  | "fehltag";

export type PlaceholderCategory = "stammdaten" | "vorgang";
export type PlaceholderInputKind = "date" | "text";

export type PlaceholderCatalogEntry = {
  key: PlaceholderKey;
  label: string;
  description: string;
  /** Default "stammdaten", wenn nicht gesetzt. */
  category?: PlaceholderCategory;
  /** Nur für Kategorie "vorgang" relevant; Default "text". */
  input?: PlaceholderInputKind;
};

export const PLACEHOLDER_CATALOG = [
  { key: "vorname", label: "Vorname", description: "Vorname des Mitarbeiters" },
  { key: "nachname", label: "Nachname", description: "Nachname des Mitarbeiters" },
  { key: "anrede", label: "Anrede", description: "Anrede (Herr/Frau)" },
  { key: "geburtsdatum", label: "Geburtsdatum", description: "Geburtsdatum, dd.MM.yyyy" },
  { key: "geburtsort", label: "Geburtsort", description: "Geburtsort" },
  { key: "nationalitaet", label: "Nationalität", description: "Nationalität" },
  { key: "adresse", label: "Adresse", description: "Wohnadresse des Mitarbeiters" },
  { key: "sv_nummer", label: "SV-Nummer", description: "Sozialversicherungsnummer" },
  { key: "steuer_id", label: "Steuer-ID", description: "Steuer-Identifikationsnummer" },
  { key: "steuerklasse", label: "Steuerklasse", description: "Lohnsteuerklasse" },
  { key: "krankenkasse", label: "Krankenkasse", description: "Gesetzliche Krankenkasse" },
  {
    key: "eintrittsdatum",
    label: "Eintrittsdatum",
    description: "Beschäftigungsbeginn, dd.MM.yyyy",
  },
  { key: "iban", label: "IBAN", description: "IBAN des Mitarbeiters" },
  {
    key: "stundenlohn",
    label: "Stundenlohn",
    description:
      "Brutto-Stundenlohn; bei mehreren Arbeitsbereichen je Bereich, z. B. „je nach Einsatzbereich: Service 14,50 €/h · Küche 15,00 €/h“",
  },
  { key: "wochenstunden", label: "Wochenstunden", description: "Vereinbarte Wochenstunden" },
  { key: "monatsstunden", label: "Monatsstunden", description: "Vereinbarte Monatsstunden" },
  { key: "arbeitgeber_name", label: "Arbeitgeber", description: "Firmenname des Arbeitgebers" },
  {
    key: "arbeitgeber_adresse",
    label: "Arbeitgeber-Adresse",
    description: "Anschrift des Arbeitgebers",
  },
  {
    key: "arbeitgeber_vertreter",
    label: "Vertreter",
    description: "Vertretungsberechtigte Person",
  },
  { key: "standort", label: "Standort", description: "Name des Haupt-Standorts (falls eindeutig)" },
  { key: "heute", label: "Heutiges Datum", description: "Aktuelles Datum, dd.MM.yyyy" },
  {
    key: "fehltag",
    label: "Fehltag",
    description: "Datum des unentschuldigten Fehlens — Eingabe beim Generieren, dd.MM.yyyy",
    category: "vorgang",
    input: "date",
  },
] as const satisfies ReadonlyArray<PlaceholderCatalogEntry>;

export function placeholderCategory(entry: PlaceholderCatalogEntry): PlaceholderCategory {
  return entry.category ?? "stammdaten";
}

/** Alle Vorgangs-Platzhalter des Katalogs (Reihenfolge = Katalog-Reihenfolge). */
export const VORGANG_PLACEHOLDERS: ReadonlyArray<PlaceholderCatalogEntry> =
  PLACEHOLDER_CATALOG.filter((p) => placeholderCategory(p) === "vorgang");

/** Vorgangs-Platzhalter, die im übergebenen Template-Text vorkommen. */
export function vorgangPlaceholdersInTemplate(
  content: string,
): ReadonlyArray<PlaceholderCatalogEntry> {
  const used = new Set(listPlaceholdersInTemplate(content));
  return VORGANG_PLACEHOLDERS.filter((p) => used.has(p.key));
}

/**
 * Formatiert erfasste Vorgangswerte für die Auflösung. Datums-Platzhalter
 * kommen als ISO ("2026-07-18") und werden zu "18.07.2026". Leere oder
 * unparsbare Werte landen in `missing` (→ Aufrufer blockiert das Generieren).
 */
export function resolveVorgangValues(
  raw: Readonly<Record<string, string | null | undefined>>,
  required: ReadonlyArray<PlaceholderCatalogEntry>,
): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const entry of required) {
    const v = nonEmpty(raw[entry.key]);
    if (v === null) {
      missing.push(entry.key);
      continue;
    }
    if ((entry.input ?? "text") === "date") {
      const formatted = formatDateDe(v);
      if (formatted === null) {
        missing.push(entry.key);
        continue;
      }
      values[entry.key] = formatted;
      continue;
    }
    values[entry.key] = v;
  }
  return { values, missing };
}

function formatDateDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Erwartet "YYYY-MM-DD" (oder ISO-Datetime) — nur die ersten 10 Zeichen zählen.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatEuroFromCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return null;
  const euros = cents / 100;
  return (
    euros.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
  );
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export type PlaceholderInput = {
  staff: {
    first_name: string | null;
    last_name: string | null;
  };
  details: {
    salutation?: string | null;
    date_of_birth?: string | null;
    place_of_birth?: string | null;
    nationality?: string | null;
    address?: string | null;
    social_security_number?: string | null;
    tax_id?: string | null;
    tax_class?: string | null;
    health_insurance?: string | null;
    employment_start_date?: string | null;
    iban?: string | null;
  } | null;
  compensation: {
    wage_text?: string | null;
    contracted_hours_per_month?: number | null;
  } | null;
  organization: {
    arbeitgeber_name?: string | null;
    arbeitgeber_adresse?: string | null;
    arbeitgeber_vertreter?: string | null;
  } | null;
  location: { name?: string | null } | null;
  today: string; // ISO YYYY-MM-DD; injiziert vom Aufrufer
  /** DL2 — bereits formatierte Vorgangswerte (siehe resolveVorgangValues). */
  vorgang?: Readonly<Record<string, string>>;
};

export function buildPlaceholderData(input: PlaceholderInput): Record<string, string> {
  const out: Partial<Record<PlaceholderKey, string>> = {};
  const put = (k: PlaceholderKey, v: string | null) => {
    if (v !== null) out[k] = v;
  };

  put("vorname", nonEmpty(input.staff.first_name));
  put("nachname", nonEmpty(input.staff.last_name));

  const d = input.details;
  put("anrede", nonEmpty(d?.salutation));
  put("geburtsdatum", formatDateDe(d?.date_of_birth ?? null));
  put("geburtsort", nonEmpty(d?.place_of_birth));
  put("nationalitaet", nonEmpty(d?.nationality));
  put("adresse", nonEmpty(d?.address));
  put("sv_nummer", nonEmpty(d?.social_security_number));
  put("steuer_id", nonEmpty(d?.tax_id));
  put("steuerklasse", nonEmpty(d?.tax_class));
  put("krankenkasse", nonEmpty(d?.health_insurance));
  put("eintrittsdatum", formatDateDe(d?.employment_start_date ?? null));
  put("iban", nonEmpty(d?.iban));

  const c = input.compensation;
  put("stundenlohn", nonEmpty(c?.wage_text));
  const monthly = c?.contracted_hours_per_month ?? null;
  if (monthly !== null && monthly !== undefined && !Number.isNaN(monthly)) {
    out.monatsstunden = String(monthly);
    // Konvention: Wochenstunden = Monatsstunden / 4,33 (gerundet auf 0,5).
    const weekly = Math.round((monthly / 4.33) * 2) / 2;
    out.wochenstunden = weekly.toLocaleString("de-DE");
  }

  const org = input.organization;
  put("arbeitgeber_name", nonEmpty(org?.arbeitgeber_name));
  put("arbeitgeber_adresse", nonEmpty(org?.arbeitgeber_adresse));
  put("arbeitgeber_vertreter", nonEmpty(org?.arbeitgeber_vertreter));

  put("standort", nonEmpty(input.location?.name));
  put("heute", formatDateDe(input.today));

  const merged: Record<string, string> = { ...(out as Record<string, string>) };
  for (const [k, v] of Object.entries(input.vorgang ?? {})) {
    const clean = nonEmpty(v);
    if (clean !== null) merged[k] = clean;
  }
  return merged;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function fillTemplate(
  content: string,
  data: Record<string, string>,
): { text: string; unresolved: string[] } {
  const unresolvedOrder: string[] = [];
  const seen = new Set<string>();
  const text = content.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return data[key];
    }
    if (!seen.has(key)) {
      seen.add(key);
      unresolvedOrder.push(key);
    }
    return match;
  });
  return { text, unresolved: unresolvedOrder };
}

export function listPlaceholdersInTemplate(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(PLACEHOLDER_RE)) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
