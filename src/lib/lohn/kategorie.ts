/**
 * Gemeinsam nutzbare Kategorien-Helfer für die Lohn-Kern-Module.
 * Reine Funktion, keine Abhängigkeiten — bewusst nicht in `lohn-rechner.functions.ts`
 * (Server-Modul), damit Client-Code und Server-Code sie zirkelfrei importieren können.
 */

import type { Beschaeftigungsart } from "./types";
import type { Kategorie } from "./types";

/**
 * Liefert die Kategorie für die Zeitlohn-Zeile abhängig von der
 * Beschäftigungsart. Minijobber müssen als `aushilfe_paust` gebucht werden,
 * damit `svBeitraegeMinijob` den RV-Eigenanteil korrekt aufstockt.
 */
export function zeitlohnKategorie(b: Beschaeftigungsart): "aushilfe_paust" | "zeitlohn" {
  return b === "minijob" ? "aushilfe_paust" : "zeitlohn";
}

/**
 * LG3b 2b — Export-Mapping. Liefert die vollständige Menge der
 * Zeitlohn-Kategorien für eine Beschäftigungsart:
 *
 *   - Nicht-Minijob: `zeitlohn`, `zeitlohn_2` (GL), `zeitlohn_3` (Küche).
 *   - Minijob: bereichs-unabhängig `aushilfe_paust` (die
 *     Bereichsunterscheidung tragen die Labels, nicht die Kategorie —
 *     siehe `lohn-rechner.functions.ts`, A3).
 *
 * Wird von Exporten benutzt, die alle vom Lohn-Kern erzeugten
 * Zeitlohn-Zeilen aufsummieren müssen (Übersicht „Zeitlohn (Stunden ×
 * Satz)"). Der Alt-Filter über `zeitlohnKategorie` verlor bei
 * Mehr-Bereichs-Personen die _2/_3-Zeilen — konsistent zu A3.
 */
export function zeitlohnKategorien(b: Beschaeftigungsart): readonly Kategorie[] {
  return b === "minijob"
    ? (["aushilfe_paust"] as const)
    : (["zeitlohn", "zeitlohn_2", "zeitlohn_3"] as const);
}

/** true, wenn `k` eine der Zeitlohn-Kategorien für `b` ist. */
export function isZeitlohnKategorie(k: Kategorie, b: Beschaeftigungsart): boolean {
  return zeitlohnKategorien(b).includes(k);
}
