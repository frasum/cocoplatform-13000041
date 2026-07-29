// DB-Integrationstest für die Kasse-RLS (B3a).
// Muster: src/lib/admin/role-guard.db.test.ts. Läuft NUR mit lokalem
// `supabase start` (SUPABASE_DB_TESTS=1).
//
// Geprüft:
//   (A) DENY-ALL Client-Write auf sessions und allen Satelliten:
//       Manager-Rolle darf via PostgREST weder INSERT noch UPDATE noch
//       DELETE — die fehlenden GRANTs blockieren bereits, RLS härtet zusätzlich.
//   (B) Kellner-Sichtbarkeit auf waiter_settlements: ein Kellner sieht
//       nur eigene Zeilen, Manager sieht alle.
//   (C) Kellner darf KEINE Settlement für eine fremde staff_id anlegen.
//   (D) Kellner darf KEINE Settlement anlegen ohne offene Session am
//       aktuellen Geschäftstag.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";

describe.skipIf(!dbTestsEnabled)("cash RLS — DENY-ALL & Kellner-Sichtbarkeit", () => {
  let org: SeededOrg;
  let manager: SeededUser;
  let waiterA: SeededUser;
  let waiterB: SeededUser;
  let sessionId: string;
  let otherSessionId: string;

  beforeAll(async () => {
    org = await seedOrg("cash-rls");
    manager = await org.mkUser("manager");
    waiterA = await org.mkUser("staff");
    waiterB = await org.mkUser("staff");

    // Service-Role seedet eine offene Session am heutigen Geschäftstag.
    const businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-rls setup)",
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

    // Zweite, finalisierte Session an einem anderen Datum (für D-Test).
    const { data: s2, error: s2Err } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        business_date: "2020-01-01",
        status: "finalized",
      })
      .select("id")
      .single();
    if (s2Err || !s2) throw new Error(`session2 seed failed: ${s2Err?.message}`);
    otherSessionId = s2.id;

    // Service-Role seedet eine Settlement von waiterA (sichtbar für A, nicht für B).
    const { error: wErr } = await org.service.from("waiter_settlements").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: waiterA.staffId,
      kitchen_tip_rate: 0.02,
      status: "submitted",
    });
    if (wErr) throw new Error(`waiter_settlements seed failed: ${wErr.message}`);
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it("(A1) Manager kann via PostgREST KEINE Session anlegen (DENY-ALL)", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const { error } = await client.from("sessions").insert({
      organization_id: org.orgId,
      location_id: org.defaultLocationId,
      business_date: "2099-12-31",
      status: "open",
    });
    expect(error).not.toBeNull();
  });

  it("(A2) Manager kann KEINE Session updaten/löschen (DENY-ALL)", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const upd = await client.from("sessions").update({ notes: "hack" }).eq("id", sessionId);
    expect(upd.error).not.toBeNull();
    const del = await client.from("sessions").delete().eq("id", sessionId);
    expect(del.error).not.toBeNull();
  });

  it("(A3) DENY-ALL auf allen Satelliten (insert blockt)", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const cases = [
      client.from("session_expenses").insert({
        organization_id: org.orgId,
        session_id: sessionId,
        description: "x",
        amount_cents: 1,
      }),
      client.from("session_advances").insert({
        organization_id: org.orgId,
        session_id: sessionId,
        staff_id: waiterA.staffId,
        amount_cents: 1,
      }),
      client
        .from("session_card_transactions")
        .insert({ organization_id: org.orgId, session_id: sessionId, amount_cents: 1 }),
      client
        .from("session_bank_deposits")
        .insert({ organization_id: org.orgId, session_id: sessionId, amount_cents: 1 }),
      client.from("session_register_transfers").insert({
        organization_id: org.orgId,
        session_id: sessionId,
        direction: "to_restaurant",
        amount_cents: 1,
      }),
      client.from("session_channel_amounts").insert({
        organization_id: org.orgId,
        session_id: sessionId,
        channel_id: org.orgId,
        amount_cents: 1,
      }),
      client.from("session_terminal_amounts").insert({
        organization_id: org.orgId,
        session_id: sessionId,
        terminal_id: org.orgId,
        amount_cents: 1,
      }),
    ];
    const results = await Promise.all(cases);
    for (const r of results) {
      expect(r.error).not.toBeNull();
    }
  });

  it("(B) Kellner-Sichtbarkeit waiter_settlements: A sieht eigene, B sieht keine, Manager sieht alle", async () => {
    const cA = await signInAsUser(waiterA.email, waiterA.password);
    const cB = await signInAsUser(waiterB.email, waiterB.password);
    const cM = await signInAsUser(manager.email, manager.password);
    const rA = await cA.from("waiter_settlements").select("id, staff_id");
    const rB = await cB.from("waiter_settlements").select("id, staff_id");
    const rM = await cM.from("waiter_settlements").select("id, staff_id");
    expect(rA.error).toBeNull();
    expect(rB.error).toBeNull();
    expect(rM.error).toBeNull();
    expect(rA.data?.length).toBe(1);
    expect(rA.data?.[0].staff_id).toBe(waiterA.staffId);
    expect(rB.data?.length).toBe(0);
    expect(rM.data?.length).toBe(1);
  });

  it("(C) Kellner B kann KEINE Settlement für staff_id von A anlegen", async () => {
    const cB = await signInAsUser(waiterB.email, waiterB.password);
    const { error } = await cB.from("waiter_settlements").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: waiterA.staffId, // Fremde staff_id
      kitchen_tip_rate: 0.02,
      status: "draft",
    });
    expect(error).not.toBeNull();
  });

  it("(D) Kellner B kann KEINE Settlement ohne offene Session am heutigen Geschäftstag anlegen", async () => {
    const cB = await signInAsUser(waiterB.email, waiterB.password);
    const { error } = await cB.from("waiter_settlements").insert({
      organization_id: org.orgId,
      session_id: otherSessionId, // andere/finalisierte Session
      staff_id: waiterB.staffId,
      kitchen_tip_rate: 0.02,
      status: "draft",
    });
    expect(error).not.toBeNull();
  });
});
