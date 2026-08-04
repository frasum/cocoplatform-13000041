// TG4 — Sammel- und Maskierlogik für Telegram-Zustellfehler.
//
// Zweck: Der Alarm „keine einzige Zustellung" soll die URSACHE mitliefern
// (HTTP-Status + Telegram-`description`, bzw. Netzwerkfehler-Text), ohne
// dabei Chat-IDs im Klartext, Bot-Tokens oder Berichtstexte zu protokollieren.
//
// Reine Funktionen, keine IO — darum hier und nicht im Server-Kern.

export type DeliveryFailure = {
  /** maskierte Empfänger-Kennung, z. B. „…7421" */
  recipient: string;
  /** kurzer Grund, z. B. „403 – bot was blocked by the user" */
  reason: string;
};

/** Maskiert eine Chat-ID auf die letzten 4 Stellen. */
export function maskChatId(chatId: string | number | null | undefined): string {
  if (chatId === null || chatId === undefined) return "unbekannt";
  const s = String(chatId).trim();
  if (!s) return "unbekannt";
  return `…${s.slice(-4)}`;
}

const MAX_REASON_LEN = 200;

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_REASON_LEN ? `${t.slice(0, MAX_REASON_LEN)}…` : t;
}

/**
 * Baut den Fehlergrund aus einer Telegram-Antwort: HTTP-Status plus
 * `description` aus dem JSON-Body. Ist der Body kein JSON, wird er
 * (gekürzt) übernommen.
 */
export function describeTelegramResponse(status: number, body: string): string {
  let description: string | null = null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const d = (parsed as { description?: unknown }).description;
      if (typeof d === "string" && d.trim()) description = d.trim();
    }
  } catch {
    /* kein JSON — Rohtext unten */
  }
  const detail = description ?? (body.trim() ? body : "");
  return detail ? clip(`${status} – ${detail}`) : String(status);
}

/** Fehlergrund für Netzwerk-/Fetch-Fehler und sonstige Ausnahmen. */
export function describeNetworkFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return clip(`Netzwerkfehler: ${msg || "unbekannt"}`);
}

/**
 * Normalisiert einen `reason` aus `sendTelegramToStaff`. Dessen HTTP-Fehler
 * kommen als `HTTP <status>: <body>` — daraus wird die lesbare Form.
 */
export function normalizeSendReason(reason: string | undefined): string {
  const raw = (reason ?? "").trim();
  if (!raw) return "unbekannter Fehler";
  const m = /^HTTP (\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (m) return describeTelegramResponse(Number(m[1]), m[2] ?? "");
  return clip(raw);
}

/** Kurzform für UI/Extra-Kontext: „…7421: 403 – bot was blocked by the user". */
export function formatFailures(failures: readonly DeliveryFailure[]): string {
  return failures.map((f) => `${f.recipient}: ${f.reason}`).join("; ");
}
