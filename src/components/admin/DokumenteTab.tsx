// V2 Dokumentengenerierung — Stammblatt-Bereich „Dokumente".
// Assistent: Typ → aktives Template → Vorschau (previewDocument) →
// speichern (saveGeneratedDocument). Unresolved-Platzhalter blocken das
// Speichern, bis explizit „Trotz fehlender Angaben speichern" bestätigt
// wird (V1-Design: sichtbare `{{...}}` sind Fehler, keine leeren Strings).
// Druck läuft ausschließlich client-seitig über ein neues Fenster mit
// isolierter A4-Stylesheet, damit kein globales @media print nötig ist.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getGeneratedDocument,
  listGeneratedDocuments,
  listTemplates,
  previewDocument,
  saveGeneratedDocument,
  type DocType,
  type DocumentPreview,
  type DocumentTemplateRow,
  type GeneratedDocumentFull,
  type GeneratedDocumentRow,
} from "@/lib/dokumente/dokumente.functions";
import { AdminDocumentUpload } from "@/components/admin/AdminDocumentUpload";
import { vorgangPlaceholdersInTemplate } from "@/lib/dokumente/document-placeholders";

const DOC_TYPE_LABEL: Record<DocType, string> = {
  arbeitsvertrag: "Arbeitsvertrag",
  arbeitszeugnis_einfach: "Arbeitszeugnis (einfach)",
  arbeitsbescheinigung: "Arbeitsbescheinigung",
  abmahnung: "Abmahnung",
};
const DOC_TYPE_ORDER: DocType[] = [
  "arbeitsvertrag",
  "arbeitszeugnis_einfach",
  "arbeitsbescheinigung",
  "abmahnung",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printDocument(title: string, content: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><style>
    @page { size: A4; margin: 2.5cm 2cm; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.5; }
    main { white-space: pre-wrap; }
    @media screen {
      body { padding: 2.5cm 2cm; max-width: 21cm; margin: 1rem auto; box-shadow: 0 0 12px rgba(0,0,0,0.15); }
    }
  </style></head><body><main>${escapeHtml(content)}</main></body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 200);
}

export function DokumenteTab({ staffId, staffName }: { staffId: string; staffName: string }) {
  const templatesQ = useQuery({
    queryKey: ["admin", "document-templates"],
    queryFn: () => listTemplates(),
  });
  const listQ = useQuery({
    queryKey: ["admin", "generated-documents", staffId],
    queryFn: () => listGeneratedDocuments({ data: { staffId } }),
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Neues Dokument generieren</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Typ und aktive Vorlage wählen, Vorschau prüfen, dann speichern.
          </p>
        </div>
        {templatesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Lade Vorlagen…</p>
        ) : templatesQ.error ? (
          <p className="text-sm text-destructive">Vorlagen konnten nicht geladen werden.</p>
        ) : (
          <GenerationAssistent
            staffId={staffId}
            staffName={staffName}
            templates={templatesQ.data ?? []}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Unterschriebener Scan</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Vom Mitarbeiter unterschriebenes Dokument als PDF/Bild hochladen. Landet in den
            Personal-Dokumenten (bleibt bis zur Sichtprüfung ohne Sichtvermerk).
          </p>
        </div>
        <AdminDocumentUpload
          staffId={staffId}
          defaultDocType="contract"
          invalidateKeys={[["admin", "documents"]]}
          label="Unterschriebenen Scan hochladen"
        />
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold text-foreground">Generierte Dokumente</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Alle in COCO erstellten Vertragsentwürfe, Zeugnisse und Bescheinigungen.
          </p>
        </div>
        {listQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : listQ.error ? (
          <p className="text-sm text-destructive">Liste konnte nicht geladen werden.</p>
        ) : (
          <GeneratedList items={listQ.data ?? []} />
        )}
      </section>
    </div>
  );
}

function GenerationAssistent({
  staffId,
  staffName,
  templates,
}: {
  staffId: string;
  staffName: string;
  templates: DocumentTemplateRow[];
}) {
  const queryClient = useQueryClient();
  const callPreview = useServerFn(previewDocument);
  const callSave = useServerFn(saveGeneratedDocument);

  const activeTemplates = useMemo(() => templates.filter((t) => t.isActive), [templates]);
  const availableTypes = useMemo(
    () => DOC_TYPE_ORDER.filter((t) => activeTemplates.some((tpl) => tpl.docType === t)),
    [activeTemplates],
  );
  const [docType, setDocType] = useState<DocType | "">(availableTypes[0] ?? "");
  useEffect(() => {
    if (docType === "" && availableTypes.length > 0) setDocType(availableTypes[0]);
  }, [availableTypes, docType]);

  const templatesForType = useMemo(
    () => (docType ? activeTemplates.filter((t) => t.docType === docType) : []),
    [activeTemplates, docType],
  );
  const [templateId, setTemplateId] = useState<string>("");
  useEffect(() => {
    if (templatesForType.length === 0) {
      setTemplateId("");
    } else if (!templatesForType.some((t) => t.id === templateId)) {
      setTemplateId(templatesForType[0].id);
    }
  }, [templatesForType, templateId]);

  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [title, setTitle] = useState("");
  const [forceSave, setForceSave] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // DL2 — vorgangsbezogene Eingaben (generisch, je Katalog-Eintrag).
  const [vorgang, setVorgang] = useState<Record<string, string>>({});
  const selectedTemplate = useMemo(
    () => templatesForType.find((t) => t.id === templateId) ?? null,
    [templatesForType, templateId],
  );
  const vorgangFields = useMemo(
    () => (selectedTemplate ? vorgangPlaceholdersInTemplate(selectedTemplate.content) : []),
    [selectedTemplate],
  );
  const vorgangMissing = useMemo(
    () => vorgangFields.filter((f) => (vorgang[f.key] ?? "").trim() === ""),
    [vorgangFields, vorgang],
  );

  useEffect(() => {
    setPreview(null);
    setForceSave(false);
    setErr(null);
    setMsg(null);
    setVorgang({});
    const tpl = templatesForType.find((t) => t.id === templateId);
    setTitle(tpl ? `${tpl.name} — ${staffName}` : "");
  }, [templateId, templatesForType, staffName]);

  const previewMut = useMutation({
    mutationFn: () => callPreview({ data: { staffId, templateId, vorgang } }),
    onSuccess: (res) => {
      setPreview(res);
      setErr(null);
      setForceSave(false);
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Keine Vorschau vorhanden.");
      if (!title.trim()) throw new Error("Titel ist Pflicht.");
      return callSave({
        data: { staffId, templateId, title: title.trim(), content: preview.text, vorgang },
      });
    },
    onSuccess: async () => {
      setMsg("Gespeichert.");
      setPreview(null);
      setForceSave(false);
      await queryClient.invalidateQueries({
        queryKey: ["admin", "generated-documents", staffId],
      });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  if (availableTypes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Keine aktiven Vorlagen. In Verwaltung › Dokumente anlegen.
      </p>
    );
  }

  const unresolvedCount = preview?.unresolved.length ?? 0;
  const canSave = preview !== null && (unresolvedCount === 0 || forceSave);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Typ</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Vorlage</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {templatesForType.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {vorgangFields.length > 0 && (
        <div className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2">
          {vorgangFields.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                {f.label} <span className="text-destructive">*</span>
              </span>
              <input
                type={f.input === "date" ? "date" : "text"}
                value={vorgang[f.key] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setVorgang((prev) => ({ ...prev, [f.key]: v }));
                  setPreview(null);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <span className="text-[10px] text-muted-foreground">{f.description}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setErr(null);
            setMsg(null);
            previewMut.mutate();
          }}
          disabled={!templateId || vorgangMissing.length > 0 || previewMut.isPending}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          {previewMut.isPending ? "Erzeuge…" : "Vorschau"}
        </button>
        {vorgangMissing.length > 0 && (
          <p className="self-center text-xs text-muted-foreground">
            Pflichtangabe fehlt: {vorgangMissing.map((f) => f.label).join(", ")}
          </p>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {preview && (
        <div className="space-y-3 rounded-md border border-border bg-background p-3">
          {unresolvedCount > 0 && (
            <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">
                {unresolvedCount === 1 ? "1 Platzhalter" : `${unresolvedCount} Platzhalter`} ohne
                Daten:
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {preview.unresolved.map((k) => (
                  <code
                    key={k}
                    className="rounded bg-destructive/20 px-1.5 py-0.5 text-xs"
                  >{`{{${k}}}`}</code>
                ))}
              </div>
              <p className="mt-2 text-xs">
                Ergänze die Stammdaten (Stammdaten/Personaldaten) oder speichere bewusst mit
                sichtbaren <code>{"{{...}}"}</code>-Platzhaltern.
              </p>
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Titel (für die Ablage)
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 font-serif text-sm leading-relaxed text-foreground">
            {preview.text}
          </pre>

          {unresolvedCount > 0 && (
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={forceSave}
                onChange={(e) => setForceSave(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span>Trotz fehlender Angaben speichern</span>
            </label>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canSave || saveMut.isPending}
              onClick={() => {
                setErr(null);
                setMsg(null);
                saveMut.mutate();
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMut.isPending ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GeneratedList({ items }: { items: GeneratedDocumentRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch keine Dokumente.</p>;
  }
  return (
    <>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{it.title}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(it.createdAt).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
                {it.createdByName ? ` · ${it.createdByName}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenId(it.id)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Ansehen
            </button>
          </li>
        ))}
      </ul>
      {openId && <DocumentViewer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function DocumentViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<GeneratedDocumentFull>({
    queryKey: ["admin", "generated-document", id],
    queryFn: () => getGeneratedDocument({ data: { id } }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-8 w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">{q.data?.title ?? "Dokument"}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!q.data}
              onClick={() => q.data && printDocument(q.data.title, q.data.content)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              Drucken
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
        </div>
        {q.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Lade…</p>
        ) : q.error || !q.data ? (
          <p className="mt-4 text-sm text-destructive">Konnte Dokument nicht laden.</p>
        ) : (
          <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-4 font-serif text-sm leading-relaxed text-foreground">
            {q.data.content}
          </pre>
        )}
      </div>
    </div>
  );
}
