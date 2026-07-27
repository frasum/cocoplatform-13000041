// CSV-Export der Lohnrechner-Perioden-Übersicht.
// Reine Serialisierung — keine Rechnung, keine Seiteneffekte.
// Format: UTF-8 BOM, Trenner `;`, Zeilenende `\r\n`. Geld in Cent (Ganzzahl),
// Stunden als Dezimal mit Punkt. Excel-kompatibel und maschinenlesbar.
//
// LG3b 2b — Export-Spalten je Lohnart (Bereich) und Export-Gate.
//   * Neue Spalten `zeitlohn_<bereich>_std/_cent` und `sfn_<bereich>_cent`
//     bilden die Lohnart-Aufteilung (Service→Zeitlohn, GL→Zeitlohn 2,
//     Küche→Zeitlohn 3) direkt in den Export ab, ohne die Anzeige zu
//     verändern (A4 — Gate/Spalten sitzen in den Build-Funktionen).
//   * `unresolved_std` weist A5-Stunden (Bereich nicht zuordenbar) aus.
//   * Wird die Funktion mit einer nicht-leeren `blockers`-Liste gerufen,
//     wirft sie `LohnExportBlockedError` — keine Teil-Exporte
//     (docs/LG3b-bereichs-saetze.md).

import { LohnExportBlockedError, type StaffBlocker } from "./export-blockers";

export type UebersichtCsvRow = {
  persoNr: number | null;
  displayName: string;
  totalHours: number | null;
  hourlyRateCents: number | null;
  night25Hours: number | null;
  night40Hours: number | null;
  sundayHours: number | null;
  zuschlagCents: number | null;
  bruttoCents: number | null;
  stBruttoAusweisCent: number | null;
  lstCent: number | null;
  soliCent: number | null;
  kistCent: number | null;
  kvCent: number | null;
  rvCent: number | null;
  avCent: number | null;
  pvCent: number | null;
  nettoCents: number | null;
  auszahlungCents: number | null;
  workdayCount: number | null;
  mahlzeitenCent: number | null;
  sachbezugCent: number | null;
  urlaubTage: number | null;
  krankTage: number | null;
  urlaubTageEst: number | null;
  krankTageEst: number | null;
  avgStdTag: number | null;
  avgSfnTagCent: number | null;
  // LG3b 2b — Lohnart-Split (A7). Alle Werte in Cent bzw. Dezimal-Stunden.
  // `null` nur bei Fehlerzeilen; sonst 0 wenn Bereich in der Periode ungenutzt.
  zeitlohnServiceHours: number | null;
  zeitlohnServiceCent: number | null;
  zeitlohnGlHours: number | null;
  zeitlohnGlCent: number | null;
  zeitlohnKitchenHours: number | null;
  zeitlohnKitchenCent: number | null;
  sfnServiceCent: number | null;
  sfnGlCent: number | null;
  sfnKitchenCent: number | null;
  unresolvedHours: number | null;
  error: string | null;
};

const SEP = ";";
const EOL = "\r\n";
const BOM = "\uFEFF";

const HEADERS = [
  "perso_nr",
  "name",
  "stunden",
  "stundensatz_cent",
  "nacht25_std",
  "nacht40_std",
  "sonntag_std",
  "zuschlag_cent",
  "brutto_cent",
  "st_brutto_ausweis_cent",
  "lst_cent",
  "soli_cent",
  "kist_cent",
  "kv_cent",
  "rv_cent",
  "av_cent",
  "pv_cent",
  "netto_cent",
  "auszahlung_cent",
  "arbeitstage",
  "mahlzeiten_cent",
  "sachbezug_cent",
  "urlaub_tage",
  "krank_tage",
  "urlaub_tage_est",
  "krank_tage_est",
  "avg_std_tag",
  "avg_sfn_tag_cent",
  // LG3b 2b — A7-Labels (Lohnart-Split je Bereich).
  "zeitlohn_service_std",
  "zeitlohn_service_cent",
  "zeitlohn_gl_std",
  "zeitlohn_gl_cent",
  "zeitlohn_kitchen_std",
  "zeitlohn_kitchen_cent",
  "sfn_service_cent",
  "sfn_gl_cent",
  "sfn_kitchen_cent",
  "unresolved_std",
  "fehler",
] as const;

function escapeField(v: string): string {
  if (/[;"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function fmtInt(n: number | null): string {
  return n == null ? "" : String(Math.trunc(n));
}

function fmtIntZero(n: number | null): string {
  return n == null ? "0" : String(Math.trunc(n));
}

function fmtHoursZero(n: number | null): string {
  return n == null ? "0" : String(n);
}

export function buildUebersichtCsv(
  rows: UebersichtCsvRow[],
  meta: { periodLabel: string; mode: string },
  blockers: readonly StaffBlocker[] = [],
): string {
  // LG3b A4 — Gate in der Build-Funktion. Keine Teil-Exporte, wenn eine
  // Person unvollständig gepflegt ist (fehlender Satz, `perso_nr`
  // oder unresolved WZ2). Der Aufrufer zeigt die Liste an; wir werfen.
  if (blockers.length > 0) {
    throw new LohnExportBlockedError(blockers);
  }
  const comment = `# COCO Lohn-Übersicht${SEP} Periode=${meta.periodLabel}${SEP} Modus=${meta.mode}`;
  const headerLine = HEADERS.join(SEP);

  const dataLines = rows.map((r) => {
    const cells = [
      fmtInt(r.persoNr),
      escapeField(r.displayName),
      fmtHoursZero(r.totalHours),
      fmtIntZero(r.hourlyRateCents),
      fmtHoursZero(r.night25Hours),
      fmtHoursZero(r.night40Hours),
      fmtHoursZero(r.sundayHours),
      fmtIntZero(r.zuschlagCents),
      fmtIntZero(r.bruttoCents),
      fmtIntZero(r.stBruttoAusweisCent),
      fmtIntZero(r.lstCent),
      fmtIntZero(r.soliCent),
      fmtIntZero(r.kistCent),
      fmtIntZero(r.kvCent),
      fmtIntZero(r.rvCent),
      fmtIntZero(r.avCent),
      fmtIntZero(r.pvCent),
      fmtIntZero(r.nettoCents),
      fmtIntZero(r.auszahlungCents),
      fmtIntZero(r.workdayCount),
      fmtIntZero(r.mahlzeitenCent),
      fmtIntZero(r.sachbezugCent),
      fmtIntZero(r.urlaubTage),
      fmtIntZero(r.krankTage),
      fmtIntZero(r.urlaubTageEst),
      fmtIntZero(r.krankTageEst),
      fmtHoursZero(r.avgStdTag),
      fmtIntZero(r.avgSfnTagCent),
      fmtHoursZero(r.zeitlohnServiceHours),
      fmtIntZero(r.zeitlohnServiceCent),
      fmtHoursZero(r.zeitlohnGlHours),
      fmtIntZero(r.zeitlohnGlCent),
      fmtHoursZero(r.zeitlohnKitchenHours),
      fmtIntZero(r.zeitlohnKitchenCent),
      fmtIntZero(r.sfnServiceCent),
      fmtIntZero(r.sfnGlCent),
      fmtIntZero(r.sfnKitchenCent),
      fmtHoursZero(r.unresolvedHours),
      escapeField(r.error ?? ""),
    ];
    return cells.join(SEP);
  });

  return BOM + [comment, headerLine, ...dataLines].join(EOL) + EOL;
}

export const __test__ = { HEADERS, SEP, EOL, BOM };
