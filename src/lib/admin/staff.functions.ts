// Stammdaten-/Personal-UI Server-Functions (B1c).
//
// Architektur: alle schreibenden Aktionen laufen durch `runGuarded` →
// Rollencheck VOR DB-Schreiben, audit_log NUR bei Erfolg. Last-Admin-
// Schutz ist eine reine Funktion (siehe last-admin-rule.ts), die VOR
// dem Schreiben gegen den aktuellen Snapshot geprüft wird.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { runAllowed, runGuarded } from "./admin-call";
import { makeAuditWriter } from "./audit";
import { wouldRemoveLastActiveAdmin, type AdminSnapshotEntry } from "./last-admin-rule";
import type { AppRole } from "./role-guard";
import { assertStaffInOrg } from "./org-guards";
import {
  distinctDepartments,
  ineligibleSkills,
  type StaffDepartment,
  type SkillCategory,
} from "./skill-eligibility";
import { expectMaybe, expectOk, expectVoid } from "@/lib/supabase/expect-ok";

async function assertLocationInOrg(locationId: string, organizationId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // ST1: bewusst ungefiltert — Daten-Zugriff (assertLocationInOrg by id).
  const data = expectMaybe<{ id: string }>(
    await supabaseAdmin
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    "assertLocationInOrg",
  );
  if (!data) throw new Error("Standort nicht in dieser Organisation.");
}

const DEPARTMENT_LABEL: Record<StaffDepartment, string> = {
  kitchen: "Küche",
  service: "Service",
  gl: "Geschäftsleitung",
};

async function loadAdminSnapshot(organizationId: string): Promise<AdminSnapshotEntry[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const data = expectOk<{ id: string; is_active: boolean; role_assignments: unknown }[]>(
    await supabaseAdmin
      .from("staff")
      .select("id, is_active, role_assignments(role)")
      .eq("organization_id", organizationId),
    "loadAdminSnapshot",
  );
  return (data ?? []).map((row) => {
    const ra = row.role_assignments as { role: AppRole }[] | { role: AppRole } | null;
    const role = Array.isArray(ra) ? (ra[0]?.role ?? null) : (ra?.role ?? null);
    return { staffId: row.id, isActive: row.is_active, role };
  });
}

// =========================================================================
// Lesen (manager+)
// =========================================================================

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "admin",
      "manager",
      "planer",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // SD1 — email/phone bewusst NICHT im Select (siehe getStaff).
    const data = expectOk<
      {
        id: string;
        first_name: string;
        last_name: string;
        display_name: string;
        perso_nr: number | null;
        is_active: boolean;
        role_assignments: unknown;
        staff_locations: unknown;
        staff_skills: unknown;
        staff_pins: unknown;
        user_links: unknown;
      }[]
    >(
      await supabaseAdmin
        .from("staff")
        .select(
          "id, first_name, last_name, display_name, perso_nr, is_active, role_assignments(role), staff_locations(location_id, department), staff_skills(skill_id, skills(category)), staff_pins(id), user_links(user_id)",
        )
        .eq("organization_id", caller.organizationId)
        .order("display_name"),
      "listStaff",
    );
    return (data ?? []).map((s) => {
      const ra = s.role_assignments as { role: AppRole }[] | null;
      const role = ra && ra.length > 0 ? ra[0].role : null;
      const locations = ((s.staff_locations ?? []) as { location_id: string }[]).map(
        (l) => l.location_id,
      );
      const locDeptRows = (s.staff_locations ?? []) as unknown as {
        location_id: string;
        department: StaffDepartment;
      }[];
      const locationDepartments = locDeptRows.map((r) => ({
        locationId: r.location_id,
        department: r.department,
      }));
      const departments = distinctDepartments(locDeptRows);
      const skillRows = (s.staff_skills ?? []) as unknown as {
        skill_id: string;
        skills: { category: string | null } | null;
      }[];
      const skillIds = Array.from(
        new Set(skillRows.map((r) => r.skill_id).filter((id): id is string => !!id)),
      );
      const skillCategories = Array.from(
        new Set(
          skillRows
            .map((r) => r.skills?.category ?? null)
            .filter((c): c is string => typeof c === "string" && c.length > 0),
        ),
      );
      return {
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
        displayName: s.display_name,
        persoNr: s.perso_nr,
        isActive: s.is_active,
        role,
        locationIds: Array.from(new Set(locations)),
        locationDepartments,
        departments,
        skillCategories,
        skillIds,
        hasPin: s.staff_pins !== null,
        // AC2 — Kontostatus: true, wenn ein user_links-Eintrag existiert.
        // Nur das Bit, keine E-Mail/user_id (SD1: Listen-DTO bleibt personaldaten-frei).
        hasAccount: Array.isArray(s.user_links)
          ? (s.user_links as { user_id: string | null }[]).some((l) => !!l.user_id)
          : !!(s.user_links as { user_id: string | null } | null)?.user_id,
      };
    });
  });

// Aktive Standorte der Org (leichtgewichtiger Reader für Admin-Panels wie
// die Urlaub-/Antragsübersicht, die einen LocationPills-Filter zeigen).
export const listOrgLocationsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string; name: string }[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "admin",
      "manager",
      "planer",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const data = expectOk<{ id: string; name: string }[]>(
      await supabaseAdmin
        .from("locations")
        .select("id, name")
        .eq("organization_id", caller.organizationId)
        .eq("is_active", true)
        .order("name"),
      "listOrgLocationsForAdmin",
    );
    return (data ?? []).map((l) => ({ id: l.id, name: l.name }));
  });

// SD1b — Separater Reader für Tenure/Alter in der Staff-Verwaltung.
// Manager-lesbare Reader dürfen weder Geburts- noch Eintrittsdatum liefern
// (Datensparsamkeit + PII-Minimierung). Deshalb hier ein eigener Endpoint
// mit admin/payroll-Guard.
export const listStaffPersonalSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const data = expectOk<
      {
        staff_id: string;
        employment_start_date: string | null;
        date_of_birth: string | null;
      }[]
    >(
      await supabaseAdmin
        .from("staff_personal_details")
        .select("staff_id, employment_start_date, date_of_birth")
        .eq("organization_id", caller.organizationId),
      "listStaffPersonalSummary",
    );
    return (data ?? []).map((r) => ({
      staffId: r.staff_id,
      employmentStartDate: r.employment_start_date ?? null,
      dateOfBirth: r.date_of_birth ?? null,
    }));
  });

export const setStaffLocationDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        locationId: z.string().uuid(),
        department: z.enum(["kitchen", "service", "gl"]),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      await assertStaffInOrg(data.staffId, caller.organizationId);
      await assertLocationInOrg(data.locationId, caller.organizationId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      if (data.enabled) {
        expectVoid(
          await supabaseAdmin.from("staff_locations").upsert(
            {
              staff_id: data.staffId,
              organization_id: caller.organizationId,
              location_id: data.locationId,
              department: data.department,
            },
            { onConflict: "staff_id,location_id,department", ignoreDuplicates: true },
          ),
          "setStaffLocationDepartment.upsert",
        );
      } else {
        // Regel a: Entzug nur, wenn dadurch kein gehaltener Skill seine Grundlage verliert.
        const locRows = expectOk<{ location_id: string; department: StaffDepartment }[]>(
          await supabaseAdmin
            .from("staff_locations")
            .select("location_id, department")
            .eq("staff_id", data.staffId)
            .eq("organization_id", caller.organizationId),
          "setStaffLocationDepartment.locRows",
        );
        const rowsAfter = (locRows ?? []).filter(
          (r) => !(r.location_id === data.locationId && r.department === data.department),
        );
        const departmentsAfter = distinctDepartments(rowsAfter);

        const skillRows = expectOk<
          { skill_id: string; skills: { name: string | null; category: string | null } | null }[]
        >(
          await supabaseAdmin
            .from("staff_skills")
            .select("skill_id, skills(name, category)")
            .eq("staff_id", data.staffId)
            .eq("organization_id", caller.organizationId),
          "setStaffLocationDepartment.skillRows",
        );
        const held = (skillRows ?? [])
          .map((r) => {
            const sk = r.skills as { name: string | null; category: string | null } | null;
            if (!sk || !sk.category) return null;
            return { name: sk.name ?? "", category: sk.category as SkillCategory };
          })
          .filter((s): s is { name: string; category: SkillCategory } => s !== null);
        const blocking = ineligibleSkills(held, departmentsAfter);
        if (blocking.length > 0) {
          throw new Error(
            `Abteilung „${DEPARTMENT_LABEL[data.department]}“ kann nicht entfernt werden — benötigt von: ${blocking
              .map((s) => s.name)
              .join(", ")}. Erst diese Skills entfernen.`,
          );
        }

        expectVoid(
          await supabaseAdmin
            .from("staff_locations")
            .delete()
            .eq("staff_id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .eq("location_id", data.locationId)
            .eq("department", data.department),
          "setStaffLocationDepartment.delete",
        );
      }

      return {
        result: { ok: true as const },
        audit: {
          action: "staff.set_location_department",
          entity: "staff",
          entityId: data.staffId,
          meta: {
            locationId: data.locationId,
            department: data.department,
            enabled: data.enabled,
          },
        },
      };
    });
  });

export const getStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ staffId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // SD1-Erweiterung (18.07.2026, Entscheidung Frank): getStaff lesend auch für
    // manager/planer, INKL. email/phone (Kontaktdaten für Führung/Planung).
    // Schreibende Personalverwaltung bleibt admin/payroll-only.
    // listStaff bleibt bewusst OHNE email/phone (Listenansicht braucht sie nicht).
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "admin",
      "manager",
      "planer",
      "payroll",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const staff = expectMaybe<{
      id: string;
      organization_id: string;
      first_name: string;
      last_name: string;
      display_name: string;
      email: string | null;
      phone: string | null;
      perso_nr: number | null;
      is_active: boolean;
      participates_in_pool: boolean;
      role_assignments: unknown;
      staff_locations: unknown;
      staff_pins: unknown;
    }>(
      await supabaseAdmin
        .from("staff")
        .select(
          "id, organization_id, first_name, last_name, display_name, email, phone, perso_nr, is_active, participates_in_pool, role_assignments(role), staff_locations(location_id), staff_pins(id)",
        )
        .eq("id", data.staffId)
        .eq("organization_id", caller.organizationId)
        .maybeSingle(),
      "getStaff",
    );
    if (!staff) throw new Error("Mitarbeiter nicht gefunden");
    const ra = staff.role_assignments as { role: AppRole }[] | null;
    return {
      id: staff.id,
      firstName: staff.first_name,
      lastName: staff.last_name,
      displayName: staff.display_name,
      email: staff.email,
      phone: staff.phone,
      persoNr: staff.perso_nr,
      isActive: staff.is_active,
      participatesInPool: staff.participates_in_pool,
      role: (ra && ra.length > 0 ? ra[0].role : null) as AppRole | null,
      locationIds: ((staff.staff_locations ?? []) as { location_id: string }[]).map(
        (l) => l.location_id,
      ),
      hasPin: staff.staff_pins !== null,
    };
  });

// =========================================================================
// Schreiben (admin)
// =========================================================================

const staffBasicsSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => staffBasicsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const created = expectOk<{ id: string }>(
        await supabaseAdmin
          .from("staff")
          .insert({
            organization_id: caller.organizationId,
            first_name: data.firstName,
            last_name: data.lastName,
            display_name: data.displayName,
            email: data.email ?? null,
            phone: data.phone ?? null,
            is_active: true,
          })
          .select("id")
          .single(),
        "createStaff",
      );
      return {
        result: { id: created.id },
        audit: {
          action: "staff.create",
          entity: "staff",
          entityId: created.id,
          meta: { displayName: data.displayName },
        },
      };
    });
  });

export const updateStaffBasics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ staffId: z.string().uuid() }).merge(staffBasicsSchema).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runAllowed(caller.role, ["admin", "payroll"], makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      expectVoid(
        await supabaseAdmin
          .from("staff")
          .update({
            first_name: data.firstName,
            last_name: data.lastName,
            display_name: data.displayName,
            email: data.email ?? null,
            phone: data.phone ?? null,
          })
          .eq("id", data.staffId)
          .eq("organization_id", caller.organizationId),
        "updateStaffBasics",
      );
      return {
        result: { ok: true as const },
        audit: { action: "staff.update", entity: "staff", entityId: data.staffId },
      };
    });
  });

export const setStaffActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ staffId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runAllowed(caller.role, ["admin", "payroll"], makeAuditWriter(caller), async () => {
      const snapshot = await loadAdminSnapshot(caller.organizationId);
      if (
        !data.isActive &&
        wouldRemoveLastActiveAdmin(snapshot, { staffId: data.staffId, nextActive: false })
      ) {
        throw new Error("Mindestens ein aktiver Admin muss erhalten bleiben.");
      }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      expectVoid(
        await supabaseAdmin
          .from("staff")
          .update({ is_active: data.isActive })
          .eq("id", data.staffId)
          .eq("organization_id", caller.organizationId),
        "setStaffActive",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: data.isActive ? "staff.activate" : "staff.deactivate",
          entity: "staff",
          entityId: data.staffId,
        },
      };
    });
  });

export const setStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        role: z.enum(["admin", "manager", "planer", "staff", "payroll"]).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const snapshot = await loadAdminSnapshot(caller.organizationId);
      if (wouldRemoveLastActiveAdmin(snapshot, { staffId: data.staffId, nextRole: data.role })) {
        throw new Error("Mindestens ein aktiver Admin muss erhalten bleiben.");
      }
      await assertStaffInOrg(data.staffId, caller.organizationId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      expectVoid(
        await supabaseAdmin.rpc("replace_staff_role", {
          p_staff_id: data.staffId,
          p_organization_id: caller.organizationId,
          // RPC akzeptiert NULL = Rolle entfernen; generierter Typ ist nicht-nullbar.
          p_role: data.role as AppRole,
        }),
        "setStaffRole.rpc",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "staff.set_role",
          entity: "staff",
          entityId: data.staffId,
          meta: { role: data.role },
        },
      };
    });
  });

export const setStaffParticipatesInPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ staffId: z.string().uuid(), participates: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // SD1 — Einzig-Verwendung ist die Personalverwaltung; admin + payroll.
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runAllowed(caller.role, ["admin", "payroll"], makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      expectVoid(
        await supabaseAdmin
          .from("staff")
          .update({ participates_in_pool: data.participates })
          .eq("id", data.staffId)
          .eq("organization_id", caller.organizationId),
        "setStaffParticipatesInPool",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "staff.set_participates_in_pool",
          entity: "staff",
          entityId: data.staffId,
          meta: { participates: data.participates },
        },
      };
    });
  });

// Personalnummer manuell setzen/entfernen. Admin- und payroll-only; PII-nah
// über payroll bereits abgedeckt (Import läuft dort). Uniqueness wird
// weich pro Organisation geprüft (kein DB-Unique — Historie kann Kollisionen
// enthalten, die wir hier nicht stillschweigend erzwingen).
export const setStaffPersoNr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        persoNr: z.number().int().positive().max(2_147_483_647).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runAllowed(caller.role, ["admin", "payroll"], makeAuditWriter(caller), async () => {
      await assertStaffInOrg(data.staffId, caller.organizationId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      if (data.persoNr !== null) {
        // Weiche Eindeutigkeitsprüfung pro Organisation.
        const conflict = expectOk<{ id: string; display_name: string }[]>(
          await supabaseAdmin
            .from("staff")
            .select("id, display_name")
            .eq("organization_id", caller.organizationId)
            .eq("perso_nr", data.persoNr)
            .neq("id", data.staffId)
            .limit(1),
          "setStaffPersoNr.conflict",
        );
        if (conflict && conflict.length > 0) {
          throw new Error(
            `Personalnummer ${data.persoNr} ist bereits vergeben (${conflict[0].display_name}).`,
          );
        }
      }

      expectVoid(
        await supabaseAdmin
          .from("staff")
          .update({ perso_nr: data.persoNr })
          .eq("id", data.staffId)
          .eq("organization_id", caller.organizationId),
        "setStaffPersoNr",
      );
      return {
        result: { ok: true as const },
        audit: {
          action: "staff.set_perso_nr",
          entity: "staff",
          entityId: data.staffId,
          meta: { persoNr: data.persoNr },
        },
      };
    });
  });
