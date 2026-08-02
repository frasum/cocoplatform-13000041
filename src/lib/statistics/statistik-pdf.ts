// STAT3 — PDF-Export der Statistik-Seite: EINE A4-Seite Management-Blick
// (Summen, Vergleich, Entwicklung, Grafik). Detailzahlen bleiben in der App.
//
// Reine Präsentation, keine Berechnungslogik: alle Werte kommen fertig aus den
// Statistik-Server-Fns bzw. der MB1-Monatsmatrix. Prozent-Deltas entstehen
// über `growthPct` (monthly-core), die Chart-Geometrie über
// `statistik-pdf-charts.ts` — hier wird nur gezeichnet.
//
// Muster wie src/lib/cash/pdfExport.ts: dynamische jspdf/jspdf-autotable
// Imports, kein Buffer, kein node:-Modul — läuft komplett im Browser.

import type jsPDF from "jspdf";
import { fmtCents, parseIso } from "@/lib/format";
import { growthPct } from "./monthly-core";
import { tipRatePct } from "./revenue-core";
import {
  barChartGeometry,
  formatTsd,
  formatTsdPlain,
  groupedBarChartGeometry,
  lineChartGeometry,
  stackedBarChartGeometry,
  type ChartArea,
} from "./statistik-pdf-charts";
import type { TakeawayMatrix } from "./takeaway-channels";

export type StatistikPdfData = {
  monthLabel: string;
  scopeLabel: string;
  /** Erstellungsdatum, klein im Kopf. */
  generatedAtLabel: string;
  /**
   * true = Kalendermonat-Modus. Nur dann tragen die Vorjahres-/Vormonatsspalten und der
   * 13-Monats-Verlauf; im freien Zeitraum stehen „—" bzw. entfällt Grafik B.
   */
  calendarMonth: boolean;
  revenue: {
    houseCents: number;
    takeawayCents: number;
    totalCents: number;
    daysWithRevenue: number;
  };
  /** Vorjahresmonat des Scopes (MB1-Historie); null ⇒ „—". */
  previousYearTotalCents?: number | null;
  /** Vormonat/Vorperiode des Scopes; null ⇒ „—". */
  previousPeriodTotalCents?: number | null;
  /**
   * STAT3b — Kanal-Auswertung (Wolt / direkt / SoUse) je Standort und gesamt,
   * fertig aus `takeawayMatrix`; Δ bezieht sich auf die Vorperiode.
   */
  takeaway: TakeawayMatrix;
  /** Anteil des Take-Away am Gesamtumsatz (aus takeawaySharePctOfTotal). */
  takeawaySharePct: number | null;
  tips: {
    serviceCents: number;
    kitchenCents: number;
    totalCents: number;
  };
  /**
   * STAT3h — Modell-Ergebnis vor Steuern aus dem COCO-Break-even. Nur gesetzt,
   * wenn Kalendermonat-Modus, abgeschlossener Monat, Scope „Alle Standorte" und
   * berechenbarer Break-even zusammenkommen; sonst entfällt die Zeile ersatzlos.
   */
  preTaxModel?: {
    resultCents: number;
    netRevenueCents: number;
    breakEvenMonthCents: number;
    /** Deckungsbeitragsquote in Prozent (db × 100). */
    dbPct: number;
  };
  personnel: {
    netHours: number;
    laborCostCents: number;
    ratioPct: number | null;
    staffWithoutRateNames: string[];
  };
  /**
   * Grafik A — Tagesumsätze des Berichtszeitraums (Gesamt je Geschäftstag).
   * STAT3c: im Scope „Alle Standorte" trägt jeder Tag zusätzlich die
   * Standort-Anteile (`byLocation`); daraus werden gestapelte Balken. Fehlt das
   * Feld (Einzelstandort), bleibt der Balken einfarbig.
   */
  dailyRevenue: Array<{
    businessDate: string;
    totalCents: number;
    byLocation?: Array<{ name: string; cents: number }>;
  }>;
  /** STAT2 — Kennzahlen der Kacheln; Werte kommen fertig aus `derivedKpis`. */
  guestHours?: {
    guestTotal: number;
    workHours: number;
    revenuePerGuestCents: number | null;
    revenuePerWorkHourCents: number | null;
  };
  /**
   * Grafik B — 13-Monats-Verlauf aus der MB1-Monatsmatrix. Fehlt der Block
   * (freier Zeitraum), entfällt die Grafik.
   */
  monthly?: {
    monthLabels: string[];
    series: Array<{ name: string; values: Array<number | null> }>;
  };
  /**
   * STAT3f — kumulierter 5-Jahres-Vergleich (Jan…M) je Standort; kommt fertig
   * aus `ytdByYear`. Fehlt der Block (freier Zeitraum), entfällt die Grafik.
   */
  ytdCompare?: {
    /** Letzter kumulierter Monat (1..12); 0 ⇒ leeres Fenster ⇒ Hinweis. */
    throughMonth: number;
    years: number[];
    series: Array<{ name: string; values: Array<number | null> }>;
    incompleteYears: number[];
  };
  comparison: Array<{
    locationName: string;
    totalCents: number;
    tipTotalCents: number;
    ratioPct: number | null;
    netHours: number;
    laborCostCents: number;
    hasMissingRate: boolean;
    guestTotal?: number;
    perGuestCents?: number | null;
    perHourCents?: number | null;
    /** Vorjahresmonat je Standort (MB1); null ⇒ „—". */
    prevYearTotalCents?: number | null;
    /** Vormonatsfenster je Standort; null ⇒ „—". */
    prevTotalCents?: number | null;
    /** STAT2d — Trinkgeld-Quote in Prozent (Trinkgeld ÷ Haus-Umsatz); null ⇒ „—". */
    tipRatePct?: number | null;
  }>;
};

/** Centgenaues Euro-Format — bleibt für Tests/andere Verbraucher bestehen. */
export function fmtEur(cents: number): string {
  return `${fmtCents(cents)} €`;
}

/**
 * STAT3d — PDF-Präsentation: Euro-Beträge kaufmännisch auf ganze Euro (Tausenderpunkt).
 * Reine Formatschicht: es wird nichts nachjustiert, jede Zahl einzeln aus dem
 * centgenauen Wert gerundet — die Fußnote trägt die ±1-€-Differenz.
 * Quoten und Deltas behalten bewusst ihre Nachkommastelle, weil sonst z. B. die
 * TG-Quoten-Aussage (8,9 vs. 9,0) im PDF verschwinden würde.
 */
export function fmtEurRounded(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const euro = cents / 100;
  // Kaufmännisch, symmetrisch: ,50 immer weg von der Null (2,50 → 3; -2,50 → -3).
  const rounded = Math.sign(euro) * Math.round(Math.abs(euro));
  return `${rounded.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
}

/** STAT3d — Stunden im PDF ohne Nachkommastellen: „5.464 h". */
export function fmtHoursRoundedDe(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  const rounded = Math.sign(h) * Math.round(Math.abs(h));
  return `${rounded.toLocaleString("de-DE", { maximumFractionDigits: 0 })} h`;
}

/**
 * STAT3c — eine Farbzuordnung für Grafik A (gestapelte Tagesbalken) und
 * Grafik B (13-Monats-Verlauf), damit EINE Legende beide Grafiken erklärt.
 */
const SERIES_PALETTE: Array<[number, number, number]> = [
  [60, 90, 140],
  [190, 110, 60],
  [90, 140, 100],
];

/**
 * STAT3g — EIN vertikaler Abstand zwischen Blockende und nächster Überschrift.
 * Vorher standen hier gestreute Werte (10/12/18/20), wodurch einzelne
 * Überschriften an der vorigen Tabelle klebten.
 */
const BLOCK_GAP = 16;

/** STAT3f — Monatsnamen für die Überschrift „Jan–Juli kumuliert …". */
const MONTH_NAMES_LONG = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/**
 * STAT3i — Nutzbreite einer A4-Seite in Punkt (595 − 2 × 36 Rand). Als Konstante
 * exportiert, damit Tests die Breite einzeiliger Wertezeilen dagegen messen
 * können, ohne jsPDF zu instanziieren.
 */
export const PDF_USABLE_WIDTH = 523;

/** STAT3i — Überschrift der Modell-Ergebniszeile (Test- und Zeichen-Quelle). */
export const PRE_TAX_HEADING = "Ergebnis vor Steuern (Modell)";

/**
 * STAT3i — Trinkgeld-Einzeiler als reiner Text (nur Formatierung, keine Logik).
 * Quoten kommen ausschließlich aus `tipRatePct`.
 */
export function tipSummaryText(
  tips: StatistikPdfData["tips"],
  houseCents: number,
): string {
  return (
    `Service ${fmtEurRounded(tips.serviceCents)} (${fmtPctDe(
      tipRatePct(tips.serviceCents, houseCents),
    )} vom Haus) · Küche ${fmtEurRounded(tips.kitchenCents)} (${fmtPctDe(
      tipRatePct(tips.kitchenCents, houseCents),
    )}) · Gesamt ${fmtEurRounded(tips.totalCents)} (${fmtPctDe(
      tipRatePct(tips.totalCents, houseCents),
    )})`
  );
}

/**
 * STAT3i — Text NACH dem gefärbten Betrag der Modell-Ergebniszeile.
 *
 * Bewusst nur WinAnsi-Zeichen: das typografische Minus (U+2212) hat jsPDF in
 * einen Ersatzzeichen-/Sperrsatz-Modus gezwungen (siehe assertWinAnsiSafe im
 * Test). Trenner ist derselbe Mittelpunkt wie in der Trinkgeld-Zeile.
 */
export function preTaxTailText(preTax: NonNullable<StatistikPdfData["preTaxModel"]>): string {
  return `· netto ${fmtEurRounded(preTax.netRevenueCents)} - BE ${fmtEurRounded(
    preTax.breakEvenMonthCents,
  )} · DB-Quote ${fmtPctDe(preTax.dbPct)}`;
}

/** Nenner 0 ⇒ „—" (kein 0-Fake im PDF). */
function fmtEurOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : fmtEurRounded(cents);
}

/** STAT3 — deutsches Zahlformat: „5.464,48 h" (nie Punkt-Dezimalen). */
export function fmtHoursDe(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  return `${h.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

/** STAT3 — deutsches Zahlformat: „28,8 %". */
export function fmtPctDe(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** STAT3 — vorzeichenbehaftetes Delta: „+3,4 %", „-12,1 %", „±0,0 %". */
export function fmtDeltaPctDe(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  // ASCII-Minus: die jsPDF-Standardschrift (WinAnsi) kennt U+2212 nicht.
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "±";
  return `${sign}${fmtPctDe(Math.abs(pct))}`;
}

function fmtCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("de-DE");
}

/**
 * STAT3e — EINE Stelle entscheidet Vorzeichen ⇒ Farbe. Gedeckte, druckfeste
 * Töne: die Zahl mit Vorzeichen trägt allein, die Farbe ist nur Blickführung.
 * Neutrale Werte („—", „±0,0 %") behalten die Standardfarbe.
 *
 * Erkennt beide Minus-Varianten (ASCII "-" und typografisches U+2212), weil die
 * PDF-Formatierer ASCII nutzen, die Bildschirm-Formatierer aber U+2212.
 */
const DELTA_UP: [number, number, number] = [35, 105, 65];
const DELTA_DOWN: [number, number, number] = [150, 45, 45];
const DELTA_NEUTRAL: [number, number, number] = [20, 20, 20];

export function deltaTone(text: string | null | undefined): [number, number, number] {
  const first = (text ?? "").trim().charAt(0);
  if (first === "+") return DELTA_UP;
  if (first === "-" || first === "\u2212") return DELTA_DOWN;
  return DELTA_NEUTRAL;
}

/** STAT3e — Kanalnamen im PDF kürzen (Tabellenbreite); Datenmodell unberührt. */
const PDF_CHANNEL_LABELS: Record<string, string> = {
  "Takeaway direkt (Telefon/Abholung)": "Direkt (Tel./Abholung)",
};

export function pdfChannelLabel(name: string): string {
  return PDF_CHANNEL_LABELS[name] ?? name;
}

/** Delta gegen eine Basis; ohne Basis oder außerhalb des Monatsmodus „—". */
function deltaLabel(
  currentCents: number,
  baseCents: number | null | undefined,
  enabled: boolean,
): string {
  if (!enabled) return "—";
  return fmtDeltaPctDe(growthPct(currentCents, baseCents ?? null));
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function isSunday(iso: string): boolean {
  return parseIso(iso).getUTCDay() === 0;
}

export async function generateStatistikPdf(
  data: StatistikPdfData,
): Promise<{ doc: jsPDF; blob: Blob; fileName: string }> {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPDF("portrait", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 36;
  const usable = pageWidth - marginX * 2;
  const cmp = data.calendarMonth;

  // ── Kopf ────────────────────────────────────────────────────────────────
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(`Statistik-Bericht ${data.monthLabel} · ${data.scopeLabel}`, marginX, 44);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Erstellt am ${data.generatedAtLabel}`, marginX, 56);

  // ── KPI-Zeile (gezeichnete Boxen, kein autoTable) ───────────────────────
  const gh = data.guestHours;
  const boxY = 66;
  const boxH = 74;
  const gap = 8;
  const boxW = (usable - gap * 3) / 4;

  type Kpi = { title: string; value: string; lead: string; leadLabel: string; foot: string };
  const kpis: Kpi[] = [
    {
      title: "Gesamtumsatz",
      value: fmtEurRounded(data.revenue.totalCents),
      lead: deltaLabel(data.revenue.totalCents, data.previousYearTotalCents, cmp),
      leadLabel: "vs. Vorjahresmonat",
      foot: `Vormonat: ${deltaLabel(data.revenue.totalCents, data.previousPeriodTotalCents, cmp)}`,
    },
    {
      title: "Gäste",
      value: fmtCount(gh?.guestTotal),
      lead: fmtEurOrDash(gh?.revenuePerGuestCents ?? null),
      leadLabel: "Ø je Gast (Haus)",
      foot: `Tage mit Umsatz: ${fmtCount(data.revenue.daysWithRevenue)}`,
    },
    {
      title: "Personalquote",
      value: fmtPctDe(data.personnel.ratioPct),
      lead: fmtEurRounded(data.personnel.laborCostCents),
      leadLabel: "Basis-Lohnkosten",
      // STAT3b: kein Umsatzwert in der Lohnkosten-Kachel (missverständlich).
      // Der Takeaway-Gesamtwert steht in der Kopfzeile des Takeaway-Blocks.
      foot: "Basis-Brutto ohne AG-SV/SFN",
    },
    {
      title: "Umsatz je Arbeitsstunde",
      value: fmtEurOrDash(gh?.revenuePerWorkHourCents ?? null),
      lead: fmtHoursRoundedDe(data.personnel.netHours),
      leadLabel: "Netto-Stunden",
      foot: `Erfasst: ${fmtHoursRoundedDe(gh?.workHours)}`,
    },
  ];

  kpis.forEach((k, i) => {
    const x = marginX + i * (boxW + gap);
    doc.setDrawColor(200);
    doc.setFillColor(247, 247, 247);
    doc.rect(x, boxY, boxW, boxH, "FD");
    doc.setTextColor(90);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.text(k.title, x + 6, boxY + 13);
    doc.setTextColor(20);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(k.value, x + 6, boxY + 30);
    doc.setFontSize(13);
    // STAT3e — Kachel-Deltas dezent einfärben (Bestandswerte bleiben neutral).
    const leadTone = deltaTone(k.lead);
    doc.setTextColor(leadTone[0], leadTone[1], leadTone[2]);
    doc.text(k.lead, x + 6, boxY + 49);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.text(k.leadLabel, x + 6, boxY + 59);
    const footDelta = k.foot.split(":")[1];
    const footTone = deltaTone(footDelta);
    doc.setTextColor(footTone[0], footTone[1], footTone[2]);
    doc.text(k.foot, x + 6, boxY + 68);
    doc.setTextColor(20);
  });

  let cursorY = boxY + boxH + BLOCK_GAP;

  // STAT3c/3f/3g — EINE Farbzuordnung und EINE Legenden-Funktion für alle
  // Grafiken: erst die Monatsreihen (Grafik B), dann die Standorte der
  // Tagesbalken, dann die YTD-Reihen. Gleicher Standort ⇒ gleiche Farbe in
  // jeder Grafik. Steht bewusst vor dem ersten Block, damit die Reihenfolge der
  // gezeichneten Blöcke die Farbzuordnung nicht verschiebt.
  const seriesColorIndex = new Map<string, number>();
  const registerSeries = (name: string) => {
    if (!seriesColorIndex.has(name)) seriesColorIndex.set(name, seriesColorIndex.size);
  };
  (data.monthly?.series ?? []).forEach((s) => registerSeries(s.name));
  // Standortnamen der Tagesbalken in Reihenfolge des ersten Auftretens.
  const stackNames: string[] = [];
  for (const day of data.dailyRevenue) {
    for (const entry of day.byLocation ?? []) {
      if (!stackNames.includes(entry.name)) stackNames.push(entry.name);
    }
  }
  stackNames.forEach(registerSeries);
  (data.ytdCompare?.series ?? []).forEach((s) => registerSeries(s.name));
  const colorOf = (name: string): [number, number, number] =>
    SERIES_PALETTE[(seriesColorIndex.get(name) ?? 0) % SERIES_PALETTE.length]!;
  /**
   * STAT3e — Legende rechtsbündig auf der Titelzeile: erst Breite messen, dann
   * am rechten Rand beginnen. So klebt sie nie an der Abschnittsüberschrift.
   */
  const drawLegend = (
    names: string[],
    y: number,
    marker: (x: number, y: number, color: [number, number, number]) => void,
  ) => {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    const widths = names.map((n) => doc.getTextWidth(n));
    let total = 0;
    for (const w of widths) total += w + 16;
    let x = marginX + usable - total + 4;
    names.forEach((name, i) => {
      const c = colorOf(name);
      marker(x, y, c);
      doc.setTextColor(60);
      doc.text(name, x + 6, y + 3);
      x += 16 + (widths[i] ?? 0);
    });
    doc.setTextColor(20);
  };

  // ── Standort-Vergleich (die wichtigste Tabelle: zuerst) ─────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Standort-Vergleich", marginX, cursorY);
  const hasMissingAny = data.comparison.some((c) => c.hasMissingRate);
  if (data.comparison.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Keine Standorte vorhanden.", marginX, cursorY + 13);
    cursorY += 8 + BLOCK_GAP;
  } else {
    const body = data.comparison.map((c) => [
      c.locationName,
      fmtEurRounded(c.totalCents),
      deltaLabel(c.totalCents, c.prevYearTotalCents, cmp),
      deltaLabel(c.totalCents, c.prevTotalCents, cmp),
      fmtEurRounded(c.tipTotalCents),
      fmtPctDe(c.tipRatePct ?? null),
      `${fmtPctDe(c.ratioPct)}${c.hasMissingRate ? " *" : ""}`,
      fmtHoursRoundedDe(c.netHours),
      fmtEurOrDash(c.perGuestCents ?? null),
      fmtEurOrDash(c.perHourCents ?? null),
    ]);
    // Summenzeile: fertige Gesamtwerte, keine Neuberechnung im PDF.
    body.push([
      "Gesamt",
      fmtEurRounded(data.revenue.totalCents),
      deltaLabel(data.revenue.totalCents, data.previousYearTotalCents, cmp),
      deltaLabel(data.revenue.totalCents, data.previousPeriodTotalCents, cmp),
      fmtEurRounded(data.tips.totalCents),
      fmtPctDe(tipRatePct(data.tips.totalCents, data.revenue.houseCents)),
      `${fmtPctDe(data.personnel.ratioPct)}${hasMissingAny ? " *" : ""}`,
      fmtHoursRoundedDe(data.personnel.netHours),
      fmtEurOrDash(gh?.revenuePerGuestCents ?? null),
      fmtEurOrDash(gh?.revenuePerWorkHourCents ?? null),
    ]);
    autoTable(doc, {
      startY: cursorY + 5,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 7.5, cellPadding: 3, overflow: "visible" },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontSize: 7,
        halign: "right",
        valign: "middle",
      },
      columnStyles: {
        0: { cellWidth: 80, halign: "left" },
        1: { cellWidth: 60, halign: "right" },
        2: { cellWidth: 48, halign: "right" },
        3: { cellWidth: 48, halign: "right" },
        4: { cellWidth: 54, halign: "right" },
        5: { cellWidth: 40, halign: "right" },
        6: { cellWidth: 50, halign: "right" },
        7: { cellWidth: 50, halign: "right" },
        8: { cellWidth: 46, halign: "right" },
        9: { cellWidth: 46, halign: "right" },
      },
      head: [
        [
          "Standort",
          "Umsatz",
          "vs. Vorjahr",
          "vs. Vormonat",
          "Trinkgeld ges.",
          "TG-Quote",
          "Pers.-Quote",
          "Netto-Std.",
          "€ / Gast",
          "€ / Std.",
        ],
      ],
      body,
      didParseCell: (hook) => {
        if (hook.section === "body" && hook.row.index === body.length - 1) {
          hook.cell.styles.fontStyle = "bold";
        }
        if (hook.section === "head" && hook.column.index === 0) {
          hook.cell.styles.halign = "left";
        }
        // STAT3e — nur Veränderungsspalten färben (2 = vs. Vorjahr, 3 = vs. Vormonat).
        if (hook.section === "body" && (hook.column.index === 2 || hook.column.index === 3)) {
          hook.cell.styles.textColor = deltaTone(hook.cell.text.join(""));
        }
      },
      theme: "grid",
    });
    cursorY = lastY(doc) + BLOCK_GAP;
  }

  const preTax = data.preTaxModel;
  // ── STAT3b — Take-Away-Kanäle (je Standort, Gesamt, Δ Vorperiode) ───────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Take-Away-Kanäle", marginX, cursorY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  const headLine = doc.splitTextToSize(
    `Haus ${fmtEurRounded(data.revenue.houseCents)} · Takeaway ${fmtEurRounded(
      data.revenue.takeawayCents,
    )} (Anteil ${fmtPctDe(data.takeawaySharePct)})`,
    usable - 90,
  );
  doc.text(headLine, marginX + 90, cursorY);
  const tw = data.takeaway;
  const twRow = (r: (typeof tw)["rows"][number]): string[] => [
    pdfChannelLabel(r.name),
    ...r.perLocationCents.map((c) => fmtEurRounded(c)),
    fmtEurRounded(r.totalCents),
    fmtPctDe(r.sharePct),
    fmtDeltaPctDe(r.deltaPct),
  ];
  const twBody = [...tw.rows.map(twRow), twRow(tw.sum)];
  const twDeltaCol = tw.locationNames.length + 3;
  autoTable(doc, {
    startY: cursorY + 5,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "visible", halign: "right" },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontSize: 7, halign: "right" },
    columnStyles: {
      0: { cellWidth: 116, halign: "left", fontStyle: "bold" },
    },
    head: [["Kanal", ...tw.locationNames, "Gesamt", "Anteil", "vs. Vorperiode"]],
    body: twBody,
    didParseCell: (hook) => {
      if (hook.section === "body" && hook.row.index === twBody.length - 1) {
        hook.cell.styles.fontStyle = "bold";
      }
      if (hook.section === "head" && hook.column.index === 0) {
        hook.cell.styles.halign = "left";
      }
      // STAT3e — nur die Δ-Spalte färben; „Anteil" ist ein Bestandswert.
      if (hook.section === "body" && hook.column.index === twDeltaCol) {
        hook.cell.styles.textColor = deltaTone(hook.cell.text.join(""));
      }
    },
    theme: "grid",
  });
  let twEnd = lastY(doc);
  if (tw.warning) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text(tw.warning, marginX, twEnd + 10);
    twEnd += 10;
  }
  cursorY = twEnd + BLOCK_GAP;

  // ── Grafik A — Tagesumsatz-Balken ───────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Tagesumsatz", marginX, cursorY);
  const stacked = stackNames.length > 0;
  if (stacked) {
    drawLegend(stackNames, cursorY - 5, (x, y, c) => {
      doc.setFillColor(c[0], c[1], c[2]);
      doc.rect(x, y, 4, 4, "F");
    });
  }
  cursorY += 6;
  const axisW = 42;
  const chartA: ChartArea = {
    x: marginX + axisW,
    y: cursorY,
    width: usable - axisW,
    height: 100,
  };
  if (data.dailyRevenue.length === 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Keine Umsätze im gewählten Zeitraum.", marginX, cursorY + 12);
    cursorY += 8 + BLOCK_GAP;
  } else {
    const stackedGeo = stacked
      ? stackedBarChartGeometry(
          stackNames.map((name) => ({
            name,
            values: data.dailyRevenue.map(
              (d) => (d.byLocation ?? []).find((e) => e.name === name)?.cents ?? 0,
            ),
          })),
          chartA,
          { gapRatio: 0.25, tickCount: 4 },
        )
      : null;
    const flatGeo = stackedGeo
      ? null
      : barChartGeometry(
          data.dailyRevenue.map((d) => d.totalCents),
          chartA,
          { gapRatio: 0.25, tickCount: 4 },
        );
    const ticks = stackedGeo ? stackedGeo.ticks : flatGeo!.ticks;
    const slots = stackedGeo
      ? stackedGeo.stacks.map((s) => ({ index: s.index, x: s.x, width: s.width }))
      : flatGeo!.bars.map((b) => ({ index: b.index, x: b.x, width: b.width }));
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    for (const t of ticks) {
      doc.setDrawColor(225);
      doc.line(chartA.x, t.y, chartA.x + chartA.width, t.y);
      doc.setTextColor(120);
      doc.text(formatTsd(t.value), chartA.x - 4, t.y + 2, { align: "right" });
    }
    doc.setTextColor(20);
    if (stackedGeo) {
      // Nur die Verteilung zeigen: Segmentfarbe je Standort, KEINE Beschriftung.
      // Die Sonntags-Aufhellung entfällt hier (die fette Tagesnummer bleibt).
      for (const stack of stackedGeo.stacks) {
        for (const seg of stack.segments) {
          if (seg.height <= 0) continue;
          const c = colorOf(seg.name);
          doc.setFillColor(c[0], c[1], c[2]);
          doc.rect(seg.x, seg.y, seg.width, seg.height, "F");
        }
      }
    } else {
      for (const bar of flatGeo!.bars) {
        const sunday = isSunday(data.dailyRevenue[bar.index]!.businessDate);
        if (sunday) doc.setFillColor(120, 140, 175);
        else doc.setFillColor(60, 90, 140);
        if (bar.height > 0) doc.rect(bar.x, bar.y, bar.width, bar.height, "F");
      }
    }
    // Tagesachse: jeder Tag als Nummer, Sonntage fett markiert.
    doc.setFontSize(5.5);
    for (const slot of slots) {
      const iso = data.dailyRevenue[slot.index]!.businessDate;
      doc.setFont("helvetica", isSunday(iso) ? "bold" : "normal");
      doc.text(iso.slice(8, 10), slot.x + slot.width / 2, chartA.y + chartA.height + 8, {
        align: "center",
      });
    }
    doc.setFont("helvetica", "normal");
    cursorY = chartA.y + chartA.height + 4 + BLOCK_GAP;
  }

  // ── Grafik B — 13-Monats-Verlauf ────────────────────────────────────────
  const mv = data.monthly;
  if (mv && mv.series.length > 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("13-Monats-Verlauf", marginX, cursorY);
    cursorY += 6;
    const chartB: ChartArea = {
      x: marginX + axisW,
      y: cursorY,
      width: usable - axisW,
      // STAT3e — geschnittene Achse bringt mehr Auflösung als Höhe.
      height: 80,
    };
    const geo = lineChartGeometry(mv.series, chartB, { tickCount: 4, baseline: "nice" });
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    for (const t of geo.ticks) {
      doc.setDrawColor(225);
      doc.line(chartB.x, t.y, chartB.x + chartB.width, t.y);
      doc.setTextColor(120);
      doc.text(formatTsd(t.value), chartB.x - 4, t.y + 2, { align: "right" });
    }
    doc.setTextColor(20);
    geo.series.forEach((s) => {
      const color = colorOf(s.name);
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.setFillColor(color[0], color[1], color[2]);
      doc.setLineWidth(1);
      let prev: { x: number; y: number } | null = null;
      for (const p of s.points) {
        if (p === null) {
          prev = null;
          continue;
        }
        if (prev) doc.line(prev.x, prev.y, p.x, p.y);
        doc.circle(p.x, p.y, 1.4, "F");
        prev = p;
      }
      doc.setLineWidth(0.5);
    });
    // STAT3i — keine zweite Legende: die Farbzuordnung steht EINMAL am
    // Tagesumsatz und gilt (gleicher Standort ⇒ gleiche Farbe) für alle Grafiken.
    doc.setDrawColor(200);
    doc.setFontSize(5.5);
    doc.setTextColor(90);
    mv.monthLabels.forEach((label, i) => {
      const x = geo.slotX[i];
      if (x === undefined) return;
      doc.text(label, x, chartB.y + chartB.height + 8, { align: "center" });
    });
    doc.setTextColor(20);
    cursorY = chartB.y + chartB.height + 4 + BLOCK_GAP;
  }

  // ── STAT3f — Jan–M kumuliert im 5-Jahres-Vergleich (längster Zeithorizont) ─
  // STAT3g: steht am Ende der Grafik-Sequenz (Monat → Jahr → Langfrist).
  const ytd = data.ytdCompare;
  const ytdIncomplete: number[] = ytd?.incompleteYears ?? [];
  if (ytd) {
    const heading =
      ytd.throughMonth > 0
        ? `Jan–${MONTH_NAMES_LONG[ytd.throughMonth - 1]} kumuliert im ${ytd.years.length}-Jahres-Vergleich`
        : "Kumulierter Jahresvergleich";
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(heading, marginX, cursorY);
    if (ytd.throughMonth === 0 || ytd.series.length === 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        "Entfällt: im laufenden Januar liegt noch kein abgeschlossener Monat vor.",
        marginX,
        cursorY + 13,
      );
      cursorY += 8 + BLOCK_GAP;
    } else {
      // STAT3i — Legende nur am Tagesumsatz (siehe Grafik A).
      cursorY += 6;
      const chartC: ChartArea = {
        x: marginX + axisW,
        y: cursorY,
        width: usable - axisW,
        height: 70,
      };
      const geoC = groupedBarChartGeometry(
        ytd.years.map((year, i) => ({
          label: String(year),
          values: ytd.series.map((s) => s.values[i] ?? null),
        })),
        chartC,
        // STAT3i — dichteres Tick-Ziel: der oberste Rasterwert liegt damit
        // näher über dem Datenmaximum (weniger Luft über den Balken).
        { gapRatio: 0.3, tickCount: 5, seriesNames: ytd.series.map((s) => s.name) },
      );
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      for (const t of geoC.ticks) {
        doc.setDrawColor(225);
        doc.line(chartC.x, t.y, chartC.x + chartC.width, t.y);
        doc.setTextColor(120);
        doc.text(formatTsd(t.value), chartC.x - 4, t.y + 2, { align: "right" });
      }
      doc.setTextColor(20);
      for (const group of geoC.groups) {
        for (const bar of group.bars) {
          if (bar.value === null) continue;
          const c = colorOf(bar.name);
          doc.setFillColor(c[0], c[1], c[2]);
          if (bar.height > 0) doc.rect(bar.x, bar.y, bar.width, bar.height, "F");
          // STAT3g — Wertelabel ohne Einheit: „T€" trägt die Achse.
          doc.setFontSize(5.5);
          doc.setTextColor(90);
          doc.text(formatTsdPlain(bar.value), bar.x + bar.width / 2, bar.y - 2, {
            align: "center",
          });
          doc.setTextColor(20);
        }
        // Jahreszahl steht auch bei Lücken-Jahren unter der Achse.
        doc.setFontSize(6.5);
        doc.text(group.label, group.x + group.width / 2, chartC.y + chartC.height + 9, {
          align: "center",
        });
      }
      cursorY = chartC.y + chartC.height + 4 + BLOCK_GAP;
    }
  }

  // ── STAT3i — Wertezeilen ans Ende: erst die Grafiken, dann die Einzeiler ──
  // Trinkgeld-Quoten kommen AUSSCHLIESSLICH aus `tipRatePct` (Trinkgeld ÷
  // Haus-Umsatz) — dieselbe Formel wie die TG-Quote-Spalte der Standort-Tabelle.
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Trinkgeld", marginX, cursorY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  const tipLine = doc.splitTextToSize(
    tipSummaryText(data.tips, data.revenue.houseCents),
    usable - 90,
  );
  doc.text(tipLine, marginX + 90, cursorY);
  cursorY += BLOCK_GAP + 8 * ((Array.isArray(tipLine) ? tipLine.length : 1) - 1);

  // ── STAT3h/3i — Ergebnis vor Steuern (Modell) ────────────────────────────
  // Der Betrag ist ein Bewertungswert, deshalb dieselbe Färbung wie Deltas.
  // Nach dem gefärbten Betrag werden Font UND Textfarbe explizit zurückgesetzt.
  if (preTax) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(PRE_TAX_HEADING, marginX, cursorY);
    const headingWidth = doc.getTextWidth(PRE_TAX_HEADING);
    doc.setFontSize(7.5);
    const amount = fmtEurRounded(preTax.resultCents);
    const tone = deltaTone(preTax.resultCents < 0 ? `-${amount}` : `+${amount}`);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(tone[0], tone[1], tone[2]);
    const amountX = marginX + headingWidth + 10;
    doc.text(amount, amountX, cursorY);
    const amountWidth = doc.getTextWidth(amount);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20);
    const tailX = amountX + amountWidth + 6;
    doc.text(preTaxTailText(preTax), tailX, cursorY);
    cursorY += BLOCK_GAP;
  }

  // ── Fußnoten ────────────────────────────────────────────────────────────
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "italic");
  const notes: string[] = [
    "Basis-Brutto (Netto-Stunden × Stundenlohn) — ohne AG-SV, SFN, Zweitsatz. Detailzahlen je Tag und Mitarbeiter stehen in COCO.",
    // ASCII statt Delta-Zeichen: die jsPDF-Standardschrift (WinAnsi) kennt kein U+0394.
    "Kanal-Vergleich gegen die Vorperiode; ein Vorjahresvergleich je Kanal liegt in der Monatshistorie nicht vor.",
    // STAT2d — Bezugsbasis der Quote muss im Dokument stehen.
    "TG-Quote bezogen auf Haus-Umsatz (Trinkgeld gesamt / Haus-Umsatz).",
    // STAT3d — Rundung ist Präsentation, keine Nachjustierung der Summen.
    "Beträge kaufmännisch auf ganze Euro gerundet; Summen können rundungsbedingt um ±1 € abweichen. Centgenaue Werte in COCO.",
  ];
  if (preTax) {
    notes.push(
      "Ergebnis vor Steuern als Modellrechnung: Kostenstruktur und USt-Mix der rollierenden 12-Monats-BWA auf den Kassenumsatz angewandt (30 Öffnungstage-Konvention); ersetzt nicht die BWA des Steuerbüros.",
    );
  }
  if (hasMissingAny || data.personnel.staffWithoutRateNames.length > 0) {
    notes.push(
      `* Ohne hinterlegten Stundenlohn: ${
        data.personnel.staffWithoutRateNames.join(", ") || "einzelne Mitarbeiter"
      } — Quote untertreibt.`,
    );
  }
  if (!cmp) {
    notes.push("Freier Zeitraum: Vorjahres-/Vormonatsvergleich und der Monatsverlauf entfallen.");
  }
  // STAT3f — Lücken-Jahre benennen: ein fehlender Monat ⇒ kein Balken.
  for (const year of ytdIncomplete) {
    notes.push(`${year}: Historie unvollständig — im kumulierten Vergleich ohne Balken.`);
  }
  for (const note of notes) {
    const lines = doc.splitTextToSize(note, usable);
    doc.text(lines, marginX, cursorY);
    cursorY += 8 * (Array.isArray(lines) ? lines.length : 1);
  }

  const blob = doc.output("blob");
  const fileName = `Statistik_${data.monthLabel.replace(/\s+/g, "-")}_${data.scopeLabel.replace(
    /\s+/g,
    "-",
  )}.pdf`;
  return { doc, blob, fileName };
}
