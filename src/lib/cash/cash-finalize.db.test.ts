// B3b-Gate: DB-Integrationstest für finalize-Semantik.
// Geprüft (sequenziell, gleiche Session über mehrere Steps):
//   (1) finalize gelingt; status='finalized', finalized_at gesetzt.
//   (2) Nach finalize → updateSession blockt mit Reason 'session_finalized'
//       (Spec-Klärung M2-Steckbrief §5: finalize friert Sessionsicht ein).
//   (3) Nach finalize → correctWaiterSettlement bleibt erlaubt
//       (Korrekturen offen bis zur harten Sperre).
//   (4) Nach lock → sowohl updateSession als auch correctWaiterSettlement
//       sind blockiert.

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
  finalizeSessionCore,
  updateSessionCore,
  correctWaiterSettlementCore,
  lockSessionCore,
  PoolHoursWarningError,
} from "./cash.functions";
import { CashLockedError } from "./cash-lock";
import type { StaffCaller } from "@/lib/time/time.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("finalize → update vs. correct (DB)", () => {
  let org: SeededOrg;
  let waiter: SeededUser;
  let manager: SeededUser;
  let admin: SeededUser;
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

  function emptyUpdate(sid: string) {
    return {
      sessionId: sid,
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
    org = await seedOrg("cash-finalize");
    waiter = await org.mkUser("staff");
    manager = await org.mkUser("manager");
    admin = await org.mkUser("admin");
    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-finalize setup)",
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
      "sessions insert (cash-finalize setup)",
    );
    sessionId = sess.id;
    const r = await submitWaiterSettlementCore(s(), {
      posSalesCents: 100000,
      cardTotalCents: 20000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      // Tip = pos - card - cash = 1000 cents. Ohne Time-Entries in dieser
      // Session sind 0 Minuten anrechenbar → Service- und Küchen-Pool
      // enthalten Geld, aber nichts wird verteilt → finalize MUSS eine
      // PoolHoursWarningError werfen, bevor confirmPoolWarning bestätigt.
      cashHandedInCents: 79000,
      confirmedForeign: true,
    });
    settlementId = r.settlementId!;
  });
  afterAll(async () => {
    await org.cleanup();
  });

  it("(1) finalize wirft PoolHoursWarningError; mit confirmPoolWarning finalisiert", async () => {
    // Erster Aufruf ohne Bestätigung: Pool hat Geld, 0 anrechenbare Minuten.
    await expect(finalizeSessionCore(mgr(), { sessionId })).rejects.toBeInstanceOf(
      PoolHoursWarningError,
    );
    // Status noch offen, nichts geschrieben.
    const pre = expectData(
      await org.service
        .from("sessions")
        .select("status, finalized_at")
        .eq("id", sessionId)
        .single(),
      "sessions select pre-finalize (cash-finalize)",
    );
    expect(pre.status).toBe("open");
    expect(pre.finalized_at).toBeNull();

    // Zweiter Aufruf mit Bestätigung: geht durch.
    await finalizeSessionCore(mgr(), { sessionId, confirmPoolWarning: true });
    const sess = expectData(
      await org.service
        .from("sessions")
        .select("status, finalized_at, finalized_by")
        .eq("id", sessionId)
        .single(),
      "sessions select post-finalize (cash-finalize)",
    );
    expect(sess.status).toBe("finalized");
    expect(sess.finalized_at).not.toBeNull();
    expect(sess.finalized_by).toBe(manager.staffId);
  });

  it("(2) Nach finalize → updateSession blockt (Reason 'session_finalized')", async () => {
    try {
      await updateSessionCore(mgr(), emptyUpdate(sessionId));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CashLockedError);
      expect((e as CashLockedError).reason).toBe("session_finalized");
    }

    // DB unverändert (sanity).
    const sess = expectData(
      await org.service
        .from("sessions")
        .select("notes, vouchers_sold_cents")
        .eq("id", sessionId)
        .single(),
      "sessions select sanity after blocked update (cash-finalize)",
    );
    expect(sess.notes).toBeNull();
    expect(sess.vouchers_sold_cents).toBe(0);
  });

  it("(3) Nach finalize → correctWaiterSettlement bleibt erlaubt", async () => {
    const res = await correctWaiterSettlementCore(mgr(), {
      originalId: settlementId,
      posSalesCents: 110000,
      cardTotalCents: 20000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 90000,
      reason: "nach finalize korrigiert",
    });
    expect(res.newId).not.toBe(settlementId);
    const neu = expectData(
      await org.service
        .from("waiter_settlements")
        .select("status, pos_sales_cents")
        .eq("id", res.newId)
        .single(),
      "waiter_settlements select correction after finalize (cash-finalize)",
    );
    expect(neu.status).toBe("submitted");
    expect(neu.pos_sales_cents).toBe(110000);
    settlementId = res.newId; // für Schritt 4
  });

  it("(4) Nach lock → update UND correct beide blockiert", async () => {
    await lockSessionCore(adm(), { sessionId });
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
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(CashLockedError);
  });
});
