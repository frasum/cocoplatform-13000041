// Admin-only Config-Check-Seite: zeigt Präsenz-Status aller relevanten
// Server- und Client-Umgebungsvariablen, damit Config-Probleme in
// Produktion sofort sichtbar sind. Werte werden NICHT angezeigt.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getProductionConfigStatus,
  triggerSentryServerProbe,
  type ConfigVarStatus,
} from "@/lib/admin/config-check.functions";
import { captureClientError } from "@/lib/monitoring/sentry-client";
import { SentryTestError, SENTRY_PROBE_TAG } from "@/lib/monitoring/sentry-selftest";

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
  const callServerProbe = useServerFn(triggerSentryServerProbe);
  const q = useQuery({
    queryKey: ["admin", "config-check"],
    queryFn: () => fetchStatus(),
    refetchOnWindowFocus: false,
  });

  type ProbeStatus =
    | { kind: "idle" }
    | { kind: "sending"; scope: "client" | "server" }
    | { kind: "ok"; scope: "client" | "server"; at: string }
    | { kind: "error"; scope: "client" | "server"; message: string };
  const [clientProbe, setClientProbe] = useState<ProbeStatus>({ kind: "idle" });
  const [serverProbe, setServerProbe] = useState<ProbeStatus>({ kind: "idle" });
  // Doppelklick-Bremse: 5 s pro Knopf.
  const [clientCooldownUntil, setClientCooldownUntil] = useState<number>(0);
  const [serverCooldownUntil, setServerCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (clientCooldownUntil <= now && serverCooldownUntil <= now) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [clientCooldownUntil, serverCooldownUntil, now]);

  const sentryDsnVar = q.data?.vars.find(
    (v) => v.name === "SENTRY_DSN" && v.group === "monitoring",
  );
  const dsnPresent = sentryDsnVar?.present ?? false;
  const clientBusy = clientProbe.kind === "sending" || clientCooldownUntil > now;
  const serverBusy = serverProbe.kind === "sending" || serverCooldownUntil > now;

  async function fireClientProbe() {
    const triggeredAt = new Date().toISOString();
    setClientProbe({ kind: "sending", scope: "client" });
    try {
      await captureClientError(new SentryTestError("client", triggeredAt), {
        probe: SENTRY_PROBE_TAG,
      });
      setClientProbe({ kind: "ok", scope: "client", at: triggeredAt });
    } catch (e) {
      setClientProbe({
        kind: "error",
        scope: "client",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setClientCooldownUntil(Date.now() + 5000);
    }
  }

  async function fireServerProbe() {
    setServerProbe({ kind: "sending", scope: "server" });
    try {
      const res = await callServerProbe();
      setServerProbe({ kind: "ok", scope: "server", at: res.triggeredAt });
    } catch (e) {
      setServerProbe({
        kind: "error",
        scope: "server",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setServerCooldownUntil(Date.now() + 5000);
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

      {/* SE1 — Monitoring-Selbsttest (nur Admin) */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Monitoring-Selbsttest</h2>
          <p className="text-xs text-muted-foreground">
            Löst absichtlich je einen Fehler im Browser und auf dem Server aus und schickt ihn an
            Sentry. Beweist nach jedem Deploy, dass die Fehlermeldung wirklich ankommt. Erzeugt zwei
            Einträge im Sentry-Dashboard — beide mit dem Tag{" "}
            <code className="font-mono">probe: {SENTRY_PROBE_TAG}</code>.
          </p>
        </div>
        {q.data && !dsnPresent && (
          <div className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-800">
            SENTRY_DSN ist nicht gesetzt — die Probe würde ins Leere laufen.
          </div>
        )}
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void fireClientProbe()}
                disabled={!dsnPresent || clientBusy}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                Client-Probe auslösen
              </button>
              <ProbeLine status={clientProbe} />
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => void fireServerProbe()}
                disabled={!dsnPresent || serverBusy}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                Server-Probe auslösen
              </button>
              <ProbeLine status={serverProbe} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProbeLine({
  status,
}: {
  status:
    | { kind: "idle" }
    | { kind: "sending"; scope: "client" | "server" }
    | { kind: "ok"; scope: "client" | "server"; at: string }
    | { kind: "error"; scope: "client" | "server"; message: string };
}) {
  if (status.kind === "idle") return <span className="text-xs text-muted-foreground">Bereit.</span>;
  if (status.kind === "sending")
    return <span className="text-xs text-muted-foreground">Sende Probe …</span>;
  if (status.kind === "ok") {
    const local = new Date(status.at).toLocaleString("de-DE");
    return (
      <span className="text-xs text-emerald-600">
        Abgesetzt: <code className="font-mono">{status.at}</code> ({local})
      </span>
    );
  }
  return <span className="text-xs text-destructive">Fehler: {status.message}</span>;
}
