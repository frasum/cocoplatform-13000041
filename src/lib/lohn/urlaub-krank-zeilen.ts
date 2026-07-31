// Schritt 2 — Urlaub/Krank als steuer-/SV-pflichtige Lohnarten.
// Baut bis zu 4 Entgeltzeilen (Basis + Zuschlag je Abwesenheitsart) aus den
// von Frank gepflegten Tagezahlen + Soll-Std/Tag, Stundensatz und dem
// 3-Monats-Ø SFN/Tag (aus der Diagnose). Alle Zeilen `zeitlohn` (St=L/SV=L).

import { zeitlohnKategorie } from "./kategorie";
import type { Beschaeftigungsart, Entgeltzeile } from "./types";

export function buildUrlaubKrankZeilen(args: {
  urlaubTage: number;
  krankTage: number;
  sollHoursPerDay: number;
  hourlyRateCents: number;
  sfnTagCent: number;
  /**
   * Beschäftigungsart des Mitarbeiters. Bei Minijob werden Urlaubs-/Krank-
   * Zeilen als `aushilfe_paust` gebucht — sonst liefen sie an der Minijob-
   * SV-Rechnung vorbei (kein RV-Eigenanteil, aber St-Brutto ≠ 0).
   */
  beschaeftigung?: Beschaeftigungsart;
  /**
   * UK1/K2 — `true`, wenn der U/K-Satz aus dem Vertragssatz des Haupt-
   * bereichs kommt, weil im 91-Tage-Fenster keine bezahlten Stunden lagen
   * (`no_hours`). Dann entsteht KEINE Zuschlagszeile (3M-Ø): es gibt keine
   * Basis, und eine 0-€-Zeile wäre Rauschen — edlohn rechnet den
   * Durchschnitt in diesem Fall selbst (Lohnbüro-bestätigt 31.07.2026).
   * Die Basis-Zeilen tragen den Zusatz „(ohne 3M-Basis)" — auch im Export,
   * weil die Bezeichnung Teil der Entgeltzeile ist.
   */
  ohneDreiMonatsBasis?: boolean;
}): Entgeltzeile[] {
  const { urlaubTage, krankTage, sollHoursPerDay, hourlyRateCents, sfnTagCent } = args;
  const kat = zeitlohnKategorie(args.beschaeftigung ?? "normal");
  const ohneBasis = args.ohneDreiMonatsBasis === true;
  const zusatz = ohneBasis ? " (ohne 3M-Basis)" : "";
  const zeilen: Entgeltzeile[] = [];

  if (urlaubTage > 0) {
    const stunden = urlaubTage * sollHoursPerDay;
    zeilen.push({
      kategorie: kat,
      bezeichnung: `Urlaubsstunden${zusatz}`,
      betragCent: Math.round(stunden * hourlyRateCents),
      stunden,
      satzCent: hourlyRateCents,
    });
    if (!ohneBasis) {
      zeilen.push({
        kategorie: kat,
        bezeichnung: "Zuschlag Urlaubsentgelt (3M-Ø)",
        betragCent: Math.round(urlaubTage * sfnTagCent),
      });
    }
  }

  if (krankTage > 0) {
    const stunden = krankTage * sollHoursPerDay;
    zeilen.push({
      kategorie: kat,
      bezeichnung: `Lohnfortzahlung Krankheit${zusatz}`,
      betragCent: Math.round(stunden * hourlyRateCents),
      stunden,
      satzCent: hourlyRateCents,
    });
    if (!ohneBasis) {
      zeilen.push({
        kategorie: kat,
        bezeichnung: "Zuschlag Krank (3M-Ø)",
        betragCent: Math.round(krankTage * sfnTagCent),
      });
    }
  }

  return zeilen;
}
