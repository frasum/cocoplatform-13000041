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
};

export function ArbeitzeitSection({
  canEdit,
  pausenBezahlt,
  msg,
  err,
  isPending,
  onChange,
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
                  Die Änderung gilt organisationsweit und wirkt rückwirkend auf alle Perioden,
                  auch auf bereits abgeschlossene.
                </p>
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