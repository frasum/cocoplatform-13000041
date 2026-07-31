// SL1 — Pflege der edlohn-Zeitlohn-Slots je Mitarbeiter.
//
// Der Slot ist in edlohn die Anlage-Reihenfolge der Zeitlohn-Lohnart JE
// PERSON (1 = Zeitlohn, 2 = Zeitlohn 2, 3 = Zeitlohn 3). Er ist rein
// export-relevant: Bezeichnung, Kategorie und Spaltenzuordnung folgen dem
// Slot, die Lohn-Engine rechnet unverändert nach Bereichen.
//
// Rechte: identisch zu den Bereichs-Sätzen (admin + payroll,
// `payroll.compensation.edit` fürs Schreiben). Tabelle ist DENY-ALL für den
// Client — der Zugriff läuft ausschließlich hier über `supabaseAdmin`.
//
// KEIN valid_from-Guard: der Slot ist keine Geldangabe mit Historie, sondern
// eine Zuordnung zum edlohn-Mandantenstamm. Er wird korrigiert, nicht
// versioniert.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { runWithPermission } from "./admin-call";
import { writeAuditLog } from "./audit";
import { expectMaybe, expectOk } from "@/lib/supabase/expect-ok";
import type { StaffDepartment } from "@/lib/staff-domain";

const departmentSchema = z.enum(["kitchen", "service", "gl"]);
const slotSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export type EdlohnSlotEntry = {
  id: string;
  department: StaffDepartment;
  slot: 1 | 2 | 3;
};

export const listStaffEdlohnSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ staffId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EdlohnSlotEntry[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = expectOk<Array<{ id: string; department: StaffDepartment; slot: number }>>(
      await supabaseAdmin
        .from("staff_edlohn_slots")
        .select("id, department, slot")
        .eq("staff_id", data.staffId)
        .eq("organization_id", caller.organizationId)
        .order("slot", { ascending: true }),
      "listStaffEdlohnSlots.load",
    );
    return rows.map((r) => ({
      id: r.id,
      department: r.department,
      slot: r.slot as 1 | 2 | 3,
    }));
  });

const upsertInput = z.object({
  staffId: z.string().uuid(),
  department: departmentSchema,
  /** null = Zuordnung entfernen. */
  slot: slotSchema.nullable(),
});

export const setStaffEdlohnSlot = createServerFn({ method: "POST" })
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

        const staffRow = expectMaybe<{ id: string }>(
          await supabaseAdmin
            .from("staff")
            .select("id")
            .eq("id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .maybeSingle(),
          "setStaffEdlohnSlot.loadStaff",
        );
        if (!staffRow) throw new Error("Mitarbeiter nicht gefunden.");

        if (data.slot == null) {
          const { error } = await supabaseAdmin
            .from("staff_edlohn_slots")
            .delete()
            .eq("staff_id", data.staffId)
            .eq("department", data.department)
            .eq("organization_id", caller.organizationId);
          if (error) throw new Error(error.message);
          return {
            result: { ok: true as const },
            audit: {
              action: "staff_edlohn_slot.delete",
              entity: "staff_edlohn_slots",
              entityId: null,
              meta: { staff_id: data.staffId, department: data.department },
            },
          };
        }

        // Slot ist je Person eindeutig: eine bestehende Zuordnung derselben
        // Nummer an einen ANDEREN Bereich muss weichen, sonst schlägt die
        // UNIQUE-Bedingung zu (klare Fehlermeldung statt Constraint-Text).
        const konflikt = expectMaybe<{ id: string; department: StaffDepartment }>(
          await supabaseAdmin
            .from("staff_edlohn_slots")
            .select("id, department")
            .eq("staff_id", data.staffId)
            .eq("slot", data.slot)
            .neq("department", data.department)
            .maybeSingle(),
          "setStaffEdlohnSlot.loadKonflikt",
        );
        if (konflikt) {
          throw new Error(
            `Slot ${data.slot} ist bereits dem Bereich ${konflikt.department} zugeordnet.`,
          );
        }

        const { data: saved, error } = await supabaseAdmin
          .from("staff_edlohn_slots")
          .upsert(
            {
              staff_id: data.staffId,
              organization_id: caller.organizationId,
              department: data.department,
              slot: data.slot,
            },
            { onConflict: "staff_id,department" },
          )
          .select("id")
          .single();
        if (error || !saved) throw new Error(error?.message ?? "Speichern fehlgeschlagen.");

        return {
          result: { ok: true as const, id: saved.id },
          audit: {
            action: "staff_edlohn_slot.upsert",
            entity: "staff_edlohn_slots",
            entityId: saved.id,
            meta: { staff_id: data.staffId, department: data.department, slot: data.slot },
          },
        };
      },
    );
  });
