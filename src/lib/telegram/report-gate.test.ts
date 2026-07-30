import { describe, expect, it } from "vitest";
import { decideReportGate } from "./report-gate";

describe("decideReportGate", () => {
  it("Cron-Pfad, alle zugestellt → markieren, kein Alarm", () => {
    expect(decideReportGate({ skipGate: false, recipientsTotal: 5, delivered: 5 })).toEqual({
      markSent: true,
      alarmNoDelivery: false,
    });
  });

  it("Cron-Pfad, Totalausfall → nicht markieren, Alarm", () => {
    expect(decideReportGate({ skipGate: false, recipientsTotal: 5, delivered: 0 })).toEqual({
      markSent: false,
      alarmNoDelivery: true,
    });
  });

  it("Cron-Pfad, Teilzustellung → markieren, kein Alarm", () => {
    expect(decideReportGate({ skipGate: false, recipientsTotal: 5, delivered: 3 })).toEqual({
      markSent: true,
      alarmNoDelivery: false,
    });
  });

  it("Manueller Pfad, Totalausfall → Alarm auch bei „Jetzt senden"", () => {
    expect(decideReportGate({ skipGate: true, recipientsTotal: 5, delivered: 0 })).toEqual({
      markSent: false,
      alarmNoDelivery: true,
    });
  });

  it("Manueller Pfad, Erfolg → markiert nie", () => {
    expect(decideReportGate({ skipGate: true, recipientsTotal: 5, delivered: 5 })).toEqual({
      markSent: false,
      alarmNoDelivery: false,
    });
  });

  it("Keine Empfänger → kein Alarm", () => {
    expect(decideReportGate({ skipGate: false, recipientsTotal: 0, delivered: 0 })).toEqual({
      markSent: false,
      alarmNoDelivery: false,
    });
  });
});