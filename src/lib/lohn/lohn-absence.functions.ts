// UK2 — Erfassung der harten U/K-Tage je Person und Abrechnungsperiode.
//
// Rechte wie die übrige Lohnpflege: admin + payroll, Permission
// `payroll.compensation.edit`. Der Zugriff läuft über `supabaseAdmin`; die
// bestehenden RLS-Policies der Tabelle bleiben unangetastet.
//
// Der Lesepfad des Rechners (lohn-rechner.functions.ts) bleibt unverändert —
// hier entsteht KEINE zweite Leselogik.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runWithPermission } from "@/lib/admin/admin-call";
import { writeAuditLog } from "@/lib/admin/audit";
import { expectMaybe } from "@/lib/supabase/expect-ok";
import { MAX_ABSENCE_TAGE, saveAbsenceDaysCore, type AbsenceDaysRow } from "./absence-days";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const saveInput = z.object({
  staffId: z.string().uuid(),
  periodStart: z.string().regex(dateRegex),
  urlaubTage: z.number().int().min(0).max(MAX_ABSENCE_TAGE),
  krankTage: z.number().int().min(0).max(MAX_ABSENCE_TAGE),
});

export const saveAbsenceDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
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
        return saveAbsenceDaysCore(
          {
            isStaffInOrg: async (staffId) =>
              expectMaybe<{ id: string }>(
                await supabaseAdmin
                  .from("staff")
                  .select("id")
                  .eq("id", staffId)
                  .eq("organization_id", caller.organizationId)
                  .maybeSingle(),
                "saveAbsenceDays.loadStaff",
              ) != null,
            isPeriodStart: async (periodStart) =>
              expectMaybe<{ id: string }>(
                await supabaseAdmin
                  .from("periods")
                  .select("id")
                  .eq("organization_id", caller.organizationId)
                  .eq("start_date", periodStart)
                  .maybeSingle(),
                "saveAbsenceDays.loadPeriod",
              ) != null,
            loadExisting: async (staffId, periodStart) =>
              expectMaybe<AbsenceDaysRow>(
                await supabaseAdmin
                  .from("lohn_absence_days")
                  .select("urlaub_tage, krank_tage")
                  .eq("staff_id", staffId)
                  .eq("period_start", periodStart)
                  .maybeSingle(),
                "saveAbsenceDays.loadExisting",
              ),
            upsert: async (values) => {
              const { error } = await supabaseAdmin.from("lohn_absence_days").upsert(
                {
                  staff_id: values.staffId,
                  organization_id: caller.organizationId,
                  period_start: values.periodStart,
                  urlaub_tage: values.urlaubTage,
                  krank_tage: values.krankTage,
                },
                { onConflict: "staff_id,period_start" },
              );
              if (error) throw new Error(error.message);
            },
          },
          {
            staffId: data.staffId,
            periodStart: data.periodStart,
            urlaubTage: data.urlaubTage,
            krankTage: data.krankTage,
          },
        );
      },
    );
  });
