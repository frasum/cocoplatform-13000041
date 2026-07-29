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
    expect(() => resolveChannelKind(map, "ghost-42")).toThrowError(/unbekannter Kanal ghost-42/);
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

// KA1 (präzisiert 29.07.): Guard gegen Lade-Rennen. Solange der Kanal-Katalog
// nicht geladen ist, darf die Berechnung NICHT laufen (Consumer setzt
// `channelsLoaded=false`). Bei geladenem Katalog gilt weiterhin: unbekannte
// ID wirft mit Kanal-ID.
describe("KA1 Guard: kein Rechnen auf ungeladenem Katalog", () => {
  // Der Guard sitzt am Consumer (kasse.tsx, SessionFieldsCard,
  // buildSummaryDataOrNull). Diese Test-Doppel bilden das Muster ab:
  function computeHouse(opts: {
    channelsLoaded: boolean;
    channelKindById: Map<string, string>;
    vectronCents: number;
    channelAmounts: Array<{ channelId: string; amountCents: number }>;
  }): number | null {
    if (!opts.channelsLoaded) return null; // Guard — keine Rechnung, kein Wurf.
    return sessionHouseCentsFromKasse({
      vectronCents: opts.vectronCents,
      channels: opts.channelAmounts.map((c) => ({
        kind: resolveChannelKind(opts.channelKindById, c.channelId),
        amountCents: c.amountCents,
      })),
    });
  }

  it("bricht ohne Wurf ab, wenn der Katalog noch nicht geladen ist", () => {
    // Trotz vorhandener channelAmounts wird nicht gegen die leere Map
    // aufgelöst — sonst würde `resolveChannelKind` mit „unbekannter Kanal"
    // werfen (Lade-Rennen-Fehler).
    const result = computeHouse({
      channelsLoaded: false,
      channelKindById: new Map(),
      vectronCents: 500_000,
      channelAmounts: [{ channelId: "existing-in-db", amountCents: 12_000 }],
    });
    expect(result).toBeNull();
  });

  it("rechnet normal, sobald der Katalog geladen ist", () => {
    const kindById = new Map<string, string>([["wolt", "delivery_wolt"]]);
    const result = computeHouse({
      channelsLoaded: true,
      channelKindById: kindById,
      vectronCents: 100_000,
      channelAmounts: [{ channelId: "wolt", amountCents: 12_000 }],
    });
    expect(result).toBe(100_000);
  });
});
