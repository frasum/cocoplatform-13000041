import { describe, it, expect } from "vitest";
import { resolveEdlohnSlots, slotKategorie, slotLabel, type SlotBucket } from "./edlohn-slots";

function b(department: SlotBucket["department"], h: number, rate: number | null): SlotBucket {
  return { department, paidHoursUnrounded: h, rateCents: rate };
}

describe("SL1 · resolveEdlohnSlots", () => {
  it("keine Stunden → keine Slots, kein Blocker", () => {
    const r = resolveEdlohnSlots([b("gl", 0, 2200)], []);
    expect(r.slots.size).toBe(0);
    expect(r.mappingMissing).toBe(false);
  });

  it("Ein-Bereich ohne Mapping → Slot 1 (edlohn-Ist: 38/40 Personen)", () => {
    for (const d of ["service", "gl", "kitchen"] as const) {
      const r = resolveEdlohnSlots([b(d, 40, 2080)], []);
      expect(r.slots.get(d)).toBe(1);
      expect(r.mappingMissing).toBe(false);
    }
  });

  it("GERARD-Fall: zwei Bereiche, identischer Satz → beide Slot 1, kein Blocker", () => {
    const r = resolveEdlohnSlots([b("gl", 30, 2080), b("service", 20, 2080)], []);
    expect(r.slots.get("gl")).toBe(1);
    expect(r.slots.get("service")).toBe(1);
    expect(r.mappingMissing).toBe(false);
  });

  it("identischer Satz null (beide ungepflegt) ist EIN Satz-Wert → Slot 1", () => {
    const r = resolveEdlohnSlots([b("gl", 5, null), b("kitchen", 5, null)], []);
    expect(r.mappingMissing).toBe(false);
    expect([...r.slots.values()]).toEqual([1, 1]);
  });

  it("LAM-Fall: zwei Bereiche mit unterschiedlichen Sätzen ohne Mapping → Blocker", () => {
    const r = resolveEdlohnSlots([b("gl", 54, 2200), b("service", 18.75, 1600)], []);
    expect(r.mappingMissing).toBe(true);
    expect(r.unmappedDepartments).toEqual(["gl", "service"]);
    // Notbelegung in Bucket-Reihenfolge, damit die Anzeige beide Sätze zeigt.
    expect(r.slots.get("gl")).toBe(1);
    expect(r.slots.get("service")).toBe(2);
  });

  it("Bereiche ohne Stunden zählen bei der Satz-Prüfung nicht mit", () => {
    // service hat 0 h — der abweichende Satz darf keinen Blocker auslösen.
    const r = resolveEdlohnSlots([b("gl", 40, 2200), b("service", 0, 1600)], []);
    expect(r.mappingMissing).toBe(false);
    expect(r.slots.get("gl")).toBe(1);
    expect(r.slots.has("service")).toBe(false);
  });

  it("vollständiges Mapping gewinnt — auch bei identischen Sätzen", () => {
    const r = resolveEdlohnSlots(
      [b("gl", 30, 2080), b("service", 20, 2080)],
      [
        { department: "gl", slot: 2 },
        { department: "service", slot: 1 },
      ],
    );
    expect(r.mappingMissing).toBe(false);
    expect(r.slots.get("gl")).toBe(2);
    expect(r.slots.get("service")).toBe(1);
  });

  it("Teil-Mapping bei unterschiedlichen Sätzen: Blocker, keine Slot-Kollision", () => {
    const r = resolveEdlohnSlots(
      [b("gl", 10, 2200), b("kitchen", 10, 1900), b("service", 10, 1600)],
      [{ department: "kitchen", slot: 1 }],
    );
    expect(r.mappingMissing).toBe(true);
    expect(r.unmappedDepartments).toEqual(["gl", "service"]);
    expect(new Set(r.slots.values()).size).toBe(3);
    expect(r.slots.get("kitchen")).toBe(1);
  });

  it("Fließkomma-Rauschen zählt nicht als Stunden", () => {
    const r = resolveEdlohnSlots([b("gl", 40, 2200), b("service", 1e-12, 1600)], []);
    expect(r.mappingMissing).toBe(false);
    expect(r.slots.has("service")).toBe(false);
  });
});

describe("SL1 · slotLabel / slotKategorie", () => {
  it("Slot 1 heißt schlicht „Zeitlohn“ — auch in GL und Küche", () => {
    expect(slotLabel(1, ["gl"], false)).toBe("Zeitlohn (GL)");
    expect(slotLabel(1, ["kitchen"], false)).toBe("Zeitlohn (Küche)");
    // Bestandslabel für Ein-Bereich-Service bleibt wortgleich.
    expect(slotLabel(1, ["service"], false)).toBe("Zeitlohn (Service)");
  });
  it("aggregierte Zeile listet alle Bereiche", () => {
    expect(slotLabel(1, ["gl", "service"], false)).toBe("Zeitlohn (GL, Service)");
  });
  it("Minijob-Label behält den pauschal-Zusatz", () => {
    expect(slotLabel(1, ["service"], true)).toBe("Aushilfe-Zeitlohn (Service, pauschal)");
    expect(slotLabel(2, ["gl"], true)).toBe("Aushilfe-Zeitlohn 2 (GL, pauschal)");
  });
  it("Kategorie folgt dem Slot", () => {
    expect(slotKategorie(1)).toBe("zeitlohn");
    expect(slotKategorie(2)).toBe("zeitlohn_2");
    expect(slotKategorie(3)).toBe("zeitlohn_3");
  });
});
