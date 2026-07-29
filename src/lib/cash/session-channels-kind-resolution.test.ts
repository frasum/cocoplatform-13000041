// KA1 — kind-Auflösung: Map aus ungefiltertem Kanalbestand (inkl. inaktiver).
// Miss (Kanal-ID unbekannt) wirft mit ID im Text. Historische Sessions auf
// inaktivem Kanal ergeben weiterhin den korrekten Haus-Umsatz.
import { describe, it, expect } from "vitest";
import { resolveChannelKind } from "./session-channels";
import { sessionHouseCentsFromKasse } from "@/lib/statistics/revenue-core";

describe("resolveChannelKind (KA1)", () => {
  it("löst kind auch für inaktive Kanäle auf, wenn sie in der Map stehen", () => {
    const map = new Map<string, string>([
      ["active-id", "pos"],
      ["inactive-id", "delivery_wolt"],
    ]);
    expect(resolveChannelKind(map, "inactive-id")).toBe("delivery_wolt");
  });

  it("wirft mit Kanal-ID, wenn die ID unbekannt ist", () => {
    const map = new Map<string, string>([["known", "pos"]]);
    expect(() => resolveChannelKind(map, "ghost-42")).toThrowError(
      /unbekannter Kanal ghost-42/,
    );
  });
});

describe("Session-Betrag auf inaktivem Kanal → korrekter Haus-Umsatz", () => {
  it("liefert Haus-Umsatz wie erwartet, wenn der Kanal inaktiv aber in der Map ist", () => {
    // Wolt (inaktiv) wird korrekt als delivery_wolt erkannt und im
    // Kasse-Modell NICHT abgezogen (steckt bereits in delivery_vectron).
    const kindById = new Map<string, string>([
      ["vec-marker", "delivery_vectron"],
      ["wolt-inactive", "delivery_wolt"],
    ]);
    const channelAmounts = [
      { channelId: "vec-marker", amountCents: 36_510 },
      { channelId: "wolt-inactive", amountCents: 17_210 },
    ];
    const house = sessionHouseCentsFromKasse({
      vectronCents: 667_250,
      channels: channelAmounts.map((c) => ({
        kind: resolveChannelKind(kindById, c.channelId),
        amountCents: c.amountCents,
      })),
    });
    expect(house).toBe(630_740);
  });

  it("Session-Betrag auf nicht existentem Kanal → Wurf mit ID", () => {
    const kindById = new Map<string, string>();
    expect(() =>
      [{ channelId: "does-not-exist", amountCents: 100 }].map((c) => ({
        kind: resolveChannelKind(kindById, c.channelId),
        amountCents: c.amountCents,
      })),
    ).toThrowError(/unbekannter Kanal does-not-exist/);
  });
});