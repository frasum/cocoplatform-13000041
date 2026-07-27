/**
 * LG3b — 2a-iii-b Abnahme: Mehrsatz-Fixtures (LAM & MO).
 *
 * Zweck: sichern, dass der Motor mit mehreren benutzten Bereichen
 *   * die Zeitlohn-Zeilen bereichsweise mit der Etappe-1-Kategorie und dem
 *     bereichsspezifischen Satz erzeugt (A3),
 *   * die SFN-Töpfe je Bereich mit dem jeweiligen Bereichssatz vergütet
 *     (A2 / LG3b-Kern),
 *   * den Legacy-Skalar `hourlyRateCents` auf `null` setzt (M4),
 *   * die Summe der bereichs-paidHours mit `totalHours` deckt.
 *
 * Die Attribution erfolgt ausschließlich durch den Motor: der Stub liefert
 * `roster_shifts` (area / skill_id) plus die `skills`-Tabelle; die Einträge
 * tragen `department: null`. Keine Attribution am Motor vorbei.
 *
 * pausen_bezahlt = true (PB1-Default), break_minutes = 0, Referenzperiode
 * (91 Tage vor `fromDate`) leer → keine U/K-Wirkung.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeLohnForStaff } from "./lohn-rechner.functions";

// ---------- Stub (deckungsgleich zur 2a-0-Baseline) ---------------------

type Row = Record<string, unknown>;
type Table =
  | "staff"
  | "staff_compensation"
  | "staff_compensation_rates"
  | "staff_locations"
  | "staff_personal_details"
  | "organization_settings"
  | "time_entries"
  | "lohn_absence_days"
  | "lohn_recurring_zeilen"
  | "roster_absence"
  | "roster_shifts"
  | "skills";

interface StubTables {
  staff: Row[];
  staff_compensation: Row[];
  staff_compensation_rates: Row[];
  staff_locations: Row[];
  staff_personal_details: Row[];
  organization_settings: Row[];
  time_entries: Row[];
  lohn_absence_days: Row[];
  lohn_recurring_zeilen: Row[];
  roster_absence: Row[];
  roster_shifts: Row[];
  skills: Row[];
}

function makeQuery(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  const builder: Record<string, unknown> = {};
  const apply = () => rows.filter((r) => filters.every((f) => f(r)));
  Object.assign(builder, {
    select: () => builder,
    eq: (k: string, v: unknown) => {
      filters.push((r) => r[k] === v);
      return builder;
    },
    gte: (k: string, v: string | number) => {
      filters.push((r) => (r[k] as string | number) >= v);
      return builder;
    },
    lte: (k: string, v: string | number) => {
      filters.push((r) => (r[k] as string | number) <= v);
      return builder;
    },
    not: (k: string, _op: string, v: unknown) => {
      filters.push((r) => r[k] !== v);
      return builder;
    },
    in: (k: string, list: unknown[]) => {
      filters.push((r) => list.includes(r[k]));
      return builder;
    },
    order: () => builder,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (
      resolve: (v: { data: Row[]; error: null }) => unknown,
      reject?: (r: unknown) => unknown,
    ) => Promise.resolve({ data: apply(), error: null }).then(resolve, reject),
  });
  return builder;
}

function makeStub(tables: StubTables): SupabaseClient<Database> {
  return {
    from: (t: Table) => makeQuery(tables[t] ?? []),
  } as unknown as SupabaseClient<Database>;
}

const ORG = "org-lg3b-mehrsatz";
const GL_SKILL = "SKILL-GL";

function personalDetails(): Row {
  return {
    tax_class: "III",
    child_tax_allowances: 0,
    kk_zusatzbeitrag: 1.7,
    church_tax_liable: false,
    children_count: 0,
    has_parent_status: false,
    is_minijob: false,
    date_of_birth: "1985-06-15",
    meal_allowance: false,
    sachbezug_monthly_cents: 0,
    soll_hours_per_day: 8,
    rv_frei: false,
    av_frei: false,
    lst_freibetrag_monat_cent: 0,
    is_midijob: false,
    kv_frei: false,
    pv_frei: false,
    is_pkv: false,
    pkv_basis_beitrag_monat_cent: 0,
    ist_werkstudent: false,
  };
}

/** Berlin-Ortszeit HH:MM auf `date` → UTC-ISO (Sommerzeit → +02:00). */
function berlinISO(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+02:00`;
}

function entry(businessDate: string, start: string, end: string, endDate?: string): Row {
  return {
    staff_id: "S",
    business_date: businessDate,
    started_at: berlinISO(businessDate, start),
    ended_at: berlinISO(endDate ?? businessDate, end),
    break_minutes: 0,
    source: "manual",
    department: null, // Attribution ausschließlich über Roster-Signale.
  };
}

function rosterShift(shiftDate: string, area: string | null, skillId: string | null): Row {
  return {
    organization_id: ORG,
    staff_id: "S",
    shift_date: shiftDate,
    area,
    skill_id: skillId,
  };
}

// ============================================================================
// Fixture 1 — LAM-Muster (GL + Service), reale edlohn-Juli-Referenz.
// ============================================================================
//
// Ziel-SFN-Töpfe (siehe docs/LG3b-bereichs-saetze.md):
//   GL      → Nacht25 = 18,75 h · Nacht40 = 4,50 h · Sonntag = 30,75 h
//   Service → Nacht25 = 15,00 h · Nacht40 = 3,75 h · Sonntag = 0
//
// GL-Schichten (roster_shifts: skill_id = GL-Skill, area = null → Motor
// routet über `rosterHasGlSkill` auf GL):
//   Sonntag-Blöcke (rein tagsüber, kein Nacht-Anteil):
//     So 05.07 12:00-20:00 = 8,00 h Sonntag
//     So 12.07 12:00-19:45 = 7,75 h Sonntag
//     So 19.07 12:00-20:00 = 8,00 h Sonntag
//     So 26.07 13:00-20:00 = 7,00 h Sonntag
//   Nacht25-Blöcke (Fri, kein Midnight-Crossing):
//     Fr 03.07 20:00-23:45 = 3,75 h Nacht25
//     Fr 10.07 20:00-24:00 = 4,00 h Nacht25
//     Fr 17.07 21:00-24:00 = 3,00 h Nacht25
//   Crossing-Schichten (Fri → Sat, businessDate Fri, kein Sonntag-Effekt):
//     Fr 24.07 20:00-04:30 (+1) → Nacht25 4,00 h + Nacht40 4,00 h + 0,50 h neutral
//     Fr 31.07 20:00-00:30 (+1) → Nacht25 4,00 h + Nacht40 0,50 h
//   GL-Zeitlohn-Stunden (paidHours, break=0, pausen_bezahlt=true):
//     8,00 + 7,75 + 8,00 + 7,00                       = 30,75 h Sonntag
//     3,75 + 4,00 + 3,00                              = 10,75 h Fri-Nacht25
//     (4,00 + 4,00 + 0,50) + (4,00 + 0,50)            = 13,00 h Crossings
//     ---------------------------------------------------------------
//     Σ GL paidHours                                  = 54,50 h
//     Kontroll-Zerlegung: Nacht25 = 18,75 h · Nacht40 = 4,50 h · So 30,75 h ✓
//
// Service-Schichten (roster_shifts: area = 'service'):
//   Sat-Nächte (Sa, kein Midnight-Crossing):
//     Sa 04.07 20:00-24:00 = 4,00 h Nacht25
//     Sa 11.07 20:00-24:00 = 4,00 h Nacht25
//     Sa 18.07 20:00-23:00 = 3,00 h Nacht25
//   Crossing (Sat → Sun, businessDate Sat, kein Sonntag-Effekt):
//     Sa 25.07 20:00-03:45 (+1) → Nacht25 4,00 h + Nacht40 3,75 h
//   Service paidHours:
//     4,00 + 4,00 + 3,00 + 7,75                       = 18,75 h
//     Kontroll-Zerlegung: Nacht25 = 15,00 h · Nacht40 = 3,75 h · So 0 ✓
//
// Gesamt: Σ paidHours = 54,50 + 18,75 = 73,25 h (deckt `totalHours`).
//
// Sätze: gl = 22,00 €/h → 2200 c · service = 16,00 €/h → 1600 c.
// Erwartete Zeitlohn-Beträge (Hand-Rechnung):
//   GL       Zeitlohn 2  54,50 h × 2200 c = 119.900 c
//   Service  Zeitlohn    18,75 h × 1600 c =  30.000 c
// SFN je Bereich = f(Bucket, Satz) mit dem jeweiligen Bereichssatz — die
// Zerlegung in Nacht25 / Nacht40 / Sonntag oben ist die Handrechnungsbasis.

const FIXTURE_LAM: StubTables = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ staff_id: "S", hourly_rate: 22.0 }],
  staff_compensation_rates: [
    { staff_id: "S", department: "gl", valid_from: "2025-01-01", hourly_rate: 22.0 },
    { staff_id: "S", department: "service", valid_from: "2025-01-01", hourly_rate: 16.0 },
  ],
  staff_locations: [
    { staff_id: "S", department: "gl" },
    { staff_id: "S", department: "service" },
  ],
  staff_personal_details: [{ staff_id: "S", ...personalDetails() }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [],
  lohn_recurring_zeilen: [],
  roster_absence: [],
  roster_shifts: [
    // GL — Sonntage
    rosterShift("2026-07-05", null, GL_SKILL),
    rosterShift("2026-07-12", null, GL_SKILL),
    rosterShift("2026-07-19", null, GL_SKILL),
    rosterShift("2026-07-26", null, GL_SKILL),
    // GL — Fri Nacht25
    rosterShift("2026-07-03", null, GL_SKILL),
    rosterShift("2026-07-10", null, GL_SKILL),
    rosterShift("2026-07-17", null, GL_SKILL),
    // GL — Crossing
    rosterShift("2026-07-24", null, GL_SKILL),
    rosterShift("2026-07-31", null, GL_SKILL),
    // Service — Sat Nacht25
    rosterShift("2026-07-04", "service", null),
    rosterShift("2026-07-11", "service", null),
    rosterShift("2026-07-18", "service", null),
    // Service — Crossing
    rosterShift("2026-07-25", "service", null),
  ],
  skills: [{ id: GL_SKILL, organization_id: ORG, category: "gl" }],
  time_entries: [
    // GL — Sonntage
    entry("2026-07-05", "12:00", "20:00"),
    entry("2026-07-12", "12:00", "19:45"),
    entry("2026-07-19", "12:00", "20:00"),
    entry("2026-07-26", "13:00", "20:00"),
    // GL — Fri Nacht25
    entry("2026-07-03", "20:00", "23:45"),
    entry("2026-07-10", "20:00", "24:00"),
    entry("2026-07-17", "21:00", "24:00"),
    // GL — Crossing Fri → Sat
    entry("2026-07-24", "20:00", "04:30", "2026-07-25"),
    entry("2026-07-31", "20:00", "00:30", "2026-08-01"),
    // Service — Sat Nacht25
    entry("2026-07-04", "20:00", "24:00"),
    entry("2026-07-11", "20:00", "24:00"),
    entry("2026-07-18", "20:00", "23:00"),
    // Service — Crossing Sat → Sun (Sonntag-Anteil zählt in Sat-businessDate
    // NICHT als sundayHours, deckt Fixture-C-Muster aus 2a-0).
    entry("2026-07-25", "20:00", "03:45", "2026-07-26"),
  ],
};

// ============================================================================
// Fixture 2 — MO-Muster (drei Bereiche, alle 23,00 €/h).
// ============================================================================
//
// Alle drei Bereichs-Sätze auf 2300 c: der Motor MUSS trotzdem drei getrennte
// Zeitlohn-Zeilen mit ihren Etappe-1-Kategorien erzeugen. Aggregat-Skalar
// bleibt `null` (M4), weil mehr als ein Bereich benutzt wird — auch bei
// identischem Satz.
//
// Schichten (rein Nicht-Sonntag, keine SFN-Überlappung — die Frage ist die
// Zeilen-Kategorisierung, nicht die SFN-Verteilung):
//   Kitchen (roster area='kitchen'):  Mo 06.07 10:00-14:00 · Mi 08.07 10:00-14:00
//                                     → 4 + 4 = 8,00 h
//   Service (roster area='service'):  Di 07.07 12:00-16:00 · Do 09.07 12:00-16:00
//                                     → 4 + 4 = 8,00 h
//   GL      (roster skill=GL):        Fr 10.07 10:00-14:00 · Mo 13.07 10:00-14:00
//                                     → 4 + 4 = 8,00 h
// Σ paidHours = 24,00 h · Σ Bereichs-Beträge = 24,00 × 2300 = 55.200 c
// (gleicher Satz ⇒ keine Rundungsdrift).

const FIXTURE_MO: StubTables = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ staff_id: "S", hourly_rate: 23.0 }],
  staff_compensation_rates: [
    { staff_id: "S", department: "gl", valid_from: "2025-01-01", hourly_rate: 23.0 },
    { staff_id: "S", department: "kitchen", valid_from: "2025-01-01", hourly_rate: 23.0 },
    { staff_id: "S", department: "service", valid_from: "2025-01-01", hourly_rate: 23.0 },
  ],
  staff_locations: [
    { staff_id: "S", department: "gl" },
    { staff_id: "S", department: "kitchen" },
    { staff_id: "S", department: "service" },
  ],
  staff_personal_details: [{ staff_id: "S", ...personalDetails() }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [],
  lohn_recurring_zeilen: [],
  roster_absence: [],
  roster_shifts: [
    rosterShift("2026-07-06", "kitchen", null),
    rosterShift("2026-07-08", "kitchen", null),
    rosterShift("2026-07-07", "service", null),
    rosterShift("2026-07-09", "service", null),
    rosterShift("2026-07-10", null, GL_SKILL),
    rosterShift("2026-07-13", null, GL_SKILL),
  ],
  skills: [{ id: GL_SKILL, organization_id: ORG, category: "gl" }],
  time_entries: [
    entry("2026-07-06", "10:00", "14:00"),
    entry("2026-07-08", "10:00", "14:00"),
    entry("2026-07-07", "12:00", "16:00"),
    entry("2026-07-09", "12:00", "16:00"),
    entry("2026-07-10", "10:00", "14:00"),
    entry("2026-07-13", "10:00", "14:00"),
  ],
};

async function runMehrsatz(tables: StubTables) {
  const stub = makeStub(tables);
  return computeLohnForStaff(stub, {
    staffId: "S",
    organizationId: ORG,
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    mode: "extended",
    zusatzZeilen: [],
  });
}

describe("LG3b 2a-iii-b — Mehrsatz-Fixtures", () => {
  it("LAM-Muster (GL 22 € + Service 16 €): bereichsweise Zeitlohn- & SFN-Zeilen, Skalar null", async () => {
    const r = await runMehrsatz(FIXTURE_LAM);

    // M4 — Aggregat-Skalar bei Mehrsatz null.
    expect(r.hourlyRateCents).toBeNull();

    // Σ Bucket-paidHours === totalHours.
    const sumDeptHours = r.deptBuckets.reduce((s, b) => s + b.paidHoursUnrounded, 0);
    expect(Math.round(sumDeptHours * 100) / 100).toBe(r.totalHours);
    expect(r.totalHours).toBe(73.25);

    // Genau zwei benutzte Bereiche, korrekt attribuiert.
    const byDept = new Map(r.deptBuckets.map((b) => [b.department, b]));
    expect(byDept.get("gl")?.paidHoursUnrounded).toBeCloseTo(54.5, 6);
    expect(byDept.get("gl")?.rateCents).toBe(2200);
    expect(byDept.get("service")?.paidHoursUnrounded).toBeCloseTo(18.75, 6);
    expect(byDept.get("service")?.rateCents).toBe(1600);
    expect(byDept.get("kitchen")).toBeUndefined();

    // A3 — zwei Zeitlohn-Zeilen mit den Etappe-1-Kategorien.
    const glZeit = r.zeilen.find((z) => z.bezeichnung === "Zeitlohn 2 (GL)");
    const svZeit = r.zeilen.find((z) => z.bezeichnung === "Zeitlohn (Service)");
    expect(glZeit).toBeDefined();
    expect(svZeit).toBeDefined();
    expect(glZeit?.kategorie).toBe("zeitlohn_2");
    expect(svZeit?.kategorie).toBe("zeitlohn");
    expect(glZeit?.satzCent).toBe(2200);
    expect(svZeit?.satzCent).toBe(1600);
    // Handrechnung: 54,50 h × 2200 c = 119.900 c · 18,75 h × 1600 c = 30.000 c.
    expect(glZeit?.betragCent).toBe(119_900);
    expect(svZeit?.betragCent).toBe(30_000);

    // A2 — zwei SFN-Zeilen (je Bereich), beide mit Betrag > 0
    // (GL: Nacht25/40 + Sonntag zu 2200 c; Service: Nacht25/40 zu 1600 c).
    const sfnRows = r.zeilen.filter((z) => z.kategorie === "zuschlag_frei");
    const sfnGl = sfnRows.find((z) => z.bezeichnung.includes("(GL)"));
    const sfnSv = sfnRows.find((z) => z.bezeichnung.includes("(Service)"));
    expect(sfnGl).toBeDefined();
    expect(sfnSv).toBeDefined();
    expect(sfnGl!.betragCent).toBeGreaterThan(0);
    expect(sfnSv!.betragCent).toBeGreaterThan(0);
    // Gesamt-Zuschlag = Summe der Bereichs-SFN.
    expect(sfnGl!.betragCent + sfnSv!.betragCent).toBe(r.zuschlagCents);
  });

  it("MO-Muster (drei Bereiche, alle 23 €): drei Zeitlohn-Zeilen, Skalar null, keine Rundungsdrift", async () => {
    const r = await runMehrsatz(FIXTURE_MO);

    // M4 — Skalar auch bei identischem Satz null, sobald mehr als ein Bereich benutzt wird.
    expect(r.hourlyRateCents).toBeNull();
    expect(r.totalHours).toBe(24);

    const sumDeptHours = r.deptBuckets.reduce((s, b) => s + b.paidHoursUnrounded, 0);
    expect(Math.round(sumDeptHours * 100) / 100).toBe(r.totalHours);

    // Drei Bereichs-Slices, alle Satz 2300.
    const byDept = new Map(r.deptBuckets.map((b) => [b.department, b]));
    for (const d of ["gl", "kitchen", "service"] as const) {
      expect(byDept.get(d)?.paidHoursUnrounded).toBeCloseTo(8, 6);
      expect(byDept.get(d)?.rateCents).toBe(2300);
    }

    // A3 — drei Zeitlohn-Zeilen mit den Etappe-1-Kategorien, je Satz 2300.
    const glZeit = r.zeilen.find((z) => z.bezeichnung === "Zeitlohn 2 (GL)");
    const kiZeit = r.zeilen.find((z) => z.bezeichnung === "Zeitlohn 3 (Küche)");
    const svZeit = r.zeilen.find((z) => z.bezeichnung === "Zeitlohn (Service)");
    expect(glZeit?.kategorie).toBe("zeitlohn_2");
    expect(kiZeit?.kategorie).toBe("zeitlohn_3");
    expect(svZeit?.kategorie).toBe("zeitlohn");
    for (const z of [glZeit, kiZeit, svZeit]) {
      expect(z?.satzCent).toBe(2300);
      expect(z?.stunden).toBeCloseTo(8, 6);
      expect(z?.betragCent).toBe(8 * 2300); // 18.400 c je Bereich
    }

    // Summe der drei Zeilen-Beträge === paidHours-Gesamt × 2300
    // (gleicher Satz ⇒ keine Rundungsdrift).
    const sumBetrag = (glZeit!.betragCent + kiZeit!.betragCent + svZeit!.betragCent);
    expect(sumBetrag).toBe(24 * 2300);
  });
});