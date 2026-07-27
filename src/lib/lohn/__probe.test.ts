import { describe, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aggregateSfnPeriod } from "@/lib/lohn/lohn-period.functions";

type Row = Record<string, unknown>;
function makeQuery(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  const b: Record<string, unknown> = {};
  const apply = () => rows.filter((r) => filters.every((f) => f(r)));
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    gte: (k: string, v: string | number) => (filters.push((r) => (r[k] as string | number) >= v), b),
    lte: (k: string, v: string | number) => (filters.push((r) => (r[k] as string | number) <= v), b),
    not: (k: string, _o: string, v: unknown) => (filters.push((r) => r[k] !== v), b),
    in: (k: string, list: unknown[]) => (filters.push((r) => list.includes(r[k])), b),
    order: () => b,
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (resolve: any, reject?: any) => Promise.resolve({ data: apply(), error: null }).then(resolve, reject),
  });
  return b;
}
const ORG = "org-lg3b-mehrsatz";
const GL = "SKILL-GL";
const berlinISO = (d: string, hh: string) => `${d}T${hh}:00+02:00`;
const entry = (bd: string, s: string, e: string, ed?: string) => ({
  staff_id: "S", business_date: bd, started_at: berlinISO(bd, s), ended_at: berlinISO(ed ?? bd, e),
  break_minutes: 0, source: "manual", department: null,
});
const rs = (sd: string, area: string | null, skill: string | null) => ({
  organization_id: ORG, staff_id: "S", shift_date: sd, area, skill_id: skill,
});
const tables: Record<string, Row[]> = {
  staff: [{ id: "S", organization_id: ORG }],
  staff_compensation: [{ staff_id: "S", hourly_rate: 22 }],
  staff_compensation_rates: [
    { staff_id: "S", department: "gl", valid_from: "2025-01-01", hourly_rate: 22 },
    { staff_id: "S", department: "service", valid_from: "2025-01-01", hourly_rate: 16 },
  ],
  staff_locations: [{ staff_id: "S", department: "gl" }, { staff_id: "S", department: "service" }],
  staff_personal_details: [{ staff_id: "S", is_minijob: false }],
  organization_settings: [{ organization_id: ORG, pausen_bezahlt: true }],
  lohn_absence_days: [], lohn_recurring_zeilen: [], roster_absence: [],
  skills: [{ id: GL, organization_id: ORG, category: "gl" }],
  roster_shifts: [
    rs("2026-07-05", null, GL), rs("2026-07-12", null, GL), rs("2026-07-19", null, GL), rs("2026-07-26", null, GL),
    rs("2026-07-03", null, GL), rs("2026-07-10", null, GL), rs("2026-07-17", null, GL),
    rs("2026-07-24", null, GL), rs("2026-07-31", null, GL),
    rs("2026-07-04", "service", null), rs("2026-07-11", "service", null), rs("2026-07-18", "service", null),
    rs("2026-07-25", "service", null),
  ],
  time_entries: [
    entry("2026-07-05","12:00","20:00"), entry("2026-07-12","12:00","19:45"),
    entry("2026-07-19","12:00","20:00"), entry("2026-07-26","13:00","20:00"),
    entry("2026-07-03","20:00","23:45"), entry("2026-07-10","20:00","24:00"),
    entry("2026-07-17","21:00","24:00"),
    entry("2026-07-24","20:00","04:30","2026-07-25"),
    entry("2026-07-31","20:00","00:30","2026-08-01"),
    entry("2026-07-04","20:00","24:00"), entry("2026-07-11","20:00","24:00"),
    entry("2026-07-18","20:00","23:00"),
    entry("2026-07-25","20:00","03:45","2026-07-26"),
  ],
};
const stub = { from: (t: string) => makeQuery(tables[t] ?? []) } as unknown as SupabaseClient<Database>;

describe("probe", () => {
  it("dumps buckets", async () => {
    const r = await aggregateSfnPeriod(stub, "S", "2026-07-01", "2026-07-31");
    console.log(JSON.stringify({
      totalHours: r.totalHours,
      hourlyRateCents: r.hourlyRateCents,
      zuschlagCents: r.zuschlagCents,
      deptBuckets: r.deptBuckets,
      slices: r.deptSlices,
    }, null, 2));
  });
});
