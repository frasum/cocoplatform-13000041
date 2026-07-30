// IMP1 — Zentrale Vorschau-Identität (admin_impersonations).
//
// - resolveActiveImpersonation(): liest die aktive Impersonation des
//   AUFRUFENDEN Admin-Users. Wird sowohl von getMyIdentity (UI-Banner) als
//   auch von loadStaffCaller (effektive Portal-Identität) genutzt — genau
//   EINE Aktiv-Logik, keine Duplikate.
//   IMP2: Beim Lesen wird die Ablaufzeit (IMPERSONATION_MAX_MINUTES)
//   geprüft. Ist die offene Sitzung überschritten, wird sie serverseitig
//   beendet (ended_at + Audit `admin.impersonation_stopped` mit
//   `reason: "expired"` — dasselbe Ende wie beim manuellen Stop) und die
//   Funktion liefert null zurück, sodass der Aufrufer wieder als er selbst
//   weiterläuft.
// - assertRealIdentity(): wirft, wenn der Caller eine Vorschau ist. Wird
//   als ERSTE Zeile in JEDER mutierenden Staff-Caller-Function aufgerufen
//   (Vorschau ist schreibgeschützt). Die Verweigerung schreibt KEINEN
//   audit_log-Eintrag (B2a-Muster).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { writeAuditLog } from "./audit";
import { isImpersonationExpired } from "./impersonation-expiry";
import { expectMaybe, expectVoid } from "@/lib/supabase/expect-ok";
import { ForbiddenError } from "./role-guard";

export type ActiveImpersonation = {
  targetStaffId: string;
  startedAt: string;
};

export async function resolveActiveImpersonation(
  supabase: SupabaseClient<Database>,
  adminUserId: string,
): Promise<ActiveImpersonation | null> {
  const data = expectMaybe<{
    id: string;
    organization_id: string;
    target_staff_id: string;
    started_at: string;
  }>(
    await supabase
      .from("admin_impersonations")
      .select("id, organization_id, target_staff_id, started_at")
      .eq("admin_user_id", adminUserId)
      .is("ended_at", null)
      .maybeSingle(),
    "resolveActiveImpersonation.load",
  );
  if (!data) return null;
  const startedAt = data.started_at as string;
  if (isImpersonationExpired(startedAt, new Date().toISOString())) {
    // Auto-Ablauf: dieselbe Beendigung wie manuell (stopImpersonation),
    // damit das offene Row entfernt und die Sitzung geaudited wird.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const impId = data.id as string;
    const orgId = data.organization_id as string;
    const targetStaffId = data.target_staff_id as string;
    let updOk = true;
    try {
      expectVoid(
        await supabaseAdmin
          .from("admin_impersonations")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", impId)
          .is("ended_at", null),
        "resolveActiveImpersonation.autoEnd",
      );
    } catch {
      updOk = false;
    }
    if (updOk) {
      await writeAuditLog({
        organizationId: orgId,
        actorUserId: adminUserId,
        actorStaffId: null,
        action: "admin.impersonation_stopped",
        entity: "staff",
        entityId: targetStaffId,
        meta: { impersonation_id: impId, reason: "expired", started_at: startedAt },
      });
    }
    return null;
  }
  return {
    targetStaffId: data.target_staff_id as string,
    startedAt,
  };
}

export const PREVIEW_READ_ONLY_MESSAGE =
  "Die Vorschau ist schreibgeschützt — Aktion nicht möglich.";

// IM1a — Vorschau-Abbruch ist ein Berechtigungsfall: die Klasse erbt von
// ForbiddenError, damit UI (403-Behandlung) und Monitoring
// (isMonitoringSuppressed) sie ohne Sonderregel wie vorgesehen behandeln.
// Eigener `name` bleibt für Diagnose/Logs erhalten. Message unverändert.
export class PreviewReadOnlyError extends ForbiddenError {
  constructor(message: string = PREVIEW_READ_ONLY_MESSAGE) {
    super(message);
    this.name = "PreviewReadOnlyError";
  }
}

export function assertRealIdentity(caller: { impersonatedBy?: string | null }): void {
  if (caller.impersonatedBy) {
    throw new PreviewReadOnlyError();
  }
}
