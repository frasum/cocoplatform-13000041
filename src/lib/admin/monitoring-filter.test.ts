// SE1 — Filter-Invariante: isMonitoringSuppressed
//
// Diese Tests sind blockierend. Der wichtigste: SentryTestError wird NICHT
// unterdrückt. Ein Kanarienvogel, den eine spätere Filter-Erweiterung still
// stummschalten kann, ist schlechter als keiner.

import { describe, it, expect } from "vitest";
import { isMonitoringSuppressed } from "./admin-call";
import { ForbiddenError } from "./role-guard";
import { PreviewReadOnlyError, PREVIEW_READ_ONLY_MESSAGE } from "./impersonation";
import { SentryTestError } from "@/lib/monitoring/sentry-selftest";

describe("isMonitoringSuppressed", () => {
  it("unterdrückt ForbiddenError (Fachfehler, kein Alarm)", () => {
    expect(isMonitoringSuppressed(new ForbiddenError("nein"))).toBe(true);
  });

  it("unterdrückt PoolHoursWarningError anhand des name-Felds", () => {
    const err = new Error("Warn");
    err.name = "PoolHoursWarningError";
    expect(isMonitoringSuppressed(err)).toBe(true);
  });

  it("unterdrückt PreviewReadOnlyError (Vorschau ist read-only, IM1)", () => {
    const err = new PreviewReadOnlyError();
    expect(err.message).toBe(PREVIEW_READ_ONLY_MESSAGE);
    expect(isMonitoringSuppressed(err)).toBe(true);
  });

  it("unterdrückt SentryTestError NICHT (Kanarienvogel-Sicherung)", () => {
    expect(isMonitoringSuppressed(new SentryTestError("server", "2026-07-29T00:00:00.000Z"))).toBe(
      false,
    );
    expect(isMonitoringSuppressed(new SentryTestError("client", "2026-07-29T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("unterdrückt generische Error nicht", () => {
    expect(isMonitoringSuppressed(new Error("boom"))).toBe(false);
  });

  it("lässt Nicht-Error-Werte nicht durchrutschen", () => {
    expect(isMonitoringSuppressed("boom")).toBe(false);
    expect(isMonitoringSuppressed(null)).toBe(false);
    expect(isMonitoringSuppressed(undefined)).toBe(false);
  });
});
