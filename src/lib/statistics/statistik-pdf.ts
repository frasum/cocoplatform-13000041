// PDF-Export für die M-Statistik-Seite. Reine Präsentation, keine
// Berechnungslogik. Konsumiert ausschließlich bereits geladene Daten.
// Muster wie src/lib/cash/pdfExport.ts: dynamische jspdf/jspdf-autotable
// Imports, kein Buffer, kein node:-Modul — läuft komplett im Browser.

import type jsPDF from "jspdf";
import { fmtCents } from "@/lib/format";

export type StatistikPdfData = {
  monthLabel: string;
  scopeLabel: string;
  revenue: {
    houseCents: number;
    takeawayCents: number;
    totalCents: number;
    daysWithRevenue: number;
  };
  /** STAT1b — Take-Away-Segmente (Wolt / direkt / SoUse) aus takeawayDonutSegments. */
  takeawaySegments: Array<{ name: string; amountCents: number }>;
  takeawaySegmentsWarning: string | null;
  tips: {
    serviceCents: number;
    kitchenCents: number;
    totalCents: number;
    perStaff: Array<{ name: string; department: "kitchen" | "service"; tipCents: number }>;
  };
  personnel: {
    netHours: number;
    laborCostCents: number;
    ratioPct: number | null;
    staffWithoutRateNames: string[];
  };
  dailyRevenue: Array<{
    businessDate: string;
    houseCents: number;
    takeawayCents: number;
    totalCents: number;
  }>;
  /**
   * STAT2 — Gäste/Stunden je Tag + Kennzahlen; Werte kommen fertig aus
   * `derivedKpis`. Optional: ohne Block wird der Abschnitt weggelassen.
   */
  guestHours?: {
    guestTotal: number;
    workHours: number;
    revenuePerGuestCents: number | null;
    revenuePerWorkHourCents: number | null;
    daily: Array<{
      businessDate: string;
      guestCount: number;
      workHours: number;
      perGuestCents: number | null;
      perHourCents: number | null;
    }>;
  };
  comparison: Array<{
    locationName: string;
    totalCents: number;
    tipTotalCents: number;
    ratioPct: number | null;
    netHours: number;
    laborCostCents: number;
    hasMissingRate: boolean;
    /**
     * STAT2b — Gäste/Arbeitsstunden und die beiden Dichte-Kennzahlen je
     * Standort. Werte kommen fertig aus `derivedKpis` bzw. den Stats-Feldern;
     * hier wird nichts summiert. Optional gehalten (Alt-Fixtures ohne Block).
     */
    guestTotal?: number;
    workHours?: number;
    perGuestCents?: number | null;
    perHourCents?: number | null;
  }>;
};

function fmtEur(cents: number): string {
  return `${fmtCents(cents)} €`;
}

/** STAT2 — Nenner 0 ⇒ „—" (kein 0-Fake im PDF). */
function fmtEurOrDash(cents: number | null): string {
  return cents === null ? "—" : fmtEur(cents);
}

function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toFixed(1)} %`;
}

function fmtHours(h: number): string {
  return h.toFixed(2);
}

/** STAT2b — fehlender/undefinierter Wert ⇒ „—". */
function fmtHoursOrDash(h: number | undefined): string {
  return h === undefined ? "—" : fmtHours(h);
}

function fmtCountOrDash(n: number | undefined): string {
  return n === undefined ? "—" : String(n);
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

export async function generateStatistikPdf(
  data: StatistikPdfData,
): Promise<{ doc: jsPDF; blob: Blob; fileName: string }> {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPDF("portrait", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  // Kopf
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Statistik-Bericht", pageWidth / 2, 48, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${data.monthLabel} · ${data.scopeLabel}`, pageWidth / 2, 64, { align: "center" });

  let cursorY = 84;

  // 1) Umsatz
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Umsatz", marginX, cursorY);
  autoTable(doc, {
    startY: cursorY + 6,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles: { 1: { halign: "right" } },
    head: [["Position", "Betrag"]],
    body: [
      ["Haus", fmtEur(data.revenue.houseCents)],
      ["Takeaway", fmtEur(data.revenue.takeawayCents)],
      [
        { content: "Gesamt", styles: { fontStyle: "bold" } },
        {
          content: fmtEur(data.revenue.totalCents),
          styles: { fontStyle: "bold", halign: "right" },
        },
      ],
      [
        { content: "Tage mit Umsatz", styles: { fontStyle: "normal" } },
        { content: String(data.revenue.daysWithRevenue), styles: { halign: "right" } },
      ],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 18;

  // 1b) Take-Away-Kanäle (STAT1b — gleiche Quelle wie der Donut)
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Take-Away-Kanäle", marginX, cursorY);
  if (data.takeawaySegments.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Keine Take-Away-Umsätze im gewählten Zeitraum.", marginX, cursorY + 14);
    cursorY += 24;
  } else {
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: { 1: { halign: "right" } },
      head: [["Kanal", "Betrag"]],
      body: data.takeawaySegments.map((s) => [s.name, fmtEur(s.amountCents)]),
      theme: "grid",
    });
    cursorY = lastY(doc) + 12;
    if (data.takeawaySegmentsWarning) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(data.takeawaySegmentsWarning, marginX, cursorY);
      cursorY += 12;
    }
    cursorY += 6;
  }

  // 2) Trinkgeld
  doc.setFont("helvetica", "bold");
  doc.text("Trinkgeld", marginX, cursorY);
  autoTable(doc, {
    startY: cursorY + 6,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles: { 1: { halign: "right" } },
    head: [["Position", "Betrag"]],
    body: [
      ["Service", fmtEur(data.tips.serviceCents)],
      ["Küche", fmtEur(data.tips.kitchenCents)],
      [
        { content: "Gesamt", styles: { fontStyle: "bold" } },
        { content: fmtEur(data.tips.totalCents), styles: { fontStyle: "bold", halign: "right" } },
      ],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 12;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Trinkgeld pro Mitarbeiter", marginX, cursorY);
  if (data.tips.perStaff.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Keine Trinkgeld-Auszahlungen im gewählten Zeitraum.", marginX, cursorY + 14);
    cursorY += 24;
  } else {
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: { 2: { halign: "right" } },
      head: [["Name", "Bereich", "Betrag"]],
      body: data.tips.perStaff.map((p) => [
        p.name,
        p.department === "service" ? "Service" : "Küche",
        fmtEur(p.tipCents),
      ]),
      theme: "grid",
    });
    cursorY = lastY(doc) + 18;
  }

  // 3) Personal
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Personal", marginX, cursorY);
  autoTable(doc, {
    startY: cursorY + 6,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [230, 230, 230], textColor: 20 },
    columnStyles: { 1: { halign: "right" } },
    head: [["Position", "Wert"]],
    body: [
      ["Netto-Stunden", fmtHours(data.personnel.netHours)],
      ["Basis-Lohnkosten", fmtEur(data.personnel.laborCostCents)],
      [
        { content: "Personalquote", styles: { fontStyle: "bold" } },
        {
          content: fmtPct(data.personnel.ratioPct),
          styles: { fontStyle: "bold", halign: "right" },
        },
      ],
    ],
    theme: "grid",
  });
  cursorY = lastY(doc) + 10;

  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(
    "Basis-Brutto (Netto-Stunden × Stundenlohn) — ohne AG-SV, SFN, Zweitsatz.",
    marginX,
    cursorY,
  );
  cursorY += 12;
  if (data.personnel.staffWithoutRateNames.length > 0) {
    const names = data.personnel.staffWithoutRateNames.join(", ");
    const lines = doc.splitTextToSize(
      `Ohne hinterlegten Stundenlohn: ${names} — Quote untertreibt.`,
      pageWidth - marginX * 2,
    );
    doc.text(lines, marginX, cursorY);
    cursorY += 10 * (Array.isArray(lines) ? lines.length : 1);
  }
  cursorY += 8;

  // 4) Umsatzverlauf
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Umsatzverlauf", marginX, cursorY);
  if (data.dailyRevenue.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Keine Umsätze im gewählten Zeitraum.", marginX, cursorY + 14);
    cursorY += 24;
  } else {
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
      },
      head: [["Datum", "Haus", "Takeaway", "Gesamt"]],
      body: data.dailyRevenue.map((d) => [
        d.businessDate,
        fmtEur(d.houseCents),
        fmtEur(d.takeawayCents),
        fmtEur(d.totalCents),
      ]),
      theme: "grid",
    });
    cursorY = lastY(doc) + 18;
  }

  // 4b) Gäste & Arbeitsstunden (STAT2 — gleiche Quelle wie die Kacheln)
  const gh = data.guestHours;
  if (gh) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Gäste & Arbeitsstunden", marginX, cursorY);
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: { 1: { halign: "right" } },
      head: [["Position", "Wert"]],
      body: [
        ["Gäste", String(gh.guestTotal)],
        ["Erfasste Arbeitsstunden", fmtHours(gh.workHours)],
        ["Ø Umsatz je Gast (Haus)", fmtEurOrDash(gh.revenuePerGuestCents)],
        ["Umsatz je Arbeitsstunde", fmtEurOrDash(gh.revenuePerWorkHourCents)],
      ],
      theme: "grid",
    });
    cursorY = lastY(doc) + 12;
    if (gh.daily.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [230, 230, 230], textColor: 20 },
        columnStyles: {
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
        },
        head: [["Datum", "Gäste", "Stunden", "€/Gast", "€/Std"]],
        body: gh.daily.map((d) => [
          d.businessDate,
          String(d.guestCount),
          fmtHours(d.workHours),
          fmtEurOrDash(d.perGuestCents),
          fmtEurOrDash(d.perHourCents),
        ]),
        theme: "grid",
      });
      cursorY = lastY(doc) + 18;
    }
  }

  // 5) Standort-Vergleich
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Standort-Vergleich", marginX, cursorY);
  const hasMissingAny = data.comparison.some((c) => c.hasMissingRate);
  if (data.comparison.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text("Keine Standorte vorhanden.", marginX, cursorY + 14);
    cursorY += 24;
  } else {
    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [230, 230, 230], textColor: 20 },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
      head: [
        ["Standort", "Umsatz", "Trinkgeld", "Personalquote", "Netto-Std.", "Basis-Lohnkosten"],
      ],
      body: data.comparison.map((c) => [
        c.locationName,
        fmtEur(c.totalCents),
        fmtEur(c.tipTotalCents),
        `${fmtPct(c.ratioPct)}${c.hasMissingRate ? " *" : ""}`,
        fmtHours(c.netHours),
        fmtEur(c.laborCostCents),
      ]),
      theme: "grid",
    });
    cursorY = lastY(doc) + 10;
    if (hasMissingAny) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        "* Mitarbeiter ohne hinterlegten Stundenlohn — Quote untertreibt.",
        marginX,
        cursorY,
      );
    }
  }

  const blob = doc.output("blob");
  const fileName = `Statistik_${data.monthLabel.replace(/\s+/g, "-")}_${data.scopeLabel.replace(
    /\s+/g,
    "-",
  )}.pdf`;
  return { doc, blob, fileName };
}
