import { describe, it, expect } from "vitest";
import { mapToSessionInputs, type SessionRow, type ChannelAmountRow } from "./revenue-map";

describe("mapToSessionInputs", () => {
  // STAT1: Kanalzeilen tragen jetzt `kind` (N14-Zerlegung) statt `isTakeaway`.
  it("Session mit zwei Kanälen (Marker + pos) wird korrekt aufgebaut", () => {
    const sessions: SessionRow[] = [
      {
        id: "s1",
        businessDate: "2026-06-01",
        locationId: "yum",
        vectronCents: 551830,
      },
    ];
    const channels: ChannelAmountRow[] = [
      { sessionId: "s1", amountCents: 58550, kind: "delivery_vectron" },
      { sessionId: "s1", amountCents: 12000, kind: "pos" },
    ];
    expect(mapToSessionInputs(sessions, channels)).toEqual([
      {
        sessionId: "s1",
        businessDate: "2026-06-01",
        locationId: "yum",
        vectronCents: 551830,
        channels: [
          { kind: "delivery_vectron", amountCents: 58550 },
          { kind: "pos", amountCents: 12000 },
        ],
      },
    ]);
  });

  it("Session ohne Kanalbeträge → channels:[]", () => {
    const sessions: SessionRow[] = [
      {
        id: "s2",
        businessDate: "2026-06-02",
        locationId: "tsb",
        vectronCents: 100,
      },
    ];
    expect(mapToSessionInputs(sessions, [])).toEqual([
      {
        sessionId: "s2",
        businessDate: "2026-06-02",
        locationId: "tsb",
        vectronCents: 100,
        channels: [],
      },
    ]);
  });

  it("Kanalbetrag mit unbekannter sessionId wird ignoriert", () => {
    const sessions: SessionRow[] = [
      { id: "s1", businessDate: "2026-06-01", locationId: "x", vectronCents: 0 },
    ];
    const channels: ChannelAmountRow[] = [
      { sessionId: "s1", amountCents: 50, kind: "pos" },
      { sessionId: "ghost", amountCents: 999, kind: "delivery_vectron" },
    ];
    const out = mapToSessionInputs(sessions, channels);
    expect(out).toHaveLength(1);
    expect(out[0].channels).toEqual([{ kind: "pos", amountCents: 50 }]);
  });

  it("Output-Reihenfolge entspricht Sessions-Eingabereihenfolge", () => {
    const sessions: SessionRow[] = [
      { id: "c", businessDate: "2026-06-03", locationId: "x", vectronCents: 0 },
      { id: "a", businessDate: "2026-06-01", locationId: "x", vectronCents: 0 },
      { id: "b", businessDate: "2026-06-02", locationId: "x", vectronCents: 0 },
    ];
    expect(mapToSessionInputs(sessions, []).map((s) => s.sessionId)).toEqual(["c", "a", "b"]);
  });
});
