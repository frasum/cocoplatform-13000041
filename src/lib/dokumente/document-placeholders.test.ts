import { describe, it, expect } from "vitest";
import {
  buildPlaceholderData,
  fillTemplate,
  listPlaceholdersInTemplate,
  type PlaceholderInput,
} from "./document-placeholders";

const baseInput: PlaceholderInput = {
  staff: { first_name: "Anna", last_name: "Müller" },
  details: {
    salutation: "Frau",
    date_of_birth: "1995-03-07",
    place_of_birth: "Berlin",
    nationality: "deutsch",
    address: "Musterstr. 1, 10115 Berlin",
    social_security_number: "12 345678 A 901",
    tax_id: "12345678901",
    tax_class: "1",
    health_insurance: "TK",
    employment_start_date: "2026-07-01",
    iban: "DE00 0000",
  },
  compensation: { wage_text: "13,50 €/h", contracted_hours_per_month: 130 },
  organization: {
    arbeitgeber_name: "SORN GmbH",
    arbeitgeber_adresse: "Hauptstr. 2",
    arbeitgeber_vertreter: "F. Wirt",
  },
  location: { name: "SORN" },
  today: "2026-07-03",
};

describe("buildPlaceholderData", () => {
  it("übernimmt den Lohntext und formatiert Datum als dd.MM.yyyy", () => {
    const d = buildPlaceholderData(baseInput);
    expect(d.stundenlohn).toBe("13,50 €/h");
    expect(d.geburtsdatum).toBe("07.03.1995");
    expect(d.eintrittsdatum).toBe("01.07.2026");
    expect(d.heute).toBe("03.07.2026");
    expect(d.monatsstunden).toBe("130");
  });

  it("lässt fehlende Werte weg (kein leerer String im Record)", () => {
    const d = buildPlaceholderData({
      ...baseInput,
      details: { ...baseInput.details, social_security_number: null, tax_id: "" },
      compensation: null,
      location: { name: "  " },
    });
    expect("sv_nummer" in d).toBe(false);
    expect("steuer_id" in d).toBe(false);
    expect("stundenlohn" in d).toBe(false);
    expect("standort" in d).toBe(false);
  });
});

describe("fillTemplate", () => {
  it("ersetzt bekannte Platzhalter, listet fehlende als unresolved", () => {
    const data = buildPlaceholderData(baseInput);
    const r = fillTemplate("Hallo {{vorname}} {{nachname}}, IBAN {{iban}}.", data);
    expect(r.text).toBe("Hallo Anna Müller, IBAN DE00 0000.");
    expect(r.unresolved).toEqual([]);
  });

  it("belässt fehlenden Platzhalter im Text und listet ihn", () => {
    const data = buildPlaceholderData({ ...baseInput, details: null });
    const r = fillTemplate("Geboren am {{geburtsdatum}} in {{geburtsort}}.", data);
    expect(r.text).toContain("{{geburtsdatum}}");
    expect(r.unresolved).toEqual(["geburtsdatum", "geburtsort"]);
  });

  it("dedupliziert unresolved in Auftretensreihenfolge", () => {
    const r = fillTemplate("{{foo}} {{bar}} {{foo}} {{baz}} {{bar}}", {});
    expect(r.unresolved).toEqual(["foo", "bar", "baz"]);
  });

  it("erkennt unbekannte Platzhalter", () => {
    const r = fillTemplate("Test {{unknown_key}}.", { vorname: "X" });
    expect(r.unresolved).toEqual(["unknown_key"]);
    expect(r.text).toBe("Test {{unknown_key}}.");
  });
});

describe("listPlaceholdersInTemplate", () => {
  it("liefert deduplizierte Keys in Reihenfolge", () => {
    expect(listPlaceholdersInTemplate("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });
});
