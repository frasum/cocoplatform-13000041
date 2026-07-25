// BM1 — Kernlogik des MailerSend-Inbound-Webhooks als testbare Funktion.
//
// Der HTTP-Adapter in `webhook.ts` reicht Raw-Body/URL-Token/Env nur durch;
// die Token-Prüfung, Zuordnungskette (K2), Default-Org (K3), Anhang-
// Filter (K4) und die optionale Weiterleitung (K5a) leben hier, damit
// `order-replies.db.test.ts` sie ohne echten HTTP-Roundtrip fahren kann.
//
// Auth: URL-Query `?token=<MAILERSEND_WEBHOOK_SECRET>` (Telegram-Muster).
// MailerSend-Inbound liefert keine HMAC-Signatur — die frühere Header-
// Annahme war falsch und ist restlos entfernt.

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractOrderNumberFromRecipients } from "@/lib/bestellung/inbound-plus";

// Präfix-agnostisch: ORD-…, EO-…, andere 2–4-Buchstaben-Präfixe. Die
// Formatwahrheit ist orders.order_number in der DB — der Regex ist nur
// eine Betreff-Sanity-Prüfung.
const ORDER_NUMBER_RE = /[A-Z]{2,4}-\d{4}-\d{2}-\d{4}/i;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type InboundAttachment = {
  file_name?: string;
  filename?: string;
  content_type?: string;
  contentType?: string;
  size?: number;
  content?: string;
};

export type InboundRecipient = string | { email?: string | null; name?: string | null } | null;

export type InboundData = {
  from?: { email?: string; name?: string } | string;
  sender?: string;
  to?: InboundRecipient | InboundRecipient[];
  recipients?: InboundRecipient[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
  attachments?: InboundAttachment[];
  id?: string;
  message_id?: string;
};

export type InboundPayload = { type?: string; data?: InboundData } & InboundData;

export type WebhookResult =
  | { status: 401; reason: "invalid-token" }
  | { status: 503; reason: "not-configured" }
  | { status: 200; body: Record<string, unknown> };

export function verifyToken(providedToken: string | null | undefined, secret: string): boolean {
  if (!providedToken) return false;
  const left = Buffer.from(providedToken);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function extractHeader(headers: InboundData["headers"] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if ((h?.name ?? "").toLowerCase() === lower) return h?.value ?? null;
    }
    return null;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return String(v);
  }
  return null;
}

function parseFrom(from: InboundData["from"], sender: string | undefined) {
  if (typeof from === "string") return { email: from, name: null as string | null };
  if (from && typeof from === "object")
    return { email: from.email ?? sender ?? "", name: from.name ?? null };
  return { email: sender ?? "", name: null };
}

function extractMessageIds(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(raw.matchAll(/<([^<>\s]+)>/g)).map((m) => m[1]);
}

function collectRecipients(inbound: InboundData): InboundRecipient[] {
  const out: InboundRecipient[] = [];
  if (Array.isArray(inbound.to)) out.push(...inbound.to);
  else if (inbound.to) out.push(inbound.to);
  if (Array.isArray(inbound.recipients)) out.push(...inbound.recipients);
  return out;
}

export type ForwardFn = (params: {
  fromName: string | null;
  fromEmail: string;
  subject: string;
  bodyText: string;
}) => Promise<void>;

export type ProcessInboundOptions = {
  rawBody: string;
  providedToken: string | null;
  secret: string | undefined;
  supabaseAdmin: SupabaseClient;
  defaultOrgId: string | undefined;
  forward?: ForwardFn;
};

export async function processInboundEmail(opts: ProcessInboundOptions): Promise<WebhookResult> {
  if (!opts.secret) return { status: 503, reason: "not-configured" };
  // Token-Auth: fehlender/falscher Token → 401, keine Verarbeitung.
  if (!verifyToken(opts.providedToken, opts.secret)) {
    return { status: 401, reason: "invalid-token" };
  }
  // Token korrekt + leerer Body → Probe/Validation-Ping, keine Verarbeitung.
  if (opts.rawBody.trim().length === 0) {
    return { status: 200, body: { ok: true, ignored: "empty-body" } };
  }

  let payload: InboundPayload;
  try {
    payload = JSON.parse(opts.rawBody) as InboundPayload;
  } catch {
    return { status: 200, body: { ok: true, ignored: "invalid-json" } };
  }

  const inbound: InboundData = payload.data ?? payload;
  const from = parseFrom(inbound.from, inbound.sender);
  const subject = (inbound.subject ?? "").trim();
  let bodyText = inbound.text ?? "";
  const messageId = inbound.message_id ?? inbound.id ?? null;
  const inReplyToRaw = extractHeader(inbound.headers, "In-Reply-To");
  const referencesRaw = extractHeader(inbound.headers, "References");
  const threadIds = [...extractMessageIds(inReplyToRaw), ...extractMessageIds(referencesRaw)];

  const supabaseAdmin = opts.supabaseAdmin;

  let orderId: string | null = null;
  let organizationId: string | null = null;

  const plusOrderNumber = extractOrderNumberFromRecipients(collectRecipients(inbound));
  if (plusOrderNumber) {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, organization_id")
      .eq("order_number", plusOrderNumber)
      .maybeSingle();
    if (order) {
      orderId = order.id as string;
      organizationId = order.organization_id as string;
    }
  }

  if (!orderId && threadIds.length > 0) {
    const { data: logRow } = await supabaseAdmin
      .from("order_email_log")
      .select("order_id, organization_id")
      .in("provider_message_id", threadIds)
      .limit(1)
      .maybeSingle();
    if (logRow) {
      orderId = logRow.order_id as string | null;
      organizationId = logRow.organization_id as string;
    }
  }

  if (!orderId) {
    const m = ORDER_NUMBER_RE.exec(subject);
    if (m) {
      const { data: order } = await supabaseAdmin
        .from("orders")
        .select("id, organization_id")
        .eq("order_number", m[0].toUpperCase())
        .maybeSingle();
      if (order) {
        orderId = order.id as string;
        organizationId = order.organization_id as string;
      }
    }
  }

  if (!organizationId) {
    const defaultOrg = opts.defaultOrgId?.trim();
    if (!defaultOrg) {
      console.warn(
        "[mailersend/webhook] Unzugeordnete Mail verworfen: INBOUND_DEFAULT_ORGANIZATION_ID fehlt.",
      );
      return { status: 200, body: { ok: true, ignored: "no-default-org" } };
    }
    organizationId = defaultOrg;
  }

  const rawAttachments = inbound.attachments ?? [];
  const attachmentsToStore: { name: string; type: string; bytes: Buffer }[] = [];
  const skipNotes: string[] = [];
  for (const att of rawAttachments) {
    const name = att.file_name ?? att.filename ?? "attachment";
    const type = (att.content_type ?? att.contentType ?? "").toLowerCase();
    if (!att.content) continue;
    if (!ALLOWED_MIME.has(type)) {
      skipNotes.push(`[Anhang übersprungen: ${name} (Typ ${type || "unbekannt"})]`);
      continue;
    }
    const bytes = Buffer.from(att.content, "base64");
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      skipNotes.push(`[Anhang übersprungen: ${name} (> 10 MB)]`);
      continue;
    }
    attachmentsToStore.push({ name, type, bytes });
  }
  if (skipNotes.length > 0) {
    bodyText = `${bodyText}${bodyText ? "\n\n" : ""}${skipNotes.join("\n")}`;
  }

  const { data: reply, error: insertErr } = await supabaseAdmin
    .from("order_replies")
    .upsert(
      {
        organization_id: organizationId,
        order_id: orderId,
        from_email: from.email || "unknown@invalid",
        from_name: from.name,
        subject: subject || null,
        body_text: bodyText || null,
        message_id: messageId,
      },
      { onConflict: "organization_id,message_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (insertErr || !reply) {
    return {
      status: 200,
      body: { ok: true, ignored: "insert-error", error: insertErr?.message },
    };
  }

  for (const att of attachmentsToStore) {
    const path = `${organizationId}/${reply.id}/${randomUUID()}-${att.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("order-reply-attachments")
      .upload(path, att.bytes, { contentType: att.type, upsert: false });
    if (upErr) continue;
    await supabaseAdmin.from("order_reply_attachments").insert({
      organization_id: organizationId,
      reply_id: reply.id as string,
      file_name: att.name,
      content_type: att.type,
      size_bytes: att.bytes.byteLength,
      storage_path: path,
    });
  }

  if (!orderId) {
    const { data: setting } = await supabaseAdmin
      .from("organization_settings")
      .select("order_reply_forward_unassigned")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (setting?.order_reply_forward_unassigned && opts.forward) {
      await opts.forward({
        fromName: from.name,
        fromEmail: from.email,
        subject,
        bodyText,
      });
    }
  }

  return {
    status: 200,
    body: { ok: true, reply_id: reply.id, assigned: Boolean(orderId) },
  };
}
