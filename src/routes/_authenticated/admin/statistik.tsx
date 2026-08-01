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
import { Input } from "@/components/ui/input";
import { listLocations } from "@/lib/admin/locations.functions";
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
} from "@/lib/statistics/revenue-core";
import { pctDiff, shareOf, pickTopTwoByTotal } from "@/lib/statistics/comparison-core";
import { formatComparisonRange } from "@/lib/statistics/comparison-label";
import { generateStatistikPdf, type StatistikPdfData } from "@/lib/statistics/statistik-pdf";
import { currentMonth, monthRange } from "@/lib/statistics/period-window";
import { fillDailyGaps } from "@/lib/statistics/chart-fill";
import { fmtCents } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);

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
    compareError !== null;

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

    const ratio = personnelRatioPct(per.totals.laborCostCents, rev.summary.totalCents);
    // STAT1b — gleiche Quelle wie der Donut.
    const segs = takeawayDonutSegments(
      rev.takeawayComponents.markerSumCents,
      rev.takeawayComponents.souseSumCents,
      rev.summary.woltInfoCents,
    );
    const staffWithoutRateNames = per.staffWithoutRate.map(
      (id) => per.perStaff.find((p) => p.staffId === id)?.name ?? id,
    );

    const comparison: StatistikPdfData["comparison"] = [];
    locations.forEach((loc, i) => {
      const r = revQueries[i]?.data;
      const t = tipQueries[i]?.data;
      const p = perQueries[i]?.data;
      if (!r || !t || !p) return;
      comparison.push({
        locationName: loc.name,
        totalCents: r.summary.totalCents,
        tipTotalCents: t.totals.totalCents,
        ratioPct: personnelRatioPct(p.totals.laborCostCents, r.summary.totalCents),
        netHours: p.totals.netHours,
        laborCostCents: p.totals.laborCostCents,
        hasMissingRate: p.staffWithoutRate.length > 0,
      });
    });

    const data: StatistikPdfData = {
      monthLabel,
      scopeLabel,
      revenue: {
        houseCents: rev.summary.houseCents,
        takeawayCents: rev.summary.takeawayCents,
        totalCents: rev.summary.totalCents,
        daysWithRevenue: rev.daily.filter((d) => d.totalCents > 0).length,
      },
      takeawaySegments: segs.segments,
      takeawaySegmentsWarning: segs.warning,
      tips: {
        serviceCents: tip.totals.serviceCents,
        kitchenCents: tip.totals.kitchenCents,
        totalCents: tip.totals.totalCents,
        perStaff: tip.perStaff.map((p) => ({
          name: p.name,
          department: p.department,
          tipCents: p.tipCents,
        })),
      },
      personnel: {
        netHours: per.totals.netHours,
        laborCostCents: per.totals.laborCostCents,
        ratioPct: ratio,
        staffWithoutRateNames,
      },
      dailyRevenue: rev.daily.map((d) => ({
        businessDate: d.businessDate,
        houseCents: d.houseCents,
        takeawayCents: d.takeawayCents,
        totalCents: d.totalCents,
      })),
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

      <Tabs defaultValue="umsatz" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="umsatz">Umsatz</TabsTrigger>
          <TabsTrigger value="trinkgeld">Trinkgeld</TabsTrigger>
          <TabsTrigger value="personal">Personalquote</TabsTrigger>
          <TabsTrigger value="vergleich">Standortvergleich</TabsTrigger>
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
        <CardContent>{hasDaily ? <RevenueChart daily={data.daily} /> : <EmptyChart />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gäste &amp; Arbeitsstunden</CardTitle>
        </CardHeader>
        <CardContent>
          {hasDaily ? (
            <GuestHoursChart daily={data.daily} />
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

function RevenueChart({ daily }: { daily: DailyRow[] }) {
  const rows = fillDailyGaps(daily).map((d) => ({
    day: d.businessDate.slice(8, 10),
    fullDate: d.businessDate,
    total: d.totalCents / 100,
    card: (d.cardCents ?? 0) / 100,
    takeaway: d.takeawayCents / 100,
    totalCents: d.totalCents,
    cardCents: d.cardCents ?? 0,
    takeawayCents: d.takeawayCents,
  }));

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
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
            type="monotone"
            dataKey="total"
            name="Tagesumsatz"
            fill="#2563eb"
            stroke="#2563eb"
            fillOpacity={0.18}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="card"
            name="Kreditkarten"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="takeaway"
            name="Takeaway"
            stroke="#16a34a"
            strokeWidth={2}
            dot={false}
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
      totalCents: number;
      cardCents: number;
      takeawayCents: number;
    };
  }>;
};

// STAT2 — Gäste (Balken, linke Achse) und Arbeitsstunden (Linie, rechte
// Achse) auf derselben X-Achse wie der Umsatzverlauf (gleiche Fill-Logik,
// kein Interpolieren). Die €-Kennzahlen je Tag kommen aus `derivedKpis`.
type GuestHoursRow = {
  day: string;
  fullDate: string;
  guests: number;
  hours: number;
  perGuestCents: number | null;
  perHourCents: number | null;
};

function GuestHoursChart({ daily }: { daily: DailyRow[] }) {
  const rows: GuestHoursRow[] = fillDailyGaps(daily).map((d) => {
    const k = derivedKpis({
      houseCents: d.houseCents,
      totalCents: d.totalCents,
      guestCount: d.guestCount ?? 0,
      workMinutes: d.workMinutes ?? 0,
    });
    return {
      day: d.businessDate.slice(8, 10),
      fullDate: d.businessDate,
      guests: d.guestCount ?? 0,
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
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
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
            type="monotone"
            dataKey="hours"
            name="Arbeitsstunden"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
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

              {/* Sechs Vergleichskarten */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ComparisonCard title="Gesamtumsatz" a={a} b={b} valueOf={(r) => r.totalCents} />
                <ComparisonCard
                  title="Ø Tagesumsatz"
                  a={a}
                  b={b}
                  valueOf={(r) => r.avgDailyCents}
                />
                <ComparisonCard title="Lieferumsatz" a={a} b={b} valueOf={(r) => r.takeawayCents} />
                <ComparisonCard
                  title="Service-Trinkgeld"
                  a={a}
                  b={b}
                  valueOf={(r) => r.serviceTipCents}
                />
                <ComparisonCard
                  title="Küchen-Trinkgeld"
                  a={a}
                  b={b}
                  valueOf={(r) => r.kitchenTipCents}
                />
                <ComparisonCard
                  title="Ø Trinkgeld / Tag"
                  a={a}
                  b={b}
                  valueOf={(r) => r.avgTipPerDayCents}
                />
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

function ComparisonCard({
  title,
  a,
  b,
  valueOf,
}: {
  title: string;
  a: CompareLocation;
  b: CompareLocation;
  valueOf: (row: CompareLocation) => number;
}) {
  const av = valueOf(a);
  const bv = valueOf(b);
  const share = shareOf(av, bv);
  const aPct = Math.round(share * 100);
  const bPct = 100 - aPct;
  const aDiff = pctDiff(av, bv);
  const bDiff = pctDiff(bv, av);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <ComparisonSide name={a.name} value={av} diff={aDiff} align="left" tone="a" />
          <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            VS
          </div>
          <ComparisonSide name={b.name} value={bv} diff={bDiff} align="right" tone="b" />
        </div>
        <div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-chart-1"
              style={{ width: `${aPct}%` }}
              aria-label={`${a.name} Anteil ${aPct} %`}
            />
            <div
              className="h-full bg-chart-2"
              style={{ width: `${bPct}%` }}
              aria-label={`${b.name} Anteil ${bPct} %`}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{aPct} %</span>
            <span>{bPct} %</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonSide({
  name,
  value,
  diff,
  align,
  tone,
}: {
  name: string;
  value: number;
  diff: number | null;
  align: "left" | "right";
  tone: "a" | "b";
}) {
  const isPos = diff !== null && diff > 0;
  const isNeg = diff !== null && diff < 0;
  const badgeCls = cn(
    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
    isPos
      ? "bg-emerald-50 text-emerald-700"
      : isNeg
        ? "bg-rose-50 text-rose-700"
        : "bg-muted text-muted-foreground",
  );
  const dotCls = tone === "a" ? "bg-chart-1" : "bg-chart-2";
  const diffLabel =
    diff === null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff).toFixed(1)} %`;
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
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
        {fmtEuro(value)}
      </div>
      <div className={cn("mt-1", align === "right" ? "flex justify-end" : "")}>
        <span className={badgeCls}>{diffLabel}</span>
      </div>
    </div>
  );
}
