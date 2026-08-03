// CH1 — lokale Fehlergrenze um eine einzelne Karte.
//
// Ein Wurf in der Karte (z. B. inkonsistente Kanalzuordnung) darf nicht mehr
// die gesamte Kassen-Route abreißen. Statt Route-Crash: kompakte
// Fehlerdarstellung an der Stelle der Karte, der Rest der Seite
// (Kellner-Abrechnungen, Kopfzeile) bleibt bedienbar. Der Fehler geht
// zusätzlich an Sentry (Lovable-Reporting-Bridge).

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

type Props = {
  children: ReactNode;
  /** Kurzer Bezeichner der Karte, landet im Fehlerkontext. */
  label: string;
  /** Erste Zeile der Fehlerdarstellung. */
  title?: string;
};

type State = { error: Error | null };

export class CardErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    reportLovableError(error, { card: this.props.label, componentStack: info.componentStack });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <div className="font-medium text-destructive">
          {this.props.title ?? "Kanalzuordnung inkonsistent — Seite neu laden."}
        </div>
        <div className="mt-1 font-mono text-xs break-words text-muted-foreground">
          {error.message}
        </div>
      </div>
    );
  }
}
