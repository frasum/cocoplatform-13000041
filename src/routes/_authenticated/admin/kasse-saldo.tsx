// Tägliche Bargeldübersicht — pro Tag eigenständig (kein Carry-over),
// Bargeld serverseitig via computeDailyCash (cash-ledger.ts).

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { getCashDailyBreakdown, type CashDailyRow } from "@/lib/cash/cash.functions";
import {
  buildBargeldXlsx,
  betriebsBargeldCents,
  type BargeldSheet,
} from "@/lib/cash/bargeld-export";
import { cashBusinessMonthAnchor } from "@/lib/cash/cash-today";
import { downloadBlob } from "@/lib/time/weekly-export";
import { formatShortDate } from "@/lib/format-date";
import { listLocations } from "@/lib/admin/locations.functions";
import { filterCashEnabled } from "@/lib/locations/cash-enabled";
import { LocationPills } from "@/components/shared/LocationPills";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/kasse-saldo")({
  head: () => ({ meta: [{ title: "Tägliche Bargeldübersicht" }] }),
  component: KasseSaldoPage,
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

function KasseSaldoPage() {
  // Monatsnavigation folgt dem Geschäftstag (3-Uhr-Cut), nicht dem Kalendertag.
  const now = useMemo(() => cashBusinessMonthAnchor(new Date()), []);
  const months = useMemo(() => buildMonthOptions(now), [now]);
  const [monthKey, setMonthKey] = useState<string>(months[0].key);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const selected = months.find((m) => m.key === monthKey) ?? months[0];
  const { fromDate, toDate } = monthRange(selected.year, selected.month);

  const fetchLocations = useServerFn(listLocations);
  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => fetchLocations(),
  });
  // LS1: nur Kassen-Standorte.
  const cashLocations = useMemo(() => filterCashEnabled(locationsQ.data ?? []), [locationsQ.data]);

  useEffect(() => {
    if (locationId === null && cashLocations.length > 0) {
      setLocationId(cashLocations[0].id);
    }
  }, [locationId, cashLocations]);

  const locationName = useMemo(() => {
    if (!locationId) return "Alle Standorte";
    return cashLocations.find((l) => l.id === locationId)?.name ?? "Standort";
  }, [locationId, cashLocations]);

  // YUM zeigt keine FineDine-Spalte (dort nicht genutzt).
  const hideFineDine = locationName.trim().toLowerCase() === "yum";

  const fetchBreakdown = useServerFn(getCashDailyBreakdown);
  const q = useQuery({
    queryKey: ["cash-daily-breakdown", fromDate, toDate, locationId],
    queryFn: () =>
      fetchBreakdown({
        data: locationId ? { fromDate, toDate, locationId } : { fromDate, toDate },
      }),
  });

  const rows: CashDailyRow[] = useMemo(() => q.data ?? [], [q.data]);

  const totals = useMemo(() => {
    const t = {
      tagesumsatz: 0,
      kreditkarten: 0,
      takeaway: 0,
      souse: 0,
      wolt: 0,
      vouchersRedeemed: 0,
      finedine: 0,
      vouchersSold: 0,
      einladung: 0,
      openInvoices: 0,
      vorschuss: 0,
      expenses: 0,
      bargeld: 0,
      tipRemainder: 0,
      sonstige: 0,
      sonstigeTage: 0,
    };
    for (const r of rows) {
      t.tagesumsatz += r.tagesumsatzCents;
      t.kreditkarten += r.kreditkartenCents;
      t.takeaway += r.deliveryVectronCents;
      t.souse += r.deliverySouseCents;
      t.wolt += r.deliveryWoltCents;
      t.vouchersRedeemed += r.vouchersRedeemedCents;
      t.finedine += r.finedineCents;
      t.vouchersSold += r.vouchersSoldCents;
      t.einladung += r.einladungCents;
      t.openInvoices += r.openInvoicesCents;
      t.vorschuss += r.vorschussCents;
      t.expenses += r.expensesCents;
      t.bargeld += betriebsBargeldCents(r);
      t.tipRemainder += r.tipRemainderCents;
      t.sonstige += r.sonstigeEinnahmeCents;
      if (r.sonstigeEinnahmeCents !== 0) t.sonstigeTage += 1;
    }
    return t;
  }, [rows]);

  async function handleExport() {
    setExporting(true);
    try {
      // EX2 — eine Mappe, ein Blatt je Kassen-Standort (wie die Vorlage).
      const sheets: BargeldSheet[] = [];
      for (const loc of cashLocations) {
        const locRows = await fetchBreakdown({
          data: { fromDate, toDate, locationId: loc.id },
        });
        sheets.push({ locationName: loc.name, rows: locRows });
      }
      if (sheets.length === 0) {
        toast.error("Keine Kassen-Standorte vorhanden.");
        return;
      }
      const blob = await buildBargeldXlsx(sheets);
      downloadBlob(blob, `bankeinzahlung_${fromDate}_bis_${toDate}.xlsx`);
      toast.success("Excel-Export erstellt.");
    } catch (e) {
      console.error("Excel-Export fehlgeschlagen", e);
      // EX2-b — Formeltreue-Diagnosen müssen lesbar stehen bleiben.
      toast.error("Excel-Export fehlgeschlagen: " + (e as Error).message, { duration: 15000 });
    } finally {
      setExporting(false);
    }
  }

  const bargeldClass = (cents: number) =>
    "text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs font-medium " +
    (cents < 0 ? "text-destructive" : "text-emerald-600");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Tägliche Bargeldübersicht
          </h1>
          <p className="text-sm text-muted-foreground">
            Bargeld pro Tag eigenständig berechnet (kein Carry-over).
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
          <Button variant="outline" disabled={rows.length === 0 || exporting} onClick={handleExport}>
            {exporting ? "Exportiere…" : "Export Excel"}
          </Button>
        </div>
      </div>

      <Card>
        {q.isLoading && <div className="p-6 text-sm text-muted-foreground">Lade…</div>}
        {q.isError && (
          <div className="p-6 text-sm text-destructive">
            {(q.error as Error).message ?? "Fehler beim Laden."}
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            Keine Sessions im gewählten Monat.
          </div>
        )}
        {!q.isLoading && !q.isError && rows.length > 0 && (
          <div className="w-full overflow-x-auto xl:overflow-x-visible">
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-2 text-xs">Datum</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Tagesumsatz</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">KK</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Take-Away</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">SoUse</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Wolt</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Gut. EL</TableHead>
                  {!hideFineDine && (
                    <TableHead className="text-right px-2 py-2 text-xs">FineDine</TableHead>
                  )}
                  <TableHead className="text-right px-2 py-2 text-xs">Gut. VK</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Einladung</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Off. RE</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Vorsch.</TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">Ausg.</TableHead>
                  <TableHead
                    className="text-right px-2 py-2 text-xs"
                    title="Betriebs-Bargeld ohne sonstige Einnahmen (diese werden unterhalb der Tabelle separat ausgewiesen). Die Kassen-Kontrolle zeigt bewusst inkl. sonstiger Einnahmen."
                  >
                    Bargeld (o. sonst. Einn.)
                  </TableHead>
                  <TableHead className="text-right px-2 py-2 text-xs">TG-Rest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.businessDate}>
                    <TableCell className="whitespace-nowrap px-2 py-1.5 text-xs">
                      {formatShortDate(r.businessDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.tagesumsatzCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.kreditkartenCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.deliveryVectronCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.deliverySouseCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.deliveryWoltCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.vouchersRedeemedCents)}
                    </TableCell>
                    {!hideFineDine && (
                      <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                        {fmtEuro(r.finedineCents)}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.vouchersSoldCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.einladungCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.openInvoicesCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.vorschussCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.expensesCents)}
                    </TableCell>
                    <TableCell className={bargeldClass(betriebsBargeldCents(r))}>
                      {fmtEuro(betriebsBargeldCents(r))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(r.tipRemainderCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="px-2 py-1.5 text-xs font-medium">Summe</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.tagesumsatz)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.kreditkarten)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.takeaway)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.souse)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.wolt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.vouchersRedeemed)}
                  </TableCell>
                  {!hideFineDine && (
                    <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                      {fmtEuro(totals.finedine)}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.vouchersSold)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.einladung)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.openInvoices)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.vorschuss)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.expenses)}
                  </TableCell>
                  <TableCell className={bargeldClass(totals.bargeld)}>
                    {fmtEuro(totals.bargeld)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap px-2 py-1.5 text-xs">
                    {fmtEuro(totals.tipRemainder)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
