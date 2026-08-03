// P1/P2 — Client-seitiger Sentry-Init.
//
// Wird einmalig in __root beim Mount gestartet. DSN kommt aus der Server-
// Function `getSentryClientConfig` (SENTRY_DSN serverseitig). Ohne DSN
// passiert nichts. `@sentry/react` wird dynamisch nachgeladen, damit der
// Fall „kein Monitoring" das Bundle nicht mit Init-Code belastet.
//
// P2 — Zusätzlich zum reinen Init:
//  * globale Fenster-Handler für unbehandelte Fehler & Promise-Rejections,
//    damit H2-/Supabase-Ausnahmen aus Admin-Komponenten mit Stack + Kontext
//    sichtbar werden — nicht nur der Root-Error-Boundary-Sonderfall.
//  * Reporter für expect-ok/expectMaybe/expectVoid: jeder Supabase-Fehler
//    landet als Breadcrumb (Diagnose-Trail) plus Tag `supabase_context`.
//  * setSentryContext(...) — Org/Rolle/Route als Tags, User-ID (kein PII)
//    als `user.id`, damit Fehler-Cluster nach Mandant filterbar sind.

// SM1 — Release muss exakt dem Namen entsprechen, unter dem der
// @sentry/vite-plugin die Sourcemaps hochlädt (vite.config.ts: APP_VERSION),
// sonst matcht Sentry die Maps nicht und die Frames bleiben minifiziert.
import { APP_VERSION } from "@/lib/app-version";

let started = false;
let currentContext: SentryContextInput | null = null;

export type SentryContextInput = {
  userId?: string | null;
  staffId?: string | null;
  orgId?: string | null;
  role?: string | null;
  impersonating?: boolean;
};

export async function startSentryClient(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const { getSentryClientConfig } = await import("./sentry-config.functions");
    const config = await getSentryClientConfig();
    if (!config?.dsn) return;

    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: APP_VERSION,
      // Bewusst konservativ: keine Session-Replays, kein Performance-Sampling,
      // nur Errors. Kann später erhöht werden, wenn wir das brauchen.
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    Sentry.setTag("app", "coco");
    installGlobalHandlers();
    installSupabaseReporter();
    // Falls setSentryContext bereits vor dem Init lief (Race mit AuthProvider),
    // Kontext nachträglich anwenden.
    if (currentContext) applyContext(currentContext);
  } catch {
    // Monitoring darf nichts brechen.
    started = false;
  }
}

export async function captureClientError(
  err: unknown,
  tags?: Record<string, string>,
): Promise<void> {
  try {
    const Sentry = await import("@sentry/react");
    const client = Sentry.getClient?.();
    if (!client) return;
    Sentry.withScope((scope) => {
      if (tags) {
        for (const [k, v] of Object.entries(tags)) scope.setTag(k, v);
      }
      Sentry.captureException(err);
    });
  } catch {
    /* ignore */
  }
}

/**
 * Setzt Tags/User für die laufende Sentry-Session. Wird vom AuthProvider
 * aufgerufen, sobald Identität geladen ist (und beim Sign-out mit null-Werten,
 * um Kontext zu löschen).
 */
export function setSentryContext(ctx: SentryContextInput | null): void {
  currentContext = ctx;
  if (!started) return; // Init läuft — applyContext greift dann von selbst.
  void applyContext(ctx);
}

async function applyContext(ctx: SentryContextInput | null): Promise<void> {
  try {
    const Sentry = await import("@sentry/react");
    if (!Sentry.getClient?.()) return;
    if (!ctx) {
      Sentry.setUser(null);
      Sentry.setTag("org_id", undefined as unknown as string);
      Sentry.setTag("role", undefined as unknown as string);
      Sentry.setTag("impersonating", undefined as unknown as string);
      return;
    }
    // Nur user_id senden (keine E-Mail, kein Klarname) — Datensparsamkeit.
    Sentry.setUser(ctx.userId ? { id: ctx.userId } : null);
    if (ctx.orgId) Sentry.setTag("org_id", ctx.orgId);
    if (ctx.role) Sentry.setTag("role", ctx.role);
    if (ctx.staffId) Sentry.setTag("staff_id", ctx.staffId);
    if (ctx.impersonating) Sentry.setTag("impersonating", "true");
  } catch {
    /* ignore */
  }
}

/**
 * Hinterlässt einen Diagnose-Breadcrumb (z. B. Route-Wechsel im Admin,
 * Query-Kontext). Silent-Fail, no-op ohne aktive Sentry-Instanz.
 */
export async function addSentryBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const Sentry = await import("@sentry/react");
    if (!Sentry.getClient?.()) return;
    Sentry.addBreadcrumb({
      message,
      category,
      level: "info",
      data,
    });
  } catch {
    /* ignore */
  }
}

function installGlobalHandlers(): void {
  if (typeof window === "undefined") return;
  const flagKey = "__cocoSentryGlobalHandlers";
  const w = window as unknown as Record<string, unknown>;
  if (w[flagKey]) return;
  w[flagKey] = true;

  window.addEventListener("error", (event) => {
    const err = event.error ?? new Error(event.message || "window.onerror");
    void captureClientError(err, {
      mechanism: "window.onerror",
      source: event.filename ?? "",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const err =
      reason instanceof Error ? reason : new Error(String(reason ?? "unhandledrejection"));
    void captureClientError(err, { mechanism: "unhandledrejection" });
  });
}

function installSupabaseReporter(): void {
  // dyn. Import vermeidet Zyklus mit expect-ok in Server-Bundles.
  void import("@/lib/supabase/expect-ok").then(({ registerSupabaseErrorReporter }) => {
    registerSupabaseErrorReporter((context, error, kind) => {
      // Breadcrumb IMMER — zeigt den Pfad, der zum eigentlichen Throw führte.
      void addSentryBreadcrumb(`Supabase ${kind} failed: ${context}`, "supabase", {
        context,
        code: error.code ?? null,
        message: error.message,
        kind,
      });
      // Zusätzlich als eigenständiges Event, damit stille Fehler (die von
      // einem UI-Fallback abgefangen werden) nicht komplett verlorengehen.
      void captureClientError(new Error(`[${context}] Supabase: ${error.message}`), {
        mechanism: "supabase_expect_ok",
        supabase_context: context,
        supabase_code: error.code ?? "unknown",
        expect_kind: kind,
      });
    });
  });
}
