// Admin-Layout (B1c). Gate: nur Mitarbeiter mit Rolle manager+ dürfen die
// /admin/*-Seiten betreten. Unzureichende Rolle → redirect("/").
//
// Schreibende Aktionen prüfen die Rolle nochmals serverseitig (admin) —
// dieses Gate ist nur UX, nicht die Sicherheitsbarriere.

import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { tabClass } from "@/components/ui/nav-tab";
import { supabase } from "@/integrations/supabase/client";
import { getMyIdentity } from "@/lib/auth/me.functions";
import { getReviewPendingCounts } from "@/lib/profile/profile-admin.functions";
import { useAuth } from "@/hooks/use-auth";
import {
  SUB_TABS as EINSTELLUNGEN_SUB_TABS,
  type TabKey as EinstellungenTabKey,
} from "./einstellungen.index";

function SignOutLink() {
  const { signOut } = useAuth();
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      Abmelden
    </button>
  );
}

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ context, location }) => {
    // Session-Check rein lokal (kein /auth/v1/user-Roundtrip); getMyIdentity()
    // revalidiert das Token serverseitig via requireSupabaseAuth.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) throw redirect({ to: "/auth" });

    // Identity über den gemeinsamen Query-Cache (gleicher Key wie AuthContext)
    // → ein Roundtrip pro Session statt pro Admin-Navigation.
    const identity = await context.queryClient.ensureQueryData({
      queryKey: ["identity", sessionData.session.user.id ?? null],
      queryFn: () => getMyIdentity(),
    });
    if (
      identity.role !== "admin" &&
      identity.role !== "manager" &&
      identity.role !== "payroll" &&
      identity.role !== "planer"
    ) {
      throw redirect({ to: "/" });
    }
    // Lohnbüro darf Arbeitszeiten UND die Personalverwaltung (SD1 —
    // Personaldaten/Urlaubs-Stammdaten der Detailseite) sehen.
    if (identity.role === "payroll") {
      const p = location.pathname;
      const payrollAllowed =
        p === "/admin/zeit-uebersicht" || p === "/admin/staff" || p.startsWith("/admin/staff/");
      if (!payrollAllowed) {
        throw redirect({ to: "/admin/zeit-uebersicht" });
      }
    }
    // PL1 + Z5 — Planer darf Dienstplan, Urlaubsantrag/Schichttausch UND
    // die Zeit-Übersicht (nur Wochenplan-Tab) sehen.
    if (
      identity.role === "planer" &&
      location.pathname !== "/admin/dienstplan" &&
      location.pathname !== "/admin/urlaub" &&
      location.pathname !== "/admin/zeit-uebersicht"
    ) {
      throw redirect({ to: "/admin/dienstplan" });
    }
    return { identity };
  },
  component: AdminLayout,
});

type Role = "admin" | "manager" | "payroll" | "planer";

type SubItem = { to: string; label: string; roles?: Role[] };
type Group = {
  key: string;
  label: string;
  default: string;
  prefixes: string[];
  sub: SubItem[];
  roles?: Role[]; // omitted = admin + manager
  muted?: boolean;
};

const GROUPS: Group[] = [
  {
    key: "personal",
    label: "Mitarbeiter",
    default: "/admin/zeit-uebersicht",
    prefixes: [
      "/admin/dienstplan",
      "/admin/zeit-uebersicht",
      "/admin/urlaub",
      "/admin/personal-antraege",
      "/admin/wein-quiz",
      "/admin/dokumente",
      "/admin/staff",
    ],
    sub: [
      { to: "/admin/zeit-uebersicht", label: "Arbeitszeiten" },
      { to: "/admin/dienstplan", label: "Dienstplan" },
      { to: "/admin/urlaub", label: "Urlaubsantrag / Schichttausch" },
      { to: "/admin/personal-antraege", label: "Personal-Anträge", roles: ["admin"] },
      { to: "/admin/wein-quiz", label: "Wein-Quiz" },
      { to: "/admin/dokumente", label: "Dokument-Vorlagen", roles: ["admin"] },
      // SD1 — „Mitarbeiter Stammdaten" nur für admin (Manager haben keinen
      // Zutritt; payroll erreicht die Seite über die eigene Tab-Leiste).
      { to: "/admin/staff", label: "Mitarbeiter Stammdaten", roles: ["admin"] },
    ],
  },
  {
    key: "kasse",
    label: "Tagesabrechnung",
    default: "/admin/kasse",
    prefixes: ["/admin/kasse", "/admin/kasse-saldo", "/admin/trinkgeld-rest"],
    sub: [
      { to: "/admin/kasse", label: "Tagesabschlüsse" },
      { to: "/admin/kasse-saldo", label: "Saldo" },
      { to: "/admin/trinkgeld-rest", label: "Trinkgeld-Rest", roles: ["admin"] },
    ],
  },
  {
    key: "bestellung",
    label: "Bestellung/Inventur",
    default: "/admin/bestellung",
    prefixes: ["/admin/bestellung"],
    sub: [], // eigene Sub-Nav lebt in bestellung.tsx
  },
  {
    key: "aufgaben",
    label: "Aufgaben",
    default: "/admin/aufgaben",
    prefixes: ["/admin/aufgaben", "/admin/aufgaben-display"],
    sub: [
      { to: "/admin/aufgaben", label: "Kanban-Board" },
      { to: "/admin/aufgaben-display", label: "Aufgaben-Display" },
    ],
  },
  {
    key: "stammdaten",
    label: "Stammdaten",
    default: "/admin/verkaufsartikel",
    prefixes: ["/admin/verkaufsartikel", "/admin/wein"],
    sub: [
      { to: "/admin/verkaufsartikel", label: "Verkaufsartikel" },
      { to: "/admin/wein", label: "Wein" },
    ],
  },
  {
    key: "auswertungen",
    label: "Auswertungen",
    default: "/admin/statistik",
    prefixes: [
      "/admin/statistik",
      "/admin/bwa",
      "/admin/bilanz",
      "/admin/bankkonto",
      "/admin/pos-verkauf",
      "/admin/pos-stundenbericht",
      "/admin/pos-renner-penner",
      "/admin/frag-coco",
    ],
    sub: [
      { to: "/admin/statistik", label: "Statistik" },
      { to: "/admin/pos-verkauf", label: "POS-Verkauf" },
      { to: "/admin/frag-coco", label: "Frag COCO", roles: ["admin"] },
      { to: "/admin/bwa", label: "BWA", roles: ["admin"] },
      { to: "/admin/bilanz", label: "Jahresabschluss", roles: ["admin"] },
      { to: "/admin/bankkonto", label: "Bankkonto", roles: ["admin"] },
    ],
  },
  {
    key: "einstellungen",
    label: "Einstellungen",
    default: "/admin/einstellungen",
    prefixes: [
      "/admin/einstellungen",
      "/admin/migration",
      "/admin/import-zuordnungen",
      "/admin/lohn-verteilung",
      "/admin/locations",
    ],
    sub: [
      { to: "/admin/einstellungen", label: "Allgemein" },
      { to: "/admin/einstellungen/easyorder-verwaltung", label: "EasyOrder-Verwaltung" },
      { to: "/admin/einstellungen/veranstaltungen", label: "Veranstaltungen" },
      { to: "/admin/locations", label: "Standorte" },
      { to: "/admin/migration", label: "System" },
    ],
    roles: ["admin"],
  },
];

// System-Unterseiten (früher eigene Top-Level-Gruppe „System") sind jetzt
// unter Einstellungen einsortiert. Für die tertiäre Navigation innerhalb
// von „System" halten wir die Liste hier lokal.
const SYSTEM_SUB: { to: string; label: string }[] = [
  { to: "/admin/migration", label: "Migration" },
  { to: "/admin/import-zuordnungen", label: "Zuordnungen" },
  { to: "/admin/lohn-verteilung", label: "Lohn PDF Import" },
  { to: "/admin/config-check", label: "Config-Check" },
];

// Sub-Sub-Nav für „Einstellungen → Allgemein" (?tab=…). Wird nur auf
// /admin/einstellungen gerendert und teilt sich Styling & Struktur mit
// SYSTEM_SUB, damit die Optik 1:1 mit den anderen Tab-Leisten übereinstimmt.
// KGL: Tab-Liste ist single-sourced aus der Zielroute (einstellungen.index),
// damit Nav und validateSearch strukturell nicht mehr driften können.
// AP1-A — adminOnly-Flag aus einstellungen.index wird in die Nav übernommen,
// damit „Artikel" für Nicht-Admins gar nicht erst in der Tab-Leiste erscheint.
const EINSTELLUNGEN_ALLGEMEIN_SUB: {
  tab: EinstellungenTabKey;
  label: string;
  adminOnly?: boolean;
}[] = EINSTELLUNGEN_SUB_TABS.map((t) => ({
  tab: t.key,
  label: t.label,
  adminOnly: "adminOnly" in t ? (t as { adminOnly?: boolean }).adminOnly : false,
}));

function isSystemPath(pathname: string): boolean {
  return SYSTEM_SUB.some((s) => pathname === s.to || pathname.startsWith(s.to + "/"));
}

function matchPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function AdminLayout() {
  const { identity } = Route.useRouteContext();
  const isPayroll = identity.role === "payroll";
  const isPlaner = identity.role === "planer";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchParams = useRouterState({ select: (s) => s.location.search });
  const role = identity.role as Role;
  const visibleGroups = GROUPS.filter((g) => !g.roles || g.roles.includes(role));
  const activeGroup = visibleGroups.find((g) => matchPrefix(pathname, g.prefixes));
  // Sub-Nav für „Bestellung" wird in bestellung.tsx selbst gerendert.
  const showSub = activeGroup && activeGroup.sub.length > 0;
  const primaryGroups = visibleGroups.filter((g) => !g.muted);
  const systemGroups = visibleGroups.filter((g) => g.muted);
  const reviewCountsQ = useQuery({
    queryKey: ["admin", "review-pending-counts"],
    queryFn: () => getReviewPendingCounts(),
    // PL1 — planer/manager sehen die Badge-Zähler ebenfalls (server-seitig
    // auf ihren Scope gefiltert). staff-Antrags-/Dokumenten-Zähler bleiben
    // Admin-only (0 für andere Rollen).
    enabled: role === "admin" || role === "manager" || role === "planer",
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const pendingReview =
    (reviewCountsQ.data?.pendingRequests ?? 0) + (reviewCountsQ.data?.pendingDocuments ?? 0);
  const pendingSwaps = reviewCountsQ.data?.swapPending ?? 0;
  const pendingLeave = reviewCountsQ.data?.pendingLeaveRequests ?? 0;
  const groupNeedsDot = (key: string): boolean =>
    key === "personal" && (pendingReview > 0 || pendingLeave > 0 || pendingSwaps > 0);
  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ background: "var(--loc-page, var(--background))" }}
    >
      <header
        className="border-b border-border transition-colors duration-300"
        style={{ background: "var(--loc-page, var(--card))" }}
      >
        <div className="mx-auto max-w-7xl px-6 pt-3">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <Link to="/" aria-label="COCO Startseite">
                <span className="text-sm font-semibold text-foreground">COCO</span>
              </Link>
              <span className="text-border" aria-hidden>
                /
              </span>
              <Link to="/admin" className="text-sm font-semibold text-foreground">
                Verwaltung
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
                ← Zurück
              </Link>
              <SignOutLink />
            </div>
          </div>
          {isPayroll ? (
            <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pb-0 text-sm">
              <Link
                to="/admin/zeit-uebersicht"
                className={tabClass(pathname === "/admin/zeit-uebersicht")}
              >
                Arbeitszeiten
              </Link>
              <Link
                to="/admin/staff"
                className={tabClass(
                  pathname === "/admin/staff" || pathname.startsWith("/admin/staff/"),
                )}
              >
                Mitarbeiter
              </Link>
            </nav>
          ) : isPlaner ? (
            <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pb-0 text-sm">
              <Link to="/admin/dienstplan" className={tabClass(pathname === "/admin/dienstplan")}>
                Dienstplan
              </Link>
              <Link
                to="/admin/zeit-uebersicht"
                className={tabClass(pathname === "/admin/zeit-uebersicht")}
              >
                Wochenplan
              </Link>
              <Link
                to="/admin/urlaub"
                className={tabClass(pathname === "/admin/urlaub")}
                aria-label={
                  pendingLeave + pendingSwaps > 0
                    ? "Urlaubsantrag / Schichttausch (offene Vorgänge)"
                    : undefined
                }
              >
                Urlaubsantrag / Schichttausch
                {pendingLeave + pendingSwaps > 0 && (
                  <span
                    className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle"
                    aria-hidden
                  />
                )}
              </Link>
            </nav>
          ) : (
            <>
              <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 text-sm">
                {primaryGroups.map((g) => {
                  const active = activeGroup?.key === g.key;
                  const showDot = groupNeedsDot(g.key);
                  return (
                    <Link
                      key={g.key}
                      to={g.default}
                      className={tabClass(active)}
                      aria-label={showDot ? `${g.label} (offene Vorgänge)` : undefined}
                    >
                      {g.label}
                      {showDot && (
                        <span
                          className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle"
                          aria-hidden
                        />
                      )}
                    </Link>
                  );
                })}
                {systemGroups.length > 0 && (
                  <>
                    <span className="text-border" aria-hidden>
                      ·
                    </span>
                    {systemGroups.map((g) => {
                      const active = activeGroup?.key === g.key;
                      return (
                        <Link key={g.key} to={g.default} className={tabClass(active)}>
                          {g.label}
                        </Link>
                      );
                    })}
                  </>
                )}
              </nav>
              {showSub && (
                <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pt-2 text-xs">
                  {activeGroup!.sub
                    .filter((s) => !s.roles || s.roles.includes(role))
                    .map((s) => {
                      const active = pathname === s.to || pathname.startsWith(s.to + "/");
                      const activeWithSystem =
                        active ||
                        (s.to === "/admin/migration" &&
                          isSystemPath(pathname) &&
                          !pathname.startsWith("/admin/migration")) ||
                        (s.to === "/admin/pos-verkauf" &&
                          pathname.startsWith("/admin/pos-stundenbericht"));
                      const showDot =
                        (s.to === "/admin/personal-antraege" && pendingReview > 0) ||
                        (s.to === "/admin/urlaub" && (pendingLeave > 0 || pendingSwaps > 0));
                      return (
                        <Link
                          key={s.to}
                          to={s.to}
                          className={tabClass(activeWithSystem)}
                          aria-label={showDot ? `${s.label} (offene Vorgänge)` : undefined}
                        >
                          {s.label}
                          {showDot && (
                            <span
                              className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle"
                              aria-hidden
                            />
                          )}
                        </Link>
                      );
                    })}
                </nav>
              )}
              {isSystemPath(pathname) && (
                <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pt-2 text-xs">
                  {SYSTEM_SUB.map((s) => {
                    const active = pathname === s.to || pathname.startsWith(s.to + "/");
                    return (
                      <Link key={s.to} to={s.to} className={tabClass(active)}>
                        {s.label}
                      </Link>
                    );
                  })}
                </nav>
              )}
              {pathname === "/admin/einstellungen" && (
                <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pt-2 text-xs">
                  {EINSTELLUNGEN_ALLGEMEIN_SUB.filter(
                    (s) => !s.adminOnly || identity.role === "admin",
                  ).map((s) => {
                    const currentTab =
                      (searchParams as { tab?: string } | undefined)?.tab ?? "trinkgeldpool";
                    const active = currentTab === s.tab;
                    return (
                      <Link
                        key={s.tab}
                        to="/admin/einstellungen"
                        search={{ tab: s.tab }}
                        replace
                        className={tabClass(active)}
                      >
                        {s.label}
                      </Link>
                    );
                  })}
                </nav>
              )}
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
