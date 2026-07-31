// Sektion „Trinkgeldpool" — extrahiert aus einstellungen.index.tsx im Rahmen
// von EIN1 (reine UI-Umgruppierung). Formular, State-Namen, Speichern-Flow
// und Texte sind unverändert; nur der Container-Ort hat sich geändert.
// Die org-settings-Mutation bleibt bewusst im Eltern-Container (die
// Server-Function updateOrgSettings erwartet alle fünf Felder gemeinsam),
// diese Sektion bekommt die relevanten Felder + Handler per Props.

import type { FormEvent } from "react";

type Props = {
  canEdit: boolean;
  tipRatePercent: string;
  setTipRatePercent: (value: string) => void;
  minHours: string;
  setMinHours: (value: string) => void;
  kitchenManualOnly: boolean;
  setKitchenManualOnly: (value: boolean) => void;
  // TG4 — Verteilmodus + Stichtag (Org-Standard).
  distributionMode: "hours" | "headcount";
  setDistributionMode: (value: "hours" | "headcount") => void;
  distributionModeFrom: string;
  setDistributionModeFrom: (value: string) => void;
  msg: string | null;
  err: string | null;
  isPending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TrinkgeldpoolSection({
  canEdit,
  tipRatePercent,
  setTipRatePercent,
  minHours,
  setMinHours,
  kitchenManualOnly,
  setKitchenManualOnly,
  distributionMode,
  setDistributionMode,
  distributionModeFrom,
  setDistributionModeFrom,
  msg,
  err,
  isPending,
  onSubmit,
}: Props) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Trinkgeldpool</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Regeln für Aufteilung und Teilnahme am Trinkgeldpool.
        </p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Küchen-Trinkgeldsatz (% vom Service-Bruttoumsatz)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={tipRatePercent}
            onChange={(e) => setTipRatePercent(e.target.value)}
            disabled={!canEdit}
            className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
          <span className="ml-2 text-xs text-muted-foreground">z. B. 2,00 = 2 %</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Mindeststunden pro Geschäftstag für Trinkgeldpool
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={minHours}
            onChange={(e) => setMinHours(e.target.value)}
            disabled={!canEdit}
            className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
          <span className="ml-2 text-xs text-muted-foreground">
            Tagessumme, inklusive Grenze (2,50 = 2:30 zählt mit, 2:29 nicht)
          </span>
        </label>

        <label className="flex items-start gap-3 pt-1">
          <input
            type="checkbox"
            checked={kitchenManualOnly}
            onChange={(e) => setKitchenManualOnly(e.target.checked)}
            disabled={!canEdit}
            className="mt-1 h-4 w-4 rounded border-input"
          />
          <span className="text-sm text-foreground">
            Küchentrinkgeld manuell verteilen (Stempelzeiten der Küche ignorieren)
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Wenn aktiv, fließt die Küche nur über manuell eingetragene Schichten (Start/Ende) in
              den Pool. Service bleibt unverändert über Stempelzeiten.
            </span>
          </span>
        </label>

        {/* TG4 — Kopfteilung: wirkt erst ab dem Stichtag, Historie bleibt „nach Stunden". */}
        <div className="space-y-2 rounded-md border border-input bg-muted/30 p-3">
          <span className="block text-xs font-medium text-muted-foreground">
            Verteilung innerhalb des Pools
          </span>
          <select
            value={distributionMode}
            onChange={(e) => setDistributionMode(e.target.value as "hours" | "headcount")}
            disabled={!canEdit}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="hours">Nach Stunden (bisher)</option>
            <option value="headcount">Kopfteilung (alle gleich)</option>
          </select>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Gültig ab</span>
            <input
              type="date"
              value={distributionModeFrom}
              onChange={(e) => setDistributionModeFrom(e.target.value)}
              disabled={!canEdit}
              className="w-44 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Ohne Startdatum bleibt es bei „Nach Stunden". Tage vor dem Startdatum werden nie
            rückwirkend umgestellt. Wer teilnimmt (Mindeststunden, Pool-Teilnahme), ändert sich
            nicht — nur die Höhe der Anteile.
          </p>
        </div>

        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}

        {canEdit && (
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "Speichern…" : "Speichern"}
          </button>
        )}
      </form>
    </section>
  );
}
