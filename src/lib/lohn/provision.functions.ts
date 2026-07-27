// P1 — Provision Server-Layer.
//
// Zwei Server-Functions:
//   * getProvisionOverview: reine Leseoperation, gated auf
//     manager/admin/payroll. Kurzschluss bei commission_enabled=false —
//     dann keinerlei Datenzugriffe (der Schalter schaltet WIRKLICH ab).
//   * updateCommissionSettings: admin-only, runGuarded + Audit
//     (`provision.settings_changed`, meta = before/after).
//
// Reine Rechnung liegt in `provision-calc.ts` — hier passiert nur I/O.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runGuarded } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";
import { entryNetMinutes } from "@/lib/time/my-period-hours";
import { dropPoolWhenRealEntryExists } from "@/lib/cash/pool-time-writeback";
import {
  computeProvisionPool,
  distributeProvision,
  type ProvisionDayBreakdown,
  type ProvisionDayInput,
  type ProvisionSettings,
} from "./provision-calc";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export type ProvisionOverviewRow = {
  staffId: string;
  displayName: string;
  minutes: number;
  provisionCents: number;
};

export type ProvisionOverviewResult =
  | { enabled: false }
  | {
      enabled: true;
      settings: ProvisionSettings;
      poolCents: number;
      dayBreakdown: ProvisionDayBreakdown[];
      rows: ProvisionOverviewRow[];
    };

const overviewInput = z.object({
  locationId: z.string().uuid(),
  periodStart: z.string().regex(dateRegex, "YYYY-MM-DD"),
  periodEnd: z.string().regex(dateRegex, "YYYY-MM-DD"),
});

async function loadLocationSettings(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  locationId: string,
): Promise<{
  enabled: boolean;
  settings: ProvisionSettings;
} | null> {
  const { data, error } = await supabase
    // ST1: bewusst ungefiltert — Daten-Zugriff (Provisionseinstellungen einzelner Standort by id).
    .from("locations")
    .select("organization_id, commission_enabled, commission_min_revenue_cents, commission_pct")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== organizationId) return null;
  return {
    enabled: Boolean(data.commission_enabled),
    settings: {
      minRevenueCents: Number(data.commission_min_revenue_cents ?? 0),
      pct: Number(data.commission_pct ?? 0),
    },
  };
}

export const getProvisionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => overviewInput.parse(input))
  .handler(async ({ data, context }): Promise<ProvisionOverviewResult> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const loc = await loadLocationSettings(supabaseAdmin, caller.organizationId, data.locationId);
    if (!loc) throw new Error("Standort nicht in deiner Organisation.");
    if (!loc.enabled) return { enabled: false };

    // 1) Abrechnungen des Zeitraums (nur abgegeben/korrigiert),
    //    inkl. Partner + Session-Meta (business_date, location_id).
    const { data: settlementsRaw, error: settlementsErr } = await supabaseAdmin
      .from("waiter_settlements")
      .select(
        "id, staff_id, pos_sales_cents, status, sessions!inner(business_date, location_id, organization_id), settlement_partners(staff_id)",
      )
      .in("status", ["submitted", "corrected"])
      .eq("sessions.organization_id", caller.organizationId)
      .eq("sessions.location_id", data.locationId)
      .gte("sessions.business_date", data.periodStart)
      .lte("sessions.business_date", data.periodEnd);
    if (settlementsErr) throw settlementsErr;

    type SettlementRow = {
      id: string;
      staff_id: string;
      pos_sales_cents: number;
      sessions: { business_date: string } | null;
      settlement_partners: { staff_id: string }[] | null;
    };
    const settlements = (settlementsRaw ?? []) as unknown as SettlementRow[];

    // 2) GL-Ids des Standorts (auch aus Partner-Rollen ausschließen).
    const { data: glRows, error: glErr } = await supabaseAdmin
      .from("staff_locations")
      .select("staff_id")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .eq("department", "gl");
    if (glErr) throw glErr;
    const glStaffIds = new Set<string>((glRows ?? []).map((r) => r.staff_id as string));

    // 3) Kellner-Set (Nicht-GL) aus Haupt + Partnern extrahieren.
    const commissionStaffIds = new Set<string>();
    for (const s of settlements) {
      if (!glStaffIds.has(s.staff_id)) commissionStaffIds.add(s.staff_id);
      for (const p of s.settlement_partners ?? []) {
        if (!glStaffIds.has(p.staff_id)) commissionStaffIds.add(p.staff_id);
      }
    }

    // 4) Tages-Buckets für die Rechnung.
    const dayMap = new Map<string, ProvisionDayInput>();
    for (const s of settlements) {
      const bd = s.sessions?.business_date;
      if (!bd) continue;
      const bucket = dayMap.get(bd) ?? { businessDate: bd, settlements: [] };
      bucket.settlements.push({
        staffId: s.staff_id,
        posSalesCents: Number(s.pos_sales_cents ?? 0),
        partnerStaffIds: (s.settlement_partners ?? []).map((p) => p.staff_id),
      });
      dayMap.set(bd, bucket);
    }
    const days = Array.from(dayMap.values()).sort((a, b) =>
      a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0,
    );

    const pool = computeProvisionPool(days, loc.settings, glStaffIds);

    // 5) Minuten pro Kellner aus time_entries.
    //    Query nur, wenn es überhaupt Kellner gibt — spart Round-Trip.
    const minutesByStaff = new Map<string, number>();
    const staffIdList = Array.from(commissionStaffIds);
    if (staffIdList.length > 0) {
      const { data: entries, error: entriesErr } = await supabaseAdmin
        .from("time_entries")
        .select("staff_id, started_at, ended_at, business_date, break_minutes, source")
        .in("staff_id", staffIdList)
        .gte("business_date", data.periodStart)
        .lte("business_date", data.periodEnd)
        .not("ended_at", "is", null);
      if (entriesErr) throw entriesErr;

      // Pro Mitarbeiter Pool-Einträge droppen, wenn ein realer time_entry
      // existiert — konsistent mit lohn-period und Zeitübersicht.
      const byStaff = new Map<string, typeof entries>();
      for (const e of entries ?? []) {
        const arr = byStaff.get(e.staff_id as string) ?? [];
        arr.push(e);
        byStaff.set(e.staff_id as string, arr);
      }
      for (const [sid, list] of byStaff) {
        const filtered = dropPoolWhenRealEntryExists(
          list.map((e) => ({
            ...e,
            businessDate: e.business_date as string,
            source: e.source as string,
          })),
        );
        let mins = 0;
        for (const e of filtered) {
          // PB2 — Verhaltens-Einfrierung: Provision rechnet unabhängig vom
          // Org-Schalter `pausen_bezahlt` weiterhin mit Netto-Minuten
          // (`pausenBezahlt = false` explizit). Ob Provisions-/Trinkgeldstunden
          // dem Pausen-Schalter folgen sollen, ist eine offene Bauherren-Frage
          // — keine steuerliche Notwendigkeit. Bei Änderung: PB2-Doku aktualisieren.
          const net = entryNetMinutes(
            {
              businessDate: e.business_date as string,
              startedAt: e.started_at as string,
              endedAt: (e.ended_at as string | null) ?? null,
              breakMinutes: (e.break_minutes as number | null) ?? 0,
            },
            false,
          );
          if (net !== null) mins += net;
        }
        minutesByStaff.set(sid, mins);
      }
    }

    // 6) Anzeigenamen der beteiligten Mitarbeiter.
    const nameByStaff = new Map<string, string>();
    if (staffIdList.length > 0) {
      const { data: staffRows, error: staffErr } = await supabaseAdmin
        .from("staff")
        .select("id, display_name")
        .eq("organization_id", caller.organizationId)
        .in("id", staffIdList);
      if (staffErr) throw staffErr;
      for (const r of staffRows ?? []) {
        nameByStaff.set(r.id as string, (r.display_name as string) ?? "");
      }
    }

    // 7) Verteilung mit Largest-Remainder.
    const dist = distributeProvision(
      pool.poolCents,
      staffIdList.map((id) => ({ staffId: id, minutes: minutesByStaff.get(id) ?? 0 })),
    );

    const rows: ProvisionOverviewRow[] = staffIdList
      .map((id) => ({
        staffId: id,
        displayName: nameByStaff.get(id) ?? id,
        minutes: minutesByStaff.get(id) ?? 0,
        provisionCents: dist.get(id) ?? 0,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "de"));

    return {
      enabled: true,
      settings: loc.settings,
      poolCents: pool.poolCents,
      dayBreakdown: pool.dayBreakdown,
      rows,
    };
  });

// ---------------------------------------------------------------------------
// Einstellungen ändern — admin-only, runGuarded + Audit.

const updateSchema = z.object({
  locationId: z.string().uuid(),
  enabled: z.boolean(),
  minRevenueCents: z.number().int().nonnegative(),
  pct: z
    .number()
    .min(0)
    .max(100)
    // Float-tolerant: 1.1 → 110.00000000000001. Epsilon-Vergleich statt
    // striktem `===`, sonst würden gültige Sätze wie 1,1 % abgelehnt.
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "max. 2 Dezimalen"),
});

export const updateCommissionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(
      caller.role,
      "admin",
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: before, error: beforeErr } = await supabaseAdmin
          // ST1: bewusst ungefiltert — Daten-Zugriff (Provisions-Update by id, inkl. Audit-Vorzustand).
          .from("locations")
          .select(
            "organization_id, commission_enabled, commission_min_revenue_cents, commission_pct",
          )
          .eq("id", data.locationId)
          .maybeSingle();
        if (beforeErr) throw beforeErr;
        if (!before || before.organization_id !== caller.organizationId) {
          throw new Error("Standort nicht in deiner Organisation.");
        }

        const { error: updateErr } = await supabaseAdmin
          // ST1: bewusst ungefiltert — Daten-Zugriff (Provisions-Update by id).
          .from("locations")
          .update({
            commission_enabled: data.enabled,
            commission_min_revenue_cents: data.minRevenueCents,
            commission_pct: data.pct,
          })
          .eq("id", data.locationId);
        if (updateErr) throw updateErr;

        return {
          result: { ok: true as const },
          audit: {
            action: "provision.settings_changed",
            entity: "locations",
            entityId: data.locationId,
            meta: {
              before: {
                enabled: Boolean(before.commission_enabled),
                minRevenueCents: Number(before.commission_min_revenue_cents ?? 0),
                pct: Number(before.commission_pct ?? 0),
              },
              after: {
                enabled: data.enabled,
                minRevenueCents: data.minRevenueCents,
                pct: data.pct,
              },
            },
          },
        };
      },
      {
        op: "lohn.commission.update_settings",
        orgId: caller.organizationId,
        callerStaffId: caller.staffId,
        critical: true,
        tags: { location_id: data.locationId },
      },
    );
  });
