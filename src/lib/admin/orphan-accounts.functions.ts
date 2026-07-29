// AC2 — Verwaiste Auth-Konten: Auth-User ohne user_links-Eintrag in dieser
// Organisation. Reine Anzeige (admin-only), keine Aktionen. Dient als
// Auffang-Sichtbarkeit, wenn sich jemand anmeldet, den es nicht als
// Mitarbeiter gibt (oder dessen Verknüpfung fehlt).
//
// Sicherheit: admin-only via loadAdminCaller("admin"). Kein Audit-Eintrag —
// pures Lesen, kein State-Change.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { expectOk } from "@/lib/supabase/expect-ok";

export type OrphanAuthAccount = {
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export const listOrphanAuthAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrphanAuthAccount[]> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Alle user_ids der aktuellen Organisation aus user_links.
    const linkRows = expectOk<{ user_id: string }[]>(
      await supabaseAdmin
        .from("user_links")
        .select("user_id")
        .eq("organization_id", caller.organizationId),
      "listOrphanAuthAccounts.user_links",
    );
    const linked = new Set((linkRows ?? []).map((r) => r.user_id));

    // 2) Alle Auth-User seitenweise abrufen und diejenigen behalten, die
    //    in dieser Organisation nicht verknüpft sind.
    const orphans: OrphanAuthAccount[] = [];
    const perPage = 200;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) {
        if (linked.has(u.id)) continue;
        orphans.push({
          userId: u.id,
          email: u.email ?? null,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
        });
      }
      if (users.length < perPage) break;
    }

    orphans.sort((a, b) => {
      const av = a.lastSignInAt ?? a.createdAt ?? "";
      const bv = b.lastSignInAt ?? b.createdAt ?? "";
      return bv.localeCompare(av);
    });
    return orphans;
  });
