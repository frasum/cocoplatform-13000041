// MA2 — Kanal/Terminal-Referenzen gegen Session-Standort validieren.
// Guards laufen VOR sessions.UPDATE (N11 „ganz oder gar nicht"): eine
// fremde Kanal- oder Terminal-Referenz darf weder das Session-Objekt
// noch die session_channel_amounts/-terminal_amounts anfassen.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  expectData,
  seedOrg,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import {
  updateSessionCore,
  CrossLocationRefError,
  type UpdateSessionInput,
} from "./cash.functions";
import type { AdminCaller } from "@/lib/admin/admin-context";

describe.skipIf(!dbTestsEnabled)("MA2 — cross-location channel/terminal refs (DB)", () => {
  let org: SeededOrg;
  let admin: SeededUser;
  let locationB: string;
  let sessionA: string;
  // Referenzen an Standort A (gültig) und B (fremd).
  let channelA: string;
  let channelB: string;
  let terminalA: string;
  let terminalB: string;
  // Vor-Zustand für die Unverändert-Assertion.
  const INITIAL_GUEST_COUNT = 7;
  const SEEDED_CHANNEL_AMOUNT = 4242;

  function adminCaller(): AdminCaller {
    return {
      userId: admin.userId,
      staffId: admin.staffId,
      organizationId: org.orgId,
      role: "admin",
    };
  }

  function baseUpdate(overrides: Partial<UpdateSessionInput> = {}): UpdateSessionInput {
    return {
      sessionId: sessionA,
      channelAmounts: [],
      terminalAmounts: [],
      vouchersSoldCents: 0,
      vouchersRedeemedCents: 0,
      finedineVouchersCents: 0,
      vorschussCents: 0,
      einladungCents: 0,
      sonstigeEinnahmeCents: 0,
      guestCount: 99, // bewusst != INITIAL_GUEST_COUNT → Unverändert-Assertion
      notes: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    org = await seedOrg("ma2-cross-loc");
    admin = await org.mkUser("admin");
    locationB = await org.mkLocation("Standort B");

    const getPosChannel = async (locId: string) => {
      const { data, error } = await org.service
        .from("revenue_channels")
        .select("id")
        .eq("organization_id", org.orgId)
        .eq("location_id", locId)
        .eq("kind", "pos")
        .single();
      if (error || !data)
        throw new Error(`Auto-Seed-Kanal fehlt (location ${locId}): ${error?.message}`);
      return data.id;
    };
    const mkTerm = async (locId: string, label: string) => {
      const { data, error } = await org.service
        .from("payment_terminals")
        .insert({ organization_id: org.orgId, location_id: locId, label })
        .select("id")
        .single();
      if (error || !data) throw new Error(`terminal seed ${label}: ${error?.message}`);
      return data.id;
    };
    channelA = await getPosChannel(org.defaultLocationId);
    channelB = await getPosChannel(locationB);
    terminalA = await mkTerm(org.defaultLocationId, "TermA");
    terminalB = await mkTerm(locationB, "TermB");

    const businessDate = expectData(
      await org.service.rpc("current_business_date"),
      "rpc current_business_date (ma2-cross-location setup)",
    );

    const { data: s, error: sErr } = await org.service
      .from("sessions")
      .insert({
        organization_id: org.orgId,
        location_id: org.defaultLocationId,
        business_date: businessDate,
        status: "open",
        guest_count: INITIAL_GUEST_COUNT,
      })
      .select("id")
      .single();
    if (sErr || !s) throw new Error(`session seed: ${sErr?.message}`);
    sessionA = s.id;

    // Bestand für Delete-Nichtläufer-Assertion.
    const { error: seedErr } = await org.service.from("session_channel_amounts").insert({
      organization_id: org.orgId,
      session_id: sessionA,
      channel_id: channelA,
      amount_cents: SEEDED_CHANNEL_AMOUNT,
    });
    if (seedErr) throw new Error(`channel amount seed: ${seedErr.message}`);
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it("wirft CrossLocationRefError bei fremder Kanal-Referenz UND lässt Session + Bestand unverändert", async () => {
    await expect(
      updateSessionCore(
        adminCaller(),
        baseUpdate({
          channelAmounts: [{ channelId: channelB, amountCents: 1234 }],
        }),
      ),
    ).rejects.toBeInstanceOf(CrossLocationRefError);

    // Session-Zeile unverändert (guest_count noch INITIAL_GUEST_COUNT).
    const sess = expectData(
      await org.service.from("sessions").select("guest_count").eq("id", sessionA).single(),
      "sessions select unchanged after channel-ref throw (ma2-cross-location)",
    );
    expect(sess.guest_count).toBe(INITIAL_GUEST_COUNT);

    // Bestehende session_channel_amounts-Zeilen unverändert (DELETE nicht gelaufen).
    const rows = expectData(
      await org.service
        .from("session_channel_amounts")
        .select("channel_id, amount_cents")
        .eq("session_id", sessionA),
      "session_channel_amounts select unchanged after channel-ref throw (ma2-cross-location)",
    );
    expect(rows).toEqual([{ channel_id: channelA, amount_cents: SEEDED_CHANNEL_AMOUNT }]);
  });

  it("wirft CrossLocationRefError bei fremder Terminal-Referenz UND lässt Session + Bestand unverändert", async () => {
    await expect(
      updateSessionCore(
        adminCaller(),
        baseUpdate({
          terminalAmounts: [{ terminalId: terminalB, amountCents: 5678 }],
        }),
      ),
    ).rejects.toBeInstanceOf(CrossLocationRefError);

    const sess = expectData(
      await org.service.from("sessions").select("guest_count").eq("id", sessionA).single(),
      "sessions select unchanged after terminal-ref throw (ma2-cross-location)",
    );
    expect(sess.guest_count).toBe(INITIAL_GUEST_COUNT);

    const rows = expectData(
      await org.service
        .from("session_channel_amounts")
        .select("channel_id, amount_cents")
        .eq("session_id", sessionA),
      "session_channel_amounts select unchanged after terminal-ref throw (ma2-cross-location)",
    );
    expect(rows).toEqual([{ channel_id: channelA, amount_cents: SEEDED_CHANNEL_AMOUNT }]);
  });

  it("Positivfall: gültige Referenzen am eigenen Standort → Update läuft durch", async () => {
    const NEW_GUEST_COUNT = 21;
    const NEW_CHANNEL_AMOUNT = 9999;
    const NEW_TERMINAL_AMOUNT = 7777;

    await expect(
      updateSessionCore(
        adminCaller(),
        baseUpdate({
          guestCount: NEW_GUEST_COUNT,
          channelAmounts: [{ channelId: channelA, amountCents: NEW_CHANNEL_AMOUNT }],
          terminalAmounts: [{ terminalId: terminalA, amountCents: NEW_TERMINAL_AMOUNT }],
        }),
      ),
    ).resolves.toBeDefined();

    const sess = expectData(
      await org.service.from("sessions").select("guest_count").eq("id", sessionA).single(),
      "sessions select after valid update (ma2-cross-location)",
    );
    expect(sess.guest_count).toBe(NEW_GUEST_COUNT);

    const chanRows = expectData(
      await org.service
        .from("session_channel_amounts")
        .select("channel_id, amount_cents")
        .eq("session_id", sessionA),
      "session_channel_amounts select after valid update (ma2-cross-location)",
    );
    expect(chanRows).toEqual([{ channel_id: channelA, amount_cents: NEW_CHANNEL_AMOUNT }]);

    const termRows = expectData(
      await org.service
        .from("session_terminal_amounts")
        .select("terminal_id, amount_cents")
        .eq("session_id", sessionA),
      "session_terminal_amounts select after valid update (ma2-cross-location)",
    );
    expect(termRows).toEqual([{ terminal_id: terminalA, amount_cents: NEW_TERMINAL_AMOUNT }]);
  });
});
