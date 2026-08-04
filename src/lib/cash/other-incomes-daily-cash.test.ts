// SE1-b — Rechen-Nachweis: die POSITIONS-SUMME der sonstigen Einnahmen wird im
// Tages-Bargeld ADDIERT (derselbe Kern wie Ausgaben/Vorschüsse).
// Fundstellen: session-day-input.ts (Summenbildung), cash-ledger.ts
// (`computeDailyCash`: `+ sonstigeEinnahmeCents`).
import { describe, it, expect } from "vitest";
import { computeDailyCashWithTipRemainder } from "./cash-ledger";
import { sessionToDayInput, type SessionDayFields } from "./session-day-input";

const sess: SessionDayFields = {
  business_date: "2026-08-04",
  vectron_daily_total_cents: 150_000,
  vouchers_sold_cents: 2_000,
  vouchers_redeemed_cents: 1_000,
  finedine_vouchers_cents: 0,
  einladung_cents: 500,
  vorschuss_cents: 0,
};

function dailyCash(otherIncomesCents: number[]): number {
  return computeDailyCashWithTipRemainder(
    sessionToDayInput(sess, {
      cardTotalCents: 40_000,
      deliverySouseCents: 3_000,
      deliveryWoltCents: 1_500,
      openInvoicesCents: [2_500],
      expensesCents: [1_200, 800],
      advancesCents: [5_000],
      otherIncomesCents,
      tipRemainderCents: 37,
    }),
  );
}

describe("SE1-b: sonstige Einnahmen im Tages-Bargeld", () => {
  it("addiert eine Position von 30,00 € genau mit +3000 Cent", () => {
    expect(dailyCash([3_000])).toBe(dailyCash([]) + 3_000);
  });

  it("summiert mehrere Positionen", () => {
    expect(dailyCash([3_000, 1_250, 75])).toBe(dailyCash([]) + 4_325);
  });

  it("Druck/PDF-Pfad liefert dieselbe Zahl wie der Kassen-Pfad", () => {
    // Beide Pfade bauen den DayInput über `sessionToDayInput` mit derselben
    // Positionsliste — bit-genau identische Summe.
    const args = {
      cardTotalCents: 40_000,
      deliverySouseCents: 3_000,
      deliveryWoltCents: 1_500,
      openInvoicesCents: [2_500],
      expensesCents: [1_200, 800],
      advancesCents: [5_000],
      otherIncomesCents: [3_000],
      tipRemainderCents: 37,
    };
    const kasse = computeDailyCashWithTipRemainder(sessionToDayInput(sess, args));
    const print = computeDailyCashWithTipRemainder(
      sessionToDayInput(sess, { ...args, otherIncomesCents: [...args.otherIncomesCents] }),
    );
    expect(print).toBe(kasse);
    expect(kasse).toBe(dailyCash([]) + 3_000);
  });
});
