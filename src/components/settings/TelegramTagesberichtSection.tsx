// Sektion „Telegram-Tagesbericht" (TG2) — extrahiert im Rahmen von EIN1.
// Vorher als TelegramDailyReportSection direkt in einstellungen.index.tsx;
// Verhalten und Texte 1:1 unverändert.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listLocations } from "@/lib/admin/locations.functions";
import {
  getTelegramReportSettings,
  updateTelegramReportSettings,
  setDailyReportRecipient,
  setSwapAlertsRecipient,
  sendTestReport,
} from "@/lib/telegram/telegram-report.functions";

export function TelegramTagesberichtSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const callUpdate = useServerFn(updateTelegramReportSettings);
  const callToggleRecipient = useServerFn(setDailyReportRecipient);
  const callToggleSwapAlerts = useServerFn(setSwapAlertsRecipient);
  const callTest = useServerFn(sendTestReport);

  const settingsQ = useQuery({
    queryKey: ["admin", "telegram-report-settings"],
    queryFn: () => getTelegramReportSettings(),
  });
  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => listLocations(),
  });

  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(7);
  const [flags, setFlags] = useState({
    umsatz: true,
    gaeste: true,
    kontrolle: true,
    kellner: true,
    kueche: true,
    notizen: true,
  });
  const [excluded, setExcluded] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQ.data) return;
    setEnabled(settingsQ.data.enabled);
    setHour(settingsQ.data.hour);
    setFlags({
      umsatz: settingsQ.data.flags.umsatz,
      gaeste: settingsQ.data.flags.gaeste,
      kontrolle: settingsQ.data.flags.kontrolle,
      kellner: settingsQ.data.flags.kellner,
      kueche: settingsQ.data.flags.kueche,
      notizen: settingsQ.data.flags.notizen,
    });
    setExcluded(settingsQ.data.flags.excludedLocationIds);
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      callUpdate({
        data: {
          enabled,
          hour,
          flags: { ...flags, excludedLocationIds: excluded },
        },
      }),
    onSuccess: async () => {
      setMsg("Gespeichert.");
      setErr(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "telegram-report-settings"] });
    },
    onError: (e: unknown) => {
      setErr(e instanceof Error ? e.message : "Fehler.");
      setMsg(null);
    },
  });

  const recipientMut = useMutation({
    mutationFn: (v: { staffId: string; receives: boolean }) => callToggleRecipient({ data: v }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "telegram-report-settings"] }),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const swapAlertsMut = useMutation({
    mutationFn: (v: { staffId: string; receives: boolean }) => callToggleSwapAlerts({ data: v }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "telegram-report-settings"] }),
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const testMut = useMutation({
    mutationFn: () => callTest({}),
    onSuccess: (res) => {
      if ("skipped" in res) {
        setMsg(`Testbericht übersprungen: ${res.skipped}.`);
      } else {
        const base = `Testbericht: ${res.recipientsDelivered} von ${res.recipientsTotal} Empfängern zugestellt (${res.locationsTotal} Standorte, Bericht für ${res.businessDate}).`;
        // TG4 — Ursache direkt im UI, damit der Grund ohne Sentry sichtbar ist.
        const reasons = res.failures.map((f) => `${f.recipient}: ${f.reason}`).join("; ");
        setMsg(reasons ? `${base} Zustellung fehlgeschlagen: ${reasons}` : base);
      }
      setErr(null);
    },
    onError: (e: unknown) => {
      setErr(e instanceof Error ? e.message : "Fehler.");
      setMsg(null);
    },
  });

  if (settingsQ.isLoading)
    return (
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Lade Tagesbericht-Einstellungen…</p>
      </section>
    );

  const recipients = settingsQ.data?.recipients ?? [];
  const locations = locationsQ.data ?? [];

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Telegram-Tagesbericht</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Automatischer Tagesbericht des Vortags an ausgewählte verknüpfte Telegram-Konten. Der Cron
          prüft stündlich — gesendet wird zur eingestellten Stunde (Europe/Berlin), höchstens einmal
          pro Tag.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={!canEdit}
          className="h-4 w-4"
        />
        Tagesbericht aktiv
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Uhrzeit (0–23, Europe/Berlin)
        </span>
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          disabled={!canEdit}
          className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Inhalte</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {(
            [
              ["umsatz", "Umsatz"],
              ["gaeste", "Gäste"],
              ["kontrolle", "Kontrolle"],
              ["kellner", "Kellner"],
              ["kueche", "Küche"],
              ["notizen", "Notizen"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))}
                disabled={!canEdit}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {locations.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Standorte ausschließen</span>
          <div className="flex flex-wrap gap-2">
            {locations.map((l) => {
              const isExcluded = excluded.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    setExcluded((prev) =>
                      prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                    )
                  }
                  className={
                    "rounded-full border px-3 py-1 text-xs transition disabled:opacity-60 " +
                    (isExcluded
                      ? "border-destructive bg-destructive/10 text-destructive line-through"
                      : "border-input bg-background text-foreground hover:bg-muted")
                  }
                >
                  {l.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Durchgestrichene Standorte werden im Bericht komplett weggelassen.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Empfänger (verknüpfte Telegram-Konten)
        </span>
        {recipients.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch keine Telegram-Konten verknüpft. Mitarbeiter verknüpfen sich unter „Meine Daten".
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {recipients.map((r) => (
              <li
                key={r.staffId}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div className="text-foreground">{r.displayName}</div>
                  {r.telegramUsername && (
                    <div className="text-xs text-muted-foreground">@{r.telegramUsername}</div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={r.receivesDailyReport}
                    disabled={!canEdit || recipientMut.isPending}
                    onChange={(e) =>
                      recipientMut.mutate({ staffId: r.staffId, receives: e.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  erhält Tagesbericht
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={r.receivesSwapAlerts}
                    disabled={!canEdit || swapAlertsMut.isPending}
                    onChange={(e) =>
                      swapAlertsMut.mutate({ staffId: r.staffId, receives: e.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  erhält Tausch-Benachrichtigungen
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saveMut.isPending}
            onClick={() => {
              setMsg(null);
              setErr(null);
              saveMut.mutate();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMut.isPending ? "Speichern…" : "Einstellungen speichern"}
          </button>
          <button
            type="button"
            disabled={testMut.isPending}
            onClick={() => {
              setMsg(null);
              setErr(null);
              testMut.mutate();
            }}
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {testMut.isPending ? "Sende…" : "Testbericht jetzt senden"}
          </button>
        </div>
      )}
    </section>
  );
}
