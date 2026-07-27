/**
 * LG3b — Etappe 2a-0: Alt-Baseline einfrieren (§104-Beweis für A6).
 *
 * Drei kompakte Perioden-Fixtures, modelliert nach realen Juli-Mustern
 * (Service-only nach JOY, Küche-only nach GLAU, voller SFN nach NET), laufen
 * durch den UNVERÄNDERTEN Alt-Pfad `aggregateSfnPeriod` + `computeLohnForStaff`
 * (Anker-Stand vor 2a-ii). Die Ausgaben sind hier als Inline-Snapshots
 * eingefroren.
 *
 * Sinn der Datei:
 *   - Auf dem Anker-Stand (2a-0-Commit) ist der Test trivial grün — er
 *     dokumentiert den Ist-Stand als Soll.
 *   - Ab 2a-ii ändern sich Motor und Pfad (bereichsweise Sätze/Buckets).
 *     Die Ein-Bereichs-Fälle (A/B/C: alle Zeilen im selben Bereich) MÜSSEN
 *     bit-identisch grün bleiben — Nullmessung für Verhaltenserhalt.
 *   - LAM/MO-Mehrsatz-Fixtures werden separat in 2a-Nullmessung gebaut.
 *
 * pausen_bezahlt=true (PB1-Default), break_minutes=0 (Golden-Master-Regel).
 * Referenzperiode (91 Tage vor `fromDate`) leer → avgSfnTagCent=0,
 * urlaubTage/krankTage geschätzt = 0.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeLohnForStaff } from "./lohn-rechner.functions";

// ---------- Stub-Fabrik --------------------------------------------------

type Row = Record<string, unknown>;
type Table =
  | "staff"
  | "staff_compensation"
  | "staff_personal_details"
  | "organization_settings"
  | "time_entries"
  | "lohn_absence_days"
  | "lohn_recurring_zeilen"
  | "roster_absence";

interface StubTables {
  staff: Row[];
  staff_compensation: Row[];
  staff_personal_details: Row[];
  organization_settings: Row[];
  time_entries: Row[];
  lohn_absence_days: Row[];
  lohn_recurring_zeilen: Row[];
  roster_absence: Row[];
}

/**
 * Kettbarer Query-Builder, der die im Alt-Pfad tatsächlich benutzten Operatoren
 * abbildet: `.select`, `.eq`, `.gte`, `.lte`, `.not`, `.in`, `.order`,
 * `.maybeSingle` sowie direkte Awaits. Kein PostgREST-Feature-Overkill —
 * nur was hier gebraucht wird.
 */
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

// ---------- Fixture-Konstruktoren ---------------------------------------

const ORG = "org-2a0";

function personalDetails(overrides: Partial<Row> = {}): Row {
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
    ...overrides,
  };
}

/** Berlin-Ortszeit HH:MM auf `date` → UTC-ISO (Sommerzeit → -02:00). */
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
  };
}

// ---------- Fall A — Service-only nach JOY-Muster ------------------------
// 8× Fr/Sa/So 17:00-23:15 = 8×6,25 h = 50 h. Hourly 14 €.
// Sonntag-Schichten liefern volle Sonntagsstunden, keine Nacht40, kein Nacht25.

const FIXTURE_A: StubTables = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ hourly_rate: 14.0 }],
  staff_personal_details: [{ staff_id: "S", ...personalDetails() }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [],
  lohn_recurring_zeilen: [],
  roster_absence: [],
  time_entries: [
    entry("2026-07-03", "17:00", "23:15"),
    entry("2026-07-04", "17:00", "23:15"),
    entry("2026-07-05", "17:00", "23:15"),
    entry("2026-07-10", "17:00", "23:15"),
    entry("2026-07-11", "17:00", "23:15"),
    entry("2026-07-12", "17:00", "23:15"),
    entry("2026-07-17", "17:00", "23:15"),
    entry("2026-07-18", "17:00", "23:15"),
  ],
};

// ---------- Fall B — Küche-only nach GLAU-Muster -------------------------
// 8× Mo-Fr 10:00-14:00 = 32 h. Hourly 15 €. Kein SFN.

const FIXTURE_B: StubTables = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ hourly_rate: 15.0 }],
  staff_personal_details: [{ staff_id: "S", ...personalDetails() }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [],
  lohn_recurring_zeilen: [],
  roster_absence: [],
  time_entries: [
    entry("2026-07-06", "10:00", "14:00"),
    entry("2026-07-07", "10:00", "14:00"),
    entry("2026-07-08", "10:00", "14:00"),
    entry("2026-07-09", "10:00", "14:00"),
    entry("2026-07-10", "10:00", "14:00"),
    entry("2026-07-13", "10:00", "14:00"),
    entry("2026-07-14", "10:00", "14:00"),
    entry("2026-07-15", "10:00", "14:00"),
  ],
};

// ---------- Fall C — Volles SFN-Spektrum nach NET/CHEFIN-Muster ---------
// Fr 03.07 & Fr 10.07: 18:00-24:00 (6h; Nacht25 20-24 = 4h)
// Sa 04.07 & Sa 11.07: 20:00-04:00 nächster Tag (8h; Nacht25 20-24 = 4h,
//   Sonntag 00-04 = 4h, davon Nacht40 00-04 = 4h)
// Gesamt: 2×6 + 2×8 = 28 h. Hourly 16 €.

const FIXTURE_C: StubTables = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ hourly_rate: 16.0 }],
  staff_personal_details: [{ staff_id: "S", ...personalDetails() }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [],
  lohn_recurring_zeilen: [],
  roster_absence: [],
  time_entries: [
    entry("2026-07-03", "18:00", "24:00"),
    entry("2026-07-04", "20:00", "04:00", "2026-07-05"),
    entry("2026-07-10", "18:00", "24:00"),
    entry("2026-07-11", "20:00", "04:00", "2026-07-12"),
  ],
};

// ---------- Runner ------------------------------------------------------

async function runBaseline(tables: StubTables) {
  const stub = makeStub(tables);
  const r = await computeLohnForStaff(stub, {
    staffId: "S",
    organizationId: ORG,
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    mode: "extended",
    zusatzZeilen: [],
  });
  return {
    totalHours: r.totalHours,
    hourlyRateCents: r.hourlyRateCents,
    workdayCount: r.workdayCount,
    entryCount: r.entryCount,
    zuschlagCents: r.zuschlagCents,
    buckets: {
      night25Hours: r.buckets.night25Hours,
      night40Hours: r.buckets.night40Hours,
      sundayHours: r.buckets.sundayHours,
      holidayHours: r.buckets.holidayHours,
    },
    bruttoCents: r.ergebnis.gesamtbruttoCent,
    stBruttoAusweisCent: r.ergebnis.stBruttoAusweisCent,
    lstCent: r.ergebnis.lstCent,
    soliCent: r.ergebnis.soliCent,
    kistCent: r.ergebnis.kistCent,
    kvCent: r.ergebnis.kvCent,
    rvCent: r.ergebnis.rvCent,
    avCent: r.ergebnis.avCent,
    pvCent: r.ergebnis.pvCent,
    nettoCents: r.ergebnis.gesamtnettoCent,
    auszahlungCents: r.ergebnis.auszahlungCent,
  };
}

describe("LG3b 2a-0 — Alt-Baseline (eingefroren gegen den Anker-Stand)", () => {
  it("Fall A — Service-only nach JOY-Muster (Fr/Sa/So 17:00-23:15, 50 h, 14 €)", async () => {
    const out = await runBaseline(FIXTURE_A);
    expect(out).toMatchInlineSnapshot(`
      {
        "auszahlungCents": 0,
        "avCent": 0,
        "bruttoCents": 0,
        "buckets": {
          "holidayHours": 0,
          "night25Hours": 26,
          "night40Hours": 0,
          "sundayHours": 12.5,
        },
        "entryCount": 8,
        "hourlyRateCents": 0,
        "kistCent": 0,
        "kvCent": 0,
        "lstCent": 0,
        "nettoCents": 0,
        "pvCent": 0,
        "rvCent": 0,
        "soliCent": 0,
        "stBruttoAusweisCent": 0,
        "totalHours": 50,
        "workdayCount": 8,
        "zuschlagCents": 0,
      }
    `);
  });

  it("Fall B — Küche-only nach GLAU-Muster (Mo-Fr 10:00-14:00, 32 h, 15 €)", async () => {
    const out = await runBaseline(FIXTURE_B);
    expect(out).toMatchInlineSnapshot(`
      {
        "auszahlungCents": 0,
        "avCent": 0,
        "bruttoCents": 0,
        "buckets": {
          "holidayHours": 0,
          "night25Hours": 0,
          "night40Hours": 0,
          "sundayHours": 0,
        },
        "entryCount": 8,
        "hourlyRateCents": 0,
        "kistCent": 0,
        "kvCent": 0,
        "lstCent": 0,
        "nettoCents": 0,
        "pvCent": 0,
        "rvCent": 0,
        "soliCent": 0,
        "stBruttoAusweisCent": 0,
        "totalHours": 32,
        "workdayCount": 8,
        "zuschlagCents": 0,
      }
    `);
  });

  it("Fall C — Volles SFN-Spektrum nach NET-Muster (Nacht + Sonntag, 28 h, 16 €)", async () => {
    const out = await runBaseline(FIXTURE_C);
    expect(out).toMatchInlineSnapshot(`
      {
        "auszahlungCents": 0,
        "avCent": 0,
        "bruttoCents": 0,
        "buckets": {
          "holidayHours": 0,
          "night25Hours": 16,
          "night40Hours": 8,
          "sundayHours": 0,
        },
        "entryCount": 4,
        "hourlyRateCents": 0,
        "kistCent": 0,
        "kvCent": 0,
        "lstCent": 0,
        "nettoCents": 0,
        "pvCent": 0,
        "rvCent": 0,
        "soliCent": 0,
        "stBruttoAusweisCent": 0,
        "totalHours": 28,
        "workdayCount": 4,
        "zuschlagCents": 0,
      }
    `);
  });
});