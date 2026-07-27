// PB2 — Zentrale Regel: Wie werden bezahlte Stunden aus Brutto und Pause gebildet?
// Eine Regel, eine Implementierung. Alle Vergütungs-Pfade (Buchhaltung, Selbst-
// ansicht, Lohn-Grundlohn, Personalquote, Export) rufen genau diese Funktion.
// SFN-Töpfe laufen weiterhin über `applyBreakProration` (immer netto) — sie
// haben mit `paidHours` NICHTS zu tun.

export function paidHours(
  grossHours: number,
  breakMinutes: number,
  pausenBezahlt: boolean,
): number {
  return pausenBezahlt ? grossHours : Math.max(0, grossHours - breakMinutes / 60);
}

// Bequeme Minuten-Variante für Konsumenten, die intern mit Minuten rechnen
// (Selbstansicht, Personalquote). Semantisch identisch zu `paidHours(...) * 60`.
export function paidMinutes(
  grossMinutes: number,
  breakMinutes: number,
  pausenBezahlt: boolean,
): number {
  return pausenBezahlt ? grossMinutes : Math.max(0, grossMinutes - breakMinutes);
}
