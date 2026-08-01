// M-Statistik S-7 — Read-Server-Fn: Trinkgeld-Kennzahlen pro Kalendermonat
// (oder freies Datumsfenster) inkl. Vorperiode + Trend.
//
// Wiederverwendung der vorhandenen Trinkgeld-Logik: computeSessionTipPoolCore
// (cash.functions.ts) liefert pro Session shares + Remainders. Diese Fn
// summiert nur — KEINE neue Trinkgeld-Formel.
//
// S-6: ALLE Session-Status werden gezählt.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import {
  computeSessionTipPoolCore,
  loadTipSettings,
  type LoadedSession,
} from "@/lib/cash/cash.functions";
import type { TipSettings } from "@/lib/cash/tip-settings";
import { computeTrend, type Trend } from "./revenue-core";
import {
  currentMonth,
  monthRange,
  previousMonthRange,
  previousRangeForDates,
} from "./period-window";
import {
  aggregateTips,
  type SessionTipResult,
  type TipDaily,
  type TipPerStaff,
  type TipTotals,
} from "./tip-aggregate";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

type Window = { startDate: string; endDate: string };

export const getTipStats = createServerFn({ method: "GET" })
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
    // TG1: Standort-Vererbung. Cache je locationId, damit der Session-Loop
    // pro Standort nur einmal lädt.
    const settingsCache = new Map<string, TipSettings>();
    async function settingsFor(locationId: string): Promise<TipSettings> {
      const hit = settingsCache.get(locationId);
      if (hit) return hit;
      const s = await loadTipSettings(org, locationId);
      settingsCache.set(locationId, s);
      return s;
    }

    // Zeitraum + Vorperiode auflösen (identisch zu getRevenueStats).
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

    async function loadTipWindow(win: Window): Promise<{
      daily: TipDaily[];
      totals: TipTotals;
      perStaff: Array<TipPerStaff & { name: string }>;
    }> {
      let sessionQuery = supabaseAdmin
        .from("sessions")
        .select("id, business_date, status, locked_at, location_id, tip_pool_settlement_only")
        .eq("organization_id", org)
        .gte("business_date", win.startDate)
        .lte("business_date", win.endDate);
      if (data.locationId) {
        sessionQuery = sessionQuery.eq("location_id", data.locationId);
      }
      const { data: sessions, error } = await sessionQuery;
      if (error) throw error;

      const results: SessionTipResult[] = [];
      const staffNames: Record<string, string> = {};
      for (const s of (sessions ?? []) as LoadedSession[]) {
        const res = await computeSessionTipPoolCore(caller, s, await settingsFor(s.location_id));
        results.push({
          businessDate: s.business_date as string,
          serviceRemainderCents: res.serviceRemainder,
          kitchenRemainderCents: res.kitchenRemainder,
          shares: res.shares.map((sh) => ({
            staffId: sh.staffId,
            department: sh.department,
            shareCents: sh.shareCents,
          })),
        });
        for (const [staffId, name] of Object.entries(res.staffNames)) {
          if (!staffNames[staffId]) staffNames[staffId] = name;
        }
      }
      return aggregateTips(results, staffNames);
    }

    const cur = await loadTipWindow(current);

    // U5a: Vorperiode im Monatsmodus auf letzten Tag mit Trinkgeld klemmen.
    let lastDataDay: string | null = null;
    let isPartial = false;
    if (monthForClamp) {
      const daysWithData = cur.daily
        .filter((d) => d.serviceCents + d.kitchenCents > 0)
        .map((d) => d.businessDate);
      lastDataDay = daysWithData.length > 0 ? daysWithData.reduce((a, b) => (a > b ? a : b)) : null;
      const monthLastDay = Number(monthRange(monthForClamp).endDate.slice(8, 10));
      const throughDay = lastDataDay ? Number(lastDataDay.slice(8, 10)) : null;
      isPartial = throughDay !== null && throughDay < monthLastDay;
      if (lastDataDay === null) {
        previous = null;
      } else if (isPartial && throughDay !== null) {
        previous = previousMonthRange(monthForClamp, throughDay);
      }
    }

    const prev = previous ? await loadTipWindow(previous) : null;

    const trend: { total: Trend; service: Trend; kitchen: Trend } | null = prev
      ? {
          total: computeTrend(cur.totals.totalCents, prev.totals.totalCents),
          service: computeTrend(cur.totals.serviceCents, prev.totals.serviceCents),
          kitchen: computeTrend(cur.totals.kitchenCents, prev.totals.kitchenCents),
        }
      : null;

    return {
      range: { startDate: current.startDate, endDate: current.endDate, label },
      daily: cur.daily,
      totals: cur.totals,
      perStaff: cur.perStaff,
      previous: prev ? prev.totals : null,
      // Vergleichsfenster (nach U5a-Klemmung) für die UI-Untertitel.
      previousRange:
        prev && previous ? { startDate: previous.startDate, endDate: previous.endDate } : null,
      trend,
      coverage: { lastDataDay, isPartial },
    };
  });
