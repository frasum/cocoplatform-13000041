import { describe, it, expect } from "vitest";
import {
  isSessionFieldEnabled,
  sessionFieldVisible,
  assertSessionFieldWritable,
  parseDisabledSessionFields,
} from "./session-fields";

describe("FS1 — Session-Feld-Sichtbarkeit", () => {
  it("aktives Feld ist sichtbar", () => {
    expect(isSessionFieldEnabled("finedine", [])).toBe(true);
    expect(sessionFieldVisible("finedine", [], false)).toBe(true);
  });

  it("deaktiviertes Feld ohne Werte ist unsichtbar", () => {
    expect(isSessionFieldEnabled("finedine", ["finedine"])).toBe(false);
    expect(sessionFieldVisible("finedine", ["finedine"], false)).toBe(false);
  });

  it("deaktiviertes Feld mit historischem Wert bleibt sichtbar", () => {
    expect(sessionFieldVisible("finedine", ["finedine"], true)).toBe(true);
  });

  it("unbekannte Schlüssel werden verworfen", () => {
    expect(parseDisabledSessionFields(["finedine", "quatsch", 7])).toEqual(["finedine"]);
    expect(parseDisabledSessionFields(null)).toEqual([]);
  });

  it("Schreibpfad: expliziter Wert ≠ 0 auf deaktiviertem Feld wird abgelehnt", () => {
    expect(() => assertSessionFieldWritable("finedine", ["finedine"], 1500)).toThrow(
      /deaktiviert/,
    );
  });

  it("Schreibpfad: 0 und fehlendes Feld sind erlaubt (Bestandswert bleibt)", () => {
    expect(() => assertSessionFieldWritable("finedine", ["finedine"], 0)).not.toThrow();
    expect(() => assertSessionFieldWritable("finedine", ["finedine"], undefined)).not.toThrow();
    expect(() => assertSessionFieldWritable("finedine", [], 1500)).not.toThrow();
  });
});