// B3c-1b — Manager-/Admin-Kassenübersicht.
//
// Reiner UI-Commit auf den B3b/B3c-1a Server-Functions: alle Reads via
// queryOptions + useQuery, alle Writes via useServerFn + useMutation,
// keine optimistic updates auf Geldfeldern.

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { todayIso } from "@/lib/format";
import { KassePageSkeleton } from "@/components/ui/page-skeletons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listStaff } from "@/lib/admin/staff.functions";
import { listLocations } from "@/lib/admin/locations.functions";
import {
  addSessionSatellite,
  adminCreateWaiterSettlement,
  correctWaiterSettlement,
  finalizeSession,
  getCashOverview,
  getPreviousOperativeDeficit,
  getOrCreateOpenSession,
  getTipPoolOverview,
  listPaymentTerminals,
  listRevenueChannels,
  lockSession,
  removeSessionSatellite,
  setCashLock,
  unlockSession,
  updateSession,
} from "@/lib/cash/cash.functions";
import { buildDailySummaryData } from "@/lib/cash/daily-summary-data";
import { printDailySummary } from "@/components/cash/DailyPrintView";
import { DateSelector } from "@/components/shared/DateSelector";
import { LocationPills } from "@/components/shared/LocationPills";
import { parseEuroToCents } from "@/lib/cash/kasse-helpers";
import { SettlementWarningsBanner } from "@/components/cash/SettlementWarningsBanner";
import type { OpenInvoiceEntry } from "@/lib/cash/open-invoices";
import { sessionHouseCentsFromKasse } from "@/lib/statistics/revenue-core";
import { resolveChannelKind } from "@/lib/cash/session-channels";

// Übersetzt die Roheingabe aus dem Korrektur-/Anlage-Dialog in
// OpenInvoiceEntry[]. Regel (analog Kellner-UI, siehe open-invoices.ts):
// - Zeilen ohne Betrag > 0 werden still verworfen (auch mit Namen).
// - Betrag > 0 ohne Namen wirft — Abgabe blockiert.
// - Ungültiger Eurobetrag wirft.
// Rein clientseitiger Guard; der Server erzwingt dieselbe Regel.
function toOpenInvoiceEntries(rows: Array<{ name: string; amount: string }>): OpenInvoiceEntry[] {
  const entries: OpenInvoiceEntry[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    const amountRaw = r.amount.trim();
    if (amountRaw === "") continue;
    const cents = parseEuroToCents(r.amount);
    if (cents === null || cents < 0) {
      throw new Error("Bitte gültige Eurobeträge für die offenen Rechnungen eintragen.");
    }
    if (cents === 0) continue;
    if (name === "") {
      throw new Error("Bitte für jede offene Rechnung einen Reservierungsnamen eintragen.");
    }
    entries.push({ name, cents });
  }
  return entries;
}

function centsToEuroString(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}
import { SettlementsCard } from "@/components/cash/SettlementsCard";
import { SessionFieldsCard } from "@/components/cash/SessionFieldsCard";
import { TipPoolCard } from "@/components/cash/TipPoolCard";
import { activeSettlements, computeTipTotalCents } from "@/lib/cash/tip-pool";
import { fmtCents } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/kasse")({
  head: () => ({ meta: [{ title: "Tagesabrechnung" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    locationId: typeof search.locationId === "string" ? search.locationId : undefined,
    businessDate: typeof search.businessDate === "string" ? search.businessDate : undefined,
  }),
  component: KassePage,
});

type CorrectState = {
  originalId: string;
  staffName: string;
  partnerStaffId: string;
  posSales: string;
  kassiertBrutto: string;
  cardTotal: string;
  hilfMahl: string;
  openInvoices: Array<{ name: string; amount: string }>;
  cashHandedIn: string;
  reason: string;
};

type CreateState = {
  staffId: string;
  partnerStaffId: string;
  posSales: string;
  kassiertBrutto: string;
  cardTotal: string;
  hilfMahl: string;
  openInvoices: Array<{ name: string; amount: string }>;
  cashHandedIn: string;
  reason: string;
};

function KassePage() {
  const { identity } = Route.useRouteContext();
  const search = Route.useSearch();
  const isAdmin = identity.role === "admin";
  const qc = useQueryClient();

  const [businessDate, setBusinessDate] = useState<string>(search.businessDate ?? todayIso());
  const [locationId, setLocationId] = useState<string>(search.locationId ?? "");

  const fetchOverview = useServerFn(getCashOverview);
  const fetchPrevDeficit = useServerFn(getPreviousOperativeDeficit);
  const fetchChannels = useServerFn(listRevenueChannels);
  const fetchTerminals = useServerFn(listPaymentTerminals);
  const fetchStaff = useServerFn(listStaff);
  const fetchLocations = useServerFn(listLocations);
  const fetchTipPool = useServerFn(getTipPoolOverview);
  const callCreateSession = useServerFn(getOrCreateOpenSession);
  const callUpdate = useServerFn(updateSession);
  const callAddSat = useServerFn(addSessionSatellite);
  const callRemoveSat = useServerFn(removeSessionSatellite);
  const callFinalize = useServerFn(finalizeSession);
  const callLock = useServerFn(lockSession);
  const callUnlock = useServerFn(unlockSession);
  const callCorrect = useServerFn(correctWaiterSettlement);
  const callAdminCreate = useServerFn(adminCreateWaiterSettlement);
  const callCashLock = useServerFn(setCashLock);

  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => fetchLocations(),
  });

  useEffect(() => {
    if (!locationId && locationsQ.data && locationsQ.data.length > 0) {
      setLocationId(locationsQ.data[0].id);
    }
  }, [locationId, locationsQ.data]);

  const ovQ = useQuery({
    queryKey: ["cash", "overview", businessDate, locationId],
    queryFn: () => fetchOverview({ data: { businessDate, locationId } }),
    enabled: locationId !== "",
  });
  const prevDeficitQ = useQuery({
    queryKey: ["cash", "prev-deficit", businessDate, locationId],
    queryFn: () => fetchPrevDeficit({ data: { businessDate, locationId } }),
    enabled: locationId !== "",
  });
  const channelsQ = useQuery({
    queryKey: ["cash", "channels", locationId],
    queryFn: () => fetchChannels({ data: { locationId } }),
    enabled: locationId !== "",
  });
  const terminalsQ = useQuery({
    queryKey: ["cash", "terminals", locationId],
    queryFn: () => fetchTerminals({ data: { locationId } }),
    enabled: locationId !== "",
  });
  const staffQ = useQuery({ queryKey: ["admin-staff"], queryFn: () => fetchStaff() });

  // Trinkgeld-Pool für die Finalize-Zusammenfassung. Gleicher Query-Key
  // wie in TipPoolCard, damit bereits im Cache liegende Daten sofort
  // verfügbar sind (kein Doppel-Request).
  const sessionIdForPool = ovQ.data?.session?.id ?? null;
  const poolQ = useQuery({
    queryKey: ["cash", "tip-pool", sessionIdForPool],
    queryFn: () => fetchTipPool({ data: { sessionId: sessionIdForPool! } }),
    enabled: sessionIdForPool !== null,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cash"] });

  const sessionId = ovQ.data?.session?.id ?? null;
  const sessionStatus = ovQ.data?.session?.status ?? null;
  const lockedThrough = ovQ.data?.cashLockedThroughDate ?? null;
  const underWaterline = lockedThrough !== null && businessDate <= lockedThrough;
  const writable = sessionStatus === "open" && !underWaterline;
  const correctable =
    (sessionStatus === "open" || sessionStatus === "finalized") && !underWaterline;

  const currentLocation = (locationsQ.data ?? []).find((l) => l.id === locationId);
  const cashBalanceTargetResolvedCents = Number(
    currentLocation?.cashBalanceTargetResolvedCents ?? 200_000,
  );
  const previousDeficitCents = prevDeficitQ.data?.deficitCents ?? 0;
  const previousDeficitSourceDate = prevDeficitQ.data?.sourceDate ?? null;

  // -------------------- Session anlegen --------------------
  const createSessionMut = useMutation({
    mutationFn: () => {
      if (!locationId) throw new Error("Bitte einen Standort wählen.");
      return callCreateSession({ data: { businessDate, locationId } });
    },
    onSuccess: () => {
      toast.success("Session geöffnet.");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // -------------------- Korrektur --------------------
  const [correct, setCorrect] = useState<CorrectState | null>(null);
  const correctMut = useMutation({
    mutationFn: () => {
      if (!correct) throw new Error("invalid state");
      if (correct.kassiertBrutto.trim().startsWith("-")) {
        throw new Error("Der abzugebende Betrag darf nicht negativ sein.");
      }
      const pos = parseEuroToCents(correct.posSales);
      // „Abzugebender Betrag" optional: leeres Feld → Fallback auf Leistung (POS).
      const kassiert =
        correct.kassiertBrutto.trim() === "" ? pos : parseEuroToCents(correct.kassiertBrutto);
      const card = parseEuroToCents(correct.cardTotal);
      const hilf = parseEuroToCents(correct.hilfMahl);
      const cash = parseEuroToCents(correct.cashHandedIn);
      const openEntries = toOpenInvoiceEntries(correct.openInvoices);
      const open = openEntries.reduce((s, e) => s + e.cents, 0);
      if (pos === null || kassiert === null || card === null || hilf === null || cash === null) {
        throw new Error("Bitte gültige Eurobeträge eintragen.");
      }
      return callCorrect({
        data: {
          originalId: correct.originalId,
          posSalesCents: pos,
          kassiertBruttoCents: kassiert,
          cardTotalCents: card,
          hilfMahlCents: hilf,
          openInvoicesCents: open,
          openInvoiceEntries: openEntries,
          cashHandedInCents: cash,
          partnerStaffIds: correct.partnerStaffId ? [correct.partnerStaffId] : [],
          reason: correct.reason,
        },
      });
    },
    onSuccess: () => {
      toast.success("Korrektur eingetragen.");
      setCorrect(null);
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // -------------------- Manuelle Neuanlage --------------------
  const [createSettlement, setCreateSettlement] = useState<CreateState | null>(null);
  const eligibleStaff = (staffQ.data ?? []).filter(
    (s) => s.isActive && (locationId === "" || s.locationIds.includes(locationId)),
  );
  const createSettlementMut = useMutation({
    mutationFn: () => {
      if (!createSettlement) throw new Error("invalid state");
      if (!sessionId) throw new Error("Keine Session");
      if (!createSettlement.staffId) throw new Error("Bitte einen Kellner wählen.");
      if (createSettlement.kassiertBrutto.trim().startsWith("-")) {
        throw new Error("Der abzugebende Betrag darf nicht negativ sein.");
      }
      const pos = parseEuroToCents(createSettlement.posSales);
      // „Abzugebender Betrag" optional: leeres Feld → Fallback auf Leistung (POS).
      const kassiert =
        createSettlement.kassiertBrutto.trim() === ""
          ? pos
          : parseEuroToCents(createSettlement.kassiertBrutto);
      const card = parseEuroToCents(createSettlement.cardTotal);
      const hilf = parseEuroToCents(createSettlement.hilfMahl);
      const cash = parseEuroToCents(createSettlement.cashHandedIn);
      const openEntries = toOpenInvoiceEntries(createSettlement.openInvoices);
      const open = openEntries.reduce((s, e) => s + e.cents, 0);
      if (pos === null || kassiert === null || card === null || hilf === null || cash === null) {
        throw new Error("Bitte gültige Eurobeträge eintragen.");
      }
      return callAdminCreate({
        data: {
          sessionId,
          staffId: createSettlement.staffId,
          partnerStaffIds: createSettlement.partnerStaffId ? [createSettlement.partnerStaffId] : [],
          posSalesCents: pos,
          kassiertBruttoCents: kassiert,
          cardTotalCents: card,
          hilfMahlCents: hilf,
          openInvoicesCents: open,
          openInvoiceEntries: openEntries,
          cashHandedInCents: cash,
          reason: createSettlement.reason,
        },
      });
    },
    onSuccess: () => {
      toast.success("Abrechnung angelegt.");
      setCreateSettlement(null);
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // -------------------- Admin-Sicherheitsventile --------------------
  const lockMut = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("Keine Session");
      return callLock({ data: { sessionId } });
    },
    onSuccess: () => {
      toast.success("Session gesperrt.");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [lockConfirm, setLockConfirm] = useState(false);

  // „Session entsperren" (Admin) — setzt eine gesperrte Session zurück
  // auf offen, damit ein irrtümlich gesperrter Tag noch einmal
  // bearbeitet werden kann. Die Standort-Wasserlinie (cash_locks) bleibt
  // bewusst unverändert (monoton) — der Warnhinweis im Dialog macht das
  // transparent, wenn der Tag unter/auf der Wasserlinie liegt.
  const unlockMut = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("Keine Session");
      return callUnlock({ data: { sessionId } });
    },
    onSuccess: () => {
      toast.success("Session entsperrt.");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [unlockConfirm, setUnlockConfirm] = useState(false);

  // KAB2: Ein-Knopf-Druckfluss – „Drucken = Finalisieren".
  const [printBusy, setPrintBusy] = useState(false);
  // KAB2 + FZD: Vor dem Finalisieren erscheint ein Bestätigungs-Dialog mit
  // Zusammenfassung (Gäste, Umsatz, Pool, Stunden je Mitarbeiter). Nur bei
  // Status `open` — Druck-Nachläufe (finalized/locked) laufen ohne Dialog.
  const [finalizeConfirmOpen, setFinalizeConfirmOpen] = useState(false);
  // P2h: Pool-Warnung (TG1) inline im Dialog statt via `window.confirm`.
  // Bleibt gesetzt, solange der Warn-Zustand aktiv ist; ein zweiter Klick
  // auf „Trotzdem finalisieren" sendet `confirmPoolWarning: true`.
  const [finalizeWarnMsg, setFinalizeWarnMsg] = useState<string | null>(null);

  // -------------------- Wasserlinie (Admin) --------------------
  const [cashLockDate, setCashLockDate] = useState<string>("");
  const [cashLockReason, setCashLockReason] = useState<string>("");
  const cashLockMut = useMutation({
    mutationFn: () =>
      callCashLock({ data: { locationId, throughDate: cashLockDate, reason: cashLockReason } }),
    onSuccess: () => {
      toast.success("Wasserlinie verschoben.");
      setCashLockReason("");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // DR1: gemeinsamer Daten-Builder für die HTML-Druckansicht (eine Zahlen-
  // Wahrheit – keine zweite Karten-/Bargeld-Berechnung).
  function buildSummaryDataOrNull() {
    const ov = ovQ.data;
    if (!ov?.session) {
      toast.error("Keine Session für diesen Tag.");
      return null;
    }
    if ((ov.session.guest_count ?? 0) <= 0) {
      toast.error("Bitte zuerst die Gästeanzahl eintragen und speichern.");
      return null;
    }
    // KA1: Kein Rechnen auf leerer Kanal-/Terminal-Map. Bricht bei
    // ungeladenem Katalog ab statt in `resolveChannelKind` zu werfen —
    // der Nutzer bekommt eine klare Meldung.
    if (!channelsQ.data || !terminalsQ.data) {
      toast.error("Kanal-/Terminal-Katalog wird noch geladen — bitte kurz warten.");
      return null;
    }
    return buildDailySummaryData({
      overview: ov,
      channels: channelsQ.data.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
      terminals: terminalsQ.data.map((t) => ({
        id: t.id,
        label: t.label,
        isGl: t.isGl,
      })),
      staffById: new Map((staffQ.data ?? []).map((s) => [s.id, s.displayName])),
      locationName: (locationsQ.data ?? []).find((l) => l.id === locationId)?.name ?? undefined,
      createdByName: identity.displayName ?? null,
      managerOnDutyNames: ov.managerOnDutyNames ?? [],
      cashBalanceTargetCents: cashBalanceTargetResolvedCents,
      previousDeficitCents,
      previousDeficitSourceDate,
      servicePoolEnabled: poolQ.data?.servicePoolEnabled,
      servicePoolCents: poolQ.data?.servicePoolCents,
      tipRemainderCents: (poolQ.data?.kitchenRemainder ?? 0) + (poolQ.data?.serviceRemainder ?? 0),
    });
  }

  function handlePrint() {
    const data = buildSummaryDataOrNull();
    if (!data) return;
    try {
      printDailySummary(data);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // KAB2: EIN Knopf. Bei `open` immer Finalisieren → Druck (→ Admin auto-lock),
  // bei `finalized`/`locked` nur Druck. Strikte Reihenfolge: schlägt Finalize
  // fehl, wird NICHT gedruckt (bestehende Kopplung).
  async function handlePrintClick() {
    if (sessionStatus !== "open") {
      handlePrint();
      return;
    }
    const data = buildSummaryDataOrNull();
    if (!data) return;
    if (!sessionId) {
      toast.error("Keine Session");
      return;
    }
    // FZD: Nicht mehr direkt finalisieren — Bestätigungs-Dialog zuerst.
    setFinalizeConfirmOpen(true);
  }

  // Führt den eigentlichen Finalize-/Druck-/Lock-Flow aus. Wird aus dem
  // Bestätigungs-Dialog aufgerufen. Pool-Warnung (TG1) inline: der Dialog
  // wechselt in den Warn-Zustand, ein zweiter Klick sendet
  // `confirmPoolWarning: true`. Server-API + Audit-Semantik unverändert.
  async function runFinalizeAndPrint(confirmPool: boolean) {
    const data = buildSummaryDataOrNull();
    if (!data) return;
    if (!sessionId) {
      toast.error("Keine Session");
      return;
    }
    setPrintBusy(true);
    try {
      try {
        await callFinalize({
          data: { sessionId, ...(confirmPool ? { confirmPoolWarning: true } : {}) },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // TG1 — Pool > 0 € bei 0 anrechenbaren Stunden: Dialog in Warn-Zustand
        // wechseln, statt einen zweiten (nativen) confirm zu öffnen.
        if (/0 anrechenbare Stunden/.test(msg) && !confirmPool) {
          setFinalizeWarnMsg(msg);
          setPrintBusy(false);
          return;
        }
        throw err;
      }
      setFinalizeConfirmOpen(false);
      setFinalizeWarnMsg(null);
      toast.success("Tag finalisiert.");
      printDailySummary(data);
      if (isAdmin) {
        await callLock({ data: { sessionId } });
        toast.success("Session gesperrt.");
      }
      void invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPrintBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tagesabrechnung</h1>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="loc">Standort</Label>
            <div id="loc" className="flex h-9 items-center">
              <LocationPills
                locations={locationsQ.data ?? []}
                value={locationId}
                onChange={setLocationId}
              />
            </div>
          </div>
          <div className="space-y-1 text-center">
            <Label htmlFor="bd" className="block text-center">
              Geschäftstag
            </Label>
            <DateSelector date={businessDate} onDateChange={setBusinessDate} />
          </div>
          {underWaterline && <Badge variant="destructive">≤ {lockedThrough} gesperrt</Badge>}
        </div>
        {ovQ.data?.session && (
          <div className="ml-auto flex items-end gap-3">
            <SessionStatusInline
              status={sessionStatus}
              lockedAt={(ovQ.data.session as { locked_at?: string | null }).locked_at ?? null}
            />
            {isAdmin && sessionStatus === "finalized" && !underWaterline && (
              <Button
                variant="outline"
                size="sm"
                disabled={lockMut.isPending}
                onClick={() => setLockConfirm(true)}
              >
                Session sperren
              </Button>
            )}
            {isAdmin && sessionStatus === "locked" && (
              <Button
                variant="outline"
                size="sm"
                disabled={unlockMut.isPending}
                onClick={() => setUnlockConfirm(true)}
              >
                Session entsperren
              </Button>
            )}
            <Button
              onClick={() => void handlePrintClick()}
              disabled={printBusy}
              className="gap-2"
              data-testid="finalize-print-button"
              title={
                (ovQ.data.session.guest_count ?? 0) <= 0
                  ? "Gästeanzahl fehlt – bitte zuerst eintragen und speichern"
                  : sessionStatus === "open"
                    ? "Finalisiert den Tag und öffnet den Druckdialog"
                    : "Öffnet den System-Druckdialog"
              }
            >
              <Printer className="h-4 w-4" />
              {printBusy ? "Wird ausgeführt…" : "Tagesabrechnung drucken"}
            </Button>
          </div>
        )}
      </div>

      {ovQ.isLoading && <KassePageSkeleton />}

      {!ovQ.isLoading && !ovQ.data?.session && (
        <Card className="space-y-3 p-6">
          <div className="text-sm">
            Für <strong>{businessDate}</strong> existiert noch keine Session.
          </div>
          <Button disabled={createSessionMut.isPending} onClick={() => createSessionMut.mutate()}>
            {createSessionMut.isPending ? "Wird angelegt…" : "Session anlegen"}
          </Button>
        </Card>
      )}

      {ovQ.data?.session && (
        <>
          <SettlementWarningsBanner
            overview={ovQ.data}
            channels={channelsQ.data ?? []}
            terminals={terminalsQ.data ?? []}
          />

          <SettlementsCard
            data={ovQ.data}
            correctable={correctable}
            onCreate={() =>
              setCreateSettlement({
                staffId:
                  (staffQ.data ?? []).find((s) => s.isActive && s.locationIds.includes(locationId))
                    ?.id ?? "",
                partnerStaffId: "",
                posSales: "0.00",
                kassiertBrutto: "0.00",
                cardTotal: "0.00",
                hilfMahl: "0.00",
                openInvoices: [],
                cashHandedIn: "0.00",
                reason: "",
              })
            }
            onCorrect={(row) =>
              setCorrect({
                originalId: row.id,
                staffName: row.staffName,
                partnerStaffId:
                  ((row as { partnerStaffIds?: string[] }).partnerStaffIds ?? [])[0] ??
                  row.partner_staff_id ??
                  "",
                posSales: (Number(row.pos_sales_cents) / 100).toFixed(2),
                kassiertBrutto: (
                  Number(
                    (row as { kassiert_brutto_cents?: number | string | null })
                      .kassiert_brutto_cents ?? row.pos_sales_cents,
                  ) / 100
                ).toFixed(2),
                cardTotal: (Number(row.card_total_cents) / 100).toFixed(2),
                hilfMahl: (Number(row.hilf_mahl_cents) / 100).toFixed(2),
                openInvoices: (
                  (row as { openInvoiceEntries?: Array<{ name: string; cents: number }> })
                    .openInvoiceEntries ?? []
                ).map((e) => ({
                  name: e.name,
                  amount: centsToEuroString(e.cents),
                })),
                cashHandedIn: (Number(row.cash_handed_in_cents) / 100).toFixed(2),
                reason: "",
              })
            }
          />

          <SessionFieldsCard
            sessionId={sessionId!}
            overview={ovQ.data}
            channels={channelsQ.data ?? []}
            terminals={terminalsQ.data ?? []}
            writable={writable}
            cashBalanceTargetCents={cashBalanceTargetResolvedCents}
            locationName={currentLocation?.name}
            tipRemainderCents={
              (poolQ.data?.kitchenRemainder ?? 0) + (poolQ.data?.serviceRemainder ?? 0)
            }
            kpiSlot={(() => {
              const sess = ovQ.data.session;
              if (!sess) return null;
              const vectronTotal = Number(sess.vectron_daily_total_cents ?? 0);
              // KA1: Map aus dem ungefilterten Kanalbestand (inkl. inaktiver);
              // Lookup-Miss wirft in `resolveChannelKind` mit Kanal-ID.
              const channelKindById = new Map(
                (channelsQ.data ?? []).map((c) => [c.id, c.kind] as const),
              );
              // N14b: gemeinsame Haus-Umsatz-Definition (Kasse-Modell) —
              // dieselbe Größe wie Inline (SessionFieldsCard), PDF und Druck.
              const inHouseCents = sessionHouseCentsFromKasse({
                vectronCents: vectronTotal,
                channels: (ovQ.data.channelAmounts ?? []).map((c) => ({
                  kind: resolveChannelKind(channelKindById, c.channelId),
                  amountCents: c.amountCents,
                })),
              });
              // Quote = nur aktive Abrechnungen; Liste zeigt superseded bewusst weiter.
              const tipCents = computeTipTotalCents(
                activeSettlements(ovQ.data.settlements).map((s) => ({
                  cardTotalCents: Number(s.card_total_cents),
                  cashHandedInCents: Number(s.cash_handed_in_cents),
                  posSalesCents: Number(s.pos_sales_cents),
                  kassiertBruttoCents: Number(
                    (s as { kassiert_brutto_cents?: number | string | null })
                      .kassiert_brutto_cents ?? s.pos_sales_cents,
                  ),
                  openInvoicesCents: Number(s.open_invoices_cents),
                  hilfMahlCents: Number(s.hilf_mahl_cents),
                })),
              );
              const tipPct =
                inHouseCents > 0
                  ? ((tipCents / inHouseCents) * 100).toFixed(1).replace(".", ",")
                  : null;
              const guests = sess.guest_count ?? 0;
              const perGuestCents =
                guests > 0 && inHouseCents > 0 ? Math.round(inHouseCents / guests) : null;
              return (
                <div className="space-y-3">
                  <Card className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Trinkgeld-Quote
                    </div>
                    <div className="mt-1 font-mono text-2xl font-semibold">
                      {tipPct == null ? "–" : `${tipPct} %`}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Pool {fmtCents(tipCents)} / In-House-Umsatz {fmtCents(inHouseCents)}
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Ø Umsatz / Gast
                    </div>
                    <div className="mt-1 font-mono text-2xl font-semibold">
                      {perGuestCents == null ? "–" : fmtCents(perGuestCents)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {guests > 0 ? `${guests} Gäste` : "Gästeanzahl fehlt"}
                    </div>
                  </Card>
                </div>
              );
            })()}
            onSave={(data) =>
              callUpdate({ data: { sessionId: sessionId!, ...data } }).then(() => {
                // KAB1: Kein Toast – Feedback zeigt der Auto-Save-Status im Card-Footer.
                void invalidate();
              })
            }
            expenses={ovQ.data?.expenses ?? []}
            advances={ovQ.data?.advances ?? []}
            staff={staffQ.data ?? []}
            onAddExpense={(desc, cents) =>
              callAddSat({
                data: {
                  sessionId: sessionId!,
                  kind: "expense",
                  description: desc,
                  amountCents: cents,
                },
              }).then(() => {
                toast.success("Ausgabe hinzugefügt.");
                void invalidate();
              })
            }
            onRemoveExpense={(id) =>
              callRemoveSat({ data: { sessionId: sessionId!, kind: "expense", id } }).then(() => {
                toast.success("Entfernt.");
                void invalidate();
              })
            }
            onAddAdvance={(staffId, cents, note) =>
              callAddSat({
                data: {
                  sessionId: sessionId!,
                  kind: "advance",
                  staffId,
                  amountCents: cents,
                  note,
                },
              }).then(() => {
                toast.success("Vorschuss hinzugefügt.");
                void invalidate();
              })
            }
            onRemoveAdvance={(id) =>
              callRemoveSat({ data: { sessionId: sessionId!, kind: "advance", id } }).then(() => {
                toast.success("Entfernt.");
                void invalidate();
              })
            }
            previousDeficitCents={previousDeficitCents}
            previousDeficitSourceDate={previousDeficitSourceDate}
          />

          <TipPoolCard
            sessionId={sessionId!}
            locationId={locationId}
            hasSettlements={ovQ.data.settlements.length > 0}
            editable={correctable}
            staffList={staffQ.data ?? []}
          />
        </>
      )}

      {isAdmin && (
        <Card className="space-y-3 p-4">
          <div className="font-medium">Kasse-Wasserlinie verschieben (nur Admin)</div>
          <p className="text-sm text-muted-foreground">
            Alle Geschäftstage ≤ dem gewählten Datum werden für Kassen-Schreibzugriffe gesperrt. Nur
            vorwärts. Aktueller Stand: {lockedThrough ?? "keine Sperre"}.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="cl">Gesperrt bis (inklusive)</Label>
              <Input
                id="cl"
                type="date"
                min={lockedThrough ?? undefined}
                value={cashLockDate}
                onChange={(e) => setCashLockDate(e.target.value)}
              />
            </div>
            <div className="min-w-[16rem] flex-1 space-y-1">
              <Label htmlFor="clr">Begründung *</Label>
              <Input
                id="clr"
                placeholder="z. B. Monatsabschluss Mai"
                value={cashLockReason}
                onChange={(e) => setCashLockReason(e.target.value)}
              />
            </div>
            <Button
              disabled={
                cashLockDate === "" || cashLockReason.trim().length < 3 || cashLockMut.isPending
              }
              onClick={() => cashLockMut.mutate()}
            >
              {cashLockMut.isPending ? "Wird gespeichert…" : "Wasserlinie setzen"}
            </Button>
          </div>
        </Card>
      )}

      {/* --- Korrektur-Dialog --- */}
      <Dialog open={correct !== null} onOpenChange={(o) => !o && setCorrect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrechnung korrigieren</DialogTitle>
            <DialogDescription>
              {correct?.staffName}. Erzeugt eine neue Settlement-Zeile; das Original wird als
              <code className="mx-1 rounded bg-muted px-1">superseded</code>
              markiert. Trinkgeldsatz wird vom Original übernommen.
            </DialogDescription>
          </DialogHeader>
          {correct && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Partner-Kellner (optional)</Label>
                <Select
                  value={correct.partnerStaffId || "none"}
                  onValueChange={(v) =>
                    setCorrect({ ...correct, partnerStaffId: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kein Partner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Kein Partner —</SelectItem>
                    {eligibleStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(
                [
                  ["posSales", "Leistung (POS)"],
                  ["kassiertBrutto", "Abzugebender Betrag"],
                  ["cardTotal", "EC-/Kartensumme"],
                  ["hilfMahl", "Hilfsmahlzeiten"],
                  ["cashHandedIn", "Abgegebenes Bargeld"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label>{label} (€)</Label>
                  <Input
                    inputMode="decimal"
                    value={correct[key]}
                    placeholder={key === "kassiertBrutto" ? "wie Leistung (POS)" : "0,00"}
                    onChange={(e) => setCorrect({ ...correct, [key]: e.target.value })}
                    aria-invalid={
                      key === "kassiertBrutto" && correct.kassiertBrutto.trim().startsWith("-")
                    }
                  />
                  {key === "kassiertBrutto" && correct.kassiertBrutto.trim().startsWith("-") ? (
                    <p className="text-xs text-destructive">
                      Der abzugebende Betrag darf nicht negativ sein.
                    </p>
                  ) : key === "kassiertBrutto" ? (
                    <p className="text-xs text-muted-foreground">
                      Leer lassen, wenn identisch mit Leistung (POS).
                    </p>
                  ) : null}
                </div>
              ))}
              <OpenInvoicesEditor
                rows={correct.openInvoices}
                onChange={(next) => setCorrect({ ...correct, openInvoices: next })}
              />
              <div className="space-y-1">
                <Label>Begründung *</Label>
                <Input
                  placeholder="z. B. Kellner hat sich um eine Stelle vertippt"
                  value={correct.reason}
                  onChange={(e) => setCorrect({ ...correct, reason: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrect(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={
                !correct ||
                correct.reason.trim().length < 3 ||
                correct.kassiertBrutto.trim().startsWith("-") ||
                correctMut.isPending
              }
              onClick={() => correctMut.mutate()}
            >
              {correctMut.isPending ? "Speichert…" : "Korrektur speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Manuelle Neuanlage-Dialog --- */}
      <Dialog
        open={createSettlement !== null}
        onOpenChange={(o) => !o && setCreateSettlement(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrechnung manuell anlegen</DialogTitle>
            <DialogDescription>
              Erfasst eine neue Kellner-Abrechnung als Admin. Kein automatisches Ausstempeln.
              Trinkgeldsatz wird aus den aktuellen Org-Einstellungen übernommen.
            </DialogDescription>
          </DialogHeader>
          {createSettlement && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Kellner *</Label>
                <Select
                  value={createSettlement.staffId}
                  onValueChange={(v) => setCreateSettlement({ ...createSettlement, staffId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kellner wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleStaff.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Keine passenden Mitarbeiter.
                      </div>
                    )}
                    {eligibleStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Partner-Kellner (optional)</Label>
                <Select
                  value={createSettlement.partnerStaffId || "none"}
                  onValueChange={(v) =>
                    setCreateSettlement({
                      ...createSettlement,
                      partnerStaffId: v === "none" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kein Partner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Kein Partner —</SelectItem>
                    {eligibleStaff
                      .filter((s) => s.id !== createSettlement.staffId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.displayName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {(
                [
                  ["posSales", "Leistung (POS)"],
                  ["kassiertBrutto", "Abzugebender Betrag"],
                  ["cardTotal", "EC-/Kartensumme"],
                  ["hilfMahl", "Hilfsmahlzeiten"],
                  ["cashHandedIn", "Abgegebenes Bargeld"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label>{label} (€)</Label>
                  <Input
                    inputMode="decimal"
                    value={createSettlement[key]}
                    placeholder={key === "kassiertBrutto" ? "wie Leistung (POS)" : "0,00"}
                    onChange={(e) =>
                      setCreateSettlement({ ...createSettlement, [key]: e.target.value })
                    }
                    aria-invalid={
                      key === "kassiertBrutto" &&
                      createSettlement.kassiertBrutto.trim().startsWith("-")
                    }
                  />
                  {key === "kassiertBrutto" &&
                  createSettlement.kassiertBrutto.trim().startsWith("-") ? (
                    <p className="text-xs text-destructive">
                      Der abzugebende Betrag darf nicht negativ sein.
                    </p>
                  ) : key === "kassiertBrutto" ? (
                    <p className="text-xs text-muted-foreground">
                      Leer lassen, wenn identisch mit Leistung (POS).
                    </p>
                  ) : null}
                </div>
              ))}
              <OpenInvoicesEditor
                rows={createSettlement.openInvoices}
                onChange={(next) =>
                  setCreateSettlement({ ...createSettlement, openInvoices: next })
                }
              />
              <div className="space-y-1">
                <Label>Begründung *</Label>
                <Input
                  placeholder="z. B. Nacherfassung — Kellner war krank"
                  value={createSettlement.reason}
                  onChange={(e) =>
                    setCreateSettlement({ ...createSettlement, reason: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSettlement(null)}>
              Abbrechen
            </Button>
            <Button
              disabled={
                !createSettlement ||
                !createSettlement.staffId ||
                createSettlement.reason.trim().length < 3 ||
                createSettlement.kassiertBrutto.trim().startsWith("-") ||
                createSettlementMut.isPending
              }
              onClick={() => createSettlementMut.mutate()}
            >
              {createSettlementMut.isPending ? "Speichert…" : "Abrechnung anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Sperr-/Entsperr-Dialoge (Admin) --- */}
      <Dialog open={lockConfirm} onOpenChange={setLockConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session sperren?</DialogTitle>
            <DialogDescription>
              Unumkehrbar. Korrekturen für diesen Geschäftstag sind danach nicht mehr möglich.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockConfirm(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={lockMut.isPending}
              onClick={() => lockMut.mutate(undefined, { onSuccess: () => setLockConfirm(false) })}
            >
              Sperren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unlockConfirm} onOpenChange={setUnlockConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session entsperren?</DialogTitle>
            <DialogDescription>
              Hebt die harte Sperre auf und setzt den Status zurück auf „offen", damit Korrekturen
              und Kellner-Abrechnungen für diesen Geschäftstag wieder möglich sind.
              {underWaterline && (
                <>
                  {" "}
                  <strong>Achtung:</strong> Dieser Geschäftstag liegt unter der Standort-Wasserlinie
                  ({lockedThrough}). Der Session-Status wird zwar geändert, Schreibversuche werden
                  aber weiter von der Wasserlinie geblockt, bis du diese getrennt zurückfährst.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockConfirm(false)}>
              Abbrechen
            </Button>
            <Button
              disabled={unlockMut.isPending}
              onClick={() =>
                unlockMut.mutate(undefined, { onSuccess: () => setUnlockConfirm(false) })
              }
            >
              Entsperren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FinalizeConfirmDialog
        open={finalizeConfirmOpen}
        onOpenChange={(v) => {
          setFinalizeConfirmOpen(v);
          if (!v) setFinalizeWarnMsg(null);
        }}
        busy={printBusy}
        guestCount={ovQ.data?.session?.guest_count ?? 0}
        settlements={
          // Finalize-Zusammenfassung: nur aktive Abrechnungen aggregieren.
          activeSettlements(
            (ovQ.data?.settlements as Array<{
              status?: string | null;
              pos_sales_cents: number | string | null;
              card_total_cents: number | string | null;
              cash_handed_in_cents: number | string | null;
            }>) ?? [],
          )
        }
        vectronTotalCents={Number(
          (ovQ.data?.session as { vectron_daily_total_cents?: number | null } | undefined)
            ?.vectron_daily_total_cents ?? 0,
        )}
        pool={poolQ.data ?? null}
        warnMsg={finalizeWarnMsg}
        onConfirm={async () => {
          await runFinalizeAndPrint(Boolean(finalizeWarnMsg));
        }}
      />
    </div>
  );
}

function FinalizeConfirmDialog({
  open,
  onOpenChange,
  busy,
  guestCount,
  settlements,
  vectronTotalCents,
  pool,
  warnMsg,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  guestCount: number;
  settlements: Array<{
    pos_sales_cents: number | string | null;
    card_total_cents: number | string | null;
    cash_handed_in_cents: number | string | null;
  }>;
  vectronTotalCents: number;
  pool: Awaited<ReturnType<typeof getTipPoolOverview>> | null;
  warnMsg: string | null;
  onConfirm: () => void | Promise<void>;
}) {
  const sumPos = settlements.reduce((s, r) => s + Number(r.pos_sales_cents ?? 0), 0);
  const sumCard = settlements.reduce((s, r) => s + Number(r.card_total_cents ?? 0), 0);
  const sumCash = settlements.reduce((s, r) => s + Number(r.cash_handed_in_cents ?? 0), 0);

  const poolCents = (pool?.kitchenPoolCents ?? 0) + (pool?.servicePoolCents ?? 0);
  const shares = pool?.shares ?? [];
  const eligibleHours = shares.reduce((s, sh) => s + sh.hoursWorked, 0);
  const eurPerHour = eligibleHours > 0 ? poolCents / 100 / eligibleHours : 0;
  const nameById = pool?.staffNames ?? {};
  // Alle Pool-Teilnehmer (kitchen/service, participates=true). Auch mit 0 h
  // aufführen — Transparenz vor Abschluss.
  const participantRows = (pool?.poolEntries ?? [])
    .filter((e) => e.participates && (e.department === "kitchen" || e.department === "service"))
    .map((e) => {
      const share = shares.find((s) => s.staffId === e.staffId);
      return {
        staffId: e.staffId,
        name: e.displayName || nameById[e.staffId] || e.staffId,
        department: e.department as "kitchen" | "service",
        hours: (e.hoursMinutes ?? 0) / 60,
        shareCents: share?.shareCents ?? 0,
      };
    })
    .sort((a, b) =>
      a.department === b.department
        ? a.name.localeCompare(b.name)
        : a.department === "service"
          ? -1
          : 1,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tag finalisieren?</DialogTitle>
          <DialogDescription>
            Bitte die Zusammenfassung prüfen. Nach dem Finalisieren sind Korrekturen nur noch
            eingeschränkt möglich; als Admin wird die Session anschließend automatisch gesperrt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <div className="mb-1 font-medium">Gäste & Umsatz</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">Gästeanzahl</dt>
              <dd className="text-right tabular-nums">{guestCount}</dd>
              <dt className="text-muted-foreground">Vectron Tagesumsatz</dt>
              <dd className="text-right tabular-nums">{fmtCents(vectronTotalCents)}</dd>
              <dt className="text-muted-foreground">Kellner-Umsatz (POS)</dt>
              <dd className="text-right tabular-nums">{fmtCents(sumPos)}</dd>
              <dt className="text-muted-foreground">davon Karte</dt>
              <dd className="text-right tabular-nums">{fmtCents(sumCard)}</dd>
              <dt className="text-muted-foreground">davon Bar abgegeben</dt>
              <dd className="text-right tabular-nums">{fmtCents(sumCash)}</dd>
            </dl>
          </section>

          <section>
            <div className="mb-1 font-medium">Trinkgeld-Pool</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">Pool-Betrag</dt>
              <dd className="text-right tabular-nums">{fmtCents(poolCents)}</dd>
              <dt className="text-muted-foreground">Anrechenbare Stunden</dt>
              <dd className="text-right tabular-nums">{eligibleHours.toFixed(2)} h</dd>
              <dt className="text-muted-foreground">Rechnerischer €/Stunde</dt>
              <dd className="text-right tabular-nums">
                {eligibleHours > 0 ? `${eurPerHour.toFixed(2)} €/h` : "—"}
              </dd>
            </dl>
            {warnMsg ? (
              <div
                className="mt-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                data-testid="finalize-warn-message"
              >
                {warnMsg}
              </div>
            ) : (
              poolCents > 0 &&
              eligibleHours <= 0 && (
                <div className="mt-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  Achtung: Pool &gt; 0 €, aber keine anrechenbaren Stunden erfasst. Der Server wird
                  beim Finalisieren zusätzlich rückfragen.
                </div>
              )
            )}
          </section>

          <section>
            <div className="mb-1 font-medium">Anrechenbare Stunden je Mitarbeiter</div>
            {participantRows.length === 0 ? (
              <div className="text-muted-foreground">Keine Pool-Teilnehmer erfasst.</div>
            ) : (
              <div className="max-h-64 overflow-auto rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Mitarbeiter</th>
                      <th className="px-2 py-1 text-left font-medium">Bereich</th>
                      <th className="px-2 py-1 text-right font-medium">Stunden</th>
                      <th className="px-2 py-1 text-right font-medium">Pool-Anteil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participantRows.map((r) => (
                      <tr key={r.staffId} className="border-t">
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {r.department === "kitchen" ? "Küche" : "Service"}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.hours.toFixed(2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {fmtCents(r.shareCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid="finalize-cancel-button"
          >
            Abbrechen
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={busy || guestCount <= 0}
            data-testid="finalize-confirm-button"
            data-state={warnMsg ? "warning" : undefined}
            variant={warnMsg ? "destructive" : "default"}
          >
            {busy
              ? "Wird finalisiert…"
              : warnMsg
                ? "Trotzdem finalisieren"
                : "Finalisieren & drucken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// KAB2: dezente Statuszeile — ersetzt den früheren StatusStepper und die
// Status-Karte im Footer. Kein separater Einstieg, keine Finalize-Aktion.
function SessionStatusInline({
  status,
  lockedAt,
}: {
  status: string | null;
  lockedAt: string | null;
}) {
  if (!status) return null;
  const label =
    status === "open"
      ? "Offen"
      : status === "finalized"
        ? "Finalisiert"
        : status === "locked"
          ? "Gesperrt"
          : status;
  const variant: "default" | "secondary" =
    status === "locked" ? "secondary" : status === "finalized" ? "secondary" : "default";
  return (
    <Badge
      variant={variant}
      className="gap-1 self-center"
      data-testid="session-status-badge"
      data-status={status}
    >
      {status === "locked" && <Lock className="h-3.5 w-3.5" />}
      {label}
      {status === "locked" && lockedAt && (
        <span className="ml-1 text-xs opacity-70">
          ·{" "}
          {new Date(lockedAt).toLocaleString("de-DE", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      )}
    </Badge>
  );
}

// Kompakte Editor-Liste für „Offene Rechnungen" in den Admin-Dialogen.
// Spiegelt die Regel der Kellner-UI: pro Zeile Reservierungsname + Euro.
// Rein visuelle Hilfen; die harte Validierung passiert in der Mutation
// (toOpenInvoiceEntries) und im Server-Trigger.
function OpenInvoicesEditor({
  rows,
  onChange,
}: {
  rows: Array<{ name: string; amount: string }>;
  onChange: (next: Array<{ name: string; amount: string }>) => void;
}) {
  const update = (idx: number, patch: Partial<{ name: string; amount: string }>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { name: "", amount: "" }]);
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <Label>Offene Rechnungen</Label>
        <span className="text-xs text-muted-foreground">
          Reservierungsname ist Pflicht, sobald ein Betrag &gt; 0 steht.
        </span>
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Keine offene Rechnung.</p>}
      {rows.map((r, idx) => {
        const amountRaw = r.amount.trim();
        const parsed = amountRaw === "" ? 0 : parseEuroToCents(r.amount);
        const amountInvalid = amountRaw !== "" && (parsed === null || parsed < 0);
        const nameMissing = !amountInvalid && parsed !== null && parsed > 0 && r.name.trim() === "";
        return (
          <div key={idx} className="space-y-1">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="flex-1"
                placeholder="Reservierungs-/Gästename"
                value={r.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                aria-invalid={nameMissing}
              />
              <Input
                className="sm:w-32"
                inputMode="decimal"
                placeholder="0,00 €"
                value={r.amount}
                onChange={(e) => update(idx, { amount: e.target.value })}
                aria-invalid={amountInvalid}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                Entfernen
              </Button>
            </div>
            {nameMissing && (
              <p className="text-xs text-destructive">
                Bitte Reservierungsname eintragen — sonst kann die Abrechnung nicht gespeichert
                werden.
              </p>
            )}
            {amountInvalid && (
              <p className="text-xs text-destructive">Bitte gültigen Eurobetrag eintragen.</p>
            )}
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        + offene Rechnung
      </Button>
    </div>
  );
}
