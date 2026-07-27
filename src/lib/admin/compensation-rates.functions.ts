// LG3a — Stundensätze je Arbeitsbereich (kitchen | service | gl).
//
// Runde 1 von 2: Sätze sind pflegbar (List/Upsert/Delete), haben aber noch
// KEINE Lohnwirkung — die Netto-/Brutto-Berechnung liest weiterhin
// `staff_compensation.hourly_rate`. Erst LG3b verdrahtet die Sätze in die
// Payroll. Sichtbarkeit & Schreiben: admin/payroll wie bei
// `staff_compensation`, RLS zusätzlich in der Migration.
//
// Rückwirkung: `valid_from` darf frühestens am Beginn der laufenden
// Abrechnungsperiode (26. → 25.) liegen. Davor gesperrt — siehe
// `isValidFromAllowed`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { runWithPermission } from "./admin-call";
import { writeAuditLog } from "./audit";
import { todayIso } from "@/lib/format";
import { isValidFromAllowed, periodStart } from "@/lib/time/valid-from-guard";
import { expectMaybe, expectOk } from "@/lib/supabase/expect-ok";
import type { StaffDepartment } from "@/lib/staff-domain";

const DEPARTMENTS = ["kitchen", "service", "gl"] as const;
const departmentSchema = z.enum(DEPARTMENTS);

export type CompensationRateEntry = {
  id: string;
  hourlyRate: number;
  validFrom: string;
};

export type CompensationRatesDto = {
  departments: Record<StaffDepartment, CompensationRateEntry[]>;
};

const listInput = z.object({ staffId: z.string().uuid() });

export const listStaffCompensationRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<CompensationRatesDto> => {
    // Sichtbarkeit: identisch zu `staff_compensation` (admin + payroll).
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = expectOk<
      Array<{ id: string; department: StaffDepartment; hourly_rate: number | string; valid_from: string }>
    >(
      await supabaseAdmin
        .from("staff_compensation_rates")
        .select("id, department, hourly_rate, valid_from")
        .eq("staff_id", data.staffId)
        .eq("organization_id", caller.organizationId)
        .order("valid_from", { ascending: false }),
      "listStaffCompensationRates.load",
    );
    const out: CompensationRatesDto = {
      departments: { kitchen: [], service: [], gl: [] },
    };
    for (const r of rows) {
      out.departments[r.department].push({
        id: r.id,
        hourlyRate: Number(r.hourly_rate),
        validFrom: r.valid_from,
      });
    }
    return out;
  });

const upsertInput = z.object({
  id: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid(),
  department: departmentSchema,
  hourlyRate: z.number().min(0).max(1000),
  validFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const upsertStaffCompensationRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runWithPermission(
      context.supabase,
      "payroll.compensation.edit",
      null,
      async (entry) => {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: entry.meta,
        });
      },
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Staff muss zur eigenen Org gehören.
        const staffRow = expectMaybe<{ id: string }>(
          await supabaseAdmin
            .from("staff")
            .select("id")
            .eq("id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .maybeSingle(),
          "upsertStaffCompensationRate.loadStaff",
        );
        if (!staffRow) throw new Error("Mitarbeiter nicht gefunden.");

        const today = todayIso();
        const validFrom = data.validFrom ?? today;
        if (!isValidFromAllowed(validFrom, today)) {
          throw new Error(
            `Rückwirkung nur bis Periodenbeginn (${periodStart(today)}) erlaubt.`,
          );
        }

        if (data.id) {
          // Update einer Zeile der laufenden Periode; ältere Zeilen sind
          // gesperrt und werden über den valid_from-Guard bereits abgewiesen.
          const existing = expectMaybe<{ valid_from: string }>(
            await supabaseAdmin
              .from("staff_compensation_rates")
              .select("valid_from")
              .eq("id", data.id)
              .eq("staff_id", data.staffId)
              .eq("organization_id", caller.organizationId)
              .maybeSingle(),
            "upsertStaffCompensationRate.loadExisting",
          );
          if (!existing) throw new Error("Satz nicht gefunden.");
          if (!isValidFromAllowed(existing.valid_from, today)) {
            throw new Error("Zeile liegt vor Periodenbeginn und ist gesperrt.");
          }
          const { error } = await supabaseAdmin
            .from("staff_compensation_rates")
            .update({
              hourly_rate: data.hourlyRate,
              valid_from: validFrom,
            })
            .eq("id", data.id)
            .eq("organization_id", caller.organizationId);
          if (error) throw new Error(error.message);
          return {
            result: { ok: true as const, id: data.id },
            audit: {
              action: "staff_compensation_rate.update",
              entity: "staff_compensation_rates",
              entityId: data.id,
              meta: {
                staff_id: data.staffId,
                department: data.department,
                changed: { hourly_rate: "[REDACTED]", valid_from: validFrom },
              },
            },
          };
        }

        const { data: inserted, error } = await supabaseAdmin
          .from("staff_compensation_rates")
          .insert({
            staff_id: data.staffId,
            organization_id: caller.organizationId,
            department: data.department,
            hourly_rate: data.hourlyRate,
            valid_from: validFrom,
          })
          .select("id")
          .single();
        if (error || !inserted) throw new Error(error?.message ?? "Insert fehlgeschlagen.");

        return {
          result: { ok: true as const, id: inserted.id },
          audit: {
            action: "staff_compensation_rate.insert",
            entity: "staff_compensation_rates",
            entityId: inserted.id,
            meta: {
              staff_id: data.staffId,
              department: data.department,
              changed: { hourly_rate: "[REDACTED]", valid_from: validFrom },
            },
          },
        };
      },
    );
  });

const deleteInput = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
});

export const deleteStaffCompensationRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => deleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runWithPermission(
      context.supabase,
      "payroll.compensation.edit",
      null,
      async (entry) => {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: entry.meta,
        });
      },
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const existing = expectMaybe<{ valid_from: string; department: StaffDepartment }>(
          await supabaseAdmin
            .from("staff_compensation_rates")
            .select("valid_from, department")
            .eq("id", data.id)
            .eq("staff_id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .maybeSingle(),
          "deleteStaffCompensationRate.load",
        );
        if (!existing) throw new Error("Satz nicht gefunden.");
        const today = todayIso();
        if (!isValidFromAllowed(existing.valid_from, today)) {
          throw new Error("Zeile liegt vor Periodenbeginn und ist gesperrt.");
        }
        const { error } = await supabaseAdmin
          .from("staff_compensation_rates")
          .delete()
          .eq("id", data.id)
          .eq("organization_id", caller.organizationId);
        if (error) throw new Error(error.message);
        return {
          result: { ok: true as const },
          audit: {
            action: "staff_compensation_rate.delete",
            entity: "staff_compensation_rates",
            entityId: data.id,
            meta: {
              staff_id: data.staffId,
              department: existing.department,
              changed: { hourly_rate: "[REDACTED]", valid_from: existing.valid_from },
            },
          },
        };
      },
    );
  });