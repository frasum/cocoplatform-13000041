import { describe, it, expect, beforeAll } from "vitest";
import { buildBargeldXlsx, bargeldFromRowCents, assertBargeldFormula } from "./bargeld-export";
import type { CashDailyRow } from "./cash.functions";

// EX2 — Fixture mit echten Juli-Beispielwerten (01.07. ⇒ −384,23 €).
const july01: CashDailyRow = {
  businessDate: "2026-07-01",
  tagesumsatzCents: 314520,
  kreditkartenCents: 289743,
  deliverySouseCents: 0,
  deliveryVectronCents: 0,
  deliveryWoltCents: 21000,
  finedineCents: 0,
  vouchersRedeemedCents: 0,
  vouchersSoldCents: 0,
  einladungCents: 0,
  openInvoicesCents: 0,
  vorschussCents: 0,
  expensesCents: 42200,
  sonstigeEinnahmeCents: 0,
  bargeldCents: -38423,
  tipRemainderCents: 0,
};

const july02: CashDailyRow = { ...july01, businessDate: "2026-07-02" };

describe("buildBargeldXlsx", () => {
  // XL1 — `buildBargeldXlsx` lädt exceljs per dynamischem Import erst beim
  // Aufruf. Das erstmalige Auflösen des Pakets dauert in langsamen Sandboxes
  // länger als das 5-s-Testlimit und hat den Test dreimal fälschlich rot
  // gemeldet (§109). Das Paket wird deshalb einmal vorgeladen — mit eigenem,
  // großzügigem Limit.
  beforeAll(async () => {
    await import("exceljs");
  }, 30_000);

  it("erzeugt einen nicht-leeren Blob mit einem Blatt je Standort", async () => {
    const blob = await buildBargeldXlsx([
      { locationName: "spicery", rows: [july01, july02] },
      { locationName: "YUM", rows: [july01] },
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain("spreadsheetml");
  });

  it("Formeltreue: Bargeld ergibt sich aus den Zeilenspalten (01.07. = −384,23)", () => {
    expect(bargeldFromRowCents(july01)).toBe(-38423);
    expect(() => assertBargeldFormula([july01], "spicery")).not.toThrow();
  });

  it("blockiert bei Formelverletzung", () => {
    expect(() => assertBargeldFormula([{ ...july01, bargeldCents: 0 }], "spicery")).toThrow(
      /Formeltreue verletzt/,
    );
  });
});
