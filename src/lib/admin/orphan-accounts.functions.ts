// AC2 — Verwaiste Auth-Konten: Auth-User ohne user_links-Eintrag in dieser
// Anmeldung. Reine Anzeige (admin-only), keine Aktionen. Dient als
// Auffang-Sichtbarkeit, wenn sich jemand anmeldet, den es nicht als
// Mitarbeiter gibt (oder dessen Verknüpfung fehlt).
//
// Sicherheit: admin-only via loadAdminCaller("admin"). Kein Audit-Eintrag —
// pures Lesen, kein State-Change.
//
// AC2-F: Die Auswahl-Logik liegt in `./orphan-accounts.ts`; hier bleibt nur
// Datenbeschaffung. `user_links` wird projektweit gelesen (kein Org-Filter),
// weil „verwaist" heißt „nirgendwo verknüpft" — die Begründung steht dort im
// Kopfkommentar.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { expectOk } from "@/lib/supabase/expect-ok";
import { pickOrphanAccounts, type AuthUserLike } from "./orphan-accounts";
export type { OrphanAuthAccount } from "./orphan-accounts";

export const listOrphanAuthAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Rollen-Gate; das Ergebnis wird nicht gebunden, weil die Abfrage
    // organisationsübergreifend läuft (siehe Kopfkommentar).
    await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Alle user_ids aus user_links — projektweit, kein Org-Filter.
    //    Ein Konto, das in irgendeiner Organisation verknüpft ist, ist kein
    //    Waisenkind und darf hier nicht mit E-Mail/Login erscheinen.
    const linkRows = expectOk<{ user_id: string }[]>(
      await supabaseAdmin.from("user_links").select("user_id"),
      "listOrphanAuthAccounts.user_links",
    );
    const linked = new Set((linkRows ?? []).map((r) => r.user_id));

    // 2) Alle Auth-User seitenweise einsammeln; die Auswahl-/Sortier-Regel
    //    lebt im reinen Modul.
    const allUsers: AuthUserLike[] = [];
    const perPage = 200;
    const MAX_PAGES = 50;
    let lastPageWasShort = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) allUsers.push(u as AuthUserLike);
      if (users.length < perPage) {
        lastPageWasShort = true;
        break;
      }
    }
    if (!lastPageWasShort) {
      // Kein stiller Abbruch: lieber hörbar scheitern als eine gekürzte
      // Liste anzeigen.
      throw new Error(
        "listOrphanAuthAccounts: Seitenlimit erreicht (>10000 Auth-Konten) — Liste wäre unvollständig",
      );
    }

    const orphans = pickOrphanAccounts(allUsers, linked);

    // SP1 — Herkunft auflösen: für „broken_link"-Einträge den echten
    // COCO-Anzeigenamen aus staff nachladen. Eine Abfrage, nicht pro Zeile.
    // Findet sich zur staff_id keine Zeile mehr (gelöscht), bleibt der
    // Name null — kind bleibt broken_link (nicht als Fremdanmeldung
    // fehldeuten).
    const staffIds = Array.from(
      new Set(orphans.map((o) => o.linkedStaffId).filter((id): id is string => !!id)),
    );
    const staffMap = new Map<string, { displayName: string; persoNr: number | null }>();
    if (staffIds.length > 0) {
      const rows = expectOk<{ id: string; display_name: string; perso_nr: number | null }[]>(
        await supabaseAdmin.from("staff").select("id, display_name, perso_nr").in("id", staffIds),
        "listOrphanAuthAccounts.staff",
      );
      for (const r of rows ?? []) {
        staffMap.set(r.id, { displayName: r.display_name, persoNr: r.perso_nr });
      }
    }
    return orphans.map((o) => {
      const s = o.linkedStaffId ? staffMap.get(o.linkedStaffId) : null;
      return {
        ...o,
        linkedStaffName: s?.displayName ?? null,
        linkedStaffPersoNr: s?.persoNr ?? null,
      };
    });
  });
