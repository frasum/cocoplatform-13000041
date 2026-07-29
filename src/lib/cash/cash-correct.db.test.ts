// B3b-Gate: DB-Integrationstest für correctWaiterSettlementCore.
// Geprüft:
//   (1) Korrektur: Original→superseded + neue Zeile + corrected_from_id +
//       kitchen_tip_rate ERBT vom Original (auch wenn Org-Rate inzwischen
//       geändert wurde) + Audit-Meta enthält reason + inheritedKitchenTipRate.
//   (2) Doppelkorrektur auf die SAME originalId: SettlementNotCorrectableError
//       (Original ist superseded).
//   (3) Partial-Unique-Index `waiter_settlements_active_per_staff`:
//       zweiter non-superseded für (session, staff) wird real (23505) abgelehnt.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import {
  submitWaiterSettlementCore,
  correctWaiterSettlementCore,
  SettlementNotCorrectableError,
} from "./cash.functions";
import type { StaffCaller } from "@/lib/time/time.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("correctWaiterSettlementCore (DB)", () => {
  let org: SeededOrg;
  let waiter: SeededUser;
  let manager: SeededUser;
  let sessionId: string;
  let settlementId: string;

  function s(): StaffCaller {
    return {
      userId: waiter.userId,
      staffId: waiter.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }
  function m(): AdminCaller {
    return {
      userId: manager.userId,
      staffId: manager.staffId,
      organizationId: org.orgId,
      role: "manager",
    };
  }

  beforeAll(async () => {
    org = await seedOrg("cash-correct");
    waiter = await org.mkUser("staff");
    manager = await org.mkUser("manager");

    // kitchen_tip_rate auf 0.05 (anders als Default 0.02) für Snapshot-Test.
    await org.service
      .from("organization_settings")
      .upsert(
        { organization_id: org.orgId, kitchen_tip_rate: 0.05 },
        { onConflict: "organization_id" },
      );

    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-correct setup)",
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
      "sessions insert (cash-correct setup)",
    );
    sessionId = sess.id;

    const r = await submitWaiterSettlementCore(s(), {
      posSalesCents: 100000,
      cardTotalCents: 20000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 80000,
    });
    settlementId = r.settlementId;
  });
  afterAll(async () => {
    await org.cleanup();
  });

  it("(1) Korrektur: superseded + neue Zeile + erbt kitchen_tip_rate + Audit-reason", async () => {
    // Rate auf 0.10 ändern — neue Zeile soll trotzdem 0.05 (Original) erben.
    await org.service
      .from("organization_settings")
      .upsert(
        { organization_id: org.orgId, kitchen_tip_rate: 0.1 },
        { onConflict: "organization_id" },
      );

    const res = await correctWaiterSettlementCore(m(), {
      originalId: settlementId,
      posSalesCents: 110000,
      cardTotalCents: 30000,
      hilfMahlCents: 500,
      openInvoicesCents: 0,
      cashHandedInCents: 80500,
      reason: "Tippfehler bei pos_sales",
    });
    expect(res.newId).not.toBe(settlementId);
    expect(res.originalId).toBe(settlementId);

    const orig = expectData(
      await org.service.from("waiter_settlements").select("status").eq("id", settlementId).single(),
      "waiter_settlements select original (cash-correct)",
    );
    expect(orig.status).toBe("superseded");

    const neu = expectData(
      await org.service
        .from("waiter_settlements")
        .select("status, kitchen_tip_rate, corrected_from_id, pos_sales_cents")
        .eq("id", res.newId)
        .single(),
      "waiter_settlements select new (cash-correct)",
    );
    expect(neu.status).toBe("submitted");
    expect(neu.corrected_from_id).toBe(settlementId);
    expect(Number(neu.kitchen_tip_rate)).toBe(0.05); // geerbt, NICHT 0.10
    expect(neu.pos_sales_cents).toBe(110000);

    const audits = expectData(
      await org.service.from("audit_log").select("action, meta").eq("entity_id", res.newId),
      "audit_log select correction (cash-correct)",
    );
    const entry = audits.find((a) => a.action === "cash.settlement.corrected");
    expect(entry).toBeDefined();
    const meta = entry!.meta as Record<string, unknown>;
    expect(meta.reason).toBe("Tippfehler bei pos_sales");
    expect(meta.inheritedKitchenTipRate).toBe(0.05);
  });

  it("(2) Doppelkorrektur auf SAME originalId: SettlementNotCorrectableError", async () => {
    // Original ist nun 'superseded' — Korrektur muss abgelehnt werden.
    await expect(
      correctWaiterSettlementCore(m(), {
        originalId: settlementId,
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        reason: "nochmal",
      }),
    ).rejects.toBeInstanceOf(SettlementNotCorrectableError);
  });

  it("(3) Partial-Unique-Index: zweiter non-superseded für (session, staff) → 23505", async () => {
    const { error } = await org.service.from("waiter_settlements").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: waiter.staffId,
      kitchen_tip_rate: 0.05,
      status: "submitted",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });
});
