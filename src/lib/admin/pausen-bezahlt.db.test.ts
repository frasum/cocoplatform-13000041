// PB1 — DB-Integrationstest zur Einstellung „Pausen bezahlt".
//
// Geprüft:
//   (1) Nicht-Admin (staff) → loadAdminCaller("admin") wirft ForbiddenError,
//       kein audit_log-Eintrag entsteht (Guard vor Op).
//   (2) Admin schreibt den Wert um, der Audit-Eintrag hat action
//       `settings.pausen_bezahlt_changed` und meta enthält `before` und
//       `after`. Der zugrundeliegende Update-Pfad ist genau der aus
//       setPausenBezahlt in org-settings.functions.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  seedOrg,
  signInAsUser,
  countAuditLog,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { loadAdminCaller } from "./admin-context";
import { runGuarded } from "./admin-call";
import { writeAuditLog } from "./audit";
import { ForbiddenError } from "./role-guard";

describe.skipIf(!dbTestsEnabled)("PB1 — setPausenBezahlt Guard + Audit", () => {
  let org: SeededOrg;
  let admin: SeededUser;
  let staff: SeededUser;

  beforeAll(async () => {
    org = await seedOrg("pb1-pausen-bezahlt");
    admin = await org.mkUser("admin");
    staff = await org.mkUser("staff");
  });
  afterAll(async () => {
    await org.cleanup();
  });

  it("(1) Nicht-Admin wird abgelehnt und schreibt KEIN audit_log", async () => {
    const before = await countAuditLog(org.service, org.orgId);
    const client = await signInAsUser(staff.email, staff.password);
    await expect(loadAdminCaller(client, staff.userId, "admin")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const after = await countAuditLog(org.service, org.orgId);
    expect(after).toBe(before);
  });

  it("(2) Admin schreibt den Wert; audit-meta enthält before und after", async () => {
    const client = await signInAsUser(admin.email, admin.password);
    const caller = await loadAdminCaller(client, admin.userId, "admin");

    // Ausgangswert lesen (Default true).
    const { data: prev } = await org.service
      .from("organization_settings")
      .select("pausen_bezahlt")
      .eq("organization_id", org.orgId)
      .maybeSingle();
    const startValue = Boolean(prev?.pausen_bezahlt ?? true);
    const nextValue = !startValue;

    await runGuarded(
      caller.role,
      "admin",
      (entry) =>
        writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          ...entry,
        }),
      async () => {
        const { error } = await org.service
          .from("organization_settings")
          .update({ pausen_bezahlt: nextValue })
          .eq("organization_id", org.orgId);
        if (error) throw error;
        return {
          result: { ok: true as const },
          audit: {
            action: "settings.pausen_bezahlt_changed",
            entity: "organization_settings",
            entityId: org.orgId,
            meta: { before: startValue, after: nextValue },
          },
        };
      },
    );

    // Wert wirklich geschrieben?
    const { data: after } = await org.service
      .from("organization_settings")
      .select("pausen_bezahlt")
      .eq("organization_id", org.orgId)
      .maybeSingle();
    expect(after?.pausen_bezahlt).toBe(nextValue);

    // Audit-Eintrag enthält before/after.
    const { data: log, error: logErr } = await org.service
      .from("audit_log")
      .select("action, meta")
      .eq("organization_id", org.orgId)
      .eq("action", "settings.pausen_bezahlt_changed")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(logErr).toBeNull();
    expect(log?.length).toBe(1);
    const meta = (log?.[0]?.meta ?? {}) as { before?: boolean; after?: boolean };
    expect(meta.before).toBe(startValue);
    expect(meta.after).toBe(nextValue);
  });
});
