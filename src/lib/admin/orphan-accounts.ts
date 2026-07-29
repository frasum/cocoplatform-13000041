// AC2-F — Reine Auswahl-Logik für verwaiste Auth-Konten. Bewusst ohne
// Supabase-Import, damit die Regel im normalen `vitest run` testbar ist.
//
// Semantik „verwaist": ein Auth-Konto, das in KEINER Organisation einen
// `user_links`-Eintrag hat. `linkedUserIds` MUSS deshalb projektweit gebildet
// werden (kein `.eq("organization_id", …)`). Ein org-gefilterter Aufruf wäre
// ein Mandanten-Leck: Konten fremder Organisationen würden hier mit E-Mail
// und letztem Login erscheinen, obwohl sie ordentlich verknüpft sind.
//
// SaaS-Erweiterungspunkt (vgl. holiday_region-Muster): Sobald eine zweite
// Organisation existiert, gehört dieses Panel auf eine Plattform-Ebene, nicht
// in die Mandanten-Ansicht — auch ein wirklich unverknüpftes Konto ist ein
// projektweiter Zustand. Bis dahin ist die org-übergreifende Auswahl die
// sichere Variante.

export type AuthUserLike = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
};

export type OrphanAuthAccount = {
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export function pickOrphanAccounts(
  users: readonly AuthUserLike[],
  linkedUserIds: ReadonlySet<string>,
): OrphanAuthAccount[] {
  const orphans: OrphanAuthAccount[] = [];
  for (const u of users) {
    if (linkedUserIds.has(u.id)) continue;
    orphans.push({
      userId: u.id,
      email: u.email ?? null,
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
    });
  }
  orphans.sort((a, b) => {
    const av = a.lastSignInAt ?? a.createdAt ?? "";
    const bv = b.lastSignInAt ?? b.createdAt ?? "";
    if (bv !== av) return bv.localeCompare(av);
    return a.userId.localeCompare(b.userId);
  });
  return orphans;
}
