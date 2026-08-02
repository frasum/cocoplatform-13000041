import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import {
  createLocation,
  deleteLocation,
  geocodeLocation,
  listLocations,
  setLocationActive,
  setLocationCashEnabled,
  updateLocation,
  updateLocationGeo,
} from "@/lib/admin/locations.functions";
import {
  getDisplaySettings,
  regenerateDisplayToken,
  upsertDisplaySettings,
} from "@/lib/display/display.functions";
import { LocationCalendarPanel } from "@/components/admin/LocationCalendarPanel";
import { LocationTipPoolPanel } from "@/components/admin/LocationTipPoolPanel";
import { tabClass } from "@/components/ui/nav-tab";

// ST-Tabs (ein Commit, 17.07.): Standorte-Seite bekommt zweistufige
// Tab-Optik (Standort-Tabs oben, Bereichs-Tabs innerhalb des Standorts) —
// analog zu /admin/einstellungen. Reine UI-Umgruppierung; Server-Fns,
// RLS, Panels bleiben unangetastet.
const SECTION_TABS = [
  { key: "allgemein", label: "Allgemein" },
  { key: "display", label: "Display" },
  { key: "kalender", label: "Kalender & Ruhetage" },
  { key: "trinkgeld", label: "Trinkgeldpool" },
  { key: "geofence", label: "Geofence" },
] as const;
type SectionKey = (typeof SECTION_TABS)[number]["key"];
const SECTION_KEYS = SECTION_TABS.map((t) => t.key) as readonly SectionKey[];
function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
}
type LocSearch = { loc?: string; tab: SectionKey };

export const Route = createFileRoute("/_authenticated/admin/locations")({
  head: () => ({ meta: [{ title: "Standorte · Verwaltung" }] }),
  validateSearch: (search: Record<string, unknown>): { loc?: string; tab: SectionKey } => ({
    loc: typeof search.loc === "string" && search.loc.length > 0 ? search.loc : undefined,
    tab: isSectionKey(search.tab) ? search.tab : "allgemein",
  }),
  component: LocationsPage,
});

type LocationDetails = {
  street: string;
  postal_code: string;
  city: string;
  delivery_notes: string;
  phone: string;
  contact_name: string;
  contact_phone: string;
  /** Soll-Wechselgeldbestand in Euro als Eingabe-String. Leer = Org-Default. */
  cash_balance_target_euro: string;
};

const emptyDetails: LocationDetails = {
  street: "",
  postal_code: "",
  city: "",
  delivery_notes: "",
  phone: "",
  contact_name: "",
  contact_phone: "",
  cash_balance_target_euro: "",
};

function toPayload(d: LocationDetails) {
  const eu = d.cash_balance_target_euro.trim().replace(",", ".");
  let cashBalanceTargetCents: number | null = null;
  if (eu !== "") {
    const n = Number.parseFloat(eu);
    if (Number.isFinite(n) && n >= 0) {
      cashBalanceTargetCents = Math.round(n * 100);
    }
  }
  return {
    street: d.street || null,
    postal_code: d.postal_code || null,
    city: d.city || null,
    delivery_notes: d.delivery_notes || null,
    phone: d.phone || null,
    contact_name: d.contact_name || null,
    contact_phone: d.contact_phone || null,
    cashBalanceTargetCents,
  };
}

function centsToEuroInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (Number(cents) / 100).toFixed(2);
}

function detailsFromLoc(loc: LocationRowData): LocationDetails {
  return {
    street: loc.street ?? "",
    postal_code: loc.postal_code ?? "",
    city: loc.city ?? "",
    delivery_notes: loc.delivery_notes ?? "",
    phone: loc.phone ?? "",
    contact_name: loc.contact_name ?? "",
    contact_phone: loc.contact_phone ?? "",
    cash_balance_target_euro: centsToEuroInput(loc.cashBalanceTargetCents),
  };
}

function LocationsPage() {
  const queryClient = useQueryClient();
  const callCreate = useServerFn(createLocation);
  const callUpdate = useServerFn(updateLocation);
  const callDelete = useServerFn(deleteLocation);
  const callSetActive = useServerFn(setLocationActive);
  const callSetCashEnabled = useServerFn(setLocationCashEnabled);
  const { loc: locParam, tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/locations" });
  const [newName, setNewName] = useState("");
  const [newDetails, setNewDetails] = useState<LocationDetails>(emptyDetails);
  const [msg, setMsg] = useState<string | null>(null);
  // ST1: Bestätigungs-Dialoge (Löschen mit Namens-Eingabe; Deaktivieren/Aktivieren)
  const [confirmDelete, setConfirmDelete] = useState<LocationRowData | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [confirmActive, setConfirmActive] = useState<{
    loc: LocationRowData;
    next: boolean;
  } | null>(null);

  const locationsQ = useQuery({
    // ST1b: Eigener Query-Key, weil diese Seite bewusst auch deaktivierte
    // Standorte lädt (`includeInactive: true`). Der Default-Key
    // `["admin", "locations"]` wird von Auswahl-Oberflächen genutzt und muss
    // gefiltert bleiben — sonst würden inaktive Standorte per Cache-Kollision
    // in Pills/Dropdowns auftauchen (Ursache des TSB-Bugs).
    queryKey: ["admin", "locations", "with-inactive"],
    queryFn: () => listLocations({ data: { includeInactive: true } }),
  });

  // Prefix-Invalidierung: trifft sowohl `["admin","locations","with-inactive"]`
  // (diese Seite) als auch `["admin","locations"]` (alle Auswahl-Oberflächen),
  // damit Aktivieren/Deaktivieren überall sofort greift.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "locations"] });

  const createMut = useMutation({
    mutationFn: () => callCreate({ data: { name: newName, ...toPayload(newDetails) } }),
    onSuccess: async () => {
      setNewName("");
      setNewDetails(emptyDetails);
      setMsg(null);
      await refresh();
      // Nach dem Anlegen zum ersten aktiven Standort springen (der neue
      // ist typischerweise nun der einzige "neue" — wir wählen einfach
      // wieder den Default-Loc-Selector, den der Effekt unten setzt).
      await navigate({
        to: ".",
        search: (p: LocSearch) => ({ ...p, loc: undefined, tab: "allgemein" as const }),
      });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, name, details }: { id: string; name: string; details: LocationDetails }) =>
      callUpdate({ data: { locationId: id, name, ...toPayload(details) } }),
    onSuccess: refresh,
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => callDelete({ data: { locationId: id } }),
    onSuccess: async () => {
      setConfirmDelete(null);
      setDeleteInput("");
      await refresh();
      await navigate({ to: ".", search: (p: LocSearch) => ({ ...p, loc: undefined }) });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });
  const setActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      callSetActive({ data: { locationId: id, isActive } }),
    onSuccess: () => {
      setConfirmActive(null);
      return refresh();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const setCashEnabledMut = useMutation({
    mutationFn: ({ id, cashEnabled }: { id: string; cashEnabled: boolean }) =>
      callSetCashEnabled({ data: { locationId: id, cashEnabled } }),
    onSuccess: refresh,
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const locations = locationsQ.data ?? [];
  // Default-Auswahl: erster aktiver Standort, sonst erster überhaupt.
  const defaultLocId =
    locations.find((l) => l.isActive !== false)?.id ?? locations[0]?.id ?? undefined;
  const activeLocId = locParam === "new" ? "new" : (locParam ?? defaultLocId);
  const activeLoc =
    activeLocId && activeLocId !== "new" ? locations.find((l) => l.id === activeLocId) : undefined;

  // Falls der URL-Loc ungültig (gelöscht/inaktiv nicht existent), auf Default umlenken.
  useEffect(() => {
    if (!locationsQ.data) return;
    if (locParam === "new") return;
    if (locParam && !locations.find((l) => l.id === locParam)) {
      void navigate({ to: ".", search: (p: LocSearch) => ({ ...p, loc: undefined }) });
    }
    // `locations` is derived from `locationsQ.data` on every render; guarding
    // on `locationsQ.data` alone is sufficient here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsQ.data, locParam, navigate]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Standorte</h1>

      {/* Ebene 1: Standort-Tabs */}
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 text-sm">
        {locations.map((l) => {
          const active = activeLocId === l.id;
          const inactive = l.isActive === false;
          return (
            <Link
              key={l.id}
              from={Route.fullPath}
              to="."
              search={(p: LocSearch) => ({ ...p, loc: l.id })}
              className={tabClass(active, inactive ? "opacity-60" : undefined)}
            >
              {l.name}
              {inactive && (
                <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                  deaktiviert
                </span>
              )}
            </Link>
          );
        })}
        <Link
          from={Route.fullPath}
          to="."
          search={(p: LocSearch) => ({ ...p, loc: "new", tab: "allgemein" as const })}
          className="ml-auto inline-flex items-center rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90"
        >
          + Neu
        </Link>
      </nav>

      {msg && <p className="text-sm text-destructive">{msg}</p>}

      {locations.length === 0 && activeLocId !== "new" && (
        <p className="text-sm text-muted-foreground">Noch keine Standorte.</p>
      )}

      {activeLocId === "new" && (
        <form
          className="max-w-2xl space-y-3 rounded-md border border-input bg-muted/30 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            createMut.mutate();
          }}
        >
          <p className="text-sm font-medium text-foreground">Neuen Standort anlegen</p>
          <Field label="Name *">
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Standortname"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </Field>
          <DetailsFields value={newDetails} onChange={setNewDetails} />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Anlegen
            </button>
            <button
              type="button"
              onClick={() => {
                setNewName("");
                setNewDetails(emptyDetails);
                setMsg(null);
                void navigate({ to: ".", search: (p: LocSearch) => ({ ...p, loc: undefined }) });
              }}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {activeLoc && (
        <>
          {/* Ebene 2: Bereichs-Tabs innerhalb des Standorts */}
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 pt-1 text-xs">
            {SECTION_TABS.map((t) => (
              <Link
                key={t.key}
                from={Route.fullPath}
                to="."
                search={(p: LocSearch) => ({ ...p, tab: t.key })}
                className={tabClass(tab === t.key)}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <LocationSectionPanel
            key={activeLoc.id}
            loc={activeLoc}
            section={tab}
            onSave={(name, details) => updateMut.mutate({ id: activeLoc.id, name, details })}
            onDelete={() => {
              setMsg(null);
              setDeleteInput("");
              setConfirmDelete(activeLoc);
            }}
            onToggleActive={(next) => {
              setMsg(null);
              setConfirmActive({ loc: activeLoc, next });
            }}
            onToggleCashEnabled={(next) => {
              setMsg(null);
              setCashEnabledMut.mutate({ id: activeLoc.id, cashEnabled: next });
            }}
            onGeoChanged={refresh}
          />
        </>
      )}

      {/* ST1: Bestätigungs-Dialog „Deaktivieren/Aktivieren" */}
      {confirmActive && (
        <ConfirmDialog
          title={
            confirmActive.next
              ? `„${confirmActive.loc.name}" wieder aktivieren?`
              : `„${confirmActive.loc.name}" deaktivieren?`
          }
          body={
            confirmActive.next
              ? "Der Standort erscheint wieder in allen Auswahl-Listen."
              : "Der Standort verschwindet aus allen Auswahl-Listen des Systems. Daten, Zuordnungen und Historie bleiben erhalten. Reaktivieren jederzeit möglich."
          }
          confirmLabel={confirmActive.next ? "Aktivieren" : "Deaktivieren"}
          destructive={!confirmActive.next}
          busy={setActiveMut.isPending}
          onConfirm={() =>
            setActiveMut.mutate({ id: confirmActive.loc.id, isActive: confirmActive.next })
          }
          onCancel={() => setConfirmActive(null)}
        />
      )}

      {/* ST1: Bestätigungs-Dialog „Löschen" mit Namens-Tipp */}
      {confirmDelete && (
        <ConfirmDialog
          title={`„${confirmDelete.name}" endgültig löschen?`}
          body={
            <>
              <p>
                Löschen ist nur möglich, wenn <strong>keine Mitarbeiter mehr zugeordnet</strong>{" "}
                sind (Server-Regel — Referenz-Prüfung bleibt unverändert die eigentliche Sicherung).
              </p>
              <p className="text-muted-foreground">
                Tipp: Zum Ausblenden reicht <em>Deaktivieren</em> — der Standort verschwindet aus
                allen Auswahl-Listen, alle Daten bleiben erhalten.
              </p>
              <p>
                Zum Bestätigen bitte den Namen tippen:{" "}
                <code className="rounded bg-muted px-1">{confirmDelete.name}</code>
              </p>
              <input
                autoFocus
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={confirmDelete.name}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </>
          }
          confirmLabel="Endgültig löschen"
          destructive
          busy={deleteMut.isPending}
          confirmDisabled={deleteInput.trim() !== confirmDelete.name}
          onConfirm={() => deleteMut.mutate(confirmDelete.id)}
          onCancel={() => {
            setConfirmDelete(null);
            setDeleteInput("");
          }}
        />
      )}
    </div>
  );
}

// ST1: kleiner, wiederverwendbarer Bestätigungs-Dialog
function ConfirmDialog(props: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={props.onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-md border border-input bg-background p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
        <div className="space-y-2 text-sm text-foreground">{props.body}</div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy || props.confirmDisabled}
            className={
              (props.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 "
                : "bg-primary text-primary-foreground hover:bg-primary/90 ") +
              "rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            }
          >
            {props.busy ? "…" : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function DetailsFields({
  value,
  onChange,
}: {
  value: LocationDetails;
  onChange: (next: LocationDetails) => void;
}) {
  const set = <K extends keyof LocationDetails>(key: K, v: string) =>
    onChange({ ...value, [key]: v });
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Telefon (Standort)">
          <input
            value={value.phone}
            onChange={(e) => set("phone", e.target.value)}
            maxLength={40}
            className={inputCls}
          />
        </Field>
        <div />
        <Field label="Kontaktperson · Name">
          <input
            value={value.contact_name}
            onChange={(e) => set("contact_name", e.target.value)}
            maxLength={120}
            className={inputCls}
          />
        </Field>
        <Field label="Kontaktperson · Telefon">
          <input
            value={value.contact_phone}
            onChange={(e) => set("contact_phone", e.target.value)}
            maxLength={40}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="Straße & Hausnummer">
        <input
          value={value.street}
          onChange={(e) => set("street", e.target.value)}
          maxLength={200}
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="PLZ">
          <input
            value={value.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
            maxLength={20}
            className={inputCls}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Ort">
            <input
              value={value.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={120}
              className={inputCls}
            />
          </Field>
        </div>
      </div>
      <Field label="Lieferhinweise">
        <textarea
          value={value.delivery_notes}
          onChange={(e) => set("delivery_notes", e.target.value)}
          maxLength={500}
          rows={2}
          className={inputCls}
        />
      </Field>
      <Field label="Soll-Wechselgeldbestand (€) — leer = Org-Default">
        <input
          value={value.cash_balance_target_euro}
          onChange={(e) => set("cash_balance_target_euro", e.target.value)}
          inputMode="decimal"
          placeholder="2000.00"
          className={inputCls}
        />
      </Field>
    </div>
  );
}

type LocationRowData = {
  id: string;
  name: string;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  delivery_notes: string | null;
  phone: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_m?: number | null;
  geocoded_at?: string | null;
  geocoded_address?: string | null;
  cashBalanceTargetCents?: number | null;
  cashBalanceTargetResolvedCents?: number | null;
  isActive?: boolean;
  cashEnabled?: boolean;
  enabled_service_periods?: string[] | null;
  tip_service_pool_enabled?: boolean;
  kitchen_tip_rate_override?: number | string | null;
  tip_pool_min_hours_override?: number | string | null;
  kitchen_manual_only_override?: boolean | null;
  tip_distribution_mode_override?: string | null;
  tip_distribution_mode_from_override?: string | null;
};

function LocationSectionPanel(props: {
  loc: LocationRowData;
  section: SectionKey;
  onSave: (name: string, details: LocationDetails) => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
  onToggleCashEnabled: (next: boolean) => void;
  onGeoChanged: () => void;
}) {
  const { loc, section } = props;
  const [name, setName] = useState(loc.name);
  const [details, setDetails] = useState<LocationDetails>(() => detailsFromLoc(loc));

  // Wenn der Server-State sich ändert oder der Standort gewechselt wird,
  // lokalen State synchronisieren.
  useEffect(() => {
    setName(loc.name);
    setDetails(detailsFromLoc(loc));
  }, [loc]);

  const dirty =
    name !== loc.name ||
    details.street !== (loc.street ?? "") ||
    details.postal_code !== (loc.postal_code ?? "") ||
    details.city !== (loc.city ?? "") ||
    details.delivery_notes !== (loc.delivery_notes ?? "") ||
    details.phone !== (loc.phone ?? "") ||
    details.contact_name !== (loc.contact_name ?? "") ||
    details.cash_balance_target_euro !== centsToEuroInput(loc.cashBalanceTargetCents) ||
    details.contact_phone !== (loc.contact_phone ?? "");

  const isActive = loc.isActive !== false;
  const cashEnabled = loc.cashEnabled !== false;

  if (section === "allgemein") {
    return (
      <div className="max-w-2xl space-y-3 rounded-md border border-input bg-background p-4">
        <Field label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </Field>
        <DetailsFields value={details} onChange={setDetails} />
        {/* LS1: reine Planungs-Standorte — Dienstplan/Zeit ja, Kasse/Statistik nein. */}
        <label className="flex items-start gap-3 border-t border-input pt-3 text-sm">
          <input
            type="checkbox"
            checked={cashEnabled}
            onChange={(e) => props.onToggleCashEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            <span className="font-medium text-foreground">Kassenbetrieb &amp; Auswertungen</span>
            <span className="block text-xs text-muted-foreground">
              Aus: Standort erscheint nicht in Tagesabrechnung, Saldoliste und Statistik. Dienstplan,
              Zeiterfassung und Lohn bleiben unverändert.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t border-input pt-3">
          <button
            onClick={() => props.onSave(name, details)}
            disabled={!dirty || name.trim() === ""}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Speichern
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => props.onToggleActive(!isActive)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              {isActive ? "Deaktivieren" : "Aktivieren"}
            </button>
            <button
              onClick={() => props.onDelete()}
              className="rounded-md px-3 py-1.5 text-sm text-destructive hover:underline"
            >
              Löschen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (section === "display") {
    return <DisplayPanel locationId={loc.id} />;
  }

  if (section === "kalender") {
    return (
      <LocationCalendarPanel
        locationId={loc.id}
        dayServiceEnabled={(loc.enabled_service_periods ?? []).length > 1}
      />
    );
  }

  if (section === "trinkgeld") {
    return (
      <LocationTipPoolPanel
        locationId={loc.id}
        initial={{
          tipServicePoolEnabled: loc.tip_service_pool_enabled !== false,
          kitchenTipRateOverride:
            loc.kitchen_tip_rate_override == null ? null : Number(loc.kitchen_tip_rate_override),
          tipPoolMinHoursOverride:
            loc.tip_pool_min_hours_override == null
              ? null
              : Number(loc.tip_pool_min_hours_override),
          kitchenManualOnlyOverride:
            loc.kitchen_manual_only_override == null
              ? null
              : Boolean(loc.kitchen_manual_only_override),
          tipDistributionModeOverride:
            loc.tip_distribution_mode_override === "headcount"
              ? "headcount"
              : loc.tip_distribution_mode_override === "hours"
                ? "hours"
                : null,
          tipDistributionModeFromOverride: loc.tip_distribution_mode_from_override ?? null,
        }}
        onSaved={props.onGeoChanged}
      />
    );
  }

  // geofence
  return <GeofencePanel loc={loc} onChanged={props.onGeoChanged} />;
}

function GeofencePanel({ loc, onChanged }: { loc: LocationRowData; onChanged: () => void }) {
  const callGeocode = useServerFn(geocodeLocation);
  const callUpdate = useServerFn(updateLocationGeo);
  const [lat, setLat] = useState<string>(loc.latitude != null ? String(loc.latitude) : "");
  const [lng, setLng] = useState<string>(loc.longitude != null ? String(loc.longitude) : "");
  const [radius, setRadius] = useState<string>(String(loc.geofence_radius_m ?? 100));
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setLat(loc.latitude != null ? String(loc.latitude) : "");
    setLng(loc.longitude != null ? String(loc.longitude) : "");
    setRadius(String(loc.geofence_radius_m ?? 100));
  }, [loc.latitude, loc.longitude, loc.geofence_radius_m]);

  const geocodeMut = useMutation({
    mutationFn: () => callGeocode({ data: { locationId: loc.id } }),
    onSuccess: (r) => {
      setMsg(`Geocodiert: ${r.formattedAddress}`);
      onChanged();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const latN = lat.trim() === "" ? null : Number(lat);
      const lngN = lng.trim() === "" ? null : Number(lng);
      const radN = Number(radius);
      return callUpdate({
        data: {
          locationId: loc.id,
          latitude: latN,
          longitude: lngN,
          geofenceRadiusM: radN,
        },
      });
    },
    onSuccess: () => {
      setMsg("Gespeichert.");
      onChanged();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="mt-3 space-y-3 rounded-md border border-input bg-muted/30 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Geofence</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Breitengrad">
          <input value={lat} onChange={(e) => setLat(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Längengrad">
          <input value={lng} onChange={(e) => setLng(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Radius (m)">
          <input
            type="number"
            min={10}
            max={5000}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => geocodeMut.mutate()}
          disabled={geocodeMut.isPending}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          {geocodeMut.isPending ? "Geocodiere …" : "Aus Adresse geocodieren"}
        </button>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Speichern
        </button>
        {loc.geocoded_at && (
          <span className="text-xs text-muted-foreground">
            Geocodiert: {new Date(loc.geocoded_at).toLocaleString("de-DE")}
            {loc.geocoded_address ? ` — ${loc.geocoded_address}` : ""}
          </span>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

function DisplayPanel({ locationId }: { locationId: string }) {
  const qc = useQueryClient();
  const callGet = useServerFn(getDisplaySettings);
  const callUpsert = useServerFn(upsertDisplaySettings);
  const callRegen = useServerFn(regenerateDisplayToken);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Klartext-Token aus dem letzten Mutation-Response — nur diese Session
  // sichtbar. Nach Reload muss neu erzeugt werden.
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["display-settings", locationId],
    queryFn: () => callGet({ data: { locationId } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["display-settings", locationId] });

  const upsertMut = useMutation({
    mutationFn: (input: {
      isEnabled?: boolean;
      refreshIntervalSeconds?: number;
      rotationEnabled?: boolean;
      rotationIntervalSeconds?: number;
      showAreas?: ("kitchen" | "service" | "gl")[] | null;
      showHeader?: boolean;
      showFooter?: boolean;
      customMessage?: string | null;
    }) => callUpsert({ data: { locationId, ...input } }),
    onSuccess: (res) => {
      setMsg(null);
      if (res?.oneTimeToken) setOneTimeToken(res.oneTimeToken);
      return refresh();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const regenMut = useMutation({
    mutationFn: () => callRegen({ data: { locationId } }),
    onSuccess: (res) => {
      setMsg("Neuer Token generiert. Alte URLs sind ungültig.");
      if (res?.oneTimeToken) setOneTimeToken(res.oneTimeToken);
      return refresh();
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  if (settingsQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Display-Einstellungen werden geladen …</p>;
  }

  const settings = settingsQ.data;

  if (!settings) {
    return (
      <div className="rounded-md border border-input bg-muted/30 p-3 text-sm">
        <p className="mb-2 text-muted-foreground">Noch kein Display für diesen Standort.</p>
        <button
          onClick={() => upsertMut.mutate({ isEnabled: true })}
          disabled={upsertMut.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Display einrichten
        </button>
        {msg && <p className="mt-2 text-destructive">{msg}</p>}
      </div>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const displayUrl = oneTimeToken
    ? `${origin}/display/${settings.location_id}?token=${oneTimeToken}`
    : null;

  const copy = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("Kopieren fehlgeschlagen.");
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-input bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.is_enabled}
            onChange={(e) => upsertMut.mutate({ isEnabled: e.target.checked })}
          />
          <span>Aktiv</span>
        </label>
        <span className="ml-auto text-muted-foreground">
          Refresh:
          <input
            type="number"
            min={15}
            max={3600}
            defaultValue={settings.refresh_interval_seconds}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v !== settings.refresh_interval_seconds) {
                upsertMut.mutate({ refreshIntervalSeconds: v });
              }
            }}
            className="ml-1 w-20 rounded border border-input bg-background px-2 py-1"
          />
          <span className="ml-1">Sek.</span>
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Anzeige-URL</p>
        {displayUrl ? (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={displayUrl}
                className="flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={copy}
                className="rounded border border-input bg-background px-3 py-1 hover:bg-accent"
              >
                {copied ? "Kopiert" : "Kopieren"}
              </button>
              <a
                href={displayUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-input bg-background px-3 py-1 hover:bg-accent"
              >
                Öffnen
              </a>
            </div>
            <div className="pt-2">
              <div className="inline-block rounded bg-white p-2">
                <QRCodeSVG value={displayUrl} size={140} />
              </div>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              Diese URL ist nur jetzt sichtbar. Kopieren oder QR-Code direkt aufs Display — beim
              nächsten Öffnen kann sie nicht mehr angezeigt werden.
            </p>
          </>
        ) : (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Die Anzeige-URL ist aus Sicherheitsgründen nur direkt nach dem Erzeugen sichtbar. Klick
            auf „Token neu generieren", um eine neue URL zu erhalten (das Display muss danach mit
            der neuen URL neu geladen werden).
          </p>
        )}
      </div>

      <DisplayOptions settings={settings} onChange={(input) => upsertMut.mutate(input)} />

      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (confirm("Neuen Token generieren? Die alte URL wird ungültig.")) {
              regenMut.mutate();
            }
          }}
          disabled={regenMut.isPending}
          className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          Token neu generieren
        </button>
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

type DisplayOptionsInput = {
  rotationEnabled?: boolean;
  rotationIntervalSeconds?: number;
  showAreas?: ("kitchen" | "service" | "gl")[] | null;
  showHeader?: boolean;
  showFooter?: boolean;
  customMessage?: string | null;
};

function DisplayOptions({
  settings,
  onChange,
}: {
  settings: {
    rotation_enabled: boolean;
    rotation_interval_seconds: number;
    show_areas: string[] | null;
    show_header: boolean;
    show_footer: boolean;
    custom_message: string | null;
  };
  onChange: (input: DisplayOptionsInput) => void;
}) {
  const allAreas: ("kitchen" | "service" | "gl")[] = ["kitchen", "service", "gl"];
  const labels: Record<string, string> = { kitchen: "Küche", service: "Service", gl: "Sonstige" };
  const current = settings.show_areas ?? allAreas;
  const [msg, setMsg] = useState(settings.custom_message ?? "");

  useEffect(() => {
    setMsg(settings.custom_message ?? "");
  }, [settings.custom_message]);

  const toggleArea = (a: "kitchen" | "service" | "gl") => {
    const next = current.includes(a) ? current.filter((x) => x !== a) : [...current, a];
    const normalized = allAreas.filter((x) => next.includes(x));
    onChange({ showAreas: normalized.length === allAreas.length ? null : normalized });
  };

  return (
    <div className="space-y-3 rounded border border-input bg-background/50 p-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.rotation_enabled}
            onChange={(e) => onChange({ rotationEnabled: e.target.checked })}
          />
          <span>Rotation</span>
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">
          Intervall
          <select
            value={settings.rotation_interval_seconds}
            onChange={(e) => onChange({ rotationIntervalSeconds: Number(e.target.value) })}
            className="rounded border border-input bg-background px-2 py-1"
          >
            <option value={15}>15 s</option>
            <option value={30}>30 s</option>
            <option value={45}>45 s</option>
            <option value={60}>60 s</option>
          </select>
        </label>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Sichtbare Bereiche</p>
        <div className="mt-1 flex flex-wrap gap-3">
          {allAreas.map((a) => (
            <label key={a} className="flex items-center gap-2">
              <input type="checkbox" checked={current.includes(a)} onChange={() => toggleArea(a)} />
              <span>{labels[a]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.show_header}
            onChange={(e) => onChange({ showHeader: e.target.checked })}
          />
          <span>Header anzeigen</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.show_footer}
            onChange={(e) => onChange({ showFooter: e.target.checked })}
          />
          <span>Legende anzeigen</span>
        </label>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Eigene Nachricht</p>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value.slice(0, 280))}
          onBlur={() => {
            const next = msg.trim() === "" ? null : msg;
            if (next !== (settings.custom_message ?? null)) onChange({ customMessage: next });
          }}
          rows={2}
          maxLength={280}
          placeholder="z. B. „Heute Sonderöffnung bis 23 Uhr"
          className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}
