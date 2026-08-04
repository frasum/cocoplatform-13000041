// Regression: `delivery_vectron` (In-House Take-away) darf NICHT mit
// `delivery_souse` in einen Topf — sonst zieht `computeDailyCash` den
// Take-away-Anteil ein zweites Mal ab (er steckt bereits in
// `vectron_daily_total_cents`).

import { describe, expect, it } from "vitest";
import { applyRevenueChannel, type CashDayAgg } from "./cash.functions";
import { computeDailyCash, type DayInput } from "./cash-ledger";

function emptyAgg(): CashDayAgg {
  return {
    statuses: new Set(),
    grossRevenue: 0,
    vectronDailyTotal: 0,
    cardTotal: 0,
    deliverySouse: 0,
    deliveryVectron: 0,
    deliveryWolt: 0,
    vouchersSold: 0,
    vouchersRedeemed: 0,
    finedine: 0,
    einladung: 0,
    sonstige: 0,
    otherIncomes: [],
    vorschuss: 0,
    openInvoices: [],
    expenses: [],
    advances: [],
    bankDeposits: [],
    cardTransactions: [],
    transfers: [],
    openingBalance: 0,
    totalRevenueGross: 0,
    totalExpenses: 0,
    differenz: 0,
    cashActualSum: 0,
    cashActualCount: 0,
    sessionCount: 0,
    cashTargetSum: 0,
  };
}

describe("applyRevenueChannel — Routing (Mo 01.06 YUM)", () => {
  it("routet delivery_vectron in deliveryVectron, nicht in deliverySouse", () => {
    const a = emptyAgg();
    applyRevenueChannel(a, "delivery_souse", 24500); // OrderSmart 245,00 €
    applyRevenueChannel(a, "delivery_vectron", 53570); // In-House Take-away 535,70 €
    applyRevenueChannel(a, "delivery_wolt", 48050); // Wolt 480,50 €
    applyRevenueChannel(a, "voucher_redeemed", 5000);
    applyRevenueChannel(a, "finedine", 5000);
    expect(a.deliverySouse).toBe(24500);
    expect(a.deliveryVectron).toBe(53570);
    expect(a.deliveryWolt).toBe(48050);
  });

  it("ignoriert unbekannte Kinds (default-Branch ist no-op)", () => {
    const a = emptyAgg();
    applyRevenueChannel(a, "unbekannt", 999);
    applyRevenueChannel(a, null, 999);
    expect(a.grossRevenue + a.deliverySouse + a.deliveryVectron + a.deliveryWolt).toBe(0);
  });
});

describe("computeDailyCash — Mo 01.06 YUM Referenzfall", () => {
  it("liefert 336,46 € bei korrekt getrenntem Take-away", () => {
    const day: DayInput = {
      businessDate: "2026-06-01",
      grossRevenueCents: 519640, // Vectron-Tagesumsatz (enthält Take-away)
      cardTotalCents: 403444,
      deliverySouseCents: 24500,
      deliveryWoltCents: 48050,
      vouchersSoldCents: 0,
      vouchersRedeemedCents: 5000,
      finedineVouchersCents: 5000,
      einladungCents: 0,
      openInvoicesCents: [],
      sonstigeEinnahmeCents: 0,
      vorschussCents: 0,
      satellites: {
        expensesCents: [],
        advancesCents: [],
        cardTransactionsCents: [],
        bankDepositsCents: [],
        registerTransfers: [],
      },
      tipRemainderCents: 0,
    };
    expect(computeDailyCash(day)).toBe(33646);
  });
});
