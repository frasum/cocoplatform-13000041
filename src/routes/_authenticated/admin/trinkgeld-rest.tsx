// Admin-only: aufgelaufener Trinkgeld-Restcent je Geschäftstag
// (Euro-Abrundung im Bargeld). Read-only. Header und Tabellen-Look
// analog zur Tägliche Bargeldübersicht (kasse-saldo).

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTipRemainderByPeriod } from "@/lib/cash/cash.functions";
import { cashBusinessMonthAnchor } from "@/lib/cash/cash-today";
import { listLocations } from "@/lib/admin/locations.functions";
import { filterCashEnabled } from "@/lib/locations/cash-enabled";
import { LocationPills } from "@/components/shared/LocationPills";
import { formatShortDate } from "@/lib/format-date";

export const Route = createFileRoute("/_authenticated/admin/trinkgeld-rest")({
  head: () => ({ meta: [{ title: "Trinkgeld-Rest · Verwaltung" }] }),
  component: TipRemainderPage,
});

function fmtEuro(cents: number): string {
  return (
    (cents / 100).toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "\u00A0€"
  );
}

const MONTH_NAMES = [
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

type MonthOption = { key: string; label: string; year: number; month: number };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildMonthOptions(now: Date): MonthOption[] {
  const out: MonthOption[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({
      key: `${y}-${pad2(m + 1)}`,
      label: `${MONTH_NAMES[m]} ${y}`,
      year: y,
      month: m,
    });
  }
  return out;
}

function monthRange(year: number, month: number): { fromDate: string; toDate: string } {
  const last = new Date(year, month + 1, 0).getDate();
  return {
    fromDate: `${year}-${pad2(month + 1)}-01`,
    toDate: `${year}-${pad2(month + 1)}-${pad2(last)}`,
  };
}

type AggRow = {
  businessDate: string;
  kitchenRemainderCents: number;
  serviceRemainderCents: number;
};

function TipRemainderPage() {
  const { identity } = useRouteContext({ from: "/_authenticated/admin" });
  const fetchLocations = useServerFn(listLocations);
  const fetchRemainder = useServerFn(getTipRemainderByPeriod);

  // Monatsnavigation folgt dem Geschäftstag (3-Uhr-Cut), nicht dem Kalendertag.
  const now = useMemo(() => cashBusinessMonthAnchor(new Date()), []);
  const months = useMemo(() => buildMonthOptions(now), [now]);
  const [monthKey, setMonthKey] = useState<string>(months[0].key);
  const [locationId, setLocationId] = useState<string | null>(null);

  const selected = months.find((m) => m.key === monthKey) ?? months[0];
  const { fromDate, toDate } = monthRange(selected.year, selected.month);

  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => fetchLocations(),
    enabled: identity.role === "admin",
  });

  // LS1: nur Kassen-Standorte.
  const cashLocations = useMemo(() => filterCashEnabled(locationsQ.data ?? []), [locationsQ.data]);

  useEffect(() => {
    if (locationId === null && cashLocations.length > 0) {
      setLocationId(cashLocations[0].id);
    }
  }, [locationId, cashLocations]);

  const allLocationIds = useMemo(() => cashLocations.map((l) => l.id), [cashLocations]);
  const isAll = locationId === "";
  const targetLocationIds = isAll ? allLocationIds : locationId ? [locationId] : [];

  const remainderQ = useQuery({
    queryKey: ["admin", "tip-remainder", targetLocationIds, fromDate, toDate],
    queryFn: async () => {
      const results = await Promise.all(
        targetLocationIds.map((id) =>
          fetchRemainder({ data: { locationId: id, startDate: fromDate, endDate: toDate } }),
        ),
      );
      const byDate = new Map<string, AggRow>();
      let servicePoolAnyEnabled = false;
      for (const res of results) {
        if (res.servicePoolEnabled !== false) servicePoolAnyEnabled = true;
        for (const r of res.rows) {
          const prev = byDate.get(r.businessDate) ?? {
            businessDate: r.businessDate,
            kitchenRemainderCents: 0,
            serviceRemainderCents: 0,
          };
          prev.kitchenRemainderCents += r.kitchenRemainderCents;
          prev.serviceRemainderCents += r.serviceRemainderCents;
          byDate.set(r.businessDate, prev);
        }
      }
      const rows = Array.from(byDate.values()).sort((a, b) =>
        a.businessDate.localeCompare(b.businessDate),
      );
      const totals = rows.reduce(
        (t, r) => {
          t.kitchenCents += r.kitchenRemainderCents;
          t.serviceCents += r.serviceRemainderCents;
          return t;
        },
        { kitchenCents: 0, serviceCents: 0 },
      );
      return {
        rows,
        totals: {
          ...totals,
          totalCents: totals.kitchenCents + totals.serviceCents,
        },
        servicePoolEnabled: servicePoolAnyEnabled,
      };
    },
    enabled: identity.role === "admin" && targetLocationIds.length > 0,
  });

  if (identity.role !== "admin") {
    return <p className="text-sm text-muted-foreground">Nur für Admins.</p>;
  }

  const svcOff = remainderQ.data?.servicePoolEnabled === false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Trinkgeld-Rest</h1>
          <p className="text-sm text-muted-foreground">
            Aufgelaufener Restcent durch die Euro-Abrundung im Bargeld — pro Tag und Küche/Service
            getrennt.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <LocationPills
            locations={cashLocations}
            value={locationId || "__all__"}
            onChange={(v) => setLocationId(v === "__all__" ? "" : v)}
            includeAll
            allLabel="Alle Standorte"
          />
          <Select value={monthKey} onValueChange={setMonthKey}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        {remainderQ.isLoading && <div className="p-6 text-sm text-muted-foreground">Lade…</div>}
        {remainderQ.isError && (
          <div className="p-6 text-sm text-destructive">
            {(remainderQ.error as Error).message ?? "Fehler beim Laden."}
          </div>
        )}
        {!remainderQ.isLoading && !remainderQ.isError && remainderQ.data && (
          <div className="w-full overflow-x-auto xl:overflow-x-visible">
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-2 text-xs">Datum</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Rest Küche</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Rest Service</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Rest gesamt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remainderQ.data.rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      Keine Sessions im gewählten Monat.
                    </TableCell>
                  </TableRow>
                )}
                {remainderQ.data.rows.map((r) => {
                  const total = r.kitchenRemainderCents + r.serviceRemainderCents;
                  return (
                    <TableRow key={r.businessDate}>
                      <TableCell className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {formatShortDate(r.businessDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                        {fmtEuro(r.kitchenRemainderCents)}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs"
                        title={svcOff ? "kein Service-Pool an diesem Standort" : undefined}
                      >
                        {svcOff ? "—" : fmtEuro(r.serviceRemainderCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                        {fmtEuro(total)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {remainderQ.data.rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="px-2 py-1.5 text-xs font-medium">Summe</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(remainderQ.data.totals.kitchenCents)}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs"
                      title={svcOff ? "kein Service-Pool an diesem Standort" : undefined}
                    >
                      {svcOff ? "—" : fmtEuro(remainderQ.data.totals.serviceCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(remainderQ.data.totals.totalCents)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
