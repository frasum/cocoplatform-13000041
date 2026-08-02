import { describe, expect, it } from "vitest";
import { noticesTone } from "./notices-tone";
import type { EventNotice } from "./event-notices";

function n(impact: EventNotice["impact"]): EventNotice {
  return { kind: "running", name: impact, impact, provisional: false, dayIndex: 1, dayCount: 1 };
}

describe("noticesTone", () => {
  it("leere Liste ergibt info", () => {
    expect(noticesTone([])).toBe("info");
  });

  it("nur Ferien (keine Event-Notices) ergibt info", () => {
    expect(noticesTone([])).toBe("info");
  });

  it("mittel und mittel_hoch bleiben info", () => {
    expect(noticesTone([n("mittel"), n("mittel_hoch")])).toBe("info");
  });

  it("mittel + hoch ergibt warning", () => {
    expect(noticesTone([n("mittel"), n("hoch")])).toBe("warning");
  });

  it("irgendwo sehr_hoch ergibt danger", () => {
    expect(noticesTone([n("mittel"), n("hoch"), n("sehr_hoch")])).toBe("danger");
    expect(noticesTone([n("sehr_hoch"), n("mittel")])).toBe("danger");
  });
});
