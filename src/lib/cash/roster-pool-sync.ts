// RS1 — Roster-Pool-Snapshot: einmalige Anwendung bei Session-Eröffnung
// + additiver Nach-Sync bei Dienstplan-Änderungen NACH der Eröffnung.
//
// Idempotenz: `unique(session_id, staff_id)` mit
// `onConflict: 'session_id,staff_id'` + `ignoreDuplicates:true`. Ein
// erneuter Aufruf ist rein ADDITIV — bestehende Pool-Einträge (Zeiten,
// Trinkgeld, shift_end) bleiben unverändert. Wird jemand aus dem Plan
// genommen, bleibt sein Pool-Eintrag bewusst bestehen (kann bereits
// Daten tragen) — Sichtbarkeit über täglichen Vollständigkeits-Check
// (docs/t0-laufkarte.md) bzw. manuelles Entfernen in der Kassen-UI.
//
// Der Nach-Sync ist Best-effort: Fehler blocken den Roster-Save NICHT,
// werden aber Sentry-sichtbar mitgeschrieben (§106 PZ1-Standard).

import { buildRosterPoolSnapshot } from "./roster-pool-snapshot";
import { resolvePoolDefaults, type DepartmentDefaultRow } from "./pool-defaults";
import type { StaffDepartment } from "@/lib/staff-domain";

export async function applyRosterPoolSnapshot(input: {
  organizationId: string;
  sessionId: string;
  locationId: string;
  businessDate: string;
}): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [shiftsRes, defaultsRes] = await Promise.all([
    supabaseAdmin
      .from("roster_shifts")
      .select("staff_id, area")
      .eq("organization_id", input.organizationId)
      .eq("location_id", input.locationId)
      .eq("shift_date", input.businessDate)
      .in("status", ["planned", "confirmed"]),
    supabaseAdmin
      .from("location_department_defaults")
      .select(
        "department, default_checkin, default_checkout, default_checkin_sunday_holiday, default_checkout_sunday_holiday",
      )
      .eq("location_id", input.locationId),
  ]);
  if (shiftsRes.error) throw shiftsRes.error;
  if (defaultsRes.error) throw defaultsRes.error;

  const defaultsByArea: Record<string, { checkin: string | null; checkout: string | null }> = {};
  for (const d of defaultsRes.data ?? []) {
    const row: DepartmentDefaultRow = {
      default_checkin: (d.default_checkin as string | null) ?? null,
      default_checkout: (d.default_checkout as string | null) ?? null,
      default_checkin_sunday_holiday:
        (d.default_checkin_sunday_holiday as string | null) ?? null,
      default_checkout_sunday_holiday:
        (d.default_checkout_sunday_holiday as string | null) ?? null,
    };
    defaultsByArea[d.department as string] = resolvePoolDefaults(row, input.businessDate);
  }
  const snapshot = buildRosterPoolSnapshot({
    rosterShifts: (shiftsRes.data ?? []).map((r) => ({
      staffId: r.staff_id as string,
      area: r.area as StaffDepartment,
    })),
    defaultsByArea,
  });
  if (snapshot.length === 0) return 0;

  const rows = snapshot.map((e) => ({
    organization_id: input.organizationId,
    session_id: input.sessionId,
    staff_id: e.staffId,
    department: e.department,
    hours_minutes: e.hoursMinutes,
    shift_start: e.shiftStart,
    shift_end: e.shiftEnd,
  }));
  const { error, count } = await supabaseAdmin
    .from("session_tip_pool_entries")
    .upsert(rows, { onConflict: "session_id,staff_id", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;
  return count ?? 0;
}

// Nach-Sync für Dienstplan-Schreibpfade. Für jede (location, businessDate)
// wird geprüft, ob eine OFFENE Session existiert; falls ja, wird
// applyRosterPoolSnapshot erneut aufgerufen (idempotent, additiv). Fehler
// werden gefangen und an Sentry gemeldet, damit ein defekter Nach-Sync
// NIE einen Dienstplan-Save blockiert.
export async function syncOpenSessionsPoolAfterRosterWrite(input: {
  organizationId: string;
  targets: Array<{ locationId: string; businessDate: string }>;
  op: string;
}): Promise<void> {
  if (input.targets.length === 0) return;
  // Deduplizieren (locationId × businessDate).
  const uniq = new Map<string, { locationId: string; businessDate: string }>();
  for (const t of input.targets) {
    uniq.set(`${t.locationId}|${t.businessDate}`, t);
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const t of uniq.values()) {
      try {
        const { data: sess, error: sErr } = await supabaseAdmin
          .from("sessions")
          .select("id")
          .eq("organization_id", input.organizationId)
          .eq("location_id", t.locationId)
          .eq("business_date", t.businessDate)
          .eq("status", "open")
          .maybeSingle();
        if (sErr) throw sErr;
        if (!sess) continue;
        const added = await applyRosterPoolSnapshot({
          organizationId: input.organizationId,
          sessionId: sess.id as string,
          locationId: t.locationId,
          businessDate: t.businessDate,
        });
        if (added > 0) {
          void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
            m.captureServerError(new Error("rosterPoolSync: added entries"), {
              op: input.op,
              orgId: input.organizationId,
              extra: {
                sessionId: sess.id,
                locationId: t.locationId,
                businessDate: t.businessDate,
                addedCount: added,
                reason: "post_write_sync",
              },
            }),
          );
        }
      } catch (err) {
        void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
          m.captureServerError(err, {
            op: input.op,
            orgId: input.organizationId,
            extra: {
              locationId: t.locationId,
              businessDate: t.businessDate,
              reason: "post_write_sync_failed",
            },
          }),
        );
      }
    }
  } catch (err) {
    void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
      m.captureServerError(err, {
        op: input.op,
        orgId: input.organizationId,
        extra: { reason: "post_write_sync_bootstrap_failed" },
      }),
    );
  }
}
