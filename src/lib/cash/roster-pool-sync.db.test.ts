// RS1 — Nach-Sync des Roster-Pool-Snapshots auf offene Sessions.
//
// Testet die additive Idempotenz + Best-effort-Semantik:
//  1) Offene Session + Snapshot → neue Service-Schicht ⇒ Pool-Eintrag neu.
//  2) Bestehender Pool-Eintrag mit gesetztem shift_end/hours_minutes bleibt
//     bit-identisch, wenn eine andere Person hinzukommt (Additiv-Beweis).
//  3) Entfernte Schicht ⇒ bestehender Pool-Eintrag bleibt bestehen.
//  4) Geschlossene Session ⇒ Nach-Sync fügt NICHTS hinzu.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { syncOpenSessionsPoolAfterRosterWrite } from "./roster-pool-sync";

describe.skipIf(!dbTestsEnabled)("Roster-Pool Nach-Sync (RS1)", () => {
  let org: SeededOrg;
  let staffA: SeededUser;
  let staffB: SeededUser;
  let businessDate: string;

  async function freshOpenSession(): Promise<string> {
    await org.service.from("sessions").delete().eq("organization_id", org.orgId);
    await org.service.from("roster_shifts").delete().eq("organization_id", org.orgId);
    businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (roster-pool-sync freshOpenSession)",
    );
    const { data: s, error } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        business_date: businessDate,
        status: "open",
      })
      .select("id")
      .single();
    if (error || !s) throw new Error(`session seed: ${error?.message}`);
    return s.id;
  }

  async function seedShift(staffId: string, area: "kitchen" | "service" | "gl") {
    const { error } = await org.service.from("roster_shifts").insert({
      organization_id: org.orgId,
      location_id: org.defaultLocationId,
      staff_id: staffId,
      shift_date: businessDate,
      area,
      status: "confirmed",
      service_period: "abend",
    });
    if (error) throw new Error(`shift seed: ${error.message}`);
  }

  beforeAll(async () => {
    org = await seedOrg("roster-pool-sync");
    staffA = await org.mkUser("staff");
    staffB = await org.mkUser("staff");
    // Service-Default checkin, damit Snapshot einen shift_start setzt.
    await org.service.from("location_department_defaults").upsert(
      {
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        department: "service",
        default_checkin: "16:00",
        default_checkout: null,
      },
      { onConflict: "location_id,department" },
    );
  });
  afterAll(async () => {
    await org.cleanup();
  });

  it("neue Schicht nach Eröffnung ⇒ Pool-Eintrag entsteht", async () => {
    const sessionId = await freshOpenSession();
    await seedShift(staffA.staffId, "service");
    await syncOpenSessionsPoolAfterRosterWrite({
      organizationId: org.orgId,
      targets: [{ locationId: org.defaultLocationId, businessDate }],
      op: "test.new_shift",
    });
    const rows = expectData(
      await org.service
        .from("session_tip_pool_entries")
        .select("staff_id, department, shift_start")
        .eq("session_id", sessionId),
      "session_tip_pool_entries select new-shift (roster-pool-sync)",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].staff_id).toBe(staffA.staffId);
    expect(rows[0].department).toBe("service");
    expect(rows[0].shift_start).toBe("16:00:00");
  });

  it("bestehender Eintrag bleibt bit-identisch, wenn andere Person dazukommt", async () => {
    const sessionId = await freshOpenSession();
    // Bereits vorhandener Pool-Eintrag mit gesetztem End+Hours (z. B. nach
    // Service-Abgabe manuell/servicePoolEnd) — MUSS unangetastet bleiben.
    await org.service.from("session_tip_pool_entries").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: staffA.staffId,
      department: "service",
      shift_start: "16:00",
      shift_end: "23:15",
      hours_minutes: 435,
    });
    await seedShift(staffA.staffId, "service"); // matched existing
    await seedShift(staffB.staffId, "service"); // neu
    await syncOpenSessionsPoolAfterRosterWrite({
      organizationId: org.orgId,
      targets: [{ locationId: org.defaultLocationId, businessDate }],
      op: "test.additive",
    });
    const rows = expectData(
      await org.service
        .from("session_tip_pool_entries")
        .select("staff_id, shift_start, shift_end, hours_minutes")
        .eq("session_id", sessionId)
        .order("staff_id"),
      "session_tip_pool_entries select additive (roster-pool-sync)",
    );
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.staff_id === staffA.staffId)!;
    expect(a.shift_start).toBe("16:00:00");
    expect(a.shift_end).toBe("23:15:00");
    expect(a.hours_minutes).toBe(435);
    const b = rows.find((r) => r.staff_id === staffB.staffId)!;
    expect(b.shift_start).toBe("16:00:00");
    expect(b.shift_end).toBeNull();
    expect(b.hours_minutes).toBe(0);
  });

  it("entfernte Schicht ⇒ Pool-Eintrag bleibt bestehen", async () => {
    const sessionId = await freshOpenSession();
    await seedShift(staffA.staffId, "service");
    await syncOpenSessionsPoolAfterRosterWrite({
      organizationId: org.orgId,
      targets: [{ locationId: org.defaultLocationId, businessDate }],
      op: "test.pre",
    });
    await org.service
      .from("roster_shifts")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("staff_id", staffA.staffId);
    await syncOpenSessionsPoolAfterRosterWrite({
      organizationId: org.orgId,
      targets: [{ locationId: org.defaultLocationId, businessDate }],
      op: "test.after_delete",
    });
    const rows = expectData(
      await org.service
        .from("session_tip_pool_entries")
        .select("staff_id")
        .eq("session_id", sessionId),
      "session_tip_pool_entries select after-delete (roster-pool-sync)",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].staff_id).toBe(staffA.staffId);
  });

  it("geschlossene Session ⇒ kein Nach-Sync", async () => {
    const sessionId = await freshOpenSession();
    await org.service.from("sessions").update({ status: "finalized" }).eq("id", sessionId);
    await seedShift(staffA.staffId, "service");
    await syncOpenSessionsPoolAfterRosterWrite({
      organizationId: org.orgId,
      targets: [{ locationId: org.defaultLocationId, businessDate }],
      op: "test.closed",
    });
    const rows = expectData(
      await org.service
        .from("session_tip_pool_entries")
        .select("staff_id")
        .eq("session_id", sessionId),
      "session_tip_pool_entries select closed-session (roster-pool-sync)",
    );
    expect(rows).toHaveLength(0);
  });
});
