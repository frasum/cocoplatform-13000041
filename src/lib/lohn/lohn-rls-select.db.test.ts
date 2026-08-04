// DB-Integrationstest: SELECT-Härtung der Lohn-Tabellen
// (`lohn_absence_days`, `lohn_recurring_zeilen`) — nur admin und payroll
// dürfen lesen; manager ist BEWUSST ausgeschlossen.
//
// Geltende Beschlusslage: ZT1 / §134, Migration 20260803124143 (Verengung des
// Lohn-Lesezugriffs auf admin+payroll). Die frühere §42-Regel „manager+ darf
// lesen" ist damit überholt — dieser Test folgt der Produktion, nicht der
// Historie. Läuft NUR in CI mit lokalem `supabase start`
// (`SUPABASE_DB_TESTS=1`). Muster: `m4-payroll-permissions.db.test`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";

type RoleKey = "admin" | "manager" | "staff" | "payroll";

// Sichtbarkeit nach ZT1/§134: admin und payroll dürfen lesen; manager und
// staff nicht.
const CAN_SELECT: Record<RoleKey, boolean> = {
  admin: true,
  manager: false,
  payroll: true,
  staff: false,
};

describe.skipIf(!dbTestsEnabled)("lohn SELECT-RLS — admin+payroll (ZT1/§134)", () => {
  let org!: SeededOrg;
  let users!: Record<RoleKey, SeededUser>;
  let targetStaffId!: string;

  beforeAll(async () => {
    org = await seedOrg("lohn-rls-select");
    const admin = await org.mkUser("admin");
    const manager = await org.mkUser("manager");
    const staff = await org.mkUser("staff");
    const payroll = await org.mkUser("payroll");
    users = { admin, manager, staff, payroll };

    // Ziel-Mitarbeiter mit je einer Zeile in beiden Tabellen (service-role
    // umgeht RLS beim Seed).
    targetStaffId = (await org.mkUser("staff")).staffId;

    {
      const { error } = await org.service.from("lohn_absence_days").insert({
        organization_id: org.orgId,
        staff_id: targetStaffId,
        period_start: "2026-01-26",
        urlaub_tage: 2,
        krank_tage: 1,
      });
      if (error) throw new Error(`seed lohn_absence_days: ${error.message}`);
    }

    {
      const { error } = await org.service.from("lohn_recurring_zeilen").insert({
        organization_id: org.orgId,
        staff_id: targetStaffId,
        kategorie: "abzug",
        bezeichnung: "Direktversicherung",
        betrag_cent: 5000,
      });
      if (error) throw new Error(`seed lohn_recurring_zeilen: ${error.message}`);
    }
  });

  afterAll(async () => {
    await org.service.from("lohn_absence_days").delete().eq("organization_id", org.orgId);
    await org.service.from("lohn_recurring_zeilen").delete().eq("organization_id", org.orgId);
    await org.cleanup();
  });

  for (const role of ["admin", "manager", "staff", "payroll"] as const) {
    const expected = CAN_SELECT[role];
    it(`lohn_absence_days SELECT als ${role} → ${expected ? "1 Zeile" : "0 Zeilen"}`, async () => {
      const client = await signInAsUser(users[role].email, users[role].password);
      const { data, error } = await client
        .from("lohn_absence_days")
        .select("staff_id, urlaub_tage")
        .eq("staff_id", targetStaffId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(expected ? 1 : 0);
    });

    it(`lohn_recurring_zeilen SELECT als ${role} → ${expected ? "1 Zeile" : "0 Zeilen"}`, async () => {
      const client = await signInAsUser(users[role].email, users[role].password);
      const { data, error } = await client
        .from("lohn_recurring_zeilen")
        .select("staff_id, betrag_cent")
        .eq("staff_id", targetStaffId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(expected ? 1 : 0);
    });
  }
});
