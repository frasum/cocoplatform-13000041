// EV1-R1 — Verwaltungs-UI „Veranstaltungen" (admin).
//
// Liste (sortiert nach date_from, Vergangenes abgetrennt und einklappbar),
// CRUD und XLSX-Import mit Vorschau. Geschrieben wird erst mit „Übernehmen"
// (Muster wie beim BWA-PDF-Import). Die exceljs-Extraktion lebt hier in der
// UI-Schicht; das Parsen selbst macht der headless Parser.
//
// Der Kassen-Hinweis ist RUNDE 2 und in dieser Datei bewusst nicht enthalten.

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  importEvents,
  getEventImportContext,
} from "@/lib/events/events.functions";
import {
  EVENT_IMPACTS,
  IMPACT_LABEL,
  detectTermChanges,
  importKey,
  type EventImpact,
  type EventRow,
} from "@/lib/events/events-core";
import {
  parseEventsSheet,
  type ParsedEventRow,
  type SheetRow,
} from "@/lib/events/parse-events-xlsx";
import { ImpactBadge } from "@/components/events/ImpactBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { formatShortDate } from "@/lib/format-date";
import { todayIso } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/einstellungen/veranstaltungen")({
  head: () => ({ meta: [{ title: "Veranstaltungen · Einstellungen" }] }),
  component: VeranstaltungenPage,
});

type FormState = {
  id: string | null;
  name: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  locationText: string;
  distanceText: string;
  impact: EventImpact;
  recommendation: string;
  source: string;
  provisional: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  dateFrom: todayIso(),
  dateTo: todayIso(),
  category: "",
  locationText: "",
  distanceText: "",
  impact: "mittel",
  recommendation: "",
  source: "",
  provisional: false,
};

function formFromRow(row: EventRow): FormState {
  return {
    id: row.id,
    name: row.name,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    category: row.category,
    locationText: row.locationText ?? "",
    distanceText: row.distanceText ?? "",
    impact: row.impact,
    recommendation: row.recommendation ?? "",
    source: row.source ?? "",
    provisional: row.provisional,
  };
}

function dateRange(row: { dateFrom: string; dateTo: string }): string {
  return row.dateFrom === row.dateTo
    ? formatShortDate(row.dateFrom)
    : `${formatShortDate(row.dateFrom)} – ${formatShortDate(row.dateTo)}`;
}

type PreviewRow = ParsedEventRow & { provisional: boolean };

async function extractSheetRows(file: File): Promise<SheetRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet("Event-Kalender") ?? wb.worksheets[0];
  if (!ws) throw new Error("Datei enthält kein Arbeitsblatt.");
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: (string | number | Date | null)[] = [];
    const max = row.cellCount;
    for (let c = 1; c <= max; c++) {
      const v = row.getCell(c).value as unknown;
      if (v === null || v === undefined) cells.push(null);
      else if (typeof v === "number" || typeof v === "string") cells.push(v);
      else if (v instanceof Date) cells.push(v);
      else if (typeof v === "object" && v !== null && "text" in v)
        cells.push(String((v as { text: unknown }).text ?? ""));
      else if (typeof v === "object" && v !== null && "result" in v)
        cells.push(String((v as { result: unknown }).result ?? ""));
      else cells.push(String(v));
    }
    rows.push(cells);
  });
  return rows;
}

function VeranstaltungenPage() {
  const qc = useQueryClient();
  const callCreate = useServerFn(createEvent);
  const callUpdate = useServerFn(updateEvent);
  const callDelete = useServerFn(deleteEvent);
  const callImport = useServerFn(importEvents);

  const eventsQ = useQuery({ queryKey: ["events", "admin"], queryFn: () => listEvents() });
  const contextQ = useQuery({
    queryKey: ["events", "import-context"],
    queryFn: () => getEventImportContext(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["events"] });
  };

  const createMut = useMutation({
    mutationFn: (input: Parameters<typeof callCreate>[0]) => callCreate(input),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: (input: Parameters<typeof callUpdate>[0]) => callUpdate(input),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (input: Parameters<typeof callDelete>[0]) => callDelete(input),
    onSuccess: invalidate,
  });
  const importMut = useMutation({
    mutationFn: (input: Parameters<typeof callImport>[0]) => callImport(input),
    onSuccess: invalidate,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventRow | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [previewErrors, setPreviewErrors] = useState<{ sheetRow: number; message: string }[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const rows = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const today = todayIso();
  const upcoming = useMemo(() => rows.filter((r) => r.dateTo >= today), [rows, today]);
  const past = useMemo(() => rows.filter((r) => r.dateTo < today), [rows, today]);

  const existingKeys = useMemo(
    () => new Set((contextQ.data ?? []).map((e) => importKey(e.name, e.dateFrom))),
    [contextQ.data],
  );
  const termChangeKeys = useMemo(() => {
    const hints = detectTermChanges(preview, contextQ.data ?? []);
    return new Map(hints.map((h) => [importKey(h.name, h.dateFrom), h.existingDateFrom]));
  }, [preview, contextQ.data]);

  const lastError =
    createMut.error ??
    updateMut.error ??
    deleteMut.error ??
    importMut.error ??
    eventsQ.error ??
    null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setPreview([]);
    setPreviewErrors([]);
    try {
      const sheetRows = await extractSheetRows(file);
      const parsed = parseEventsSheet(sheetRows);
      setPreview(parsed.rows.map((r) => ({ ...r, provisional: false })));
      setPreviewErrors(parsed.errors);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
    }
  }

  function submitForm() {
    if (!form) return;
    const base = {
      name: form.name,
      dateFrom: form.dateFrom,
      dateTo: form.dateTo,
      category: form.category,
      locationText: form.locationText.trim() === "" ? null : form.locationText,
      distanceText: form.distanceText.trim() === "" ? null : form.distanceText,
      impact: form.impact,
      recommendation: form.recommendation.trim() === "" ? null : form.recommendation,
      source: form.source.trim() === "" ? null : form.source,
      provisional: form.provisional,
    };
    if (form.id) {
      updateMut.mutate({ data: { id: form.id, ...base } }, { onSuccess: () => setForm(null) });
    } else {
      createMut.mutate({ data: base }, { onSuccess: () => setForm(null) });
    }
  }

  function applyImport() {
    importMut.mutate(
      {
        data: {
          rows: preview.map((r) => ({
            name: r.name,
            dateFrom: r.dateFrom,
            dateTo: r.dateTo,
            category: r.category,
            locationText: r.locationText,
            distanceText: r.distanceText,
            impact: r.impact,
            recommendation: r.recommendation,
            source: r.source,
            provisional: r.provisional,
          })),
        },
      },
      {
        onSuccess: () => {
          setPreview([]);
          setPreviewErrors([]);
        },
      },
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Veranstaltungen</h1>
          <p className="text-sm text-muted-foreground">
            München-Eventkalender. Grundlage für den Hinweis in der Tagesabrechnung und später für
            die Umsatzprognose.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            XLSX-Import
          </Button>
          <Button onClick={() => setForm(EMPTY_FORM)}>Neue Veranstaltung</Button>
        </div>
      </div>

      {lastError && (
        <Alert variant="destructive">
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{lastError.message}</AlertDescription>
        </Alert>
      )}

      <EventTable
        rows={upcoming}
        emptyText={eventsQ.isLoading ? "Lädt…" : "Keine kommenden Veranstaltungen erfasst."}
        onEdit={(r) => setForm(formFromRow(r))}
        onDelete={setDeleteTarget}
      />

      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => setShowPast((v) => !v)}>
          {showPast ? "Vergangene ausblenden" : `Vergangene anzeigen (${past.length})`}
        </Button>
        {showPast && (
          <EventTable
            rows={past}
            emptyText="Keine vergangenen Veranstaltungen."
            onEdit={(r) => setForm(formFromRow(r))}
            onDelete={setDeleteTarget}
          />
        )}
      </div>

      {/* Anlegen / Bearbeiten */}
      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Veranstaltung bearbeiten" : "Neue Veranstaltung"}
            </DialogTitle>
            <DialogDescription>
              Events gelten betriebsweit — es gibt bewusst keine Standort-Zuordnung.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="ev-name">Name</Label>
                <Input
                  id="ev-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ev-from">Von</Label>
                <Input
                  id="ev-from"
                  type="date"
                  value={form.dateFrom}
                  onChange={(e) => setForm({ ...form, dateFrom: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ev-to">Bis</Label>
                <Input
                  id="ev-to"
                  type="date"
                  value={form.dateTo}
                  onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ev-cat">Kategorie</Label>
                <Input
                  id="ev-cat"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Konzert / Fachmesse / Volksfest"
                />
              </div>
              <div>
                <Label>Impact</Label>
                <Select
                  value={form.impact}
                  onValueChange={(v) => setForm({ ...form, impact: v as EventImpact })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_IMPACTS.map((i) => (
                      <SelectItem key={i} value={i}>
                        {IMPACT_LABEL[i]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ev-loc">Location</Label>
                <Input
                  id="ev-loc"
                  value={form.locationText}
                  onChange={(e) => setForm({ ...form, locationText: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ev-dist">Distanz</Label>
                <Input
                  id="ev-dist"
                  value={form.distanceText}
                  onChange={(e) => setForm({ ...form, distanceText: e.target.value })}
                  placeholder="~2 km"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ev-rec">Empfehlung (Personal / Reservierung)</Label>
                <Input
                  id="ev-rec"
                  value={form.recommendation}
                  onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ev-src">Quelle</Label>
                <Input
                  id="ev-src"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.provisional}
                  onCheckedChange={(v) => setForm({ ...form, provisional: v === true })}
                />
                vorläufig (Termin noch nicht bestätigt)
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Abbrechen
            </Button>
            <Button
              onClick={submitForm}
              disabled={
                !form ||
                form.name.trim() === "" ||
                form.category.trim() === "" ||
                form.dateTo < form.dateFrom ||
                createMut.isPending ||
                updateMut.isPending
              }
            >
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Löschen */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Veranstaltung löschen?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `„${deleteTarget.name}“ (${dateRange(deleteTarget)})` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                deleteMut.mutate(
                  { data: { id: deleteTarget.id } },
                  { onSuccess: () => setDeleteTarget(null) },
                );
              }}
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) {
            setPreview([]);
            setPreviewErrors([]);
            setFileError(null);
            importMut.reset();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>XLSX-Import „Event-Kalender“</DialogTitle>
            <DialogDescription>
              Die Datei wird nur im Browser gelesen — erst ein Klick auf „Übernehmen“ schreibt.
              Bestehende Events (gleicher Name + Von-Datum) werden aktualisiert, nichts doppelt
              angelegt.
            </DialogDescription>
          </DialogHeader>

          <Input
            type="file"
            accept=".xlsx"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="max-w-md"
          />

          {fileError && (
            <Alert variant="destructive">
              <AlertTitle>Datei</AlertTitle>
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          )}

          {previewErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>{previewErrors.length} Zeile(n) werden nicht übernommen</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {previewErrors.map((e) => (
                    <li key={e.sheetRow}>
                      Zeile {e.sheetRow}: {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {importMut.data && (
            <Alert>
              <AlertTitle>Import abgeschlossen</AlertTitle>
              <AlertDescription>
                {importMut.data.created} angelegt · {importMut.data.updated} aktualisiert ·{" "}
                {importMut.data.failed.length} fehlerhaft
                {importMut.data.termChanges.length > 0
                  ? ` · ${importMut.data.termChanges.length} möglicher Terminwechsel`
                  : ""}
              </AlertDescription>
            </Alert>
          )}

          {preview.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeile</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>vorläufig</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r, idx) => {
                  const key = importKey(r.name, r.dateFrom);
                  const shifted = termChangeKeys.get(key);
                  return (
                    <TableRow key={r.sheetRow}>
                      <TableCell className="text-muted-foreground">{r.sheetRow}</TableCell>
                      <TableCell className="whitespace-nowrap">{dateRange(r)}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell>
                        <ImpactBadge impact={r.impact} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {existingKeys.has(key) ? (
                          <span className="text-muted-foreground">aktualisiert</span>
                        ) : shifted ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            möglicher Terminwechsel (bisher {formatShortDate(shifted)})
                          </span>
                        ) : (
                          <span className="text-muted-foreground">neu</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={r.provisional}
                          onCheckedChange={(v) =>
                            setPreview((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, provisional: v === true } : p,
                              ),
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {termChangeKeys.size > 0 && (
            <p className="text-xs text-muted-foreground">
              „Möglicher Terminwechsel“ heißt: gleicher Name im selben Kalenderjahr, aber anderes
              Von-Datum. Es wird nichts automatisch gelöscht — die alte Zeile bleibt stehen und kann
              in der Liste entfernt werden.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Schließen
            </Button>
            <Button onClick={applyImport} disabled={preview.length === 0 || importMut.isPending}>
              Übernehmen ({preview.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventTable({
  rows,
  emptyText,
  onEdit,
  onDelete,
}: {
  rows: EventRow[];
  emptyText: string;
  onEdit: (row: EventRow) => void;
  onDelete: (row: EventRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Datum</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Kategorie</TableHead>
          <TableHead>Impact</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Empfehlung</TableHead>
          <TableHead className="text-right">Aktion</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap">{dateRange(r)}</TableCell>
            <TableCell>
              {r.name}
              {r.provisional && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  vorläufig
                </span>
              )}
            </TableCell>
            <TableCell>{r.category}</TableCell>
            <TableCell>
              <ImpactBadge impact={r.impact} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {r.locationText ?? "—"}
              {r.distanceText ? ` · ${r.distanceText}` : ""}
            </TableCell>
            <TableCell
              className="max-w-[22rem] truncate text-sm text-muted-foreground"
              title={r.recommendation ?? undefined}
            >
              {r.recommendation ?? "—"}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right">
              <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>
                Bearbeiten
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onDelete(r)}>
                Löschen
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
