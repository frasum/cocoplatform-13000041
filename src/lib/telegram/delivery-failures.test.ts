import { describe, expect, it } from "vitest";
import {
  describeNetworkFailure,
  describeTelegramResponse,
  formatFailures,
  maskChatId,
  normalizeSendReason,
} from "./delivery-failures";

describe("maskChatId", () => {
  it("zeigt nur die letzten 4 Stellen", () => {
    expect(maskChatId(123456789)).toBe("…6789");
    expect(maskChatId("987654321")).toBe("…4321");
  });
  it("kurze Werte bleiben kurz, leere werden ‚unbekannt'", () => {
    expect(maskChatId("42")).toBe("…42");
    expect(maskChatId(null)).toBe("unbekannt");
    expect(maskChatId("")).toBe("unbekannt");
  });
});

describe("describeTelegramResponse", () => {
  it("401 invalid token", () => {
    expect(
      describeTelegramResponse(401, '{"ok":false,"error_code":401,"description":"Unauthorized"}'),
    ).toBe("401 – Unauthorized");
  });
  it("403 bot blocked", () => {
    expect(
      describeTelegramResponse(
        403,
        '{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}',
      ),
    ).toBe("403 – Forbidden: bot was blocked by the user");
  });
  it("400 chat not found", () => {
    expect(
      describeTelegramResponse(
        400,
        '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}',
      ),
    ).toBe("400 – Bad Request: chat not found");
  });
  it("Nicht-JSON-Body wird übernommen", () => {
    expect(describeTelegramResponse(502, "<html>bad gateway</html>")).toBe(
      "502 – <html>bad gateway</html>",
    );
  });
  it("leerer Body → nur Status", () => {
    expect(describeTelegramResponse(500, "")).toBe("500");
  });
});

describe("describeNetworkFailure", () => {
  it("nimmt die Error-Message", () => {
    expect(describeNetworkFailure(new Error("fetch failed"))).toBe("Netzwerkfehler: fetch failed");
  });
  it("verträgt Nicht-Fehler", () => {
    expect(describeNetworkFailure("boom")).toBe("Netzwerkfehler: boom");
  });
});

describe("normalizeSendReason", () => {
  it("wandelt HTTP-Rohform in lesbare Ursache", () => {
    expect(
      normalizeSendReason('HTTP 403: {"ok":false,"description":"Forbidden: bot was blocked"}'),
    ).toBe("403 – Forbidden: bot was blocked");
  });
  it("lässt fachliche Gründe stehen", () => {
    expect(normalizeSendReason("kein verknüpfter Telegram-Chat")).toBe(
      "kein verknüpfter Telegram-Chat",
    );
  });
  it("leer → Platzhalter", () => {
    expect(normalizeSendReason(undefined)).toBe("unbekannter Fehler");
  });
});

describe("formatFailures", () => {
  it("verkettet maskierte Empfänger und Gründe", () => {
    expect(
      formatFailures([
        { recipient: "…6789", reason: "403 – blocked" },
        { recipient: "unbekannt", reason: "kein verknüpfter Telegram-Chat" },
      ]),
    ).toBe("…6789: 403 – blocked; unbekannt: kein verknüpfter Telegram-Chat");
  });
});
