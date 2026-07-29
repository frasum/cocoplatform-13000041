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
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

export type OrphanAuthAccount = {
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  // SP1 — Herkunfts-Signale (rein aus Auth-Metadaten abgeleitet).
  providerName: string | null;
  linkedStaffId: string | null;
  kind: "broken_link" | "foreign";
};

// COCO legt Schattenkonten für PIN-Logins nach diesem E-Mail-Muster an
// (src/lib/auth/auth-flows.server.ts). Wenn das Konto verwaist ist, lässt
// sich aus der E-Mail die staff_id ableiten — auch ohne app_metadata.
const STAFF_EMAIL_RE = /^staff-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@internal\.invalid$/i;

function readString(source: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!source) return null;
  const v = source[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function readProviderName(user: AuthUserLike): string | null {
  const md = user.user_metadata ?? null;
  return readString(md, "full_name") ?? readString(md, "name") ?? readString(md, "preferred_username");
}

export function readStaffIdHint(user: AuthUserLike): string | null {
  const fromApp = readString(user.app_metadata ?? null, "staff_id");
  if (fromApp) return fromApp;
  const email = user.email ?? "";
  const m = STAFF_EMAIL_RE.exec(email);
  return m ? m[1] : null;
}

export function pickOrphanAccounts(
  users: readonly AuthUserLike[],
  linkedUserIds: ReadonlySet<string>,
): OrphanAuthAccount[] {
  const orphans: OrphanAuthAccount[] = [];
  for (const u of users) {
    if (linkedUserIds.has(u.id)) continue;
    const linkedStaffId = readStaffIdHint(u);
    orphans.push({
      userId: u.id,
      email: u.email ?? null,
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      providerName: readProviderName(u),
      linkedStaffId,
      kind: linkedStaffId !== null ? "broken_link" : "foreign",
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
