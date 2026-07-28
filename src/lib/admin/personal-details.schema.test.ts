import { describe, it, expect } from "vitest";
import { personalDetailsSchema, redactForAudit } from "./personal-details.schema";

describe("personalDetailsSchema", () => {
  it("normalisiert leere Strings zu null", () => {
    const r = personalDetailsSchema.parse({ phone: "  ", email: "" });
    expect(r.phone).toBeNull();
    expect(r.email).toBeNull();
  });

  it("akzeptiert gültige IBAN (mit Leerzeichen, kleingeschrieben)", () => {
    const r = personalDetailsSchema.parse({ iban: "de89 3704 0044 0532 0130 00" });
    expect(r.iban).toBe("DE89370400440532013000");
  });

  it("lehnt ungültige IBAN ab", () => {
    expect(() => personalDetailsSchema.parse({ iban: "ABC" })).toThrow();
  });

  it("validiert ISO-Datum", () => {
    expect(() => personalDetailsSchema.parse({ date_of_birth: "1.1.2000" })).toThrow();
    const r = personalDetailsSchema.parse({ date_of_birth: "2000-01-01" });
    expect(r.date_of_birth).toBe("2000-01-01");
  });

  it("Urlaubstage müssen im Bereich liegen", () => {
    expect(() => personalDetailsSchema.parse({ vacation_days_taken: -1 })).toThrow();
    expect(() => personalDetailsSchema.parse({ vacation_days_taken: 400 })).toThrow();
  });

  // KR1 ② — tax_class Härtung (COCO-9-Nachwehe).
  describe("tax_class Härtung", () => {
    it("akzeptiert I–VI (case/whitespace-tolerant)", () => {
      for (const roman of ["I", "II", "III", "IV", "V", "VI"]) {
        expect(personalDetailsSchema.parse({ tax_class: roman }).tax_class).toBe(roman);
        expect(personalDetailsSchema.parse({ tax_class: roman.toLowerCase() }).tax_class).toBe(
          roman,
        );
        expect(personalDetailsSchema.parse({ tax_class: `  ${roman}  ` }).tax_class).toBe(roman);
      }
    });
    it("akzeptiert 1–6 (Zahl und Ziffernstring) und mappt auf I–VI", () => {
      for (let i = 1; i <= 6; i++) {
        const roman = ["I", "II", "III", "IV", "V", "VI"][i - 1];
        expect(personalDetailsSchema.parse({ tax_class: i }).tax_class).toBe(roman);
        expect(personalDetailsSchema.parse({ tax_class: String(i) }).tax_class).toBe(roman);
      }
    });
    it("„" + "" + "" + "" + "" + "" + "" + "" + "" + "" + "→ null (leer, whitespace, null)", () => {
      expect(personalDetailsSchema.parse({ tax_class: "" }).tax_class).toBeNull();
      expect(personalDetailsSchema.parse({ tax_class: "   " }).tax_class).toBeNull();
      expect(personalDetailsSchema.parse({ tax_class: null }).tax_class).toBeNull();
    });
    it("lehnt Freitext und außerhalb 1–6 ab", () => {
      expect(() => personalDetailsSchema.parse({ tax_class: "VII" })).toThrow();
      expect(() => personalDetailsSchema.parse({ tax_class: "0" })).toThrow();
      expect(() => personalDetailsSchema.parse({ tax_class: 7 })).toThrow();
      expect(() => personalDetailsSchema.parse({ tax_class: "abc" })).toThrow();
    });
  });

  // AV1a Stufe 1 — Adress-Aufspaltung.
  it("PLZ akzeptiert 4 und 5 Ziffern, lehnt 3 und Buchstaben ab, leer → null", () => {
    expect(personalDetailsSchema.parse({ postal_code: "12345" }).postal_code).toBe("12345");
    expect(personalDetailsSchema.parse({ postal_code: "1234" }).postal_code).toBe("1234");
    expect(personalDetailsSchema.parse({ postal_code: "  67890  " }).postal_code).toBe("67890");
    expect(personalDetailsSchema.parse({ postal_code: "" }).postal_code).toBeNull();
    expect(personalDetailsSchema.parse({ postal_code: "   " }).postal_code).toBeNull();
    expect(() => personalDetailsSchema.parse({ postal_code: "123" })).toThrow();
    expect(() => personalDetailsSchema.parse({ postal_code: "abcde" })).toThrow();
  });

  it("Straße/Ort: trim, leer → null, max-Länge", () => {
    const r = personalDetailsSchema.parse({ street: "  Beispielweg 1  ", city: "" });
    expect(r.street).toBe("Beispielweg 1");
    expect(r.city).toBeNull();
    expect(() => personalDetailsSchema.parse({ city: "x".repeat(121) })).toThrow();
  });

  it("Bestands-Regression: alle heute vorhandenen Felder passieren das Schema", () => {
    const full = {
      salutation: "Herr",
      phone: "0151 1234567",
      email: "test@example.com",
      address: "Alte Adresse 3",
      street: "Neue Straße 1",
      postal_code: "12345",
      city: "Berlin",
      date_of_birth: "1990-05-01",
      place_of_birth: "Berlin",
      nationality: "DE",
      tax_class: "I",
      tax_id: "12345678901",
      social_security_number: "12345678A001",
      is_minijob: false,
      is_sv_exempt: null,
      health_insurance: "TK",
      church_tax_liable: false,
      child_tax_allowances: 0,
      iban: "DE89370400440532013000",
      bank_name: "Musterbank",
      account_holder: "Max Mustermann",
      employment_start_date: "2024-01-01",
      employment_end_date: null,
      personnel_group: "Küche",
      job_title: "Koch",
      vacation_days_contractual: 28,
      vacation_days_previous_year: 2,
      vacation_days_current_year: 28,
      vacation_days_taken: 5,
    } as const;
    const parsed = personalDetailsSchema.parse(full);
    // Alle Eingabe-Keys müssen im Output erhalten sein.
    for (const k of Object.keys(full)) {
      expect(Object.prototype.hasOwnProperty.call(parsed, k)).toBe(true);
    }
    expect(parsed.street).toBe("Neue Straße 1");
    expect(parsed.postal_code).toBe("12345");
    expect(parsed.city).toBe("Berlin");
  });
});

describe("redactForAudit", () => {
  it("maskiert sensible Felder, lässt andere als geändert markiert", () => {
    const out = redactForAudit({
      iban: "DE89370400440532013000",
      tax_id: "12345678901",
      social_security_number: "12345678A001",
      phone: "0151 1234567",
      bank_name: "Sparkasse",
    });
    expect(out.iban).toBe("[REDACTED]");
    expect(out.tax_id).toBe("[REDACTED]");
    expect(out.social_security_number).toBe("[REDACTED]");
    expect(out.phone).toEqual({ changed: true });
    expect(out.bank_name).toEqual({ changed: true });
  });

  it("leerer Patch → leeres Audit-Objekt", () => {
    expect(redactForAudit({})).toEqual({});
  });
});
