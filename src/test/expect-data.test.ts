import { describe, it, expect } from "vitest";
import { expectData } from "./expect-data";

describe("expectData (DB1-A Helfer)", () => {
  it("gibt data unverändert zurück, wenn error === null", () => {
    const row = { id: "x", name: "n" };
    const out = expectData({ data: row, error: null }, "sessions insert (unit)");
    expect(out).toBe(row);
  });

  it("wirft bei gesetztem error und die echte Meldung steht im Text", () => {
    expect(() =>
      expectData(
        { data: null, error: { message: "duplicate key value violates unique constraint" } },
        "sessions insert (unit)",
      ),
    ).toThrow(/duplicate key value violates unique constraint/);
  });

  it("wirft, wenn data === null und error === null (maybeSingle-Fall)", () => {
    expect(() => expectData({ data: null, error: null }, "sessions insert (unit)")).toThrow(
      /lieferte keine Zeile/,
    );
  });

  it("das übergebene Label steht in beiden Fehlermeldungen", () => {
    const label = "payment_terminals insert (unit)";
    expect(() => expectData({ data: null, error: { message: "boom" } }, label)).toThrow(label);
    expect(() => expectData({ data: null, error: null }, label)).toThrow(label);
  });

  it("hängt code/details/hint an, wenn vorhanden — und fehlt sauber, wenn nicht", () => {
    try {
      expectData(
        {
          data: null,
          error: {
            message: "relation missing",
            code: "42P01",
            details: "no such table",
            hint: "reload schema",
          },
        },
        "sessions insert (unit)",
      );
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("relation missing");
      expect(msg).toContain("code=42P01");
      expect(msg).toContain("details=no such table");
      expect(msg).toContain("hint=reload schema");
    }

    try {
      expectData({ data: null, error: { message: "plain" } }, "sessions insert (unit)");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("plain");
      expect(msg).not.toContain("code=");
      expect(msg).not.toContain("details=");
      expect(msg).not.toContain("hint=");
    }
  });
});
