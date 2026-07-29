import { describe, it, expect, beforeAll } from "vitest";
import { buildBargeldXlsx } from "./bargeld-export";
import type { CashDailyRow } from "./cash.functions";

const row: CashDailyRow = {
  businessDate: "2026-06-02",
  tagesumsatzCents: 595250,
  kreditkartenCents: 560647,
  deliverySouseCents: 0,
  deliveryVectronCents: 0,
  deliveryWoltCents: 28360,
  finedineCents: 0,
  vouchersRedeemedCents: 10000,
  vouchersSoldCents: 0,
  einladungCents: 0,
  openInvoicesCents: 0,
  vorschussCents: 0,
  expensesCents: 3971,
  sonstigeEinnahmeCents: 0,
  bargeldCents: 16040,
  tipRemainderCents: 0,
};

describe("buildBargeldXlsx", () => {
  // XL1 — `buildBargeldXlsx` lädt exceljs per dynamischem Import erst beim
  // Aufruf. Das erstmalige Auflösen des Pakets dauert in langsamen Sandboxes
  // länger als das 5-s-Testlimit und hat den Test dreimal fälschlich rot
  // gemeldet (§109). Das Paket wird deshalb einmal vorgeladen — mit eigenem,
  // großzügigem Limit. Der Testkörper behält seine 5 s, damit eine echte
  // Verlangsamung der Export-Logik weiterhin auffällt.
  // Der dynamische Import im Produktionsmodul bleibt bewusst bestehen:
  // exceljs gehört nicht ins Haupt-Bundle.
  beforeAll(async () => {
    await import("exceljs");
  }, 30_000);

  it("erzeugt einen nicht-leeren Blob", async () => {
    const blob = await buildBargeldXlsx([row, { ...row, businessDate: "2026-06-03" }], "Juni 2026");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain("spreadsheetml");
  });
});
