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
import {
  barChartGeometry,
  formatTsd,
  lineChartGeometry,
  type ChartArea,
} from "./statistik-pdf-charts";

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
  /** STAT1b — Take-Away-Segmente (Wolt / direkt / SoUse) aus takeawayDonutSegments. */
  takeawaySegments: Array<{ name: string; amountCents: number }>;
  takeawaySegmentsWarning: string | null;
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
  /** Grafik A — Tagesumsätze des Berichtszeitraums (Gesamt je Geschäftstag). */
  dailyRevenue: Array<{ businessDate: string; totalCents: number }>;
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
  }>;
};

function fmtEur(cents: number): string {
  return `${fmtCents(cents)} €`;
}

/** Nenner 0 ⇒ „—" (kein 0-Fake im PDF). */
function fmtEurOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : fmtEur(cents);
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
      value: fmtEur(data.revenue.totalCents),
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
      lead: fmtEur(data.personnel.laborCostCents),
      leadLabel: "Basis-Lohnkosten",
      foot: `Takeaway: ${fmtEur(data.revenue.takeawayCents)}`,
    },
    {
      title: "Umsatz je Arbeitsstunde",
      value: fmtEurOrDash(gh?.revenuePerWorkHourCents ?? null),
      lead: fmtHoursDe(data.personnel.netHours),
      leadLabel: "Netto-Stunden",
      foot: `Erfasst: ${fmtHoursDe(gh?.workHours)}`,
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
    doc.text(k.lead, x + 6, boxY + 49);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.text(k.leadLabel, x + 6, boxY + 59);
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
      fmtEur(c.totalCents),
      deltaLabel(c.totalCents, c.prevYearTotalCents, cmp),
      deltaLabel(c.totalCents, c.prevTotalCents, cmp),
      fmtEur(c.tipTotalCents),
      `${fmtPctDe(c.ratioPct)}${c.hasMissingRate ? " *" : ""}`,
      fmtHoursDe(c.netHours),
      fmtEurOrDash(c.perGuestCents ?? null),
      fmtEurOrDash(c.perHourCents ?? null),
    ]);
    // Summenzeile: fertige Gesamtwerte, keine Neuberechnung im PDF.
    body.push([
      "Gesamt",
      fmtEur(data.revenue.totalCents),
      deltaLabel(data.revenue.totalCents, data.previousYearTotalCents, cmp),
      deltaLabel(data.revenue.totalCents, data.previousPeriodTotalCents, cmp),
      fmtEur(data.tips.totalCents),
      `${fmtPctDe(data.personnel.ratioPct)}${hasMissingAny ? " *" : ""}`,
      fmtHoursDe(data.personnel.netHours),
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
        0: { cellWidth: 88, halign: "left" },
        1: { cellWidth: 66, halign: "right" },
        2: { cellWidth: 54, halign: "right" },
        3: { cellWidth: 54, halign: "right" },
        4: { cellWidth: 60, halign: "right" },
        5: { cellWidth: 50, halign: "right" },
        6: { cellWidth: 56, halign: "right" },
        7: { cellWidth: 46, halign: "right" },
        8: { cellWidth: 46, halign: "right" },
      },
      head: [
        [
          "Standort",
          "Umsatz",
          "vs. Vorjahr",
          "vs. Vormonat",
          "Trinkgeld ges.",
          "Quote",
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
      ["Service", ...tipCols.map((t) => fmtEur(t.serviceCents)), fmtEur(data.tips.serviceCents)],
      ["Küche", ...tipCols.map((t) => fmtEur(t.kitchenCents)), fmtEur(data.tips.kitchenCents)],
      ["Gesamt", ...tipCols.map((t) => fmtEur(t.totalCents)), fmtEur(data.tips.totalCents)],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 12;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Umsatzaufteilung", marginX, cursorY);
  doc.setFont("helvetica", "normal");
  const segLine =
    data.takeawaySegments.length === 0
      ? "keine Take-Away-Umsätze im Zeitraum"
      : data.takeawaySegments.map((s) => `${s.name} ${fmtEur(s.amountCents)}`).join(" · ");
  doc.text(
    `Haus ${fmtEur(data.revenue.houseCents)} · Takeaway ${fmtEur(
      data.revenue.takeawayCents,
    )} · ${segLine}`,
    marginX + 74,
    cursorY,
  );
  cursorY += 11;
  if (data.takeawaySegmentsWarning) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "italic");
    doc.text(data.takeawaySegmentsWarning, marginX, cursorY);
    cursorY += 10;
  }
  cursorY += 6;

  // ── Grafik A — Tagesumsatz-Balken ───────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Tagesumsatz", marginX, cursorY);
  cursorY += 6;
  const axisW = 42;
  const chartA: ChartArea = {
    x: marginX + axisW,
    y: cursorY,
    width: usable - axisW,
    height: 120,
  };
  if (data.dailyRevenue.length === 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.text("Keine Umsätze im gewählten Zeitraum.", marginX, cursorY + 12);
    cursorY += 24;
  } else {
    const geo = barChartGeometry(
      data.dailyRevenue.map((d) => d.totalCents),
      chartA,
      { gapRatio: 0.25, tickCount: 3 },
    );
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    for (const t of geo.ticks) {
      doc.setDrawColor(225);
      doc.line(chartA.x, t.y, chartA.x + chartA.width, t.y);
      doc.setTextColor(120);
      doc.text(formatTsd(t.value), chartA.x - 4, t.y + 2, { align: "right" });
    }
    doc.setTextColor(20);
    for (const bar of geo.bars) {
      const sunday = isSunday(data.dailyRevenue[bar.index]!.businessDate);
      if (sunday) doc.setFillColor(120, 140, 175);
      else doc.setFillColor(60, 90, 140);
      if (bar.height > 0) doc.rect(bar.x, bar.y, bar.width, bar.height, "F");
    }
    // Tagesachse: jeder Tag als Nummer, Sonntage fett markiert.
    doc.setFontSize(5.5);
    for (const bar of geo.bars) {
      const iso = data.dailyRevenue[bar.index]!.businessDate;
      doc.setFont("helvetica", isSunday(iso) ? "bold" : "normal");
      doc.text(iso.slice(8, 10), bar.x + bar.width / 2, chartA.y + chartA.height + 8, {
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
      height: 120,
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
    const palette: Array<[number, number, number]> = [
      [60, 90, 140],
      [190, 110, 60],
      [90, 140, 100],
    ];
    geo.series.forEach((s, si) => {
      const color = palette[si % palette.length]!;
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
    geo.series.forEach((s, si) => {
      const color = palette[si % palette.length]!;
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
