// Server-Function `importStaffPersonalData` (Personaldaten Welle 1).
//
// Admin-only. Nimmt geparste Personaldaten-Zeilen entgegen, löst sie über
// `staff_identity_map` auf, berechnet den Diff via reinem
// `computePersonalPlan` und schreibt im Commit-Pfad in `staff`.
// Lohnsätze sind seit ST1-C1 nicht mehr Teil des Imports.
// Dry-Run schreibt nichts. Commit ohne Änderungen schreibt ebenfalls keinen
// Audit-Eintrag (Log-Hygiene, analog `importStaffAssignments`).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertPermission, runWithPermission } from "@/lib/admin/admin-call";
import { writeAuditLog } from "@/lib/admin/audit";
import { hashPersonalInput, type PersonalRowInput } from "./import-personal";
import { runImportPersonalCore } from "./import-personal-core";

const dateOrEmpty = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "valid_from muss YYYY-MM-DD sein")
  .nullable();

const inputSchema = z.object({
  rows: z.array(
    z.object({
      altStaffId: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      nickname: z.string(),
      persoNr: z.number().int().nullable(),
      employmentStart: dateOrEmpty,
    }),
  ),
  mode: z.enum(["dry_run", "commit"]),
  sourceSystem: z.enum(["tagesabrechnung"]).default("tagesabrechnung"),
});

export const importStaffPersonalData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, "payroll.personal.import");
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const dry = await runImportPersonalCore({
      admin: supabaseAdmin,
      organizationId: caller.organizationId,
      sourceSystem: data.sourceSystem,
      rows: data.rows as PersonalRowInput[],
      mode: "dry_run",
    });
    const plan = dry.plan;
    if (data.mode === "dry_run") {
      return { mode: "dry_run" as const, plan };
    }

    const writeAudit = async (entry: {
      action: string;
      entity: string;
      entityId?: string;
      meta?: Record<string, unknown>;
    }) => {
      await writeAuditLog({
        organizationId: caller.organizationId,
        actorUserId: caller.userId,
        actorStaffId: caller.staffId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        meta: entry.meta,
      });
    };

    const noChanges = plan.totals.nameUpdates === 0;

    if (noChanges) {
      return { mode: "commit" as const, plan };
    }

    return runWithPermission(
      context.supabase,
      "payroll.personal.import",
      null,
      writeAudit,
      async () => {
        const committed = await runImportPersonalCore({
          admin: supabaseAdmin,
          organizationId: caller.organizationId,
          sourceSystem: data.sourceSystem,
          rows: data.rows as PersonalRowInput[],
          mode: "commit",
        });

        const inputHash = await hashPersonalInput(data.rows as PersonalRowInput[]);

        return {
          result: { mode: "commit" as const, plan: committed.plan },
          audit: {
            action: "staff.import_personal_data",
            entity: "staff",
            meta: {
              sourceSystem: data.sourceSystem,
              rows: committed.plan.totals.rows,
              staff: committed.plan.totals.staff,
              nameUpdates: committed.plan.totals.nameUpdates,
              skippedCount: committed.plan.totals.skippedCount,
              inputHash,
            },
          },
        };
      },
    );
  });
