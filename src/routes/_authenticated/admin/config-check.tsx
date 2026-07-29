// Admin-only Config-Check-Seite: zeigt Präsenz-Status aller relevanten
// Server- und Client-Umgebungsvariablen, damit Config-Probleme in
// Produktion sofort sichtbar sind. Werte werden NICHT angezeigt.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getProductionConfigStatus,
  triggerSentryTestErrorServer,
  type ConfigVarStatus,
} from "@/lib/admin/config-check.functions";
import { captureClientError } from "@/lib/monitoring/sentry-client";

export const Route = createFileRoute("/_authenticated/admin/config-check")({
  beforeLoad: ({ context }) => {
    const identity = (context as { identity?: { role?: string } }).identity;
    if (identity?.role !== "admin") throw redirect({ to: "/admin" });
  },
  component: ConfigCheckPage,
});

// Client-sichtbare (VITE_*) Variablen — hier reicht ein reiner Present-Check
// im Browser, weil sie ohnehin ins Bundle inlined werden.
const CLIENT_VARS: {
  name: string;
  purpose: string;
  critical: boolean;
  value: string | undefined;
}[] = [
  {
    name: "VITE_SUPABASE_URL",
    purpose: "Supabase-URL für den Browser-Client (Login, Realtime, Storage).",
    critical: true,
    value: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  },
  {
    name: "VITE_SUPABASE_PUBLISHABLE_KEY",
    purpose: "Publishable-Key für den Browser-Client.",
    critical: true,
    value: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  },
  {
    name: "VITE_SUPABASE_PROJECT_ID",
    purpose: "Projekt-Ref (für Dashboard-Links).",
    critical: false,
    value: import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined,
  },
];

const GROUP_LABEL: Record<ConfigVarStatus["group"], string> = {
  supabase: "Supabase (Server)",
  mail: "E-Mail-Versand",
  ai: "KI",
  cron: "Cron & Public API",
  monitoring: "Monitoring",
  sonstiges: "Sonstiges",
};

function StatusDot({ ok, critical }: { ok: boolean; critical: boolean }) {
  const color = ok ? "bg-emerald-500" : critical ? "bg-destructive" : "bg-amber-500";
  const label = ok ? "gesetzt" : critical ? "fehlt (kritisch)" : "fehlt (optional)";
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function ConfigCheckPage() {
  const fetchStatus = useServerFn(getProductionConfigStatus);
  const callServerThrow = useServerFn(triggerSentryTestErrorServer);
  const q = useQuery({
    queryKey: ["admin", "config-check"],
    queryFn: () => fetchStatus(),
    refetchOnWindowFocus: false,
  });

  const [testStatus, setTestStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending"; scope: "client" | "server" }
    | { kind: "ok"; scope: "client" | "server"; at: string }
    | { kind: "error"; scope: "client" | "server"; message: string }
  >({ kind: "idle" });

  async function fireClientTest() {
    const marker = new Date().toISOString();
    setTestStatus({ kind: "sending", scope: "client" });
    try {
      const err = new Error(`Sentry-Testfehler (Client) — ausgelöst ${marker}`);
      await captureClientError(err, { test: "true", scope: "manual-admin-test" });
      setTestStatus({ kind: "ok", scope: "client", at: marker });
    } catch (e) {
      setTestStatus({
        kind: "error",
        scope: "client",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function fireServerTest() {
    const marker = new Date().toISOString();
    setTestStatus({ kind: "sending", scope: "server" });
    try {
      const res = await callServerThrow();
      setTestStatus({ kind: "ok", scope: "server", at: res.at });
    } catch (e) {
      setTestStatus({
        kind: "error",
        scope: "server",
        message: e instanceof Error ? e.message : String(e),
      });
      void marker;
    }
  }

  const clientMissingCritical = CLIENT_VARS.filter(
    (v) => v.critical && !(v.value && v.value.length > 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Config-Check</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Präsenz-Status aller relevanten Umgebungsvariablen. Werte werden aus Sicherheitsgründen
          niemals angezeigt — nur ob sie gesetzt sind, plus formale Hinweise (Länge, URL-Host,
          E-Mail-Format).
        </p>
      </div>

      {/* Zusammenfassung */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {q.isLoading && <span className="text-muted-foreground">Lade …</span>}
            {q.isError && (
              <span className="text-destructive">
                Fehler beim Laden: {(q.error as Error).message}
              </span>
            )}
            {q.data && (
              <>
                <span className="font-medium text-foreground">
                  Server: {q.data.summary.present}/{q.data.summary.total} gesetzt
                </span>
                {q.data.summary.missingCritical.length > 0 ? (
                  <span className="ml-3 text-destructive">
                    Kritisch fehlend: {q.data.summary.missingCritical.join(", ")}
                  </span>
                ) : (
                  <span className="ml-3 text-emerald-600">Alle kritischen Variablen gesetzt.</span>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  Geprüft: {new Date(q.data.checkedAt).toLocaleString("de-DE")}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Neu prüfen
          </button>
        </div>
      </div>

      {/* Client-Variablen (VITE_*) */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Browser (VITE_*)</h2>
          <p className="text-xs text-muted-foreground">
            Werden ins Bundle eingebettet. Fehlen sie, zeigt die App den Konfigurationsfehler-Screen
            statt Login.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {CLIENT_VARS.map((v) => {
            const ok = !!v.value && v.value.length > 0;
            return (
              <li
                key={v.name}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-mono text-sm text-foreground">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{v.purpose}</div>
                </div>
                <StatusDot ok={ok} critical={v.critical} />
              </li>
            );
          })}
        </ul>
        {clientMissingCritical.length > 0 && (
          <div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
            Kritische Client-Variablen fehlen: {clientMissingCritical.map((v) => v.name).join(", ")}
          </div>
        )}
      </section>

      {/* Server-Variablen, gruppiert */}
      {q.data && (
        <div className="space-y-4">
          {(Object.keys(GROUP_LABEL) as ConfigVarStatus["group"][]).map((group) => {
            const rows = q.data.vars.filter((v) => v.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">{GROUP_LABEL[group]}</h2>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((v) => (
                    <li
                      key={v.name}
                      className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-foreground">{v.name}</div>
                        <div className="text-xs text-muted-foreground">{v.purpose}</div>
                        {v.present && v.hint && (
                          <div className="text-[11px] text-muted-foreground/80">{v.hint}</div>
                        )}
                      </div>
                      <StatusDot ok={v.present} critical={v.critical} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Hinweis: Diese Seite ist Admin-only. Server-Werte verlassen den Server nie — es wird
        ausschließlich <em>Anwesenheit</em> und ein formaler Hinweis (Länge, Host, Format)
        zurückgegeben.
      </p>

      {/* Sentry-Diagnose: Test-Fehler auslösen (nur Admin) */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Sentry-Diagnose</h2>
          <p className="text-xs text-muted-foreground">
            Löst bewusst je einen Testfehler im Browser bzw. auf dem Server aus, um zu prüfen, dass
            Sentry Meldungen samt Source-Maps und Tags empfängt. Die Fehler sind mit
            <code className="mx-1 font-mono">test=true</code>markiert und tauchen im Sentry-Projekt
            unter <em>Issues</em> auf.
          </p>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void fireClientTest()}
            disabled={testStatus.kind === "sending"}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            Client-Testfehler senden
          </button>
          <button
            type="button"
            onClick={() => void fireServerTest()}
            disabled={testStatus.kind === "sending"}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            Server-Testfehler senden
          </button>
          <div className="text-xs">
            {testStatus.kind === "idle" && <span className="text-muted-foreground">Bereit.</span>}
            {testStatus.kind === "sending" && (
              <span className="text-muted-foreground">
                Sende {testStatus.scope === "client" ? "Client" : "Server"}-Testfehler …
              </span>
            )}
            {testStatus.kind === "ok" && (
              <span className="text-emerald-600">
                {testStatus.scope === "client" ? "Client" : "Server"}-Testfehler ausgelöst um{" "}
                {new Date(testStatus.at).toLocaleTimeString("de-DE")}. In Sentry prüfen.
              </span>
            )}
            {testStatus.kind === "error" && (
              <span className="text-destructive">
                Fehler ({testStatus.scope}): {testStatus.message}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
