// DB-Integrationstest für adminCreateWaiterSettlementCore.
// Geprüft:
//   (a) Happy Path: Insert → status=submitted, korrekte differenz_cents
//       und kitchen_tip_cents, KEIN Auto-Clockout.
//   (b) Duplikat-Schutz: zweiter Aufruf für (session, staff) →
//       WaiterSettlementAlreadyExistsError.
//   (c) Staff nicht an Session-Location gebunden →
//       StaffLocationNotBoundError.
//   (d) Wasserlinie überdeckt Geschäftstag → CashLockedError.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import {
  adminCreateWaiterSettlementCore,
  WaiterSettlementAlreadyExistsError,
  StaffLocationNotBoundError,
  CashLockedError,
} from "./cash.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("adminCreateWaiterSettlementCore (DB)", () => {
  let org: SeededOrg;
  let manager: SeededUser;
  let waiterA: SeededUser;
  let waiterB: SeededUser;
  let sessionId: string;

  function m(): AdminCaller {
    return {
      userId: manager.userId,
      staffId: manager.staffId,
      organizationId: org.orgId,
      role: "manager",
    };
  }

  beforeAll(async () => {
    org = await seedOrg("cash-admin-create");
    manager = await org.mkUser("manager");
    waiterA = await org.mkUser("staff");
    waiterB = await org.mkUser("staff");

    // waiterB Bindung an Default-Location entfernen → not-bound-Pfad.
    await org.service
      .from("staff_locations")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("staff_id", waiterB.staffId)
      .eq("location_id", org.defaultLocationId);

    await org.service
      .from("organization_settings")
      .upsert(
        { organization_id: org.orgId, kitchen_tip_rate: 0.05 },
        { onConflict: "organization_id" },
      );

    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-admin-create-settlement setup)",
    );
    const sess = expectData(
      await org.service
        .from("sessions")
        .insert({
          organization_id: org.orgId,
          location_id: org.defaultLocationId,
          business_date: bd,
          status: "open",
        })
        .select("id")
        .single(),
      "sessions insert (cash-admin-create-settlement setup)",
    );
    sessionId = sess.id;
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it("(a) Happy Path: angelegt, korrekt berechnet, kein Auto-Clockout", async () => {
    const res = await adminCreateWaiterSettlementCore(m(), {
      sessionId,
      staffId: waiterA.staffId,
      posSalesCents: 100000,
      cardTotalCents: 20000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 80000,
      reason: "Nacherfassung — Kellner war krank",
    });
    expect(res.newId).toBeTruthy();

    const row = expectData(
      await org.service
        .from("waiter_settlements")
        .select(
          "status, kitchen_tip_rate, differenz_cents, kitchen_tip_cents, auto_clockout_time_entry_id, corrected_from_id",
        )
        .eq("id", res.newId)
        .single(),
      "waiter_settlements select happy-path (cash-admin-create-settlement)",
    );
    expect(row.status).toBe("submitted");
    expect(Number(row.kitchen_tip_rate)).toBe(0.05);
    expect(row.auto_clockout_time_entry_id).toBeNull();
    expect(row.corrected_from_id).toBeNull();
    expect(row.differenz_cents).toBe(res.differenzCents);
    expect(row.kitchen_tip_cents).toBe(res.kitchenTipCents);
  });

  it("(b) Duplikat: zweiter Aufruf → WaiterSettlementAlreadyExistsError", async () => {
    await expect(
      adminCreateWaiterSettlementCore(m(), {
        sessionId,
        staffId: waiterA.staffId,
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        reason: "Doppel",
      }),
    ).rejects.toBeInstanceOf(WaiterSettlementAlreadyExistsError);
  });

  it("(c) Staff nicht an Location gebunden → StaffLocationNotBoundError", async () => {
    await expect(
      adminCreateWaiterSettlementCore(m(), {
        sessionId,
        staffId: waiterB.staffId,
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        reason: "Test",
      }),
    ).rejects.toBeInstanceOf(StaffLocationNotBoundError);
  });

  it("(d) Wasserlinie aktiv → CashLockedError", async () => {
    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-admin-create-settlement Wasserlinie)",
    );
    // Wasserlinie auf heute setzen (überdeckt den Geschäftstag der Session).
    await org.service.from("cash_locks").upsert(
      {
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        locked_through_date: bd,
      },
      { onConflict: "organization_id,location_id" },
    );
    // Frischer Waiter, damit nicht der Duplikat-Pfad zuerst greift.
    const waiterC = await org.mkUser("staff");
    await expect(
      adminCreateWaiterSettlementCore(m(), {
        sessionId,
        staffId: waiterC.staffId,
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        reason: "Test Wasserlinie",
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
    // Wasserlinie wieder aufheben (Cleanup für nachfolgende Suite-Aufrufe).
    await org.service
      .from("cash_locks")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("location_id", org.defaultLocationId);
  });
});
