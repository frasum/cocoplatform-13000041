import { describe, expect, it } from "vitest";
import { deriveTelegramLinkState } from "./link-status";

const FIXED_NOW = new Date("2026-07-29T12:00:00.000Z");
const FUTURE = "2026-07-29T12:15:00.000Z";
const PAST = "2026-07-29T11:45:00.000Z";

describe("deriveTelegramLinkState", () => {
  it("null → none", () => {
    expect(deriveTelegramLinkState(null, FIXED_NOW)).toBe("none");
  });
  it("undefined → none", () => {
    expect(deriveTelegramLinkState(undefined, FIXED_NOW)).toBe("none");
  });
  it("linked_at + telegram_chat_id → linked", () => {
    expect(
      deriveTelegramLinkState(
        { linked_at: "2026-07-01T00:00:00Z", telegram_chat_id: 123 },
        FIXED_NOW,
      ),
    ).toBe("linked");
  });
  it("telegram_chat_id ohne linked_at → nicht linked (fällt in Token-Prüfung)", () => {
    expect(
      deriveTelegramLinkState({ telegram_chat_id: 123, token_expires_at: FUTURE }, FIXED_NOW),
    ).toBe("pending");
    expect(deriveTelegramLinkState({ telegram_chat_id: 123 }, FIXED_NOW)).toBe("none");
  });
  it("linked_at ohne telegram_chat_id → nicht linked", () => {
    expect(
      deriveTelegramLinkState(
        { linked_at: "2026-07-01T00:00:00Z", token_expires_at: FUTURE },
        FIXED_NOW,
      ),
    ).toBe("pending");
  });
  it("kein token_expires_at → none", () => {
    expect(deriveTelegramLinkState({}, FIXED_NOW)).toBe("none");
  });
  it("token_expires_at in der Vergangenheit → none", () => {
    expect(deriveTelegramLinkState({ token_expires_at: PAST }, FIXED_NOW)).toBe("none");
  });
  it("token_expires_at in der Zukunft → pending", () => {
    expect(deriveTelegramLinkState({ token_expires_at: FUTURE }, FIXED_NOW)).toBe("pending");
  });
  it("Grenzfall exakt now → wie Bestand (`<`-Vergleich, also pending)", () => {
    // Der Bestand nutzt strict `<`; bei Gleichheit fällt die Prüfung durch
    // und liefert "pending". Diese Erwartung dokumentiert das Verhalten
    // bit-identisch — Änderung ist eine eigene Runde (SP1 A6).
    expect(deriveTelegramLinkState({ token_expires_at: FIXED_NOW.toISOString() }, FIXED_NOW)).toBe(
      "pending",
    );
  });
});
