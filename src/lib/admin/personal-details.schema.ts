// Geteiltes Zod-Schema + Audit-Redaktor für staff_personal_details.
// Reines Modul — keine I/O, keine Supabase-Importe. Wird sowohl im
// Browser (Formular-Validierung) als auch in der Server-Function
// (Schreibvalidierung) verwendet.

import { z } from "zod";
import { SENSITIVE_FIELDS } from "./import-details";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Trim + leere Strings zu null normalisieren. */
const nullableText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    })
    .pipe(z.string().max(max).nullable());

/** PLZ: leer → null, sonst 4–5 Ziffern (tolerant nach trim). */
const postalCodeField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  })
  .pipe(
    z
      .string()
      .regex(/^\d{4,5}$/, "PLZ muss 4–5 Ziffern sein")
      .nullable(),
  );

const nullableDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  })
  .pipe(z.string().regex(ISO_DATE, "Datum muss YYYY-MM-DD sein").nullable());

const nullableBool = z
  .union([z.boolean(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

const nullableInt = (min: number, max: number) =>
  z
    .union([z.number(), z.null()])
    .optional()
    .transform((v) => (v === undefined ? null : v))
    .pipe(z.number().int().min(min).max(max).nullable());

const nullableDecimal = (min: number, max: number) =>
  z
    .union([z.number(), z.null()])
    .optional()
    .transform((v) => (v === undefined ? null : v))
    .pipe(z.number().min(min).max(max).nullable());

const ibanField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.replace(/\s+/g, "").toUpperCase();
    return t.length === 0 ? null : t;
  })
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/, "IBAN-Format ungültig")
      .nullable(),
  );

export const personalDetailsSchema = z.object({
  salutation: nullableText(20),
  phone: nullableText(40),
  email: nullableText(120),
  address: nullableText(500),
  street: nullableText(120),
  postal_code: postalCodeField,
  city: nullableText(120),
  date_of_birth: nullableDate,
  place_of_birth: nullableText(120),
  nationality: nullableText(60),
  tax_class: nullableText(8),
  tax_id: nullableText(20),
  social_security_number: nullableText(20),
  is_minijob: nullableBool,
  is_sv_exempt: nullableBool,
  health_insurance: nullableText(120),
  church_tax_liable: nullableBool,
  child_tax_allowances: nullableDecimal(0, 20),
  iban: ibanField,
  bank_name: nullableText(120),
  account_holder: nullableText(120),
  employment_start_date: nullableDate,
  employment_end_date: nullableDate,
  personnel_group: nullableText(60),
  job_title: nullableText(120),
  vacation_days_contractual: nullableInt(0, 365),
  vacation_days_previous_year: nullableInt(0, 365),
  vacation_days_current_year: nullableInt(0, 365),
  vacation_days_taken: nullableInt(0, 365),
});

export type PersonalDetailsInput = z.input<typeof personalDetailsSchema>;
export type PersonalDetailsFields = z.output<typeof personalDetailsSchema>;

/**
 * Sparse-Patch-Variante: validiert nur die tatsächlich mitgeschickten Felder.
 * Ausgelassene Felder bleiben ausgelassen (kein Auto-Fill mit null), damit
 * `upsert` bestehende DB-Werte NICHT auf null überschreibt.
 */
export const personalDetailsPatchSchema = personalDetailsSchema.partial().strict();
export type PersonalDetailsPatch = z.output<typeof personalDetailsPatchSchema>;

const SENSITIVE_KEYS = new Set<string>(SENSITIVE_FIELDS);

/** Erzeugt eine audit-taugliche Liste der geänderten Feldnamen.
 *  Sensible Felder werden nur als `[REDACTED]` markiert — kein Klartext. */
export function redactForAudit(
  patch: Partial<PersonalDetailsFields>,
): Record<string, "[REDACTED]" | { changed: true }> {
  const out: Record<string, "[REDACTED]" | { changed: true }> = {};
  for (const key of Object.keys(patch)) {
    out[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : { changed: true };
  }
  return out;
}
