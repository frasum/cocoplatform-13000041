// Feldkatalog & Validierung für Self-Service-Profile (SP1).
// Reine, testbare Helfer — kein DB-, Server- oder React-Import.
//
// Drei disjunkte Whitelists:
// - SELF_VIEW_FIELDS: alles, was der Mitarbeiter aus staff_personal_details sieht.
// - DIRECT_EDIT_FIELDS: darf direkt (mit Audit) geändert werden.
// - REQUEST_FIELDS: nur via Änderungsantrag mit Admin-Freigabe.
// Namensfelder (first_name/last_name) sind Pseudofelder im Antrag; sie werden
// bei Freigabe NIE automatisch auf staff geschrieben (siehe splitApplicableFields).

export const SELF_VIEW_FIELDS = [
  "salutation",
  "address",
  "phone",
  "email",
  "date_of_birth",
  "place_of_birth",
  "nationality",
  "bank_name",
  "iban",
  "account_holder",
  "social_security_number",
  "tax_id",
  "tax_class",
  "church_tax_liable",
  "konfession",
  "children_count",
  "child_tax_allowances",
  "health_insurance",
] as const;
export type SelfViewField = (typeof SELF_VIEW_FIELDS)[number];

export const DIRECT_EDIT_FIELDS = ["address", "phone", "email"] as const;
export type DirectEditField = (typeof DIRECT_EDIT_FIELDS)[number];

export const REQUEST_FIELDS = [
  "salutation",
  "date_of_birth",
  "place_of_birth",
  "nationality",
  "bank_name",
  "iban",
  "account_holder",
  "social_security_number",
  "tax_id",
  "tax_class",
  "church_tax_liable",
  "konfession",
  "children_count",
  "child_tax_allowances",
  "health_insurance",
  // Nur-Antrag-Pseudofelder — landen NICHT in staff_personal_details.
  "first_name",
  "last_name",
] as const;
export type RequestField = (typeof REQUEST_FIELDS)[number];

export const MANUAL_ONLY_FIELDS = ["first_name", "last_name"] as const;
export type ManualOnlyField = (typeof MANUAL_ONLY_FIELDS)[number];

// ------------------------------------------------------------------
// Feld-Validatoren (reine Funktionen, deutsche Fehlermeldungen).
// Rückgabe: null = ok, string = Fehlermeldung.
// ------------------------------------------------------------------

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

const TAX_CLASS_ROMAN = ["I", "II", "III", "IV", "V", "VI"] as const;

/** ISO-7064 Mod-97-Prüfung für IBAN. Erwartet bereits normalisierten String. */
function ibanMod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    let val: number;
    if (code >= 48 && code <= 57) val = code - 48;
    else if (code >= 65 && code <= 90) val = code - 55;
    else return false;
    remainder = (remainder * (val > 9 ? 100 : 10) + val) % 97;
  }
  return remainder === 1;
}

export function validateIban(v: unknown): string | null {
  if (typeof v !== "string") return "IBAN ist ungültig.";
  const s = normalizeIban(v);
  if (s.length < 15 || s.length > 34) return "IBAN-Länge ist ungültig.";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return "IBAN-Format ist ungültig.";
  if (s.startsWith("DE") && s.length !== 22) return "Deutsche IBAN muss 22 Zeichen haben.";
  if (!ibanMod97(s)) return "IBAN-Prüfsumme ist falsch.";
  return null;
}

export function validateSvNumber(v: unknown): string | null {
  if (typeof v !== "string") return "SV-Nummer ist ungültig.";
  const s = v.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{8}[A-Z]\d{3}$/.test(s)) return "SV-Nummer muss dem Format NNTTMMJJANNN entsprechen.";
  return null;
}

export function validateTaxId(v: unknown): string | null {
  if (typeof v !== "string") return "Steuer-ID ist ungültig.";
  const s = v.replace(/\s+/g, "");
  if (!/^\d{11}$/.test(s)) return "Steuer-ID muss aus 11 Ziffern bestehen.";
  if (s.startsWith("0")) return "Steuer-ID darf nicht mit 0 beginnen.";
  return null;
}

export function validateTaxClass(v: unknown): string | null {
  // Römische Persistenzform (Ergebnis der eigenen Normalisierung) direkt akzeptieren.
  if (
    typeof v === "string" &&
    (TAX_CLASS_ROMAN as readonly string[]).includes(v.trim().toUpperCase())
  ) {
    return null;
  }
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 6) return "Steuerklasse muss zwischen 1 und 6 liegen.";
  return null;
}

export function validateChildrenCount(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 20) return "Kinderzahl ist ungültig.";
  return null;
}

/** Kinderfreibeträge in halben Zählern (0, 0.5, 1, 1.5, …). */
export function validateChildTaxAllowances(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 20) return "Kinderfreibeträge sind ungültig.";
  const doubled = n * 2;
  if (!Number.isInteger(Math.round(doubled)) || Math.abs(doubled - Math.round(doubled)) > 1e-9) {
    return "Kinderfreibeträge müssen in 0,5-Schritten angegeben werden.";
  }
  return null;
}

function validateNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return "Feld darf nicht leer sein.";
  if (v.length > 200) return "Feld ist zu lang.";
  return null;
}

function validateBoolean(v: unknown): string | null {
  return typeof v === "boolean" ? null : "Wert muss true oder false sein.";
}

function validateDate(v: unknown): string | null {
  if (typeof v !== "string") return "Datum ist ungültig.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Datum muss ISO-Format JJJJ-MM-TT haben.";
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "Datum ist ungültig.";
  return null;
}

function validateEmail(v: unknown): string | null {
  if (typeof v !== "string") return "E-Mail ist ungültig.";
  const s = v.trim();
  if (s.length < 3 || s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    return "E-Mail ist ungültig.";
  }
  return null;
}

function validatePhone(v: unknown): string | null {
  if (typeof v !== "string") return "Telefonnummer ist ungültig.";
  const s = v.trim();
  if (s.length < 3 || s.length > 40) return "Telefonnummer ist ungültig.";
  if (!/^[+\d][\d\s/()-]*$/.test(s)) return "Telefonnummer enthält ungültige Zeichen.";
  return null;
}

function validateAddress(v: unknown): string | null {
  if (typeof v !== "string") return "Adresse ist ungültig.";
  const s = v.trim();
  if (s.length < 3 || s.length > 500) return "Adresse ist ungültig.";
  return null;
}

type FieldValidator = (v: unknown) => string | null;

const REQUEST_VALIDATORS: Record<RequestField, FieldValidator> = {
  salutation: validateNonEmptyString,
  date_of_birth: validateDate,
  place_of_birth: validateNonEmptyString,
  nationality: validateNonEmptyString,
  bank_name: validateNonEmptyString,
  iban: validateIban,
  account_holder: validateNonEmptyString,
  social_security_number: validateSvNumber,
  tax_id: validateTaxId,
  tax_class: validateTaxClass,
  church_tax_liable: validateBoolean,
  konfession: validateNonEmptyString,
  children_count: validateChildrenCount,
  child_tax_allowances: validateChildTaxAllowances,
  health_insurance: validateNonEmptyString,
  first_name: validateNonEmptyString,
  last_name: validateNonEmptyString,
};

const DIRECT_VALIDATORS: Record<DirectEditField, FieldValidator> = {
  address: validateAddress,
  phone: validatePhone,
  email: validateEmail,
};

export function validateDirectEditPayload(
  payload: Record<string, unknown>,
):
  | { ok: true; value: Partial<Record<DirectEditField, string>> }
  | { ok: false; errors: Record<string, string> } {
  const keys = Object.keys(payload);
  if (keys.length === 0) return { ok: false, errors: { _: "Keine Änderungen angegeben." } };
  const errors: Record<string, string> = {};
  const value: Partial<Record<DirectEditField, string>> = {};
  for (const k of keys) {
    if (!(DIRECT_EDIT_FIELDS as readonly string[]).includes(k)) {
      errors[k] = "Feld darf hier nicht geändert werden.";
      continue;
    }
    const field = k as DirectEditField;
    const err = DIRECT_VALIDATORS[field](payload[k]);
    if (err) errors[k] = err;
    else value[field] = String(payload[k]).trim();
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

export function validateChangeRequestPayload(
  payload: unknown,
):
  | { ok: true; value: Partial<Record<RequestField, unknown>> }
  | { ok: false; errors: Record<string, string> } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: { _: "Antragsdaten fehlen." } };
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return { ok: false, errors: { _: "Antrag ist leer." } };
  const errors: Record<string, string> = {};
  const value: Partial<Record<RequestField, unknown>> = {};
  for (const k of keys) {
    if (!(REQUEST_FIELDS as readonly string[]).includes(k)) {
      errors[k] = "Feld ist im Antrag nicht erlaubt.";
      continue;
    }
    const field = k as RequestField;
    const err = REQUEST_VALIDATORS[field](record[k]);
    if (err) errors[k] = err;
    else value[field] = record[k];
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * Splittet einen (bereits validierten) Antrag in die Felder, die auf
 * staff_personal_details geschrieben werden dürfen, und die reinen
 * Anzeige-Felder (first_name/last_name), die der Admin manuell übernehmen
 * muss.
 */
export function splitApplicableFields(payload: Partial<Record<RequestField, unknown>>): {
  applicable: Partial<Record<Exclude<RequestField, ManualOnlyField>, unknown>>;
  manualOnly: Partial<Record<ManualOnlyField, unknown>>;
} {
  const applicable: Record<string, unknown> = {};
  const manualOnly: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((MANUAL_ONLY_FIELDS as readonly string[]).includes(k)) manualOnly[k] = v;
    else applicable[k] = v;
  }
  return {
    applicable: applicable as Partial<Record<Exclude<RequestField, ManualOnlyField>, unknown>>,
    manualOnly: manualOnly as Partial<Record<ManualOnlyField, unknown>>,
  };
}

/** Normalisiert einen Antragswert für die Persistenz. IBAN wird groß und ohne Leerzeichen. */
export function normalizeRequestValue(field: RequestField, value: unknown): unknown {
  if (field === "iban" && typeof value === "string") return normalizeIban(value);
  if (field === "social_security_number" && typeof value === "string") {
    return value.replace(/\s+/g, "").toUpperCase();
  }
  if (field === "tax_id" && typeof value === "string") return value.replace(/\s+/g, "");
  if (field === "tax_class") {
    if (typeof value === "string") {
      const s = value.trim().toUpperCase();
      const idx = (TAX_CLASS_ROMAN as readonly string[]).indexOf(s);
      if (idx >= 0) return TAX_CLASS_ROMAN[idx];
    }
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 6 ? TAX_CLASS_ROMAN[n - 1] : null;
  }
  return value;
}
