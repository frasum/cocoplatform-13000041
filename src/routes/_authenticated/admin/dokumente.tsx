// V2 Dokumentengenerierung — Template-Verwaltung.
// Admin-only. Listet Templates gruppiert nach doc_type, erlaubt Anlegen/
// Bearbeiten/Deaktivieren. Bewusst KEIN Delete (Design-Entscheidung V1).

import { useMemo, useRef, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createTemplate,
  listTemplates,
  updateTemplate,
  type DocType,
  type DocumentTemplateRow,
} from "@/lib/dokumente/dokumente.functions";
import {
  PLACEHOLDER_CATALOG,
  listPlaceholdersInTemplate,
  placeholderCategory,
} from "@/lib/dokumente/document-placeholders";
import { DEFAULT_TEMPLATE_CONTENT } from "@/lib/dokumente/default-templates";

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

const CATALOG_KEYS = new Set<string>(PLACEHOLDER_CATALOG.map((p) => p.key));

export const Route = createFileRoute("/_authenticated/admin/dokumente")({
  beforeLoad: ({ context }) => {
    const role = (context as { identity?: { role?: string } }).identity?.role;
    if (role !== "admin") throw redirect({ to: "/admin" });
  },
  head: () => ({ meta: [{ title: "Dokumente · Verwaltung" }] }),
  component: DokumenteAdminPage,
});

function DokumenteAdminPage() {
  const templatesQ = useQuery({
    queryKey: ["admin", "document-templates"],
    queryFn: () => listTemplates(),
  });
  const [filter, setFilter] = useState<DocType | "all">("all");
  const [editing, setEditing] = useState<DocumentTemplateRow | "new" | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<DocType, DocumentTemplateRow[]>();
    for (const t of templatesQ.data ?? []) {
      const list = map.get(t.docType) ?? [];
      list.push(t);
      map.set(t.docType, list);
    }
    return map;
  }, [templatesQ.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dokumente</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vorlagen für Arbeitsverträge, Zeugnisse und Bescheinigungen. Platzhalter im Text mit{" "}
            <code>{"{{key}}"}</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Neues Template
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>
        {(["all", ...DOC_TYPE_ORDER] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setFilter(v)}
            className={
              "rounded-full border px-3 py-1 text-xs " +
              (filter === v
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent")
            }
          >
            {v === "all" ? "Alle" : DOC_TYPE_LABEL[v]}
          </button>
        ))}
      </div>

      {templatesQ.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
      {templatesQ.error && (
        <p className="text-sm text-destructive">Templates konnten nicht geladen werden.</p>
      )}

      {templatesQ.data && (
        <div className="space-y-6">
          {DOC_TYPE_ORDER.filter((t) => filter === "all" || filter === t).map((docType) => {
            const items = grouped.get(docType) ?? [];
            return (
              <section key={docType} className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {DOC_TYPE_LABEL[docType]}{" "}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({items.length})
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Noch kein Template.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {items.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.isActive ? (
                              <span className="text-emerald-600">aktiv</span>
                            ) : (
                              <span>inaktiv</span>
                            )}{" "}
                            · geändert{" "}
                            {new Date(t.updatedAt).toLocaleDateString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
                        >
                          Bearbeiten
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <TemplateEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  initial,
  onClose,
}: {
  initial: DocumentTemplateRow | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createTemplate);
  const callUpdate = useServerFn(updateTemplate);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [docType, setDocType] = useState<DocType>(initial?.docType ?? "arbeitsvertrag");
  const [content, setContent] = useState(
    initial?.content ?? DEFAULT_TEMPLATE_CONTENT[initial?.docType ?? "arbeitsvertrag"] ?? "",
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [err, setErr] = useState<string | null>(null);

  const usedKeys = useMemo(() => listPlaceholdersInTemplate(content), [content]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name ist Pflicht.");
      if (!content.trim()) throw new Error("Inhalt ist Pflicht.");
      if (initial) {
        return callUpdate({
          data: { id: initial.id, name: name.trim(), content, isActive },
        });
      }
      return callCreate({ data: { docType, name: name.trim(), content } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "document-templates"] });
      onClose();
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  function insertPlaceholder(key: string) {
    const el = textareaRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setContent((c) => c + token);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-8 w-full max-w-5xl rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">
            {initial ? "Template bearbeiten" : "Neues Template"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Typ</span>
              <select
                value={docType}
                onChange={(e) => {
                  const next = e.target.value as DocType;
                  setDocType(next);
                  // Starter-Text nur bei NEUER Vorlage und leerem Inhaltsfeld.
                  if (!initial && content.trim() === "") {
                    setContent(DEFAULT_TEMPLATE_CONTENT[next] ?? "");
                  }
                }}
                disabled={!!initial}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              >
                {DOC_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {initial && (
                <span className="text-[10px] text-muted-foreground">
                  Typ kann nach dem Anlegen nicht mehr geändert werden.
                </span>
              )}
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Inhalt</span>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={20}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                placeholder={"Sehr geehrte(r) {{anrede}} {{nachname}},\n\n…"}
              />
            </label>

            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Verwendete Platzhalter
              </span>
              {usedKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Platzhalter im Text.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {usedKeys.map((k) => {
                    const known = CATALOG_KEYS.has(k);
                    return (
                      <span
                        key={k}
                        className={
                          "rounded-full border px-2 py-0.5 text-[11px] " +
                          (known
                            ? "border-border text-foreground"
                            : "border-destructive text-destructive")
                        }
                        title={known ? undefined : "unbekannt — wird nie befüllt"}
                      >
                        {`{{${k}}}`}
                        {!known && " ⚠"}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {initial && (
              <label className="flex items-center gap-2 pt-1 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <span>Aktiv (bei Deaktivierung nicht mehr im Assistenten wählbar)</span>
              </label>
            )}

            {err && <p className="text-sm text-destructive">{err}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setErr(null);
                  mutation.mutate();
                }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mutation.isPending ? "Speichern…" : "Speichern"}
              </button>
            </div>
          </div>

          <aside className="rounded-md border border-border bg-background p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Platzhalter
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Klick fügt an Cursor ein.</p>
            <ul className="mt-2 max-h-[60vh] space-y-1 overflow-y-auto">
              {PLACEHOLDER_CATALOG.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => insertPlaceholder(p.key)}
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    title={p.description}
                  >
                    <span className="text-foreground">{p.label}</span>
                    <span className="ml-1 text-muted-foreground">{`{{${p.key}}}`}</span>
                    {placeholderCategory(p) === "vorgang" && (
                      <span className="ml-1 rounded bg-accent px-1 text-[10px] text-muted-foreground">
                        Vorgang
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}
