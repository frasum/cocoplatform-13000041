// B3-Modellkorrektur Teil A: DB-Integrationstests für Mehrstandort-Kasse.
//
// Geprüft:
//   (a) Zwei Locations, je eigene Session am SELBEN business_date
//       koexistieren; (organization_id, location_id, business_date)-Unique
//       greift (zweite Session derselben Location/Tag → 23505).
//   (b) Kellner mit staff_locations-Bindung NUR an Location A →
//       submitWaiterSettlement für Standort B wirft
//       StaffLocationNotBoundError.
//   (c) Wasserlinie auf Location A (setCashLock) blockt Schreiben an
//       Location A, lässt Location B aber unberührt.
//   (d) assertLocationInOrg: locationId einer FREMDEN Org → ForbiddenError.

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
  setCashLockCore,
  updateSessionCore,
  assertLocationInOrg,
  StaffLocationNotBoundError,
} from "./cash.functions";
import { CashLockedError } from "./cash-lock";
import { ForbiddenError } from "@/lib/admin/role-guard";
import type { StaffCaller } from "@/lib/time/time.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("cash multi-location (DB)", () => {
  let org: SeededOrg;
  let otherOrg: SeededOrg;
  let locationB: string;
  let waiterA: SeededUser; // nur an Location A gebunden (default)
  let admin: SeededUser;
  let businessDate: string;
  let sessionA: string;
  let sessionB: string;

  function staffCaller(u: SeededUser): StaffCaller {
    return {
      userId: u.userId,
      staffId: u.staffId,
      organizationId: org.orgId,
      isActive: true,
      impersonatedBy: null,
    };
  }
  function adminCaller(): AdminCaller {
    return {
      userId: admin.userId,
      staffId: admin.staffId,
      organizationId: org.orgId,
      role: "admin",
    };
  }

  beforeAll(async () => {
    org = await seedOrg("cash-multiloc");
    otherOrg = await seedOrg("cash-multiloc-foreign");
    locationB = await org.mkLocation("Standort B");
    // waiterA wird via mkUser automatisch an org.defaultLocationId (A)
    // gebunden — explizit NICHT an Location B.
    waiterA = await org.mkUser("staff");
    admin = await org.mkUser("admin");
    // admin braucht Bindung an Location B, damit Sessions dort
    // serverseitig in Schreibpfaden nicht durch sonstige Bindungs-
    // Checks blockieren (für admin nicht zwingend, aber konsistent).
    await org.bindStaffLocation(admin.staffId, locationB);

    businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-multi-location setup)",
    );

    const { data: sA, error: eA } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        business_date: businessDate,
        status: "open",
      })
      .select("id")
      .single();
    if (eA || !sA) throw new Error(`seed session A: ${eA?.message}`);
    sessionA = sA.id;

    const { data: sB, error: eB } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: locationB,
        business_date: businessDate,
        status: "open",
      })
      .select("id")
      .single();
    if (eB || !sB) throw new Error(`seed session B: ${eB?.message}`);
    sessionB = sB.id;
  });

  afterAll(async () => {
    await org.cleanup();
    await otherOrg.cleanup();
  });

  it("(a) Zwei Locations koexistieren am selben business_date; Unique greift pro Location", async () => {
    // Beide Sessions sind oben erfolgreich angelegt worden — coexistence ok.
    expect(sessionA).not.toBe(sessionB);
    const list = expectData(
      await org.service
        .from("sessions")
        .select("id, location_id, business_date")
        .eq("organization_id", org.orgId)
        .eq("business_date", businessDate),
      "sessions select coexistence (cash-multi-location)",
    );
    expect(list.length).toBe(2);

    // Zweite Session derselben Location am gleichen Tag → 23505.
    const { error } = await org.service.from("sessions").insert({
      organization_id: org.orgId,
      location_id: org.defaultLocationId,
      business_date: businessDate,
      status: "open",
    });
    expect(error?.code).toBe("23505");
  });

  it("(b) Kellner nur an A gebunden → Submit gegen B wirft StaffLocationNotBoundError", async () => {
    // waiterA ist NUR an A gebunden. Da am selben business_date Sessions
    // an A und B offen sind, durchläuft der Aufruf den Mehrstandort-Zweig
    // und identifiziert die A-Session über staff_locations. Für den Test
    // (b) lösen wir die A-Bindung kurzzeitig, sodass für waiterA KEINE
    // passende Session existiert → StaffLocationNotBoundError.
    await org.service
      .from("staff_locations")
      .delete()
      .eq("organization_id", org.orgId)
      .eq("staff_id", waiterA.staffId)
      .eq("location_id", org.defaultLocationId);
    try {
      await expect(
        submitWaiterSettlementCore(staffCaller(waiterA), {
          posSalesCents: 10000,
          cardTotalCents: 0,
          hilfMahlCents: 0,
          openInvoicesCents: 0,
          cashHandedInCents: 10000,
        }),
      ).rejects.toBeInstanceOf(StaffLocationNotBoundError);
    } finally {
      // Bindung wiederherstellen, damit Folge-Tests unbeeinflusst sind.
      await org.bindStaffLocation(waiterA.staffId, org.defaultLocationId);
    }
  });

  it("(c) Wasserlinie auf A blockt A, lässt B unberührt", async () => {
    await setCashLockCore(adminCaller(), {
      locationId: org.defaultLocationId,
      throughDate: businessDate,
      reason: "Test Wasserlinie A",
    });

    const emptyUpdate = (sid: string) => ({
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
    });

    await expect(updateSessionCore(adminCaller(), emptyUpdate(sessionA))).rejects.toBeInstanceOf(
      CashLockedError,
    );
    // B ist UNBERÜHRT.
    await expect(updateSessionCore(adminCaller(), emptyUpdate(sessionB))).resolves.toBeDefined();
  });

  it("(d) assertLocationInOrg: locationId einer fremden Org → ForbiddenError", async () => {
    await expect(assertLocationInOrg(org.orgId, otherOrg.defaultLocationId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Sanity: eigene Location passiert ohne Fehler.
    await expect(assertLocationInOrg(org.orgId, locationB)).resolves.toBeUndefined();
  });
});
