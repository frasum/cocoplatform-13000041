// CH1 — die Mapping-Landkarte ist org-weit: Kanäle ANDERER Standorte und
// INAKTIVE Kanäle sind enthalten. Nur echte Geister-IDs werfen weiterhin.
import { describe, expect, it } from "vitest";
import { buildChannelKindMap } from "./channel-mapping";
import { resolveChannelKind } from "./session-channels";

// Vorfall 02.08.: Wolt/YUM (aktiv, korrekt zugeordnet) galt als „unbekannt",
// weil der Katalog standortgefiltert geladen wurde.
const orgWideCatalog = [
  { id: "spicery-pos", kind: "pos", locationId: "spicery" },
  { id: "dfa3e9b8-wolt-yum", kind: "delivery_wolt", locationId: "yum" },
  { id: "yum-inactive-souse", kind: "delivery_souse", locationId: "yum" },
];

describe("buildChannelKindMap (CH1)", () => {
  it("enthält den Kanal eines ANDEREN Standorts (Vorfalls-Fall)", () => {
    const map = buildChannelKindMap(orgWideCatalog);
    expect(resolveChannelKind(map, "dfa3e9b8-wolt-yum")).toBe("delivery_wolt");
  });

  it("enthält inaktive Kanäle", () => {
    const map = buildChannelKindMap(orgWideCatalog);
    expect(resolveChannelKind(map, "yum-inactive-souse")).toBe("delivery_souse");
  });

  it("wirft weiterhin bei wirklich unbekannter ID", () => {
    const map = buildChannelKindMap(orgWideCatalog);
    expect(() => resolveChannelKind(map, "ghost-1")).toThrowError(/unbekannter Kanal ghost-1/);
  });

  it("standortgefilterter Katalog hätte geworfen (Regression)", () => {
    const spiceryOnly = buildChannelKindMap(orgWideCatalog.filter((c) => c.locationId === "spicery"));
    expect(() => resolveChannelKind(spiceryOnly, "dfa3e9b8-wolt-yum")).toThrowError(/unbekannter Kanal/);
  });
});
