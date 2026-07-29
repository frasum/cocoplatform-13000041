// Test-Helper für DB-Integrationstests gegen einen LOKAL via `supabase start`
// hochgezogenen Stack. Wird ausschließlich von `*.db.test.ts` benutzt.
//
// Aktivierung: `SUPABASE_DB_TESTS=1` + `SUPABASE_URL` + `SUPABASE_ANON_KEY` +
// `SUPABASE_SERVICE_ROLE_KEY` aus `supabase status -o env`. Siehe
// `.github/workflows/ci.yml`, Job `db-integration`.
//
// KEIN Aufruf gegen die Produktiv-Datenbank: in CI zeigen die Env-Vars auf
// `http://127.0.0.1:54321`, lokal sind sie nicht gesetzt → Tests werden via
// `dbTestsEnabled` geskippt.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/admin/role-guard";

// DB1 — Diagnose-Helfer für DB-Integrationstests. Re-Export, damit
// Testdateien weiterhin nur aus `@/test/db-setup` importieren müssen.
export { expectData } from "./expect-data";
export type { PostgrestLike } from "./expect-data";

export const dbTestsEnabled =
  process.env.SUPABASE_DB_TESTS === "1" &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signInAsUser(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

export type SeededUser = {
  userId: string;
  staffId: string;
  email: string;
  password: string;
};

export type SeededOrg = {
  orgId: string;
  defaultLocationId: string;
  service: SupabaseClient<Database>;
  mkUser: (role: AppRole | null, opts?: { isActive?: boolean }) => Promise<SeededUser>;
  mkLocation: (name?: string) => Promise<string>;
  bindStaffLocation: (staffId: string, locationId: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

const PASSWORD = "Test-Password-123!";
const UPSTREAM_BOOT_ERROR = "invalid response was received from the upstream server";

type DbInsertResult = {
  error: { message: string } | null;
};

function isUpstreamBootError(error: { message: string } | null): boolean {
  return error?.message.toLowerCase().includes(UPSTREAM_BOOT_ERROR) ?? false;
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDbInsertRetry<TResult extends DbInsertResult>(
  label: string,
  operation: () => PromiseLike<TResult>,
): Promise<TResult> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await operation();
    if (!isUpstreamBootError(result.error) || attempt === 3) return result;
    await pause(500);
  }
  throw new Error(`${label} retry loop exhausted unexpectedly`);
}

export async function seedOrg(label: string): Promise<SeededOrg> {
  const service = getServiceClient();
  const orgName = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: org, error: orgErr } = await withDbInsertRetry("org insert", () =>
    service.from("organizations").insert({ name: orgName }).select("id").single(),
  );
  if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`);
  const orgId = org.id;

  // Default-Standort: nahezu alle Bestandstests gehen davon aus, dass es
  // genau einen Standort gibt. Der Default wird automatisch angelegt;
  // mkUser bindet neue staff per default daran.
  const { data: defLoc, error: locErr } = await withDbInsertRetry("location seed", () =>
    service
      .from("locations")
      .insert({
        organization_id: orgId,
        name: "Hauptstandort",
        // Default-Geofence: München-Marienplatz. Tests, die placeEasyOrder
        // oder clockIn aufrufen, übergeben denselben Punkt als GPS-Fix
        // (siehe `TEST_GEO_FIX` weiter unten in den Test-Suites).
        latitude: 48.137154,
        longitude: 11.575382,
        geofence_radius_m: 100,
      })
      .select("id")
      .single(),
  );
  if (locErr || !defLoc) throw new Error(`location seed failed: ${locErr?.message}`);
  const defaultLocationId = defLoc.id;

  const createdUsers: string[] = [];
  const createdStaff: string[] = [];

  const mkUser: SeededOrg["mkUser"] = async (role, opts) => {
    const tag = role ?? "none";
    const email = `${tag}-${crypto.randomUUID()}@test.local`;
    const { data: u, error: uErr } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (uErr || !u.user) throw new Error(`createUser failed: ${uErr?.message}`);
    const userId = u.user.id;
    createdUsers.push(userId);

    const { data: staff, error: sErr } = await withDbInsertRetry("staff insert", () =>
      service
        .from("staff")
        .insert({
          organization_id: orgId,
          first_name: tag,
          last_name: "Test",
          display_name: `${tag} ${userId.slice(0, 6)}`,
          email,
          is_active: opts?.isActive ?? true,
        })
        .select("id")
        .single(),
    );
    if (sErr || !staff) throw new Error(`staff insert failed: ${sErr?.message}`);
    createdStaff.push(staff.id);

    const { error: linkErr } = await withDbInsertRetry("user_links insert", () =>
      service.from("user_links").insert({
        user_id: userId,
        staff_id: staff.id,
        organization_id: orgId,
      }),
    );
    if (linkErr) throw new Error(`user_links insert failed: ${linkErr.message}`);

    if (role) {
      const { error: raErr } = await withDbInsertRetry("role_assignments insert", () =>
        service.from("role_assignments").insert({
          staff_id: staff.id,
          organization_id: orgId,
          role,
        }),
      );
      if (raErr) throw new Error(`role_assignments insert failed: ${raErr.message}`);
    }

    // Default-Bindung Standort: ohne staff_locations-Eintrag kann der
    // Kellner serverseitig keine Settlement abgeben (B3-Modellkorrektur A).
    const { error: slErr } = await withDbInsertRetry("staff_locations seed", () =>
      service.from("staff_locations").insert({
        organization_id: orgId,
        staff_id: staff.id,
        location_id: defaultLocationId,
        department: "service",
      }),
    );
    if (slErr) throw new Error(`staff_locations seed failed: ${slErr.message}`);

    return { userId, staffId: staff.id, email, password: PASSWORD };
  };

  const mkLocation: SeededOrg["mkLocation"] = async (name) => {
    const { data, error } = await withDbInsertRetry("mkLocation", () =>
      service
        .from("locations")
        .insert({
          organization_id: orgId,
          name: name ?? `Standort ${Math.random().toString(36).slice(2, 6)}`,
        })
        .select("id")
        .single(),
    );
    if (error || !data) throw new Error(`mkLocation failed: ${error?.message}`);
    return data.id;
  };

  const bindStaffLocation: SeededOrg["bindStaffLocation"] = async (staffId, locationId) => {
    const { error } = await withDbInsertRetry("bindStaffLocation", () =>
      service.from("staff_locations").insert({
        organization_id: orgId,
        staff_id: staffId,
        location_id: locationId,
        department: "service",
      }),
    );
    if (error && !`${error.message}`.includes("duplicate")) {
      throw new Error(`bindStaffLocation failed: ${error.message}`);
    }
  };

  const cleanup: SeededOrg["cleanup"] = async () => {
    // Reihenfolge: abhängige Daten zuerst.
    // Kasse: sessions kaskadiert auf satelliten + waiter_settlements.
    await service.from("sessions").delete().eq("organization_id", orgId);
    await service.from("payment_terminals").delete().eq("organization_id", orgId);
    await service.from("revenue_channels").delete().eq("organization_id", orgId);
    await service.from("cash_locks").delete().eq("organization_id", orgId);
    await service.from("time_entries").delete().eq("organization_id", orgId);
    await service.from("audit_log").delete().eq("organization_id", orgId);
    await service.from("organization_settings").delete().eq("organization_id", orgId);
    await service.from("role_assignments").delete().eq("organization_id", orgId);
    await service.from("user_links").delete().eq("organization_id", orgId);
    await service.from("staff_locations").delete().eq("organization_id", orgId);
    if (createdStaff.length > 0) {
      await service.from("staff").delete().in("id", createdStaff);
    }
    await service.from("locations").delete().eq("organization_id", orgId);
    await service.from("organizations").delete().eq("id", orgId);
    for (const uid of createdUsers) {
      await service.auth.admin.deleteUser(uid).catch(() => undefined);
    }
  };

  return { orgId, defaultLocationId, service, mkUser, mkLocation, bindStaffLocation, cleanup };
}

export async function countAuditLog(
  service: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { count, error } = await service
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) throw error;
  return count ?? 0;
}
