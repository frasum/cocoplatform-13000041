// Organisations-Einstellungen (admin only zum Schreiben, manager liest).
// EIN1 (05.07.2026): Der frühere lange Kartenstapel ist in vier
// Unter-Tabs gegliedert (Trinkgeldpool · Bestellungen ·
// Sofortmeldung & Arbeitgeber · Telegram). Reine UI-Umgruppierung —
// die Sektionen selbst leben jetzt in src/components/settings/. Der
// aktive Tab wird als Search-Param `?tab=…` in der URL geführt, damit
// Reload und Verlinkung die Position halten.
//
// Die org-settings-Mutation (updateOrgSettings) bleibt bewusst hier
// im Container — sie erwartet alle fünf Felder gemeinsam und wird von
// TrinkgeldpoolSection UND BestellungenSection geteilt, damit das
// bisherige Speicherverhalten beider Karten Zeichen für Zeichen
// erhalten bleibt.

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getOrgSettings,
  updateOrgSettings,
  setPausenBezahlt,
  getCurrentPeriodBreakSummary,
} from "@/lib/admin/org-settings.functions";
import { TrinkgeldpoolSection } from "@/components/settings/TrinkgeldpoolSection";
import { ArbeitszeitSection } from "@/components/settings/ArbeitszeitSection";
import { BestellungenSection } from "@/components/settings/BestellungenSection";
import { SofortmeldungSection } from "@/components/settings/SofortmeldungSection";
import { ArbeitgeberSection } from "@/components/settings/ArbeitgeberSection";
import { TelegramBotSection } from "@/components/settings/TelegramBotSection";
import { TelegramTagesberichtSection } from "@/components/settings/TelegramTagesberichtSection";
import { SkillsSection } from "@/components/settings/SkillsSection";
import { ArtikelPflegeSection } from "@/components/settings/ArtikelPflegeSection";
import { TaxonomySection } from "@/components/settings/TaxonomySection";

// AP1-A — Tabs sind single-sourced. `adminOnly: true` versteckt einen Tab
// generisch in der Nav (route.tsx filtert) und schaltet den Content-Fallback.
export type SubTab = { key: string; label: string; adminOnly?: boolean };
export const SUB_TABS = [
  { key: "trinkgeldpool", label: "Trinkgeldpool" },
  { key: "arbeitszeit", label: "Arbeitszeit" },
  { key: "bestellungen", label: "Bestellungen" },
  { key: "sofortmeldung", label: "Sofortmeldung & Arbeitgeber" },
  { key: "telegram", label: "Telegram" },
  { key: "skills", label: "Skills" },
  { key: "artikel", label: "Artikel", adminOnly: true },
  { key: "stammdaten", label: "Kategorien & Einheiten", adminOnly: true },
] as const satisfies ReadonlyArray<SubTab>;

export type TabKey = (typeof SUB_TABS)[number]["key"];
const TAB_KEYS = SUB_TABS.map((t) => t.key) as readonly TabKey[];

function isTabKey(value: unknown): value is TabKey {
  return typeof value === "string" && (TAB_KEYS as readonly string[]).includes(value);
}

export const Route = createFileRoute("/_authenticated/admin/einstellungen/")({
  head: () => ({ meta: [{ title: "Einstellungen · Verwaltung" }] }),
  validateSearch: (search: Record<string, unknown>): { tab: TabKey } => ({
    tab: isTabKey(search.tab) ? search.tab : "trinkgeldpool",
  }),
  component: OrgSettingsPage,
});

function OrgSettingsPage() {
  const { identity } = useRouteContext({ from: "/_authenticated/admin" });
  const canEdit = identity.role === "admin";
  const queryClient = useQueryClient();
  const callUpdate = useServerFn(updateOrgSettings);
  const callSetPausenBezahlt = useServerFn(setPausenBezahlt);
  const { tab: rawTab } = Route.useSearch();
  // AP1-A — Content-Fallback: Nicht-Admin darf keinen adminOnly-Tab sehen,
  // auch nicht per Direkt-Link (?tab=artikel). validateSearch bleibt lax; das
  // Rendering entscheidet.
  const tab: TabKey = (() => {
    const entry = (SUB_TABS as ReadonlyArray<SubTab>).find((t) => t.key === rawTab);
    if (entry?.adminOnly && identity.role !== "admin") return "trinkgeldpool";
    return rawTab;
  })();

  const settingsQ = useQuery({
    queryKey: ["admin", "org-settings"],
    queryFn: () => getOrgSettings(),
  });

  // PB2 — Vorschau Σ Pause laufende Periode (nur Admin, nur bei Bedarf laden).
  const breakSummaryQ = useQuery({
    queryKey: ["admin", "pausen-break-summary"],
    queryFn: () => getCurrentPeriodBreakSummary(),
    enabled: canEdit && tab === "arbeitszeit",
    staleTime: 60_000,
  });

  // Geteilter Form-State für Trinkgeldpool + Bestellungen (siehe Kopf-Kommentar).
  const [tipRatePercent, setTipRatePercent] = useState("");
  const [minHours, setMinHours] = useState("");
  const [kitchenManualOnly, setKitchenManualOnly] = useState(false);
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [testModeEmail, setTestModeEmail] = useState("");
  const [orderReplyTelegramEnabled, setOrderReplyTelegramEnabled] = useState(false);
  const [orderReplyForwardUnassigned, setOrderReplyForwardUnassigned] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // PB1 — separater Zustand, weil eigene Server-Fn und eigener Fluss
  // (Bestätigungsdialog vor Speichern).
  const [pausenBezahlt, setPausenBezahlt_] = useState(true);
  const [pausenMsg, setPausenMsg] = useState<string | null>(null);
  const [pausenErr, setPausenErr] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQ.data) return;
    setTipRatePercent((settingsQ.data.kitchenTipRate * 100).toFixed(2));
    setMinHours(settingsQ.data.tipPoolMinHours.toFixed(2));
    setKitchenManualOnly(settingsQ.data.kitchenManualOnly);
    setTestModeEnabled(settingsQ.data.testModeEnabled);
    setTestModeEmail(settingsQ.data.testModeEmail ?? "");
    setOrderReplyTelegramEnabled(settingsQ.data.orderReplyTelegramEnabled);
    setOrderReplyForwardUnassigned(settingsQ.data.orderReplyForwardUnassigned);
    setPausenBezahlt_(settingsQ.data.pausenBezahlt);
  }, [settingsQ.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const rate = parseLocaleNumber(tipRatePercent) / 100;
      const hours = parseLocaleNumber(minHours);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new Error("Küchen-Trinkgeldsatz: 0 bis 100 % erlaubt.");
      }
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        throw new Error("Mindeststunden: 0 bis 24 erlaubt.");
      }
      const trimmedEmail = testModeEmail.trim();
      if (testModeEnabled && !trimmedEmail) {
        throw new Error("Bei aktivem Testmodus ist eine E-Mail-Adresse Pflicht.");
      }
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error("Test-E-Mail-Adresse ist ungültig.");
      }
      return callUpdate({
        data: {
          kitchenTipRate: rate,
          tipPoolMinHours: hours,
          kitchenManualOnly,
          testModeEnabled,
          testModeEmail: trimmedEmail === "" ? null : trimmedEmail,
          orderReplyTelegramEnabled,
          orderReplyForwardUnassigned,
        },
      });
    },
    onSuccess: async () => {
      setMsg("Gespeichert.");
      setErr(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-settings"] });
    },
    onError: (e: unknown) => {
      setErr(e instanceof Error ? e.message : "Fehler.");
      setMsg(null);
    },
  });

  const pausenMutation = useMutation({
    mutationFn: async (next: boolean) => {
      return callSetPausenBezahlt({ data: { pausenBezahlt: next } });
    },
    onSuccess: async (_res, next) => {
      setPausenBezahlt_(next);
      setPausenMsg("Gespeichert.");
      setPausenErr(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "org-settings"] });
    },
    onError: (e: unknown) => {
      setPausenErr(e instanceof Error ? e.message : "Fehler.");
      setPausenMsg(null);
    },
  });

  if (settingsQ.isLoading) return <p className="text-sm text-muted-foreground">Lade…</p>;
  if (settingsQ.error)
    return <p className="text-sm text-destructive">Einstellungen konnten nicht geladen werden.</p>;

  const handleTrinkgeldpoolSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    mutation.mutate();
  };

  const handleBestellungenSave = () => {
    setMsg(null);
    setErr(null);
    mutation.mutate();
  };

  const wide = tab === "artikel" || tab === "stammdaten";
  return (
    <div className={wide ? "space-y-6" : "max-w-xl space-y-6"}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Einstellungen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organisationsweite Geschäftsregeln. {canEdit ? "Nur Admin darf ändern." : "Nur lesen."}
        </p>
      </div>

      <div className="space-y-8">
        {tab === "trinkgeldpool" && (
          <TrinkgeldpoolSection
            canEdit={canEdit}
            tipRatePercent={tipRatePercent}
            setTipRatePercent={setTipRatePercent}
            minHours={minHours}
            setMinHours={setMinHours}
            kitchenManualOnly={kitchenManualOnly}
            setKitchenManualOnly={setKitchenManualOnly}
            msg={msg}
            err={err}
            isPending={mutation.isPending}
            onSubmit={handleTrinkgeldpoolSubmit}
          />
        )}

        {tab === "arbeitszeit" && (
          <ArbeitszeitSection
            canEdit={canEdit}
            pausenBezahlt={pausenBezahlt}
            msg={pausenMsg}
            err={pausenErr}
            isPending={pausenMutation.isPending}
            breakSummary={breakSummaryQ.data ?? null}
            onChange={(next) => {
              setPausenMsg(null);
              setPausenErr(null);
              pausenMutation.mutate(next);
            }}
          />
        )}

        {tab === "bestellungen" && (
          <BestellungenSection
            canEdit={canEdit}
            testModeEnabled={testModeEnabled}
            setTestModeEnabled={setTestModeEnabled}
            testModeEmail={testModeEmail}
            setTestModeEmail={setTestModeEmail}
            orderReplyTelegramEnabled={orderReplyTelegramEnabled}
            setOrderReplyTelegramEnabled={setOrderReplyTelegramEnabled}
            orderReplyForwardUnassigned={orderReplyForwardUnassigned}
            setOrderReplyForwardUnassigned={setOrderReplyForwardUnassigned}
            msg={msg}
            err={err}
            isPending={mutation.isPending}
            onSave={handleBestellungenSave}
          />
        )}

        {tab === "sofortmeldung" && (
          <>
            <SofortmeldungSection canEdit={canEdit} />
            <ArbeitgeberSection canEdit={canEdit} />
          </>
        )}

        {tab === "telegram" && (
          <>
            <TelegramBotSection canEdit={canEdit} />
            <TelegramTagesberichtSection canEdit={canEdit} />
          </>
        )}

        {tab === "skills" && <SkillsSection canEdit={canEdit} />}

        {tab === "artikel" && identity.role === "admin" && <ArtikelPflegeSection />}

        {tab === "stammdaten" && identity.role === "admin" && <TaxonomySection />}
      </div>
    </div>
  );
}

function parseLocaleNumber(input: string): number {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "") return NaN;
  return Number(normalized);
}
