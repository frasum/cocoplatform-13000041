// BM1 — MailerSend Inbound-Webhook.
//
// Der HTTP-Adapter ist bewusst dünn: er reicht Raw-Body/Signature/Env an
// `processInboundEmail` (siehe -webhook-core.ts) durch, damit die Kernlogik
// unter DB-Integrationstest steht. Erfolgs-/Ignore-Antworten sind 200,
// damit MailerSend keine Retry-Kaskade auslöst.

import { createFileRoute } from "@tanstack/react-router";
import { processInboundEmail } from "./-webhook-core";

const FORWARD_TO_EMAIL = "buchhaltung@yum-thai.de";

async function forwardUnassigned(params: {
  fromName: string | null;
  fromEmail: string;
  subject: string;
  bodyText: string;
}): Promise<void> {
  const apiKey = process.env.MAILERSEND_API_KEY;
  const senderEmail = process.env.MAILERSEND_FROM_EMAIL;
  const senderName = process.env.MAILERSEND_FROM_NAME ?? "COCO Bestellung";
  if (!apiKey || !senderEmail) return;
  const body = {
    from: { email: senderEmail, name: senderName },
    to: [{ email: FORWARD_TO_EMAIL, name: "Buchhaltung" }],
    subject: `[COCO unzugeordnet] ${params.subject || "(ohne Betreff)"}`,
    text: [
      `Absender: ${params.fromName ? `${params.fromName} <${params.fromEmail}>` : params.fromEmail}`,
      `Betreff: ${params.subject || "(leer)"}`,
      "",
      params.bodyText || "(kein Textkörper)",
    ].join("\n"),
  };
  await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  }).catch(() => {
    /* best-effort */
  });
}

export const Route = createFileRoute("/api/public/mailersend/webhook")({
  server: {
    handlers: {
      GET: async () => Response.json({ status: "ok" }),
      HEAD: async () => new Response(null, { status: 200 }),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const providedToken = new URL(request.url).searchParams.get("token");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await processInboundEmail({
          rawBody,
          providedToken,
          secret: process.env.MAILERSEND_WEBHOOK_SECRET,
          supabaseAdmin,
          defaultOrgId: process.env.INBOUND_DEFAULT_ORGANIZATION_ID,
          forward: forwardUnassigned,
        });
        if (result.status === 401) return new Response("Invalid token", { status: 401 });
        if (result.status === 503)
          return new Response("Webhook nicht konfiguriert", { status: 503 });
        return Response.json(result.body);
      },
    },
  },
});
