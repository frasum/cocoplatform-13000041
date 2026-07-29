// B3c-1a: DB-Integrationstest für die Read-Endpunkte.
// Muster: src/lib/cash/cash-submit.db.test.ts.
//
// Geprüft:
//   (1) Kellner-Aufruf gegen Manager-Reader (getCashOverviewCore,
//       listRevenueChannelsCore, listPaymentTerminalsCore) wirft
//       ForbiddenError — Reader leaken nichts an Staff.
//   (2) Manager sieht Overview inkl. channelAmounts, terminalAmounts
//       und allen fünf Satelliten-Listen seiner Org. Cross-Org-Härtung:
//       Daten einer anderen Org tauchen nicht auf.
//   (3) Staff-Reader getMySettlementCore liefert kitchenTipRate aus
//       organization_settings auch ohne vorhandene Settlement.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { ForbiddenError } from "@/lib/admin/role-guard";
import type { AdminCaller } from "@/lib/admin/admin-context";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import type { StaffCaller } from "@/lib/time/time.functions";
import {
  getCashOverviewCore,
  getMySettlementCore,
  listRevenueChannelsCore,
  listPaymentTerminalsCore,
} from "./cash.functions";

describe.skipIf(!dbTestsEnabled)("cash read endpoints (DB) — B3c-1a", () => {
  let org: SeededOrg;
  let otherOrg: SeededOrg;
  let manager: SeededUser;
  let waiter: SeededUser;
  let sessionId: string;
  let channelId: string;
  let terminalId: string;
  let businessDate: string;

  function mgrCaller(): AdminCaller {
    return {
      userId: manager.userId,
      staffId: manager.staffId,
      organizationId: org.orgId,
      role: "manager",
    };
  }
  function waiterCaller(): StaffCaller {
    return {
      userId: waiter.userId,
      staffId: waiter.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }

  beforeAll(async () => {
    org = await seedOrg("cash-read");
    otherOrg = await seedOrg("cash-read-other");
    manager = await org.mkUser("manager");
    waiter = await org.mkUser("staff");

    // Tip-Rate auf 3.5% setzen (organization_settings wird per Trigger angelegt).
    await org.service
      .from("organization_settings")
      .update({ kitchen_tip_rate: 0.035 })
      .eq("organization_id", org.orgId);

    // Stammdaten-Kanäle werden seit dem AFTER-INSERT-Trigger
    // `tg_locations_seed_defaults` (Migration P1-Nachzieher) automatisch
    // mit dem vollständigen Satz (pos/souse/wolt/vectron) je Location
    // angelegt. Wir benennen hier nur die für diesen Test relevanten
    // Labels um (Aussage bleibt: Custom-Labels je Org sichtbar, fremde
    // Org-Daten unsichtbar) und holen die channelId per SELECT.
    {
      const upd1 = await org.service
        .from("revenue_channels")
        .update({ label: "Restaurant" })
        .eq("organization_id", org.orgId)
        .eq("location_id", org.defaultLocationId)
        .eq("kind", "pos");
      if (upd1.error) throw new Error(`rename pos failed: ${upd1.error.message}`);
      const upd2 = await org.service
        .from("revenue_channels")
        .update({ label: "Lieferung" })
        .eq("organization_id", org.orgId)
        .eq("location_id", org.defaultLocationId)
        .eq("kind", "delivery_souse");
      if (upd2.error) throw new Error(`rename souse failed: ${upd2.error.message}`);
      const upd3 = await otherOrg.service
        .from("revenue_channels")
        .update({ label: "FREMD" })
        .eq("organization_id", otherOrg.orgId)
        .eq("location_id", otherOrg.defaultLocationId)
        .eq("kind", "pos");
      if (upd3.error) throw new Error(`rename other pos failed: ${upd3.error.message}`);
    }
    const posCh = expectData(
      await org.service
        .from("revenue_channels")
        .select("id")
        .eq("organization_id", org.orgId)
        .eq("location_id", org.defaultLocationId)
        .eq("kind", "pos")
        .single(),
      "revenue_channels lookup pos (cash-read setup)",
    );
    channelId = posCh.id;

    const t1 = expectData(
      await org.service
        .from("payment_terminals")
        .insert({
          organization_id: org.orgId,
          location_id: org.defaultLocationId,
          label: "Terminal A",
          sort_order: 1,
        })
        .select("id")
        .single(),
      "payment_terminals insert (cash-read setup)",
    );
    await otherOrg.service.from("payment_terminals").insert({
      organization_id: otherOrg.orgId,
      location_id: otherOrg.defaultLocationId,
      label: "FREMD-T",
      sort_order: 1,
    });
    terminalId = t1.id;

    // Offene Session für heute + Satelliten in unserer Org.
    businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-read setup)",
    );
    const session = expectData(
      await org.service
        .from("sessions")
        .insert({
          organization_id: org.orgId,
          location_id: org.defaultLocationId,
          business_date: businessDate,
          status: "open",
        })
        .select("id")
        .single(),
      "sessions insert (cash-read setup)",
    );
    sessionId = session.id;

    await org.service.from("session_channel_amounts").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      channel_id: channelId,
      amount_cents: 12345,
    });
    await org.service.from("session_terminal_amounts").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      terminal_id: terminalId,
      amount_cents: 6789,
    });
    await org.service.from("session_expenses").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      description: "Blumen",
      amount_cents: 500,
    });
    await org.service.from("session_advances").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      staff_id: waiter.staffId,
      amount_cents: 1000,
      note: "Vorschuss",
    });
    await org.service.from("session_card_transactions").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      terminal_id: terminalId,
      amount_cents: 2000,
    });
    await org.service.from("session_bank_deposits").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      amount_cents: 3000,
      reference: "EZB-1",
    });
    await org.service.from("session_register_transfers").insert({
      organization_id: org.orgId,
      session_id: sessionId,
      direction: "to_restaurant",
      amount_cents: 4000,
    });

    // Fremde Org: identische Session/Satellit, darf NIE auftauchen.
    const s2 = expectData(
      await otherOrg.service
        .from("sessions")
        .insert({
          organization_id: otherOrg.orgId,
          location_id: otherOrg.defaultLocationId,
          business_date: businessDate,
          status: "open",
        })
        .select("id")
        .single(),
      "sessions insert (cash-read setup, other org)",
    );
    await otherOrg.service.from("session_expenses").insert({
      organization_id: otherOrg.orgId,
      session_id: s2!.id,
      description: "FREMD",
      amount_cents: 99999,
    });
  });

  afterAll(async () => {
    await org.cleanup();
    await otherOrg.cleanup();
  });

  it("(2) Manager-Overview enthält Amounts + alle 5 Satelliten-Listen, nichts Fremdes", async () => {
    const ov = await getCashOverviewCore(mgrCaller(), { businessDate });
    expect(ov.session?.id).toBe(sessionId);
    expect(ov.channelAmounts).toEqual([{ channelId, amountCents: 12345 }]);
    expect(ov.terminalAmounts).toEqual([{ terminalId, amountCents: 6789 }]);
    expect(ov.expenses.map((e) => e.description)).toEqual(["Blumen"]);
    expect(ov.advances.map((a) => a.amountCents)).toEqual([1000]);
    expect(ov.cardTransactions.map((c) => c.amountCents)).toEqual([2000]);
    expect(ov.bankDeposits.map((b) => b.reference)).toEqual(["EZB-1"]);
    expect(ov.registerTransfers.map((t) => t.direction)).toEqual(["to_restaurant"]);
  });

  it("(2b) listRevenueChannels/listPaymentTerminals nur eigene Org, sortiert", async () => {
    const channels = await listRevenueChannelsCore(mgrCaller());
    // Vollständige Realität: Trigger seedet 4 Kanäle je Location
    // (sort_order 10/20/30/40). Pos+Souse haben wir auf Custom-Labels
    // umbenannt; Wolt+Vectron behalten die Trigger-Defaults.
    expect(channels.map((c) => c.label)).toEqual(["Restaurant", "Lieferung", "Wolt", "Vectron"]);
    expect(channels.every((c) => c.label !== "FREMD")).toBe(true);
    const terms = await listPaymentTerminalsCore(mgrCaller());
    expect(terms.map((t) => t.label)).toEqual(["Terminal A"]);
  });

  it("(3) getMySettlement liefert kitchenTipRate auch ohne Settlement", async () => {
    const my = await getMySettlementCore(waiterCaller());
    expect(my.kitchenTipRate).toBeCloseTo(0.035, 5);
    expect(my.settlement).toBeNull();
    expect(my.session?.id).toBe(sessionId);
  });

  it("(1) Reader sind Manager-only — Staff-Login gegen den server-fn Wrapper wirft Forbidden", async () => {
    // End-to-End: als Kellner authentifizieren, dann den exakten
    // Wrapper-Codepfad ausführen (loadAdminCaller mit minRole='manager').
    // Genau dieser Aufruf steht in den server-fn Handlern von
    // getCashOverview / listRevenueChannels / listPaymentTerminals und
    // wirft, BEVOR Core-Code mit Org-Scope ausgeführt werden kann.
    const client = await signInAsUser(waiter.email, waiter.password);
    await expect(loadAdminCaller(client, waiter.userId, "manager")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
