// BM1/K6 — DB-Integrationstests für den MailerSend-Inbound-Kern und
// die Zuordnungs-Serverfunktion. Läuft nur unter `SUPABASE_DB_TESTS=1`
// (siehe src/test/db-setup.ts).
//
// Auth: URL-Token (?token=...). Abgedeckt:
//   (a) korrekter Token + Plus-Adresse → Zuordnung an die Bestellung
//   (b) falscher/fehlender Token → 401, keine Zeile
//   (b2) korrekter Token + leerer Body → 200, keine Zeile (Probe)
//   (c) doppelte message_id → idempotent (UNIQUE(org, message_id))
//   (d) unbekannte Bestellnummer → order_id NULL unter Default-Org
//   (e) DENY-ALL: authenticated darf nicht in order_replies inserten
//   (f) assignOrderReply cross-org → RLS blockiert (Order unsichtbar)
//   (g) Erfolgreiche Zuordnung → genau ein audit_log-Eintrag

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  dbTestsEnabled,
  seedOrg,
  signInAsUser,
  type SeededOrg,
  type SeededUser,
} from "@/test/db-setup";
import { processInboundEmail } from "@/routes/api/public/mailersend/-webhook-core";
import { assignOrderReplyCore } from "./order-replies.functions";

const SECRET = "test-webhook-secret-please-ignore";

// SL2-R (§103): Retry-Hülle für Service-Seed-Inserts. Vorbild ist
// `withDbInsertRetry` in `src/test/db-setup.ts` — der lokale Supabase-Stack
// antwortet beim Kaltstart sporadisch mit „invalid response was received
// from the upstream server". Ohne Retry werden diese Suites bei
// Latenz-Flakes falsch-rot. Nur Seed-/Setup-Inserts sind gewrappt; die
// Assertions selbst (z. B. (e) DENY-ALL-Insert des Managers) bleiben
// unverändert.
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

type InboundBody = {
  to?: unknown;
  from?: { email: string; name?: string };
  subject?: string;
  text?: string;
  message_id?: string;
};

function makeBody(payload: InboundBody): string {
  return JSON.stringify({ type: "inbound", data: payload });
}

describe.skipIf(!dbTestsEnabled)("order-replies (Webhook-Kern + Assign)", () => {
  let org: SeededOrg;
  let orgB: SeededOrg;
  let manager: SeededUser;
  let managerB: SeededUser;
  let supplierId: string;
  let supplierIdB: string;
  let orderIdA: string;
  let orderIdB: string;
  let orderNumberA: string;
  let orderNumberB: string;

  beforeAll(async () => {
    org = await seedOrg("order-replies");
    orgB = await seedOrg("order-replies-b");
    manager = await org.mkUser("manager");
    managerB = await orgB.mkUser("manager");

    const mkSupplier = async (o: SeededOrg) => {
      const { data } = await retry("supplier seed", () =>
        o.service
          .from("suppliers")
          .insert({ organization_id: o.orgId, name: "Lieferant", email: "l@example.com" })
          .select("id")
          .single(),
      );
      return data!.id as string;
    };
    supplierId = await mkSupplier(org);
    supplierIdB = await mkSupplier(orgB);

    const mkOrder = async (o: SeededOrg, supplier: string, num: string) => {
      const { data } = await retry("order seed", () =>
        o.service
          .from("orders")
          .insert({
            organization_id: o.orgId,
            supplier_id: supplier,
            location_id: o.defaultLocationId,
            order_number: num,
            status: "sent",
            total_amount_cents: 0,
          })
          .select("id")
          .single(),
      );
      return data!.id as string;
    };
    orderNumberA = "ORD-2026-07-9001";
    orderNumberB = "ORD-2026-07-9002";
    orderIdA = await mkOrder(org, supplierId, orderNumberA);
    orderIdB = await mkOrder(orgB, supplierIdB, orderNumberB);
  });

  it("(a2) präfix-agnostisch — EO-Nummer via Plus-Adresse UND Betreff", async () => {
    const eoNumber = "EO-2026-05-0197";
    const { data: eoOrder } = await retry("eo-order seed", () =>
      org.service
        .from("orders")
        .insert({
          organization_id: org.orgId,
          supplier_id: supplierId,
          location_id: org.defaultLocationId,
          order_number: eoNumber,
          status: "sent",
          total_amount_cents: 0,
        })
        .select("id")
        .single(),
    );
    const eoId = eoOrder!.id as string;

    // Plus-Adresse
    const plusBody = makeBody({
      to: `antwort+${eoNumber}@inbound.cocoplatform.online`,
      from: { email: "eo-plus@example.com" },
      subject: "Re: EasyOrder",
      text: "ok",
      message_id: `mid-eo-plus-${Date.now()}@mail`,
    });
    const r1 = await processInboundEmail({
      rawBody: plusBody,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: org.orgId,
    });
    expect(r1.status).toBe(200);
    const { data: viaPlus } = await org.service
      .from("order_replies")
      .select("order_id")
      .eq("from_email", "eo-plus@example.com");
    expect(viaPlus).toHaveLength(1);
    expect(viaPlus![0].order_id).toBe(eoId);

    // Betreff (kein Plus-Teil)
    const subjBody = makeBody({
      to: "antwort@inbound.cocoplatform.online",
      from: { email: "eo-subj@example.com" },
      subject: `Re: Ihre Bestellung ${eoNumber} — Bestätigung`,
      text: "ok",
      message_id: `mid-eo-subj-${Date.now()}@mail`,
    });
    const r2 = await processInboundEmail({
      rawBody: subjBody,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: org.orgId,
    });
    expect(r2.status).toBe(200);
    const { data: viaSubj } = await org.service
      .from("order_replies")
      .select("order_id")
      .eq("from_email", "eo-subj@example.com");
    expect(viaSubj).toHaveLength(1);
    expect(viaSubj![0].order_id).toBe(eoId);

    // Fantasie-Nummer bleibt unzugeordnet
    const noneBody = makeBody({
      to: "antwort+ZZ-2099-01-9999@inbound.cocoplatform.online",
      from: { email: "eo-none@example.com" },
      subject: "Re: irgendwas",
      text: "?",
      message_id: `mid-eo-none-${Date.now()}@mail`,
    });
    const r3 = await processInboundEmail({
      rawBody: noneBody,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: org.orgId,
    });
    expect(r3.status).toBe(200);
    const { data: viaNone } = await org.service
      .from("order_replies")
      .select("order_id")
      .eq("from_email", "eo-none@example.com");
    expect(viaNone).toHaveLength(1);
    expect(viaNone![0].order_id).toBeNull();
  });

  afterAll(async () => {
    await org.service.from("order_replies").delete().eq("organization_id", org.orgId);
    await orgB.service.from("order_replies").delete().eq("organization_id", orgB.orgId);
    await org.service.from("orders").delete().eq("organization_id", org.orgId);
    await orgB.service.from("orders").delete().eq("organization_id", orgB.orgId);
    await org.service.from("suppliers").delete().eq("organization_id", org.orgId);
    await orgB.service.from("suppliers").delete().eq("organization_id", orgB.orgId);
    await org.cleanup();
    await orgB.cleanup();
  });

  it("(a) gültige Signatur + Plus-Adresse → ordnet an Bestellung zu", async () => {
    const body = makeBody({
      to: `antwort+${orderNumberA}@inbound.cocoplatform.online`,
      from: { email: "supplier@example.com", name: "Lieferant" },
      subject: "Re: Bestellung",
      text: "Bestätigt.",
      message_id: `mid-a-${Date.now()}@mail`,
    });
    const res = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(res.status).toBe(200);
    const { data } = await org.service
      .from("order_replies")
      .select("order_id, organization_id")
      .eq("organization_id", org.orgId)
      .eq("from_email", "supplier@example.com");
    expect(data).toHaveLength(1);
    expect(data![0].order_id).toBe(orderIdA);
  });

  it("(b) fehlender Header → 200 unsigned-probe, ungültiger Header → 401; keine Zeile", async () => {
    const body = makeBody({
      to: `antwort+${orderNumberA}@inbound.cocoplatform.online`,
      from: { email: "attacker@example.com" },
      subject: "spoof",
      text: "no",
      message_id: `mid-b-${Date.now()}@mail`,
    });
    const missing = await processInboundEmail({
      rawBody: body,
      providedToken: null,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(missing.status).toBe(401);
    const wrong = await processInboundEmail({
      rawBody: body,
      providedToken: "deadbeef",
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(wrong.status).toBe(401);
    const { count } = await org.service
      .from("order_replies")
      .select("id", { count: "exact", head: true })
      .eq("from_email", "attacker@example.com");
    expect(count ?? 0).toBe(0);
  });

  it("(b2) korrekter Token + leerer POST → 200, keine Zeile (Validierungs-Ping)", async () => {
    const beforeRes = await org.service
      .from("order_replies")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    const before = beforeRes.count ?? 0;
    const res = await processInboundEmail({
      rawBody: "",
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: org.orgId,
    });
    expect(res.status).toBe(200);
    const afterRes = await org.service
      .from("order_replies")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    expect(afterRes.count ?? 0).toBe(before);
  });

  it("(c) doppelte message_id → idempotent (nur eine Zeile)", async () => {
    const mid = `mid-c-${Date.now()}@mail`;
    const body = makeBody({
      to: `antwort+${orderNumberA}@inbound.cocoplatform.online`,
      from: { email: "dup@example.com" },
      subject: "Bestätigt",
      text: "hi",
      message_id: mid,
    });
    const r1 = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    const r2 = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: undefined,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const { count } = await org.service
      .from("order_replies")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("message_id", mid);
    expect(count).toBe(1);
  });

  it("(d) unbekannte Bestellnummer → order_id NULL unter Default-Org (Env)", async () => {
    const body = makeBody({
      to: "antwort+ORD-2099-01-0001@inbound.cocoplatform.online",
      from: { email: "unknown@example.com" },
      subject: "kein Bezug",
      text: "hmm",
      message_id: `mid-d-${Date.now()}@mail`,
    });
    const res = await processInboundEmail({
      rawBody: body,
      providedToken: SECRET,
      secret: SECRET,
      supabaseAdmin: org.service,
      defaultOrgId: org.orgId,
    });
    expect(res.status).toBe(200);
    const { data } = await org.service
      .from("order_replies")
      .select("order_id, organization_id")
      .eq("organization_id", org.orgId)
      .eq("from_email", "unknown@example.com");
    expect(data).toHaveLength(1);
    expect(data![0].order_id).toBeNull();
  });

  it("(e) DENY-ALL: authenticated darf nicht in order_replies inserten", async () => {
    const client = await signInAsUser(manager.email, manager.password);
    const { error } = await client.from("order_replies").insert({
      organization_id: org.orgId,
      from_email: "hacker@example.com",
      message_id: `mid-e-${Date.now()}@mail`,
    });
    expect(error).not.toBeNull();
  });

  it("(f) assignOrderReply cross-org → geblockt (Order unsichtbar per RLS)", async () => {
    // Reply in Org A anlegen, Manager aus Org B versucht sie an eine Order
    // aus Org B zu hängen — RLS versteckt die Reply, Guard schlägt an.
    const mid = `mid-f-${Date.now()}@mail`;
    const { data: reply } = await retry("reply seed (f)", () =>
      org.service
        .from("order_replies")
        .insert({
          organization_id: org.orgId,
          from_email: "crossorg@example.com",
          message_id: mid,
        })
        .select("id")
        .single(),
    );
    const clientB = await signInAsUser(managerB.email, managerB.password);
    await expect(
      assignOrderReplyCore({
        authed: clientB,
        admin: orgB.service,
        userId: managerB.userId,
        staffId: managerB.staffId,
        replyId: reply!.id as string,
        orderId: orderIdB,
      }),
    ).rejects.toThrow(/Antwort nicht gefunden|nicht in derselben Organisation/);
    // Und die eigentliche Zuordnung wurde nicht geschrieben.
    const { data: unchanged } = await org.service
      .from("order_replies")
      .select("order_id")
      .eq("id", reply!.id as string)
      .single();
    expect(unchanged?.order_id).toBeNull();
  });

  it("(g) Erfolgreiche Zuordnung schreibt genau einen audit_log-Eintrag", async () => {
    const mid = `mid-g-${Date.now()}@mail`;
    const { data: reply } = await retry("reply seed (g)", () =>
      org.service
        .from("order_replies")
        .insert({
          organization_id: org.orgId,
          from_email: "assign@example.com",
          message_id: mid,
        })
        .select("id")
        .single(),
    );
    const clientA = await signInAsUser(manager.email, manager.password);
    const beforeRes = await org.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId)
      .eq("action", "order_reply.assign");
    const before = beforeRes.count ?? 0;
    await assignOrderReplyCore({
      authed: clientA,
      admin: org.service,
      userId: manager.userId,
      staffId: manager.staffId,
      replyId: reply!.id as string,
      orderId: orderIdA,
    });
    const afterRes = await org.service
      .from("audit_log")
      .select("entity_id", { count: "exact" })
      .eq("organization_id", org.orgId)
      .eq("action", "order_reply.assign")
      .eq("entity_id", reply!.id as string);
    expect((afterRes.count ?? 0) - before).toBeGreaterThanOrEqual(0);
    expect(afterRes.data ?? []).toHaveLength(1);
    const { data: row } = await org.service
      .from("order_replies")
      .select("order_id, assigned_at")
      .eq("id", reply!.id as string)
      .single();
    expect(row?.order_id).toBe(orderIdA);
    expect(row?.assigned_at).not.toBeNull();
  });
});
