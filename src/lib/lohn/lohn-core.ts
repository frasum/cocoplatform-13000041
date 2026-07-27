/**
 * Zusammenbau Brutto → Steuer-/SV-Brutto → Netto → Auszahlung
 * (Schritte A–F gem. Bauplan M4 Stufe 1).
 */

import { KIRCHENSTEUER_BAYERN_PROZENT, LZZ_MONAT } from "./config-2026";
import { lohnsteuer2026 } from "./lohnsteuer-2026";
import { svBeitraege, svBeitraegeMinijob, type SvErgebnis } from "./sv-2026";
import type { Entgeltzeile, Kategorie, LohnEingabe, LohnErgebnis } from "./types";

function sumBy(zeilen: Entgeltzeile[], pred: (k: Kategorie) => boolean): number {
  let s = 0;
  for (const z of zeilen) {
    if (pred(z.kategorie)) s += z.betragCent;
  }
  return s;
}

/**
 * LG3b: Zeitlohn-Kategorien inkl. der Bereichs-Varianten. Für St-/SV-Brutto
 * und Minijob-Guard identisch zu `zeitlohn` behandelt — nur die Herkunft
 * (Bereichs-Satz) unterscheidet sich in der Anzeige/Export-Aufteilung.
 */
function isZeitlohnKategorie(k: Kategorie): boolean {
  return k === "zeitlohn" || k === "zeitlohn_2" || k === "zeitlohn_3";
}

/** Kaufmännische Cent-Rundung. */
function roundCent(centValue: number): number {
  return Math.sign(centValue) * Math.round(Math.abs(centValue));
}

/**
 * Berechnet die vier Kennzahlen (Gesamtbrutto, St/SV-Brutto, Netto,
 * Auszahlung) und liefert alle Zwischengrößen mit zurück.
 */
export function berechneLohn(eingabe: LohnEingabe): LohnErgebnis {
  const { person, zeilen } = eingabe;

  // --- Schritt A: Gesamtbrutto = Summe aller Zeilen außer 'abzug' ---
  const gesamtbruttoCent = sumBy(zeilen, (k) => k !== "abzug");

  // Invariante: Minijob kennt weder 'zeitlohn' noch 'einmalbezug' — solche
  // Beträge liefen still an der SV vorbei (RV-Eigenanteil würde fehlen).
  // Lieber hart scheitern; die Übersicht fängt Fehler pro Zeile bereits ab.
  if (person.beschaeftigung === "minijob") {
    const bad = zeilen.find(
      (z) => isZeitlohnKategorie(z.kategorie) || z.kategorie === "einmalbezug",
    );
    if (bad) {
      throw new Error(
        "Minijob: Kategorie 'zeitlohn(_2|_3)'/'einmalbezug' nicht unterstützt — als 'aushilfe_paust' buchen.",
      );
    }
  }

  // --- Schritt B: Steuer-/SV-Brutto ---
  const summeZuschlagFrei = sumBy(zeilen, (k) => k === "zuschlag_frei");
  const summeSachbezugFrei = sumBy(zeilen, (k) => k === "sachbezug_frei");
  const summeMahlzeitenPaust = sumBy(zeilen, (k) => k === "mahlzeiten_paust");
  const summeAushilfePaust = sumBy(zeilen, (k) => k === "aushilfe_paust");
  const summeBavFrei = sumBy(zeilen, (k) => k === "bav_frei");
  const summeBavSv = sumBy(zeilen, (k) => k === "bav_sv");

  // St-Brutto: alle freien + pauschalen Bestandteile abziehen, inkl. bav_sv (st-frei).
  const stBruttoCent =
    gesamtbruttoCent -
    summeZuschlagFrei -
    summeSachbezugFrei -
    summeMahlzeitenPaust -
    summeAushilfePaust -
    summeBavFrei -
    summeBavSv;
  // SV-Brutto: bav_sv bleibt drin (sv-pflichtig), bav_frei ist sv-frei.
  const svBruttoCent =
    gesamtbruttoCent -
    summeZuschlagFrei -
    summeSachbezugFrei -
    summeMahlzeitenPaust -
    summeAushilfePaust -
    summeBavFrei;
  // Rückwärtskompatibilität: viele Verbraucher lesen weiterhin stSvBruttoCent.
  const stSvBruttoCent = stBruttoCent;

  // --- Schritt C: Lohnsteuer / Soli / KiSt ---
  let lstCent = 0;
  let soliCent = 0;
  let kistCent = 0;

  // --- Schritt D: SV ---
  let sv: SvErgebnis;

  if (person.beschaeftigung === "minijob") {
    // Minijob: LSt(AN) = 0 (Arbeitgeber pauschal), nur RV-Eigenanteil.
    sv = svBeitraegeMinijob({ aushilfeZeitlohnCent: summeAushilfePaust });
  } else {
    const papErgebnis = lohnsteuer2026({
      stkl: person.steuerklasse,
      lzz: LZZ_MONAT,
      re4Cent: stBruttoCent,
      zkf: person.zkf,
      kvzProzent: person.kvzProzent,
      kirchensteuer: person.kirchensteuerBayern,
      pvz: person.pvKinderlosZuschlag,
      pva: clampPva(person.kinderzahl, person.elterneigenschaft),
      freibetragCent: person.lstFreibetragMonatCent,
      // Werkstudent: KV/PV-frei → PAP mit PKV=1 und PKPV=0 → Mindest-
      // vorsorgepauschale (edlohn-Verhalten). NICHT pauschal an `kvFrei`
      // koppeln — freiwillig gesetzlich Versicherte sind ebenfalls kvFrei,
      // brauchen aber die volle Vorsorgepauschale.
      pkv: person.istPkv || !!person.istWerkstudent,
      // Werkstudent ist RV-pflichtig (rvFrei bleibt false) und AV-frei
      // (avFrei=true). Damit die PAP-Vorsorgepauschale die AV nicht doppelt
      // ansetzt, muss `ALV=1` auch für Werkstudenten greifen, sobald sie
      // avFrei gemeldet sind. Für RV bleibt der Zweig regulär in der Basis.
      krvKeinRv: (person.istPkv || !!person.istWerkstudent) && person.rvFrei,
      alvKeinAv: (person.istPkv || !!person.istWerkstudent) && person.avFrei,
      pkpvCent: person.istWerkstudent ? 0 : person.pkvBasisBeitragMonatCent,
    });
    lstCent = papErgebnis.lstlzzCent;
    soliCent = papErgebnis.solzlzzCent;
    if (person.kirchensteuerBayern) {
      kistCent = roundCent((papErgebnis.bkCent * KIRCHENSTEUER_BAYERN_PROZENT) / 100);
    }
    sv = svBeitraege({ stSvBruttoCent: svBruttoCent, person });
  }

  // --- Schritt E: Gesamtnetto ---
  const gesamtnettoCent =
    gesamtbruttoCent -
    lstCent -
    soliCent -
    kistCent -
    sv.kvCent -
    sv.rvCent -
    sv.avCent -
    sv.pvCent;

  // --- Schritt F: Auszahlung ---
  const summeAbzug = sumBy(zeilen, (k) => k === "abzug");
  const summeSachbezugPflichtig = sumBy(zeilen, (k) => k === "sachbezug_pflichtig");
  const auszahlungCent =
    gesamtnettoCent -
    summeSachbezugFrei -
    summeSachbezugPflichtig -
    summeMahlzeitenPaust -
    summeBavFrei -
    summeBavSv -
    summeAbzug;

  // Ausweis-Feld: edlohn bucht LSt-Freibeträge (Aktivrente) vom sichtbaren
  // St-Brutto ab; die Lohnsteuer selbst ändert sich nicht (LZZFREIB wirkt
  // bereits im PAP). Für den CSV-/Excel-Abgleich brauchen wir das gekappte
  // Feld separat; `stBruttoCent` bleibt RE4 für den PAP.
  const stBruttoAusweisCent = Math.max(0, stBruttoCent - person.lstFreibetragMonatCent);

  return {
    gesamtbruttoCent,
    stBruttoCent,
    stBruttoAusweisCent,
    svBruttoCent,
    stSvBruttoCent,
    lstCent,
    soliCent,
    kistCent,
    kvCent: sv.kvCent,
    rvCent: sv.rvCent,
    avCent: sv.avCent,
    pvCent: sv.pvCent,
    gesamtnettoCent,
    auszahlungCent,
  };
}

function clampPva(kinderzahl: number, elterneigenschaft: boolean): 0 | 1 | 2 | 3 | 4 {
  if (!elterneigenschaft || kinderzahl < 2) return 0;
  const v = Math.min(kinderzahl, 5) - 1;
  return v as 0 | 1 | 2 | 3 | 4;
}
