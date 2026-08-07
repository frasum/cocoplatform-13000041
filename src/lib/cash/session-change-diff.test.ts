import { describe, expect, it } from "vitest";
import { diffSessionSnapshot, type SessionSnapshot } from "./session-change-diff";

const base: SessionSnapshot = {
  vouchersSoldCents: 0,
  vouchersRedeemedCents: 0,
  finedineVouchersCents: 0,
  vorschussCents: 0,
  einladungCents: 0,
  vectronDailyTotalCents: 100000,
  cashActualCents: 50000,
  guestCount: 42,
  notes: null,
  channelAmounts: [{ id: "c1", label: "Wolt", amountCents: 224000 }],
  terminalAmounts: [{ id: "t1", label: "EC 1", amountCents: 30000 }],
};

describe("diffSessionSnapshot", () => {
  it("meldet keine Änderung bei identischem Zustand", () => {
    expect(diffSessionSnapshot(base, { ...base })).toEqual([]);
  });

  it("meldet geänderten Kanal-Betrag mit Label", () => {
    const after: SessionSnapshot = {
      ...base,
      channelAmounts: [{ id: "c1", label: "Wolt", amountCents: 24000 }],
    };
    expect(diffSessionSnapshot(base, after)).toEqual([
      { field: "channel:c1", label: "Wolt", kind: "money", before: 224000, after: 24000 },
    ]);
  });

  it("meldet neu hinzugekommenen Kanal", () => {
    const after: SessionSnapshot = {
      ...base,
      channelAmounts: [
        ...base.channelAmounts,
        { id: "c2", label: "Lieferando", amountCents: 5000 },
      ],
    };
    expect(diffSessionSnapshot(base, after)).toEqual([
      { field: "channel:c2", label: "Lieferando", kind: "money", before: null, after: 5000 },
    ]);
  });

  it("meldet entfernten Terminal-Betrag", () => {
    const after: SessionSnapshot = { ...base, terminalAmounts: [] };
    expect(diffSessionSnapshot(base, after)).toEqual([
      { field: "terminal:t1", label: "EC 1", kind: "money", before: 30000, after: null },
    ]);
  });

  it("meldet Kopfzahlen und Notiz", () => {
    const after: SessionSnapshot = {
      ...base,
      guestCount: 44,
      cashActualCents: null,
      notes: "Korrektur Wolt",
    };
    const changes = diffSessionSnapshot(base, after);
    expect(changes.map((c) => c.field).sort()).toEqual([
      "cash_actual_cents",
      "guest_count",
      "notes",
    ]);
    expect(changes.find((c) => c.field === "notes")).toEqual({
      field: "notes",
      label: "Notiz",
      kind: "text",
      before: null,
      after: "Korrektur Wolt",
    });
  });
});
