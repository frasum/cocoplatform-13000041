// MA1: session_tip_pool_entries — DENY-ALL Client-Write.
// Manager (mit cash.tippool.manage laut Rollen-Defaults) darf via PostgREST
// nicht mehr INSERTen; SELECT bleibt möglich. Schreibpfad läuft server-only
// über supabaseAdmin (seit §21). Muster: cash-rls.db.test.ts.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";

describe.skipIf(!dbTestsEnabled)("session_tip_pool_entries — DENY-ALL Client-Write (MA1)", () => {
  let org: SeededOrg;
  let manager: SeededUser;
  let staff: SeededUser;
  let sessionId: string;

  beforeAll(async () => {
    org = await seedOrg("stpe-deny-all");
    manager = await org.mkUser("manager");
    staff = await org.mkUser("staff");

    const businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (stpe-deny-all setup)",
    );
    const { data: s, error: sErr } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        business_date: businessDate,
        status: "open",
      })
      .select("id")
      .single();
    if (sErr || !s) throw new Error(`session seed failed: ${sErr?.message}`);
    sessionId = s.id;

    // Server-Role seedet einen Pool-Eintrag, damit SELECT etwas findet.
    const { error: pErr } = await org.service.from("session_tip_pool_entries").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: staff.staffId,
      department: "kitchen",
      shift_start: "15:00",
      shift_end: "23:00",
      hours_minutes: 480,
    });
    if (pErr) throw new Error(`stpe seed failed: ${pErr.message}`);
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it("Manager kann via PostgREST KEINEN Pool-Eintrag anlegen (Grant entzogen)", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const { error } = await client.from("session_tip_pool_entries").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: staff.staffId,
      department: "service",
      shift_start: "16:00",
      shift_end: "22:00",
      hours_minutes: 360,
    });
    expect(error).not.toBeNull();
  });

  it("Manager kann via PostgREST KEINEN Pool-Eintrag updaten/löschen", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const upd = await client
      .from("session_tip_pool_entries")
      .update({ hours_minutes: 1 })
      .eq("session_id", sessionId);
    expect(upd.error).not.toBeNull();
    const del = await client.from("session_tip_pool_entries").delete().eq("session_id", sessionId);
    expect(del.error).not.toBeNull();
  });

  it("Manager kann Pool-Einträge weiterhin lesen (SELECT-Policy unverändert)", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const { data, error } = await client
      .from("session_tip_pool_entries")
      .select("id, staff_id")
      .eq("session_id", sessionId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0].staff_id).toBe(staff.staffId);
  });
});
