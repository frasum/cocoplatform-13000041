// Produktions-Config-Check: meldet nur *Präsenz* und Format-Hinweise von
// server-seitigen Umgebungsvariablen (Werte werden NIE zurückgegeben).
// Admin-only via loadAdminCaller. Wird von /admin/config-check gerendert.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { collectConfigStatus, type ConfigVarStatus } from "./config-check.server";

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

// Sentry-Diagnose: löst bewusst einen Fehler in einer Server-Fn aus,
// damit Admins den Server-Reporting-Pfad (inkl. Source-Maps, Tags) live
// verifizieren können. Admin-only. Der Fehler wird explizit an Sentry
// gemeldet und dann weitergeworfen, damit der Client die Rückmeldung
// „Fehler ausgelöst" bekommt.
export const triggerSentryTestErrorServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<never> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const marker = new Date().toISOString();
    const err = new Error(`Sentry-Testfehler (Server) — ausgelöst ${marker}`);
    try {
      const { captureServerError } = await import(
        /* @vite-ignore */ "@/lib/monitoring/sentry.server"
      );
      await captureServerError(err, {
        op: "admin.sentry.test",
        orgId: caller.orgId ?? null,
        callerStaffId: caller.staffId ?? null,
        role: caller.role,
        critical: false,
        tags: { test: "true" },
      });
    } catch {
      /* Monitoring darf nichts brechen. */
    }
    throw err;
  });
