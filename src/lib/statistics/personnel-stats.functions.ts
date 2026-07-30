// M-Statistik S-8 / ST1-A — Read-Server-Fn: Personalquote-Basisdaten pro
// Kalendermonat (oder freies Datumsfenster) inkl. Vorperiode + Trend.
//
// EHRLICHKEITSREGEL: liefert *Basis-Brutto-Lohnkosten* (Netto-Stunden ×
// Bereichs-Stundensatz aus `staff_compensation_rates`). Bewusst NICHT
// enthalten: Arbeitgeber-SV-Anteil, SFN-Zuschläge. Werte sind eine
// Näherung — NICHT die volle Arbeitgeberkostenquote.
//
// ST1-A: Attribution je Zeiteintrag über `attributeEntry` (LG3b) und
// Satz-Auflösung über `resolveRateCents` — dieselben Funktionen wie im
// Lohnpfad. Der Alt-Skalar `staff_compensation.hourly_rate` wird hier
// nicht mehr gelesen. Stunden ohne Satz werden ausgewiesen (Variant B).
//
// Die Personalquote selbst (cost/revenue) wird hier nicht gerechnet.
// Die UI kombiniert getPersonnelStats + getRevenueStats und ruft
// personnelRatioPct(...) aus personnel-core (einzige Quote-Definition).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { grossMinutesBetween } from "@/lib/time/break-rules";
import { paidMinutes } from "@/lib/time/paid-hours";
import { selectAllPaged } from "@/lib/supabase/select-all";
import type { Department } from "@/lib/time/primary-department";
import { computeTrend, type Trend } from "./revenue-core";
import {
  currentMonth,
  monthRange,
  previousMonthRange,
  previousRangeForDates,
} from "./period-window";
import { aggregatePersonnel, type PersonnelAgg, type WorkEntry } from "./personnel-core";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

type Window = { startDate: string; endDate: string };

type WindowResult = {
  agg: PersonnelAgg;
  totalNetMinutes: number; // ganzzahlig, für Trend
  staffIds: string[];
  lastDataDay: string | null; // max business_date mit netMinutes > 0
};

export const getPersonnelStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        month: z.string().regex(MONTH_RE).optional(),
        startDate: z.string().regex(DATE_RE).optional(),
        endDate: z.string().regex(DATE_RE).optional(),
        locationId: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const org = caller.organizationId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // PB2 — Vergütungsminuten der Personalquote folgen dem Org-Schalter
    // `pausen_bezahlt` (Default TRUE). Einmal je Request geladen; SFN-Töpfe
    // sind hier nicht beteiligt.
    const { data: orgSet, error: orgSetErr } = await supabaseAdmin
      .from("organization_settings")
      .select("pausen_bezahlt")
      .eq("organization_id", org)
      .maybeSingle();
    if (orgSetErr) throw orgSetErr;
    const pausenBezahlt = orgSet?.pausen_bezahlt ?? true;

    // Zeitraum + Vorperiode auflösen (identisch zu getTipStats).
    let current: Window;
    let previous: Window | null;
    let label: string | null;
    let monthForClamp: string | null = null;

    if (data.month) {
      current = monthRange(data.month);
      previous = previousMonthRange(data.month);
      label = data.month;
      monthForClamp = data.month;
    } else if (data.startDate && data.endDate) {
      if (data.endDate < data.startDate) {
        throw new Error("endDate muss ≥ startDate sein.");
      }
      current = { startDate: data.startDate, endDate: data.endDate };
      previous = previousRangeForDates(data.startDate, data.endDate);
      label = null;
    } else if (!data.startDate && !data.endDate) {
      const m = currentMonth();
      current = monthRange(m);
      previous = previousMonthRange(m);
      label = m;
      monthForClamp = m;
    } else {
      throw new Error("startDate und endDate müssen gemeinsam gesetzt sein.");
    }

    async function loadWindow(win: Window): Promise<WindowResult> {
      // BFIX3: PostgREST kappt bei 1000 Zeilen — paginieren, sonst fehlen
      // Zeilen bei größeren Zeiträumen/Belegschaften und die Statistik
      // wird still unvollständig.
      const rows = await selectAllPaged<{
        staff_id: string | null;
        started_at: string | null;
        ended_at: string | null;
        break_minutes: number | null;
        business_date: string | null;
        location_id: string | null;
        department: string | null;
        id: string;
      }>((from, to) => {
        let q = supabaseAdmin
          .from("time_entries")
          .select(
            "id, staff_id, started_at, ended_at, break_minutes, business_date, location_id, department",
          )
          .eq("organization_id", org)
          .gte("business_date", win.startDate)
          .lte("business_date", win.endDate)
          .not("ended_at", "is", null)
          .order("id", { ascending: true });
        if (data.locationId) q = q.eq("location_id", data.locationId);
        return q.range(from, to);
      });

      type RawEntry = {
        staffId: string;
        businessDate: string;
        netMinutes: number;
        rawDepartment: Department | null;
      };
      const raw: RawEntry[] = [];
      const staffIdSet = new Set<string>();
      let totalNetMinutes = 0;
      let lastDataDay: string | null = null;
      for (const r of rows ?? []) {
        if (!r.ended_at || !r.started_at || !r.business_date || !r.staff_id) continue;
        const gross = grossMinutesBetween(new Date(r.started_at), new Date(r.ended_at));
        const net = paidMinutes(gross, r.break_minutes ?? 0, pausenBezahlt);
        totalNetMinutes += net;
        staffIdSet.add(r.staff_id);
        if (net > 0 && (lastDataDay === null || r.business_date > lastDataDay)) {
          lastDataDay = r.business_date;
        }
        raw.push({
          staffId: r.staff_id,
          businessDate: r.business_date,
          netMinutes: net,
          rawDepartment: (r.department as Department | null) ?? null,
        });
      }
      const staffIds = Array.from(staffIdSet);

      // ST1-A — Bereichs-Sätze + LG3b-Attribution je Eintrag.
      const ctx = await loadPersonnelAttributionContext(
        supabaseAdmin,
        org,
        staffIds,
        win.startDate,
        win.endDate,
      );
      const entries: WorkEntry[] = raw.map((e) => {
        const attr = ctx.attribute({
          staffId: e.staffId,
          businessDate: e.businessDate,
          rawDepartment: e.rawDepartment,
        });
        return {
          staffId: e.staffId,
          businessDate: e.businessDate,
          netMinutes: e.netMinutes,
          department: attr.department,
          unresolved: attr.unresolved,
        };
      });

      const agg = aggregatePersonnel(entries, ctx.ratesByStaff);
      return { agg, totalNetMinutes, staffIds, lastDataDay };
    }

    const cur = await loadWindow(current);

    // U5a: Vorperiode im Monatsmodus auf letzten Tag mit Arbeitszeit klemmen.
    let isPartial = false;
    if (monthForClamp) {
      const monthLastDay = Number(monthRange(monthForClamp).endDate.slice(8, 10));
      const throughDay = cur.lastDataDay ? Number(cur.lastDataDay.slice(8, 10)) : null;
      isPartial = throughDay !== null && throughDay < monthLastDay;
      if (cur.lastDataDay === null) {
        previous = null;
      } else if (isPartial && throughDay !== null) {
        previous = previousMonthRange(monthForClamp, throughDay);
      }
    }

    const prev = previous ? await loadWindow(previous) : null;

    // Staff-Namen für perStaff (Pattern aus cash.functions.ts: id, display_name).
    const nameIds = cur.agg.perStaff.map((p) => p.staffId);
    const staffNames: Record<string, string> = {};
    if (nameIds.length > 0) {
      const { data: staffRows, error: staffErr } = await supabaseAdmin
        .from("staff")
        .select("id, display_name")
        .eq("organization_id", org)
        .in("id", nameIds);
      if (staffErr) throw staffErr;
      for (const s of staffRows ?? []) {
        staffNames[s.id] = s.display_name ?? s.id;
      }
    }

    const trend: { hours: Trend; cost: Trend } | null = prev
      ? {
          // Trend auf ganzzahligen Netto-Minuten (computeTrend erwartet ints).
          hours: computeTrend(cur.totalNetMinutes, prev.totalNetMinutes),
          cost: computeTrend(cur.agg.totalLaborCostCents, prev.agg.totalLaborCostCents),
        }
      : null;

    return {
      range: { startDate: current.startDate, endDate: current.endDate, label },
      totals: {
        netHours: cur.agg.totalNetHours,
        laborCostCents: cur.agg.totalLaborCostCents,
        unratedNetHours: cur.agg.unratedNetHours,
      },
      perStaff: cur.agg.perStaff.map((p) => ({
        staffId: p.staffId,
        name: staffNames[p.staffId] ?? p.staffId,
        netHours: p.netHours,
        laborCostCents: p.laborCostCents,
        unratedNetHours: p.unratedNetHours,
      })),
      staffWithoutRate: cur.agg.staffWithoutRate,
      previous: prev
        ? {
            netHours: prev.agg.totalNetHours,
            laborCostCents: prev.agg.totalLaborCostCents,
          }
        : null,
      trend,
      coverage: { lastDataDay: cur.lastDataDay, isPartial },
    };
  });
