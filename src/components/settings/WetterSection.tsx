// WX1 — Betriebs-Karte „Wetterdaten" (admin). Bewusst NUR Betrieb:
// Statuszeile, Sync-Knopf, Backfill-Bereich. Kein Chart, keine Auswertung —
// Analyse und Prognose sind PG1/PG2.
//
// Merkposten: Ein automatischer täglicher Sync (Cron) ist noch nicht gebaut;
// bis dahin trägt der Knopf hier den Anfang.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  backfillWeather,
  getWeatherStatus,
  syncWeather,
} from "@/lib/weather/weather.functions";
import { shiftIsoDate } from "@/lib/weather/weather-core";
import { formatIsoDate } from "@/lib/format-date";

const BACKFILL_START = "2026-02-16";

export function WetterSection() {
  const queryClient = useQueryClient();
  const callSync = useServerFn(syncWeather);
  const callBackfill = useServerFn(backfillWeather);

  const statusQ = useQuery({
    queryKey: ["admin", "weather-status"],
    queryFn: () => getWeatherStatus(),
  });

  const yesterday = shiftIsoDate(statusQ.data?.today ?? "2026-01-01", -1);
  const [from, setFrom] = useState(BACKFILL_START);
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "weather-status"] });
  };

  const syncM = useMutation({
    mutationFn: () => callSync(),
    onSuccess: async (r) => {
      setErr(null);
      setMsg(
        `Synchronisiert: ${r.forecastWritten} Vorhersage-Tage, ${r.archiveWritten} Archiv-Tage geschrieben, ${r.skipped} übersprungen.`,
      );
      await refresh();
    },
    onError: (e: unknown) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Synchronisierung fehlgeschlagen.");
    },
  });

  const backfillM = useMutation({
    mutationFn: () => callBackfill({ data: { from, to: to || yesterday } }),
    onSuccess: async (r) => {
      setErr(null);
      setMsg(
        `Backfill: ${r.written} von ${r.days} gelieferten Tagen geschrieben, ${r.skipped} übersprungen.`,
      );
      await refresh();
    },
    onError: (e: unknown) => {
      setMsg(null);
      setErr(e instanceof Error ? e.message : "Backfill fehlgeschlagen.");
    },
  });

  const busy = syncM.isPending || backfillM.isPending;
  const status = statusQ.data;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Wetterdaten</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tageswetter für München (Open-Meteo, DWD/ICON). Grundlage für die spätere
          Umsatzprognose — hier werden die Daten nur gesammelt, nicht ausgewertet.
        </p>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        {statusQ.isLoading ? (
          <span>Status wird geladen …</span>
        ) : status && status.dayCount > 0 ? (
          <span>
            <strong className="text-foreground">{status.dayCount}</strong> Tage gespeichert (
            {formatIsoDate(status.oldest ?? "")} – {formatIsoDate(status.newest ?? "")}), davon{" "}
            <strong className="text-foreground">{status.forecastCount}</strong> als Vorhersage.
          </span>
        ) : (
          <span>Noch keine Wetterdaten gespeichert.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => syncM.mutate()}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {syncM.isPending ? "Synchronisiere …" : "Jetzt synchronisieren"}
        </button>
        <span className="text-xs text-muted-foreground">
          Holt die Vorhersage (heute bis +16 Tage) und die gemessenen Werte der letzten 10 Tage.
        </span>
      </div>

      <div className="space-y-3 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-medium text-foreground">Backfill (Archiv)</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Von</span>
            <input
              type="date"
              value={from}
              max={yesterday}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Bis</span>
            <input
              type="date"
              value={to || yesterday}
              max={yesterday}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => backfillM.mutate()}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
          >
            {backfillM.isPending ? "Lade Archiv …" : "Backfill starten"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Gemessene Werte überschreiben vorhandene Vorhersagen. Vorhersagen überschreiben niemals
          gemessene Werte.
        </p>
      </div>

      {msg && <p className="text-xs text-foreground">{msg}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </section>
  );
}
