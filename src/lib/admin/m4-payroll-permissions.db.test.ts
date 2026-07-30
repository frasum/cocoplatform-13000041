// DB-Integrationstest M4 (Lohn/HR) — Permissions & RLS end-to-end pro Rolle.
//
// Läuft NUR in CI mit lokalem `supabase start` (`SUPABASE_DB_TESTS=1`).
// Geprüft wird, was die 6 Lohn/HR-Server-Funktionen intern via
// `assertPermission` / `runWithPermission` (= `rpc('has_permission')`)
// und die SELECT-Policy auf staff_personal_details als Wahrheit verwenden.
// Die Tabelle staff_compensation wurde in ST1-C4 abgerissen (Abriss-Serie
// §117); die Keys payroll.compensation.view/.edit leben in den
// Bereichssatz-Functions weiter und werden weiterhin geprüft.
//
// Matrix (siehe permissions-catalog.ts + Migration 20260618064251):
//   admin   → alle 7 Keys
//   payroll → 6/7 (kein payroll.personal.edit)
//   manager → 0/7
//   staff   → 0/7
//
// Hinweis: `has_permission` gibt für die Rolle `admin` IMMER true zurück
// (Selbstaussperr-Schutz), unabhängig vom Default-Eintrag. Das deckt
// sich mit den seedeten Defaults — Admin bekommt true auf beidem Weg.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppPermission } from "./permissions-catalog";

type RoleKey = "admin" | "manager" | "staff" | "payroll";

const PAYROLL_KEYS = [
  "payroll.compensation.view",
  "payroll.compensation.edit",
  "payroll.personal.view",
  "payroll.personal.edit",
  "payroll.personal.import",
  "payroll.calc.run",
  "payroll.period.view",
] as const satisfies readonly AppPermission[];

// Erwartete Wahrheit pro (Rolle, Key) — nur die M4-Keys.
type PayrollKey = (typeof PAYROLL_KEYS)[number];
const EXPECTED: Record<RoleKey, Record<PayrollKey, boolean>> = {
  admin: {
    "payroll.compensation.view": true,
    "payroll.compensation.edit": true,
    "payroll.personal.view": true,
    "payroll.personal.edit": true,
    "payroll.personal.import": true,
    "payroll.calc.run": true,
    "payroll.period.view": true,
  },
  payroll: {
    "payroll.compensation.view": true,
    "payroll.compensation.edit": true,
    "payroll.personal.view": true,
    "payroll.personal.edit": false,
    "payroll.personal.import": true,
    "payroll.calc.run": true,
    "payroll.period.view": true,
  },
  manager: {
    "payroll.compensation.view": false,
    "payroll.compensation.edit": false,
    "payroll.personal.view": false,
    "payroll.personal.edit": false,
    "payroll.personal.import": false,
    "payroll.calc.run": false,
    "payroll.period.view": false,
  },
  staff: {
    "payroll.compensation.view": false,
    "payroll.compensation.edit": false,
    "payroll.personal.view": false,
    "payroll.personal.edit": false,
    "payroll.personal.import": false,
    "payroll.calc.run": false,
    "payroll.period.view": false,
  },
};

async function probe(client: SupabaseClient<Database>, perm: AppPermission): Promise<boolean> {
  const { data, error } = await client.rpc("has_permission", { _perm: perm });
  if (error) throw new Error(`has_permission(${perm}) failed: ${error.message}`);
  return data === true;
}

describe.skipIf(!dbTestsEnabled)("M4 Lohn/HR — Permissions & RLS pro Rolle", () => {
  let org!: SeededOrg;
  let users!: Record<RoleKey, SeededUser>;
  let targetStaffId!: string; // ein dritter Staff, dessen comp/details befüllt werden

  beforeAll(async () => {
    org = await seedOrg("m4-payroll");
    const admin = await org.mkUser("admin");
    const manager = await org.mkUser("manager");
    const staff = await org.mkUser("staff");
    const payroll = await org.mkUser("payroll");
    users = { admin, manager, staff, payroll };

    // Ziel-Mitarbeiter für Comp/Details: ein eigener Datensatz, damit
    // die SELECT-Sichtbarkeit unabhängig von der „eigenen" Zeile geprüft wird.
    targetStaffId = (await org.mkUser("staff")).staffId;

    // staff_personal_details befüllen (Service-Role bypassed RLS).
    {
      const { error } = await org.service.from("staff_personal_details").insert({
        organization_id: org.orgId,
        staff_id: targetStaffId,
        tax_class: "I",
        social_security_number: "12345678A901",
      });
      if (error) throw new Error(`seed staff_personal_details: ${error.message}`);
    }
  });

  afterAll(async () => {
    // Vor cleanup(): unsere zusätzlichen M4-Tabellen leeren, sonst
    // schlägt der Org-Delete in db-setup wegen FK-Resten fehl.
    await org.service.from("staff_personal_details").delete().eq("organization_id", org.orgId);
    await org.cleanup();
  });

  // 28 Probes: 4 Rollen × 7 Keys gegen has_permission().
  for (const role of ["admin", "manager", "staff", "payroll"] as const) {
    for (const key of PAYROLL_KEYS) {
      const expected = EXPECTED[role][key];
      it(`has_permission: ${role} → ${key} = ${expected}`, async () => {
        const client = await signInAsUser(users[role].email, users[role].password);
        expect(await probe(client, key)).toBe(expected);
      });
    }
  }

  // RLS-SELECT auf der gegateten Tabelle: konsistent zu .view-Key.
  for (const role of ["admin", "manager", "staff", "payroll"] as const) {
    const canViewPersonal = EXPECTED[role]["payroll.personal.view"];
    it(`RLS staff_personal_details SELECT als ${role} → ${canViewPersonal ? "1 Zeile" : "0 Zeilen"}`, async () => {
      const client = await signInAsUser(users[role].email, users[role].password);
      const { data, error } = await client
        .from("staff_personal_details")
        .select("staff_id, tax_class")
        .eq("staff_id", targetStaffId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(canViewPersonal ? 1 : 0);
    });
  }
});
