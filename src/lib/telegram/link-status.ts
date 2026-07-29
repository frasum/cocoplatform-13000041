// SP1 — Statusregel für die Telegram-Verknüpfung, herausgezogen aus
// getMyTelegramLink (telegram.functions.ts), damit Mitarbeiter-Banner und
// Admin-Personalliste dieselbe Regel benutzen (KGL: eine Regel, eine
// Implementierung). Verhalten bit-identisch übernommen: ein abgelaufener
// Token gilt weiterhin als "none" (kein eigener vierter Zustand — die offene
// Frage dazu läuft als eigener Auftrag, siehe SP1 A6).

export type TelegramLinkState = "linked" | "pending" | "none";

export type TelegramLinkRowLike = {
  telegram_chat_id?: number | string | null;
  linked_at?: string | null;
  token_expires_at?: string | null;
};

export function deriveTelegramLinkState(
  row: TelegramLinkRowLike | null | undefined,
  now: Date = new Date(),
): TelegramLinkState {
  if (!row) return "none";
  if (row.linked_at && row.telegram_chat_id) return "linked";
  const expiresAt = row.token_expires_at ?? null;
  if (!expiresAt) return "none";
  if (new Date(expiresAt).getTime() < now.getTime()) return "none";
  return "pending";
}