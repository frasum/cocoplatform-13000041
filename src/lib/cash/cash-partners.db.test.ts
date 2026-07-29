// Schritt-1-Test für die Mehrfach-Partner-Verknüpfung
// (settlement_partners). Läuft ausschließlich mit SUPABASE_DB_TESTS=1.

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

describe.skipIf(!dbTestsEnabled)("settlement_partners (DB)", () => {
  let org: SeededOrg;
  let primary: SeededUser;
  let partnerA: SeededUser;
  let partnerB: SeededUser;

  function callerFor(u: SeededUser): StaffCaller {
    return {
      userId: u.userId,
      staffId: u.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }

  async function freshSession() {
    await org.service.from("sessions").delete().eq("organization_id", org.orgId);
    await org.service.from("time_entries").delete().eq("organization_id", org.orgId);
    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-partners freshSession)",
    );
    const { error } = await org.service.from("sessions").insert({
      organization_id: org.orgId,
      location_id: org.defaultLocationId,
      business_date: bd,
      status: "open",
    });
    if (error) throw new Error(`session seed: ${error.message}`);
  }

  beforeAll(async () => {
    org = await seedOrg("cash-partners");
    primary = await org.mkUser("staff");
    partnerA = await org.mkUser("staff");
    partnerB = await org.mkUser("staff");
  });
  afterAll(async () => {
    await org.cleanup();
  });
  beforeEach(async () => {
    await freshSession();
  });

  it("schreibt zwei settlement_partners-Zeilen bei zwei Partnern", async () => {
    const res = await submitWaiterSettlementCore(callerFor(primary), {
      posSalesCents: 1000,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1000,
      partnerStaffIds: [partnerA.staffId, partnerB.staffId],
    });
    const parts = expectData(
      await org.service
        .from("settlement_partners")
        .select("staff_id")
        .eq("settlement_id", res.settlementId)
        .order("staff_id"),
      "settlement_partners select (cash-partners)",
    );
    expect(parts.map((p) => p.staff_id).sort()).toEqual(
      [partnerA.staffId, partnerB.staffId].sort(),
    );
  });

  it("lehnt Partner = Haupt-Kellner ab", async () => {
    await expect(
      submitWaiterSettlementCore(callerFor(primary), {
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        partnerStaffIds: [primary.staffId],
      }),
    ).rejects.toThrow(/Haupt-Kellner/);
  });

  it("lehnt Partner ab, der bereits in aktiver Abrechnung derselben Session verknüpft ist", async () => {
    await submitWaiterSettlementCore(callerFor(primary), {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
      partnerStaffIds: [partnerA.staffId],
    });
    await expect(
      submitWaiterSettlementCore(callerFor(partnerB), {
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        partnerStaffIds: [partnerA.staffId],
      }),
    ).rejects.toThrow(/aktive Abrechnung|Partner/);
  });
});
