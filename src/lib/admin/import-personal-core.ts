// I/O-Kern für `importStaffPersonalData`. Liest identity_map und staff,
// berechnet den Diff via reinem `computePersonalPlan` und schreibt im
// Commit-Pfad. Lohnsätze sind seit ST1-C1 nicht mehr Teil des Imports.
// Schreibt selbst KEIN audit_log — das übernimmt der Server-Fn-Handler
// über `runGuarded`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { expectOk, expectVoid } from "@/lib/supabase/expect-ok";
import {
  computePersonalPlan,
  type CurrentStaffRow,
  type PersonalPlan,
  type PersonalRowInput,
} from "./import-personal";

export type ImportPersonalCoreInput = {
  admin: SupabaseClient<Database>;
  organizationId: string;
  sourceSystem: "tagesabrechnung";
  rows: PersonalRowInput[];
  mode: "dry_run" | "commit";
};

export type ImportPersonalCoreResult = {
  mode: "dry_run" | "commit";
  plan: PersonalPlan;
};

export async function runImportPersonalCore(
  input: ImportPersonalCoreInput,
): Promise<ImportPersonalCoreResult> {
  const { admin, organizationId } = input;

  // 1) identity_map: altStaffId → staffId
  const mapRows = expectOk<
    { alt_id: string; staff_id: string | null; confirmed_at: string | null }[]
  >(
    await admin
      .from("staff_identity_map")
      .select("alt_id, staff_id, confirmed_at")
      .eq("organization_id", organizationId)
      .eq("source_system", input.sourceSystem),
    "runImportPersonalCore.identityMap",
  );
  const staffMap = new Map<string, string>();
  for (const r of mapRows ?? []) {
    if (!r.confirmed_at || !r.staff_id) continue;
    staffMap.set(r.alt_id, r.staff_id);
  }

  // 2) Aktueller Staff-Bestand (nur betroffene IDs)
  const targetStaffIds = Array.from(
    new Set(input.rows.map((r) => staffMap.get(r.altStaffId)).filter((v): v is string => !!v)),
  );

  const currentStaff = new Map<string, CurrentStaffRow>();

  if (targetStaffIds.length > 0) {
    const staffRows = expectOk<
      {
        id: string;
        first_name: string;
        last_name: string;
        display_name: string;
        perso_nr: number | null;
      }[]
    >(
      await admin
        .from("staff")
        .select("id, first_name, last_name, display_name, perso_nr")
        .eq("organization_id", organizationId)
        .in("id", targetStaffIds),
      "runImportPersonalCore.staff",
    );
    for (const r of staffRows ?? []) {
      currentStaff.set(r.id, {
        staffId: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        displayName: r.display_name,
        persoNr: (r as { perso_nr: number | null }).perso_nr ?? null,
      });
    }
  }

  const plan = computePersonalPlan({
    rows: input.rows,
    staffMap,
    currentStaff,
  });

  if (input.mode === "dry_run") {
    return { mode: "dry_run", plan };
  }

  // --- Commit: staff-Updates ---
  for (const u of plan.staffUpdates) {
    expectVoid(
      await admin
        .from("staff")
        .update(u.fields)
        .eq("organization_id", organizationId)
        .eq("id", u.staffId),
      "runImportPersonalCore.staff.update",
    );
  }

  return { mode: "commit", plan };
}
