// BM1/OR-Loc — DB-Integrationstest: Inbound-Mails werden anhand
// orders.order_number korrekt an die Bestellung UND damit an deren
// Standort verknüpft. Sichert zu, dass zwei Bestellungen desselben
// Lieferanten an unterschiedlichen Standorten nicht verwechselt werden
// und dass die Reply am Order (und damit an dessen location_id) hängt.
//
// Läuft nur unter `SUPABASE_DB_TESTS=1` (siehe src/test/db-setup.ts).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbTestsEnabled, seedOrg, type SeededOrg } from "@/test/db-setup";
import { processInboundEmail } from "@/routes/api/public/mailersend/-webhook-core";

const SECRET = "test-webhook-secret-per-location";

// SL2-R (§103): Retry-Hülle für Service-Seed-Inserts (siehe
// `withDbInsertRetry` in `src/test/db-setup.ts`). Der lokale
// Supabase-Stack liefert beim Kaltstart sporadisch „invalid response was
// received from the upstream server"; ohne Retry werden diese
// Seed-Aufrufe bei Latenz-Flakes falsch-rot. Nur beforeAll-Setup ist
// gewrappt — keine Assertion-Änderungen.
const UPSTREAM_BOOT_ERROR = "invalid response was received from the upstream server";
async function retry<TResult extends { error: { message: string } | null }>(
  label: string,
  operation: () => PromiseLike<TResult>,
): Promise<TResult> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await operation();
    const msg = result.error?.message.toLowerCase() ?? "";
    if (!msg.includes(UPSTREAM_BOOT_ERROR) || attempt === 3) return result;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} retry loop exhausted unexpectedly`);
}

function makeBody(payload: {
  to?: unknown;
  from?: { email: string; name?: string };
  subject?: string;
  text?: string;
  message_id?: string;
}): string {
  return JSON.stringify({ type: "inbound", data: payload });
}

describe.skipIf(!dbTestsEnabled)("order-replies pro Standort (Order-Nummer → Location)", () => {
  let org: SeededOrg;
  let supplierId: string;
  let locSpiceId: string;
  let locYumId: string;
  let orderSpiceId: string;
  let orderYumId: string;
  const orderNumberSpice = "ORD-2026-07-7101";
  const orderNumberYum = "ORD-2026-07-7102";

  beforeAll(async () => {
    org = await seedOrg("order-replies-per-loc");
    locSpiceId = await org.mkLocation("Spice Ry");
    locYumId = await org.mkLocation("Yum");

    const { data: sup } = await retry("supplier seed", () =>
      org.service
        .from("suppliers")
        .insert({
          organization_id: org.orgId,
          name: "Multi-Loc-Lieferant",
          email: "ml@example.com",
        })
        .select("id")
        .single(),
    );
    supplierId = sup!.id as string;

    const mkOrder = async (locId: string, num: string) => {
      const { data } = await retry("order seed", () =>
        org.service
          .from("orders")
          .insert({
            organization_id: org.orgId,
            supplier_id: supplierId,
            location_id: locId,
            order_number: num,
            status: "sent",
            total_amount_cents: 0,
          })
          .select("id")
          .single(),
      );
      return data!.id as string;
    };
    orderSpiceId = await mkOrder(locSpiceId, orderNumberSpice);
    orderYumId = await mkOrder(locYumId, orderNumberYum);
  });

  afterAll(async () => {
    await org.service.from("order_replies").delete().eq("organization_id", org.orgId);
    await org.service.from("orders").delete().eq("organization_id", org.orgId);
    await org.service.from("suppliers").delete().eq("organization_id", org.orgId);
    await org.cleanup();
  });

  it("Plus-Adresse: Spice-Ry-Bestellnummer → Reply hängt an Spice-Ry-Order (und dessen Standort)", async () => {
    const body = makeBody({
      to: `antwort+${orderNumberSpice}@inbound.cocoplatform.online`,
      from: { email: "reply-spice@example.com", name: "Lieferant" },
      subject: "Re: Bestellung",
      text: "Bestätigt.",
      message_id: `mid-loc-spice-${Date.now()}@mail`,
    });
    const res = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(res.status).toBe(200);

    const { data: replies } = await org.service
      .from("order_replies")
      .select("id, order_id, organization_id")
      .eq("from_email", "reply-spice@example.com");
    expect(replies).toHaveLength(1);
    expect(replies![0].order_id).toBe(orderSpiceId);
    expect(replies![0].organization_id).toBe(org.orgId);

    // Reply hängt am Order — und dessen location_id ist Spice Ry, nicht Yum.
    const { data: order } = await org.service
      .from("orders")
      .select("location_id")
      .eq("id", replies![0].order_id!)
      .single();
    expect(order?.location_id).toBe(locSpiceId);
    expect(order?.location_id).not.toBe(locYumId);
  });

  it("Betreff-Match: Yum-Bestellnummer im Subject → Reply hängt an Yum-Order (und dessen Standort)", async () => {
    const body = makeBody({
      to: "antwort@inbound.cocoplatform.online",
      from: { email: "reply-yum@example.com" },
      subject: `AW: Bestellung ${orderNumberYum} bestätigt`,
      text: "ok",
      message_id: `mid-loc-yum-${Date.now()}@mail`,
    });
    const res = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(res.status).toBe(200);

    const { data: replies } = await org.service
      .from("order_replies")
      .select("id, order_id")
      .eq("from_email", "reply-yum@example.com");
    expect(replies).toHaveLength(1);
    expect(replies![0].order_id).toBe(orderYumId);

    const { data: order } = await org.service
      .from("orders")
      .select("location_id")
      .eq("id", replies![0].order_id!)
      .single();
    expect(order?.location_id).toBe(locYumId);
    expect(order?.location_id).not.toBe(locSpiceId);
  });

  it("Zwei Inbounds parallel: jede Bestellnummer landet ausschließlich am eigenen Standort", async () => {
    const ts = Date.now();
    const spiceBody = makeBody({
      to: `antwort+${orderNumberSpice}@inbound.cocoplatform.online`,
      from: { email: `both-spice-${ts}@example.com` },
      subject: "Re: Bestellung",
      text: "spice",
      message_id: `mid-both-spice-${ts}@mail`,
    });
    const yumBody = makeBody({
      to: `antwort+${orderNumberYum}@inbound.cocoplatform.online`,
      from: { email: `both-yum-${ts}@example.com` },
      subject: "Re: Bestellung",
      text: "yum",
      message_id: `mid-both-yum-${ts}@mail`,
    });

    const [r1, r2] = await Promise.all([
      processInboundEmail({
        rawBody: spiceBody,
        providedToken: SECRET,
        secret: SECRET,
        supabaseAdmin: org.service,
        defaultOrgId: undefined,
      }),
      processInboundEmail({
        rawBody: yumBody,
        providedToken: SECRET,
        secret: SECRET,
        supabaseAdmin: org.service,
        defaultOrgId: undefined,
      }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const { data: rows } = await org.service
      .from("order_replies")
      .select("from_email, order_id, orders:order_id(location_id)")
      .in("from_email", [`both-spice-${ts}@example.com`, `both-yum-${ts}@example.com`]);
    expect(rows).toHaveLength(2);
    const spice = rows!.find((r) => r.from_email === `both-spice-${ts}@example.com`);
    const yum = rows!.find((r) => r.from_email === `both-yum-${ts}@example.com`);
    expect(spice?.order_id).toBe(orderSpiceId);
    expect(yum?.order_id).toBe(orderYumId);
    // Kreuz-Kontamination ausgeschlossen: Standort-IDs stammen jeweils vom eigenen Order.
    const spiceLoc = (spice?.orders as { location_id: string } | null)?.location_id;
    const yumLoc = (yum?.orders as { location_id: string } | null)?.location_id;
    expect(spiceLoc).toBe(locSpiceId);
    expect(yumLoc).toBe(locYumId);
    expect(spiceLoc).not.toBe(yumLoc);
  });
});
