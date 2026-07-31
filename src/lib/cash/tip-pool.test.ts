import { describe, expect, it, test } from "vitest";
import {
  activeSettlements,
  computeTipPool,
  computeTipTotalCents,
  effectiveParticipation,
  poolFullyUnallocated,
  poolNeedsHoursWarning,
  resolvePoolTimeEntries,
  resolveTipDistributionMode,
} from "./tip-pool";

function iso(h: number, m = 0): string {
  const d = new Date("2025-06-01T00:00:00Z");
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

const participatesAll = (ids: string[]) => new Map(ids.map((id) => [id, true]));

describe("computeTipPool", () => {
  it("(a) Normalfall: 2 Küche + 2 Service mit unterschiedlichen Stunden (Euro-Abrundung)", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 10_000,
      servicePoolCents: 30_000,
      settlements: [],
      timeEntries: [
        { staffId: "k1", startedAt: iso(10), endedAt: iso(18) }, // 8h
        { staffId: "k2", startedAt: iso(14), endedAt: iso(18) }, // 4h
        { staffId: "s1", startedAt: iso(10), endedAt: iso(20) }, // 10h
        { staffId: "s2", startedAt: iso(15), endedAt: iso(20) }, // 5h
      ],
      staffDepartments: new Map([
        ["k1", "kitchen"],
        ["k2", "kitchen"],
        ["s1", "service"],
        ["s2", "service"],
      ]),
      staffParticipates: participatesAll(["k1", "k2", "s1", "s2"]),
    });
    const byId = new Map(r.shares.map((s) => [s.staffId, s]));
    // Euro-Abrundung: FLOOR(... / 100) * 100
    expect(byId.get("k1")!.shareCents).toBe(6_600); // 10000*8/12=6666,67 → 6600
    expect(byId.get("k2")!.shareCents).toBe(3_300); // 10000*4/12=3333,33 → 3300
    expect(byId.get("s1")!.shareCents).toBe(20_000); // glatt
    expect(byId.get("s2")!.shareCents).toBe(10_000); // glatt
  });

  it("(b) Rundungsrest bleibt im Pool (Euro)", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 299,
      servicePoolCents: 0,
      settlements: [],
      timeEntries: [
        { staffId: "k1", startedAt: iso(10), endedAt: iso(11) },
        { staffId: "k2", startedAt: iso(10), endedAt: iso(11) },
        { staffId: "k3", startedAt: iso(10), endedAt: iso(11) },
      ],
      staffDepartments: new Map([
        ["k1", "kitchen"],
        ["k2", "kitchen"],
        ["k3", "kitchen"],
      ]),
      staffParticipates: participatesAll(["k1", "k2", "k3"]),
    });
    const sum = r.shares.reduce((s, x) => s + x.shareCents, 0);
    // 299/3 = 99,67 Cent → FLOOR auf Euro = 0 pro Person; alles bleibt Rest
    expect(sum).toBe(0);
    expect(r.kitchenRemainder).toBe(299);
    expect(sum + r.kitchenRemainder).toBe(299);
  });

  it("(c) participates_in_pool=false wird ausgeschlossen", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 1_000,
      servicePoolCents: 0,
      settlements: [],
      timeEntries: [
        { staffId: "k1", startedAt: iso(10), endedAt: iso(15) },
        { staffId: "k2", startedAt: iso(10), endedAt: iso(15) },
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["k1", "kitchen"],
        ["k2", "kitchen"],
      ]),
      staffParticipates: new Map([
        ["k1", true],
        ["k2", false],
      ]),
    });
    expect(r.shares).toHaveLength(1);
    expect(r.shares[0]).toMatchObject({ staffId: "k1", shareCents: 1_000 });
  });

  it("(d) GL ist aus beiden Pools ausgeschlossen", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 500,
      servicePoolCents: 500,
      settlements: [],
      timeEntries: [
        { staffId: "gl1", startedAt: iso(10), endedAt: iso(20) },
        { staffId: "s1", startedAt: iso(10), endedAt: iso(15) },
        { staffId: "k1", startedAt: iso(10), endedAt: iso(15) },
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["gl1", "gl"],
        ["s1", "service"],
        ["k1", "kitchen"],
      ]),
      staffParticipates: participatesAll(["gl1", "s1", "k1"]),
    });
    expect(r.shares.find((s) => s.staffId === "gl1")).toBeUndefined();
    expect(r.shares.find((s) => s.staffId === "k1")!.shareCents).toBe(500);
    expect(r.shares.find((s) => s.staffId === "s1")!.shareCents).toBe(500);
  });

  it("(e) leere time_entries → alle shares 0, Reste = Pool-Summen", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 1_234,
      servicePoolCents: 5_678,
      settlements: [
        {
          staffId: "s1",
          posSalesCents: 0,
          cardTotalCents: 0,
          openInvoicesCents: 0,
          kitchenTipCents: 0,
        },
      ],
      timeEntries: [],
      staffDepartments: new Map([["s1", "service"]]),
      staffParticipates: new Map([["s1", true]]),
    });
    expect(r.shares.every((x) => x.shareCents === 0)).toBe(true);
    expect(r.kitchenRemainder).toBe(1_234);
    expect(r.serviceRemainder).toBe(5_678);
  });
});

describe("computeTipPool: Euro-Abrundung der Auszahlung", () => {
  it("Service 176,73 € / 3 Personen ~gleich → je 58,00 €, Rest 2,73 €", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 17_673,
      settlements: [],
      timeEntries: (() => {
        const start = "2025-06-01T10:00:00.000Z";
        const end = (hours: number) =>
          new Date(Date.parse(start) + hours * 3_600_000).toISOString();
        return [
          { staffId: "a", startedAt: start, endedAt: end(7.12) },
          { staffId: "b", startedAt: start, endedAt: end(7.13) },
          { staffId: "c", startedAt: start, endedAt: end(7.13) },
        ];
      })(),
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["a", "service"],
        ["b", "service"],
        ["c", "service"],
      ]),
      staffParticipates: participatesAll(["a", "b", "c"]),
    });
    for (const s of r.shares) expect(s.shareCents).toBe(5_800);
    expect(r.serviceRemainder).toBe(273);
  });

  it("Pool 50,99 € / 1 Person → 50,00 €, Rest 99 Cent", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 5_099,
      settlements: [],
      timeEntries: [{ staffId: "x", startedAt: iso(10), endedAt: iso(15) }],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([["x", "service"]]),
      staffParticipates: participatesAll(["x"]),
    });
    expect(r.shares).toHaveLength(1);
    expect(r.shares[0].shareCents).toBe(5_000);
    expect(r.serviceRemainder).toBe(99);
  });

  it("Leerer Pool / 0 Stunden: alle shareCents=0, remainder=pool", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 4_242,
      settlements: [],
      timeEntries: [],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([["s1", "service"]]),
      staffParticipates: participatesAll(["s1"]),
    });
    expect(r.shares.every((x) => x.shareCents === 0)).toBe(true);
    expect(r.serviceRemainder).toBe(4_242);
  });

  it("Küche 100,00 € bei 5 h / 3 h → 62,00 € / 37,00 €, Rest 1,00 €", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 10_000,
      servicePoolCents: 0,
      settlements: [],
      timeEntries: [
        { staffId: "k1", startedAt: iso(10), endedAt: iso(15) }, // 5h
        { staffId: "k2", startedAt: iso(10), endedAt: iso(13) }, // 3h
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["k1", "kitchen"],
        ["k2", "kitchen"],
      ]),
      staffParticipates: participatesAll(["k1", "k2"]),
    });
    const byId = new Map(r.shares.map((s) => [s.staffId, s]));
    // 10000*5/8=6250 → 6200; 10000*3/8=3750 → 3700; Rest=100
    expect(byId.get("k1")!.shareCents).toBe(6_200);
    expect(byId.get("k2")!.shareCents).toBe(3_700);
    expect(r.kitchenRemainder).toBe(100);
  });
});

test("computeTipTotalCents: echtes Trinkgeld (26.04. YUM)", () => {
  const total = computeTipTotalCents([
    {
      cardTotalCents: 198608,
      cashHandedInCents: 34700,
      posSalesCents: 215400,
      openInvoicesCents: 0,
      hilfMahlCents: 0,
    }, // KRISS
    {
      cardTotalCents: 50666,
      cashHandedInCents: 23000,
      posSalesCents: 68330,
      openInvoicesCents: 0,
      hilfMahlCents: 0,
    }, // JASMIN
    {
      cardTotalCents: 0,
      cashHandedInCents: 6000,
      posSalesCents: 5780,
      openInvoicesCents: 0,
      hilfMahlCents: 0,
    }, // TU
  ]);
  expect(total).toBe(23464);
  expect(total - 5791).toBe(17673);
});

describe("computeTipTotalCents: Tagesabrechnung-Angleichung (16.06.2026)", () => {
  it("offene Rechnung wirkt wie Bargeld → Pool nicht negativ", () => {
    // 12.05. PON spicery: hohe offene Rechnung hätte unter alter Formel
    // den Pool stark ins Minus gedrückt; jetzt zählt open wie Bargeld.
    const total = computeTipTotalCents([
      {
        cardTotalCents: 179829,
        cashHandedInCents: 0,
        posSalesCents: 241890,
        openInvoicesCents: 85063,
        hilfMahlCents: 0,
      },
    ]);
    // 179829 + 0 + 85063 − 241890 − 0 = 23002
    expect(total).toBe(23002);
    expect(total).toBeGreaterThan(0);
  });

  it("hilf_mahl mindert den Trinkgeld-Pool", () => {
    const total = computeTipTotalCents([
      {
        cardTotalCents: 100_00,
        cashHandedInCents: 50_00,
        posSalesCents: 130_00,
        openInvoicesCents: 0,
        hilfMahlCents: 5_00,
      },
    ]);
    // 10000 + 5000 + 0 − 13000 − 500 = 1500
    expect(total).toBe(1_500);
  });
});

describe("computeTipPool: Mindeststunden", () => {
  it("schließt Mitarbeiter unter Grenze aus und nimmt 2:30 inklusiv mit", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 10_000,
      settlements: [],
      timeEntries: [
        // s1: exakt 2:30 → muss mitmachen
        { staffId: "s1", startedAt: iso(17, 0), endedAt: iso(19, 30) },
        // s2: 2:29 → ausgeschlossen
        { staffId: "s2", startedAt: iso(17, 0), endedAt: iso(19, 29) },
        // s3: 5h → mitmachen
        { staffId: "s3", startedAt: iso(15), endedAt: iso(20) },
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["s1", "service"],
        ["s2", "service"],
        ["s3", "service"],
      ]),
      staffParticipates: participatesAll(["s1", "s2", "s3"]),
      minHoursPerDay: 2.5,
    });
    const ids = r.shares.map((s) => s.staffId).sort();
    expect(ids).toEqual(["s1", "s3"]);
    expect(r.excludedByMinHours).toHaveLength(1);
    expect(r.excludedByMinHours[0]).toMatchObject({ staffId: "s2", department: "service" });
  });

  it("Tagessumme zählt: mehrere Stempelungen werden summiert", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 1_000,
      settlements: [],
      timeEntries: [
        // 1,5 h + 1,5 h = 3 h → mitmachen (Tagessumme)
        { staffId: "y", startedAt: iso(11, 0), endedAt: iso(12, 30) },
        { staffId: "y", startedAt: iso(17, 30), endedAt: iso(19, 0) },
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([["y", "service"]]),
      staffParticipates: participatesAll(["y"]),
      minHoursPerDay: 2.5,
    });
    expect(r.shares).toHaveLength(1);
    expect(r.shares[0].staffId).toBe("y");
    expect(r.excludedByMinHours).toHaveLength(0);
  });

  it("minHoursPerDay=0 oder undefined: keine Filterung", () => {
    const base = {
      kitchenPoolCents: 0,
      servicePoolCents: 100,
      settlements: [],
      timeEntries: [{ staffId: "s1", startedAt: iso(17, 0), endedAt: iso(17, 30) }],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([["s1", "service"]]),
      staffParticipates: participatesAll(["s1"]),
    };
    expect(computeTipPool({ distributionMode: "hours" as const, ...base }).shares).toHaveLength(1);
    expect(computeTipPool({ distributionMode: "hours" as const, ...base, minHoursPerDay: 0 }).shares).toHaveLength(1);
  });
});

describe("resolvePoolTimeEntries: kitchenManualOnly-Matrix", () => {
  const businessDate = "2025-06-01";
  const raw = [
    { staffId: "k1", startedAt: iso(10), endedAt: iso(15) },
    { staffId: "s1", startedAt: iso(10), endedAt: iso(15) },
  ];
  const depts = new Map<string, "kitchen" | "service" | "gl">([
    ["k1", "kitchen"],
    ["k2", "kitchen"],
    ["s1", "service"],
  ]);

  it("Off: Küchen-Stempel ohne manuell zählt; Service unberührt", () => {
    const out = resolvePoolTimeEntries({
      rawTimeEntries: raw,
      manualEntries: [],
      staffDepartments: depts,
      settlementOnly: false,
      kitchenManualOnly: false,
      businessDate,
    });
    expect(out.map((e) => e.staffId).sort()).toEqual(["k1", "s1"]);
  });

  it("An: Küchen-Stempel ohne manuell fällt raus, Service unberührt", () => {
    const out = resolvePoolTimeEntries({
      rawTimeEntries: raw,
      manualEntries: [],
      staffDepartments: depts,
      settlementOnly: false,
      kitchenManualOnly: true,
      businessDate,
    });
    expect(out.map((e) => e.staffId)).toEqual(["s1"]);
  });

  it("An + manueller Küchen-Eintrag: synthetischer Entry für k2 zählt", () => {
    const out = resolvePoolTimeEntries({
      rawTimeEntries: raw,
      manualEntries: [{ staffId: "k2", department: "kitchen", hoursMinutes: 390 }],
      staffDepartments: depts,
      settlementOnly: false,
      kitchenManualOnly: true,
      businessDate,
    });
    const ids = out.map((e) => e.staffId).sort();
    expect(ids).toEqual(["k2", "s1"]);
    const k2 = out.find((e) => e.staffId === "k2")!;
    expect(new Date(k2.endedAt).getTime() - new Date(k2.startedAt).getTime()).toBe(390 * 60_000);
  });

  it("Manueller Eintrag verdrängt Stempel desselben Mitarbeiters (Off-Mode)", () => {
    const out = resolvePoolTimeEntries({
      rawTimeEntries: raw,
      manualEntries: [{ staffId: "k1", department: "kitchen", hoursMinutes: 120 }],
      staffDepartments: depts,
      settlementOnly: false,
      kitchenManualOnly: false,
      businessDate,
    });
    expect(out.filter((e) => e.staffId === "k1")).toHaveLength(1);
    const k1 = out.find((e) => e.staffId === "k1")!;
    expect(new Date(k1.endedAt).getTime() - new Date(k1.startedAt).getTime()).toBe(120 * 60_000);
  });

  it("settlementOnly: Roh-Stempel werden ignoriert, manuelle bleiben", () => {
    const out = resolvePoolTimeEntries({
      rawTimeEntries: raw,
      manualEntries: [{ staffId: "s1", department: "service", hoursMinutes: 60 }],
      staffDepartments: depts,
      settlementOnly: true,
      kitchenManualOnly: false,
      businessDate,
    });
    expect(out.map((e) => e.staffId)).toEqual(["s1"]);
  });
});

describe("effectiveParticipation", () => {
  it("Übersteuerung schaltet zu (true over default false)", () => {
    expect(effectiveParticipation(true, false)).toBe(true);
  });
  it("Übersteuerung schaltet ab (false over default true)", () => {
    expect(effectiveParticipation(false, true)).toBe(false);
  });
  it("NULL → Stammdaten-Default", () => {
    expect(effectiveParticipation(null, true)).toBe(true);
    expect(effectiveParticipation(null, false)).toBe(false);
  });
});

describe("computeTipPool: Teilnahme-Übersteuerung entkoppelt von Stunden", () => {
  it("(b) 'früher heimgeschickt': echte Stunden, aber participates=false → kein Anteil; Rest teilt sich Pool", () => {
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 10_000,
      settlements: [],
      timeEntries: [
        { staffId: "s1", startedAt: iso(10), endedAt: iso(15) }, // 5h, ausgeschlossen
        { staffId: "s2", startedAt: iso(10), endedAt: iso(15) }, // 5h
        { staffId: "s3", startedAt: iso(10), endedAt: iso(15) }, // 5h
      ],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([
        ["s1", "service"],
        ["s2", "service"],
        ["s3", "service"],
      ]),
      staffParticipates: new Map([
        ["s1", false],
        ["s2", true],
        ["s3", true],
      ]),
    });
    expect(r.shares.find((s) => s.staffId === "s1")).toBeUndefined();
    const s2 = r.shares.find((s) => s.staffId === "s2")!;
    const s3 = r.shares.find((s) => s.staffId === "s3")!;
    expect(s2.shareCents).toBe(5_000);
    expect(s3.shareCents).toBe(5_000);
  });

  it("(c) Standard-Nicht-Teilnehmer wird per Override zugeschaltet und erhält Anteil", () => {
    expect(effectiveParticipation(true, false)).toBe(true);
    const r = computeTipPool({
      distributionMode: "hours",
      kitchenPoolCents: 0,
      servicePoolCents: 10_000,
      settlements: [],
      timeEntries: [{ staffId: "x", startedAt: iso(10), endedAt: iso(15) }],
      staffDepartments: new Map<string, "kitchen" | "service" | "gl">([["x", "service"]]),
      // Default wäre false; Session-Override true (via effectiveParticipation)
      staffParticipates: new Map([["x", effectiveParticipation(true, false)]]),
    });
    expect(r.shares).toHaveLength(1);
    expect(r.shares[0]).toMatchObject({ staffId: "x", shareCents: 10_000 });
  });
});

describe("poolNeedsHoursWarning", () => {
  it("Pool > 0 + 0 Minuten → warnen", () => {
    expect(poolNeedsHoursWarning(42_307, 0)).toBe(true);
  });
  it("Pool > 0 + negative Minuten → warnen (defensive)", () => {
    expect(poolNeedsHoursWarning(1, -5)).toBe(true);
  });
  it("Pool > 0 + Minuten vorhanden → nicht warnen", () => {
    expect(poolNeedsHoursWarning(42_307, 1)).toBe(false);
  });
  it("Pool = 0 → nie warnen", () => {
    expect(poolNeedsHoursWarning(0, 0)).toBe(false);
    expect(poolNeedsHoursWarning(0, 60)).toBe(false);
  });
  it("Pool negativ (überzogener Pool) → nicht warnen (anderes Problem)", () => {
    expect(poolNeedsHoursWarning(-100, 0)).toBe(false);
  });
});

describe("poolFullyUnallocated (verteilungsnahe TG1-Warnung)", () => {
  it("Pool > 0 + 0 verteilt → warnen (voller Rest liegt liegen)", () => {
    expect(poolFullyUnallocated(42_307, 0)).toBe(true);
  });
  it("Pool > 0 + irgendwas verteilt → nicht warnen", () => {
    expect(poolFullyUnallocated(42_307, 1)).toBe(false);
  });
  it("Pool = 0 → nie warnen", () => {
    expect(poolFullyUnallocated(0, 0)).toBe(false);
  });
  it("Küchen-Pool mit Geld, aber nur Service hat Stunden → Küche warnt (423-€-Vorfall)", () => {
    // Realistischer Fall: der aggregierte poolNeedsHoursWarning sieht
    // Service-Minuten und schweigt — die verteilungsnahe Variante prüft
    // pro Abteilung und schlägt korrekt an.
    const kitchenPoolCents = 42_300;
    const kitchenDistributed = 0; // keine Küchen-Stunden → alles bleibt Rest
    const serviceEligibleMinutes = 480; // Service hat 8h
    expect(poolNeedsHoursWarning(kitchenPoolCents, serviceEligibleMinutes)).toBe(false);
    expect(poolFullyUnallocated(kitchenPoolCents, kitchenDistributed)).toBe(true);
  });
});

describe("activeSettlements", () => {
  it("filtert superseded-Zeilen aus Client-Aggregationen", () => {
    const list = [
      { id: "a", status: "submitted", cardTotalCents: 10_000 },
      { id: "b", status: "superseded", cardTotalCents: 25_166 },
      { id: "c", status: "corrected", cardTotalCents: 5_000 },
      { id: "d", status: null, cardTotalCents: 1_000 },
    ];
    const active = activeSettlements(list);
    expect(active.map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("computeTipTotalCents ignoriert superseded, wenn vorher gefiltert", () => {
    const raw = [
      {
        id: "keep",
        status: "submitted",
        cardTotalCents: 20_000,
        cashHandedInCents: 0,
        posSalesCents: 10_000,
        kassiertBruttoCents: 10_000,
        openInvoicesCents: 0,
        hilfMahlCents: 0,
      },
      {
        id: "drop",
        status: "superseded",
        cardTotalCents: 25_166,
        cashHandedInCents: 0,
        posSalesCents: 10_000,
        kassiertBruttoCents: 10_000,
        openInvoicesCents: 0,
        hilfMahlCents: 0,
      },
    ];
    expect(computeTipTotalCents(activeSettlements(raw))).toBe(10_000);
  });
});

// ---------------------------------------------------------------------
// TG4 — Kopfteilung (headcount) + datierte Umschaltung
// ---------------------------------------------------------------------
describe("resolveTipDistributionMode", () => {
  it("ohne Stichtag immer hours", () => {
    expect(resolveTipDistributionMode("2026-08-05", "headcount", null)).toBe("hours");
  });
  it("vor dem Stichtag hours", () => {
    expect(resolveTipDistributionMode("2026-07-31", "headcount", "2026-08-01")).toBe("hours");
  });
  it("am Stichtag greift der Modus", () => {
    expect(resolveTipDistributionMode("2026-08-01", "headcount", "2026-08-01")).toBe("headcount");
  });
  it("nach dem Stichtag greift der Modus", () => {
    expect(resolveTipDistributionMode("2026-09-15", "headcount", "2026-08-01")).toBe("headcount");
  });
  it("Modus hours bleibt hours, egal wann", () => {
    expect(resolveTipDistributionMode("2026-09-15", "hours", "2026-08-01")).toBe("hours");
  });
});

describe("computeTipPool — headcount", () => {
  const depts = new Map<string, "kitchen" | "service">([
    ["s1", "service"],
    ["s2", "service"],
    ["s3", "service"],
  ]);

  it("teilt gleich, Stunden egal (Euro-Abrundung, Rest bleibt im Pool)", () => {
    const r = computeTipPool({
      distributionMode: "headcount",
      kitchenPoolCents: 0,
      servicePoolCents: 10_000,
      settlements: [],
      timeEntries: [
        { staffId: "s1", startedAt: iso(10), endedAt: iso(20) }, // 10h
        { staffId: "s2", startedAt: iso(18), endedAt: iso(20) }, // 2h
        { staffId: "s3", startedAt: iso(19), endedAt: iso(20) }, // 1h
      ],
      staffDepartments: depts,
      staffParticipates: participatesAll(["s1", "s2", "s3"]),
    });
    const byId = new Map(r.shares.map((s) => [s.staffId, s.shareCents]));
    expect(byId.get("s1")).toBe(3_300);
    expect(byId.get("s2")).toBe(3_300);
    expect(byId.get("s3")).toBe(3_300);
    expect(r.serviceRemainder).toBe(100);
  });

  it("Mindeststunden filtern weiterhin VOR der Kopfteilung", () => {
    const r = computeTipPool({
      distributionMode: "headcount",
      kitchenPoolCents: 0,
      servicePoolCents: 10_000,
      settlements: [],
      timeEntries: [
        { staffId: "s1", startedAt: iso(10), endedAt: iso(20) },
        { staffId: "s2", startedAt: iso(18), endedAt: iso(20) },
        { staffId: "s3", startedAt: iso(19), endedAt: iso(20) }, // 1h < 2,5h
      ],
      staffDepartments: depts,
      staffParticipates: participatesAll(["s1", "s2", "s3"]),
      minHoursPerDay: 2.5,
    });
    expect(r.shares).toHaveLength(2);
    expect(r.shares.every((s) => s.shareCents === 5_000)).toBe(true);
    expect(r.serviceRemainder).toBe(0);
    expect(r.excludedByMinHours.map((e) => e.staffId)).toEqual(["s3"]);
  });

  it("ohne Teilnehmer bleibt der volle Pool als Rest", () => {
    const r = computeTipPool({
      distributionMode: "headcount",
      kitchenPoolCents: 0,
      servicePoolCents: 5_000,
      settlements: [],
      timeEntries: [],
      staffDepartments: depts,
      staffParticipates: participatesAll([]),
    });
    expect(r.shares).toHaveLength(0);
    expect(r.serviceRemainder).toBe(5_000);
  });
});
