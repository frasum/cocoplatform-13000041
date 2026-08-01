// Admin-UI für Modul M-BWA.
//
// F1: Erfassung (Tabelle, Erfassungs-/Bearbeiten-Dialog, Löschen).
// F2a: Dashboard mit KPI-Karten (inkl. Vormonat- und YoY-Delta),
// Break-even-Karte, GuV-Wasserfall + exakte Wertetabelle, Zeitreihe mit
// Benchmark-Bändern. Beide Ansichten leben als Tabs auf derselben Route
// (Muster M-Statistik, §19 „Tabs gegen Endlos-Scroll").
//
// Alle Rechenlogik liegt im reinen Modul `bwa-analytics` (getestet); die UI
// rechnet selbst NICHTS – sie ruft nur `deriveKpis`, `deltas`,
// `buildWaterfall`, `computeBreakEven`, `aggregateGroup`.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { parseEuroToCents, fmtCents } from "@/lib/format";
import {
  listBwaMonths,
  upsertBwaMonth,
  deleteBwaMonth,
  type BwaRow,
} from "@/lib/bwa/bwa.functions";
import { deriveBwa, validateBwaMonth, type BwaMonthInput } from "@/lib/bwa/bwa-core";
import { parseBwaPdfText, type ParsedBwaBlock } from "@/lib/bwa/bwa-pdf-parser";
import { clusterItemsToLines, type TextItem } from "@/lib/bwa/pdf-lines";
import {
  aggregateGroup,
  buildWaterfall,
  computeBreakEven,
  compareCostCenters,
  deltas,
  deriveKpis,
  findPrevMonth,
  findYoy,
  OPEN_DAYS_PER_MONTH,
  sumRows,
  sumSachkostenDetail,
  type CompareMetric,
  type Delta,
  type WaterfallStep,
} from "@/lib/bwa/bwa-analytics";

export const Route = createFileRoute("/_authenticated/admin/bwa")({
  beforeLoad: ({ context }) => {
    const role = (context as { identity?: { role?: string } }).identity?.role;
    if (role !== "admin") throw redirect({ to: "/admin" });
  },
  head: () => ({ meta: [{ title: "BWA — Auswertung & Erfassung" }] }),
  component: BwaPage,
});

const DEFAULT_ENTITY = "YUM Gastronomie GmbH";
const GROUP_KEY = "__group__";

function monthFirst(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-01`;
}

function fmtMonth(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

function fmtMonthShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("de-DE", { month: "2-digit", year: "2-digit" });
}

function fmtPct(v: number, digits = 1): string {
  return (
    v.toLocaleString("de-DE", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + " %"
  );
}

function BwaPage() {
  const listFn = useServerFn(listBwaMonths);
  const listQ = useQuery({
    queryKey: ["bwa-monthly"],
    queryFn: () => listFn(),
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BWA</h1>
        <p className="text-sm text-muted-foreground">
          Auswertung und Erfassung der monatlichen Betriebswirtschaftlichen Auswertung.
        </p>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="vergleich">Vergleich</TabsTrigger>
          <TabsTrigger value="erfassung">Erfassung</TabsTrigger>
          <TabsTrigger value="pdf">PDF-Import</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <BwaDashboardTab rows={rows} loading={listQ.isLoading} />
        </TabsContent>

        <TabsContent value="vergleich" className="space-y-6">
          <BwaVergleichTab rows={rows} loading={listQ.isLoading} />
        </TabsContent>

        <TabsContent value="erfassung" className="space-y-6">
          <BwaErfassungTab rows={rows} loading={listQ.isLoading} />
        </TabsContent>

        <TabsContent value="pdf" className="space-y-6">
          <BwaPdfImportTab rows={rows} loading={listQ.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// F3 — PDF-Import-Tab
// ============================================================================

/** Client-seitige pdfjs-Extraktion, angelehnt an split-combined.
 *  Gruppiert TextItems einer Seite nach y-Position zu Zeilen, innerhalb der
 *  Zeile nach x sortiert, mit Leerzeichen geschlossen — genau das Format,
 *  das parseBwaPdfText erwartet. Läuft NUR im Browser (lazy import), damit
 *  der Server-Bundle pdfjs nicht sieht.
 */
function installPdfJsBrowserPolyfills(): void {
  type AsyncReadableStreamPrototype = ReadableStream<unknown> & {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  const streamPrototype = globalThis.ReadableStream?.prototype as
    | AsyncReadableStreamPrototype
    | undefined;
  if (streamPrototype && typeof streamPrototype[Symbol.asyncIterator] !== "function") {
    Object.defineProperty(streamPrototype, Symbol.asyncIterator, {
      configurable: true,
      value: async function* readableStreamAsyncIterator(
        this: ReadableStream<unknown>,
      ): AsyncGenerator<unknown, void, unknown> {
        const reader = this.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) return;
            yield chunk.value;
          }
        } finally {
          reader.releaseLock();
        }
      },
    });
  }
}

type PdfTextItemLike = { str?: string; transform?: number[] };
type PdfTextChunkLike = { items?: unknown[] };
type PdfPageLike = {
  streamTextContent?: () => ReadableStream<PdfTextChunkLike>;
  getTextContent: () => Promise<{ items: unknown[] }>;
};

async function readPdfTextItems(page: PdfPageLike): Promise<unknown[]> {
  if (typeof page.streamTextContent === "function") {
    const reader = page.streamTextContent().getReader();
    const items: unknown[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (Array.isArray(value?.items)) items.push(...value.items);
      }
    } finally {
      reader.releaseLock();
    }
    return items;
  }

  const content = await page.getTextContent();
  return content.items;
}

async function extractBwaPagesFromPdf(file: File): Promise<string[][]> {
  installPdfJsBrowserPolyfills();
  const data = await file.arrayBuffer();
  // Legacy-Build plus eigener Stream-Reader: Safari/WebKit unterstützt in der
  // Preview kein async-iterator auf ReadableStream, pdfjs v6 nutzt ihn aber in
  // page.getTextContent(). Daher lesen wir streamTextContent() unten manuell.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerMod = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const items = await readPdfTextItems(page);
    const textItems: TextItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object" || !("str" in it)) continue;
      const item = it as PdfTextItemLike;
      if (!item.str || !Array.isArray(item.transform)) continue;
      textItems.push({ x: item.transform[4], y: item.transform[5], s: item.str });
    }
    pages.push(clusterItemsToLines(textItems));
  }
  return pages;
}

// Anzeige-Reihenfolge/Beschriftung der Euro-Felder im Review.
const REVIEW_FIELDS: {
  key: keyof BwaMonthInput;
  label: string;
  allowNegative?: boolean;
}[] = [
  { key: "umsatzCents", label: "Umsatz" },
  { key: "sonstErtraegeCents", label: "Sonst. betr. Erträge" },
  { key: "getraenkeCents", label: "Getränke" },
  { key: "speisenHausCents", label: "Speisen im Haus" },
  { key: "speisenAusserHausCents", label: "Speisen außer Haus" },
  { key: "sonstigeErloeseCents", label: "Sonstige Erlöse" },
  { key: "wareneinsatzCents", label: "Wareneinsatz" },
  { key: "personalCents", label: "Personal" },
  { key: "sachkostenCents", label: "Sachkosten" },
  { key: "anlageCents", label: "Anlage", allowNegative: true },
  { key: "abschreibungCents", label: "Abschreibung", allowNegative: true },
  { key: "betriebsergebnisCents", label: "Betriebsergebnis", allowNegative: true },
];

type ReviewBlock = ParsedBwaBlock & {
  key: string;
  fileName: string;
  /** Editierbarer Rohtext je Feld (Cent → deutsches Euro-Format). */
  fieldText: Record<keyof BwaMonthInput, string>;
  /** Angehakt = wird beim „Übernehmen" gespeichert. */
  selected: boolean;
  saveState: "idle" | "saving" | "ok" | "error";
  saveError?: string;
};

function fieldTextFromValues(values: Partial<BwaMonthInput>): ReviewBlock["fieldText"] {
  const out = {} as ReviewBlock["fieldText"];
  for (const f of REVIEW_FIELDS) {
    const v = values[f.key];
    out[f.key] = v === undefined ? "" : (v / 100).toFixed(2).replace(".", ",");
  }
  return out;
}

function reviewToInput(b: ReviewBlock): BwaMonthInput | null {
  const out = {} as BwaMonthInput;
  for (const f of REVIEW_FIELDS) {
    const parsed = parseEuroToCents(b.fieldText[f.key], {
      emptyAs: 0,
      allowNegative: !!f.allowNegative,
    });
    if (parsed === null) return null;
    (out as unknown as Record<string, number>)[f.key] = parsed;
  }
  return out;
}

function BwaPdfImportTab({ rows, loading }: { rows: BwaRow[]; loading: boolean }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertBwaMonth);
  const [blocks, setBlocks] = useState<ReviewBlock[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setParsing(true);
    const newBlocks: ReviewBlock[] = [];
    const newWarnings: string[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          newWarnings.push(`${file.name}: keine PDF-Datei, übersprungen.`);
          continue;
        }
        try {
          const pages = await extractBwaPagesFromPdf(file);
          const parsed = parseBwaPdfText(pages);
          for (const w of parsed.warnings) newWarnings.push(`${file.name}: ${w}`);
          for (const b of parsed.blocks) {
            newBlocks.push({
              ...b,
              key: `${file.name}::${b.entity}::${b.costCenter}::${b.month}::${newBlocks.length}`,
              fileName: file.name,
              fieldText: fieldTextFromValues(b.values),
              selected: b.missingFields.length === 0,
              saveState: "idle",
            });
          }
          if (parsed.blocks.length === 0) {
            newWarnings.push(`${file.name}: keine BWA-Blöcke erkannt.`);
          }
        } catch (e) {
          newWarnings.push(
            `${file.name}: PDF-Verarbeitung fehlgeschlagen — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setBlocks((prev) => [...prev, ...newBlocks]);
      setWarnings((prev) => [...prev, ...newWarnings]);
    } finally {
      setParsing(false);
    }
  }

  function updateBlock(key: string, patch: Partial<ReviewBlock>) {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function updateField(key: string, field: keyof BwaMonthInput, value: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.key === key
          ? {
              ...b,
              fieldText: { ...b.fieldText, [field]: value },
              saveState: "idle",
            }
          : b,
      ),
    );
  }

  function clearBlocks() {
    setBlocks([]);
    setWarnings([]);
  }

  const selectedCount = blocks.filter((b) => b.selected).length;

  async function applyAll() {
    setApplying(true);
    try {
      for (const b of blocks) {
        if (!b.selected || b.saveState === "ok") continue;
        const input = reviewToInput(b);
        if (!input) {
          updateBlock(b.key, {
            saveState: "error",
            saveError: "Ungültige Euro-Eingabe.",
          });
          continue;
        }
        const check = validateBwaMonth(input);
        if (!check.ok) {
          updateBlock(b.key, { saveState: "error", saveError: check.errors.join(" ") });
          continue;
        }
        // Detail-Summe gegen Zeile 47 prüfen — mehr als 3 € Abweichung
        // → Detail wird NICHT mitgespeichert.
        const detailSum = Object.values(b.sachkostenDetail).reduce((s, v) => s + v, 0);
        const detailOk = Math.abs(detailSum - input.sachkostenCents) <= 300;
        const detailHas = Object.keys(b.sachkostenDetail).length > 0;
        updateBlock(b.key, { saveState: "saving", saveError: undefined });
        try {
          await upsertFn({
            data: {
              entity: b.entity.trim(),
              costCenter: b.costCenter.trim(),
              month: b.month,
              source: "pdf",
              ...input,
              ...(detailHas && detailOk ? { sachkostenDetail: b.sachkostenDetail } : {}),
            },
          });
          updateBlock(b.key, { saveState: "ok" });
        } catch (e) {
          updateBlock(b.key, {
            saveState: "error",
            saveError: e instanceof Error ? e.message : String(e),
          });
        }
      }
      qc.invalidateQueries({ queryKey: ["bwa-monthly"] });
      toast.success("PDF-Import verarbeitet.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>PDF-Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            eurodata-BWA-PDFs auswählen. Extraktion und Parsing laufen ausschließlich im Browser —
            das PDF wird nicht hochgeladen. Erst ein Klick auf „Übernehmen" schreibt die bestätigten
            Blöcke in die Datenbank.
          </p>
          <input
            type="file"
            accept="application/pdf"
            multiple
            disabled={parsing}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.currentTarget.value = "";
            }}
            className="block text-sm"
          />
          {parsing && <p className="text-sm text-muted-foreground">Verarbeite PDF…</p>}
          {blocks.length > 0 && (
            <div className="flex items-center gap-3">
              <Button onClick={applyAll} disabled={applying || selectedCount === 0}>
                {applying ? "Übernehme…" : `${selectedCount} Block/-öcke übernehmen`}
              </Button>
              <Button variant="outline" onClick={clearBlocks} disabled={applying}>
                Liste leeren
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hinweise</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {loading && <Skeleton className="h-32 w-full" />}

      {blocks.map((b) => (
        <PdfReviewCard
          key={b.key}
          block={b}
          existing={rows.find(
            (r) => r.entity === b.entity && r.costCenter === b.costCenter && r.month === b.month,
          )}
          onToggle={(v) => updateBlock(b.key, { selected: v })}
          onFieldChange={(f, v) => updateField(b.key, f, v)}
        />
      ))}
    </div>
  );
}

function PdfReviewCard({
  block,
  existing,
  onToggle,
  onFieldChange,
}: {
  block: ReviewBlock;
  existing: BwaRow | undefined;
  onToggle: (v: boolean) => void;
  onFieldChange: (field: keyof BwaMonthInput, value: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const input = reviewToInput(block);
  const validation = input ? validateBwaMonth(input) : null;
  const derived = input ? deriveBwa(input) : null;
  const detailSum = Object.values(block.sachkostenDetail).reduce((s, v) => s + v, 0);
  const detailDiff = input ? detailSum - input.sachkostenCents : 0;
  const detailMismatch = Math.abs(detailDiff) > 300;
  const detailHas = Object.keys(block.sachkostenDetail).length > 0;
  const disabledSelect =
    !input || !validation?.ok || block.missingFields.length > 0 || block.saveState === "ok";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <Checkbox
            checked={block.selected}
            disabled={disabledSelect}
            onCheckedChange={(v) => onToggle(!!v)}
          />
          <span>{block.entity}</span>
          <span className="text-muted-foreground">·</span>
          <span>{block.costCenter}</span>
          <span className="text-muted-foreground">·</span>
          <span>{fmtMonth(block.month)}</span>
          <Badge variant="secondary">PDF</Badge>
          {block.saveState === "ok" && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">gespeichert</Badge>
          )}
          {block.saveState === "error" && <Badge variant="destructive">Fehler</Badge>}
          <span className="ml-auto text-xs text-muted-foreground font-normal">
            {block.fileName}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {block.missingFields.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            <strong>Fehlende Felder aus dem PDF:</strong>{" "}
            {block.missingFields
              .map((k) => REVIEW_FIELDS.find((f) => f.key === k)?.label ?? k)
              .join(", ")}{" "}
            — bitte manuell nachtragen, sonst ist der Block nicht anwählbar.
          </div>
        )}

        {existing && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
            <div>
              <strong>Überschreibt vorhandene Werte</strong> (Quelle: {existing.source})
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
              <DiffLine label="Umsatz" oldC={existing.umsatzCents} newC={input?.umsatzCents} />
              <DiffLine
                label="Personal"
                oldC={existing.personalCents}
                newC={input?.personalCents}
              />
              <DiffLine
                label="Betriebsergebnis"
                oldC={existing.betriebsergebnisCents}
                newC={input?.betriebsergebnisCents}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {REVIEW_FIELDS.map((f) => (
            <FieldEuro
              key={f.key}
              label={f.label}
              value={block.fieldText[f.key]}
              allowNegative={f.allowNegative}
              onChange={(v) => onFieldChange(f.key, v)}
            />
          ))}
        </div>

        {derived && (
          <div className="rounded-md border p-3 text-sm bg-muted/30">
            <div className="font-medium mb-2">Abgeleitete Werte</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 tabular-nums">
              <DerivedLine label="Gesamtleistung" cents={derived.gesamtleistungCents} />
              <DerivedLine label="Rohertrag I" cents={derived.rohertrag1Cents} />
              <DerivedLine label="Rohertrag II" cents={derived.rohertrag2Cents} />
              <DerivedLine label="Ergebnis op. Tätigkeit" cents={derived.ergebnisOpCents} />
              <DerivedLine
                label="Betriebsergebnis (Soll)"
                cents={derived.betriebsergebnisSollCents}
              />
            </div>
          </div>
        )}

        {validation && !validation.ok && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
            {validation.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}

        {detailHas && (
          <div className="rounded-md border p-3 text-sm">
            <button
              type="button"
              className="text-left w-full font-medium"
              onClick={() => setDetailOpen((v) => !v)}
            >
              {detailOpen ? "▲" : "▼"} Sachkosten-Detail (
              {Object.keys(block.sachkostenDetail).length} Positionen, Summe {fmtCents(detailSum)}{" "}
              €)
            </button>
            {detailMismatch && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Detail-Summe weicht um {fmtCents(Math.abs(detailDiff))} € von Zeile 47 ab — Detail
                wird NICHT mitgespeichert.
              </div>
            )}
            {detailOpen && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(block.sachkostenDetail).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="tabular-nums">{fmtCents(v)} €</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {block.saveError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {block.saveError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiffLine({
  label,
  oldC,
  newC,
}: {
  label: string;
  oldC: number;
  newC: number | undefined;
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div>
        {fmtCents(oldC)} € → {newC === undefined ? "—" : `${fmtCents(newC)} €`}
      </div>
    </div>
  );
}

// ============================================================================
// Dashboard-Tab
// ============================================================================

function BwaDashboardTab({ rows, loading }: { rows: BwaRow[]; loading: boolean }) {
  const entities = useMemo(() => Array.from(new Set(rows.map((r) => r.entity))).sort(), [rows]);
  const [entity, setEntity] = useState<string>("");
  const [ccSel, setCcSel] = useState<string>(GROUP_KEY);
  const [monthSel, setMonthSel] = useState<string>("");
  const [sigmaLast12, setSigmaLast12] = useState(false);

  // Default-Entity setzen sobald Daten da sind.
  const effEntity = entity || entities[0] || "";

  const entityRows = useMemo(() => rows.filter((r) => r.entity === effEntity), [rows, effEntity]);

  const costCenters = useMemo(
    () => Array.from(new Set(entityRows.map((r) => r.costCenter))).sort(),
    [entityRows],
  );

  // Zeilen für die aktive Auswahl (Gruppe = summierte KSt).
  const scopedRows = useMemo(() => {
    if (ccSel === GROUP_KEY) return aggregateGroup(entityRows);
    return entityRows.filter((r) => r.costCenter === ccSel);
  }, [entityRows, ccSel]);

  const scopedByMonthDesc = useMemo(
    () => [...scopedRows].sort((a, b) => b.month.localeCompare(a.month)),
    [scopedRows],
  );

  const availableMonths = scopedByMonthDesc.map((r) => r.month);
  const effMonth =
    monthSel && availableMonths.includes(monthSel) ? monthSel : (availableMonths[0] ?? "");

  const currentRow = useMemo<BwaRow | null>(() => {
    if (sigmaLast12) {
      const last12 = scopedByMonthDesc.slice(0, 12);
      if (last12.length === 0) return null;
      const s = sumRows(last12);
      return {
        id: "sigma12",
        entity: effEntity,
        costCenter: ccSel === GROUP_KEY ? "Gruppe" : ccSel,
        month: last12[0].month,
        ...s,
        sachkostenDetail: null,
        source: "import",
      };
    }
    return scopedByMonthDesc.find((r) => r.month === effMonth) ?? null;
  }, [sigmaLast12, scopedByMonthDesc, effMonth, effEntity, ccSel]);

  const prevMonthRow = useMemo(
    () => (sigmaLast12 || !effMonth ? undefined : findPrevMonth(scopedRows, effMonth)),
    [sigmaLast12, effMonth, scopedRows],
  );
  const yoyRow = useMemo(
    () => (sigmaLast12 || !effMonth ? undefined : findYoy(scopedRows, effMonth)),
    [sigmaLast12, effMonth, scopedRows],
  );

  // F5: Vorperioden-Aggregat (Monate 13–24) für den Σ12-Vergleich.
  const prev12 = useMemo<{
    row: BwaRow | undefined;
    coverage: number;
    label: string;
  }>(() => {
    if (!sigmaLast12) return { row: undefined, coverage: 0, label: "" };
    const window = scopedByMonthDesc.slice(12, 24);
    if (window.length === 0) return { row: undefined, coverage: 0, label: "" };
    const s = sumRows(window);
    const row: BwaRow = {
      id: "sigma12-prev",
      entity: effEntity,
      costCenter: ccSel === GROUP_KEY ? "Gruppe" : ccSel,
      month: window[0].month,
      ...s,
      sachkostenDetail: null,
      source: "import",
    };
    // window ist absteigend sortiert: [0]=neuester, [last]=ältester.
    const label = `${fmtMonth(window[window.length - 1].month)} – ${fmtMonth(window[0].month)}`;
    return { row, coverage: window.length, label };
  }, [sigmaLast12, scopedByMonthDesc, effEntity, ccSel]);

  const be = useMemo(() => computeBreakEven(scopedByMonthDesc), [scopedByMonthDesc]);

  // F2b: Roh-Zeilen der aktuellen Auswahl (für Sachkosten-Drilldown).
  // Bei "Gruppe" alle Kostenstellen mitreichen — aggregateGroup verwirft
  // sachkostenDetail bewusst, der Drilldown läuft auf den Roh-Zeilen.
  const rawSelectionRows = useMemo(() => {
    const base =
      ccSel === GROUP_KEY ? entityRows : entityRows.filter((r) => r.costCenter === ccSel);
    if (sigmaLast12) {
      const last12Months = new Set(scopedByMonthDesc.slice(0, 12).map((r) => r.month));
      return base.filter((r) => last12Months.has(r.month));
    }
    return base.filter((r) => r.month === effMonth);
  }, [ccSel, entityRows, sigmaLast12, scopedByMonthDesc, effMonth]);

  const sachSummary = useMemo(() => sumSachkostenDetail(rawSelectionRows), [rawSelectionRows]);
  const totalSachkostenCents = useMemo(
    () => rawSelectionRows.reduce((acc, r) => acc + r.sachkostenCents, 0),
    [rawSelectionRows],
  );
  const periodLabel = sigmaLast12 ? "Σ letzte 12 Monate" : effMonth ? fmtMonth(effMonth) : "";

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-muted-foreground">Noch keine BWA-Daten erfasst.</p>
          <p className="text-sm text-muted-foreground">
            Wechsle auf den Tab „Erfassung", um den ersten Monat anzulegen.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter-Zeile */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Gesellschaft</Label>
          <Select value={effEntity} onValueChange={setEntity}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Kostenstelle</Label>
          <Select value={ccSel} onValueChange={setCcSel}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GROUP_KEY}>Gruppe</SelectItem>
              {costCenters.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Monat</Label>
          <Select value={effMonth} onValueChange={setMonthSel} disabled={sigmaLast12}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableMonths.map((m) => (
                <SelectItem key={m} value={m}>
                  {fmtMonth(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={sigmaLast12 ? "default" : "outline"}
            size="sm"
            onClick={() => setSigmaLast12((v) => !v)}
          >
            Σ letzte 12 Monate
          </Button>
        </div>
      </div>

      {!currentRow ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Keine Daten für die aktuelle Auswahl.
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiRow
            row={currentRow}
            prev={prevMonthRow}
            yoy={yoyRow}
            sigma={sigmaLast12}
            prev12={prev12.row}
            prev12Label={prev12.label}
            prev12Coverage={prev12.coverage}
          />
          <BreakEvenCard be={be} />
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <WaterfallCard row={currentRow} />
            </div>
            <WaterfallTableCard row={currentRow} />
          </div>
          <SachkostenDrilldownCard
            summary={sachSummary}
            totalSachkostenCents={totalSachkostenCents}
            periodLabel={periodLabel}
          />
          <TimeSeriesCard
            rows={scopedByMonthDesc}
            highlightedMonth={sigmaLast12 ? undefined : effMonth}
          />
          <QuoteBandsCard
            rows={scopedByMonthDesc}
            highlightedMonth={sigmaLast12 ? undefined : effMonth}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI-Karten
// ---------------------------------------------------------------------------

function KpiRow({
  row,
  prev,
  yoy,
  sigma,
  prev12,
  prev12Label,
  prev12Coverage,
}: {
  row: BwaRow;
  prev: BwaRow | undefined;
  yoy: BwaRow | undefined;
  sigma: boolean;
  prev12: BwaRow | undefined;
  prev12Label: string;
  prev12Coverage: number;
}) {
  const k = deriveKpis(row);
  const prevK = prev ? deriveKpis(prev) : undefined;
  const yoyK = yoy ? deriveKpis(yoy) : undefined;
  const prev12K = prev12 ? deriveKpis(prev12) : undefined;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        label="Gesamtumsatz"
        value={`${fmtCents(row.umsatzCents)} €`}
        deltaMonth={sigma ? null : deltas(row.umsatzCents, prev?.umsatzCents)}
        deltaYear={sigma ? null : deltas(row.umsatzCents, yoy?.umsatzCents)}
        sigma={sigma}
        sigmaDelta={sigma ? deltas(row.umsatzCents, prev12?.umsatzCents) : null}
        sigmaLabel={prev12Label}
        sigmaCoverage={prev12Coverage}
        higherIsGood
      />
      <KpiCard
        label="Rohertrag I"
        value={`${fmtCents(k.rohertrag1Cents)} €`}
        sub={`${fmtPct(k.rohertrag1Quote)} vom Umsatz`}
        deltaMonth={sigma ? null : deltas(k.rohertrag1Cents, prevK?.rohertrag1Cents)}
        deltaYear={sigma ? null : deltas(k.rohertrag1Cents, yoyK?.rohertrag1Cents)}
        sigma={sigma}
        sigmaDelta={sigma ? deltas(k.rohertrag1Cents, prev12K?.rohertrag1Cents) : null}
        sigmaLabel={prev12Label}
        sigmaCoverage={prev12Coverage}
        higherIsGood
      />
      <KpiCard
        label="Personalkosten"
        value={`${fmtCents(row.personalCents)} €`}
        sub={`${fmtPct(k.personalQuote)} vom Umsatz`}
        warn={k.personalQuote > 40}
        deltaMonth={sigma ? null : deltas(row.personalCents, prev?.personalCents)}
        deltaYear={sigma ? null : deltas(row.personalCents, yoy?.personalCents)}
        sigma={sigma}
        sigmaDelta={sigma ? deltas(row.personalCents, prev12?.personalCents) : null}
        sigmaLabel={prev12Label}
        sigmaCoverage={prev12Coverage}
        higherIsGood={false}
      />
      <KpiCard
        label="Prime Cost"
        value={`${fmtCents(row.wareneinsatzCents + row.personalCents)} €`}
        sub={`${fmtPct(k.primeCostQuote)} (Richtwert 55–65 %)`}
        warn={k.primeCostQuote > 65}
        deltaMonth={
          sigma
            ? null
            : deltas(
                row.wareneinsatzCents + row.personalCents,
                prev ? prev.wareneinsatzCents + prev.personalCents : undefined,
              )
        }
        deltaYear={
          sigma
            ? null
            : deltas(
                row.wareneinsatzCents + row.personalCents,
                yoy ? yoy.wareneinsatzCents + yoy.personalCents : undefined,
              )
        }
        sigma={sigma}
        sigmaDelta={
          sigma
            ? deltas(
                row.wareneinsatzCents + row.personalCents,
                prev12 ? prev12.wareneinsatzCents + prev12.personalCents : undefined,
              )
            : null
        }
        sigmaLabel={prev12Label}
        sigmaCoverage={prev12Coverage}
        higherIsGood={false}
      />
      <KpiCard
        label="Betriebsergebnis"
        value={`${fmtCents(row.betriebsergebnisCents)} €`}
        sub={`${fmtPct(k.betriebsQuote)} vom Umsatz`}
        valueClass={row.betriebsergebnisCents < 0 ? "text-destructive" : "text-emerald-600"}
        deltaMonth={sigma ? null : deltas(row.betriebsergebnisCents, prev?.betriebsergebnisCents)}
        deltaYear={sigma ? null : deltas(row.betriebsergebnisCents, yoy?.betriebsergebnisCents)}
        sigma={sigma}
        sigmaDelta={sigma ? deltas(row.betriebsergebnisCents, prev12?.betriebsergebnisCents) : null}
        sigmaLabel={prev12Label}
        sigmaCoverage={prev12Coverage}
        higherIsGood
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  warn,
  valueClass,
  deltaMonth,
  deltaYear,
  higherIsGood,
  sigma,
  sigmaDelta,
  sigmaLabel,
  sigmaCoverage,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  valueClass?: string;
  deltaMonth: Delta | null;
  deltaYear: Delta | null;
  higherIsGood: boolean;
  sigma?: boolean;
  sigmaDelta?: Delta | null;
  sigmaLabel?: string;
  sigmaCoverage?: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {label}
          {warn && <AlertTriangle className="h-4 w-4 text-destructive" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className={`text-2xl font-semibold tabular-nums ${valueClass ?? ""}`}>{value}</div>
        {sub && (
          <div className={`text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>
            {sub}
          </div>
        )}
        {sigma ? (
          <DeltaLine
            label={sigmaLabel ? `Vorperiode (${sigmaLabel})` : "Vorperiode"}
            delta={sigmaDelta ?? null}
            higherIsGood={higherIsGood}
            suffix={
              sigmaCoverage !== undefined && sigmaCoverage > 0 && sigmaCoverage < 12
                ? ` (nur ${sigmaCoverage} Monate Daten)`
                : undefined
            }
          />
        ) : (
          <>
            <DeltaLine label="Vormonat" delta={deltaMonth} higherIsGood={higherIsGood} />
            <DeltaLine label="Vorjahr" delta={deltaYear} higherIsGood={higherIsGood} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaLine({
  label,
  delta,
  higherIsGood,
  suffix,
}: {
  label: string;
  delta: Delta | null;
  higherIsGood: boolean;
  suffix?: string;
}) {
  if (!delta) {
    return (
      <div className="text-xs text-muted-foreground">
        {label}: —{suffix && <span className="opacity-70">{suffix}</span>}
      </div>
    );
  }
  const up = delta.absCents > 0;
  const good = higherIsGood ? up : !up;
  const cls =
    delta.absCents === 0 ? "text-muted-foreground" : good ? "text-emerald-600" : "text-destructive";
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <div className={`text-xs flex items-center gap-1 ${cls}`}>
      {delta.absCents !== 0 && <Arrow className="h-3 w-3" />}
      <span>
        {label}: {delta.pct === null ? "—" : fmtPct(delta.pct)}
        {suffix && <span className="opacity-70">{suffix}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------

function BreakEvenCard({ be }: { be: ReturnType<typeof computeBreakEven> }) {
  if (!be) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Break-even (rollierend)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Break-even nicht berechenbar (kein Deckungsbeitrag oder keine Daten).
        </CardContent>
      </Card>
    );
  }
  const vatPct = ((be.factor - 1) * 100).toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const mosPositive = be.marginOfSafety >= 0;
  const pctOfBe = be.netDayCents === 0 ? 0 : (be.actualDayCents / be.netDayCents) * 100;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Break-even (rollierend, {be.months} Monate)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">BE pro Tag (netto)</div>
            <div className="text-3xl font-semibold tabular-nums">{fmtCents(be.netDayCents)} €</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">BE pro Tag (brutto)</div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmtCents(be.grossDayCents)} €
            </div>
            <div className="text-xs text-muted-foreground">inkl. {vatPct} % USt (Mix)</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">BE pro Monat</div>
            <div className="text-lg tabular-nums">{fmtCents(be.netMonthCents)} € netto</div>
            <div className="text-xs text-muted-foreground">
              {fmtCents(be.grossMonthCents)} € brutto
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ø Ist-Umsatz / Tag</div>
            <div className="text-lg tabular-nums">{fmtCents(be.actualDayCents)} €</div>
            <div
              className={`text-xs font-medium ${
                mosPositive ? "text-emerald-600" : "text-destructive"
              }`}
            >
              Sicherheitsabstand: {fmtPct(be.marginOfSafety * 100)}
            </div>
          </div>
        </div>

        {/* Balken Ist vs. BE-Marke */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Ist ({fmtCents(be.actualDayCents)} €) vs. Break-even ({fmtCents(be.netDayCents)} €)
          </div>
          <div className="relative h-3 rounded bg-muted overflow-hidden">
            <div
              className={`h-full ${mosPositive ? "bg-emerald-500" : "bg-destructive"}`}
              style={{ width: `${Math.max(0, Math.min(150, pctOfBe))}%` }}
            />
            <div
              className="absolute inset-y-0 border-l-2 border-foreground"
              style={{ left: `min(100%, 100%)` }}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Annahmen: variabel = nur Wareneinsatz; fix = Personal + Sachkosten + Anlage + Abschreibung
          (konservativ, flexibles Personal senkt den realen BE); {OPEN_DAYS_PER_MONTH}{" "}
          Öffnungstage/Monat.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Wasserfall
// ---------------------------------------------------------------------------

function waterfallColor(kind: WaterfallStep["kind"], signed: number): string {
  switch (kind) {
    case "plus":
      return "var(--primary)";
    case "minus":
      return "hsl(0 70% 55%)";
    case "subtotal":
      return "hsl(215 15% 55%)";
    case "total":
      return signed < 0 ? "hsl(0 75% 50%)" : "hsl(142 65% 40%)";
  }
}

function WaterfallCard({ row }: { row: BwaRow }) {
  const steps = useMemo(() => buildWaterfall(row), [row]);
  const chartData = steps.map((s) => ({
    label: s.label,
    base: s.baseCents / 100,
    value: s.valueCents / 100,
    signed: s.signedCents / 100,
    kind: s.kind,
  }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>GuV-Brücke</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                interval={0}
                tick={{ fontSize: 11 }}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat("de-DE", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
                width={70}
              />
              <Tooltip
                formatter={(_v, _n, item) => {
                  const p = (item as { payload?: { signed?: number; label?: string } }).payload;
                  return [
                    `${(p?.signed ?? 0).toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} €`,
                    p?.label ?? "",
                  ];
                }}
                labelFormatter={(l: string) => l}
              />
              {/* Sockel unsichtbar */}
              <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="value" stackId="wf" isAnimationActive={false}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={waterfallColor(d.kind, d.signed * 100)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function WaterfallTableCard({ row }: { row: BwaRow }) {
  const steps = useMemo(() => buildWaterfall(row), [row]);
  const umsatz = row.umsatzCents || 1;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Werte im Detail</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Position</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
              <TableHead className="text-right">% Umsatz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {steps.map((s) => {
              const isSum = s.kind === "subtotal" || s.kind === "total";
              return (
                <TableRow key={s.label} className={isSum ? "bg-muted/40 font-medium" : ""}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      s.kind === "minus"
                        ? "text-destructive"
                        : s.kind === "total"
                          ? s.signedCents < 0
                            ? "text-destructive"
                            : "text-emerald-600"
                          : ""
                    }`}
                  >
                    {fmtCents(s.signedCents)} €
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtPct((s.signedCents / umsatz) * 100)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zeitreihe + Quoten-Bänder
// ---------------------------------------------------------------------------

function TimeSeriesCard({ rows, highlightedMonth }: { rows: BwaRow[]; highlightedMonth?: string }) {
  const data = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((r) => ({
          month: r.month,
          label: fmtMonthShort(r.month),
          umsatz: r.umsatzCents / 100,
          betrieb: r.betriebsergebnisCents / 100,
        })),
    [rows],
  );
  const highlightLabel = highlightedMonth
    ? data.find((d) => d.month === highlightedMonth)?.label
    : undefined;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Zeitreihe — Umsatz & Betriebsergebnis</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) =>
                  new Intl.NumberFormat("de-DE", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)
                }
                width={70}
              />
              <Tooltip
                formatter={(v: number) =>
                  `${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`
                }
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
              {highlightLabel && (
                <ReferenceLine
                  x={highlightLabel}
                  stroke="var(--primary)"
                  strokeDasharray="4 2"
                />
              )}
              <Bar dataKey="umsatz" fill="var(--primary)" opacity={0.7} name="Umsatz" />
              <Line
                type="monotone"
                dataKey="betrieb"
                stroke="hsl(142 65% 40%)"
                strokeWidth={2}
                dot={false}
                name="Betriebsergebnis"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function QuoteBandsCard({ rows, highlightedMonth }: { rows: BwaRow[]; highlightedMonth?: string }) {
  const data = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((r) => {
          const k = deriveKpis(r);
          return {
            month: r.month,
            label: fmtMonthShort(r.month),
            personal: Number(k.personalQuote.toFixed(1)),
            wes: Number(k.wesQuote.toFixed(1)),
          };
        }),
    [rows],
  );
  const highlightLabel = highlightedMonth
    ? data.find((d) => d.month === highlightedMonth)?.label
    : undefined;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Personal- & WES-Quote (mit Benchmark-Bändern)</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v: number) => `${v} %`}
                domain={[0, "dataMax + 5"]}
                width={50}
              />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)} %`} />
              <ReferenceArea
                y1={28}
                y2={32}
                fill="hsl(215 90% 60%)"
                fillOpacity={0.08}
                label={{ value: "WES 28–32 %", position: "insideTopRight", fontSize: 10 }}
              />
              <ReferenceArea
                y1={30}
                y2={35}
                fill="hsl(142 65% 40%)"
                fillOpacity={0.08}
                label={{ value: "Personal 30–35 %", position: "insideBottomRight", fontSize: 10 }}
              />
              {highlightLabel && (
                <ReferenceLine
                  x={highlightLabel}
                  stroke="var(--primary)"
                  strokeDasharray="4 2"
                />
              )}
              <Line
                type="monotone"
                dataKey="wes"
                stroke="hsl(215 90% 55%)"
                strokeWidth={2}
                dot={false}
                name="WES-Quote"
              />
              <Line
                type="monotone"
                dataKey="personal"
                stroke="hsl(142 65% 40%)"
                strokeWidth={2}
                dot={false}
                name="Personalquote"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Erfassungs-Tab (F1 unverändert, nur in den Tab verschoben)
// ============================================================================

type FormState = {
  id?: string;
  entity: string;
  costCenter: string;
  monthInput: string; // YYYY-MM
  umsatz: string;
  getraenke: string;
  speisenHaus: string;
  speisenAusserHaus: string;
  sonstigeErloese: string;
  sonstErtraege: string;
  wareneinsatz: string;
  personal: string;
  sachkosten: string;
  anlage: string;
  abschreibung: string;
  betriebsergebnis: string;
};

const EMPTY_FORM: FormState = {
  entity: DEFAULT_ENTITY,
  costCenter: "",
  monthInput: new Date().toISOString().slice(0, 7),
  umsatz: "",
  getraenke: "",
  speisenHaus: "",
  speisenAusserHaus: "",
  sonstigeErloese: "",
  sonstErtraege: "",
  wareneinsatz: "",
  personal: "",
  sachkosten: "",
  anlage: "",
  abschreibung: "",
  betriebsergebnis: "",
};

function formFromRow(r: BwaRow): FormState {
  const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  return {
    id: r.id,
    entity: r.entity,
    costCenter: r.costCenter,
    monthInput: r.month.slice(0, 7),
    umsatz: eur(r.umsatzCents),
    getraenke: eur(r.getraenkeCents),
    speisenHaus: eur(r.speisenHausCents),
    speisenAusserHaus: eur(r.speisenAusserHausCents),
    sonstigeErloese: eur(r.sonstigeErloeseCents),
    sonstErtraege: eur(r.sonstErtraegeCents),
    wareneinsatz: eur(r.wareneinsatzCents),
    personal: eur(r.personalCents),
    sachkosten: eur(r.sachkostenCents),
    anlage: eur(r.anlageCents),
    abschreibung: eur(r.abschreibungCents),
    betriebsergebnis: eur(r.betriebsergebnisCents),
  };
}

function parseCents(s: string, allowNegative = false): number | null {
  return parseEuroToCents(s, { emptyAs: 0, allowNegative });
}

function formToInput(f: FormState): BwaMonthInput | null {
  const g = parseCents(f.getraenke);
  const sh = parseCents(f.speisenHaus);
  const sa = parseCents(f.speisenAusserHaus);
  const so = parseCents(f.sonstigeErloese);
  const se = parseCents(f.sonstErtraege);
  const u = parseCents(f.umsatz);
  const w = parseCents(f.wareneinsatz);
  const p = parseCents(f.personal);
  const s = parseCents(f.sachkosten);
  const a = parseCents(f.anlage, true);
  const ab = parseCents(f.abschreibung, true);
  const be = parseCents(f.betriebsergebnis, true);
  const all = [g, sh, sa, so, se, u, w, p, s, a, ab, be];
  if (all.some((v) => v === null)) return null;
  return {
    umsatzCents: u!,
    getraenkeCents: g!,
    speisenHausCents: sh!,
    speisenAusserHausCents: sa!,
    sonstigeErloeseCents: so!,
    sonstErtraegeCents: se!,
    wareneinsatzCents: w!,
    personalCents: p!,
    sachkostenCents: s!,
    anlageCents: a!,
    abschreibungCents: ab!,
    betriebsergebnisCents: be!,
  };
}

function BwaErfassungTab({ rows, loading }: { rows: BwaRow[]; loading: boolean }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertBwaMonth);
  const deleteFn = useServerFn(deleteBwaMonth);

  const [entityFilter, setEntityFilter] = useState<string>("__all__");
  const [ccFilter, setCcFilter] = useState<string>("__all__");
  const [openDialog, setOpenDialog] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const entities = useMemo(() => Array.from(new Set(rows.map((r) => r.entity))).sort(), [rows]);
  const costCenters = useMemo(
    () => Array.from(new Set(rows.map((r) => r.costCenter))).sort(),
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (entityFilter === "__all__" || r.entity === entityFilter) &&
      (ccFilter === "__all__" || r.costCenter === ccFilter),
  );

  const derived = useMemo(() => {
    const inp = formToInput(form);
    return inp ? deriveBwa(inp) : null;
  }, [form]);

  const validation = useMemo(() => {
    const inp = formToInput(form);
    return inp ? validateBwaMonth(inp) : null;
  }, [form]);

  const upsertMut = useMutation({
    mutationFn: () => {
      const inp = formToInput(form);
      if (!inp) throw new Error("Bitte alle Beträge im Euro-Format eingeben.");
      return upsertFn({
        data: {
          id: form.id,
          entity: form.entity.trim(),
          costCenter: form.costCenter.trim(),
          month: monthFirst(form.monthInput),
          ...inp,
        },
      });
    },
    onSuccess: () => {
      toast.success("BWA-Monat gespeichert.");
      setOpenDialog(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["bwa-monthly"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("BWA-Monat gelöscht.");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["bwa-monthly"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen."),
  });

  function openNew() {
    setForm({
      ...EMPTY_FORM,
      entity: entities[0] ?? DEFAULT_ENTITY,
      costCenter: costCenters[0] ?? "",
    });
    setOpenDialog(true);
  }

  function openEdit(r: BwaRow) {
    setForm(formFromRow(r));
    setOpenDialog(true);
  }

  const saveDisabled =
    !form.entity.trim() ||
    !form.costCenter.trim() ||
    !/^\d{4}-\d{2}$/.test(form.monthInput) ||
    !validation ||
    !validation.ok ||
    upsertMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Gesellschaft</Label>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Alle</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Kostenstelle</Label>
          <Select value={ccFilter} onValueChange={setCcFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Alle</SelectItem>
              {costCenters.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <Button onClick={openNew}>Monat erfassen</Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Monat</TableHead>
              <TableHead>Gesellschaft</TableHead>
              <TableHead>Kostenstelle</TableHead>
              <TableHead className="text-right">Umsatz</TableHead>
              <TableHead className="text-right">Wareneinsatz</TableHead>
              <TableHead className="text-right">Personal</TableHead>
              <TableHead className="text-right">Personal %</TableHead>
              <TableHead className="text-right">Sachkosten</TableHead>
              <TableHead className="text-right">Betriebsergebnis</TableHead>
              <TableHead>Quelle</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                  Lade…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-6">
                  Noch keine BWA-Zeilen erfasst.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const persQuote =
                r.umsatzCents > 0
                  ? ((r.personalCents / r.umsatzCents) * 100).toLocaleString("de-DE", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }) + " %"
                  : "—";
              const beNeg = r.betriebsergebnisCents < 0;
              const detailOpen = !!expanded[r.id];
              const hasDetail = r.sachkostenDetail && Object.keys(r.sachkostenDetail).length > 0;
              return (
                <>
                  <TableRow key={r.id}>
                    <TableCell>{fmtMonth(r.month)}</TableCell>
                    <TableCell>{r.entity}</TableCell>
                    <TableCell>{r.costCenter}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCents(r.umsatzCents)} €
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCents(r.wareneinsatzCents)} €
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCents(r.personalCents)} €
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {persQuote}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtCents(r.sachkostenCents)} €
                    </TableCell>
                    <TableCell
                      className={
                        "text-right tabular-nums font-medium " +
                        (beNeg ? "text-destructive" : "text-emerald-600")
                      }
                    >
                      {fmtCents(r.betriebsergebnisCents)} €
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.source}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      {hasDetail && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                        >
                          {detailOpen ? "▲" : "▼"}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                        Bearbeiten
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteId(r.id)}>
                        Löschen
                      </Button>
                    </TableCell>
                  </TableRow>
                  {detailOpen && hasDetail && (
                    <TableRow key={r.id + "__detail"}>
                      <TableCell colSpan={11} className="bg-muted/40">
                        <div className="text-xs">
                          <div className="font-medium mb-1">Sachkosten-Detail</div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
                            {Object.entries(r.sachkostenDetail!).map(([k, v]) => (
                              <div key={k} className="flex justify-between">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="tabular-nums">{fmtCents(Number(v))} €</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Erfassungs-/Bearbeiten-Dialog */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "BWA-Monat bearbeiten" : "BWA-Monat erfassen"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <FieldText
              label="Gesellschaft"
              value={form.entity}
              suggestions={entities}
              listId="bwa-entities"
              onChange={(v) => setForm((f) => ({ ...f, entity: v }))}
            />
            <FieldText
              label="Kostenstelle"
              value={form.costCenter}
              suggestions={costCenters}
              listId="bwa-cc"
              onChange={(v) => setForm((f) => ({ ...f, costCenter: v }))}
            />
            <div>
              <Label className="text-xs">Monat</Label>
              <Input
                type="month"
                value={form.monthInput}
                onChange={(e) => setForm((f) => ({ ...f, monthInput: e.target.value }))}
              />
            </div>
            <div />
            <FieldEuro
              label="Umsatz"
              value={form.umsatz}
              onChange={(v) => setForm((f) => ({ ...f, umsatz: v }))}
            />
            <FieldEuro
              label="Sonst. betr. Erträge"
              value={form.sonstErtraege}
              onChange={(v) => setForm((f) => ({ ...f, sonstErtraege: v }))}
            />
            <FieldEuro
              label="Getränke"
              value={form.getraenke}
              onChange={(v) => setForm((f) => ({ ...f, getraenke: v }))}
            />
            <FieldEuro
              label="Speisen im Haus"
              value={form.speisenHaus}
              onChange={(v) => setForm((f) => ({ ...f, speisenHaus: v }))}
            />
            <FieldEuro
              label="Speisen außer Haus"
              value={form.speisenAusserHaus}
              onChange={(v) => setForm((f) => ({ ...f, speisenAusserHaus: v }))}
            />
            <FieldEuro
              label="Sonstige Erlöse"
              value={form.sonstigeErloese}
              onChange={(v) => setForm((f) => ({ ...f, sonstigeErloese: v }))}
            />
            <FieldEuro
              label="Wareneinsatz"
              value={form.wareneinsatz}
              onChange={(v) => setForm((f) => ({ ...f, wareneinsatz: v }))}
            />
            <FieldEuro
              label="Personal"
              value={form.personal}
              onChange={(v) => setForm((f) => ({ ...f, personal: v }))}
            />
            <FieldEuro
              label="Sachkosten"
              value={form.sachkosten}
              onChange={(v) => setForm((f) => ({ ...f, sachkosten: v }))}
            />
            <FieldEuro
              label="Anlage"
              value={form.anlage}
              allowNegative
              onChange={(v) => setForm((f) => ({ ...f, anlage: v }))}
            />
            <FieldEuro
              label="Abschreibung"
              value={form.abschreibung}
              allowNegative
              onChange={(v) => setForm((f) => ({ ...f, abschreibung: v }))}
            />
            <FieldEuro
              label="Betriebsergebnis"
              value={form.betriebsergebnis}
              allowNegative
              onChange={(v) => setForm((f) => ({ ...f, betriebsergebnis: v }))}
            />
          </div>

          {derived && (
            <div className="rounded-md border p-3 text-sm bg-muted/30">
              <div className="font-medium mb-2">Abgeleitete Werte</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 tabular-nums">
                <DerivedLine label="Gesamtleistung" cents={derived.gesamtleistungCents} />
                <DerivedLine label="Rohertrag I" cents={derived.rohertrag1Cents} />
                <DerivedLine label="Rohertrag II" cents={derived.rohertrag2Cents} />
                <DerivedLine label="Ergebnis op. Tätigkeit" cents={derived.ergebnisOpCents} />
                <DerivedLine
                  label="Betriebsergebnis (Soll)"
                  cents={derived.betriebsergebnisSollCents}
                />
              </div>
            </div>
          )}

          {validation && !validation.ok && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
              {validation.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              Abbrechen
            </Button>
            <Button disabled={saveDisabled} onClick={() => upsertMut.mutate()}>
              {upsertMut.isPending ? "Speichere…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>BWA-Monat löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Zeile wird endgültig entfernt. Ein Snapshot bleibt im Audit-Log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldEuro({
  label,
  value,
  onChange,
  allowNegative,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowNegative?: boolean;
}) {
  const parsed = parseEuroToCents(value, { emptyAs: 0, allowNegative: !!allowNegative });
  const invalid = value.trim() !== "" && parsed === null;
  return (
    <div>
      <Label className="text-xs">{label} (€)</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={invalid ? "border-destructive" : ""}
        placeholder="0,00"
      />
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  suggestions,
  listId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  listId: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function DerivedLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cents < 0 ? "text-destructive" : ""}>{fmtCents(cents)} €</span>
    </div>
  );
}

// ============================================================================
// F2b — Sachkosten-Drilldown-Karte (Dashboard)
// ============================================================================

function SachkostenDrilldownCard({
  summary,
  totalSachkostenCents,
  periodLabel,
}: {
  summary: ReturnType<typeof sumSachkostenDetail>;
  totalSachkostenCents: number;
  periodLabel: string;
}) {
  const entries = Object.entries(summary.detail).sort((a, b) => b[1] - a[1]);
  const total = summary.coveredSachkostenCents;
  const maxAbs = entries.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0) || 1;
  const hasDetail = entries.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Sachkosten im Detail · {periodLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasDetail ? (
          <p className="text-sm text-muted-foreground">
            Kein Sachkosten-Detail erfasst (kommt automatisch mit dem PDF-Import / Welle F3).
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              {entries.map(([label, cents]) => {
                const neg = cents < 0;
                const pct = total !== 0 ? (cents / total) * 100 : 0;
                const width = (Math.abs(cents) / maxAbs) * 100;
                return (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(9rem,14rem)_1fr_auto_auto] items-center gap-3 text-sm"
                  >
                    <div className="truncate" title={label}>
                      {label}
                    </div>
                    <div className="relative h-3 rounded bg-muted overflow-hidden">
                      <div
                        className={`h-full ${neg ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div
                      className={`tabular-nums text-right w-24 ${neg ? "text-destructive" : ""}`}
                    >
                      {fmtCents(cents)} €
                    </div>
                    <div className="tabular-nums text-right w-16 text-muted-foreground text-xs">
                      {fmtPct(pct)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[minmax(9rem,14rem)_1fr_auto_auto] items-center gap-3 text-sm border-t pt-2 font-medium">
              <div>Summe (erfasstes Detail)</div>
              <div />
              <div className="tabular-nums text-right w-24">{fmtCents(total)} €</div>
              <div className="w-16" />
            </div>
          </>
        )}
        {summary.missingMonths > 0 && (
          <p className="text-xs text-muted-foreground">
            ⓘ {summary.missingMonths} Monat(e) ohne erfasstes Detail — Summe deckt{" "}
            {fmtCents(summary.coveredSachkostenCents)} € von {fmtCents(totalSachkostenCents)} €
            Sachkosten ab.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// F2b — Vergleich-Tab (Standortvergleich, Small Multiples)
// ============================================================================

function BwaVergleichTab({ rows, loading }: { rows: BwaRow[]; loading: boolean }) {
  const entities = useMemo(() => Array.from(new Set(rows.map((r) => r.entity))).sort(), [rows]);
  const [entity, setEntity] = useState<string>("");
  const [monthSel, setMonthSel] = useState<string>("");
  const [sigmaLast12, setSigmaLast12] = useState(false);

  const effEntity = entity || entities[0] || "";
  const entityRows = useMemo(
    () => rows.filter((r) => r.entity === effEntity && r.costCenter !== "Gruppe"),
    [rows, effEntity],
  );
  const monthsDesc = useMemo(
    () => Array.from(new Set(entityRows.map((r) => r.month))).sort((a, b) => b.localeCompare(a)),
    [entityRows],
  );
  const effMonth = monthSel && monthsDesc.includes(monthSel) ? monthSel : (monthsDesc[0] ?? "");
  const selectedMonths = useMemo(
    () => (sigmaLast12 ? monthsDesc.slice(0, 12) : effMonth ? [effMonth] : []),
    [sigmaLast12, monthsDesc, effMonth],
  );
  const cmp = useMemo(
    () => compareCostCenters(entityRows, selectedMonths),
    [entityRows, selectedMonths],
  );

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Noch keine BWA-Daten erfasst.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">Gesellschaft</Label>
          <Select value={effEntity} onValueChange={setEntity}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Monat</Label>
          <Select value={effMonth} onValueChange={setMonthSel} disabled={sigmaLast12}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthsDesc.map((m) => (
                <SelectItem key={m} value={m}>
                  {fmtMonth(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Button
            variant={sigmaLast12 ? "default" : "outline"}
            size="sm"
            onClick={() => setSigmaLast12((v) => !v)}
          >
            Σ letzte 12 Monate
          </Button>
        </div>
      </div>

      {cmp.entries.length < 2 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Für den Vergleich werden mindestens zwei Kostenstellen mit Daten im gewählten Zeitraum
            benötigt.
          </CardContent>
        </Card>
      ) : (
        <>
          <CompareTableImpl cmp={cmp} />
          <SmallMultiplesGrid entityRows={entityRows} monthsDesc={monthsDesc} cmp={cmp} />
        </>
      )}
    </div>
  );
}

function CompareTableImpl({ cmp }: { cmp: ReturnType<typeof compareCostCenters> }) {
  const centers = cmp.entries;
  type Row = {
    label: string;
    values: number[]; // display value in cents or basis points
    quotes?: number[]; // sub-line quotes in %
    markKey?: CompareMetric;
    negativeColorable?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Rohertrag I",
      values: centers.map((c) => c.kpis.rohertrag1Cents),
      quotes: centers.map((c) => c.kpis.rohertrag1Quote),
    },
    {
      label: "Personalkosten",
      // Personal = personalQuote% des Umsatzes; wir zeigen die Quote als Marker.
      values: centers.map((c) => c.kpis.personalQuote),
      markKey: "personalQuote",
    },
    {
      label: "Wareneinsatz",
      values: centers.map((c) => c.kpis.wesQuote),
      markKey: "wesQuote",
    },
    {
      label: "Prime Cost",
      values: centers.map((c) => c.kpis.primeCostQuote),
      markKey: "primeCostQuote",
    },
    {
      label: "Ergebnis operativ",
      values: centers.map((c) => c.kpis.ergebnisOpCents),
      negativeColorable: true,
    },
    {
      label: "Betriebsergebnis-Quote",
      values: centers.map((c) => c.kpis.betriebsQuote),
      markKey: "betriebsQuote",
      negativeColorable: true,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Vergleich Kostenstellen</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kennzahl</TableHead>
              {centers.map((c) => (
                <TableHead key={c.costCenter} className="text-right">
                  {c.costCenter}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label}</TableCell>
                {centers.map((c, i) => {
                  const v = r.values[i];
                  const isQuote = !!r.markKey;
                  const best = r.markKey ? cmp.bestByMetric[r.markKey] : undefined;
                  const worst = r.markKey ? cmp.worstByMetric[r.markKey] : undefined;
                  const isBest = best === c.costCenter;
                  const isWorst = worst === c.costCenter;
                  const bg = isBest ? "bg-emerald-500/10" : isWorst ? "bg-destructive/10" : "";
                  const neg = r.negativeColorable && v < 0;
                  const cls = neg ? "text-destructive" : "";
                  return (
                    <TableCell
                      key={c.costCenter}
                      className={`text-right tabular-nums ${bg} ${cls}`}
                    >
                      {isQuote ? fmtPct(v) : `${fmtCents(v)} €`}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SmallMultiplesGrid({
  entityRows,
  monthsDesc,
  cmp,
}: {
  entityRows: BwaRow[];
  monthsDesc: string[];
  cmp: ReturnType<typeof compareCostCenters>;
}) {
  const last12 = useMemo(() => [...monthsDesc].slice(0, 12).sort(), [monthsDesc]);
  const centers = cmp.entries.map((e) => e.costCenter);

  const seriesByCenter = useMemo(() => {
    const map = new Map<
      string,
      { month: string; label: string; umsatz: number; betrieb: number }[]
    >();
    for (const cc of centers) {
      const arr = last12.map((m) => {
        const r = entityRows.find((row) => row.costCenter === cc && row.month === m);
        return {
          month: m,
          label: fmtMonthShort(m),
          umsatz: (r?.umsatzCents ?? 0) / 100,
          betrieb: (r?.betriebsergebnisCents ?? 0) / 100,
        };
      });
      map.set(cc, arr);
    }
    return map;
  }, [centers, last12, entityRows]);

  // Gemeinsame Y-Domains — kritisch, sonst ist Small Multiples wertlos.
  const { umsatzDomain, betriebDomain } = useMemo(() => {
    let uMin = 0;
    let uMax = 0;
    let bMin = 0;
    let bMax = 0;
    for (const arr of seriesByCenter.values()) {
      for (const p of arr) {
        if (p.umsatz < uMin) uMin = p.umsatz;
        if (p.umsatz > uMax) uMax = p.umsatz;
        if (p.betrieb < bMin) bMin = p.betrieb;
        if (p.betrieb > bMax) bMax = p.betrieb;
      }
    }
    return {
      umsatzDomain: [uMin, uMax || 1] as [number, number],
      betriebDomain: [bMin, bMax || 1] as [number, number],
    };
  }, [seriesByCenter]);

  const compactFmt = (v: number) =>
    new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${centers.length}, minmax(0, 1fr))` }}
    >
      {centers.map((cc) => {
        const data = seriesByCenter.get(cc) ?? [];
        return (
          <Card key={cc}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{cc}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Umsatz (12 M)</div>
                <div style={{ height: 110 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                      <YAxis
                        domain={umsatzDomain}
                        tickFormatter={compactFmt}
                        width={50}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip formatter={(v: number) => `${compactFmt(v)} €`} />
                      <Bar dataKey="umsatz" fill="var(--primary)" opacity={0.8} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Betriebsergebnis (12 M)</div>
                <div style={{ height: 110 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                      <YAxis
                        domain={betriebDomain}
                        tickFormatter={compactFmt}
                        width={50}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip formatter={(v: number) => `${compactFmt(v)} €`} />
                      <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                      <Line
                        type="monotone"
                        dataKey="betrieb"
                        stroke="hsl(142 65% 40%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
