// Server-Functions für staff_personal_details (Lesen/Schreiben).
// Sichtbarkeit: admin + payroll (RLS). Schreiben: admin only — zusätzlich
// im Code geprüft, damit Audit & Rollencheck konsistent zu anderen
// Admin-Functions (staff.functions.ts) laufen.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { assertPermission, runWithPermission } from "./admin-call";
import { writeAuditLog } from "./audit";
import {
  personalDetailsSchema,
  redactForAudit,
  type PersonalDetailsFields,
} from "./personal-details.schema";
import { expectMaybe, expectVoid } from "@/lib/supabase/expect-ok";

const staffIdInput = z.object({ staffId: z.string().uuid() });

export type PersonalDetailsDto = PersonalDetailsFields & { exists: boolean };

const EMPTY: PersonalDetailsFields = {
  salutation: null,
  phone: null,
  email: null,
  address: null,
  street: null,
  postal_code: null,
  city: null,
  date_of_birth: null,
  place_of_birth: null,
  nationality: null,
  tax_class: null,
  tax_id: null,
  social_security_number: null,
  is_minijob: null,
  is_sv_exempt: null,
  health_insurance: null,
  church_tax_liable: null,
  child_tax_allowances: null,
  iban: null,
  bank_name: null,
  account_holder: null,
  employment_start_date: null,
  employment_end_date: null,
  personnel_group: null,
  job_title: null,
  vacation_days_contractual: null,
  vacation_days_previous_year: null,
  vacation_days_current_year: null,
  vacation_days_taken: null,
};

export const getStaffPersonalDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => staffIdInput.parse(input))
  .handler(async ({ data, context }): Promise<PersonalDetailsDto> => {
    // Lesen erfordert payroll.personal.view (admin/payroll per Default).
    await assertPermission(context.supabase, "payroll.personal.view");
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = expectMaybe<PersonalDetailsFields>(
      await supabaseAdmin
        .from("staff_personal_details")
        .select(
          "salutation, phone, email, address, street, postal_code, city, date_of_birth, place_of_birth, nationality, tax_class, tax_id, social_security_number, is_minijob, is_sv_exempt, health_insurance, church_tax_liable, child_tax_allowances, iban, bank_name, account_holder, employment_start_date, employment_end_date, personnel_group, job_title, vacation_days_contractual, vacation_days_previous_year, vacation_days_current_year, vacation_days_taken",
        )
        .eq("staff_id", data.staffId)
        .eq("organization_id", caller.organizationId)
        .maybeSingle(),
      "getStaffPersonalDetails",
    );
    if (!row) return { ...EMPTY, exists: false };
    return {
      ...EMPTY,
      ...row,
      child_tax_allowances:
        row.child_tax_allowances === null ? null : Number(row.child_tax_allowances),
      exists: true,
    };
  });

export const upsertStaffPersonalDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ staffId: z.string().uuid(), fields: z.unknown() })
      .transform((v) => ({
        staffId: v.staffId,
        fields: personalDetailsSchema.parse(v.fields),
      }))
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    // Leerer Patch (Sparse-Save ohne Änderungen) → No-Op, kein Upsert, kein Audit.
    if (Object.keys(data.fields).length === 0) {
      return { ok: true as const };
    }
    return runWithPermission(
      context.supabase,
      "payroll.personal.edit",
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

        // Staff muss zur eigenen Org gehören — sonst Forbidden (defense in depth).
        const staffRow = expectMaybe<{ id: string }>(
          await supabaseAdmin
            .from("staff")
            .select("id")
            .eq("id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .maybeSingle(),
          "upsertStaffPersonalDetails.loadStaff",
        );
        if (!staffRow) throw new Error("Mitarbeiter nicht gefunden");

        expectVoid(
          await supabaseAdmin.from("staff_personal_details").upsert(
            {
              staff_id: data.staffId,
              organization_id: caller.organizationId,
              ...data.fields,
            },
            { onConflict: "staff_id" },
          ),
          "upsertStaffPersonalDetails.upsert",
        );

        return {
          result: { ok: true as const },
          audit: {
            action: "staff_personal_details.upsert",
            entity: "staff_personal_details",
            entityId: data.staffId,
            meta: { changed: redactForAudit(data.fields) },
          },
        };
      },
    );
  });
