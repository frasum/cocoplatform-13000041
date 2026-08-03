// M-Statistik UI — Schritt U1: Gerüst + Umsatz.
// Reines Frontend. Konsumiert `getRevenueStats` (Kalendermonat, S-3).
// Keine neuen Server-Fns, kein Schema, keine Logik in src/lib/statistics/.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDown, ArrowUp, Download } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocationPills } from "@/components/shared/LocationPills";
import { MonthNav } from "@/components/shared/MonthNav";
import { MonatsentwicklungTab } from "@/components/statistik/MonatsentwicklungTab";
import { Input } from "@/components/ui/input";
import { listLocations } from "@/lib/admin/locations.functions";
import { filterCashEnabled } from "@/lib/locations/cash-enabled";
import { getRevenueStats } from "@/lib/statistics/revenue-stats.functions";
import { getTipStats } from "@/lib/statistics/tip-stats.functions";
import { getPersonnelStats } from "@/lib/statistics/personnel-stats.functions";
import { personnelRatioPct } from "@/lib/statistics/personnel-core";
import {
  checkDonutSegments,
  computeChannelPercents,
  computeTrend,
  derivedKpis,
  takeawayDonutSegments,
  tipRatePct,
} from "@/lib/statistics/revenue-core";
import { shareOf, pickTopTwoByTotal } from "@/lib/statistics/comparison-core";
import { compareKpi } from "@/lib/statistics/kpi-compare";
import {
  leadDelta,
  previousTrendLabel,
  ppTrendLabel,
  ppLeadDelta,
} from "@/lib/statistics/comparison-labels";
import { formatComparisonRange } from "@/lib/statistics/comparison-label";
import { generateStatistikPdf, type StatistikPdfData } from "@/lib/statistics/statistik-pdf";
import { takeawayMatrix, takeawaySharePctOfTotal } from "@/lib/statistics/takeaway-channels";
import { monthWindow } from "@/lib/statistics/statistik-pdf-charts";
import { getMonthlyRevenueMatrix, ALL_LOCATIONS } from "@/lib/statistics/monthly-revenue.functions";
import { findCell } from "@/lib/statistics/monthly-core";
import { ytdByYear } from "@/lib/statistics/ytd-compare";
import { listBwaMonths } from "@/lib/bwa/bwa.functions";
import {
  aggregateGroup,
  computeBreakEven,
  estimatedPreTaxResultCents,
} from "@/lib/bwa/bwa-analytics";
import { currentMonth, monthRange } from "@/lib/statistics/period-window";
import { chartDaySlots } from "@/lib/statistics/chart-days";
import { fmtCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/** STAT3h — eindeutige Entität für die Break-even-Modellzeile (vgl. BWA-Modul). */
const PRETAX_ENTITY = "YUM Gastronomie GmbH";

export const Route = createFileRoute("/_authenticated/admin/statistik")({
  head: () => ({ meta: [{ title: "Statistik" }] }),
  component: StatistikPage,
});

type RevenueStats = Awaited<ReturnType<typeof getRevenueStats>>;
type Trend = NonNullable<RevenueStats["trend"]>["total"];
type TipStats = Awaited<ReturnType<typeof getTipStats>>;
type PersonnelStats = Awaited<ReturnType<typeof getPersonnelStats>>;
type TipPerStaff = TipStats["perStaff"][number];
type PersonnelPerStaff = PersonnelStats["perStaff"][number];
type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];

function fmtEuro(cents: number): string {
  return `${fmtCents(cents)} €`;
}

function fmtSignedEuro(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "±";
  return `${sign}${fmtCents(Math.abs(cents))} €`;
}

function TrendLine({ trend }: { trend: Trend | null | undefined }) {
  if (!trend || trend.pct === null) {
    return <div className="text-xs text-muted-foreground">— keine Vorperiode</div>;
  }
  const up = trend.deltaCents >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  const color = up ? "text-emerald-600" : "text-rose-600";
  const pctTxt = `${up ? "+" : "−"}${Math.abs(trend.pct).toFixed(1)} %`;
  return (
    <div className={cn("flex items-center gap-1 text-xs", color)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">{pctTxt}</span>
      <span className="text-muted-foreground">({fmtSignedEuro(trend.deltaCents)})</span>
    </div>
  );
}

function TrendLineHours({ trend }: { trend: Trend | null | undefined }) {
  // ACHTUNG: `deltaCents` ist hier in Wahrheit Delta-Minuten (Trend-Typ
  // wird wiederverwendet). NIE als „€" rendern.
  if (!trend || trend.pct === null) {
    return <div className="text-xs text-muted-foreground">— keine Vorperiode</div>;
  }
  const up = trend.deltaCents >= 0;
  const Icon = up ? ArrowUp : ArrowDown;
  const color = up ? "text-emerald-600" : "text-rose-600";
  const pctTxt = `${up ? "+" : "−"}${Math.abs(trend.pct).toFixed(1)} %`;
  const hoursTxt = `${up ? "+" : "−"}${(Math.abs(trend.deltaCents) / 60).toFixed(1)} h`;
  return (
    <div className={cn("flex items-center gap-1 text-xs", color)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">{pctTxt}</span>
      <span className="text-muted-foreground">({hoursTxt})</span>
    </div>
  );
}

type KpiCardProps = {
  title: string;
  /** EUR-Cents (Default-Unit "eur"). Rückwärtskompatibel zu U1. */
  cents?: number;
  trend?: Trend | null | undefined;
  unit?: "eur" | "hours" | "pct" | "eurOrDash";
  /** Für unit="hours" (Stunden) oder unit="pct" (Prozent oder null). */
  value?: number | null;
  /** Optionaler Trend-Renderer; überschreibt die Default-`TrendLine`. */
  trendRenderer?: () => React.ReactNode;
  /** Optionale Caption unter dem Wert (kleine, gedämpfte Zeile). */
  caption?: React.ReactNode;
  /** Untertitel „vs. …" — nur wenn eine Vorperiode verglichen wurde. */
  comparisonLabel?: string | null;
};

function KpiCard({
  title,
  cents,
  trend,
  unit = "eur",
  value,
  trendRenderer,
  caption,
  comparisonLabel,
}: KpiCardProps) {
  let display: string;
  if (unit === "eur") {
    display = fmtEuro(cents ?? 0);
  } else if (unit === "eurOrDash") {
    // STAT2 — Nenner 0 ⇒ „—" (kein NaN, kein 0-Fake).
    display = value === null || value === undefined ? "—" : fmtEuro(value);
  } else if (unit === "hours") {
    display = value === null || value === undefined ? "—" : `${value.toFixed(2)} h`;
  } else {
    display = value === null || value === undefined ? "—" : `${value.toFixed(1)} %`;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold tabular-nums">{display}</div>
        {trendRenderer ? trendRenderer() : <TrendLine trend={trend} />}
        {comparisonLabel ? (
          <div className="text-[11px] leading-tight text-muted-foreground/80">
            {comparisonLabel}
          </div>
        ) : null}
        {caption ? <div className="text-xs text-muted-foreground">{caption}</div> : null}
      </CardContent>
    </Card>
  );
}

function StatistikPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [mode, setMode] = useState<"month" | "range">("month");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // MB3b — Tab kontrolliert, damit die globale Filterleiste im Monats-Tab
  // ausgeblendet werden kann (Filter-State bleibt erhalten).
  const [activeTab, setActiveTab] = useState<string>("umsatz");

  function handleModeChange(next: "month" | "range") {
    if (next === "range" && (startDate === "" || endDate === "")) {
      const r = monthRange(month);
      setStartDate(r.startDate);
      setEndDate(r.endDate);
    }
    setMode(next);
  }

  const periodArgs = useMemo(
    () => (mode === "month" ? { month } : { startDate, endDate }),
    [mode, month, startDate, endDate],
  );
  const periodValid =
    mode === "month"
      ? month.length === 7
      : startDate !== "" && endDate !== "" && endDate >= startDate;

  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => listLocations(),
  });
  // LS1: Auswertungen zeigen nur Kassen-Standorte (reine Planungs-Standorte
  // wie TSB liefern keine Umsätze und würden Aggregate/PDF verzerren).
  const locations = useMemo(() => filterCashEnabled(locationsQ.data ?? []), [locationsQ.data]);

  const statsQ = useQuery({
    queryKey: ["stats", "revenue", mode, month, startDate, endDate, locationFilter],
    queryFn: () =>
      getRevenueStats({
        data: {
          ...periodArgs,
          ...(locationFilter !== "all" ? { locationId: locationFilter } : {}),
        },
      }),
    enabled: periodValid,
  });

  const tipArgs = {
    ...periodArgs,
    ...(locationFilter !== "all" ? { locationId: locationFilter } : {}),
  };
  const tipsQ = useQuery({
    queryKey: ["stats", "tips", mode, month, startDate, endDate, locationFilter],
    queryFn: () => getTipStats({ data: tipArgs }),
    enabled: periodValid,
  });
  const personnelQ = useQuery({
    queryKey: ["stats", "personnel", mode, month, startDate, endDate, locationFilter],
    queryFn: () => getPersonnelStats({ data: tipArgs }),
    enabled: periodValid,
  });

  // STAT3 — Vorjahres- und Verlaufszahlen kommen aus der BESTEHENDEN
  // MB1-Server-Fn (gleicher Query-Key wie der Tab „Monatsentwicklung", also
  // aus dem Cache). Keine neue Query, keine zweite Formel.
  const matrixQ = useQuery({
    queryKey: ["monthlyRevenueMatrix"],
    queryFn: () => getMonthlyRevenueMatrix({ data: {} }),
  });

  // STAT3h — Break-even-Grundlage für die Modellzeile im PDF. Nur relevant im
  // Scope „Alle Standorte" (eindeutige Entität) und bei abgeschlossenem Monat.
  const preTaxEligible = mode === "month" && locationFilter === "all" && month < currentMonth();
  const bwaQ = useQuery({
    queryKey: ["bwa", "months"],
    queryFn: () => listBwaMonths(),
    enabled: preTaxEligible,
  });

  // Compare-Queries (alle Standorte, ignorieren den Pill-Filter) — genau einmal
  // hier deklariert, damit der PDF-Export dieselben Daten nutzen kann wie die
  // Vergleichstabelle. LocationCompareSection erhält die Ergebnisse als Props.
  const enabledCmp = periodValid;
  const revQueries = useQueries({
    queries: locations.map((loc) => ({
      queryKey: ["stats", "cmp", "rev", loc.id, mode, month, startDate, endDate],
      queryFn: () => getRevenueStats({ data: { ...periodArgs, locationId: loc.id } }),
      enabled: enabledCmp,
    })),
  });
  const tipQueries = useQueries({
    queries: locations.map((loc) => ({
      queryKey: ["stats", "cmp", "tip", loc.id, mode, month, startDate, endDate],
      queryFn: () => getTipStats({ data: { ...periodArgs, locationId: loc.id } }),
      enabled: enabledCmp,
    })),
  });
  const perQueries = useQueries({
    queries: locations.map((loc) => ({
      queryKey: ["stats", "cmp", "per", loc.id, mode, month, startDate, endDate],
      queryFn: () => getPersonnelStats({ data: { ...periodArgs, locationId: loc.id } }),
      enabled: enabledCmp,
    })),
  });

  const compareLoading =
    revQueries.some((q) => q.isLoading) ||
    tipQueries.some((q) => q.isLoading) ||
    perQueries.some((q) => q.isLoading);
  const compareError =
    revQueries.find((q) => q.isError)?.error ??
    tipQueries.find((q) => q.isError)?.error ??
    perQueries.find((q) => q.isError)?.error ??
    null;

  const exportDisabled =
    !periodValid ||
    !statsQ.data ||
    !tipsQ.data ||
    !personnelQ.data ||
    compareLoading ||
    compareError !== null ||
    // STAT3 — im Monatsmodus braucht das PDF die MB1-Matrix (Δ Vorjahr,
    // 13-Monats-Verlauf); ohne sie stünden dort stillschweigend „—".
    (mode === "month" && !matrixQ.data);

  const periodLabel = useMemo(() => {
    if (mode === "month") {
      return format(new Date(`${month}-01T00:00:00`), "LLLL yyyy", { locale: de });
    }
    if (!startDate || !endDate) return "";
    const a = format(new Date(`${startDate}T00:00:00`), "dd.MM.yyyy", { locale: de });
    const b = format(new Date(`${endDate}T00:00:00`), "dd.MM.yyyy", { locale: de });
    return `${a} – ${b}`;
  }, [mode, month, startDate, endDate]);

  const rangeInvalid =
    mode === "range" && endDate !== "" && startDate !== "" && endDate < startDate;

  async function handleExport() {
    if (!statsQ.data || !tipsQ.data || !personnelQ.data) return;
    const rev = statsQ.data;
    const tip = tipsQ.data;
    const per = personnelQ.data;

    const monthLabel = periodLabel;
    const scopeLabel =
      locationFilter === "all"
        ? "Alle Standorte"
        : (locations.find((l) => l.id === locationFilter)?.name ?? "Standort");

    // STAT3 — nur der Kalendermonat-Modus trägt Vorjahres-/Verlaufsvergleiche.
    const calendarMonth = mode === "month";
    const focusYear = Number(month.slice(0, 4));
    const focusMonthNo = Number(month.slice(5, 7));
    const matrix = matrixQ.data ?? null;
    /** Monatszelle eines Standorts (bzw. der Summe) aus der MB1-Matrix. */
    function matrixCents(locationId: string, year: number, monthNo: number): number | null {
      if (!matrix || !calendarMonth) return null;
      const series = matrix.series.find((s) => s.locationId === locationId);
      if (!series) return null;
      return findCell(series.cells, year, monthNo)?.totalCents ?? null;
    }
    const scopeSeriesId = locationFilter === "all" ? ALL_LOCATIONS : locationFilter;

    const ratio = personnelRatioPct(per.totals.laborCostCents, rev.summary.totalCents);
    // STAT3b — Kanal-Matrix: Gesamt-Scope + Standortspalten. Die Zerlegung
    // selbst liegt in takeaway-channels (→ takeawayDonutSegments), hier wird
    // nur eingesammelt.
    const takeaway = takeawayMatrix(
      locationFilter === "all"
        ? locations.flatMap((loc, i) => {
            const r = revQueries[i]?.data;
            if (!r) return [];
            return [
              {
                locationName: loc.name,
                current: {
                  markerSumCents: r.takeawayComponents.markerSumCents,
                  souseSumCents: r.takeawayComponents.souseSumCents,
                  woltInfoCents: r.summary.woltInfoCents,
                },
              },
            ];
          })
        : [],
      {
        current: {
          markerSumCents: rev.takeawayComponents.markerSumCents,
          souseSumCents: rev.takeawayComponents.souseSumCents,
          woltInfoCents: rev.summary.woltInfoCents,
        },
        previous: rev.previousTakeawayComponents
          ? {
              markerSumCents: rev.previousTakeawayComponents.markerSumCents,
              souseSumCents: rev.previousTakeawayComponents.souseSumCents,
              woltInfoCents: rev.previousWoltInfoCents ?? 0,
            }
          : null,
      },
    );
    const staffWithoutRateNames = per.staffWithoutRate.map(
      (id) => per.perStaff.find((p) => p.staffId === id)?.name ?? id,
    );
    const pdfKpis = derivedKpis({
      houseCents: rev.summary.houseCents,
      totalCents: rev.summary.totalCents,
      guestCount: rev.guestTotal,
      workMinutes: rev.workMinutesTotal,
    });

    const comparison: StatistikPdfData["comparison"] = [];
    locations.forEach((loc, i) => {
      const r = revQueries[i]?.data;
      const t = tipQueries[i]?.data;
      const p = perQueries[i]?.data;
      if (!r || !t || !p) return;
      // STAT2b — dieselben Felder wie die Vergleichskarten, keine eigene
      // Summierung: derivedKpis ist die einzige Kennzahl-Quelle.
      const k = derivedKpis({
        houseCents: r.summary.houseCents,
        totalCents: r.summary.totalCents,
        guestCount: r.guestTotal,
        workMinutes: r.workMinutesTotal,
      });
      comparison.push({
        locationName: loc.name,
        totalCents: r.summary.totalCents,
        tipTotalCents: t.totals.totalCents,
        ratioPct: personnelRatioPct(p.totals.laborCostCents, r.summary.totalCents),
        netHours: p.totals.netHours,
        laborCostCents: p.totals.laborCostCents,
        hasMissingRate: p.staffWithoutRate.length > 0,
        guestTotal: r.guestTotal,
        perGuestCents: k.revenuePerGuestCents,
        perHourCents: k.revenuePerWorkHourCents,
        prevYearTotalCents: matrixCents(loc.id, focusYear - 1, focusMonthNo),
        prevTotalCents: r.previous?.totalCents ?? null,
        // STAT2d — Quote aus derselben reinen Funktion wie die Kachel.
        tipRatePct: tipRatePct(t.totals.totalCents, r.summary.houseCents),
      });
    });

    // Grafik B — 13-Monats-Fenster (Vorjahresmonat … Berichtsmonat) je Standort
    // bzw. als Summe; die Werte kommen unverändert aus der MB1-Matrix.
    const window13 = monthWindow(focusYear, focusMonthNo, 13);
    // STAT3c — Tagesreihen je Standort für die gestapelten Tagesbalken.
    // Inaktive Standorte erscheinen nur, wenn sie im Zeitraum Umsatz haben.
    const dailyByLocation: Array<{ name: string; byDate: Map<string, number> }> =
      locationFilter === "all"
        ? locations.flatMap((loc, i) => {
            const r = revQueries[i]?.data;
            if (!r) return [];
            const byDate = new Map<string, number>();
            for (const d of r.daily) byDate.set(d.businessDate, d.totalCents);
            const hasRevenue = r.daily.some((d) => d.totalCents !== 0);
            if (!hasRevenue) return [];
            return [{ name: loc.name, byDate }];
          })
        : [];
    const monthlySeriesIds =
      locationFilter === "all" ? locations.map((l) => l.id) : [locationFilter];
    const monthly =
      calendarMonth && matrix
        ? {
            monthLabels: window13.map((m) => m.label),
            series: monthlySeriesIds
              .map((id) => {
                const series = matrix.series.find((s) => s.locationId === id);
                if (!series) return null;
                return {
                  name: series.locationName,
                  values: window13.map(
                    (m) => findCell(series.cells, m.year, m.month)?.totalCents ?? null,
                  ),
                };
              })
              .filter((s): s is { name: string; values: Array<number | null> } => s !== null),
          }
        : undefined;

    // STAT3f — kumulierter 5-Jahres-Vergleich (Jan…M) aus DERSELBEN MB1-Matrix;
    // die Klemmung auf M−1 im laufenden Monat übernimmt `ytdByYear`.
    const ytdCompare =
      calendarMonth && matrix
        ? ytdByYear(
            monthlySeriesIds.flatMap((id) => {
              const series = matrix.series.find((s) => s.locationId === id);
              return series ? [{ name: series.locationName, cells: series.cells }] : [];
            }),
            focusYear,
            focusMonthNo,
            format(new Date(), "yyyy-MM"),
            5,
          )
        : undefined;

    // STAT3h — Modell-Ergebnis vor Steuern: rollierender Break-even der
    // eindeutigen Entität (alle Kostenstellen zur „Gruppe" verdichtet) auf den
    // Kassen-Bruttoumsatz des Monats angewandt. Fehlt die BWA oder ist der
    // Deckungsbeitrag unbrauchbar, entfällt die Zeile ersatzlos.
    const bwaRows = preTaxEligible ? (bwaQ.data ?? null) : null;
    const be = bwaRows
      ? computeBreakEven(
          aggregateGroup(bwaRows.filter((r) => r.entity === PRETAX_ENTITY)).filter(
            (r) => r.month <= `${month}-01`,
          ),
        )
      : null;
    const resultCents = estimatedPreTaxResultCents(rev.summary.totalCents, be);
    const preTaxModel =
      be && resultCents !== null && be.factorCurrent
        ? {
            resultCents,
            // BWA-V1: Netto-Umrechnung mit dem Faktor nach aktuellem
            // Regelstand — identische Quelle wie in `resultCents`.
            netRevenueCents: Math.round(rev.summary.totalCents / be.factorCurrent),
            breakEvenMonthCents: be.netMonthCents,
            dbPct: be.db * 100,
          }
        : undefined;

    const data: StatistikPdfData = {
      monthLabel,
      scopeLabel,
      generatedAtLabel: format(new Date(), "dd.MM.yyyy, HH:mm", { locale: de }),
      calendarMonth,
      revenue: {
        houseCents: rev.summary.houseCents,
        takeawayCents: rev.summary.takeawayCents,
        totalCents: rev.summary.totalCents,
        daysWithRevenue: rev.daily.filter((d) => d.totalCents > 0).length,
      },
      previousYearTotalCents: matrixCents(scopeSeriesId, focusYear - 1, focusMonthNo),
      previousPeriodTotalCents: rev.previous?.totalCents ?? null,
      takeaway,
      takeawaySharePct: takeawaySharePctOfTotal(rev.summary.takeawayCents, rev.summary.totalCents),
      tips: {
        serviceCents: tip.totals.serviceCents,
        kitchenCents: tip.totals.kitchenCents,
        totalCents: tip.totals.totalCents,
      },
      personnel: {
        netHours: per.totals.netHours,
        laborCostCents: per.totals.laborCostCents,
        ratioPct: ratio,
        staffWithoutRateNames,
      },
      dailyRevenue: rev.daily.map((d) => ({
        businessDate: d.businessDate,
        totalCents: d.totalCents,
        // STAT3c — im Gesamt-Scope die Standort-Anteile je Geschäftstag für die
        // gestapelten Balken; die Tageswerte je Standort liegen bereits vor
        // (revQueries), keine neue Abfrage. Fehlender Tag je Standort = 0.
        ...(locationFilter === "all" && dailyByLocation.length > 0
          ? {
              byLocation: dailyByLocation.map((s) => ({
                name: s.name,
                cents: s.byDate.get(d.businessDate) ?? 0,
              })),
            }
          : {}),
      })),
      // STAT2 — gleiche Quelle wie die Kacheln/das Panel; keine eigene Summierung.
      guestHours: {
        guestTotal: rev.guestTotal,
        workHours: pdfKpis.workHours,
        revenuePerGuestCents: pdfKpis.revenuePerGuestCents,
        revenuePerWorkHourCents: pdfKpis.revenuePerWorkHourCents,
      },
      ...(monthly ? { monthly } : {}),
      ...(ytdCompare ? { ytdCompare } : {}),
      ...(preTaxModel ? { preTaxModel } : {}),
      comparison,
    };

    const { doc, fileName } = await generateStatistikPdf(data);
    doc.save(fileName);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Statistik</h1>
        <p className="text-sm text-muted-foreground">
          Umsatz, Trinkgeld und Personalquote — Haus und Takeaway. Vergleich gegen den
          vorangehenden, gleich langen Zeitraum.
        </p>
      </div>

      {activeTab === "monat" ? null : (
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ansicht
              </Label>
              <div className="inline-flex h-10 items-center rounded-md border border-input p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "month" ? "default" : "ghost"}
                  onClick={() => handleModeChange("month")}
                >
                  Monat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "range" ? "default" : "ghost"}
                  onClick={() => handleModeChange("range")}
                >
                  Zeitraum
                </Button>
              </div>
            </div>
            {mode === "month" ? (
              <div className="space-y-1">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Monat
                </Label>
                <div className="flex h-10 items-center gap-2">
                  <MonthNav value={month} onChange={setMonth} />
                  {statsQ.data?.coverage?.isPartial && month === currentMonth() ? (
                    <span
                      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 text-xs text-amber-700"
                      title="Der laufende Monat enthält erst Daten bis zum letzten Abrechnungstag."
                    >
                      unvollständig · Stand{" "}
                      {statsQ.data.coverage.lastDataDay
                        ? statsQ.data.coverage.lastDataDay.slice(8, 10) + "."
                        : "—"}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label
                    htmlFor="stat-from"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Von
                  </Label>
                  <Input
                    id="stat-from"
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-10 w-[160px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="stat-to"
                    className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Bis
                  </Label>
                  <Input
                    id="stat-to"
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`h-10 w-[160px] ${rangeInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    aria-invalid={rangeInvalid || undefined}
                    title={rangeInvalid ? "Bis muss ≥ Von sein." : undefined}
                  />
                </div>
              </>
            )}
            {/* MB3b — im Tab „Standortvergleich" fehlt die Standort-Auswahl
                bewusst: die Compare-Queries laden immer alle Standorte und
                ignorieren den Pill-Filter, eine Auswahl hier wäre irreführend.
                Der State bleibt erhalten und gilt in den übrigen Tabs weiter. */}
            {activeTab === "vergleich" ? null : (
              <div className="space-y-1">
                <Label
                  htmlFor="stat-loc"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Standort
                </Label>
                <div id="stat-loc" className="flex h-10 items-center">
                  <LocationPills
                    locations={locations}
                    value={locationFilter}
                    onChange={setLocationFilter}
                    includeAll
                    allValue="all"
                  />
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-10"
              onClick={handleExport}
              disabled={exportDisabled}
            >
              <Download className="h-4 w-4" />
              PDF
            </Button>
          </div>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="umsatz">Umsatz</TabsTrigger>
          <TabsTrigger value="trinkgeld">Trinkgeld</TabsTrigger>
          <TabsTrigger value="personal">Personalquote</TabsTrigger>
          <TabsTrigger value="vergleich">Standortvergleich</TabsTrigger>
          <TabsTrigger value="monat">Monatsentwicklung</TabsTrigger>
        </TabsList>
        <TabsContent value="umsatz">
          {statsQ.isLoading ? (
            <LoadingState />
          ) : statsQ.isError ? (
            <ErrorState message={(statsQ.error as Error)?.message ?? "Unbekannter Fehler"} />
          ) : statsQ.data ? (
            <StatsView data={statsQ.data} />
          ) : null}
        </TabsContent>
        <TabsContent value="trinkgeld">
          <TipsSection
            isLoading={tipsQ.isLoading}
            isError={tipsQ.isError}
            error={tipsQ.error}
            data={tipsQ.data}
          />
        </TabsContent>
        <TabsContent value="personal">
          <PersonnelSection
            isLoading={personnelQ.isLoading || statsQ.isLoading}
            isError={personnelQ.isError}
            error={personnelQ.error}
            personnel={personnelQ.data}
            revenue={statsQ.data}
          />
        </TabsContent>
        <TabsContent value="vergleich">
          <LocationCompareSection
            locations={locations}
            revQueries={revQueries}
            tipQueries={tipQueries}
            perQueries={perQueries}
            isLoading={compareLoading}
            firstError={compareError}
          />
        </TabsContent>
        <TabsContent value="monat">
          {/* MB1 — eigener Datenpfad (24-Jahre-Historie), unabhängig vom
              Monats-/Zeitraum-Filter oben; deshalb ist die globale Filterleiste
              in diesem Tab ausgeblendet (MB3b). */}
          <MonatsentwicklungTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-[320px]" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-rose-300/60 bg-rose-50/50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
      <div className="font-medium">Statistik konnte nicht geladen werden.</div>
      <div className="mt-1 text-xs opacity-80">{message}</div>
    </Card>
  );
}

function StatsView({ data }: { data: RevenueStats }) {
  const trend = data.trend;
  const cmp = formatComparisonRange(data.previousRange, { partial: data.coverage.isPartial });
  const hasDaily = data.daily.length > 0;
  const hasTakeaway = data.takeawayByChannel.length > 0 && data.summary.takeawayCents > 0;
  // STAT2 — Kennzahlen kommen aus der reinen Funktion; die UI rechnet nicht.
  const kpis = derivedKpis({
    houseCents: data.summary.houseCents,
    totalCents: data.summary.totalCents,
    guestCount: data.guestTotal,
    workMinutes: data.workMinutesTotal,
  });
  const prevKpis =
    data.previous && data.previousDerived
      ? derivedKpis({
          houseCents: data.previous.houseCents,
          totalCents: data.previous.totalCents,
          guestCount: data.previousDerived.guestTotal,
          workMinutes: data.previousDerived.workMinutesTotal,
        })
      : null;
  // Trend nur, wenn BEIDE Fenster einen validen Nenner haben.
  const guestTrend =
    kpis.revenuePerGuestCents !== null && prevKpis?.revenuePerGuestCents != null
      ? computeTrend(kpis.revenuePerGuestCents, prevKpis.revenuePerGuestCents)
      : null;
  const hourTrend =
    kpis.revenuePerWorkHourCents !== null && prevKpis?.revenuePerWorkHourCents != null
      ? computeTrend(kpis.revenuePerWorkHourCents, prevKpis.revenuePerWorkHourCents)
      : null;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Gesamtumsatz"
          cents={data.summary.totalCents}
          trend={trend?.total ?? null}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Haus"
          cents={data.summary.houseCents}
          trend={trend?.house ?? null}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Takeaway"
          cents={data.summary.takeawayCents}
          trend={trend?.takeaway ?? null}
          comparisonLabel={cmp}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <KpiCard
          title="Ø Umsatz je Gast"
          unit="eurOrDash"
          value={kpis.revenuePerGuestCents}
          trend={guestTrend}
          comparisonLabel={cmp}
          caption={`${data.guestTotal.toLocaleString("de-DE")} Gäste`}
        />
        <KpiCard
          title="Umsatz je Arbeitsstunde"
          unit="eurOrDash"
          value={kpis.revenuePerWorkHourCents}
          trend={hourTrend}
          comparisonLabel={cmp}
          caption={`${kpis.workHours.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h erfasst`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Umsatzverlauf</CardTitle>
        </CardHeader>
        <CardContent>
          {hasDaily ? (
            <RevenueChart daily={data.daily} range={data.range} />
          ) : (
            <EmptyChart />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gäste &amp; Arbeitsstunden</CardTitle>
        </CardHeader>
        <CardContent>
          {hasDaily ? (
            <GuestHoursChart daily={data.daily} range={data.range} />
          ) : (
            <div className="flex h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Keine Daten in diesem Zeitraum.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Take Away Kanäle</CardTitle>
        </CardHeader>
        <CardContent>
          {hasTakeaway ? (
            <TakeawayChannelsDonut
              totalCents={data.summary.takeawayCents}
              woltInfoCents={data.summary.woltInfoCents}
              components={data.takeawayComponents}
            />
          ) : (
            <div className="flex h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Keine Take-Away-Umsätze in diesem Zeitraum.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
      <div>Keine Umsätze in diesem Monat.</div>
      <div className="mt-1 text-xs">Sobald Tagesabschlüsse erfasst sind, erscheinen sie hier.</div>
    </div>
  );
}

type DailyRow = RevenueStats["daily"][number];

type ChartRange = { startDate: string; endDate: string };

// STAT4a — Achse = volles Fenster, fehlende Tage sind LEER (null), damit die
// Linien nach dem letzten echten Tag enden statt auf 0 zu stürzen.
function RevenueChart({ daily, range }: { daily: DailyRow[]; range: ChartRange }) {
  const rows = chartDaySlots(daily, range).map(({ day, businessDate, point }) => ({
    day,
    fullDate: businessDate,
    total: point ? point.totalCents / 100 : null,
    card: point ? (point.cardCents ?? 0) / 100 : null,
    takeaway: point ? point.takeawayCents / 100 : null,
    totalCents: point?.totalCents ?? null,
    cardCents: point?.cardCents ?? null,
    takeawayCents: point?.takeawayCents ?? null,
  }));

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={1} />
          <YAxis
            tickFormatter={(v: number) => `${Math.round(v).toLocaleString("de-DE")} €`}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={70}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="linear"
            dataKey="total"
            name="Tagesumsatz"
            fill="#2563eb"
            stroke="#2563eb"
            fillOpacity={0.18}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: "#2563eb" }}
            connectNulls={false}
          />
          <Line
            type="linear"
            dataKey="card"
            name="Kreditkarten"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={{ r: 2, strokeWidth: 0, fill: "#f59e0b" }}
            connectNulls={false}
          />
          <Line
            type="linear"
            dataKey="takeaway"
            name="Takeaway"
            stroke="#16a34a"
            strokeWidth={2}
            dot={{ r: 2, strokeWidth: 0, fill: "#16a34a" }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type TipPayload = {
  active?: boolean;
  payload?: Array<{
    payload: {
      fullDate: string;
      totalCents: number | null;
      cardCents: number | null;
      takeawayCents: number | null;
    };
  }>;
};

// STAT2 — Gäste (Balken, linke Achse) und Arbeitsstunden (Linie, rechte
// Achse) auf derselben X-Achse wie der Umsatzverlauf (gleiche Fill-Logik,
// kein Interpolieren). Die €-Kennzahlen je Tag kommen aus `derivedKpis`.
type GuestHoursRow = {
  day: string;
  fullDate: string;
  guests: number | null;
  hours: number | null;
  perGuestCents: number | null;
  perHourCents: number | null;
};

function GuestHoursChart({ daily, range }: { daily: DailyRow[]; range: ChartRange }) {
  const rows: GuestHoursRow[] = chartDaySlots(daily, range).map(({ day, businessDate, point }) => {
    if (!point) {
      return { day, fullDate: businessDate, guests: null, hours: null, perGuestCents: null, perHourCents: null };
    }
    const k = derivedKpis({
      houseCents: point.houseCents,
      totalCents: point.totalCents,
      guestCount: point.guestCount ?? 0,
      workMinutes: point.workMinutes ?? 0,
    });
    return {
      day,
      fullDate: businessDate,
      guests: point.guestCount ?? 0,
      hours: k.workHours,
      perGuestCents: k.revenuePerGuestCents,
      perHourCents: k.revenuePerWorkHourCents,
    };
  });

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={1} />
          <YAxis
            yAxisId="guests"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={48}
            tickFormatter={(v: number) => String(Math.round(v))}
          />
          <YAxis
            yAxisId="hours"
            orientation="right"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={56}
            tickFormatter={(v: number) => `${Math.round(v)} h`}
          />
          <Tooltip content={<GuestHoursTip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            yAxisId="guests"
            dataKey="guests"
            name="Gäste"
            fill="#2563eb"
            fillOpacity={0.35}
            radius={[2, 2, 0, 0]}
          />
          <Line
            yAxisId="hours"
            type="linear"
            dataKey="hours"
            name="Arbeitsstunden"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 2, strokeWidth: 0, fill: "#f59e0b" }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function GuestHoursTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: GuestHoursRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{row.fullDate}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Gäste</span>
        <span className="text-right">{row.guests.toLocaleString("de-DE")}</span>
        <span className="text-muted-foreground">Stunden</span>
        <span className="text-right">{row.hours.toFixed(2)}</span>
        <span className="text-muted-foreground">€/Gast</span>
        <span className="text-right">
          {row.perGuestCents === null ? "—" : fmtEuro(row.perGuestCents)}
        </span>
        <span className="text-muted-foreground">€/Std</span>
        <span className="text-right">
          {row.perHourCents === null ? "—" : fmtEuro(row.perHourCents)}
        </span>
      </div>
    </div>
  );
}

function ChartTip({ active, payload }: TipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{row.fullDate}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Tagesumsatz</span>
        <span className="text-right">{fmtEuro(row.totalCents)}</span>
        <span className="text-muted-foreground">Kreditkarten</span>
        <span className="text-right">{fmtEuro(row.cardCents)}</span>
        <span className="text-muted-foreground">Takeaway</span>
        <span className="text-right">{fmtEuro(row.takeawayCents)}</span>
      </div>
    </div>
  );
}

const CHANNEL_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#4b5563",
];

function TakeawayChannelsDonut({
  totalCents,
  woltInfoCents,
  components,
}: {
  totalCents: number;
  woltInfoCents: number;
  components: RevenueStats["takeawayComponents"];
}) {
  // STAT1b — Segmente kommen aus der reinen Zerlegung; die UI rechnet nicht.
  const decomposed = takeawayDonutSegments(
    components.markerSumCents,
    components.souseSumCents,
    woltInfoCents,
  );
  const withPct = computeChannelPercents(decomposed.segments);
  // STAT1 — Segmentsumme automatisch gegen Marker + SoUse prüfen.
  const check = checkDonutSegments({
    segmentSumCents: decomposed.segmentSumCents,
    markerSumCents: components.markerSumCents,
    souseSumCents: components.souseSumCents,
    takeawayCents: totalCents,
  });
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center">
      <div className="h-[240px] w-full md:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={withPct}
              dataKey="amountCents"
              nameKey="name"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={1}
              label={(entry: { pct?: number }) => (entry.pct != null ? `${entry.pct}\u00a0%` : "")}
              labelLine={false}
            >
              {withPct.map((c, i) => (
                <Cell key={c.name} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, item) => [
                `${fmtEuro(value)} (${(item?.payload as { pct?: number })?.pct ?? 0}\u00a0%)`,
                item?.payload?.name as string,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 text-sm">
        {!check.ok ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {check.message}
          </div>
        ) : check.message ? (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            {check.message}
          </div>
        ) : null}
        {decomposed.warning ? (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            {decomposed.warning}
          </div>
        ) : null}
        <ul className="space-y-1.5">
          {withPct.map((c, i) => (
            <li key={c.name} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }}
              />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="tabular-nums">
                {fmtEuro(c.amountCents)} ({c.pct}&nbsp;%)
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-border pt-2 text-xs text-muted-foreground">
          Gesamt Takeaway: <span className="tabular-nums">{fmtEuro(totalCents)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Trinkgeld-Section ----------

function TipsSection({
  isLoading,
  isError,
  error,
  data,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: TipStats | undefined;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Trinkgeld</h2>
      {isLoading ? (
        <TipsLoading />
      ) : isError ? (
        <ErrorState message={(error as Error)?.message ?? "Unbekannter Fehler"} />
      ) : data ? (
        <TipsView data={data} />
      ) : null}
    </section>
  );
}

function TipsLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

function TipsView({ data }: { data: TipStats }) {
  const t = data.trend;
  const cmp = formatComparisonRange(data.previousRange, { partial: data.coverage.isPartial });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Trinkgeld gesamt"
          cents={data.totals.totalCents}
          trend={t?.total ?? null}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Service"
          cents={data.totals.serviceCents}
          trend={t?.service ?? null}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Küche"
          cents={data.totals.kitchenCents}
          trend={t?.kitchen ?? null}
          comparisonLabel={cmp}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trinkgeld pro Mitarbeiter</CardTitle>
        </CardHeader>
        <CardContent>
          {data.perStaff.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Keine Trinkgeld-Auszahlungen in diesem Monat.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.perStaff.map((p) => (
                <TipStaffRow key={p.staffId} row={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TipStaffRow({ row }: { row: TipPerStaff }) {
  const isService = row.department === "service";
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "border-transparent",
            isService
              ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
          )}
        >
          {isService ? "Service" : "Küche"}
        </Badge>
        <span className="text-sm text-foreground">{row.name}</span>
      </div>
      <span className="text-sm font-medium tabular-nums">{fmtEuro(row.tipCents)}</span>
    </li>
  );
}

// ---------- Personalquote-Section ----------

function PersonnelSection({
  isLoading,
  isError,
  error,
  personnel,
  revenue,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  personnel: PersonnelStats | undefined;
  revenue: RevenueStats | undefined;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Personalquote</h2>
      {isError ? (
        <ErrorState message={(error as Error)?.message ?? "Unbekannter Fehler"} />
      ) : isLoading || !personnel || !revenue ? (
        <PersonnelLoading />
      ) : (
        <PersonnelView personnel={personnel} revenue={revenue} />
      )}
    </section>
  );
}

function PersonnelLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

function PersonnelView({
  personnel,
  revenue,
}: {
  personnel: PersonnelStats;
  revenue: RevenueStats;
}) {
  const ratio = personnelRatioPct(personnel.totals.laborCostCents, revenue.summary.totalCents);
  const netHours = personnel.totals.netHours;
  const revPerHourCents = netHours > 0 ? Math.round(revenue.summary.totalCents / netHours) : null;
  const trend = personnel.trend;
  const cmp = formatComparisonRange(personnel.previousRange, {
    partial: personnel.coverage.isPartial,
  });

  if (netHours === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Keine Stunden in diesem Monat.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <KpiCard
        title="Personalquote"
        unit="pct"
        value={ratio}
        caption="Basis-Brutto (Netto-Stunden × Stundenlohn) — ohne AG-SV, SFN, Zweitsatz."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Netto-Stunden"
          unit="hours"
          value={netHours}
          trendRenderer={() => <TrendLineHours trend={trend?.hours ?? null} />}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Basis-Lohnkosten"
          cents={personnel.totals.laborCostCents}
          trend={trend?.cost ?? null}
          comparisonLabel={cmp}
        />
        <KpiCard
          title="Umsatz / Stunde"
          unit={revPerHourCents === null ? "pct" : "eur"}
          cents={revPerHourCents ?? 0}
          value={revPerHourCents === null ? null : undefined}
        />
      </div>
      {personnel.staffWithoutRate.length > 0 ? (
        <StaffWithoutRateBanner ids={personnel.staffWithoutRate} perStaff={personnel.perStaff} />
      ) : null}
      {personnel.totals.unratedNetHours > 0 ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Ohne Satz:{" "}
          {personnel.totals.unratedNetHours.toLocaleString("de-DE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          h — nicht in den Kosten enthalten (Stammdaten prüfen).
        </div>
      ) : null}
    </div>
  );
}

function StaffWithoutRateBanner({
  ids,
  perStaff,
}: {
  ids: string[];
  perStaff: PersonnelPerStaff[];
}) {
  const names = ids.map((id) => perStaff.find((p) => p.staffId === id)?.name ?? id).join(", ");
  return (
    <Card className="border-amber-300/60 bg-amber-50/60 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <div className="font-medium">
            {ids.length} {ids.length === 1 ? "Mitarbeiter" : "Mitarbeiter"} ohne hinterlegten
            Stundenlohn — Lohnkosten und Quote untertreiben.
          </div>
          <div className="text-xs opacity-90">{names}</div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Standort-Vergleich-Section (STAT-U3) ----------

type CompareLocation = {
  id: string;
  name: string;
  totalCents: number;
  avgDailyCents: number;
  takeawayCents: number;
  kitchenTipCents: number;
  serviceTipCents: number;
  avgTipPerDayCents: number;
  daysWithData: number;
  tipTotalCents: number;
  // STAT2b — Rohsummen + fertige Kennzahlen (aus `derivedKpis`).
  guestTotal: number;
  workMinutesTotal: number;
  revenuePerGuestCents: number | null;
  revenuePerWorkHourCents: number | null;
  // STAT2c — Vormonatswerte je Standort (Fenster inkl. U5a-Klemmung kommt
  // fertig aus den Server-Fns; hier wird nichts neu berechnet).
  previousRange: { startDate: string; endDate: string } | null;
  previousPartial: boolean;
  prevTotalCents: number | null;
  prevAvgDailyCents: number | null;
  prevTakeawayCents: number | null;
  prevKitchenTipCents: number | null;
  prevServiceTipCents: number | null;
  prevAvgTipPerDayCents: number | null;
  prevGuestTotal: number | null;
  prevWorkMinutesTotal: number | null;
  prevRevenuePerGuestCents: number | null;
  prevRevenuePerWorkHourCents: number | null;
  // STAT2d — Trinkgeld-Quote (Trinkgeld gesamt ÷ HAUS-Umsatz), Vorperiode analog.
  tipRatePct: number | null;
  prevTipRatePct: number | null;
};

function LocationCompareSection({
  locations,
  revQueries,
  tipQueries,
  perQueries: _perQueries,
  isLoading,
  firstError,
}: {
  locations: LocationRow[];
  revQueries: UseQueryResult<RevenueStats>[];
  tipQueries: UseQueryResult<TipStats>[];
  perQueries: UseQueryResult<PersonnelStats>[];
  isLoading: boolean;
  firstError: unknown;
}) {
  // Standorte mit vollständig geladenen Daten in vergleichsfähige Zeilen
  // reduzieren. `daysWithData` = Tage mit Umsatz > 0 (Definition analog
  // `summarize.daysWithRevenue`, S-6-konform: Sessions in allen Status).
  const rows: CompareLocation[] = useMemo(() => {
    const list: CompareLocation[] = [];
    locations.forEach((loc, i) => {
      const rev = revQueries[i]?.data;
      const tip = tipQueries[i]?.data;
      if (!rev || !tip) return;
      const daysWithData = rev.daily.filter((d) => d.totalCents > 0).length;
      const total = rev.summary.totalCents;
      const tipTotal = tip.totals.totalCents;
      // STAT2b — keine Neuberechnung in der UI: derivedKpis ist die Quelle.
      const kpis = derivedKpis({
        houseCents: rev.summary.houseCents,
        totalCents: rev.summary.totalCents,
        guestCount: rev.guestTotal,
        workMinutes: rev.workMinutesTotal,
      });
      // STAT2c — Vormonat: Summen kommen fertig aus den Server-Fns
      // (`previous`, `previousDerived`, `previous.daysWithRevenue`).
      const prevRev = rev.previous;
      const prevDays = prevRev?.daysWithRevenue ?? 0;
      const prevTip = tip.previous;
      const prevTipTotal = prevTip?.totalCents ?? null;
      const prevKpis =
        prevRev && rev.previousDerived
          ? derivedKpis({
              houseCents: prevRev.houseCents,
              totalCents: prevRev.totalCents,
              guestCount: rev.previousDerived.guestTotal,
              workMinutes: rev.previousDerived.workMinutesTotal,
            })
          : null;
      list.push({
        id: loc.id,
        name: loc.name,
        totalCents: total,
        avgDailyCents: daysWithData > 0 ? Math.round(total / daysWithData) : 0,
        takeawayCents: rev.summary.takeawayCents,
        kitchenTipCents: tip.totals.kitchenCents,
        serviceTipCents: tip.totals.serviceCents,
        avgTipPerDayCents: daysWithData > 0 ? Math.round(tipTotal / daysWithData) : 0,
        daysWithData,
        tipTotalCents: tipTotal,
        guestTotal: rev.guestTotal,
        workMinutesTotal: rev.workMinutesTotal,
        revenuePerGuestCents: kpis.revenuePerGuestCents,
        revenuePerWorkHourCents: kpis.revenuePerWorkHourCents,
        previousRange: rev.previousRange,
        previousPartial: rev.coverage.isPartial,
        prevTotalCents: prevRev?.totalCents ?? null,
        prevAvgDailyCents:
          prevRev && prevDays > 0 ? Math.round(prevRev.totalCents / prevDays) : null,
        prevTakeawayCents: prevRev?.takeawayCents ?? null,
        prevKitchenTipCents: prevTip?.kitchenCents ?? null,
        prevServiceTipCents: prevTip?.serviceCents ?? null,
        prevAvgTipPerDayCents:
          prevTipTotal !== null && prevDays > 0 ? Math.round(prevTipTotal / prevDays) : null,
        prevGuestTotal: rev.previousDerived?.guestTotal ?? null,
        prevWorkMinutesTotal: rev.previousDerived?.workMinutesTotal ?? null,
        prevRevenuePerGuestCents: prevKpis?.revenuePerGuestCents ?? null,
        prevRevenuePerWorkHourCents: prevKpis?.revenuePerWorkHourCents ?? null,
        tipRatePct: tipRatePct(tipTotal, rev.summary.houseCents),
        prevTipRatePct:
          prevRev && prevTipTotal !== null ? tipRatePct(prevTipTotal, prevRev.houseCents) : null,
      });
    });
    return list;
  }, [locations, revQueries, tipQueries]);

  // Kopfkarte „Gesamt (alle Standorte)": Summen über alle Standorte, Ø auf
  // Basis der Vereinigung aller Tage mit Umsatz (kein Doppelzählen).
  const overall = useMemo(() => {
    const allDays = new Set<string>();
    let total = 0;
    let tipTotal = 0;
    locations.forEach((_loc, i) => {
      const rev = revQueries[i]?.data;
      const tip = tipQueries[i]?.data;
      if (rev) {
        total += rev.summary.totalCents;
        for (const d of rev.daily) {
          if (d.totalCents > 0) allDays.add(d.businessDate);
        }
      }
      if (tip) tipTotal += tip.totals.totalCents;
    });
    const days = allDays.size;
    return {
      totalCents: total,
      avgDailyCents: days > 0 ? Math.round(total / days) : 0,
      tipTotalCents: tipTotal,
      daysWithData: days,
    };
  }, [locations, revQueries, tipQueries]);

  const withData = useMemo(() => rows.filter((r) => r.daysWithData > 0), [rows]);
  const defaultPair = useMemo(() => pickTopTwoByTotal(withData), [withData]);
  const [pairIds, setPairIds] = useState<[string | null, string | null]>([null, null]);

  // Auswahl an Datenlage koppeln: bei jeder relevanten Änderung Default
  // (Top-2 nach Umsatz) neu setzen; manuelle Auswahl bleibt bestehen,
  // solange beide IDs weiterhin verfügbar sind.
  useEffect(() => {
    const available = new Set(withData.map((r) => r.id));
    const [a, b] = pairIds;
    const stillValid = a && b && a !== b && available.has(a) && available.has(b);
    if (stillValid) return;
    const nextA = defaultPair[0]?.id ?? null;
    const nextB = defaultPair[1]?.id ?? null;
    setPairIds([nextA, nextB]);
    // pairIds als Dep ist bewusst weggelassen — Reset nur auf Datenwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withData, defaultPair]);

  const a = pairIds[0] ? (withData.find((r) => r.id === pairIds[0]) ?? null) : null;
  const b = pairIds[1] ? (withData.find((r) => r.id === pairIds[1]) ?? null) : null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Standortvergleich</h2>
        <p className="text-xs text-muted-foreground">Alle Standorte, unabhängig vom Filter oben.</p>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Keine Standorte vorhanden.
        </div>
      ) : firstError ? (
        <ErrorState message={(firstError as Error)?.message ?? "Unbekannter Fehler"} />
      ) : isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {/* Kopfkarte */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Gesamt (alle Standorte)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <OverallMetric label="Gesamtumsatz" value={fmtEuro(overall.totalCents)} />
                <OverallMetric label="Ø Tagesumsatz" value={fmtEuro(overall.avgDailyCents)} />
                <OverallMetric label="Trinkgeld gesamt" value={fmtEuro(overall.tipTotalCents)} />
              </div>
            </CardContent>
          </Card>

          {withData.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Kein Standort hat im gewählten Zeitraum Umsatzdaten.
            </div>
          ) : withData.length === 1 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              Nur ein Standort mit Daten im Zeitraum ({withData[0].name}) — Vergleich benötigt zwei
              Standorte.
            </div>
          ) : a && b ? (
            <>
              {/* Standort-Umschalter erscheint erst ab drei Standorten mit Daten */}
              {withData.length > 2 ? (
                <Card className="p-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <PairSelector
                      label="Standort A"
                      value={a.id}
                      exclude={b.id}
                      options={withData}
                      onChange={(id) => setPairIds([id, b.id])}
                    />
                    <PairSelector
                      label="Standort B"
                      value={b.id}
                      exclude={a.id}
                      options={withData}
                      onChange={(id) => setPairIds([a.id, id])}
                    />
                  </div>
                </Card>
              ) : null}

              {/* Abschnitt 1 — Umsatzvergleich */}
              <div>
                <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
                  Umsatzvergleich
                </h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <ComparisonCard
                    title="Gesamtumsatz"
                    a={a}
                    b={b}
                    valueOf={(r) => r.totalCents}
                    prevOf={(r) => r.prevTotalCents}
                  />
                  <ComparisonCard
                    title="Ø Tagesumsatz"
                    a={a}
                    b={b}
                    valueOf={(r) => r.avgDailyCents}
                    prevOf={(r) => r.prevAvgDailyCents}
                  />
                  <ComparisonCard
                    title="Lieferumsatz"
                    a={a}
                    b={b}
                    valueOf={(r) => r.takeawayCents}
                    prevOf={(r) => r.prevTakeawayCents}
                  />
                </div>
              </div>

              {/* Abschnitt 2 — Trinkgelder */}
              <div>
                <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
                  Trinkgelder
                </h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <ComparisonCard
                    title="Service-Trinkgeld"
                    a={a}
                    b={b}
                    valueOf={(r) => r.serviceTipCents}
                    prevOf={(r) => r.prevServiceTipCents}
                  />
                  <ComparisonCard
                    title="Küchen-Trinkgeld"
                    a={a}
                    b={b}
                    valueOf={(r) => r.kitchenTipCents}
                    prevOf={(r) => r.prevKitchenTipCents}
                  />
                  <ComparisonCard
                    title="Ø Trinkgeld / Tag"
                    a={a}
                    b={b}
                    valueOf={(r) => r.avgTipPerDayCents}
                    prevOf={(r) => r.prevAvgTipPerDayCents}
                  />
                  {/* STAT2d — QUOTE: Delta in Prozentpunkten, Bezug Haus-Umsatz. */}
                  <RateCompareCard
                    title="Trinkgeld-Quote"
                    subtitle="bezogen auf Haus-Umsatz"
                    a={a}
                    b={b}
                    valueOf={(r) => r.tipRatePct}
                    prevOf={(r) => r.prevTipRatePct}
                  />
                </div>
              </div>

              {/* STAT2b — Gäste & Personal: Rohsummen mit Anteils-Balken,
                  Dichte-Kennzahlen ohne Balken (Anteil wäre irreführend). */}
              <div>
                <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
                  Gäste &amp; Personal
                </h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <SumCompareCard
                    title="Gäste"
                    a={a}
                    b={b}
                    valueOf={(r) => r.guestTotal}
                    prevOf={(r) => r.prevGuestTotal}
                    format={(v) => v.toLocaleString("de-DE")}
                  />
                  <SumCompareCard
                    title="Arbeitsstunden"
                    a={a}
                    b={b}
                    valueOf={(r) => r.workMinutesTotal}
                    prevOf={(r) => r.prevWorkMinutesTotal}
                    format={fmtMinutesAsHours}
                  />
                  <KpiCompareCard
                    title="Ø Umsatz je Gast"
                    a={a}
                    b={b}
                    valueOf={(r) => r.revenuePerGuestCents}
                    prevOf={(r) => r.prevRevenuePerGuestCents}
                  />
                  <KpiCompareCard
                    title="Umsatz je Arbeitsstunde"
                    a={a}
                    b={b}
                    valueOf={(r) => r.revenuePerWorkHourCents}
                    prevOf={(r) => r.prevRevenuePerWorkHourCents}
                  />
                </div>
              </div>
            </>
          ) : null}

          {/* Fußkarte „Tage mit Daten" */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tage mit Daten
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{r.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {r.daysWithData}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function OverallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function PairSelector({
  label,
  value,
  exclude,
  options,
  onChange,
}: {
  label: string;
  value: string;
  exclude: string;
  options: CompareLocation[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = opt.id === value;
          const disabled = opt.id === exclude;
          return (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onChange(opt.id)}
            >
              {opt.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// ============ STAT2c — Vergleichskarten ============
//
// Ehrliche Beschriftung: EIN zentrales Standort-gegen-Standort-Delta mit
// benanntem Bezug (aus `leadDelta`) plus je Standort eine Trendzeile gegen
// das eigene Vormonatsfenster (aus `previousTrendLabel`). Die frühere
// ±-Doppelanzeige je Seite ist entfallen — sie wurde als Vormonatstrend
// missverstanden.

function LeadDeltaLine({ text, tone }: { text: string; tone: "up" | "down" | "neutral" }) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted/60 px-2 py-1 text-center text-xs font-medium",
        tone === "up"
          ? "text-emerald-700"
          : tone === "down"
            ? "text-rose-700"
            : "text-muted-foreground",
      )}
    >
      {text}
    </div>
  );
}

/**
 * Niveau-Balken für Verhältniszahlen (€ je Gast, € je Arbeitsstunde):
 * zwei getrennte Balken, jeweils skaliert am größeren der beiden Werte.
 * Bewusst KEIN Anteils-Balken — ein „Anteil" wäre bei Dichte-Kennzahlen
 * irreführend. Fehlende Werte (null) ⇒ leerer Balken.
 *
 * Bei Summen-Kacheln wird zusätzlich der Anteil je Zeile eingeblendet
 * (`aPct`/`bPct`) — dort ist ein Anteil sachlich zulässig.
 */
function LevelBar({
  a,
  b,
  aValue,
  bValue,
  format,
  aPct,
  bPct,
}: {
  a: string;
  b: string;
  aValue: number | null;
  bValue: number | null;
  format: (value: number) => string;
  aPct?: number;
  bPct?: number;
}) {
  const max = Math.max(aValue ?? 0, bValue ?? 0);
  const widthOf = (v: number | null) => (max > 0 && v !== null ? (v / max) * 100 : 0);
  const rows: Array<{ name: string; value: number | null; cls: string; pct?: number }> = [
    { name: a, value: aValue, cls: "bg-chart-1", pct: aPct },
    { name: b, value: bValue, cls: "bg-chart-2", pct: bPct },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${row.cls}`}
              style={{ width: `${widthOf(row.value)}%` }}
              aria-label={`${row.name}: ${row.value === null ? "—" : format(row.value)}`}
            />
          </div>
          {row.pct !== undefined ? (
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {row.pct} %
            </span>
          ) : null}
          <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {row.value === null ? "—" : format(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Eine Standort-Seite: Name, Wert, Trendzeile gegen das eigene Vormonatsfenster. */
function CompareSide({
  name,
  text,
  trendText,
  trendTone,
  align,
  tone,
}: {
  name: string;
  text: string;
  trendText: string;
  trendTone: "up" | "down" | "neutral";
  align: "left" | "right";
  tone: "a" | "b";
}) {
  const dotCls = tone === "a" ? "bg-chart-1" : "bg-chart-2";
  return (
    <div className={cn("flex-1 min-w-0", align === "right" ? "text-right" : "text-left")}>
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          align === "right" ? "justify-end" : "",
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", dotCls)} aria-hidden />
        <span className="truncate">{name}</span>
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{text}</div>
      <div
        className={cn(
          "mt-1 text-[11px] tabular-nums",
          trendTone === "up"
            ? "text-emerald-700"
            : trendTone === "down"
              ? "text-rose-700"
              : "text-muted-foreground",
        )}
      >
        {trendText}
      </div>
    </div>
  );
}

/** Euro-Vergleich (Umsatz, Trinkgeld) mit Anteils-Balken. */
function ComparisonCard({
  title,
  a,
  b,
  valueOf,
  prevOf,
}: {
  title: string;
  a: CompareLocation;
  b: CompareLocation;
  valueOf: (row: CompareLocation) => number;
  prevOf: (row: CompareLocation) => number | null;
}) {
  return (
    <SumCompareCard title={title} a={a} b={b} valueOf={valueOf} prevOf={prevOf} format={fmtEuro} />
  );
}

/** Summen-Vergleich mit eigener Formatierung (Euro, Gäste, Stunden). */
function SumCompareCard({
  title,
  a,
  b,
  valueOf,
  prevOf,
  format,
}: {
  title: string;
  a: CompareLocation;
  b: CompareLocation;
  valueOf: (row: CompareLocation) => number;
  prevOf: (row: CompareLocation) => number | null;
  format: (value: number) => string;
}) {
  const av = valueOf(a);
  const bv = valueOf(b);
  const aPct = Math.round(shareOf(av, bv) * 100);
  const lead = leadDelta({ aName: a.name, bName: b.name, aValue: av, bValue: bv });
  const aTrend = previousTrendLabel(av, prevOf(a), a.previousRange, { partial: a.previousPartial });
  const bTrend = previousTrendLabel(bv, prevOf(b), b.previousRange, { partial: b.previousPartial });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <CompareSide
            name={a.name}
            text={format(av)}
            trendText={aTrend.text}
            trendTone={aTrend.tone}
            align="left"
            tone="a"
          />
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            VS
          </div>
          <CompareSide
            name={b.name}
            text={format(bv)}
            trendText={bTrend.text}
            trendTone={bTrend.tone}
            align="right"
            tone="b"
          />
        </div>
        <LeadDeltaLine text={lead.text} tone={lead.tone} />
        <LevelBar
          a={a.name}
          b={b.name}
          aValue={av}
          bValue={bv}
          format={format}
          aPct={aPct}
          bPct={100 - aPct}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Dichte-Kennzahlen (€ je Gast, € je Arbeitsstunde): Niveau-Balken statt
 * Anteils-Balken — ein „Anteil" ist bei Verhältniszahlen irreführend.
 * Wertepaar kommt aus `compareKpi`; Nenner-0 ⇒ „—".
 */
function KpiCompareCard({
  title,
  a,
  b,
  valueOf,
  prevOf,
}: {
  title: string;
  a: CompareLocation;
  b: CompareLocation;
  valueOf: (row: CompareLocation) => number | null;
  prevOf: (row: CompareLocation) => number | null;
}) {
  const c = compareKpi(valueOf(a), valueOf(b));
  const lead = leadDelta({ aName: a.name, bName: b.name, aValue: c.aValue, bValue: c.bValue });
  const aTrend = previousTrendLabel(c.aValue, prevOf(a), a.previousRange, {
    partial: a.previousPartial,
  });
  const bTrend = previousTrendLabel(c.bValue, prevOf(b), b.previousRange, {
    partial: b.previousPartial,
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <CompareSide
            name={a.name}
            text={c.aValue === null ? "—" : fmtEuro(c.aValue)}
            trendText={aTrend.text}
            trendTone={aTrend.tone}
            align="left"
            tone="a"
          />
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            VS
          </div>
          <CompareSide
            name={b.name}
            text={c.bValue === null ? "—" : fmtEuro(c.bValue)}
            trendText={bTrend.text}
            trendTone={bTrend.tone}
            align="right"
            tone="b"
          />
        </div>
        <LeadDeltaLine text={lead.text} tone={lead.tone} />
        <LevelBar a={a.name} b={b.name} aValue={c.aValue} bValue={c.bValue} format={fmtEuro} />
      </CardContent>
    </Card>
  );
}

// ============ STAT2b — Gäste & Personal ============

/** STAT2d — Quotenformat: „8,9 %", eine Nachkommastelle; null ⇒ „—". */
function fmtQuotePct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/**
 * STAT2d — Vergleichskachel für eine QUOTEN-Kennzahl (Trinkgeld-Quote).
 * Aufbau wie `KpiCompareCard` (Niveau-Balken, skaliert auf die größere Quote),
 * aber die Vorperioden-Zeile zeigt PROZENTPUNKTE („+0,2 pp"), nicht relatives
 * Wachstum. Die Bezugsbasis steht als Untertitel auf der Karte.
 */
function RateCompareCard({
  title,
  subtitle,
  a,
  b,
  valueOf,
  prevOf,
}: {
  title: string;
  subtitle: string;
  a: CompareLocation;
  b: CompareLocation;
  valueOf: (row: CompareLocation) => number | null;
  prevOf: (row: CompareLocation) => number | null;
}) {
  const c = compareKpi(valueOf(a), valueOf(b));
  // STAT2d-Mikro-Nachtrag: Quoten-Kachel spricht durchgehend Prozentpunkte.
  const lead = ppLeadDelta({ aName: a.name, bName: b.name, aValue: c.aValue, bValue: c.bValue });
  const aTrend = ppTrendLabel(c.aValue, prevOf(a), a.previousRange, { partial: a.previousPartial });
  const bTrend = ppTrendLabel(c.bValue, prevOf(b), b.previousRange, { partial: b.previousPartial });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <CompareSide
            name={a.name}
            text={fmtQuotePct(c.aValue)}
            trendText={aTrend.text}
            trendTone={aTrend.tone}
            align="left"
            tone="a"
          />
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            VS
          </div>
          <CompareSide
            name={b.name}
            text={fmtQuotePct(c.bValue)}
            trendText={bTrend.text}
            trendTone={bTrend.tone}
            align="right"
            tone="b"
          />
        </div>
        <LeadDeltaLine text={lead.text} tone={lead.tone} />
        <LevelBar
          a={a.name}
          b={b.name}
          aValue={c.aValue}
          bValue={c.bValue}
          format={(v) => fmtQuotePct(v)}
        />
      </CardContent>
    </Card>
  );
}

/** Arbeitsminuten als Stunden („h"-Format wie im Umsatz-Tab-Panel). */
function fmtMinutesAsHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}
