// TG1 — Standort-Editor: Trinkgeld (Service-Pool + Overrides).
// Leere Override-Felder = geerbter Org-Standard (als Placeholder sichtbar).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrgTipDefaults, updateLocationTipSettings } from "@/lib/admin/locations.functions";

type Props = {
  locationId: string;
  initial: {
    tipServicePoolEnabled: boolean;
    kitchenTipRateOverride: number | null;
    tipPoolMinHoursOverride: number | null;
    kitchenManualOnlyOverride: boolean | null;
    // TG4 — Modus + Stichtag erben als Paar (siehe tip-settings.ts).
    tipDistributionModeOverride: "hours" | "headcount" | null;
    tipDistributionModeFromOverride: string | null;
  };
  onSaved?: () => void;
};

function parsePctToRate(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("Ungültiger Prozentwert.");
  const r = n / 100;
  if (r < 0 || r > 0.2) throw new Error("Küchen-Abgabe muss zwischen 0 und 20 % liegen.");
  return r;
}
function parseHours(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 24) throw new Error("Stunden 0–24.");
  return n;
}

export function LocationTipPoolPanel({ locationId, initial, onSaved }: Props) {
  const qc = useQueryClient();
  const callSave = useServerFn(updateLocationTipSettings);
  const callDefaults = useServerFn(getOrgTipDefaults);

  const defaultsQ = useQuery({
    queryKey: ["org-tip-defaults"],
    queryFn: () => callDefaults(),
    staleTime: 60_000,
  });

  const [pool, setPool] = useState<boolean>(initial.tipServicePoolEnabled);
  const [rateStr, setRateStr] = useState<string>(
    initial.kitchenTipRateOverride == null
      ? ""
      : String((initial.kitchenTipRateOverride * 100).toFixed(2)).replace(/\.?0+$/, ""),
  );
  const [minHStr, setMinHStr] = useState<string>(
    initial.tipPoolMinHoursOverride == null ? "" : String(initial.tipPoolMinHoursOverride),
  );
  const [manual, setManual] = useState<"" | "true" | "false">(
    initial.kitchenManualOnlyOverride == null
      ? ""
      : initial.kitchenManualOnlyOverride
        ? "true"
        : "false",
  );
  const [mode, setMode] = useState<"" | "hours" | "headcount">(
    initial.tipDistributionModeOverride ?? "",
  );
  const [modeFrom, setModeFrom] = useState<string>(initial.tipDistributionModeFromOverride ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setPool(initial.tipServicePoolEnabled);
  }, [initial.tipServicePoolEnabled]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const rate = parsePctToRate(rateStr);
      const hrs = parseHours(minHStr);
      const km = manual === "" ? null : manual === "true";
      const modeOverride = mode === "" ? null : mode;
      const modeFromOverride = modeOverride === null || modeFrom.trim() === "" ? null : modeFrom;
      if (modeOverride === "headcount" && modeFromOverride === null) {
        throw new Error("Kopfteilung braucht ein Startdatum (keine rückwirkende Umstellung).");
      }
      await callSave({
        data: {
          locationId,
          tipServicePoolEnabled: pool,
          kitchenTipRateOverride: rate,
          tipPoolMinHoursOverride: hrs,
          kitchenManualOnlyOverride: km,
          tipDistributionModeOverride: modeOverride,
          tipDistributionModeFromOverride: modeFromOverride,
        },
      });
    },
    onSuccess: () => {
      setMsg("Gespeichert.");
      qc.invalidateQueries({ queryKey: ["locations"] });
      onSaved?.();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const orgRatePct =
    defaultsQ.data == null ? "…" : `${(defaultsQ.data.kitchenTipRate * 100).toFixed(2)} %`;
  const orgHours = defaultsQ.data == null ? "…" : String(defaultsQ.data.tipPoolMinHours);
  const orgManual = defaultsQ.data == null ? "…" : defaultsQ.data.kitchenManualOnly ? "an" : "aus";
  const orgMode =
    defaultsQ.data == null
      ? "…"
      : defaultsQ.data.tipDistributionMode === "headcount"
        ? `Kopfteilung ab ${defaultsQ.data.tipDistributionModeFrom ?? "—"}`
        : "nach Stunden";

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="mt-3 space-y-3 rounded-md border border-input bg-muted/30 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trinkgeld</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={pool}
          onChange={(e) => setPool(e.target.checked)}
          className="h-4 w-4"
        />
        <span>Service-Pool aktiv (Trinkgeld wird geteilt)</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Aus = jeder Kellner behält sein eigenes Trinkgeld; die Küchen-Abgabe wird weiterhin
        prozentual berechnet.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Küchen-Abgabe %</span>
          <input
            value={rateStr}
            onChange={(e) => setRateStr(e.target.value)}
            placeholder={`Standard: ${orgRatePct}`}
            inputMode="decimal"
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Mindeststunden pro Tag</span>
          <input
            value={minHStr}
            onChange={(e) => setMinHStr(e.target.value)}
            placeholder={`Standard: ${orgHours}`}
            inputMode="decimal"
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Küche nur manuell</span>
          <select
            value={manual}
            onChange={(e) => setManual(e.target.value as "" | "true" | "false")}
            className={inputCls}
          >
            <option value="">Standard: {orgManual}</option>
            <option value="true">an</option>
            <option value="false">aus</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Verteilung im Pool</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "" | "hours" | "headcount")}
            className={inputCls}
          >
            <option value="">Standard: {orgMode}</option>
            <option value="hours">nach Stunden</option>
            <option value="headcount">Kopfteilung</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Gültig ab (nur mit eigenem Modus)</span>
          <input
            type="date"
            value={modeFrom}
            onChange={(e) => setModeFrom(e.target.value)}
            disabled={mode === ""}
            className={`${inputCls} disabled:opacity-60`}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Trinkgeld speichern
        </button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
