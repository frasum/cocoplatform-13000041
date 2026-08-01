// PV3 — POS-Stundenbericht-Ansicht: Chart + Tabelle + Upload-Dialog.
// Wiederverwendet das UI-Muster aus dem PV2-Import (Kontrollsummen-Gates,
// atomarer Replace) und ist bewusst als eigene Komponente ausgelagert, damit
// die Route-Datei überschaubar bleibt.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  allHourlyChecksOk,
  parsePosHourly,
  type ParsedPosHourly,
} from "@/lib/bestellung/pos-hourly-parser";
import { avgPerBookingCents, hourShare } from "@/lib/bestellung/pos-hourly-server";
import type {
  PosHourlyResult,
  PosHourlyRowRead,
  ReplacePosHourlyResult,
} from "@/lib/bestellung/pos-hourly.functions";

type Period = "d365" | "alltime";
type Metric = "umsatz" | "anzahl";

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const eurFmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const intFmt = new Intl.NumberFormat("de-DE");
const pctFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatEurFromCents(cents: number | null): string {
  return cents === null ? "—" : eurFmt.format(cents / 100);
}

type ReplaceInput = {
  locationId: string;
  period: Period;
  reportDate: string;
  rows: { hour: number; anzahl: number; wertCents: number }[];
  footer: { anzahl: number; wertCents: number };
};

export function PosHourlyView({
  locationId,
  isAdmin,
  onList,
  onReplace,
}: {
  locationId: string;
  isAdmin: boolean;
  onList: (input: { locationId: string; period: Period }) => Promise<PosHourlyResult>;
  onReplace: (input: ReplaceInput) => Promise<ReplacePosHourlyResult>;
}) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("alltime");
  const [metric, setMetric] = useState<Metric>("umsatz");

  const q = useQuery({
    queryKey: ["pos-hourly", locationId, period],
    queryFn: () => onList({ locationId, period }),
    enabled: !!locationId,
  });

  const rows: PosHourlyRowRead[] = useMemo(() => q.data?.rows ?? [], [q.data]);
  const reportDate = q.data?.reportDate ?? null;

  const byHour = useMemo(() => {
    const m = new Map<number, PosHourlyRowRead>();
    for (const r of rows) m.set(r.hour, r);
    return m;
  }, [rows]);

  const totalCents = rows.reduce((s, r) => s + r.wertCents, 0);
  const totalAnzahl = rows.reduce((s, r) => s + r.anzahl, 0);
  const peakCents = rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.wertCents));
  const peakHour = rows.find((r) => r.wertCents === peakCents)?.hour ?? null;

  const chartData = useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => {
      const r = byHour.get(h);
      const wertCents = r?.wertCents ?? 0;
      const anzahl = r?.anzahl ?? 0;
      return {
        hour: h,
        label: `${h}:00`,
        wertEur: wertCents / 100,
        anzahl,
        wertCents,
        share: hourShare(wertCents, totalCents),
        avg: avgPerBookingCents(wertCents, anzahl),
        isPeak: r !== undefined && wertCents === peakCents && peakCents !== 0,
      };
    });
  }, [byHour, totalCents, peakCents]);

  const hasData = rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="d365">Letzte 365 Tage</TabsTrigger>
            <TabsTrigger value="alltime">Gesamt (seit Aufzeichnung)</TabsTrigger>
          </TabsList>
        </Tabs>
        {reportDate && (
          <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            Stand: {dateFmt.format(new Date(reportDate))}
          </span>
        )}
        {isAdmin && (
          <div className="ml-auto">
            <PosHourlyImportDialog
              locationId={locationId}
              period={period}
              onReplace={onReplace}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ["pos-hourly", locationId] });
              }}
            />
          </div>
        )}
      </div>

      {q.isError && (
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>
            {q.error instanceof Error ? q.error.message : "Fehler beim Laden."}
          </AlertDescription>
        </Alert>
      )}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Lädt …</p>
      ) : !hasData ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
          Noch keine Stundenbericht-Daten importiert.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <TabsList>
                <TabsTrigger value="umsatz">Umsatz</TabsTrigger>
                <TabsTrigger value="anzahl">Buchungen</TabsTrigger>
              </TabsList>
            </Tabs>
            {peakHour !== null && (
              <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                Peak: {peakHour}:00 · {eurFmt.format(peakCents / 100)}
              </span>
            )}
          </div>

          <div className="h-[320px] w-full rounded-md border border-border bg-card p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(v: number) =>
                    metric === "umsatz" ? eurFmt.format(v) : intFmt.format(v)
                  }
                  width={80}
                />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload as (typeof chartData)[number];
                    return (
                      <div className="rounded-md border border-border bg-popover p-2 text-xs shadow-sm">
                        <div className="font-medium">{d.label}</div>
                        <div>Umsatz: {eurFmt.format(d.wertEur)}</div>
                        <div>Buchungen: {intFmt.format(d.anzahl)}</div>
                        <div>Anteil: {d.share === null ? "—" : `${pctFmt.format(d.share)} %`}</div>
                        <div>Ø/Buchung: {formatEurFromCents(d.avg)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey={metric === "umsatz" ? "wertEur" : "anzahl"}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.hour}
                      fill={
                        d.isPeak ? "var(--primary)" : "var(--chart-1, var(--primary))"
                      }
                      fillOpacity={d.isPeak ? 1 : 0.6}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Stunde</TableHead>
                  <TableHead className="text-right">Buchungen</TableHead>
                  <TableHead className="text-right">Umsatz</TableHead>
                  <TableHead className="w-20 text-right">Anteil</TableHead>
                  <TableHead className="w-28 text-right">Ø/Buchung</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const share = hourShare(r.wertCents, totalCents);
                  const avg = avgPerBookingCents(r.wertCents, r.anzahl);
                  return (
                    <TableRow key={r.hour}>
                      <TableCell className="tabular-nums">{r.hour}:00</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {intFmt.format(r.anzahl)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatEurFromCents(r.wertCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {share === null ? "—" : `${pctFmt.format(share)} %`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatEurFromCents(avg)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-border bg-muted/30 font-semibold">
                  <TableCell>Summe</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {intFmt.format(totalAnzahl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEurFromCents(totalCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">100,0 %</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEurFromCents(avgPerBookingCents(totalCents, totalAnzahl))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

// ============================ Import-Dialog ============================

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

async function extractSheetRows(file: File): Promise<(string | number | null)[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  // "Stunden-Bericht (lang) - 1" ist üblicherweise das erste Sheet; wenn ein
  // Match auf den Namen möglich ist, bevorzugen wir das.
  const ws = wb.worksheets.find((s) => /stunden-bericht/i.test(s.name)) ?? wb.worksheets[0];
  if (!ws) throw new Error("Datei enthält kein Arbeitsblatt.");
  const out: (string | number | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: (string | number | null)[] = [];
    const max = row.cellCount;
    for (let c = 1; c <= max; c++) {
      const cell = row.getCell(c);
      const v = cell.value as unknown;
      if (v === null || v === undefined) cells.push(null);
      else if (typeof v === "number" || typeof v === "string") cells.push(v);
      else if (typeof v === "object") {
        const o = v as { text?: string; result?: number | string };
        if (typeof o.text === "string") cells.push(o.text);
        else if (typeof o.result === "number" || typeof o.result === "string") cells.push(o.result);
        else cells.push(String(v));
      } else cells.push(String(v));
    }
    out.push(cells);
  });
  return out;
}

function checkLabel(name: string): string {
  switch (name) {
    case "footer_anzahl":
      return "Kontrollsumme Buchungen (Fußzeile)";
    case "footer_wert":
      return "Kontrollsumme Umsatz (Fußzeile)";
    case "hour_valid":
      return "Stunden 0–23 eindeutig";
    default:
      return name;
  }
}

function formatCheckValue(name: string, value: number): string {
  if (name === "footer_wert") return eurFmt.format(value / 100);
  return intFmt.format(value);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PosHourlyImportDialog({
  locationId,
  period,
  onReplace,
  onDone,
}: {
  locationId: string;
  period: Period;
  onReplace: (input: ReplaceInput) => Promise<ReplacePosHourlyResult>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickedPeriod, setPickedPeriod] = useState<Period>(period);
  const [reportDate, setReportDate] = useState<string>(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedPosHourly | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: (input: ReplaceInput) => onReplace(input),
  });

  function reset() {
    setFile(null);
    setParsed(null);
    setParseError(null);
    setServerError(null);
  }

  useEffect(() => {
    if (open) {
      setPickedPeriod(period);
      setReportDate(todayIso());
      reset();
    }
  }, [open, period]);

  async function handleFile(f: File) {
    setFile(f);
    setParsed(null);
    setParseError(null);
    setServerError(null);
    try {
      const raw = await extractSheetRows(f);
      setParsed(parsePosHourly(raw));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
    }
  }

  const canSubmit = !!parsed && allHourlyChecksOk(parsed) && !!locationId && !submitMut.isPending;

  async function handleSubmit() {
    if (!parsed || !locationId || !parsed.footer) return;
    setServerError(null);
    try {
      const res = await submitMut.mutateAsync({
        locationId,
        period: pickedPeriod,
        reportDate,
        rows: parsed.rows,
        footer: parsed.footer,
      });
      toast.success(
        `Import gespeichert: ${intFmt.format(res.hourCount)} Stunden, ${intFmt.format(
          res.sumAnzahl,
        )} Buchungen / ${eurFmt.format(res.sumCents / 100)}.`,
      );
      onDone();
      setOpen(false);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Import fehlgeschlagen.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!locationId}>
          Stundenbericht importieren…
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>POS-Stundenbericht importieren</DialogTitle>
          <DialogDescription>
            Vectron „Stunden-Bericht (lang)" (XLSX) einlesen, Kontrollsummen prüfen und Standort ×
            Periode ersetzen. Die Datei bleibt im Browser — nur die geprüften Zeilen gehen an den
            Server.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Periode</Label>
            <Select value={pickedPeriod} onValueChange={(v) => setPickedPeriod(v as Period)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="d365">Letzte 365 Tage</SelectItem>
                <SelectItem value="alltime">Gesamt (seit Aufzeichnung)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Stichtag</Label>
            <Input
              type="date"
              value={reportDate}
              max={todayIso()}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Datei</Label>
          <Input
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          {file && (
            <p className="text-xs text-muted-foreground">
              {file.name} ({Math.round(file.size / 1024)} kB)
            </p>
          )}
        </div>

        {parseError && (
          <Alert variant="destructive">
            <AlertTitle>Datei nicht lesbar</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {parsed && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <SummaryCard label="Stunden" value={intFmt.format(parsed.rows.length)} />
              <SummaryCard
                label="Σ Buchungen"
                value={intFmt.format(parsed.rows.reduce((s, r) => s + r.anzahl, 0))}
              />
              <SummaryCard
                label="Σ Umsatz"
                value={eurFmt.format(parsed.rows.reduce((s, r) => s + r.wertCents, 0) / 100)}
              />
            </div>

            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prüfung</TableHead>
                    <TableHead className="text-right">Soll (Fußzeile)</TableHead>
                    <TableHead className="text-right">Ist</TableHead>
                    <TableHead className="w-16 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.checks.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell>{checkLabel(c.name)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCheckValue(c.name, c.expected)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCheckValue(c.name, c.actual)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.ok ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                            OK
                          </span>
                        ) : (
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            Fehler
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {parsed.warnings.length > 0 && (
              <details className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  {parsed.warnings.length} Warnung(en)
                </summary>
                <ul className="mt-2 list-disc pl-5">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}

            <p className="text-xs text-muted-foreground">
              Speichern ersetzt alle Stunden für (Standort × Periode) atomar.
            </p>
          </div>
        )}

        {serverError && (
          <Alert variant="destructive">
            <AlertTitle>Import abgelehnt</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitMut.isPending}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitMut.isPending ? "Speichere…" : "Speichern & ersetzen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
