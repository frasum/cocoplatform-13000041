// DB-Integrationstest für `importStaffPersonalData` (Welle 1).
// Aktiv nur bei SUPABASE_DB_TESTS=1. Ruft das Core-Modul direkt mit dem
// service_role-Client auf. Lohnsätze sind seit ST1-C1 nicht mehr Teil des
// Imports; das Server-Fn-Guard-Verhalten ist über
// runGuarded/loadAdminCaller-Tests gedeckt.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbTestsEnabled, seedOrg, type SeededOrg } from "@/test/db-setup";
import { runImportPersonalCore } from "./import-personal-core";
import type { PersonalRowInput } from "./import-personal";

async function mkStaff(
  org: SeededOrg,
  firstName: string,
  lastName: string,
  displayName: string,
): Promise<string> {
  const { data, error } = await org.service
    .from("staff")
    .insert({
      organization_id: org.orgId,
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`staff insert: ${error?.message}`);
  return data.id;
}

async function addMapping(
  org: SeededOrg,
  altId: string,
  altName: string,
  staffId: string,
): Promise<void> {
  const { error } = await org.service.from("staff_identity_map").insert({
    organization_id: org.orgId,
    source_system: "tagesabrechnung",
    alt_id: altId,
    alt_name: altName,
    staff_id: staffId,
    confirmed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

describe.skipIf(!dbTestsEnabled)("importStaffPersonalData — DB (Welle 1)", () => {
  let org: SeededOrg;

  beforeAll(async () => {
    org = await seedOrg("importP");
  });

  afterAll(async () => {
    await org.service.from("staff_identity_map").delete().eq("organization_id", org.orgId);
    await org.cleanup();
  });

  it("(f) Namen-Update inkl. Klammer-Spitzname landet 1:1 in staff", async () => {
    const s = await mkStaff(org, "Andi", "Sukphasathit", "ANDI");
    await addMapping(org, "alt-andi", "ANDI", s);

    const rows: PersonalRowInput[] = [
      {
        altStaffId: "alt-andi",
        firstName: "Phattanaphol (ANDI)",
        lastName: "Sukphasathit",
        nickname: "ANDI",
        persoNr: 42,
        employmentStart: "2024-01-15",
      },
    ];
    const r = await runImportPersonalCore({
      admin: org.service,
      organizationId: org.orgId,
      sourceSystem: "tagesabrechnung",
      rows,
      mode: "commit",
    });
    expect(r.plan.totals.nameUpdates).toBe(1);

    const { data } = await org.service
      .from("staff")
      .select("first_name, last_name, perso_nr")
      .eq("id", s)
      .single();
    expect(data?.first_name).toBe("Phattanaphol (ANDI)");
    expect((data as { perso_nr: number | null } | null)?.perso_nr).toBe(42);
  });

  it("(i) Geist (kein identity_map-Treffer) → skipped, staff unverändert", async () => {
    const before = await org.service
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);

    const r = await runImportPersonalCore({
      admin: org.service,
      organizationId: org.orgId,
      sourceSystem: "tagesabrechnung",
      rows: [
        {
          altStaffId: "6756a58e-ghost-ghost-ghost-ghostghostgh",
          firstName: "Ghost",
          lastName: "Ghost",
          nickname: "",
          persoNr: null,
          employmentStart: null,
        },
      ],
      mode: "commit",
    });
    expect(r.plan.totals.skippedCount).toBe(1);
    expect(r.plan.skippedRows[0].reason).toBe("unknown_alt_staff");

    const after = await org.service
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    expect(after.count).toBe(before.count);
  });
});
