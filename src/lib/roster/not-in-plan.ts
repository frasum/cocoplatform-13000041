// ZS1 — „Nicht mehr im Plan" sichtbar machen (reines Modul).
//
// Ein Eintrag (Pool-Zeile oder Zeiteintrag) gilt als „nicht mehr im Plan",
// wenn für (staffId, businessDate) KEINE geplante/bestätigte Roster-Schicht
// mehr existiert. Entfernt wird NIE automatisch — Ein-Klick-Entfernen gibt
// es nur für UNBERÜHRTE Einträge, alles andere bleibt bewusst manuell.

export function plannedKey(staffId: string, dateIso: string): string {
  return `${staffId}|${dateIso}`;
}

export function isNotInPlan(
  entry: { staffId: string; businessDate: string },
  plannedKeys: ReadonlySet<string>,
): boolean {
  return !plannedKeys.has(plannedKey(entry.staffId, entry.businessDate));
}

export type UntouchedInput = {
  /** true, wenn ein gestempelter Ist-Eintrag (source='clock') vorliegt. */
  hasClockEntry: boolean;
  /** true, wenn die Person in dieser Session eine Abrechnung/Trinkgeldbezug hat. */
  hasSettlement: boolean;
  /** freie Notiz am Eintrag (manuelle Spur). */
  note?: string | null;
  /** explizite Teilnahme-Übersteuerung (Pool). */
  participatesOverride?: boolean | null;
};

/** Unberührt = reiner Plan-Snapshot, ohne Ist-Zeit, Geldbezug oder manuelle Übersteuerung. */
export function isUntouched(input: UntouchedInput): boolean {
  if (input.hasClockEntry) return false;
  if (input.hasSettlement) return false;
  if (input.note != null && input.note.trim() !== "") return false;
  if (input.participatesOverride != null) return false;
  return true;
}

/** Tooltip-Grund, warum Ein-Klick-Entfernen gesperrt ist. null = entfernbar. */
export function removalBlockedReason(input: UntouchedInput): string | null {
  if (input.hasClockEntry) return "Gestempelte Ist-Zeit vorhanden — nur bewusst manuell entfernen.";
  if (input.hasSettlement)
    return "Abrechnung/Trinkgeldbezug vorhanden — nur bewusst manuell entfernen.";
  if (input.note != null && input.note.trim() !== "")
    return "Notiz vorhanden — nur bewusst manuell entfernen.";
  if (input.participatesOverride != null)
    return "Teilnahme wurde manuell übersteuert — nur bewusst manuell entfernen.";
  return null;
}
