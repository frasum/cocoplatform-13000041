/**
 * M-Statistik — DB-Row → reine `SessionRevenueInput[]`-Liste.
 *
 * Keine DB-Zugriffe, keine Seiteneffekte. Wandelt die rohen DB-Zeilen
 * (sessions + session_channel_amounts joined revenue_channels.kind)
 * in die Eingabe-Struktur der reinen Funktionen aus `revenue-core.ts`.
 *
 * STAT1: maßgeblich ist der Kanal-`kind` (N14-Zerlegung in
 * `decomposeRevenue`), nicht mehr das additive `is_takeaway`-Flag.
 */

import type { SessionRevenueInput } from "./revenue-core";

export type SessionRow = {
  id: string;
  businessDate: string;
  locationId: string;
  vectronCents: number;
};

export type ChannelAmountRow = {
  sessionId: string;
  amountCents: number;
  kind: string;
};

export function mapToSessionInputs(
  sessions: SessionRow[],
  channelAmounts: ChannelAmountRow[],
): SessionRevenueInput[] {
  const bySession = new Map<string, { kind: string; amountCents: number }[]>();
  for (const ca of channelAmounts) {
    const list = bySession.get(ca.sessionId);
    const entry = { kind: ca.kind, amountCents: ca.amountCents };
    if (list) list.push(entry);
    else bySession.set(ca.sessionId, [entry]);
  }
  return sessions.map((s) => ({
    sessionId: s.id,
    businessDate: s.businessDate,
    locationId: s.locationId,
    vectronCents: s.vectronCents,
    channels: bySession.get(s.id) ?? [],
  }));
}
