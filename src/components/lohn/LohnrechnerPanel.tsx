// Admin-UI für die Brutto/Netto-Vorschau (2c) als eingebetteter Tab-Panel
// innerhalb der Arbeitszeiten-Übersicht. Zustandslos: ruft nur
// `berechneLohnFuerMitarbeiter` (read-only) und zeigt Zeilen, Person und
// Ergebnis tabellarisch an, damit Frank Zeile für Zeile gegen edlohn vergleichen kann.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { todayIso } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { listPeriods } from "@/lib/time/time-admin.functions";
import {
  berechneLohnFuerMitarbeiter,
  berechneLohnUebersicht,
} from "@/lib/lohn/lohn-rechner.functions";
import { buildLohnFileName, buildLohnXlsx, downloadBlob } from "@/lib/lohn/lohn-excel-export";
import {
  buildLohnZip,
  buildLohnZipFileName,
  hasEntgeltzeilen,
  type LohnZipPerson,
} from "@/lib/lohn/lohn-zip-export";
import { buildUebersichtCsv } from "@/lib/lohn/lohn-csv-export";
import { LohnExportBlockedError, type StaffBlocker } from "@/lib/lohn/export-blockers";
import { FileSpreadsheet, Download, FileArchive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Mode = "simple" | "extended";

function eur(cents: number | undefined | null): string {
  const v = Number(cents ?? 0) / 100;
  return v.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });
}

function hrs(h: number | undefined | null): string {
  return Number(h ?? 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function defaultFromTo(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last) };
}

export function LohnrechnerPanel() {
  const def = useMemo(defaultFromTo, []);
  const periodsCallFn = useServerFn(listPeriods);
  const periodsQ = useQuery({
    queryKey: ["lohn-periods"],
    queryFn: () => periodsCallFn(),
  });

  const [periodId, setPeriodId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>(def.from);
  const [toDate, setToDate] = useState<string>(def.to);
  const [mode, setMode] = useState<Mode>("simple");
  const [staffId, setStaffId] = useState<string>("");
  // EX1 — Fortschritt des Sammelexports: null = inaktiv.
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  // Default = aktuelle Periode (die, in der heute liegt); Fallback: neueste
  // vergangene Periode; letzter Fallback: erste (neueste) aus der Liste.
  useEffect(() => {
    if (periodId) return;
    const list = periodsQ.data;
    if (!list || list.length === 0) return;
    // N18a (13.07.): Berlin-„Heute" — sonst würde die Vorschau nachts
    // (00:00–02:00 MEZ) bereits die nächste Periode auswählen.
    const today = todayIso();
    const current = list.find((p) => p.startDate <= today && today <= p.endDate);
    const pastLatest = list.find((p) => p.endDate <= today);
    const chosen = current ?? pastLatest ?? list[0];
    setPeriodId(chosen.id);
    setFromDate(chosen.startDate);
    setToDate(chosen.endDate);
  }, [periodsQ.data, periodId]);

  function onPeriodChange(id: string) {
    const p = periodsQ.data?.find((x) => x.id === id);
    if (!p) return;
    setPeriodId(id);
    setFromDate(p.startDate);
    setToDate(p.endDate);
    setStaffId(""); // Auswahl zurücksetzen, Detail schließen
  }

  const uebersichtCallFn = useServerFn(berechneLohnUebersicht);
  const uebersichtQ = useQuery({
    queryKey: ["lohn-uebersicht", fromDate, toDate, mode],
    queryFn: () => uebersichtCallFn({ data: { fromDate, toDate, mode } }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate),
  });

  const callFn = useServerFn(berechneLohnFuerMitarbeiter);
  const mut = useMutation({
    mutationFn: (id: string) =>
      callFn({ data: { staffId: id, fromDate, toDate, mode, zusatzZeilen: [] } }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Berechnung fehlgeschlagen."),
  });

  function onRowClick(id: string, hasError: boolean) {
    if (hasError) return;
    setStaffId(id);
    mut.mutate(id);
  }

  const result = mut.data;

  const selectedStaffLabel = useMemo(() => {
    const r = uebersichtQ.data?.rows.find((x) => x.staffId === staffId);
    return r?.displayName ?? staffId;
  }, [uebersichtQ.data, staffId]);

  const periodLabel = useMemo(() => {
    return periodsQ.data?.find((p) => p.id === periodId)?.label ?? `${fromDate}_${toDate}`;
  }, [periodsQ.data, periodId, fromDate, toDate]);

  function handleCsvExport() {
    const rows = uebersichtQ.data?.rows;
    if (!rows || rows.length === 0) {
      toast.error("Keine Daten zum Exportieren.");
      return;
    }
    try {
      const csv = buildUebersichtCsv(rows, { periodLabel, mode }, blockers);
      const safeLabel = periodLabel.replace(/[\\/]/g, "-").replace(/\s+/g, "_");
      const filename = `lohn-uebersicht_${safeLabel}_${mode}.csv`;
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
    } catch (e) {
      if (e instanceof LohnExportBlockedError) {
        toast.error(`Export blockiert für ${e.blockers.length} Person(en). Bitte oben prüfen.`);
        return;
      }
      toast.error(e instanceof Error ? e.message : "CSV-Export fehlgeschlagen.");
    }
  }

  async function handleExport() {
    if (!result) return;
    try {
      const staffBlockers = blockers.filter((b) => b.staffId === staffId);
      const blob = await buildLohnXlsx({
        staffLabel: selectedStaffLabel,
        fromDate,
        toDate,
        mode: result.mode,
        totalHours: result.totalHours,
        hourlyRateCents: result.hourlyRateCents ?? 0,
        entryCount: result.entryCount,
        zuschlagCents: result.zuschlagCents,
        buckets: result.buckets,
        person: result.person,
        zeilen: result.zeilen,
        ergebnis: result.ergebnis,
        blockers: staffBlockers,
      });
      downloadBlob(blob, buildLohnFileName(selectedStaffLabel, fromDate, toDate));
    } catch (e) {
      if (e instanceof LohnExportBlockedError) {
        toast.error("Excel-Export blockiert: Person unvollständig gepflegt (siehe Banner).");
        return;
      }
      toast.error(e instanceof Error ? e.message : "Excel-Export fehlgeschlagen.");
    }
  }

  // EX1 — Sammelexport: je Person das bestehende Einzel-Excel, gebündelt als
  // ZIP. Bewusst sequentiell (≈40 Calls), Blocker-Regel identisch zum CSV.
  async function handleZipExport() {
    const rows = uebersichtQ.data?.rows;
    if (!rows || rows.length === 0) {
      toast.error("Keine Daten zum Exportieren.");
      return;
    }
    if (blockers.length > 0) {
      toast.error("Export blockiert — bitte Banner prüfen.");
      return;
    }
    const candidates = rows.filter((r) => r.error == null && hasEntgeltzeilen(r));
    if (candidates.length === 0) {
      toast.error("Keine Person mit Entgeltzeilen im Zeitraum.");
      return;
    }
    setZipProgress({ done: 0, total: candidates.length });
    try {
      const persons: LohnZipPerson[] = [];
      for (const row of candidates) {
        let blob: Blob;
        try {
          const res = await callFn({
            data: { staffId: row.staffId, fromDate, toDate, mode, zusatzZeilen: [] },
          });
          blob = await buildLohnXlsx({
            staffLabel: row.displayName,
            fromDate,
            toDate,
            mode: res.mode,
            totalHours: res.totalHours,
            hourlyRateCents: res.hourlyRateCents ?? 0,
            entryCount: res.entryCount,
            zuschlagCents: res.zuschlagCents,
            buckets: res.buckets,
            person: res.person,
            zeilen: res.zeilen,
            ergebnis: res.ergebnis,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unbekannter Fehler";
          toast.error(`Sammelexport abgebrochen bei ${row.displayName}: ${msg}`);
          return;
        }
        persons.push({
          staffLabel: row.displayName,
          fromDate,
          toDate,
          hasEntgeltzeilen: true,
          blob,
        });
        setZipProgress({ done: persons.length, total: candidates.length });
      }
      const zip = await buildLohnZip(persons);
      downloadBlob(zip, buildLohnZipFileName(fromDate, toDate));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel-ZIP-Export fehlgeschlagen.");
    } finally {
      setZipProgress(null);
    }
  }

  const blockers: StaffBlocker[] = uebersichtQ.data?.blockers ?? [];
  const exportBlocked = blockers.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Lohnrechner (Vorschau)
        </h1>
        <p className="text-sm text-muted-foreground">
          Zustandslose Vorschau-Rechnung — liest nur, schreibt nichts. Vergleich Zeile für Zeile
          gegen edlohn.
        </p>
      </div>

      {exportBlocked && <BlockerBanner blockers={blockers} />}

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="period">Abrechnungsperiode</Label>
            <Select value={periodId} onValueChange={onPeriodChange}>
              <SelectTrigger id="period">
                <SelectValue placeholder="Periode wählen…" />
              </SelectTrigger>
              <SelectContent>
                {(periodsQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mode">SFN-Modus</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">simple</SelectItem>
                <SelectItem value="extended">extended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            Übersicht{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({fromDate} – {toDate})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCsvExport}
              disabled={uebersichtQ.isLoading || !uebersichtQ.data?.rows.length || exportBlocked}
              title={exportBlocked ? "Export blockiert — bitte Banner oben prüfen." : undefined}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV exportieren
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleZipExport}
              disabled={
                uebersichtQ.isLoading ||
                !uebersichtQ.data?.rows.length ||
                exportBlocked ||
                zipProgress != null
              }
              title={exportBlocked ? "Export blockiert — bitte Banner oben prüfen." : undefined}
            >
              <FileArchive className="mr-2 h-4 w-4" />
              {zipProgress
                ? `Exportiere … (${zipProgress.done}/${zipProgress.total})`
                : "Excel-ZIP exportieren"}
            </Button>
          </div>
        </div>
        {uebersichtQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : uebersichtQ.isError ? (
          <p className="text-sm text-destructive">
            {(uebersichtQ.error as Error)?.message ?? "Fehler beim Laden."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead className="text-right">Stunden</TableHead>
                <TableHead className="text-right">Stundenlohn</TableHead>
                <TableHead className="text-right">Zuschläge</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
                <TableHead className="text-right">Netto</TableHead>
                <TableHead className="text-right">Auszahlung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(uebersichtQ.data?.rows ?? []).map((r) => {
                const hasErr = r.error != null;
                const isSelected = r.staffId === staffId;
                return (
                  <TableRow
                    key={r.staffId}
                    onClick={() => onRowClick(r.staffId, hasErr)}
                    className={cn(
                      hasErr ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                      isSelected && "bg-muted/50",
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.displayName}</span>
                        {hasErr && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  aria-label="Hinweis zur Berechnung"
                                  className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40"
                                />
                              </TooltipTrigger>
                              <TooltipContent>{r.error}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{hrs(r.totalHours)} h</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(r.hourlyRateCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {eur(r.zuschlagCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{eur(r.bruttoCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(r.nettoCents)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {eur(r.auszahlungCents)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {uebersichtQ.data && uebersichtQ.data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Keine aktiven Mitarbeiter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {mut.isError && (
        <Card className="p-4 text-sm text-destructive">
          {(mut.error as Error)?.message ?? "Fehler bei der Berechnung."}
        </Card>
      )}

      {mut.isPending && <Card className="p-4 text-sm text-muted-foreground">Rechne Detail…</Card>}

      {result && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={blockers.some((b) => b.staffId === staffId)}
              title={
                blockers.some((b) => b.staffId === staffId)
                  ? "Excel-Export blockiert — bitte Banner oben prüfen."
                  : undefined
              }
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel exportieren
            </Button>
          </div>
          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">Periode</h2>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <KV k="Stunden gesamt" v={hrs(result.totalHours)} />
              <KV k="Stundensatz" v={eur(result.hourlyRateCents)} />
              <KV k="Einträge" v={String(result.entryCount)} />
              <KV k="SFN-Modus" v={result.mode} />
              <KV
                k="Zeitlohn (Stunden × Satz)"
                v={eur(
                  result.hourlyRateCents == null
                    ? null
                    : Math.round(result.totalHours * result.hourlyRateCents),
                )}
              />
              <KV k="SFN-Zuschläge" v={eur(result.zuschlagCents)} />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">SFN-Töpfe (Stunden)</h2>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <KV k="Nacht 25 %" v={hrs(result.buckets.night25Hours)} />
              <KV k="Nacht 40 %" v={hrs(result.buckets.night40Hours)} />
              <KV k="Sonntag" v={hrs(result.buckets.sundayHours)} />
              <KV k="Feiertag" v={hrs(result.buckets.holidayHours)} />
              <KV k="Feiertag 150 % (1.5., 25./26.12.)" v={hrs(result.buckets.holiday150Hours)} />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">Personenparameter</h2>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <KV k="Steuerklasse" v={String(result.person.steuerklasse)} />
              <KV k="Kinderfreibeträge (ZKF)" v={String(result.person.zkf)} />
              <KV k="KV-Zusatzbeitrag (%)" v={String(result.person.kvzProzent)} />
              <KV k="Kirchensteuer (BY)" v={result.person.kirchensteuerBayern ? "ja" : "nein"} />
              <KV k="Anzahl Kinder" v={String(result.person.kinderzahl)} />
              <KV k="Elterneigenschaft" v={result.person.elterneigenschaft ? "ja" : "nein"} />
              <KV
                k="PV-Kinderlosen-Zuschlag"
                v={result.person.pvKinderlosZuschlag ? "ja" : "nein"}
              />
              <KV k="Beschäftigung" v={result.person.beschaeftigung} />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">Entgeltzeilen</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Bezeichnung</TableHead>
                  <TableHead className="text-right">Stunden</TableHead>
                  <TableHead className="text-right">Satz</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.zeilen.map((z, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{z.kategorie}</TableCell>
                    <TableCell>{z.bezeichnung ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {z.stunden != null ? hrs(z.stunden) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {z.satzCent != null ? eur(z.satzCent) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{eur(z.betragCent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">Ergebnis</h2>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <KV k="Gesamtbrutto" v={eur(result.ergebnis.gesamtbruttoCent)} />
              <KV k="St-/SV-Brutto" v={eur(result.ergebnis.stSvBruttoCent)} />
              <KV k="St-Brutto (Ausweis)" v={eur(result.ergebnis.stBruttoAusweisCent)} />
              <KV k="Lohnsteuer" v={eur(result.ergebnis.lstCent)} />
              <KV k="Soli" v={eur(result.ergebnis.soliCent)} />
              <KV k="Kirchensteuer" v={eur(result.ergebnis.kistCent)} />
              <KV k="KV (AN)" v={eur(result.ergebnis.kvCent)} />
              <KV k="RV (AN)" v={eur(result.ergebnis.rvCent)} />
              <KV k="AV (AN)" v={eur(result.ergebnis.avCent)} />
              <KV k="PV (AN)" v={eur(result.ergebnis.pvCent)} />
              <KV k="Gesamtnetto" v={eur(result.ergebnis.gesamtnettoCent)} strong />
              <KV k="Auszahlung" v={eur(result.ergebnis.auszahlungCent)} strong />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={"tabular-nums " + (strong ? "font-semibold text-foreground" : "")}>{v}</span>
    </div>
  );
}

/**
 * LG3b A4 — Blocker-Banner. Zeigt fehlende Personalnummern, Bereichs-Sätze
 * und unresolved WZ2-Attributionen; keine Rechenwirkung, nur Anzeige.
 */
function BlockerBanner({ blockers }: { blockers: StaffBlocker[] }) {
  const REASON_LABEL: Record<string, string> = {
    missing_perso_nr: "Personalnummer fehlt",
    missing_rate: "Stundensatz fehlt",
    unresolved_department: "Bereich nicht zuordenbar",
    // SL1 — Slot-Zuordnung fehlt (mehrere Bereiche mit verschiedenen Sätzen).
    missing_slot_mapping: "edlohn-Slot fehlt",
  };
  const DEPT_LABEL: Record<string, string> = {
    service: "Service",
    gl: "GL",
    kitchen: "Küche",
  };
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-4">
      <h2 className="mb-2 text-sm font-semibold text-destructive">
        Export blockiert — {blockers.length} Person(en) unvollständig gepflegt
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Keine Teil-Exporte. Bitte die genannten Punkte in den Stammdaten korrigieren; anschließend
        wird der Export automatisch freigegeben.
      </p>
      <ul className="space-y-1 text-sm">
        {blockers.map((b) => (
          <li key={b.staffId}>
            <span className="font-medium">{b.staffLabel}</span>
            <span className="text-muted-foreground">
              {" — "}
              {b.reasons
                .map((r) => {
                  const base = REASON_LABEL[r.reason] ?? r.reason;
                  if (r.reason === "missing_rate" && r.department) {
                    return `${base} (${DEPT_LABEL[r.department] ?? r.department})`;
                  }
                  if (r.reason === "missing_slot_mapping" && r.department) {
                    return `${base} (${DEPT_LABEL[r.department] ?? r.department})`;
                  }
                  return base;
                })
                .join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
