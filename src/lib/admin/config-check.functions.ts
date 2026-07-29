// Produktions-Config-Check: meldet nur *Präsenz* und Format-Hinweise von
// server-seitigen Umgebungsvariablen (Werte werden NIE zurückgegeben).
// Admin-only via loadAdminCaller. Wird von /admin/config-check gerendert.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { collectConfigStatus, type ConfigVarStatus } from "./config-check.server";
import { runGuarded } from "./admin-call";
import { SentryTestError, SENTRY_PROBE_TAG } from "@/lib/monitoring/sentry-selftest";

export type { ConfigVarStatus } from "./config-check.server";

export type ConfigCheckResult = {
  checkedAt: string;
  vars: ConfigVarStatus[];
  summary: {
    total: number;
    present: number;
    missing: number;
    missingCritical: string[];
  };
};

export const getProductionConfigStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConfigCheckResult> => {
    await loadAdminCaller(context.supabase, context.userId, "admin");

    const vars = collectConfigStatus();
    const missing = vars.filter((v) => !v.present);
    return {
      checkedAt: new Date().toISOString(),
      vars,
      summary: {
        total: vars.length,
        present: vars.length - missing.length,
        missing: missing.length,
        missingCritical: missing.filter((v) => v.critical).map((v) => v.name),
      },
    };
  });

// SE1 — Sentry-Server-Probe: läuft bewusst DURCH runGuarded, nicht per
// Direktaufruf von captureServerError. Nur so sind Rollen-Gate,
// Ausnahme-Filter (isMonitoringSuppressed) und Envelope-POST gemeinsam
// bewiesen. Der Fehler wird nach runGuarded gefangen und in eine
// Erfolgsantwort umgewandelt — der Bauherr soll eine grüne Meldung sehen,
// nicht den Vite-Dev-Overlay. Weil `op` wirft, schreibt runGuarded KEINEN
// audit_log-Eintrag (Bauherren-Entscheid Variante a).
export const triggerSentryServerProbe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; triggeredAt: string }> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const triggeredAt = new Date().toISOString();
    const noopAudit = async () => {
      /* Variante a: kein audit_log-Eintrag für die Probe. */
    };
    try {
      await runGuarded(
        caller.role,
        "admin",
        noopAudit,
        async () => {
          throw new SentryTestError("server", triggeredAt);
        },
        {
          op: "monitoring.selftest",
          orgId: caller.organizationId ?? null,
          callerStaffId: caller.staffId ?? null,
          critical: false,
          tags: { probe: SENTRY_PROBE_TAG },
        },
      );
    } catch (err) {
      if (!(err instanceof SentryTestError)) throw err;
    }
    return { ok: true, triggeredAt };
  });
