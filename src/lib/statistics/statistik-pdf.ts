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
    /**
     * STAT3 — kompakte 3×n-Matrix je Standort. Einzelbeträge je Mitarbeiter
     * erscheinen bewusst NICHT mehr im PDF (Bank-/Gesellschafter-Versand).
     */
    perLocation: Array<{
      locationName: string;
      serviceCents: number;
      kitchenCents: number;
      totalCents: number;
    }>;
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

  let cursorY = boxY + boxH + 18;

  // ── Standort-Vergleich (die wichtigste Tabelle: zuerst) ─────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Standort-Vergleich", marginX, cursorY);
  const hasMissingAny = data.comparison.some((c) => c.hasMissingRate);
  if (data.comparison.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("Keine Standorte vorhanden.", marginX, cursorY + 13);
    cursorY += 24;
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
    cursorY = lastY(doc) + 12;
  }

  // ── Trinkgeld kompakt (3×n) + Takeaway einzeilig ────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Trinkgeld", marginX, cursorY);
  const tipCols = data.tips.perLocation;
  autoTable(doc, {
    startY: cursorY + 5,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "visible", halign: "right" },
    headStyles: { fillColor: [230, 230, 230], textColor: 20, fontSize: 7, halign: "right" },
    columnStyles: { 0: { cellWidth: 88, halign: "left", fontStyle: "bold" } },
    head: [["Bereich", ...tipCols.map((t) => t.locationName), "Gesamt"]],
    body: [
      [
        "Service",
        ...tipCols.map((t) => fmtEurRounded(t.serviceCents)),
        fmtEurRounded(data.tips.serviceCents),
      ],
      [
        "Küche",
        ...tipCols.map((t) => fmtEurRounded(t.kitchenCents)),
        fmtEurRounded(data.tips.kitchenCents),
      ],
      [
        "Gesamt",
        ...tipCols.map((t) => fmtEurRounded(t.totalCents)),
        fmtEurRounded(data.tips.totalCents),
      ],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 12;

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
  cursorY = lastY(doc) + 10;
  if (tw.warning) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text(tw.warning, marginX, cursorY);
    cursorY += 10;
  }

  // ── Grafik A — Tagesumsatz-Balken ───────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Tagesumsatz", marginX, cursorY);
  // STAT3c — Farbindex reihenübergreifend: erst die Monatsreihen (Grafik B),
  // dann etwaige weitere Standorte der Tagesbalken. Gleicher Standort ⇒ gleiche
  // Farbe in beiden Grafiken.
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
  const colorOf = (name: string): [number, number, number] =>
    SERIES_PALETTE[(seriesColorIndex.get(name) ?? 0) % SERIES_PALETTE.length]!;
  const stacked = stackNames.length > 0;
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
    const total = widths.reduce((a, w) => a + w + 16, 0);
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
    cursorY += 24;
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
          { gapRatio: 0.25, tickCount: 3 },
        )
      : null;
    const flatGeo = stackedGeo
      ? null
      : barChartGeometry(
          data.dailyRevenue.map((d) => d.totalCents),
          chartA,
          { gapRatio: 0.25, tickCount: 3 },
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
    cursorY = chartA.y + chartA.height + 20;
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
      height: 100,
    };
    const geo = lineChartGeometry(mv.series, chartB, { tickCount: 3 });
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
    // Legende in der Titelzeile (Punkt + Name), damit sie die Fläche nicht überdeckt.
    doc.setFontSize(6.5);
    let legendX = marginX + 90;
    geo.series.forEach((s) => {
      const color = colorOf(s.name);
      doc.setFillColor(color[0], color[1], color[2]);
      doc.circle(legendX, chartB.y - 8, 1.8, "F");
      doc.setTextColor(60);
      doc.text(s.name, legendX + 4, chartB.y - 6);
      legendX += 12 + doc.getTextWidth(s.name);
    });
    doc.setTextColor(20);
    doc.setDrawColor(200);
    doc.setFontSize(5.5);
    doc.setTextColor(90);
    mv.monthLabels.forEach((label, i) => {
      const x = geo.slotX[i];
      if (x === undefined) return;
      doc.text(label, x, chartB.y + chartB.height + 8, { align: "center" });
    });
    doc.setTextColor(20);
    cursorY = chartB.y + chartB.height + 18;
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
