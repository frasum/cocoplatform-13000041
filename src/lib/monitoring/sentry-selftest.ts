// SE1 — Gemeinsame Fehlerklasse für die Sentry-Selbstprobe.
//
// Bewusst EINE Klasse für Client und Server, damit beide Seiten in Sentry
// unter demselben Typ gruppieren und in der Issue-Liste sofort als Probe
// erkennbar sind. Vorher war die Server-Seite `SentryTestError`, die
// Client-Seite ein nacktes `Error` — zwei Probefehler, die nicht als
// zusammengehörig lesbar waren.

export class SentryTestError extends Error {
  constructor(side: "server" | "client", triggeredAt: string) {
    super(
      `Sentry-Selbsttest (${side === "server" ? "Server" : "Client"}) — ausgelöst ${triggeredAt}`,
    );
    this.name = "SentryTestError";
  }
}

/** Tag-Wert, unter dem beide Proben in Sentry filterbar sind. */
export const SENTRY_PROBE_TAG = "selftest";
