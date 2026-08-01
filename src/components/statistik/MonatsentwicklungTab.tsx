// MB1 — Tab „Monatsentwicklung": Heatmap-Matrix (Jahre × Monate),
// Jahresverlauf-Chart und Kennzahlen-Kopf. Reines Frontend: alle Werte kommen
// fertig aus `getMonthlyRevenueMatrix` / `monthly-core.ts` — hier wird nichts
// gerechnet außer der Farbnormierung der Heatmap.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getMonthlyRevenueMatrix } from "@/lib/statistics/monthly-revenue.functions";
import { generateMonatsberichtPdf, MONTH_LABELS } from "@/lib/statistics/monatsbericht-pdf";
import type { MonthlyCell } from "@/lib/statistics/monthly-core";
import { displayEuros, displayTsd } from "@/lib/statistics/monthly-core";
import type { MonthlyViewMode } from "@/lib/statistics/monthly-view";
import { viewHeadline, viewMaxCents, viewYearRows } from "@/lib/statistics/monthly-view";
import { fmtCents } from "@/lib/format";
import { cn } from "@/lib/utils";

type Matrix = Awaited<ReturnType<typeof getMonthlyRevenueMatrix>>;
type Series = Matrix["series"][number];

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

function fmtEuro(cents: number): string {
  return `${fmtCents(cents)} €`;
}

function fmtEuroOrDash(cents: number | null): string {
  return cents === null ? "—" : fmtEuro(cents);
}

function fmtPct(pct: number | null): string {
  return pct === null ? "—" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)} %`;
}

function tsd(cents: number): string {
  return String(displayTsd(cents));
}

function monthLabelFromKey(key: string): string {
  const year = key.slice(0, 4);
  const idx = Number(key.slice(5, 7)) - 1;
  return `${MONTH_NAMES_LONG[idx] ?? key} ${year}`;
}

/** Zellfarbe relativ zum Standort-Maximum — dezente Intensitätsstufen. */
function heatClass(value: number | null, maxCents: number): string {
  if (value === null || maxCents <= 0) return "bg-muted/30 text-muted-foreground";
  const ratio = value / maxCents;
  if (ratio >= 0.85) return "bg-primary/80 text-primary-foreground";
  if (ratio >= 0.7) return "bg-primary/60 text-primary-foreground";
  if (ratio >= 0.55) return "bg-primary/40 text-foreground";
  if (ratio >= 0.4) return "bg-primary/25 text-foreground";
  if (ratio >= 0.25) return "bg-primary/15 text-foreground";
  return "bg-primary/5 text-foreground";
}

const YEAR_COLORS = [
  "hsl(215 90% 55%)",
  "hsl(160 70% 40%)",
  "hsl(35 90% 50%)",
  "hsl(280 60% 55%)",
  "hsl(0 70% 55%)",
  "hsl(190 70% 45%)",
];

export function MonatsentwicklungTab() {
  const q = useQuery({
    queryKey: ["monthlyRevenueMatrix"],
    queryFn: () => getMonthlyRevenueMatrix({ data: {} }),
  });
  const [scope, setScope] = useState<string>("all");
  const [yearsN, setYearsN] = useState<"3" | "5" | "all">("5");
  // MB2 — Takeaway ist Teilmenge des Gesamtumsatzes (N14): Umschalter statt
  // Zusatzspalte, sonst verleitet die Nebeneinander-Darstellung zur Addition.
  const [mode, setMode] = useState<MonthlyViewMode>("total");
  const [pdfBusy, setPdfBusy] = useState(false);

  const series: Series | null = useMemo(() => {
    if (!q.data) return null;
    return q.data.series.find((s) => s.locationId === scope) ?? q.data.series.at(-1) ?? null;
  }, [q.data, scope]);

  const viewRows = useMemo(() => (series ? viewYearRows(series.years, mode) : []), [series, mode]);

  const maxCents = useMemo(() => viewMaxCents(viewRows), [viewRows]);

  const chartYears = useMemo(() => {
    const all = viewRows.map((r) => r.year);
    if (yearsN === "all") return all;
    return all.slice(-Number(yearsN));
  }, [viewRows, yearsN]);

  const chartData = useMemo(() => {
    return MONTH_LABELS.map((label, idx) => {
      const row: Record<string, number | string | null> = { month: label };
      for (const y of viewRows) {
        if (!chartYears.includes(y.year)) continue;
        const value = y.values[idx];
        row[String(y.year)] = value === null || value === undefined ? null : displayEuros(value);
      }
      return row;
    });
  }, [viewRows, chartYears]);

  async function handlePdf() {
    if (!series || !q.data) return;
    setPdfBusy(true);
    try {
      const years = yearsN === "all" ? series.years : series.years.slice(-10);
      const { doc, fileName } = await generateMonatsberichtPdf({
        monthLabel: monthLabelFromKey(q.data.focusMonth),
        monthKey: q.data.focusMonth,
        scopeLabel: series.locationName,
        headline: series.headline,
        years,
      });
      doc.save(fileName);
    } finally {
      setPdfBusy(false);
    }
  }

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-[320px]" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <Card className="border-rose-300/60 bg-rose-50/50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
        <div className="font-medium">Monatsentwicklung konnte nicht geladen werden.</div>
        <div className="mt-1 text-xs opacity-80">
          {(q.error as Error)?.message ?? "Unbekannter Fehler"}
        </div>
      </Card>
    );
  }
  if (!q.data || !series) return null;

  const h = series.headline;
  const currentYear = Number(q.data.focusMonth.slice(0, 4));

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Standort
            </Label>
            <div className="inline-flex h-10 items-center rounded-md border border-input p-0.5">
              {q.data.series.map((s) => (
                <Button
                  key={s.locationId}
                  type="button"
                  size="sm"
                  variant={scope === s.locationId ? "default" : "ghost"}
                  onClick={() => setScope(s.locationId)}
                >
                  {s.locationName}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Jahre im Verlauf
            </Label>
            <div className="inline-flex h-10 items-center rounded-md border border-input p-0.5">
              {(["3", "5", "all"] as const).map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={yearsN === n ? "default" : "ghost"}
                  onClick={() => setYearsN(n)}
                >
                  {n === "all" ? "alle" : n}
                </Button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="ml-auto h-10"
            onClick={handlePdf}
            disabled={pdfBusy}
          >
            <Download className="h-4 w-4" />
            Monatsbericht
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {monthLabelFromKey(h.monthKey)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">
              {fmtEuroOrDash(h.currentCents)}
            </div>
            <div className="text-xs text-muted-foreground">
              Vorjahresmonat {fmtEuroOrDash(h.previousYearCents)} ·{" "}
              {h.yoyExcludedPartial ? "läuft noch" : fmtPct(h.yoyPct)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jahressumme bis {MONTH_LABELS[Number(h.monthKey.slice(5, 7)) - 1]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">{fmtEuro(h.ytdCents)}</div>
            <div className="text-xs text-muted-foreground">
              Vorjahr {fmtEuroOrDash(h.previousYearYtdCents)} · {fmtPct(h.ytdPct)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Bestes Jahr für diesen Monat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold tabular-nums">
              {h.bestForMonth ? fmtEuro(h.bestForMonth.totalCents) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {h.bestForMonth ? h.bestForMonth.year : "keine Historie"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monatsumsätze in T€</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium text-muted-foreground">Jahr</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="px-2 py-1 text-right font-medium text-muted-foreground">
                    {m}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-medium text-muted-foreground">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {[...series.years].reverse().map((y) => (
                <tr key={y.year}>
                  <td className="px-2 py-1 font-medium tabular-nums">{y.year}</td>
                  {y.months.map((cell, idx) => (
                    <td
                      key={idx}
                      className={cn(
                        "rounded px-2 py-1 text-right tabular-nums",
                        heatClass(cell, maxCents),
                      )}
                      title={
                        cell
                          ? `${MONTH_NAMES_LONG[idx]} ${y.year}: ${fmtEuro(cell.totalCents)}` +
                            (cell.takeawayCents !== null
                              ? ` · davon Takeaway ${fmtEuro(cell.takeawayCents)}`
                              : "") +
                            ` · ${cell.source === "legacy" ? "Historie (Excel-Import)" : "von COCO berechnet"}` +
                            (cell.partial ? " · läuft noch" : "")
                          : `${MONTH_NAMES_LONG[idx]} ${y.year}: keine Daten`
                      }
                    >
                      {cell ? tsd(cell.totalCents) : ""}
                      {cell?.partial ? (
                        <span className="ml-1 text-[10px] opacity-70">läuft</span>
                      ) : null}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-medium tabular-nums">
                    {tsd(y.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Werte in Tausend Euro. Vor {q.data.liveFrom.slice(0, 7)} aus der Excel-Historie, danach
            von COCO aus den Kassenabschlüssen berechnet (Details im Tooltip).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Jahresverlauf</CardTitle>
        </CardHeader>
        <CardContent className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `${Math.round(v / 1000)} T€`}
              />
              <Tooltip
                formatter={(v: number | string) =>
                  typeof v === "number" ? fmtEuro(v * 100) : String(v)
                }
              />
              <Legend />
              {chartYears.map((year, idx) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={String(year)}
                  name={String(year)}
                  stroke={
                    year === currentYear ? "var(--primary)" : YEAR_COLORS[idx % YEAR_COLORS.length]
                  }
                  strokeWidth={year === currentYear ? 3 : 1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
