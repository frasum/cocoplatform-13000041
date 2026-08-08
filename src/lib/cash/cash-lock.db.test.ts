// B3b-Gate: DB-Integrationstest für die Verschränkung Session-Sperre +
// Wasserlinie. Greift quer durch submit/update/correct/addSatellite.
//
// Geprüft:
//   (1) Session locked → alle vier Schreibpfade blockieren.
//   (2) Wasserlinie ≥ business_date → alle vier Schreibpfade blockieren.
//   (3) Kombination locked + Wasserlinie → CashLockedError mit Reason
//       'session_locked' (locked hat Vorrang).
//   (4) setCashLock ist forward-only (rückwärts/gleich → CashLockBackwardsError).
//   (5) lockSession und setCashLock sind admin-only (Manager → ForbiddenError,
//       kein Schreibvorgang in der DB).

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
  updateSessionCore,
  addSessionSatelliteCore,
  correctWaiterSettlementCore,
  lockSessionCore,
  setCashLockCore,
  CashLockBackwardsError,
  NoOpenSessionError,
} from "./cash.functions";
import { CashLockedError } from "./cash-lock";
import { ForbiddenError } from "@/lib/admin/role-guard";
import type { StaffCaller } from "@/lib/time/time.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("cash lock — Session-Sperre + Wasserlinie (DB)", () => {
  let org: SeededOrg;
  let waiter: SeededUser;
  let manager: SeededUser;
  let admin: SeededUser;

  function s(): StaffCaller {
    return {
      userId: waiter.userId,
      staffId: waiter.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }
  function mgr(): AdminCaller {
    return {
      userId: manager.userId,
      staffId: manager.staffId,
      organizationId: org.orgId,
      role: "manager",
    };
  }
  function adm(): AdminCaller {
    return {
      userId: admin.userId,
      staffId: admin.staffId,
      organizationId: org.orgId,
      role: "admin",
    };
  }

  async function reset(): Promise<void> {
    await org.service.from("sessions").delete().eq("organization_id", org.orgId);
    await org.service.from("time_entries").delete().eq("organization_id", org.orgId);
    await org.service.from("cash_locks").delete().eq("organization_id", org.orgId);
    await org.service
      .from("organization_settings")
      .upsert(
        { organization_id: org.orgId, kitchen_tip_rate: 0.02 },
        { onConflict: "organization_id" },
      );
  }

  async function seedSession(
    status: "open" | "locked",
  ): Promise<{ sessionId: string; businessDate: string; settlementId: string }> {
    const businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-lock seedSession)",
    );
    const insert: Record<string, unknown> = {
      organization_id: org.orgId,
      location_id: org.defaultLocationId,
      business_date: businessDate,
      status,
    };
    if (status === "locked") {
      insert.locked_at = new Date().toISOString();
      insert.locked_by = admin.staffId;
    }
    const sess = expectData(
      await org.service
        .from("sessions")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(insert as any)
        .select("id")
        .single(),
      `sessions insert (cash-lock seedSession status=${status})`,
    );
    let settlementId: string;
    if (status === "open") {
      const r = await submitWaiterSettlementCore(s(), {
        posSalesCents: 10000,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 10000,
        confirmedForeign: true,
      });
      settlementId = r.settlementId!;
    } else {
      const ws = expectData(
        await org.service
          .from("waiter_settlements")
          .insert({
            organization_id: org.orgId,
            session_id: sess.id,
            staff_id: waiter.staffId,
            kitchen_tip_rate: 0.02,
            status: "submitted",
            pos_sales_cents: 10000,
            cash_handed_in_cents: 10000,
          })
          .select("id")
          .single(),
        "waiter_settlements insert (cash-lock seedSession locked)",
      );
      settlementId = ws.id;
    }
    return { sessionId: sess.id, businessDate, settlementId };
  }

  function emptyUpdate(sessionId: string) {
    return {
      sessionId,
      channelAmounts: [],
      terminalAmounts: [],
      vouchersSoldCents: 0,
      guestCount: 0,
      vouchersRedeemedCents: 0,
      finedineVouchersCents: 0,
      vorschussCents: 0,
      einladungCents: 0,
      sonstigeEinnahmeCents: 0,
      notes: null,
    };
  }

  beforeAll(async () => {
    org = await seedOrg("cash-lock-db");
    waiter = await org.mkUser("staff");
    manager = await org.mkUser("manager");
    admin = await org.mkUser("admin");
  });
  afterAll(async () => {
    await org.cleanup();
  });

  it("(1) Session locked: submit + update + correct + addSatellite blocken", async () => {
    await reset();
    const { sessionId, settlementId } = await seedSession("locked");

    // submit: trifft auf status<>'open' → NoOpenSessionError (gleichwertiger Block).
    await expect(
      submitWaiterSettlementCore(s(), {
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        confirmedForeign: true,
      }),
    ).rejects.toBeInstanceOf(NoOpenSessionError);
    await expect(updateSessionCore(mgr(), emptyUpdate(sessionId))).rejects.toBeInstanceOf(
      CashLockedError,
    );
    await expect(
      correctWaiterSettlementCore(mgr(), {
        originalId: settlementId,
        posSalesCents: 99,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 99,
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
    await expect(
      addSessionSatelliteCore(mgr(), {
        sessionId,
        kind: "expense",
        description: "x",
        amountCents: 1,
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
  });

  it("(2) Wasserlinie (genau am Tag): submit + update + correct + addSatellite blocken", async () => {
    await reset();
    const { sessionId, businessDate, settlementId } = await seedSession("open");
    await org.service.from("cash_locks").upsert(
      {
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        locked_through_date: businessDate,
        updated_by: admin.staffId,
      },
      { onConflict: "organization_id,location_id" },
    );
    await expect(
      submitWaiterSettlementCore(s(), {
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        confirmedForeign: true,
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
    await expect(updateSessionCore(mgr(), emptyUpdate(sessionId))).rejects.toBeInstanceOf(
      CashLockedError,
    );
    await expect(
      correctWaiterSettlementCore(mgr(), {
        originalId: settlementId,
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        reason: "test",
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
    await expect(
      addSessionSatelliteCore(mgr(), {
        sessionId,
        kind: "expense",
        description: "x",
        amountCents: 1,
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
  });

  it("(3) Kombiniert locked + Wasserlinie: Reason 'session_locked' (Vorrang)", async () => {
    await reset();
    const { sessionId, businessDate } = await seedSession("locked");
    await org.service.from("cash_locks").upsert(
      {
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        locked_through_date: businessDate,
        updated_by: admin.staffId,
      },
      { onConflict: "organization_id,location_id" },
    );
    try {
      await updateSessionCore(mgr(), emptyUpdate(sessionId));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CashLockedError);
      expect((e as CashLockedError).reason).toBe("session_locked");
    }
  });

  it("(4) setCashLock: vorwärts ok; gleich oder rückwärts → CashLockBackwardsError", async () => {
    await reset();
    await seedSession("open");
    await setCashLockCore(adm(), {
      locationId: org.defaultLocationId,
      throughDate: "2026-01-31",
      reason: "Januar abgeschlossen",
    });
    await expect(
      setCashLockCore(adm(), {
        locationId: org.defaultLocationId,
        throughDate: "2026-01-31",
        reason: "nochmal",
      }),
    ).rejects.toBeInstanceOf(CashLockBackwardsError);
    await expect(
      setCashLockCore(adm(), {
        locationId: org.defaultLocationId,
        throughDate: "2026-01-01",
        reason: "zurück",
      }),
    ).rejects.toBeInstanceOf(CashLockBackwardsError);
    await setCashLockCore(adm(), {
      locationId: org.defaultLocationId,
      throughDate: "2026-02-28",
      reason: "Februar abgeschlossen",
    });
    const data = expectData(
      await org.service
        .from("cash_locks")
        .select("locked_through_date")
        .eq("organization_id", org.orgId)
        .eq("location_id", org.defaultLocationId)
        .single(),
      "cash_locks select forward-only (cash-lock)",
    );
    expect(data.locked_through_date).toBe("2026-02-28");
  });

  it("(5) lockSession + setCashLock admin-only — Manager → ForbiddenError, kein Schreibvorgang", async () => {
    await reset();
    const { sessionId } = await seedSession("open");
    const before = await org.service
      .from("sessions")
      .select("status, locked_at")
      .eq("id", sessionId)
      .single();

    await expect(lockSessionCore(mgr(), { sessionId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setCashLockCore(mgr(), {
        locationId: org.defaultLocationId,
        throughDate: "2099-12-31",
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const after = await org.service
      .from("sessions")
      .select("status, locked_at")
      .eq("id", sessionId)
      .single();
    expect(after.data?.status).toBe(before.data?.status);
    expect(after.data?.locked_at).toBe(before.data?.locked_at);
  });
});
