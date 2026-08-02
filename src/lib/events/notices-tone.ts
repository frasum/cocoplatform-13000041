// UI2 — Farbstufe der Event-Karte in der Tagesabrechnung.
//
// Reine Helferfunktion ohne Rechenwirkung: sie bildet nur den HÖCHSTEN Impact
// der aktuellen Event-Notices auf eine Farbstufe ab. Ferien-Hinweise haben
// keinen Impact (FK1: Dauerkontext) und können die Karte nie einfärben.

import type { EventNotice } from "./event-notices";

export type NoticesTone = "info" | "warning" | "danger";

export function noticesTone(notices: readonly EventNotice[]): NoticesTone {
  let tone: NoticesTone = "info";
  for (const n of notices) {
    if (n.impact === "sehr_hoch") return "danger";
    if (n.impact === "hoch") tone = "warning";
  }
  return tone;
}
