// KA3 — Fachliche Ablehnung, kein Serverfehler.
//
// Hintergrund (Sentry ce08327f…, 05.08.2026): Die gewollte Ablehnung
// „Standort geschlossen … Anlage an geschlossenen Tagen nicht möglich"
// aus assertDayOpen lief als Error nach Sentry und löste High-Priority-
// Mails aus. Eine fachliche Ablehnung verwässert den Alarmkanal.
//
// Instanzen dieser Klasse werden vom zentralen Sentry-Wrapper der
// Server-Functions NICHT als Exception erfasst (siehe
// `isMonitoringSuppressed`), die Meldung erreicht die UI unverändert.
//
// Umstellung erfolgt bewusst schrittweise: aktuell nur `assertDayOpen`.
export class ValidationRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationRejection";
  }
}
