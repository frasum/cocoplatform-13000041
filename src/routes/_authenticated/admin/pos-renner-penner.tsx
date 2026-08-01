// RP1 — POS-Verkauf → Renner & Penner. Ranglisten der Getränke je Standort
// über einen (Snapshot-)Zeitraum, mit Wein-Zusammenführung (offene Gläser +
// Flaschen) und Ladenhüter-Liste.
//
// Datenrealität: sales_article_stats speichert je period nur EINEN Snapshot
// (d365 = letzte 365 Tage, alltime = Gesamt). Kein tagesgenauer Zeitraum
// möglich — Umschalter zeigt genau diese beiden Sichten (Konflikt-Meldung
// im Chat vom 07.07.).

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { listLocations } from "@/lib/admin/locations.functions";
import { PosNav } from "@/components/bestellung/PosNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { WeBadge } from "@/components/verkaufsartikel/we-badge";
import { fmtCents } from "@/lib/format";
import { getRennerPenner, type RennerPennerResult } from "@/lib/pos/renner-penner.functions";
import type { RennerEntry } from "@/lib/pos/renner-penner-core";
import { locationThemeKey } from "@/lib/location-theme/location-theme";

export const Route = createFileRoute("/_authenticated/admin/pos-renner-penner")({
  head: () => ({ meta: [{ title: "Renner & Penner · POS-Verkauf" }] }),
  component: RennerPennerPage,
});

type Period = "d365" | "alltime";
type SortKey = "umsatz" | "menge" | "db";

const DEFAULT_GROUPS = ["Wein", "Spirituosen", "Cocktails"];
const TOP_N = 15;

// RP2 — Farbtabelle für Standort-Segmente in den Diagrammen.
// Bekannte Standorte behalten ihre Marken-Akzentfarbe (spicery = gelb,
// yum = koralle, siehe styles.css). Fallback-Palette für weitere Standorte.
const LOCATION_FALLBACK_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#0ea5e9", "#f97316"];

function colorForLocation(name: string, indexHint: number): string {
  const k = locationThemeKey(name);
  if (k === "spicery") return "#facc15";
  if (k === "yum") return "#f08a7a";
  return LOCATION_FALLBACK_COLORS[indexHint % LOCATION_FALLBACK_COLORS.length];
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const intFmt = new Intl.NumberFormat("de-DE");
const decFmt = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function RennerPennerPage() {
  const callGet = useServerFn(getRennerPenner);
  const locationsQ = useQuery({ queryKey: ["locations"], queryFn: () => listLocations() });
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  useEffect(() => {
    if (locationIds.length === 0 && locations.length > 0) setLocationIds([locations[0].id]);
  }, [locations, locationIds.length]);

  const [period, setPeriod] = useState<Period>("d365");
  const [groups, setGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [sortKey, setSortKey] = useState<SortKey>("umsatz");

  const dataQ = useQuery<RennerPennerResult>({
    queryKey: [
      "renner-penner",
      locationIds.slice().sort().join("|"),
      period,
      groups.slice().sort().join("|"),
    ],
    queryFn: () => callGet({ data: { locationIds, period, groups } }),
    enabled: locationIds.length > 0,
  });

  const entries = useMemo(() => dataQ.data?.entries ?? [], [dataQ.data]);
  const groupOptions = dataQ.data?.groupOptions ?? [];
  const ladenhueter = dataQ.data?.ladenhueter ?? [];
  const reportDate = dataQ.data?.reportDate ?? null;
  const selectedLocations = useMemo(() => dataQ.data?.locations ?? [], [dataQ.data]);
  const locationColors = useMemo(() => {
    const map = new Map<string, string>();
    selectedLocations.forEach((l, i) => map.set(l.id, colorForLocation(l.name, i)));
    return map;
  }, [selectedLocations]);

  // KPI-Zeile
  const totals = useMemo(() => {
    let umsatz = 0;
    let einheiten = 0;
    let vol = 0;
    let volKnown = true;
    let ekwSum = 0;
    let ekwCount = 0;
    for (const e of entries) {
      umsatz += e.umsatzCents;
      einheiten += e.einheitenGesamt;
      if (e.volumenMl === null) volKnown = false;
      else vol += e.volumenMl;
      if (e.ekwPct !== null) {
        ekwSum += e.ekwPct;
        ekwCount += 1;
      }
    }
    return {
      umsatz,
      einheiten,
      liter: volKnown ? vol / 1000 : null,
      ekwAvg: ekwCount > 0 ? ekwSum / ekwCount : null,
    };
  }, [entries]);

  const sorted = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
    return arr;
  }, [entries, sortKey]);

  const renner = sorted.slice(0, TOP_N);
  const penner = useMemo(
    () =>
      [...entries]
        .filter((e) => e.einheitenGesamt > 0)
        .sort((a, b) => sortValue(a, sortKey) - sortValue(b, sortKey))
        .slice(0, TOP_N),
    [entries, sortKey],
  );

  return (
    <div className="space-y-4">
      <PosNav />
      <div>
        <h2 className="text-lg font-semibold text-foreground">Renner &amp; Penner</h2>
        <p className="text-sm text-muted-foreground">
          Rangliste der Getränke aus dem aktuellen POS-Snapshot. Ein VA-Bündel (offene Gläser +
          Flasche desselben Weins) erscheint als ein Eintrag. Mehrere Standorte lassen sich zum
          Vergleich markieren — gleicher Artikelname zählt standort-übergreifend als ein Eintrag;
          die Segmentfarbe zeigt den Anteil je Standort.
        </p>
      </div>

      <LocationMultiPills locations={locations} selected={locationIds} onChange={setLocationIds} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="d365">Letzte 365 Tage</TabsTrigger>
            <TabsTrigger value="alltime">Gesamt</TabsTrigger>
          </TabsList>
        </Tabs>
        {reportDate && (
          <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            Stand: {dateFmt.format(new Date(reportDate))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sortierung:</span>
          <Tabs value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <TabsList>
              <TabsTrigger value="umsatz">Umsatz</TabsTrigger>
              <TabsTrigger value="menge">Menge</TabsTrigger>
              <TabsTrigger value="db">DB</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(entries, ladenhueter, period)}
            disabled={entries.length === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      <GroupChips options={groupOptions} value={groups} onChange={setGroups} />

      {dataQ.isError && (
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>
            {dataQ.error instanceof Error ? dataQ.error.message : "Fehler beim Laden."}
          </AlertDescription>
        </Alert>
      )}

      <KpiRow
        umsatzCents={totals.umsatz}
        einheiten={totals.einheiten}
        liter={totals.liter}
        ekwAvg={totals.ekwAvg}
      />

      {dataQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Lädt …</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Verkäufe im gewählten Filter.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <RankingSection
            title="🏆 Renner"
            entries={renner}
            sortKey={sortKey}
            locationColors={locationColors}
            locationOrder={selectedLocations}
          />
          <RankingSection
            title="💤 Penner"
            entries={penner}
            sortKey={sortKey}
            locationColors={locationColors}
            locationOrder={selectedLocations}
          />
        </div>
      )}

      <LadenhueterCard rows={ladenhueter} />
    </div>
  );
}

function LocationMultiPills({
  locations,
  selected,
  onChange,
}: {
  locations: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (locations.length === 0) return null;
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) return; // mind. 1 auswählen
      onChange(selected.filter((x) => x !== id));
    } else {
      // Reihenfolge der `locations`-Liste bewahren
      const next = locations.filter((l) => l.id === id || selected.includes(l.id)).map((l) => l.id);
      onChange(next);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Standorte">
      {locations.map((l, i) => {
        const active = selected.includes(l.id);
        const color = colorForLocation(l.name, i);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => toggle(l.id)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
            style={active ? { background: color, borderColor: color, color: "#111" } : undefined}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function sortValue(e: RennerEntry, key: SortKey): number {
  switch (key) {
    case "umsatz":
      return e.umsatzCents;
    case "menge":
      return e.einheitenGesamt;
    case "db":
      return e.dbCents ?? Number.NEGATIVE_INFINITY;
  }
}

function KpiRow({
  umsatzCents,
  einheiten,
  liter,
  ekwAvg,
}: {
  umsatzCents: number;
  einheiten: number;
  liter: number | null;
  ekwAvg: number | null;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Umsatz (Auswahl)" value={`${fmtCents(umsatzCents)} €`} />
      <Kpi label="Einheiten" value={intFmt.format(einheiten)} />
      <Kpi label="Liter (belinkt)" value={liter === null ? "—" : `${decFmt.format(liter)} L`} />
      <Kpi label="Ø-Wareneinsatz" value={ekwAvg === null ? "—" : `${decFmt.format(ekwAvg)} %`} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function GroupChips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) return null;
  const toggle = (g: string) => {
    if (value.includes(g)) onChange(value.filter((x) => x !== g));
    else onChange([...value, g]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Warengruppen:</span>
      {options.map((g) => {
        const on = value.includes(g);
        return (
          <button
            key={g}
            type="button"
            onClick={() => toggle(g)}
            aria-pressed={on}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              on
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {g}
          </button>
        );
      })}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          alle
        </button>
      )}
    </div>
  );
}

function RankingSection({
  title,
  entries,
  sortKey,
  locationColors,
  locationOrder,
}: {
  title: string;
  entries: RennerEntry[];
  sortKey: SortKey;
  locationColors: Map<string, string>;
  locationOrder: { id: string; name: string }[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const multi = locationOrder.length > 1;

  // Chart-Zeilen: bei Mehrfach-Standort stapeln wir pro Standort-Segment.
  const chartData = entries.map((e) => {
    const row: Record<string, string | number> = { name: e.name };
    if (multi) {
      for (const loc of locationOrder) {
        const slice = e.perLocation.find((s) => s.locationId === loc.id);
        row[loc.id] = sliceValue(slice, sortKey);
      }
    } else {
      row.value =
        sortKey === "umsatz"
          ? e.umsatzCents / 100
          : sortKey === "menge"
            ? e.einheitenGesamt
            : (e.dbCents ?? 0) / 100;
    }
    return row;
  });

  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">{title}</div>
      {entries.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">Keine Einträge.</div>
      ) : (
        <>
          {multi && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              {locationOrder.map((loc) => (
                <span key={loc.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: locationColors.get(loc.id) ?? "#888" }}
                  />
                  {loc.name}
                </span>
              ))}
            </div>
          )}
          <div className="p-2" style={{ height: Math.max(200, entries.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  tick={{ fontSize: 11 }}
                  interval={0}
                />
                <Tooltip
                  formatter={(v: number) =>
                    sortKey === "menge" ? intFmt.format(v) : `${v.toFixed(2)} €`
                  }
                />
                {multi ? (
                  locationOrder.map((loc, idx) => {
                    const color = locationColors.get(loc.id) ?? "#888";
                    const isLast = idx === locationOrder.length - 1;
                    return (
                      <Bar
                        key={loc.id}
                        dataKey={loc.id}
                        name={loc.name}
                        stackId="total"
                        fill={color}
                        radius={isLast ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                      >
                        {isLast && (
                          <LabelList
                            position="right"
                            valueAccessor={(entry: { payload?: Record<string, number> }) => {
                              const p = entry?.payload;
                              if (!p) return "";
                              const total = locationOrder.reduce(
                                (acc, l) => acc + (Number(p[l.id]) || 0),
                                0,
                              );
                              return sortKey === "menge"
                                ? intFmt.format(total)
                                : `${total.toFixed(0)} €`;
                            }}
                            style={{ fontSize: 11 }}
                          />
                        )}
                      </Bar>
                    );
                  })
                ) : (
                  <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      formatter={(v: number) =>
                        sortKey === "menge" ? intFmt.format(v) : `${v.toFixed(0)} €`
                      }
                      style={{ fontSize: 11 }}
                    />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <EntryRow
                key={e.key}
                entry={e}
                open={openKey === e.key}
                onToggle={() => setOpenKey(openKey === e.key ? null : e.key)}
                locationColors={locationColors}
                locationOrder={locationOrder}
                sortKey={sortKey}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function sliceValue(
  slice: RennerEntry["perLocation"][number] | undefined,
  sortKey: SortKey,
): number {
  if (!slice) return 0;
  if (sortKey === "umsatz") return slice.umsatzCents / 100;
  if (sortKey === "menge") return slice.einheiten;
  return (slice.dbCents ?? 0) / 100;
}

function EntryRow({
  entry,
  open,
  onToggle,
  locationColors,
  locationOrder,
  sortKey,
}: {
  entry: RennerEntry;
  open: boolean;
  onToggle: () => void;
  locationColors: Map<string, string>;
  locationOrder: { id: string; name: string }[];
  sortKey: SortKey;
}) {
  const canExpand = entry.components.length > 1;
  const multi = locationOrder.length > 1;
  return (
    <li>
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
          canExpand && "hover:bg-muted/40",
        )}
      >
        {canExpand ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{entry.name}</div>
          <div className="text-xs text-muted-foreground">{summaryLine(entry)}</div>
          {multi && entry.perLocation.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {locationOrder.map((loc) => {
                const slice = entry.perLocation.find((s) => s.locationId === loc.id);
                if (!slice) return null;
                const color = locationColors.get(loc.id) ?? "#888";
                const val =
                  sortKey === "menge"
                    ? `${intFmt.format(slice.einheiten)} Stk`
                    : `${fmtCents(sortKey === "db" ? (slice.dbCents ?? 0) : slice.umsatzCents)} €`;
                return (
                  <span key={loc.id} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: color }}
                    />
                    {loc.name}: {val}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="font-semibold">{fmtCents(entry.umsatzCents)} €</div>
          <div className="text-xs text-muted-foreground">
            {intFmt.format(entry.einheitenGesamt)} Stk
          </div>
        </div>
        <div className="ml-2 w-16 shrink-0 text-right">
          <WeBadge pct={entry.ekwPct} />
        </div>
      </button>
      {open && canExpand && (
        <div className="border-t border-border bg-muted/20 px-3 py-2">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">Nr.</th>
                <th className="text-left font-normal">Verkaufsartikel</th>
                <th className="text-right font-normal">Portion</th>
                <th className="text-right font-normal">Stück</th>
                <th className="text-right font-normal">Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {entry.components.map((c) => (
                <tr key={c.nummer} className="border-t border-border/50">
                  <td className="py-1 tabular-nums text-muted-foreground">{c.nummer}</td>
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right tabular-nums">
                    {c.portionMl === null ? "—" : `${c.portionMl} ml`}
                  </td>
                  <td className="py-1 text-right tabular-nums">{intFmt.format(c.verkaufCount)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtCents(c.umsatzCents)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

function summaryLine(e: RennerEntry): string {
  if (e.components.length === 1) {
    const parts: string[] = [];
    if (e.hauptgruppe) parts.push(e.hauptgruppe);
    if (e.warengruppe && e.warengruppe !== e.hauptgruppe) parts.push(e.warengruppe);
    return parts.join(" · ");
  }
  const parts: string[] = [];
  if (e.flaschenCount > 0) parts.push(`${intFmt.format(e.flaschenCount)} Fl.`);
  if (e.offeneGlaeserCount > 0) {
    parts.push(`${intFmt.format(e.offeneGlaeserCount)} offene Gläser`);
  }
  if (e.flaschenAequivalent !== null) {
    parts.push(`≈ ${decFmt.format(e.flaschenAequivalent)} Fl. gesamt`);
  }
  return parts.join(" + ").replace(" + ≈", " ≈");
}

function LadenhueterCard({ rows }: { rows: RennerPennerResult["ladenhueter"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">
        Ladenhüter · 0 Verkäufe im Zeitraum ({intFmt.format(rows.length)})
      </div>
      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="w-40">Warengruppe</TableHead>
              <TableHead className="w-40">Hauptgruppe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.nummer}-${r.name}`}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.warengruppe ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.hauptgruppe ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function downloadCsv(
  entries: RennerEntry[],
  ladenhueter: RennerPennerResult["ladenhueter"],
  period: Period,
) {
  const rows: string[] = [];
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  rows.push(
    [
      "typ",
      "bündel",
      "verkaufsartikel_nr",
      "verkaufsartikel_name",
      "portion_ml",
      "gebinde_ml",
      "einheiten",
      "umsatz_eur",
      "we_eur",
      "db_eur",
      "ekw_pct",
      "hauptgruppe",
      "warengruppe",
    ].join(";"),
  );
  for (const e of entries) {
    rows.push(
      [
        "eintrag",
        esc(e.name),
        "",
        esc(e.name),
        "",
        e.ekSourceVolumeMl ?? "",
        e.einheitenGesamt,
        (e.umsatzCents / 100).toFixed(2),
        e.wareneinsatzCents === null ? "" : (e.wareneinsatzCents / 100).toFixed(2),
        e.dbCents === null ? "" : (e.dbCents / 100).toFixed(2),
        e.ekwPct === null ? "" : e.ekwPct.toFixed(1),
        esc(e.hauptgruppe),
        esc(e.warengruppe),
      ].join(";"),
    );
    for (const c of e.components) {
      rows.push(
        [
          "komponente",
          esc(e.name),
          c.nummer,
          esc(c.name),
          c.portionMl ?? "",
          e.ekSourceVolumeMl ?? "",
          c.verkaufCount,
          (c.umsatzCents / 100).toFixed(2),
          "",
          "",
          "",
          "",
          "",
        ].join(";"),
      );
    }
  }
  for (const l of ladenhueter) {
    rows.push(
      [
        "ladenhueter",
        "",
        "",
        esc(l.name),
        "",
        "",
        0,
        "0.00",
        "",
        "",
        "",
        esc(l.hauptgruppe),
        esc(l.warengruppe),
      ].join(";"),
    );
  }
  const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `renner-penner-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
