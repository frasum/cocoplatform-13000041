import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import {
  getStaffPersonalDetails,
  upsertStaffPersonalDetails,
  type PersonalDetailsDto,
} from "@/lib/admin/personal-details.functions";
import {
  parsePersonalDetailsPatch,
  type PersonalDetailsFields,
} from "@/lib/admin/personal-details.schema";
import { getStaffCompensation, upsertStaffCompensation } from "@/lib/admin/compensation.functions";
import {
  listStaffCompensationRates,
  upsertStaffCompensationRate,
  deleteStaffCompensationRate,
  type CompensationRatesDto,
  type CompensationRateEntry,
} from "@/lib/admin/compensation-rates.functions";
import { isValidFromAllowed, periodStart } from "@/lib/time/valid-from-guard";
import { todayIso } from "@/lib/format";

type Props = { staffId: string; canEdit: boolean; canEditVacation?: boolean };

type FormState = Record<keyof PersonalDetailsFields, string | boolean | null>;

const VACATION_KEYS = [
  "vacation_days_contractual",
  "vacation_days_previous_year",
  "vacation_days_current_year",
  "vacation_days_taken",
] as const;
type VacationKey = (typeof VACATION_KEYS)[number];

const SENSITIVE: ReadonlyArray<keyof PersonalDetailsFields> = [
  "iban",
  "tax_id",
  "social_security_number",
];

function toFormState(d: PersonalDetailsDto): FormState {
  const f: Partial<FormState> = {};
  (Object.keys(d) as Array<keyof PersonalDetailsDto>).forEach((k) => {
    if (k === "exists") return;
    const v = d[k];
    if (typeof v === "boolean" || v === null) {
      (f as Record<string, unknown>)[k] = v;
    } else {
      (f as Record<string, unknown>)[k] = String(v);
    }
  });
  return f as FormState;
}

function toPatch(state: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(state)) {
    if (raw === null || raw === "") {
      out[key] = null;
      continue;
    }
    if (typeof raw === "boolean") {
      out[key] = raw;
      continue;
    }
    // Numerische Felder zurück in number wandeln.
    if (
      key === "child_tax_allowances" ||
      key === "vacation_days_contractual" ||
      key === "vacation_days_previous_year" ||
      key === "vacation_days_current_year" ||
      key === "vacation_days_taken"
    ) {
      const n = Number(raw);
      out[key] = Number.isFinite(n) ? n : null;
      continue;
    }
    out[key] = raw;
  }
  return out;
}

/**
 * Sparse-Patch: liefert nur Felder, die sich gegenüber der Baseline unterschieden
 * haben. Verhindert, dass ein Save der Maske andere (nicht angefasste) Felder
 * versehentlich auf NULL setzt.
 */
function toSparsePatch(state: FormState, baseline: FormState): Record<string, unknown> {
  const full = toPatch(state);
  const base = toPatch(baseline);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(full)) {
    const a = full[key];
    const b = base[key];
    if (a !== b) out[key] = a;
  }
  return out;
}

function mask(val: string | null, key: keyof PersonalDetailsFields): string {
  if (!val) return "—";
  if (key === "iban") {
    const last = val.slice(-4);
    return `•••• •••• •••• ${last}`;
  }
  return "••••••••";
}

function fmt(val: string | boolean | null): string {
  if (val === null || val === "") return "—";
  if (typeof val === "boolean") return val ? "ja" : "nein";
  return val;
}

/** Formatiert ein ISO-Datum (YYYY-MM-DD) als DE-Format (DD.MM.YYYY). */
function fmtDate(val: string | boolean | null): string {
  if (typeof val !== "string" || val === "") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(val);
  if (!m) return val;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Berechnet "X Jahre, Y Monate" zwischen zwei Daten (oder heute). */
function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "";
  const end = endIso ? new Date(endIso) : new Date();
  if (Number.isNaN(end.getTime())) return "";
  if (end < start) return "";
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  if (end.getDate() < start.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const y = years === 1 ? "1 Jahr" : `${years} Jahre`;
  const m = months === 1 ? "1 Monat" : `${months} Monate`;
  if (years === 0) return m;
  if (months === 0) return y;
  return `${y}, ${m}`;
}

export function PersonalDetailsTab({ staffId, canEdit, canEditVacation }: Props) {
  const mayEditVacation = canEditVacation ?? canEdit;
  const queryClient = useQueryClient();
  const fetchFn = useServerFn(getStaffPersonalDetails);
  const saveFn = useServerFn(upsertStaffPersonalDetails);

  const detailsQ = useQuery({
    queryKey: ["admin", "staff", staffId, "personal-details"],
    queryFn: () => fetchFn({ data: { staffId } }),
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [vacEditing, setVacEditing] = useState(false);
  const [vacForm, setVacForm] = useState<Record<VacationKey, string>>({
    vacation_days_contractual: "",
    vacation_days_previous_year: "",
    vacation_days_current_year: "",
    vacation_days_taken: "",
  });
  const [vacMsg, setVacMsg] = useState<string | null>(null);

  useEffect(() => {
    if (detailsQ.data && form === null) {
      setForm(toFormState(detailsQ.data));
    }
  }, [detailsQ.data, form]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Formular nicht geladen");
      const patch = baseline ? toSparsePatch(form, baseline) : toPatch(form);
      if (Object.keys(patch).length === 0) {
        return Promise.resolve({ ok: true as const, noop: true as const });
      }
      // Client-Validierung (Sparse-Patch: nur mitgeschickte Felder prüfen).
      parsePersonalDetailsPatch(patch);
      return saveFn({ data: { staffId, fields: patch } });
    },
    onSuccess: async (res) => {
      const noop = typeof res === "object" && res !== null && "noop" in res && res.noop === true;
      setMsg(noop ? "Keine Änderungen." : "Gespeichert.");
      setEditing(false);
      setBaseline(null);
      await queryClient.invalidateQueries({
        queryKey: ["admin", "staff", staffId, "personal-details"],
      });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler beim Speichern."),
  });

  const vacMutation = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const k of VACATION_KEYS) {
        const raw = vacForm[k].trim();
        if (raw === "") {
          patch[k] = null;
          continue;
        }
        const n = Number(raw.replace(",", "."));
        if (!Number.isFinite(n)) throw new Error(`${k}: Zahl erwartet`);
        patch[k] = n;
      }
      parsePersonalDetailsPatch(patch);
      return saveFn({ data: { staffId, fields: patch } });
    },
    onSuccess: async () => {
      setVacMsg("Gespeichert.");
      setVacEditing(false);
      setForm((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        for (const k of VACATION_KEYS) {
          const raw = vacForm[k].trim();
          next[k] = raw === "" ? null : raw;
        }
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin", "staff", staffId, "personal-details"],
      });
    },
    onError: (e: unknown) => setVacMsg(e instanceof Error ? e.message : "Fehler beim Speichern."),
  });

  const startVacEdit = () => {
    if (!form) return;
    const seed: Record<VacationKey, string> = {
      vacation_days_contractual: "",
      vacation_days_previous_year: "",
      vacation_days_current_year: "",
      vacation_days_taken: "",
    };
    for (const k of VACATION_KEYS) {
      const v = form[k];
      seed[k] = typeof v === "string" ? v : "";
    }
    setVacForm(seed);
    setVacMsg(null);
    setVacEditing(true);
  };

  const sections = useMemo(
    () =>
      [
        {
          title: "Person & Kontakt",
          rows: [
            { key: "salutation", label: "Anrede", type: "text" },
            { key: "date_of_birth", label: "Geburtsdatum", type: "date" },
            { key: "place_of_birth", label: "Geburtsort", type: "text" },
            { key: "nationality", label: "Nationalität", type: "text" },
            { key: "street", label: "Straße", type: "text" },
            { key: "postal_code", label: "PLZ", type: "text" },
            { key: "city", label: "Ort", type: "text" },
          ],
          note: "Telefon und E-Mail werden aus den Stammdaten übernommen.",
        },
        {
          title: "Steuer & Sozialversicherung",
          rows: [
            {
              key: "tax_class",
              label: "Steuerklasse",
              type: "select",
              options: [
                { value: "I", label: "I – ledig" },
                { value: "II", label: "II – alleinerziehend" },
                { value: "III", label: "III – verheiratet (Haupt)" },
                { value: "IV", label: "IV – verheiratet (gleich)" },
                { value: "V", label: "V – verheiratet (Neben)" },
                { value: "VI", label: "VI – Nebenjob" },
              ],
            },
            { key: "tax_id", label: "Steuer-ID", type: "text", sensitive: true },
            {
              key: "social_security_number",
              label: "SV-Nummer",
              type: "text",
              sensitive: true,
            },
            { key: "child_tax_allowances", label: "Kinderfreibeträge", type: "number" },
            { key: "is_minijob", label: "Minijob", type: "bool" },
            { key: "is_sv_exempt", label: "SV-frei", type: "bool" },
            { key: "church_tax_liable", label: "Kirchensteuerpflichtig", type: "bool" },
            { key: "health_insurance", label: "Krankenkasse", type: "text" },
          ],
        },
        {
          title: "Bankverbindung",
          rows: [
            { key: "iban", label: "IBAN", type: "text", sensitive: true },
            { key: "bank_name", label: "Bank", type: "text" },
            { key: "account_holder", label: "Kontoinhaber", type: "text" },
          ],
        },
        {
          title: "Beschäftigung & Urlaub",
          rows: [
            { key: "employment_start_date", label: "Eintritt", type: "date" },
            { key: "employment_end_date", label: "Austritt", type: "date" },
            { key: "personnel_group", label: "Personalgruppe", type: "text" },
            { key: "job_title", label: "Berufsbezeichnung", type: "text" },
            {
              key: "vacation_days_contractual",
              label: "Urlaub vertraglich",
              type: "number",
            },
            {
              key: "vacation_days_previous_year",
              label: "Urlaub Vorjahr",
              type: "number",
            },
            {
              key: "vacation_days_current_year",
              label: "Urlaub lfd. Jahr",
              type: "number",
            },
            { key: "vacation_days_taken", label: "Urlaub genommen", type: "number" },
          ],
        },
      ] as const,
    [],
  );

  if (detailsQ.isLoading) return <p className="text-sm text-muted-foreground">Lade…</p>;
  if (detailsQ.error || !detailsQ.data)
    return <p className="text-sm text-destructive">Personaldaten konnten nicht geladen werden.</p>;

  const data = detailsQ.data;

  return (
    <div className="max-w-2xl space-y-6">
      {!data.exists && !editing && (
        <p className="text-sm text-muted-foreground">Noch keine Personaldaten hinterlegt.</p>
      )}

      {canEdit && !editing && (
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            if (form) setBaseline({ ...form });
            setEditing(true);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {data.exists ? "Bearbeiten" : "Anlegen"}
        </button>
      )}

      {sections.map((sec) => (
        <fieldset key={sec.title} className="space-y-3 rounded-md border border-border p-4">
          <legend className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{sec.title}</span>
            {sec.title === "Beschäftigung & Urlaub" &&
              mayEditVacation &&
              !editing &&
              !vacEditing && (
                <button
                  type="button"
                  onClick={startVacEdit}
                  title="Urlaubswerte bearbeiten"
                  aria-label="Urlaubswerte bearbeiten"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
          </legend>
          <div className="space-y-2">
            {sec.rows.map((row) => {
              const k = row.key as keyof PersonalDetailsFields;
              const isSensitive = SENSITIVE.includes(k);
              const rawVal = form?.[k] ?? null;
              const isVacKey = (VACATION_KEYS as readonly string[]).includes(row.key);
              if (!editing && vacEditing && isVacKey) {
                const vk = row.key as VacationKey;
                return (
                  <label key={row.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={vacForm[vk]}
                      onChange={(e) => setVacForm({ ...vacForm, [vk]: e.target.value })}
                      className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm text-right"
                    />
                  </label>
                );
              }
              if (editing && form) {
                return (
                  <FieldEditor
                    key={row.key}
                    label={row.label}
                    type={row.type}
                    value={rawVal}
                    onChange={(v) => setForm({ ...form, [k]: v })}
                    options={"options" in row ? row.options : undefined}
                  />
                );
              }
              const display =
                isSensitive && !revealed.has(row.key)
                  ? mask(typeof rawVal === "string" ? rawVal : null, k)
                  : row.type === "date"
                    ? fmtDate(rawVal)
                    : fmt(rawVal);
              const durationLine =
                row.key === "employment_start_date" && typeof rawVal === "string" && rawVal
                  ? formatDuration(
                      rawVal,
                      typeof form?.employment_end_date === "string"
                        ? form.employment_end_date
                        : null,
                    )
                  : "";
              return (
                <div key={row.key} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="flex items-center gap-2 text-right text-foreground">
                      <span>{display}</span>
                      {isSensitive && rawVal && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = new Set(revealed);
                            if (next.has(row.key)) next.delete(row.key);
                            else next.add(row.key);
                            setRevealed(next);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {revealed.has(row.key) ? "Verbergen" : "Einblenden"}
                        </button>
                      )}
                    </span>
                  </div>
                  {durationLine && (
                    <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                      <span></span>
                      <span>seit {durationLine}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {sec.title === "Beschäftigung & Urlaub" && !editing && !vacEditing && form && (
              <RestUrlaubRow
                contractual={form.vacation_days_contractual}
                currentYear={form.vacation_days_current_year}
                previousYear={form.vacation_days_previous_year}
                taken={form.vacation_days_taken}
              />
            )}
            {sec.title === "Person & Kontakt" && form && (
              <LegacyAddressPuffer
                address={form.address}
                street={form.street}
                postalCode={form.postal_code}
                city={form.city}
              />
            )}
            {"note" in sec && sec.note && (
              <p className="pt-1 text-xs text-muted-foreground">{sec.note}</p>
            )}
          </div>
          {sec.title === "Beschäftigung & Urlaub" && vacEditing && (
            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => vacMutation.mutate()}
                  disabled={vacMutation.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {vacMutation.isPending ? "Speichern…" : "Speichern"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVacEditing(false);
                    setVacMsg(null);
                  }}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                >
                  Abbrechen
                </button>
              </div>
              {vacMsg && <p className="text-xs text-muted-foreground">{vacMsg}</p>}
            </div>
          )}
        </fieldset>
      ))}

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {editing && form && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? "Speichern…" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setMsg(null);
              setForm(toFormState(data));
              setBaseline(null);
            }}
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Abbrechen
          </button>
        </div>
      )}

      {canEdit && <CompensationSection staffId={staffId} />}

      {canEdit && <CompensationRatesSection staffId={staffId} />}
    </div>
  );
}

function FieldEditor({
  label,
  type,
  value,
  onChange,
  options,
}: {
  label: string;
  type: string;
  value: string | boolean | null;
  onChange: (v: string | boolean | null) => void;
  options?: ReadonlyArray<{ value: string; label: string }>;
}) {
  if (type === "bool") {
    return (
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <select
          value={value === null ? "" : value ? "true" : "false"}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="">—</option>
          <option value="true">ja</option>
          <option value="false">nein</option>
        </select>
      </label>
    );
  }
  if (type === "select" && options) {
    return (
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (type === "textarea") {
    return (
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
      />
    </label>
  );
}

function CompensationSection({ staffId }: { staffId: string }) {
  const queryClient = useQueryClient();
  const fetchFn = useServerFn(getStaffCompensation);
  const saveFn = useServerFn(upsertStaffCompensation);

  const compQ = useQuery({
    queryKey: ["admin", "staff", staffId, "compensation"],
    queryFn: () => fetchFn({ data: { staffId } }),
  });

  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (compQ.data && !editing) {
      setRate(compQ.data.hourlyRate === null ? "" : String(compQ.data.hourlyRate));
      setValidFrom(compQ.data.validFrom ?? "");
    }
  }, [compQ.data, editing]);

  const mutation = useMutation({
    mutationFn: () => {
      const trimmed = rate.trim().replace(",", ".");
      const num = trimmed === "" ? null : Number(trimmed);
      if (num !== null && !Number.isFinite(num)) throw new Error("Stundenlohn muss eine Zahl sein");
      return saveFn({
        data: {
          staffId,
          hourlyRate: num,
          validFrom: validFrom.trim() === "" ? null : validFrom.trim(),
        },
      });
    },
    onSuccess: async () => {
      setMsg("Gespeichert.");
      setEditing(false);
      await queryClient.invalidateQueries({
        queryKey: ["admin", "staff", staffId, "compensation"],
      });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler beim Speichern."),
  });

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Vergütung — Alt-Satz (nur Admin)
      </legend>
      <p className="text-xs text-muted-foreground">
        Alt-Satz — von der Lohnrechnung nicht mehr gelesen. Die Payroll rechnet seit LG3b mit den
        Bereichssätzen unten. Feld bleibt aus historischen Gründen sichtbar; ein Abriss ist als
        späterer Schritt geplant.
      </p>

      {compQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade…</p>
      ) : compQ.error ? (
        <p className="text-sm text-destructive">Stundenlohn konnte nicht geladen werden.</p>
      ) : editing ? (
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Stundenlohn (€/h)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Gültig ab</span>
            <input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Leeres Feld „Stundenlohn" → Eintrag wird gelöscht. „Gültig ab" leer → heute.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? "Speichern…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setMsg(null);
              }}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            >
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Stundenlohn</span>
            <span className="text-foreground">
              {compQ.data?.hourlyRate === null || compQ.data?.hourlyRate === undefined
                ? "—"
                : `${compQ.data.hourlyRate.toFixed(2)} €/h`}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Gültig ab</span>
            <span className="text-foreground">{compQ.data?.validFrom ?? "—"}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setMsg(null);
              setEditing(true);
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {compQ.data?.exists ? "Bearbeiten" : "Anlegen"}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </fieldset>
  );
}

// Berechnete Anzeige „Resturlaub = akt. Jahr + Vorjahr − Genommen" (§54).
// Rechenbasis ist vacation_days_current_year (maßgeblicher, ggf. anteiliger
// Jahresanspruch). vacation_days_contractual ist Referenz-Stammdatum und
// wird nur als Fallback für rein handgepflegte Alt-Fälle herangezogen —
// PaySlip-Importe füllen contractual nicht (§54, an Real-PaySlips verifiziert).
// Rein clientseitig, ohne DB-Änderung.
function RestUrlaubRow({
  contractual,
  currentYear,
  previousYear,
  taken,
}: {
  contractual: string | boolean | null;
  currentYear: string | boolean | null;
  previousYear: string | boolean | null;
  taken: string | boolean | null;
}) {
  const toNum = (v: string | boolean | null): number | null => {
    if (typeof v !== "string" || v.trim() === "") return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const cy = toNum(currentYear);
  const contract = toNum(contractual);
  const p = toNum(previousYear);
  const t = toNum(taken);
  const base = cy ?? contract;
  const fallback = cy === null && contract !== null;
  if (base === null || t === null) {
    return (
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-border/60 pt-2 text-sm">
        <span className="text-muted-foreground">Resturlaub (berechnet)</span>
        <span className="text-muted-foreground italic">
          erst nach Pflege von „Akt. Jahr" (oder „Vertraglich") und „Genommen"
        </span>
      </div>
    );
  }
  const rest = base + (p ?? 0) - t;
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return (
    <div className="mt-1 space-y-0.5 border-t border-dashed border-border/60 pt-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Resturlaub (berechnet)</span>
        <span
          className={`font-medium tabular-nums ${rest < 0 ? "text-destructive" : "text-foreground"}`}
        >
          {fmt(rest)} Tage
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span>{fallback ? "(Basis: Vertragswert)" : ""}</span>
        <span className="tabular-nums">
          {fmt(base)} + {fmt(p ?? 0)} − {fmt(t)}
        </span>
      </div>
    </div>
  );
}

// AV1a Stufe 1 — Freitext-Adresse wird nur noch angezeigt, solange sie
// befüllt ist UND die drei neuen Felder (street/postal_code/city) leer
// sind. Nicht editierbar; Feld bleibt DB-seitig als Migrationspuffer
// bestehen. Sobald ein neues Feld gepflegt wurde, verschwindet die
// Alt-Zeile aus der Anzeige.
function LegacyAddressPuffer({
  address,
  street,
  postalCode,
  city,
}: {
  address: string | boolean | null;
  street: string | boolean | null;
  postalCode: string | boolean | null;
  city: string | boolean | null;
}) {
  const asText = (v: string | boolean | null): string => (typeof v === "string" ? v.trim() : "");
  const addr = asText(address);
  const anyNew = [street, postalCode, city].some((v) => asText(v) !== "");
  if (addr === "" || anyNew) return null;
  return (
    <div className="mt-1 space-y-0.5 border-t border-dashed border-border/60 pt-2 opacity-70">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Adresse (alt)</span>
        <span className="whitespace-pre-line text-right text-foreground">{addr}</span>
      </div>
      <p className="text-xs italic text-muted-foreground">
        Migrationspuffer — bitte in Straße/PLZ/Ort übernehmen.
      </p>
    </div>
  );
}

// LG3a/LG3b — Stundensätze je Arbeitsbereich. Seit LG3b (2a-iii) sind diese
// Sätze lohnwirksam: `entryRowDepartment` löst je Zeiteintrag den Bereich
// auf, `staff_compensation_rates` liefert den zeitpunktgenauen Satz. Der
// Legacy-Skalar `staff_compensation.hourly_rate` wird von der Engine nicht
// mehr gelesen (siehe docs/LG3b-bereichs-saetze.md). Anzeige-Reihenfolge
// fix: gl → kitchen → service, damit sich die Anzeige mit LG2 (Buchhaltung-
// Split) deckt.
const DEPT_ORDER = ["gl", "kitchen", "service"] as const;
const DEPT_LABEL: Record<(typeof DEPT_ORDER)[number], string> = {
  gl: "Geschäftsleitung",
  kitchen: "Küche",
  service: "Service",
};

function CompensationRatesSection({ staffId }: { staffId: string }) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listStaffCompensationRates);
  const saveFn = useServerFn(upsertStaffCompensationRate);
  const deleteFn = useServerFn(deleteStaffCompensationRate);

  const q = useQuery({
    queryKey: ["admin", "staff", staffId, "compensation-rates"],
    queryFn: () => listFn({ data: { staffId } }),
  });

  const [msg, setMsg] = useState<string | null>(null);
  const today = useMemo(() => todayIso(), []);
  const cutoff = useMemo(() => periodStart(today), [today]);

  const saveMut = useMutation({
    mutationFn: async (payload: {
      id: string | null;
      department: (typeof DEPT_ORDER)[number];
      hourlyRate: number;
      validFrom: string | null;
    }) => saveFn({ data: { staffId, ...payload } }),
    onSuccess: async () => {
      setMsg("Gespeichert.");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "staff", staffId, "compensation-rates"],
      });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler beim Speichern."),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id, staffId } }),
    onSuccess: async () => {
      setMsg("Gelöscht.");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "staff", staffId, "compensation-rates"],
      });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler beim Löschen."),
  });

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sätze je Arbeitsbereich (nur Admin)
      </legend>
      <p className="text-xs text-muted-foreground">
        Rückwirkung nur bis Periodenbeginn (<span className="tabular-nums">{cutoff}</span>) erlaubt.
        Ältere Zeilen sind gesperrt. Diese Sätze sind lohnwirksam: die Payroll löst je Zeiteintrag
        den Bereich auf und rechnet mit dem hier gepflegten Satz.
      </p>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade…</p>
      ) : q.error || !q.data ? (
        <p className="text-sm text-destructive">Sätze konnten nicht geladen werden.</p>
      ) : (
        <div className="space-y-3">
          {DEPT_ORDER.map((dept) => (
            <DepartmentRatesRow
              key={dept}
              department={dept}
              entries={q.data.departments[dept]}
              today={today}
              onSave={(payload) => {
                setMsg(null);
                saveMut.mutate({ department: dept, ...payload });
              }}
              onDelete={(id) => {
                setMsg(null);
                deleteMut.mutate(id);
              }}
              pending={saveMut.isPending || deleteMut.isPending}
            />
          ))}
        </div>
      )}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </fieldset>
  );
}

function DepartmentRatesRow({
  department,
  entries,
  today,
  onSave,
  onDelete,
  pending,
}: {
  department: (typeof DEPT_ORDER)[number];
  entries: CompensationRateEntry[];
  today: string;
  onSave: (p: { id: string | null; hourlyRate: number; validFrom: string | null }) => void;
  onDelete: (id: string) => void;
  pending: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [newFrom, setNewFrom] = useState("");

  // Neueste Zeile (max valid_from) als aktueller Satz — Historie hat listServer
  // bereits absteigend sortiert.
  const current = entries[0] ?? null;
  const history = entries.slice(1);

  function submitNew() {
    const trimmed = newRate.trim().replace(",", ".");
    if (trimmed === "") return;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return;
    onSave({
      id: null,
      hourlyRate: num,
      validFrom: newFrom.trim() === "" ? null : newFrom.trim(),
    });
    setAdding(false);
    setNewRate("");
    setNewFrom("");
  }

  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-sm font-medium">{DEPT_LABEL[department]}</div>
        <div className="text-sm tabular-nums">
          {current ? (
            <span>
              {current.hourlyRate.toFixed(2)} €/h{" "}
              <span className="text-xs text-muted-foreground">ab {current.validFrom}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">— kein Satz —</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={pending}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Neuen Satz eintragen
          </button>
        )}
        {current && isValidFromAllowed(current.validFrom, today) && !adding && (
          <button
            type="button"
            onClick={() => onDelete(current.id)}
            disabled={pending}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            Aktuelle Zeile löschen
          </button>
        )}
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {showHistory ? "Historie ausblenden" : `Historie zeigen (${history.length})`}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs">
            <span className="text-muted-foreground">Satz (€/h)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="text-muted-foreground">Gültig ab</span>
            <input
              type="date"
              value={newFrom}
              onChange={(e) => setNewFrom(e.target.value)}
              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={submitNew}
            disabled={pending || newRate.trim() === ""}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Speichern
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewRate("");
              setNewFrom("");
            }}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            Abbrechen
          </button>
          <span className="text-[11px] text-muted-foreground">Leer ⇒ heute.</span>
        </div>
      )}

      {showHistory && history.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {history.map((e) => (
            <li key={e.id} className="flex justify-between tabular-nums">
              <span>ab {e.validFrom}</span>
              <span>{e.hourlyRate.toFixed(2)} €/h</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Silences TS: CompensationRatesDto ist Rückgabetyp von listStaffCompensationRates.
export type _CompensationRatesDtoRef = CompensationRatesDto;
