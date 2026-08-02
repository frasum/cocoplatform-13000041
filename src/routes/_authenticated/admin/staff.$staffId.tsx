import { useEffect, useState } from "react";
import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getStaff,
  setStaffActive,
  setStaffParticipatesInPool,
  setStaffPersoNr,
  setStaffRosterPlannable,
  updateStaffBasics,
} from "@/lib/admin/staff.functions";
import { clearPin, setPin } from "@/lib/admin/pin.functions";
import {
  createStaffAccount,
  getStaffAccountStatus,
  inviteStaffByEmail,
  resendStaffInvite,
  resetStaffPassword,
} from "@/lib/admin/account.functions";
import { TabButton } from "@/components/ui/nav-tab";
import { PersonalDetailsTab } from "@/components/admin/PersonalDetailsTab";
import { PermissionsTab } from "@/components/admin/PermissionsTab";
import { SofortmeldungBanner } from "@/components/admin/SofortmeldungBanner";
import { DokumenteTab } from "@/components/admin/DokumenteTab";
import { ChangeRequestsTab } from "@/components/admin/ChangeRequestsTab";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  deletePayslip,
  getPayslipSignedUrl,
  listStaffPayslips,
  uploadPayslip,
  type PayslipEntry,
} from "@/lib/payslips/payslips.functions";

export const Route = createFileRoute("/_authenticated/admin/staff/$staffId")({
  head: () => ({ meta: [{ title: "Mitarbeiter · Verwaltung" }] }),
  validateSearch: (search: Record<string, unknown>): { from?: string } =>
    typeof search.from === "string" ? { from: search.from } : {},
  component: StaffDetailPage,
});

type Tab =
  | "basics"
  | "personal"
  | "pin"
  | "account"
  | "permissions"
  | "dokumente"
  | "antraege"
  | "lohn";

function StaffDetailPage() {
  const { staffId } = Route.useParams();
  const { from } = Route.useSearch();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("basics");
  const { identity } = useRouteContext({ from: "/_authenticated/admin" });
  const showPersonal = identity.role === "admin" || identity.role === "payroll";
  const canEditPersonal = identity.role === "admin";
  const canEditVacation = identity.role === "admin" || identity.role === "payroll";
  const isAdmin = identity.role === "admin";
  const isPayroll = identity.role === "payroll";

  const staffQ = useQuery({
    queryKey: ["admin", "staff", staffId],
    queryFn: () => getStaff({ data: { staffId } }),
  });

  if (staffQ.isLoading) return <p className="text-sm text-muted-foreground">Lade…</p>;
  if (staffQ.error || !staffQ.data)
    return <p className="text-sm text-destructive">Mitarbeiter nicht gefunden.</p>;

  const s = staffQ.data;

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => {
            if (from && from.startsWith("/") && !from.startsWith("//")) {
              router.history.push(from);
            } else {
              router.history.push("/admin/staff");
            }
          }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Zurück
        </button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{s.displayName}</h1>
          <p
            className={`text-sm ${s.isActive ? "text-muted-foreground" : "text-muted-foreground/60"}`}
          >
            {s.isActive ? "aktiv" : "inaktiv"} · Rolle: {s.role ?? "—"}
          </p>
        </div>
        {isAdmin && (
          <ActiveToggleButton staffId={s.id} displayName={s.displayName} isActive={s.isActive} />
        )}
      </div>

      <div
        role="tablist"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border"
      >
        {(
          [
            ["basics", "Stammdaten"],
            ...(showPersonal ? ([["personal", "Personaldaten"]] as [Tab, string][]) : []),
            ...(!isPayroll ? ([["pin", "PIN"]] as [Tab, string][]) : []),
            ...(isAdmin ? ([["account", "Login"]] as [Tab, string][]) : []),
            ...(isAdmin ? ([["permissions", "Rechte"]] as [Tab, string][]) : []),
            ...(isAdmin ? ([["dokumente", "Dokumente"]] as [Tab, string][]) : []),
            ...(isAdmin ? ([["antraege", "Anträge"]] as [Tab, string][]) : []),
            ...(isAdmin ? ([["lohn", "Lohn"]] as [Tab, string][]) : []),
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
            {label}
          </TabButton>
        ))}
      </div>

      {tab === "basics" && (
        <div className="space-y-4">
          {isAdmin && <SofortmeldungBanner staffId={s.id} />}
          <BasicsTab
            staff={s}
            showPool={!isPayroll}
            canEditPersoNr={isAdmin || isPayroll}
            canEditPlannable={isAdmin}
          />
        </div>
      )}
      {tab === "personal" && showPersonal && (
        <PersonalDetailsTab
          staffId={s.id}
          canEdit={canEditPersonal}
          canEditVacation={canEditVacation}
        />
      )}
      {tab === "pin" && !isPayroll && <PinTab staffId={s.id} hasPin={s.hasPin} />}
      {tab === "account" && isAdmin && <AccountTab staffId={s.id} staffEmail={s.email} />}
      {tab === "permissions" && isAdmin && <PermissionsTab staffId={s.id} />}
      {tab === "dokumente" && isAdmin && <DokumenteTab staffId={s.id} staffName={s.displayName} />}
      {tab === "antraege" && isAdmin && <ChangeRequestsTab staffId={s.id} />}
      {tab === "lohn" && isAdmin && <PayslipsTab staffId={s.id} />}
    </div>
  );
}

function BasicsTab({
  staff,
  showPool,
  canEditPersoNr,
  canEditPlannable,
}: {
  staff: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    persoNr: number | null;
    participatesInPool: boolean;
    rosterPlannable: boolean;
  };
  showPool: boolean;
  canEditPersoNr: boolean;
  canEditPlannable: boolean;
}) {
  const queryClient = useQueryClient();
  const callUpdate = useServerFn(updateStaffBasics);
  const callSetPool = useServerFn(setStaffParticipatesInPool);
  const callSetPersoNr = useServerFn(setStaffPersoNr);
  const callSetPlannable = useServerFn(setStaffRosterPlannable);
  const [form, setForm] = useState({
    firstName: staff.firstName,
    lastName: staff.lastName,
    displayName: staff.displayName,
    email: staff.email ?? "",
    phone: staff.phone ?? "",
  });
  const [persoNrInput, setPersoNrInput] = useState<string>(
    staff.persoNr != null ? String(staff.persoNr) : "",
  );
  const [persoNrMsg, setPersoNrMsg] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [poolMsg, setPoolMsg] = useState<string | null>(null);
  const [plannableMsg, setPlannableMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      callUpdate({
        data: {
          staffId: staff.id,
          firstName: form.firstName,
          lastName: form.lastName,
          displayName: form.displayName,
          email: form.email || null,
          phone: form.phone || null,
        },
      }),
    onSuccess: async () => {
      setMsg("Gespeichert.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const poolMutation = useMutation({
    mutationFn: (participates: boolean) =>
      callSetPool({ data: { staffId: staff.id, participates } }),
    onSuccess: async () => {
      setPoolMsg("Gespeichert.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setPoolMsg(e instanceof Error ? e.message : "Fehler."),
  });

  const persoNrMutation = useMutation({
    mutationFn: (persoNr: number | null) =>
      callSetPersoNr({ data: { staffId: staff.id, persoNr } }),
    onSuccess: async () => {
      setPersoNrMsg("Gespeichert.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setPersoNrMsg(e instanceof Error ? e.message : "Fehler."),
  });

  // RS1 — Merkmal „im Dienstplan planbar".
  const plannableMutation = useMutation({
    mutationFn: (plannable: boolean) =>
      callSetPlannable({ data: { staffId: staff.id, plannable } }),
    onSuccess: async () => {
      setPlannableMsg("Gespeichert.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
      await queryClient.invalidateQueries({ queryKey: ["roster"] });
    },
    onError: (e: unknown) => setPlannableMsg(e instanceof Error ? e.message : "Fehler."),
  });

  return (
    <form
      className="max-w-lg space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        mutation.mutate();
      }}
    >
      <TextField
        label="Vorname"
        value={form.firstName}
        onChange={(v) => setForm({ ...form, firstName: v })}
        required
      />
      <TextField
        label="Nachname"
        value={form.lastName}
        onChange={(v) => setForm({ ...form, lastName: v })}
        required
      />
      <TextField
        label="Anzeigename"
        value={form.displayName}
        onChange={(v) => setForm({ ...form, displayName: v })}
        required
      />
      <TextField
        label="E-Mail"
        value={form.email}
        onChange={(v) => setForm({ ...form, email: v })}
        type="email"
      />
      <TextField
        label="Telefon"
        value={form.phone}
        onChange={(v) => setForm({ ...form, phone: v })}
      />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {mutation.isPending ? "Speichern…" : "Speichern"}
      </button>
      {canEditPersoNr && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Personalnummer</span>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={persoNrInput}
                onChange={(e) => {
                  setPersoNrMsg(null);
                  setPersoNrInput(e.target.value.replace(/\D+/g, ""));
                }}
                className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
                placeholder="z.B. 320"
              />
              <button
                type="button"
                disabled={persoNrMutation.isPending}
                onClick={() => {
                  setPersoNrMsg(null);
                  const trimmed = persoNrInput.trim();
                  if (trimmed === "") {
                    persoNrMutation.mutate(null);
                    return;
                  }
                  const n = Number(trimmed);
                  if (!Number.isInteger(n) || n <= 0) {
                    setPersoNrMsg("Bitte eine positive ganze Zahl eingeben.");
                    return;
                  }
                  persoNrMutation.mutate(n);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {persoNrMutation.isPending ? "Speichern…" : "Speichern"}
              </button>
            </div>
          </label>
          <p className="text-xs text-muted-foreground">
            Wird in Wochenplan/Zusammenfassung/Buchhaltung klein hinter dem Rufnamen angezeigt und
            in Exporten ausgewiesen. Leer lassen = keine Personalnummer.
          </p>
          {persoNrMsg && <p className="text-xs text-muted-foreground">{persoNrMsg}</p>}
        </div>
      )}
      {showPool && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={staff.participatesInPool}
              disabled={poolMutation.isPending}
              onChange={(e) => {
                setPoolMsg(null);
                poolMutation.mutate(e.target.checked);
              }}
              className="mt-0.5"
            />
            <span>
              <span className="text-foreground">Am Trinkgeldpool teilnehmen</span>
              <span className="block text-xs text-muted-foreground">
                Deaktivieren schließt diesen Mitarbeiter aus Küchen- und Service-Pool aus.
                Geschäftsleitung ist strukturell ausgeschlossen.
              </span>
            </span>
          </label>
          {poolMsg && <p className="text-xs text-muted-foreground">{poolMsg}</p>}
        </div>
      )}
      {canEditPlannable && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={staff.rosterPlannable}
              disabled={plannableMutation.isPending}
              onChange={(e) => {
                setPlannableMsg(null);
                plannableMutation.mutate(e.target.checked);
              }}
              className="mt-0.5"
            />
            <span>
              <span className="text-foreground">Im Dienstplan planbar</span>
              <span className="block text-xs text-muted-foreground">
                Aus: für Kräfte mit festen Arbeitszeiten — erscheinen nicht in der Planung;
                Zeiterfassung und Lohn laufen normal.
              </span>
            </span>
          </label>
          {plannableMsg && <p className="text-xs text-muted-foreground">{plannableMsg}</p>}
        </div>
      )}
    </form>
  );
}

function ActiveToggleButton({
  staffId,
  displayName,
  isActive,
}: {
  staffId: string;
  displayName: string;
  isActive: boolean;
}) {
  const queryClient = useQueryClient();
  const callSetActive = useServerFn(setStaffActive);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => callSetActive({ data: { staffId, isActive: !isActive } }),
    onSuccess: async () => {
      setErr(null);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setErr(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className={
            isActive
              ? "rounded-md border border-destructive bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground shadow-sm hover:bg-destructive/90"
              : "rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          }
        >
          {isActive ? "Deaktivieren" : "Aktivieren"}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isActive ? `${displayName} deaktivieren?` : `${displayName} aktivieren?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isActive
              ? "Erscheint nicht mehr im Dienstplan und kann sich nicht mehr anmelden. Alle Daten bleiben erhalten; Reaktivierung jederzeit möglich."
              : "Erscheint wieder in aktiven Listen und im Dienstplan; ein bestehendes Login wird wieder nutzbar."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              setErr(null);
              mutation.mutate();
            }}
          >
            {isActive ? "Deaktivieren" : "Aktivieren"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PinTab({ staffId, hasPin }: { staffId: string; hasPin: boolean }) {
  const queryClient = useQueryClient();
  const callSetPin = useServerFn(setPin);
  const callClearPin = useServerFn(clearPin);
  const [pin, setPinVal] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const setMut = useMutation({
    mutationFn: () => callSetPin({ data: { staffId, pin } }),
    onSuccess: async () => {
      setPinVal("");
      setMsg("PIN gesetzt.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff", staffId] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });
  const clearMut = useMutation({
    mutationFn: () => callClearPin({ data: { staffId } }),
    onSuccess: async () => {
      setMsg("PIN entfernt.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff", staffId] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : "Fehler."),
  });

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-muted-foreground">
        Aktueller Status: {hasPin ? "PIN ist gesetzt" : "kein PIN gesetzt"}
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          setMut.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Neuer PIN (6–8 Ziffern)</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="\d{6,8}"
            required
            value={pin}
            onChange={(e) => setPinVal(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={setMut.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            PIN setzen
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                clearMut.mutate();
              }}
              disabled={clearMut.isPending}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              PIN entfernen
            </button>
          )}
        </div>
      </form>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}

function AccountTab({ staffId, staffEmail }: { staffId: string; staffEmail: string | null }) {
  const queryClient = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["admin", "account", staffId],
    queryFn: () => getStaffAccountStatus({ data: { staffId } }),
  });
  const callCreate = useServerFn(createStaffAccount);
  const callReset = useServerFn(resetStaffPassword);
  const callInvite = useServerFn(inviteStaffByEmail);
  const callResend = useServerFn(resendStaffInvite);

  const [email, setEmail] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  // Vorbelegung des E-Mail-Feldes mit der Stammdaten-E-Mail.
  useEffect(() => {
    if (staffEmail && !email) setEmail(staffEmail);
  }, [staffEmail, email]);

  const createMut = useMutation({
    mutationFn: () => callCreate({ data: { staffId, email: email.trim() } }),
    onSuccess: async (res) => {
      setGenerated(res.password);
      setGeneratedEmail(res.email);
      setErr(null);
      setMsg(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "account", staffId] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const resetMut = useMutation({
    mutationFn: () => callReset({ data: { staffId } }),
    onSuccess: async (res) => {
      setGenerated(res.password);
      setGeneratedEmail(statusQ.data?.email ?? null);
      setErr(null);
      setMsg(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "account", staffId] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const inviteMut = useMutation({
    mutationFn: () => callInvite({ data: { staffId, email: email.trim() } }),
    onSuccess: async (res) => {
      setInviteSent(res.email);
      setGenerated(null);
      setGeneratedEmail(null);
      setErr(null);
      setMsg(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "account", staffId] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  const resendMut = useMutation({
    mutationFn: () => callResend({ data: { staffId } }),
    onSuccess: (res) => {
      setInviteSent(res.email);
      setGenerated(null);
      setGeneratedEmail(null);
      setErr(null);
      setMsg(null);
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Fehler."),
  });

  if (statusQ.isLoading) return <p className="text-sm text-muted-foreground">Lade…</p>;
  const status = statusQ.data;

  return (
    <div className="max-w-lg space-y-4">
      {generated && (
        <div className="rounded-md border border-primary bg-primary/5 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Standardpasswort (wird nur EINMAL angezeigt — bitte sofort weitergeben)
          </div>
          {generatedEmail && (
            <div className="mt-1 text-xs text-muted-foreground">
              E-Mail: <span className="text-foreground">{generatedEmail}</span>
            </div>
          )}
          <code className="mt-1 block break-all text-base text-foreground">{generated}</code>
          <p className="mt-2 text-xs text-muted-foreground">
            Der Mitarbeiter muss beim nächsten Login ein eigenes Passwort vergeben.
          </p>
          <button
            type="button"
            onClick={() => {
              setGenerated(null);
              setGeneratedEmail(null);
            }}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Schließen
          </button>
        </div>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {inviteSent && (
        <div className="rounded-md border border-border bg-accent/30 p-3 text-sm text-foreground">
          Einladung an <span className="font-medium">{inviteSent}</span> versendet. Der Mitarbeiter
          setzt sein Passwort über den Link in der E-Mail.
          <button
            type="button"
            onClick={() => setInviteSent(null)}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Schließen
          </button>
        </div>
      )}

      {status?.hasAccount ? (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Login-E-Mail</div>
            <div className="text-sm text-foreground">{status.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Status</div>
            <div className="text-sm text-foreground">
              {status.mustChangePassword
                ? "Standardpasswort gesetzt — Mitarbeiter muss beim nächsten Login wechseln."
                : "Eigenes Passwort gesetzt."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setErr(null);
              resetMut.mutate();
            }}
            disabled={resetMut.isPending}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            {resetMut.isPending ? "Setze zurück…" : "Passwort zurücksetzen"}
          </button>
          <button
            type="button"
            onClick={() => {
              setErr(null);
              resendMut.mutate();
            }}
            disabled={resendMut.isPending}
            className="ml-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {resendMut.isPending ? "Sende…" : "Einladung erneut senden"}
          </button>
        </div>
      ) : (
        <form
          className="space-y-3 rounded-md border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            if (!email.trim()) {
              setErr("Bitte E-Mail eingeben.");
              return;
            }
            createMut.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Dieser Mitarbeiter hat noch kein Konto. Bei Mitarbeitern ohne eigene E-Mail kann eine
            Pseudo-Adresse vergeben werden (z. B. <code>vorname@coco.local</code>).
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Login-E-Mail</span>
            <input
              type="text"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={inviteMut.isPending || createMut.isPending}
              onClick={() => {
                setErr(null);
                const trimmed = email.trim();
                if (!trimmed) {
                  setErr("Bitte E-Mail eingeben.");
                  return;
                }
                // Grober Format-Check — die Server-Fn validiert nochmal streng.
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                  setErr("Für die Einladung wird eine echte E-Mail-Adresse benötigt.");
                  return;
                }
                inviteMut.mutate();
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {inviteMut.isPending ? "Sende…" : "Einladung per E-Mail senden"}
            </button>
            <button
              type="submit"
              disabled={createMut.isPending || inviteMut.isPending}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {createMut.isPending ? "Erstelle…" : "Konto anlegen & Standardpasswort erzeugen"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <input
        type={props.type ?? "text"}
        required={props.required}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function PayslipsTab({ staffId }: { staffId: string }) {
  const queryClient = useQueryClient();
  const callOpen = useServerFn(getPayslipSignedUrl);
  const callUpload = useServerFn(uploadPayslip);
  const callDelete = useServerFn(deletePayslip);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["payslips", "staff", staffId],
    queryFn: () => listStaffPayslips({ data: { staffId } }),
  });

  async function open(entry: PayslipEntry) {
    const win = window.open("about:blank", "_blank", "noopener");
    try {
      const res = await callOpen({ data: { path: entry.path } });
      if (win && !win.closed) win.location.href = res.url;
      else window.location.href = res.url;
    } catch (e) {
      if (win && !win.closed) win.close();
      setMsg(e instanceof Error ? e.message : "Öffnen fehlgeschlagen.");
    }
  }

  async function remove(entry: PayslipEntry) {
    if (!confirm(`Lohnabrechnung „${entry.name}" wirklich löschen?`)) return;
    try {
      await callDelete({ data: { path: entry.path } });
      setMsg("Gelöscht.");
      await queryClient.invalidateQueries({ queryKey: ["payslips", "staff", staffId] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Lesefehler"));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const contentBase64 = dataUrl.split(",")[1] ?? "";
      await callUpload({ data: { staffId, fileName: file.name, contentBase64 } });
      setMsg("Hochgeladen.");
      await queryClient.invalidateQueries({ queryKey: ["payslips", "staff", staffId] });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const items = q.data ?? [];

  return (
    <section className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-medium text-foreground">Lohnabrechnungen</h2>
        <p className="text-xs text-muted-foreground">
          PDF-Upload pro Mitarbeiter. Nur Admins sehen diese Karte.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">PDF hochladen</span>
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={onFile}
          className="block w-full text-sm"
        />
      </label>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Lade…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Fehler beim Laden: {q.error instanceof Error ? q.error.message : "Unbekannter Fehler."}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Lohnabrechnungen hinterlegt.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((it) => (
            <li key={it.path} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{it.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(it.createdAt)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => open(it)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Öffnen
                </button>
                <button
                  type="button"
                  onClick={() => remove(it)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-destructive hover:bg-muted"
                >
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
