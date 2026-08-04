import { describe, it, expect, beforeAll } from "vitest";
import {
  buildBargeldXlsx,
  bargeldFromRowCents,
  assertBargeldFormula,
  columnsForSheet,
  ALL_CHANNEL_KINDS,
} from "./bargeld-export";
import type { CashDailyRow } from "./cash.functions";

// EX2-c — Kanal-Zuordnung je Blatt (Kanalkatalog).
const SPICERY_KINDS = new Set(["delivery_souse", "delivery_wolt", "finedine"]);
const YUM_KINDS = new Set(["delivery_souse", "delivery_wolt"]);

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
  otherIncomes: [],
  bargeldCents: -38423,
  tipRemainderCents: 0,
};

const july02: CashDailyRow = { ...july01, businessDate: "2026-07-02" };

// EX2-b/SE1 — 27.07. (YUM): 30,00 € sonstige Einnahme, jetzt als POSITION;
// Spalten ergeben 374,07, gespeichertes Tages-Bargeld 404,07.
const july27: CashDailyRow = {
  ...july01,
  businessDate: "2026-07-27",
  tagesumsatzCents: 37407,
  kreditkartenCents: 0,
  deliveryWoltCents: 0,
  expensesCents: 0,
  sonstigeEinnahmeCents: 3000,
  otherIncomes: [{ description: "Übernahme Alt-Erfassung", amountCents: 3000 }],
  bargeldCents: 40407,
};

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
      { locationName: "spicery", rows: [july01, july02], channelKinds: SPICERY_KINDS },
      { locationName: "YUM", rows: [july01], channelKinds: YUM_KINDS },
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

  it("EX2-b: sonstige Einnahmen sind aus der Bargeld-Spalte herausgerechnet", () => {
    expect(bargeldFromRowCents(july27)).toBe(37407);
    expect(() => assertBargeldFormula([july27], "YUM")).not.toThrow();
  });

  it("EX2-b: Blatt mit sonstiger Einnahme wird erzeugt", async () => {
    const blob = await buildBargeldXlsx([
      { locationName: "YUM", rows: [july27], channelKinds: YUM_KINDS },
    ]);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("EX2-c: Kanal-Spalten folgen dem Katalog, Struktur-Spalten bleiben", () => {
    const yum = columnsForSheet(YUM_KINDS).map((c) => c.header);
    const spicery = columnsForSheet(SPICERY_KINDS).map((c) => c.header);
    expect(yum).not.toContain("FineDine");
    expect(spicery).toContain("FineDine");
    for (const h of [
      "tagesumsatz",
      "kreditkarten",
      "gutscheine",
      "Gutscheine VK",
      "einladung gäste",
      "offene rechnungen",
      "personal",
      "barausgaben",
      "bargeld",
    ]) {
      expect(yum).toContain(h);
    }
    // Kanalbasiert, nicht wertbasiert: umsatzloser Kanal behält seine Spalte.
    expect(yum).toContain("Wolt");
  });

  it("EX2-c: Wächter rechnet nur mit den vorhandenen Spalten", () => {
    expect(bargeldFromRowCents(july01, YUM_KINDS)).toBe(bargeldFromRowCents(july01, SPICERY_KINDS));
    expect(() => assertBargeldFormula([july01], "YUM", YUM_KINDS)).not.toThrow();
  });

  it("EX2-c: standortfremder Kanal mit Betrag ist ein Datenfehler", () => {
    const row: CashDailyRow = { ...july01, finedineCents: 1000, bargeldCents: -38423 - 1000 };
    expect(() => assertBargeldFormula([row], "YUM", YUM_KINDS)).toThrow(/Datenfehler/);
    expect(() => assertBargeldFormula([row], "spicery", SPICERY_KINDS)).not.toThrow();
  });

  it("EX2-c: Default-Kanalsatz enthält alle Kanal-Spalten", () => {
    expect([...ALL_CHANNEL_KINDS].sort()).toEqual(["delivery_souse", "delivery_wolt", "finedine"]);
  });

  it("SE1: Positions-Summe ergibt die ausgewiesene Summe (mehrere Positionen)", () => {
    const multi: CashDailyRow = {
      ...july27,
      sonstigeEinnahmeCents: 4500,
      otherIncomes: [
        { description: "Pfand", amountCents: 1500 },
        { description: "Gefundenes Bargeld", amountCents: 3000 },
      ],
      bargeldCents: 37407 + 4500,
    };
    expect(bargeldFromRowCents(multi)).toBe(37407);
    expect(() => assertBargeldFormula([multi], "YUM")).not.toThrow();
  });

  it("SE1: blockiert, wenn Positionen nicht die ausgewiesene Summe ergeben", () => {
    expect(() =>
      assertBargeldFormula(
        [{ ...july27, otherIncomes: [{ description: "Pfand", amountCents: 1000 }] }],
        "YUM",
      ),
    ).toThrow(/Positionen der sonstigen/);
  });
});
