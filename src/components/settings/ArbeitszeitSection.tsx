// Sektion „Arbeitszeit" — PB1 (Runde 1 von 3).
// Einziger Eintrag: „Pausen bezahlt" (Ja/Nein). Reine Anzeige +
// Bestätigungsdialog. Wirkung auf Berechnungen: keine — die Verdrahtung
// erfolgt in PB2. Diese Sektion darf nirgends anders gelesen werden.

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  canEdit: boolean;
  pausenBezahlt: boolean;
  msg: string | null;
  err: string | null;
  isPending: boolean;
  onChange: (next: boolean) => void;
  /** PB2 — Vorschau der aktuellen Periode: Σ Pausenstunden + Anzahl
   *  Mitarbeiter mit erfassten Pausen. Erscheint als Delta-Hinweis im
   *  Bestätigungsdialog beim Umschalten. Optional — bei `null` wird die
   *  Zeile nicht gerendert. */
  breakSummary?: {
    totalBreakHours: number;
    staffCount: number;
    periodLabel: string | null;
  } | null;
};

export function ArbeitszeitSection({
  canEdit,
  pausenBezahlt,
  msg,
  err,
  isPending,
  onChange,
  breakSummary,
}: Props) {
  const [pending, setPending] = useState<boolean | null>(null);
  const open = pending !== null;

  function requestChange(next: boolean) {
    if (!canEdit || next === pausenBezahlt) return;
    setPending(next);
  }

  function confirm() {
    if (pending === null) return;
    const next = pending;
    setPending(null);
    onChange(next);
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Arbeitszeit</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Organisationsweite Regeln für die Arbeitszeit­erfassung.
        </p>
      </div>

      <details className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Wie werden Pausen gesetzlich berechnet?
        </summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">ArbZG § 4 — Mindestpausen:</span> bis{" "}
            <span className="font-medium text-foreground">6 h</span> keine Pflichtpause; mehr als{" "}
            <span className="font-medium text-foreground">6 bis 9 h</span> mindestens{" "}
            <span className="font-medium text-foreground">30 min</span>; mehr als{" "}
            <span className="font-medium text-foreground">9 h</span> mindestens{" "}
            <span className="font-medium text-foreground">45 min</span>. Aufteilung in Abschnitte
            von je mindestens 15 min zulässig. Nicht länger als 6 h am Stück ohne Pause.
          </p>
          <p>
            <span className="font-medium text-foreground">Vergütung:</span> Das ArbZG regelt nur die
            Dauer, nicht die Bezahlung. Ruhepausen sind gesetzlich grundsätzlich{" "}
            <span className="font-medium text-foreground">unbezahlt</span> (§ 611a BGB). Bezahlung
            nur, wenn Tarif-, Betriebs- oder Arbeitsvertrag es vorsieht — oder wenn es keine echte
            Pause, sondern eine Arbeitsunterbrechung (Wartezeit, Bereitschaft am Arbeitsplatz) ist.
          </p>
          <p>
            <span className="font-medium text-foreground">Gastronomie-Praxis:</span> Kein
            einschlägiger Flächentarifvertrag mit Pausenvergütungspflicht. Beide Einstellungen sind
            zulässig; die Wahl trifft der Arbeitgeber.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Steuerlicher Hinweis (SFN, § 3b EStG):
            </span>{" "}
            SFN-Zuschläge sind nur auf tatsächlich geleistete Arbeitsstunden steuerfrei. Auf
            bezahlte Pausenminuten entfallende Zuschlagsanteile sind streng genommen nicht §
            3b-fähig; SFN-Töpfe werden daher unabhängig vom Schalter stets aus Netto-Minuten
            gebildet.
          </p>
          <details className="rounded-md border border-border bg-background/60 p-3">
            <summary className="cursor-pointer text-xs font-medium text-foreground">
              Beispiel Ann Juni 2026 (ohne erfasste Pausen → gesetzliche Mindestpause)
            </summary>
            <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                Ann (Patchari Chaisiri) hat im Juni 2026{" "}
                <span className="font-medium text-foreground">23 Schichten</span> mit insgesamt{" "}
                <span className="font-medium text-foreground">167,30 h</span> Anwesenheit
                gearbeitet. In allen 23 Schichten ist{" "}
                <span className="font-medium text-foreground">
                  keine Pause erfasst (break_minutes = 0)
                </span>
                . Für dieses Beispiel wird pro Schicht die{" "}
                <span className="font-medium text-foreground">ArbZG-Mindestpause</span> fiktiv
                angesetzt: 0 min bei ≤ 6 h, 30 min bei &gt; 6 bis 9 h, 45 min bei &gt; 9 h. 22 der
                23 Schichten liegen zwischen 6 und 9 h (die 23. Schicht am 14.06. dauert nur 1,5 h
                und bekommt keine fiktive Pause). Keine Schicht ist länger als 9 h.
              </p>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Kennzahl</th>
                      <th className="px-2 py-1.5 text-right font-medium">Ja (heute)</th>
                      <th className="px-2 py-1.5 text-right font-medium">Nein (PB2)</th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr:not(:last-child)]:border-b [&_tr]:border-border">
                    <tr>
                      <td className="px-2 py-1.5">Bruttostunden (Anwesenheit)</td>
                      <td className="px-2 py-1.5 text-right">167,30 h</td>
                      <td className="px-2 py-1.5 text-right">167,30 h</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1.5">Fiktive ArbZG-Pause (22 × 30 min)</td>
                      <td className="px-2 py-1.5 text-right">—</td>
                      <td className="px-2 py-1.5 text-right">11,00 h</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1.5">Vergütungsstunden</td>
                      <td className="px-2 py-1.5 text-right">167,30 h</td>
                      <td className="px-2 py-1.5 text-right">156,30 h</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1.5">Grundlohn (× 14,00 €/h)</td>
                      <td className="px-2 py-1.5 text-right">2.342,20 €</td>
                      <td className="px-2 py-1.5 text-right">2.188,20 €</td>
                    </tr>
                    <tr className="bg-muted/40">
                      <td className="px-2 py-1.5 font-medium text-foreground">Differenz</td>
                      <td className="px-2 py-1.5 text-right" />
                      <td className="px-2 py-1.5 text-right font-medium text-foreground">
                        −154,00 €
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Zusätzlich sinken die <span className="font-medium text-foreground">SFN-Töpfe</span>{" "}
                (Abend, Nacht, Sonntag) proportional um denselben Faktor (11,00 h ÷ 167,30 h ≈ 6,58
                %), weil die fiktive Pause anteilig auf alle Zeitfenster verteilt wird. Der
                Netto-Effekt für den Mitarbeiter ist entsprechend kleiner als die 154 € brutto
                suggerieren.
              </p>
              <p>
                <span className="font-medium text-foreground">Regel:</span> Bei „Pausen bezahlt =
                Nein" werden erfasste Pausenminuten von den Vergütungsstunden abgezogen; bei „Ja"
                fließen sie in die Vergütungsstunden ein. SFN-Töpfe bleiben in beiden Stellungen
                netto.
              </p>
            </div>
          </details>
        </div>
      </details>

      <fieldset className="space-y-3" disabled={!canEdit || isPending}>
        <legend className="text-sm font-medium text-foreground">Pausen bezahlt</legend>

        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="pausen-bezahlt"
            className="mt-1 h-4 w-4"
            checked={pausenBezahlt === true}
            onChange={() => requestChange(true)}
            disabled={!canEdit || isPending}
          />
          <span className="text-sm text-foreground">
            Ja
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Pausenzeit wird vergütet (Vergütungsstunden brutto).
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="radio"
            name="pausen-bezahlt"
            className="mt-1 h-4 w-4"
            checked={pausenBezahlt === false}
            onChange={() => requestChange(false)}
            disabled={!canEdit || isPending}
          />
          <span className="text-sm text-foreground">
            Nein
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Pausenzeit wird abgezogen (netto).
            </span>
          </span>
        </label>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Gilt für die gesamte Organisation und wirkt rückwirkend auf alle Perioden, auch auf bereits
        abgeschlossene. Änderung nur durch Admin.
      </p>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}

      <AlertDialog open={open} onOpenChange={(o) => (!o ? setPending(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pausenberechnung ändern?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Aktuell: <strong>{pausenBezahlt ? "Ja" : "Nein"}</strong> —{" "}
                  {pausenBezahlt
                    ? "Pausenzeit wird vergütet (brutto)."
                    : "Pausenzeit wird abgezogen (netto)."}
                </p>
                <p>
                  Neu: <strong>{pending ? "Ja" : "Nein"}</strong> —{" "}
                  {pending
                    ? "Pausenzeit wird vergütet (brutto)."
                    : "Pausenzeit wird abgezogen (netto)."}
                </p>
                <p>
                  Die Änderung gilt organisationsweit und wirkt rückwirkend auf alle Perioden, auch
                  auf bereits abgeschlossene.
                </p>
                {breakSummary && breakSummary.totalBreakHours > 0 && (
                  <p className="rounded-md bg-muted/50 p-2 text-xs text-foreground">
                    Δ laufende Periode
                    {breakSummary.periodLabel ? ` (${breakSummary.periodLabel})` : ""}:{" "}
                    <strong>
                      Σ {breakSummary.totalBreakHours.toString().replace(".", ",")} h
                    </strong>{" "}
                    über <strong>{breakSummary.staffCount}</strong> Mitarbeiter
                    {pausenBezahlt && !pending
                      ? " würden bei „Nein" von den Vergütungsstunden abgezogen."
                      : !pausenBezahlt && pending
                        ? " würden bei „Ja" zusätzlich in die Vergütungsstunden fließen."
                        : "."}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Ändern</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
