/**
 * Eingabe-/Ausgabe-Typen für den Lohn-Rechen-Kern (Stufe 1).
 *
 * Alle Geldbeträge sind Cent-Integer (number). Keine externen Abhängigkeiten.
 */

/**
 * Kategorisierung einer Entgeltzeile.
 *
 * - zeitlohn:         steuer- UND sv-pflichtig (voll ins St-/SV-Brutto)
 * - zuschlag_frei:    steuer- & sv-FREI (SFN-Zuschläge) — erhöht Gesamtbrutto,
 *                     NICHT St-/SV-Brutto
 * - sachbezug_frei:   geldwerter Vorteil; ins Brutto, am Schluss wieder abziehen
 * - mahlzeiten_paust: pauschal besteuert; NICHT im St-/SV-Brutto;
 *                     geldwerter Vorteil
 * - aushilfe_paust:   Minijob-Zeitlohn, pauschal; LSt(AN)=0, nur RV-Anteil
 * - einmalbezug:      Sonstiger Bezug (Sonderberechnung) — TODO Stufe 2;
 *                     in Stufe 1 noch nicht von den Referenzfällen gefordert
 * - abzug:            negativer Posten, wirkt erst nach dem Netto
 */
export type Kategorie =
  | "zeitlohn"
  /**
   * Zeitlohn eines zweiten Arbeitsbereichs (LG3b). Steuer-/SV-Verhalten
   * identisch zu `zeitlohn`; nur die Herkunft (Bereichs-Satz) unterscheidet
   * sich. Ab Etappe 2 gefüllt; in Etappe 1 nur Typ, kein Erzeuger.
   */
  | "zeitlohn_2"
  /** Zeitlohn eines dritten Arbeitsbereichs (LG3b). Verhalten wie `zeitlohn`. */
  | "zeitlohn_3"
  | "zuschlag_frei"
  | "sachbezug_frei"
  | "mahlzeiten_paust"
  | "aushilfe_paust"
  | "einmalbezug"
  | "abzug"
  /** st-FREI + sv-FREI (Direktversicherung stsv-frei): im Gesamtbrutto, nicht St, nicht SV. */
  | "bav_frei"
  /** st-FREI + sv-PFLICHTIG (Direktversicherung stfr-svpfl): im Gesamtbrutto + SV, NICHT St. */
  | "bav_sv"
  /** st+sv PFLICHTIG, geldwerter Vorteil (Dienstrad 1 %): in St+SV, Auszahlung −. */
  | "sachbezug_pflichtig"
  /** st+sv PFLICHTIG, mindernd (Entgeltumwandlung: negativer Betrag). */
  | "entgeltumwandlung";

/** Steuerklassen lt. PAP. */
export type Steuerklasse = 1 | 2 | 3 | 4 | 5 | 6;

/** Beschäftigungsart in Stufe 1. */
export type Beschaeftigungsart = "normal" | "minijob";

/**
 * Eine einzelne Entgeltzeile.
 *
 * `betragCent` ist verpflichtend. `stunden` × `satzCent` sind optional und
 * dienen nur der Dokumentation/Herkunft; verbindlich für die Berechnung ist
 * der bereits cent-gerundete `betragCent`.
 */
export interface Entgeltzeile {
  kategorie: Kategorie;
  bezeichnung?: string;
  betragCent: number;
  stunden?: number;
  satzCent?: number;
}

/** Eingabeparameter Personenseite. */
export interface PersonenParameter {
  steuerklasse: Steuerklasse;
  /** Zahl der Kinderfreibeträge (z. B. 0, 0.5, 1, 2). */
  zkf: number;
  /** Krankenkassen-Zusatzbeitrag in Prozent (z. B. 2.69). */
  kvzProzent: number;
  /** true wenn Kirchensteuerpflicht Bayern (8 %). */
  kirchensteuerBayern: boolean;
  /**
   * Anzahl Kinder (für PV-Abschläge). 0 = kein Kind; relevant sind 2..5
   * für die Beitragsabschläge ab dem 2. Kind.
   */
  kinderzahl: number;
  /** true wenn Elterneigenschaft i.S.d. § 55 SGB XI (für PV-Abschläge). */
  elterneigenschaft: boolean;
  /** true wenn Arbeitnehmer ≥ 23 Jahre alt UND kinderlos (für PV-Zuschlag). */
  pvKinderlosZuschlag: boolean;
  /** Beschäftigungsart. */
  beschaeftigung: Beschaeftigungsart;
  /** RV-Befreiung AN-Anteil (z. B. Regelaltersrentner). */
  rvFrei: boolean;
  /** AV-Befreiung AN-Anteil. */
  avFrei: boolean;
  /** Monatlicher LSt-Freibetrag in Cent (0 = keiner). */
  lstFreibetragMonatCent: number;
  /** Übergangsbereich (Midijob): reduzierte SV-Basis, wenn AE in (UG, OG]. */
  istMidijob: boolean;
  /** KV-AN-Befreiung (z. B. Werkstudent). */
  kvFrei: boolean;
  /** PV-AN-Befreiung (z. B. Werkstudent). */
  pvFrei: boolean;
  /** Privat kranken-/pflegeversichert (PKV-Teilbetrag statt GKV-Pauschalweg). */
  istPkv: boolean;
  /** Monatl. PKV-Basis-KV/PV-Beitrag in Cent. */
  pkvBasisBeitragMonatCent: number;
  /**
   * Werkstudentenprivileg: KV/PV/AV-frei, RV-pflichtig.
   * LSt-Berechnung mit Mindestvorsorgepauschale (PAP `PKV=1`, `PKPV=0`) —
   * NICHT an `kvFrei` koppeln, freiwillig gesetzlich Versicherte sind
   * ebenfalls `kvFrei`, brauchen aber die volle Vorsorgepauschale.
   */
  istWerkstudent?: boolean;
}

/** Vollständige Eingabe für eine Monatsabrechnung. */
export interface LohnEingabe {
  person: PersonenParameter;
  zeilen: Entgeltzeile[];
}

/** Ergebnis einer Monatsabrechnung. Alle Werte in Cent. */
export interface LohnErgebnis {
  gesamtbruttoCent: number;
  /**
   * Steuer-Brutto (Bemessungsgrundlage Lohnsteuer).
   * Aus Rückwärtskompatibilität zusätzlich als `stSvBruttoCent` gespiegelt.
   */
  stBruttoCent: number;
  /**
   * Ausgewiesenes St-Brutto (nach Abzug eines monatlichen LSt-Freibetrags,
   * gekappt bei 0). Nur für Anzeige/Export gegen edlohn — die LSt-Berechnung
   * nutzt weiterhin `stBruttoCent` als RE4 für den PAP. Ohne Freibetrag
   * identisch mit `stBruttoCent`.
   */
  stBruttoAusweisCent: number;
  /** Sozialversicherungs-Brutto (Bemessungsgrundlage SV). */
  svBruttoCent: number;
  /** @deprecated identisch mit `stBruttoCent`. */
  stSvBruttoCent: number;
  lstCent: number;
  soliCent: number;
  kistCent: number;
  kvCent: number;
  rvCent: number;
  avCent: number;
  pvCent: number;
  gesamtnettoCent: number;
  auszahlungCent: number;
}

// --- PAP-Wrapper-Typen (lohnsteuer-2026.ts) ---

/** Eingabe für den PAP-Wrapper `lohnsteuer2026`. */
export interface PapEingabe {
  stkl: Steuerklasse;
  /** Lohnzahlungszeitraum: 1 = Jahr, 2 = Monat, 3 = Woche, 4 = Tag. */
  lzz: 1 | 2 | 3 | 4;
  /** Steuer-/SV-Brutto in Cent. */
  re4Cent: number;
  /** Zahl der Kinderfreibeträge (z. B. 0, 0.5, 1, 2). */
  zkf: number;
  /** Krankenkassen-Zusatzbeitrag in Prozent (z. B. 2.69). */
  kvzProzent: number;
  /** true wenn Kirchensteuerpflicht. */
  kirchensteuer: boolean;
  /** true bei privater Krankenvers. (sonst GKV). Default false. */
  pkv?: boolean;
  /**
   * Pflegeversicherungs-Zuschlag (kinderlos ≥23). Wird vom Wrapper aus
   * `pvKinderlosZuschlag` der Person abgeleitet, wenn nicht explizit gesetzt.
   */
  pvz?: boolean;
  /**
   * PV-Beitragsabschläge: 0..4 (0 = kein Abschlag,
   * 1 = Abschlag für das 2. Kind, ..., 4 = Abschläge für 2.–5. Kind).
   */
  pva?: 0 | 1 | 2 | 3 | 4;
  /** Sachsen-Besonderheit PV. Default false. */
  pvs?: boolean;
  /** Monatlicher LSt-Freibetrag in Cent (→ PAP LZZFREIB). Default 0. */
  freibetragCent?: number;
  /** KRV=1: kein RV-Teilbetrag der Vorsorgepauschale (kein gesetzl. RV-Beitrag). */
  krvKeinRv?: boolean;
  /** ALV=1: kein AV-Teilbetrag (überspringt die AV-Höchstbetragsrechnung MVSPHB). */
  alvKeinAv?: boolean;
  /** Monatl. PKV-Basis-KV/PV-Beitrag in Cent (PKV-Teilbetrag; 0 = keiner). */
  pkpvCent?: number;
}

/** Ausgabe des PAP-Wrappers. */
export interface PapErgebnis {
  /** Lohnsteuer für den Lohnzahlungszeitraum in Cent. */
  lstlzzCent: number;
  /** Solidaritätszuschlag in Cent. */
  solzlzzCent: number;
  /** Bemessungsgrundlage Kirchensteuer in Cent. */
  bkCent: number;
}
