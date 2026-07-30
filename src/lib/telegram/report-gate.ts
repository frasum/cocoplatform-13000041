// TG3 — Entscheidungsregel des Tagesbericht-Schlussgates, herausgezogen für
// Testbarkeit. runDailyReportForOrg ist der einzige Aufrufer.

export type ReportGateDecision = {
  /** true → telegram_report_last_sent = heute schreiben */
  markSent: boolean;
  /** true → Sentry-Alarm „keine einzige Zustellung" */
  alarmNoDelivery: boolean;
};

export function decideReportGate(params: {
  skipGate: boolean;
  recipientsTotal: number;
  delivered: number;
}): ReportGateDecision {
  return {
    markSent: !params.skipGate && params.delivered > 0,
    alarmNoDelivery: params.recipientsTotal > 0 && params.delivered === 0,
  };
}
