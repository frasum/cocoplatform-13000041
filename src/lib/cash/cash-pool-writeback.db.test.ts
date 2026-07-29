// B-2: DB-Integrationstest für Pool-Zeit-Rückschreibung im
// submitWaiterSettlementCore-Pfad.
//   * Idempotenz: 2× Submit → genau 1 pool-Eintrag pro Pool-Zeile.
//   * Kollision: Staff mit clock-Eintrag am Tag → kein pool-Insert.
//   * Wasserlinie: business_date ≤ time_locked_through_date → kein pool-Insert,
//     kein pool_time.writeback Audit-Eintrag.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { submitWaiterSettlementCore } from "./cash.functions";
import type { StaffCaller } from "@/lib/time/time.functions";

describe.skipIf(!dbTestsEnabled)("Pool-Zeit-Rückschreibung (DB)", () => {
  let org: SeededOrg;
  let waiter: SeededUser;
  let kitchen: SeededUser;
  let businessDate: string;
  let sessionId: string;

  function caller(): StaffCaller {
    return {
      userId: waiter.userId,
      staffId: waiter.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }

  async function freshSession() {
    await org.service.from("sessions").delete().eq("organization_id", org.orgId);
    await org.service.from("time_entries").delete().eq("organization_id", org.orgId);
    await org.service
      .from("organization_settings")
      .update({ time_locked_through_date: null })
      .eq("organization_id", org.orgId);
    businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-pool-writeback freshSession)",
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
    sessionId = s.id;
  }

  async function seedPoolEntry(staffId: string, dept: "kitchen" | "service" | "gl") {
    const { error } = await org.service.from("session_tip_pool_entries").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: staffId,
      department: dept,
      shift_start: "15:00",
      shift_end: "23:00",
      hours_minutes: 480,
    });
    if (error) throw new Error(`pool entry seed: ${error.message}`);
  }

  beforeAll(async () => {
    org = await seedOrg("cash-pool-writeback");
    waiter = await org.mkUser("staff");
    kitchen = await org.mkUser("staff");
  });
  afterAll(async () => {
    await org.cleanup();
  });
  beforeEach(async () => {
    await freshSession();
  });

  it("Idempotenz: zweimal Submit → genau 1 pool-Eintrag", async () => {
    await seedPoolEntry(kitchen.staffId, "kitchen");
    const input = {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
    };
    await submitWaiterSettlementCore(caller(), input);
    await submitWaiterSettlementCore(caller(), input);
    const poolEntries = expectData(
      await org.service
        .from("time_entries")
        .select("id, import_key")
        .eq("organization_id", org.orgId)
        .eq("staff_id", kitchen.staffId)
        .eq("source", "pool"),
      "time_entries select pool-idempotency (cash-pool-writeback)",
    );
    expect(poolEntries).toHaveLength(1);
    expect(poolEntries[0].import_key?.startsWith("pool:")).toBe(true);
  });

  it("Kollision: Staff mit clock-Eintrag → kein pool-Insert", async () => {
    await seedPoolEntry(kitchen.staffId, "kitchen");
    // Echter clock-Eintrag für die Küche am gleichen Tag
    const { error } = await org.service.from("time_entries").insert({
      organization_id: org.orgId,
      staff_id: kitchen.staffId,
      started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      ended_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      business_date: businessDate,
      source: "clock",
    });
    if (error) throw new Error(`clock seed: ${error.message}`);

    await submitWaiterSettlementCore(caller(), {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
    });

    const poolEntries = expectData(
      await org.service
        .from("time_entries")
        .select("id")
        .eq("organization_id", org.orgId)
        .eq("staff_id", kitchen.staffId)
        .eq("source", "pool"),
      "time_entries select clock-collision (cash-pool-writeback)",
    );
    expect(poolEntries).toHaveLength(0);
  });

  it("Wasserlinie: gesperrter Tag → kein pool-Insert, kein writeback-Audit", async () => {
    await seedPoolEntry(kitchen.staffId, "kitchen");
    await org.service
      .from("organization_settings")
      .update({ time_locked_through_date: businessDate })
      .eq("organization_id", org.orgId);

    await submitWaiterSettlementCore(caller(), {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
    });

    const poolEntries = expectData(
      await org.service
        .from("time_entries")
        .select("id")
        .eq("organization_id", org.orgId)
        .eq("source", "pool"),
      "time_entries select waterline (cash-pool-writeback)",
    );
    expect(poolEntries).toHaveLength(0);

    const audits = expectData(
      await org.service
        .from("audit_log")
        .select("id")
        .eq("organization_id", org.orgId)
        .eq("action", "pool_time.writeback")
        .eq("entity_id", sessionId),
      "audit_log select waterline (cash-pool-writeback)",
    );
    expect(audits).toHaveLength(0);
  });
});
