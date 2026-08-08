// P1 — Serverseitige Sentry-Anbindung ohne SDK-Dependency.
//
// Sendet Events per fetch an den Sentry-Envelope-Endpunkt der DSN. Bewusst
// dependency-frei, damit die Cloudflare-Worker-Runtime nicht mit Node-only
// Sub-Dependencies belastet wird. Ist SENTRY_DSN nicht gesetzt, ist die
// Funktion ein No-op. Wirft niemals — Monitoring darf den Kern nie brechen.
//
// Angebunden im Server-Function-Wrapper (runGuarded/runWithPermission),
// zusätzlich manuell aufrufbar in Sonderpfaden.

type DsnParts = {
  host: string;
  projectId: string;
  publicKey: string;
  protocol: string;
};

function parseDsn(dsn: string): DsnParts | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "").split("/").pop();
    if (!projectId || !url.username) return null;
    return {
      host: url.host,
      projectId,
      publicKey: url.username,
      protocol: url.protocol.replace(":", ""),
    };
  } catch {
    return null;
  }
}

export type ServerErrorContext = {
  /** Bezeichner der Server-Function bzw. des logischen Pfads (z. B. "cash.finalize"). */
  op?: string;
  /** organization_id, sofern bekannt. */
  orgId?: string | null;
  /**
   * staff_id des Aufrufers. Wird bewusst NICHT an Sentry gesendet
   * (Datensparsamkeit: Rolle + org_id reichen zur Diagnose). Feld bleibt im
   * Kontext-Typ für interne Aufrufer, wird aber im Event unterdrückt.
   */
  callerStaffId?: string | null;
  /** Rolle des Aufrufers. */
  role?: string | null;
  /** Freie Zusatz-Tags, die als Sentry-Tags landen (kurze Strings). */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Zusätzliche Kontextdaten (nur JSON-serialisierbar). */
  extra?: Record<string, unknown>;
  /** true = kritischer Geldpfad (Finalize/Lohn/Bestellung). */
  critical?: boolean;
};

function buildEvent(
  err: unknown,
  ctx: ServerErrorContext,
  requestUrl: string | null,
  level: "error" | "info" = "error",
) {
  const error = err instanceof Error ? err : new Error(String(err));
  const now = new Date().toISOString();
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";

  const tags: Record<string, string> = {};
  if (ctx.op) tags.op = ctx.op;
  if (ctx.orgId) tags.org_id = ctx.orgId;
  if (ctx.role) tags.role = ctx.role;
  if (ctx.critical) tags.critical = "true";
  if (requestUrl) {
    try {
      const u = new URL(requestUrl);
      tags.route = u.pathname;
    } catch {
      /* ignore */
    }
  }
  if (ctx.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) {
      if (v === undefined || v === null) continue;
      tags[k] = String(v);
    }
  }

  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: now,
    platform: "node" as const,
    level,
    server_name: "coco-worker",
    environment,
    tags,
    exception: {
      values: [
        {
          type: error.name || "Error",
          value: error.message || String(err),
          stacktrace: error.stack ? { frames: parseStack(error.stack) } : undefined,
        },
      ],
    },
    extra: {
      ...(ctx.extra ?? {}),
      ...(requestUrl ? { requestUrl } : {}),
    },
  };
}

function parseStack(stack: string) {
  return stack
    .split("\n")
    .slice(1)
    .map((line) => ({ filename: line.trim() }))
    .slice(0, 30)
    .reverse();
}

async function currentRequestUrl(): Promise<string | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "@tanstack/react-start/server")) as {
      getRequest?: () => Request | undefined;
    };
    const req = mod.getRequest?.();
    return req?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Sendet den Fehler an Sentry. No-op ohne SENTRY_DSN. Wirft NIE.
 */
export async function captureServerError(
  err: unknown,
  ctx: ServerErrorContext = {},
): Promise<void> {
  await sendEvent(err, ctx, "error");
}

/**
 * KA3 — Info-Meldung (level: "info"). Für auffindbare, aber NICHT alarmierende
 * Vorgänge: bestätigte Fremdabgaben u. Ä. No-op ohne SENTRY_DSN. Wirft NIE.
 */
export async function captureServerMessage(
  message: string,
  ctx: ServerErrorContext = {},
): Promise<void> {
  await sendEvent(new Error(message), ctx, "info");
}

async function sendEvent(
  err: unknown,
  ctx: ServerErrorContext,
  level: "error" | "info",
): Promise<void> {
  try {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;
    const parts = parseDsn(dsn);
    if (!parts) return;

    const requestUrl = await currentRequestUrl();
    const event = buildEvent(err, ctx, requestUrl, level);

    const envelopeHeader = JSON.stringify({
      event_id: event.event_id,
      sent_at: new Date().toISOString(),
      dsn,
    });
    const itemHeader = JSON.stringify({ type: "event" });
    const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`;

    const endpoint = `${parts.protocol}://${parts.host}/api/${parts.projectId}/envelope/?sentry_version=7&sentry_key=${parts.publicKey}&sentry_client=coco-worker/1.0`;

    // fire-and-forget, aber mit await, damit Cloudflare Workers den Request
    // nicht vor dem Absenden beendet. Kein Retry, kein Rauschen bei Fehlern.
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
    }).catch(() => {});
  } catch {
    /* Monitoring darf nichts brechen. */
  }
}
