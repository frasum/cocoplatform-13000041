// B3b-Gate: DB-Integrationstest für submitWaiterSettlementCore.
// Muster: src/lib/admin/role-guard.db.test.ts. Läuft NUR mit
// SUPABASE_DB_TESTS=1 gegen lokalen `supabase start`.
//
// Geprüft:
//   (a) Happy-Path: genau ein clockOut, auto_clockout_time_entry_id gesetzt,
//       Audit enthält triggered_by:settlement + arbzg_default:true.
//   (b) Doppel-Submit: zweiter Aufruf idempotent, KEIN zweiter clockOut,
//       Geldfelder unverändert (Eingabe des zweiten Calls wird ignoriert),
//       Audit cash.settlement.resubmit_noop existiert.
//   (c) Kein offener Zeiteintrag: Settlement angelegt, noOpenTimeEntry=true,
//       KEIN clockOut.
//   (d) ArbZG-Pause via break_minutes: 30 bei 7h, 45 bei 10h.
//   (e) Keine offene Session am Geschäftstag: NoOpenSessionError.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { submitWaiterSettlementCore, NoOpenSessionError } from "./cash.functions";
import type { StaffCaller } from "@/lib/time/time.functions";

describe.skipIf(!dbTestsEnabled)("submitWaiterSettlementCore (DB)", () => {
  let org: SeededOrg;
  let waiter: SeededUser;
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
    // Pro Test: vorherige Session + time_entries entfernen (Audit-Log bleibt).
    await org.service.from("sessions").delete().eq("organization_id", org.orgId);
    await org.service.from("time_entries").delete().eq("organization_id", org.orgId);
    businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-submit freshSession)",
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

  async function openTimeEntry(startedAtIso: string): Promise<string> {
    const bd = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (cash-submit openTimeEntry)",
    );
    const te = expectData(
      await org.service
        .from("time_entries")
        .insert({
          organization_id: org.orgId,
          staff_id: waiter.staffId,
          started_at: startedAtIso,
          business_date: bd,
          source: "clock",
        })
        .select("id")
        .single(),
      "time_entries insert (cash-submit openTimeEntry)",
    );
    return te.id;
  }

  beforeAll(async () => {
    org = await seedOrg("cash-submit");
    waiter = await org.mkUser("staff");
  });
  afterAll(async () => {
    await org.cleanup();
  });
  beforeEach(async () => {
    await freshSession();
  });

  it("(a) genau ein clockOut, auto_clockout_time_entry_id gesetzt, Audit triggered_by:settlement + arbzg_default:true", async () => {
    const teId = await openTimeEntry(new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
    const res = await submitWaiterSettlementCore(caller(), {
      posSalesCents: 50000,
      cardTotalCents: 10000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 40000,
      confirmedForeign: true,
    });
    expect(res.autoClockoutTimeEntryId).toBe(teId);
    expect(res.noOpenTimeEntry).toBe(false);
    expect(res.idempotent).toBe(false);

    const ws = expectData(
      await org.service
        .from("waiter_settlements")
        .select("auto_clockout_time_entry_id, status")
        .eq("id", res.settlementId!)
        .single(),
      "waiter_settlements select happy-path (cash-submit)",
    );
    expect(ws.auto_clockout_time_entry_id).toBe(teId);
    expect(ws.status).toBe("submitted");

    const teRow = expectData(
      await org.service.from("time_entries").select("ended_at").eq("id", teId).single(),
      "time_entries select ended_at (cash-submit happy-path)",
    );
    expect(teRow.ended_at).not.toBeNull();

    const audits = expectData(
      await org.service
        .from("audit_log")
        .select("action, meta")
        .eq("organization_id", org.orgId)
        .eq("action", "time_entry.clock_out"),
      "audit_log select clock_out (cash-submit happy-path)",
    );
    const matching = audits.filter((a) => {
      const m = a.meta as Record<string, unknown> | null;
      return m?.settlement_id === res.settlementId!;
    });
    expect(matching.length).toBe(1);
    const meta = matching[0].meta as Record<string, unknown>;
    expect(meta.triggered_by).toBe("settlement");
    expect(meta.arbzg_default).toBe(true);
  });

  it("(b) Doppel-Submit: idempotent, kein zweiter clockOut, Geldfelder unverändert", async () => {
    await openTimeEntry(new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
    const first = await submitWaiterSettlementCore(caller(), {
      posSalesCents: 50000,
      cardTotalCents: 10000,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 40000,
      confirmedForeign: true,
    });
    const beforeAudits = await org.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("action", "time_entry.clock_out");
    const second = await submitWaiterSettlementCore(caller(), {
      // bewusst andere Eingabe — muss IGNORIERT werden (Idempotenz).
      posSalesCents: 99999,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 0,
      confirmedForeign: true,
    });
    expect(second.settlementId!).toBe(first.settlementId!);
    expect(second.idempotent).toBe(true);

    const afterAudits = await org.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("action", "time_entry.clock_out");
    expect(afterAudits.count).toBe(beforeAudits.count);

    const ws = expectData(
      await org.service
        .from("waiter_settlements")
        .select("pos_sales_cents, cash_handed_in_cents")
        .eq("id", first.settlementId!)
        .single(),
      "waiter_settlements select idempotent (cash-submit)",
    );
    expect(ws.pos_sales_cents).toBe(50000);
    expect(ws.cash_handed_in_cents).toBe(40000);

    const noop = expectData(
      await org.service
        .from("audit_log")
        .select("action")
        .eq("organization_id", org.orgId)
        .eq("entity_id", first.settlementId!)
        .eq("action", "cash.settlement.resubmit_noop"),
      "audit_log select resubmit_noop (cash-submit)",
    );
    expect(noop.length).toBeGreaterThan(0);
  });

  it("(c) kein offener Zeiteintrag: noOpenTimeEntry=true, KEIN clockOut", async () => {
    const before = await org.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("action", "time_entry.clock_out");
    const res = await submitWaiterSettlementCore(caller(), {
      posSalesCents: 1000,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1000,
      confirmedForeign: true,
    });
    expect(res.noOpenTimeEntry).toBe(true);
    expect(res.autoClockoutTimeEntryId).toBeNull();
    const after = await org.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("action", "time_entry.clock_out");
    expect(after.count).toBe(before.count);
  });

  it("(d) ArbZG: 30 Min bei 7h gross, 45 Min bei 10h gross", async () => {
    const te7 = await openTimeEntry(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());
    await submitWaiterSettlementCore(caller(), {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
      confirmedForeign: true,
    });
    const te7row = expectData(
      await org.service.from("time_entries").select("break_minutes").eq("id", te7).single(),
      "time_entries select break_minutes 7h (cash-submit ArbZG)",
    );
    expect(te7row.break_minutes).toBe(30);

    await freshSession();
    const te10 = await openTimeEntry(new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString());
    await submitWaiterSettlementCore(caller(), {
      posSalesCents: 1,
      cardTotalCents: 0,
      hilfMahlCents: 0,
      openInvoicesCents: 0,
      cashHandedInCents: 1,
      confirmedForeign: true,
    });
    const te10row = expectData(
      await org.service.from("time_entries").select("break_minutes").eq("id", te10).single(),
      "time_entries select break_minutes 10h (cash-submit ArbZG)",
    );
    expect(te10row.break_minutes).toBe(45);
  });

  it("(e) keine offene Session am Geschäftstag → NoOpenSessionError", async () => {
    await org.service.from("sessions").delete().eq("id", sessionId);
    await expect(
      submitWaiterSettlementCore(caller(), {
        posSalesCents: 1,
        cardTotalCents: 0,
        hilfMahlCents: 0,
        openInvoicesCents: 0,
        cashHandedInCents: 1,
        confirmedForeign: true,
      }),
    ).rejects.toBeInstanceOf(NoOpenSessionError);
  });
});
