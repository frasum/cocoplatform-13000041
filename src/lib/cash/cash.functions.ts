// B3b — Kasse Server-Functions.
//
// Architektur:
//   * RLS auf sessions/Satelliten ist DENY-ALL — alle Writes laufen via
//     supabaseAdmin (dynamic import im Handler).
//   * Schreibgate cash-lock.ts wird VOR jedem Write geprüft.
//   * Auto-Ausstempeln nutzt performClockOut aus time.functions.ts
//     (gleicher Pfad, gleiche Validierung, gleicher Audit-Action).
//   * Korrektur erbt kitchen_tip_rate vom Original — Rate-Änderung
//     beeinflusst keine bereits abgegebene Abrechnung rückwirkend.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller, type AdminCaller } from "@/lib/admin/admin-context";
import { loadStaffCaller, performClockOut, type StaffCaller } from "@/lib/time/time.functions";
import { assertRealIdentity } from "@/lib/admin/impersonation";
import { runGuarded } from "@/lib/admin/admin-call";
import { writeAuditLog, makeAuditWriter } from "@/lib/admin/audit";
import { arbzgMinimumBreak, grossMinutesBetween } from "@/lib/time/break-rules";
import { syncPoolTimeEntry } from "./pool-time-writeback";
import { assertBusinessDateUnlocked, TimeLockedError } from "@/lib/time/time-lock";
import { calcWaiterSettlement } from "./waiter-settlement";
import {
  computeTipPool,
  computeTipTotalCents,
  effectiveParticipation,
  poolFullyUnallocated,
  resolvePoolTimeEntries,
  resolveTipDistributionMode,
  type TipPoolResult,
  type StaffDepartment,
} from "./tip-pool";
import { kitchenShiftMinutes } from "./kitchen-shift-hours";
import { applyRosterPoolSnapshot } from "./roster-pool-sync";
import { isUntouched, removalBlockedReason } from "@/lib/roster/not-in-plan";
import { resolveServicePoolEnd } from "./service-pool-end";
import { assertCashWritable, CashLockedError } from "./cash-lock";
import type { Json } from "@/integrations/supabase/types";
import { ForbiddenError } from "@/lib/admin/role-guard";
import { sessionToDayInput } from "./session-day-input";
import { otherIncomesTable } from "./other-incomes-access";
import { assertSessionFieldWritable } from "./session-fields";
import { loadTipSettings, type TipSettings } from "./tip-settings";
import {
  openInvoiceEntriesSchema,
  parseOpenInvoiceEntries,
  sumOpenInvoiceEntries,
  type OpenInvoiceEntry,
} from "./open-invoices";

// Übersetzt Kellner-Eingabe in die persistierte JSONB-Struktur.
// Regeln (spiegeln den DB-Trigger):
//   - Wenn `entries` mind. eine Zeile hat, gewinnt die Liste; die Summe
//     wird IMMER serverseitig neu berechnet (Client-Wert für Summe wird
//     verworfen).
//   - Wenn `entries` leer ist und `fallbackCents > 0`, wird das als
//     Eingabefehler behandelt (Kellner muss Namen eintragen).
//   - Wenn `entries` leer und `fallbackCents = 0`, bleibt beides 0.
function resolveOpenInvoicesInput(
  entries: OpenInvoiceEntry[] | undefined,
  fallbackCents: number,
): { cents: number; details: OpenInvoiceEntry[] } {
  const list = entries ?? [];
  if (list.length > 0) {
    const cents = sumOpenInvoiceEntries(list);
    return { cents, details: list };
  }
  if (fallbackCents > 0) {
    throw new Error(
      "Bitte für jede offene Rechnung den Reservierungsnamen eintragen, sonst ist keine Abgabe möglich.",
    );
  }
  return { cents: 0, details: [] };
}

// Konvertiert die zulässige JSONB-Struktur für Supabase-Inserts.
function toJsonbDetails(entries: OpenInvoiceEntry[]): Json {
  return entries.map((e) => ({ name: e.name, cents: e.cents })) as unknown as Json;
}

export { loadTipSettings };
export type { TipSettings };

// ------------------------------------------------------------------------
// Fehlerklassen
// ------------------------------------------------------------------------

export class NoOpenSessionError extends Error {
  constructor(public readonly businessDate: string) {
    super(`Keine offene Session für Geschäftstag ${businessDate}.`);
    this.name = "NoOpenSessionError";
  }
}

// ------------------------------------------------------------------------
// MA2 — Guards: Kanal/Terminal muss zum Standort der Session gehören.
// Verhindert, dass ein Manager per manipuliertem Payload Beträge auf
// Kanäle/Terminals eines fremden Standorts (aber gleicher Organisation)
// schreibt. Werfen ForbiddenError → Aufrufer bricht VOR delete+insert ab.
// ------------------------------------------------------------------------

export class CrossLocationRefError extends ForbiddenError {
  constructor(
    public readonly kind: "channel" | "terminal",
    public readonly invalidIds: string[],
  ) {
    super(
      kind === "channel"
        ? `Kanal-Referenz(en) gehören nicht zum Session-Standort: ${invalidIds.join(", ")}`
        : `Terminal-Referenz(en) gehören nicht zum Session-Standort: ${invalidIds.join(", ")}`,
    );
    this.name = "CrossLocationRefError";
  }
}

async function assertChannelsAtLocation(
  organizationId: string,
  locationId: string,
  channelIds: string[],
): Promise<void> {
  if (channelIds.length === 0) return;
  const uniq = Array.from(new Set(channelIds));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("revenue_channels")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("location_id", locationId)
    .in("id", uniq);
  if (error) throw error;
  const found = new Set((data ?? []).map((r) => r.id));
  const invalid = uniq.filter((id) => !found.has(id));
  if (invalid.length > 0) throw new CrossLocationRefError("channel", invalid);
}

async function assertTerminalsAtLocation(
  organizationId: string,
  locationId: string,
  terminalIds: string[],
): Promise<void> {
  if (terminalIds.length === 0) return;
  const uniq = Array.from(new Set(terminalIds));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("payment_terminals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("location_id", locationId)
    .in("id", uniq);
  if (error) throw error;
  const found = new Set((data ?? []).map((r) => r.id));
  const invalid = uniq.filter((id) => !found.has(id));
  if (invalid.length > 0) throw new CrossLocationRefError("terminal", invalid);
}

export class CashLockBackwardsError extends Error {
  constructor() {
    super("Wasserlinie darf nur vorwärts verschoben werden.");
    this.name = "CashLockBackwardsError";
  }
}

export class SettlementNotCorrectableError extends Error {
  constructor(
    public readonly originalId: string,
    public readonly status: string,
  ) {
    super(`Settlement ${originalId} ist nicht korrigierbar (Status: ${status}).`);
    this.name = "SettlementNotCorrectableError";
  }
}

export class StaffLocationNotBoundError extends Error {
  constructor(
    public readonly staffId: string,
    public readonly locationId: string,
  ) {
    super(`Kellner ${staffId} ist nicht an Standort ${locationId} gebunden.`);
    this.name = "StaffLocationNotBoundError";
  }
}

export class WaiterSettlementAlreadyExistsError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly staffId: string,
  ) {
    super(
      "Für diesen Kellner existiert bereits eine aktive Abrechnung. Bitte Korrektur statt Neuanlage verwenden.",
    );
    this.name = "WaiterSettlementAlreadyExistsError";
  }
}

/**
 * TG1 — Aktiver Pool enthält Geld, aber es sind keine Stunden erfasst.
 * Wird von `finalizeSessionCore` geworfen, wenn nicht mit
 * `confirmPoolWarning: true` bestätigt wird.
 */
export class PoolHoursWarningError extends Error {
  constructor(
    public readonly serviceCents: number,
    public readonly kitchenCents: number,
    public readonly eligibleMinutes: number,
    /** Warnende Pools — nur diese werden im Text genannt (E2E-G2). */
    flags: { serviceWarn: boolean; kitchenWarn: boolean } = {
      serviceWarn: true,
      kitchenWarn: true,
    },
  ) {
    // Ehrlicher Text: `eligibleMinutes` summiert nur die MANUELLEN
    // poolEntries — Stempel-Stunden fehlen dort. Deshalb nennt die
    // Meldung je warnenden Pool den Betrag und die verteilte Summe
    // (0 €, weil `poolFullyUnallocated` genau das prüft). Die Wortfolge
    // „0 anrechenbare Stunden" bleibt erhalten: sowohl der Kassen-Dialog
    // (kasse.tsx) als auch die E2E-Assertion erkennen die Warnung daran.
    const parts: string[] = [];
    if (flags.serviceWarn) {
      parts.push(
        `Service-Pool enthält ${(serviceCents / 100).toFixed(2)} €, aber es wurden 0 € verteilt ` +
          `(0 anrechenbare Stunden im Bereich Service).`,
      );
    }
    if (flags.kitchenWarn) {
      parts.push(
        `Küchen-Pool enthält ${(kitchenCents / 100).toFixed(2)} €, aber es wurden 0 € verteilt ` +
          `(0 anrechenbare Stunden im Bereich Küche).`,
      );
    }
    super(`${parts.join(" ")} Bitte prüfen.`);
    this.name = "PoolHoursWarningError";
  }
}

// ------------------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function getCurrentBusinessDate(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("current_business_date");
  if (error || !data) throw new Error("current_business_date() RPC fehlgeschlagen.");
  return data as unknown as string;
}

export async function loadOrgSettings(orgId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("organization_settings")
    .select("kitchen_tip_rate, tip_pool_min_hours, kitchen_manual_only")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return {
    kitchenTipRate: Number(data?.kitchen_tip_rate ?? 0.02),
    tipPoolMinHours: Number(data?.tip_pool_min_hours ?? 2.5),
    kitchenManualOnly: Boolean(data?.kitchen_manual_only ?? false),
  };
}

// Wasserlinie pro Standort aus cash_locks. Null = keine Sperre.
export async function loadLocationCashLock(
  orgId: string,
  locationId: string,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("cash_locks")
    .select("locked_through_date")
    .eq("organization_id", orgId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  return data?.locked_through_date ?? null;
}

// Cross-Org-Schutz: jeder location-getriebene Aufruf prüft, dass die
// übergebene Location wirklich zur Org des Aufrufers gehört.
export async function assertLocationInOrg(orgId: string, locationId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    // ST1: bewusst ungefiltert — Daten-Zugriff (assertLocationInOrg by id).
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ForbiddenError();
}

// LS1 — Kassenbetrieb: Standorte mit `cash_enabled = false` sind reine
// Planungs-Standorte. Neue Sessions dürfen dort nicht entstehen; Dienstplan,
// Zeiterfassung und Lohn bleiben unberührt.
export async function assertLocationCashEnabled(orgId: string, locationId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    // ST1: bewusst ungefiltert — Daten-Zugriff (by id).
    .from("locations")
    .select("id, name, cash_enabled")
    .eq("id", locationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ForbiddenError();
  if (data.cash_enabled === false) {
    throw new Error(
      `Standort „${data.name}" ist ein reiner Planungs-Standort (kein Kassenbetrieb).`,
    );
  }
}

export async function assertStaffBoundToLocation(
  orgId: string,
  staffId: string,
  locationId: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("staff_locations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("staff_id", staffId)
    .eq("location_id", locationId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new StaffLocationNotBoundError(staffId, locationId);
}

// Stellt sicher, dass keiner der beteiligten Kellner (Haupt + Partner)
// bereits in einer anderen aktiven (nicht-superseded) Abrechnung derselben
// Session vorkommt — weder als `staff_id`, noch als (Alt-)`partner_staff_id`,
// noch in `settlement_partners`. `excludeSettlementId` schützt den
// Korrektur-Pfad vor Selbstkollision mit der eigenen, gerade
// superseded'eten Zeile.
export async function assertPartnersFree(
  orgId: string,
  sessionId: string,
  staffIds: string[],
  excludeSettlementId: string | null,
): Promise<void> {
  if (staffIds.length === 0) return;
  const uniqueIds = Array.from(new Set(staffIds));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1) Aktive Abrechnungen der Session — staff_id oder alt-partner_staff_id.
  let q = supabaseAdmin
    .from("waiter_settlements")
    .select("id, staff_id, partner_staff_id, status")
    .eq("organization_id", orgId)
    .eq("session_id", sessionId)
    .neq("status", "superseded");
  if (excludeSettlementId) q = q.neq("id", excludeSettlementId);
  const { data: settlements, error: sErr } = await q;
  if (sErr) throw sErr;
  const activeIds: string[] = (settlements ?? []).map((s) => s.id);

  const hit = (settlements ?? []).find(
    (s) =>
      uniqueIds.includes(s.staff_id) ||
      (s.partner_staff_id && uniqueIds.includes(s.partner_staff_id)),
  );
  if (hit) {
    // Typisierter Fehler statt generischer Error — sonst wird der Aufrufer
    // im Neuanlage-Pfad (createWaiterSettlement) daran gehindert,
    // WaiterSettlementAlreadyExistsError zu unterscheiden (Nachforderung
    // §88, Punkt 2).
    throw new WaiterSettlementAlreadyExistsError(sessionId, hit.staff_id);
  }

  // 2) settlement_partners aktiver Abrechnungen.
  if (activeIds.length > 0) {
    const { data: parts, error: pErr } = await supabaseAdmin
      .from("settlement_partners")
      .select("staff_id")
      .in("settlement_id", activeIds)
      .in("staff_id", uniqueIds)
      .limit(1);
    if (pErr) throw pErr;
    if (parts && parts.length > 0) {
      throw new Error(
        "Kellner ist bereits Partner einer anderen aktiven Abrechnung in dieser Session.",
      );
    }
  }
}

// Schreibt die Partner-Verknüpfung neu (delete-then-insert, für Korrektur-
// und Neuanlage-Pfade). Keine Client-Policies — nur via supabaseAdmin.
async function replaceSettlementPartners(
  orgId: string,
  settlementId: string,
  partnerStaffIds: string[],
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("settlement_partners")
    .delete()
    .eq("organization_id", orgId)
    .eq("settlement_id", settlementId);
  if (partnerStaffIds.length === 0) return;
  const rows = Array.from(new Set(partnerStaffIds)).map((staffId) => ({
    organization_id: orgId,
    settlement_id: settlementId,
    staff_id: staffId,
  }));
  const { error } = await supabaseAdmin.from("settlement_partners").insert(rows);
  if (error) throw error;
}

async function loadSessionWithLock(orgId: string, sessionId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(
      "id, business_date, status, locked_at, location_id, tip_pool_settlement_only, reopened_at, reopen_reason",
    )
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Session nicht gefunden.");
  return data;
}

// ------------------------------------------------------------------------
// Lesen
// ------------------------------------------------------------------------

export const getCashOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        businessDate: z.string().regex(ISO_DATE).optional(),
        locationId: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return getCashOverviewCore(caller, data);
  });

export async function getCashOverviewCore(
  caller: AdminCaller,
  data: { businessDate?: string; locationId?: string },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await loadOrgSettings(caller.organizationId);
  const businessDate = data.businessDate ?? (await getCurrentBusinessDate());

  let sessionQuery = supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("organization_id", caller.organizationId)
    .eq("business_date", businessDate);
  if (data.locationId) {
    await assertLocationInOrg(caller.organizationId, data.locationId);
    sessionQuery = sessionQuery.eq("location_id", data.locationId);
  }
  const { data: session } = await sessionQuery.maybeSingle();

  if (!session) {
    return {
      businessDate,
      session: null,
      settlements: [],
      channelAmounts: [] as Array<{ channelId: string; amountCents: number }>,
      terminalAmounts: [] as Array<{ terminalId: string; amountCents: number }>,
      expenses: [] as Array<{
        id: string;
        description: string | null;
        amountCents: number;
        createdAt: string;
      }>,
      otherIncomes: [] as Array<{
        id: string;
        description: string;
        amountCents: number;
        createdAt: string;
      }>,
      advances: [] as Array<{
        id: string;
        staffId: string;
        amountCents: number;
        note: string | null;
        createdAt: string;
      }>,
      cardTransactions: [] as Array<{
        id: string;
        terminalId: string | null;
        amountCents: number;
        note: string | null;
        createdAt: string;
      }>,
      bankDeposits: [] as Array<{
        id: string;
        amountCents: number;
        reference: string | null;
        createdAt: string;
      }>,
      registerTransfers: [] as Array<{
        id: string;
        direction: string;
        amountCents: number;
        note: string | null;
        createdAt: string;
      }>,
      cashLockedThroughDate: null as string | null,
      managerOnDutyNames: [] as string[],
    };
  }

  const [
    settlementsRes,
    channelAmtRes,
    terminalAmtRes,
    expensesRes,
    advancesRes,
    otherIncomesRes,
    cardRes,
    bankRes,
    transferRes,
    managerRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("waiter_settlements")
      .select(
        "id, staff_id, partner_staff_id, pos_sales_cents, kassiert_brutto_cents, card_total_cents, hilf_mahl_cents, open_invoices_cents, open_invoices_details, cash_handed_in_cents, differenz_cents, kitchen_tip_cents, kitchen_tip_rate, status, submitted_at, corrected_from_id, auto_clockout_time_entry_id, primary_staff:staff!waiter_settlements_staff_id_fkey(display_name), settlement_partners(staff_id, staff:staff!settlement_partners_staff_id_fkey(display_name))",
      )
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("submitted_at", { ascending: true }),
    supabaseAdmin
      .from("session_channel_amounts")
      .select("channel_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id),
    supabaseAdmin
      .from("session_terminal_amounts")
      .select("terminal_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id),
    supabaseAdmin
      .from("session_expenses")
      .select("id, description, amount_cents, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("session_advances")
      .select("id, staff_id, amount_cents, note, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    // SE1: Sonstige Einnahmen als Positionsliste (Muster session_expenses).
    otherIncomesTable(supabaseAdmin)
      .select("id, description, amount_cents, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("session_card_transactions")
      .select("id, terminal_id, amount_cents, note, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("session_bank_deposits")
      .select("id, amount_cents, reference, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("session_register_transfers")
      .select("id, direction, amount_cents, note, created_at")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    // Manager on duty: eingeplante Personen im Bereich GL für diesen Tag
    // an diesem Standort (Dienstplan). Wird im Tagesbericht-Ausdruck angezeigt.
    supabaseAdmin
      .from("roster_shifts")
      .select("staff_id, staff:staff!roster_shifts_staff_id_fkey(display_name)")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", session.location_id)
      .eq("shift_date", session.business_date)
      .eq("area", "gl"),
  ]);

  const managerNameSet = new Set<string>();
  for (const r of (managerRes.data ?? []) as Array<{
    staff_id: string;
    staff: { display_name: string } | null;
  }>) {
    const name = r.staff?.display_name?.trim();
    if (name) managerNameSet.add(name);
  }
  const managerOnDutyNames = Array.from(managerNameSet).sort((a, b) => a.localeCompare(b, "de"));

  return {
    businessDate,
    session,
    settlements: (settlementsRes.data ?? []).map((s) => {
      const primary = (s.primary_staff as { display_name: string } | null)?.display_name ?? "—";
      const partnerRows = (s.settlement_partners ?? []) as Array<{
        staff_id: string;
        staff: { display_name: string } | null;
      }>;
      const sortedPartners = [...partnerRows].sort((a, b) =>
        (a.staff?.display_name ?? "").localeCompare(b.staff?.display_name ?? "", "de"),
      );
      const partnerStaffIds = sortedPartners.map((p) => p.staff_id);
      const partnerStaffNames = sortedPartners
        .map((p) => p.staff?.display_name ?? null)
        .filter((n): n is string => !!n);
      const staffName =
        partnerStaffNames.length > 0 ? [primary, ...partnerStaffNames].join(" + ") : primary;
      const openInvoiceEntries = parseOpenInvoiceEntries(
        (s as { open_invoices_details?: unknown }).open_invoices_details,
      );
      return {
        ...s,
        staffName,
        primaryStaffName: primary,
        partnerStaffNames,
        partnerStaffIds,
        openInvoiceEntries,
      };
    }),
    channelAmounts: (channelAmtRes.data ?? []).map((r) => ({
      channelId: r.channel_id,
      amountCents: Number(r.amount_cents),
    })),
    terminalAmounts: (terminalAmtRes.data ?? []).map((r) => ({
      terminalId: r.terminal_id,
      amountCents: Number(r.amount_cents),
    })),
    expenses: (expensesRes.data ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      amountCents: Number(r.amount_cents),
      createdAt: r.created_at,
    })),
    advances: (advancesRes.data ?? []).map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      amountCents: Number(r.amount_cents),
      note: r.note,
      createdAt: r.created_at,
    })),
    otherIncomes: (otherIncomesRes.data ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      amountCents: Number(r.amount_cents),
      createdAt: r.created_at,
    })),
    cardTransactions: (cardRes.data ?? []).map((r) => ({
      id: r.id,
      terminalId: r.terminal_id,
      amountCents: Number(r.amount_cents),
      note: r.note,
      createdAt: r.created_at,
    })),
    bankDeposits: (bankRes.data ?? []).map((r) => ({
      id: r.id,
      amountCents: Number(r.amount_cents),
      reference: r.reference,
      createdAt: r.created_at,
    })),
    registerTransfers: (transferRes.data ?? []).map((r) => ({
      id: r.id,
      direction: r.direction as string,
      amountCents: Number(r.amount_cents),
      note: r.note,
      createdAt: r.created_at,
    })),
    cashLockedThroughDate: await loadLocationCashLock(caller.organizationId, session.location_id),
    managerOnDutyNames,
  };
}

export const getMySettlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    return getMySettlementCore(caller);
  });

export async function getMySettlementCore(caller: StaffCaller) {
  const businessDate = await getCurrentBusinessDate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Fallback für "keine Session heute": Org-Standard (kein Standort bekannt).
  const orgSettings = await loadOrgSettings(caller.organizationId);
  // Standort-Zuordnung des Kellners laden — es können mehrere offene Sessions
  // am gleichen Geschäftstag existieren (eine je Standort). Ohne Filter würde
  // maybeSingle() bei >1 Zeile einen Fehler liefern und die UI zeigte fälschlich
  // „keine Session eröffnet".
  const { data: staffLocRows } = await supabaseAdmin
    .from("staff_locations")
    .select("location_id")
    .eq("staff_id", caller.staffId)
    .eq("organization_id", caller.organizationId);
  const staffLocationIds = [
    ...new Set((staffLocRows ?? []).map((r) => r.location_id).filter(Boolean)),
  ];
  let sessionQuery = supabaseAdmin
    .from("sessions")
    .select(
      "id, business_date, status, locked_at, location_id, tip_pool_settlement_only, locations:locations!sessions_location_id_fkey(name)",
    )
    .eq("organization_id", caller.organizationId)
    .eq("business_date", businessDate)
    .order("created_at", { ascending: true });
  if (staffLocationIds.length > 0) {
    sessionQuery = sessionQuery.in("location_id", staffLocationIds);
  }
  const { data: sessionRows } = await sessionQuery.limit(1);
  const session = sessionRows?.[0] ?? null;
  if (!session) {
    // Zur Unterscheidung „gar keine Session am Tag" vs. „Session existiert,
    // aber nicht an deinem Standort": org-weite Zählung ohne Standort-Filter.
    const { count: openSessionsCount } = await supabaseAdmin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", caller.organizationId)
      .eq("business_date", businessDate);
    return {
      businessDate,
      session: null,
      settlement: null,
      kitchenTipRate: orgSettings.kitchenTipRate,
      servicePoolEnabled: true,
      staffId: caller.staffId,
      myPoolShareCents: null as number | null,
      otherLocationSessionsCount: openSessionsCount ?? 0,
      hasStaffLocations: staffLocationIds.length > 0,
    };
  }
  // Session gefunden → Standort-Vererbung nutzen (Overrides + Pool-Schalter).
  const settings = await loadTipSettings(caller.organizationId, session.location_id);
  const { data: row } = await supabaseAdmin
    .from("waiter_settlements")
    .select(
      "id, status, pos_sales_cents, kassiert_brutto_cents, card_total_cents, hilf_mahl_cents, open_invoices_cents, open_invoices_details, cash_handed_in_cents, differenz_cents, kitchen_tip_cents, kitchen_tip_rate, submitted_at, auto_clockout_time_entry_id, second_waiter_name, additional_waiters, partner_staff_id, settlement_partners(staff:staff!settlement_partners_staff_id_fkey(display_name))",
    )
    .eq("organization_id", caller.organizationId)
    .eq("session_id", session.id)
    .eq("staff_id", caller.staffId)
    .neq("status", "superseded")
    .maybeSingle();

  // Pool-Anteil nur zeigen, wenn Tag finalisiert (locked).
  let myPoolShareCents: number | null = null;
  if (session.status === "locked") {
    try {
      const pool = await computeSessionTipPoolCore(
        { organizationId: caller.organizationId } as AdminCaller,
        session,
        settings,
      );
      myPoolShareCents = pool.shares.find((s) => s.staffId === caller.staffId)?.shareCents ?? 0;
    } catch {
      myPoolShareCents = null;
    }
  }

  const partnerRows = (
    (row?.settlement_partners ?? []) as Array<{
      staff: { display_name: string } | null;
    }>
  )
    .map((p) => p.staff?.display_name ?? null)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b, "de"));
  const openInvoiceEntries = row
    ? parseOpenInvoiceEntries((row as { open_invoices_details?: unknown }).open_invoices_details)
    : [];
  const settlementWithPartners = row
    ? { ...row, partnerStaffNames: partnerRows, openInvoiceEntries }
    : null;

  const sessionLocationName =
    (session as { locations?: { name: string | null } | null }).locations?.name ?? null;

  return {
    businessDate,
    session: {
      id: session.id,
      status: session.status,
      locationId: session.location_id,
      locationName: sessionLocationName,
    },
    settlement: settlementWithPartners,
    kitchenTipRate: settings.kitchenTipRate,
    servicePoolEnabled: settings.servicePoolEnabled,
    staffId: caller.staffId,
    myPoolShareCents,
    otherLocationSessionsCount: 0,
    hasStaffLocations: staffLocationIds.length > 0,
  };
}

// ------------------------------------------------------------------------
// Kellner: aktive Kollegen der eigenen Org (für Zweit-Kellner-Auswahl)
// ------------------------------------------------------------------------

export const listOrgWaiters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("staff")
      .select("id, display_name")
      .eq("organization_id", caller.organizationId)
      .eq("is_active", true)
      .order("display_name");
    if (error) throw error;
    return (data ?? []).map((s) => ({ id: s.id, displayName: s.display_name }));
  });

// ------------------------------------------------------------------------
// B4 — Trinkgeld-Pool Overview
// ------------------------------------------------------------------------

// ZS1 — Anzeigezeile des Pools inkl. Plan-Markierung. `notInPlan` = für
// (Person, Geschäftstag) existiert keine planned/confirmed Roster-Schicht
// mehr; `removable` = zusätzlich unberührt (kein Stempel, keine
// Abrechnung, keine Notiz, keine Teilnahme-Übersteuerung). Das Entfernen
// prüft serverseitig erneut — die Anzeige entscheidet nicht.
export type TipPoolEntryView = {
  staffId: string;
  displayName: string;
  department: "kitchen" | "service";
  hoursMinutes: number;
  shiftStart: string | null;
  shiftEnd: string | null;
  participates: boolean;
  participatesOverride: boolean | null;
  notInPlan: boolean;
  removable: boolean;
  removalBlockedReason: string | null;
};

export type TipPoolGlEntryView = {
  staffId: string;
  displayName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  hoursMinutes: number;
  notInPlan: boolean;
  removable: boolean;
  removalBlockedReason: string | null;
};

export const getTipPoolOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return getTipPoolOverviewCore(caller, data);
  });

export async function getTipPoolOverviewCore(
  caller: AdminCaller,
  data: { sessionId: string },
): Promise<
  TipPoolResult & {
    staffNames: Record<string, string>;
    manualStaffIds: string[];
    kitchenManualOnly: boolean;
    servicePoolEnabled: boolean;
    poolEntries: TipPoolEntryView[];
    glEntries: TipPoolGlEntryView[];
  }
> {
  const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
  const settings = await loadTipSettings(caller.organizationId, session.location_id);
  return computeSessionTipPoolCore(caller, session, settings);
}

export type LoadedSession = Awaited<ReturnType<typeof loadSessionWithLock>>;
export type LoadedOrgSettings = Awaited<ReturnType<typeof loadOrgSettings>>;

/**
 * Minimal-Sicht auf eine Session, die die Pool-Rechnung braucht. Bewusst
 * schmaler als `LoadedSession`, damit Aufrufer mit eigenen, engeren
 * SELECTs (z.B. Trinkgeld-Rest-Liste) nicht an neuen Spalten scheitern.
 */
export type PoolSessionRef = Pick<
  LoadedSession,
  "id" | "business_date" | "location_id" | "status" | "tip_pool_settlement_only" | "locked_at"
>;

// Rechnet den Trinkgeld-Pool für eine bereits geladene Session + settings.
// Reiner Refactor aus getTipPoolOverviewCore — keine Verhaltensänderung.
export async function computeSessionTipPoolCore(
  caller: AdminCaller,
  session: PoolSessionRef,
  settings: TipSettings,
): Promise<
  TipPoolResult & {
    staffNames: Record<string, string>;
    manualStaffIds: string[];
    kitchenManualOnly: boolean;
    servicePoolEnabled: boolean;
    poolEntries: TipPoolEntryView[];
    glEntries: TipPoolGlEntryView[];
  }
> {
  // Standort-Vererbung: mergeTipSettings liefert den Wert bereits aufgelöst.
  const servicePoolEnabled = settings.servicePoolEnabled ?? true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [settlementsRes, timeRes, manualRes, plannedRes] = await Promise.all([
    supabaseAdmin
      .from("waiter_settlements")
      .select(
        "staff_id, pos_sales_cents, kassiert_brutto_cents, card_total_cents, cash_handed_in_cents, open_invoices_cents, hilf_mahl_cents, kitchen_tip_cents, status",
      )
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .neq("status", "superseded"),
    supabaseAdmin
      .from("time_entries")
      .select("staff_id, started_at, ended_at, source")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", session.location_id)
      .eq("business_date", session.business_date)
      .not("ended_at", "is", null),
    supabaseAdmin
      .from("session_tip_pool_entries")
      .select("staff_id, department, hours_minutes, shift_start, shift_end, participates, note")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id),
    // ZS1 — Plan-Menge des Geschäftstags am Standort (planned/confirmed).
    supabaseAdmin
      .from("roster_shifts")
      .select("staff_id")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", session.location_id)
      .eq("shift_date", session.business_date)
      .in("status", ["planned", "confirmed"]),
  ]);
  if (settlementsRes.error) throw settlementsRes.error;
  if (timeRes.error) throw timeRes.error;
  if (manualRes.error) throw manualRes.error;
  if (plannedRes.error) throw plannedRes.error;
  const plannedStaffIds = new Set<string>((plannedRes.data ?? []).map((r) => r.staff_id as string));
  // Gestempelte Ist-Zeit bzw. Abrechnungsbezug je Person (Unberührtheit).
  const clockedStaffIds = new Set<string>(
    (timeRes.data ?? [])
      .filter((r) => (r as { source?: string | null }).source === "clock")
      .map((r) => r.staff_id as string),
  );
  const settledStaffIds = new Set<string>(
    (settlementsRes.data ?? []).map((r) => r.staff_id as string),
  );

  const settlements = (settlementsRes.data ?? []).map((r) => ({
    staffId: r.staff_id,
    posSalesCents: Number(r.pos_sales_cents),
    kassiertBruttoCents: Number(r.kassiert_brutto_cents),
    cardTotalCents: Number(r.card_total_cents),
    cashHandedInCents: Number(r.cash_handed_in_cents),
    openInvoicesCents: Number(r.open_invoices_cents),
    hilfMahlCents: Number(r.hilf_mahl_cents),
    kitchenTipCents: Number(r.kitchen_tip_cents),
  }));
  const allPoolRows = (manualRes.data ?? []).map((r) => ({
    staffId: r.staff_id,
    department: r.department as StaffDepartment,
    hoursMinutes: Number(r.hours_minutes),
    shiftStart: r.shift_start as string | null,
    shiftEnd: r.shift_end as string | null,
    participates: (r as { participates: boolean | null }).participates ?? null,
    note: (r as { note: string | null }).note ?? null,
  }));
  // GL-Zeilen NIE als „manuell" an die Verteilrechnung geben — die
  // Verteillogik schließt zwar gl bereits aus, aber `staffParticipates`
  // würde GL sonst als Pool-Teilnehmer markieren (hours_minutes > 0).
  const manualEntries = allPoolRows
    .filter((r) => r.department === "kitchen" || r.department === "service")
    .map((r) => ({
      staffId: r.staffId,
      department: r.department,
      hoursMinutes: r.hoursMinutes,
      participates: r.participates,
    }));
  const manualByStaff = new Map(manualEntries.map((m) => [m.staffId, m]));
  const glRows = allPoolRows.filter((r) => r.department === "gl");

  const rawTimeEntries = (timeRes.data ?? [])
    .filter((r) => r.ended_at !== null)
    .map((r) => ({
      staffId: r.staff_id,
      startedAt: r.started_at,
      endedAt: r.ended_at as string,
    }));

  // staffDepartments VOR dem Stunden-Bau laden — der kitchenManualOnly-Filter
  // braucht das Department, um Küchen-Stempel zu verwerfen.
  const staffIds = Array.from(
    new Set<string>([
      ...settlements.map((s) => s.staffId),
      ...rawTimeEntries.map((t) => t.staffId),
      ...manualByStaff.keys(),
      ...glRows.map((r) => r.staffId),
    ]),
  );

  const staffDepartments = new Map<string, StaffDepartment>();
  const staffParticipates = new Map<string, boolean>();
  const staffNames: Record<string, string> = {};

  if (staffIds.length > 0) {
    const [slRes, staffRes] = await Promise.all([
      supabaseAdmin
        .from("staff_locations")
        .select("staff_id, department")
        .eq("organization_id", caller.organizationId)
        .eq("location_id", session.location_id)
        .in("staff_id", staffIds),
      supabaseAdmin
        .from("staff")
        .select("id, display_name, participates_in_pool")
        .eq("organization_id", caller.organizationId)
        .in("id", staffIds),
    ]);
    if (slRes.error) throw slRes.error;
    if (staffRes.error) throw staffRes.error;
    for (const r of slRes.data ?? []) {
      staffDepartments.set(r.staff_id, r.department as StaffDepartment);
    }
    for (const r of staffRes.data ?? []) {
      staffParticipates.set(r.id, Boolean(r.participates_in_pool));
      staffNames[r.id] = r.display_name ?? "—";
    }
  }

  // Manuelle Einträge erzwingen das Department; die Teilnahme ist von den
  // Stunden entkoppelt: explizites `participates` übersteuert den
  // Stammdaten-Default (`staff.participates_in_pool`). NULL = Standard.
  for (const m of manualEntries) {
    staffDepartments.set(m.staffId, m.department);
    const staffDefault = staffParticipates.get(m.staffId) ?? false;
    staffParticipates.set(m.staffId, effectiveParticipation(m.participates, staffDefault));
  }

  const timeEntries = resolvePoolTimeEntries({
    rawTimeEntries,
    manualEntries,
    staffDepartments,
    settlementOnly: Boolean(session.tip_pool_settlement_only),
    kitchenManualOnly: settings.kitchenManualOnly,
    businessDate: session.business_date,
  });

  const kitchenPoolCents = settlements.reduce((s, x) => s + x.kitchenTipCents, 0);
  const tipTotalCents = computeTipTotalCents(settlements);
  const servicePoolCentsRaw = tipTotalCents - kitchenPoolCents;
  // TG1: Standort ohne Service-Pool → kein Poolgeld, kein Phantom-Rest.
  // Kellner behalten ihr individuelles Trinkgeld physisch selbst.
  const servicePoolCents = servicePoolEnabled ? servicePoolCentsRaw : 0;

  const result = computeTipPool({
    kitchenPoolCents,
    servicePoolCents,
    settlements,
    timeEntries,
    staffDepartments,
    staffParticipates,
    minHoursPerDay: settings.tipPoolMinHours,
    // TG4 — einziger Auflösungspunkt: Stichtag gegen den Geschäftstag der
    // Session. Vor dem Stichtag (oder ohne) bleibt es bei "hours".
    // TG4-N1: kein stiller Fallback mehr — der Aufrufer muss TipSettings
    // liefern (loadTipSettings), sonst schlägt bereits tsc fehl.
    distributionMode: resolveTipDistributionMode(
      session.business_date,
      settings.distributionMode,
      settings.distributionModeFrom,
    ),
  });

  // Bei deaktivertem Service-Pool: keine Service-Shares ausweisen und
  // kein Rest — computeTipPool würde bei poolCents=0 zwar 0-Shares und
  // remainder=0 liefern, aber wir filtern die Service-Zeilen zusätzlich
  // vollständig aus `shares` heraus (statt „Rest = Pool").
  const shares = servicePoolEnabled
    ? result.shares
    : result.shares.filter((sh) => sh.department !== "service");
  const serviceRemainder = servicePoolEnabled ? result.serviceRemainder : 0;

  return {
    ...result,
    shares,
    servicePoolCents,
    serviceRemainder,
    servicePoolEnabled,
    staffNames,
    manualStaffIds: Array.from(manualByStaff.keys()),
    kitchenManualOnly: settings.kitchenManualOnly,
    poolEntries: (() => {
      // Vollständige kitchen/service-Liste (inkl. abgewählter + reiner
      // Stempel-MA), damit das UI die Teilnahme beidseitig schalten kann.
      const ids = Array.from(staffIds).filter((id) => {
        const d = staffDepartments.get(id);
        return d === "kitchen" || d === "service";
      });
      // Stempel-Stunden je MA für Anzeige + als Fallback beim Toggle-Anlegen.
      const stampMinutes = new Map<string, number>();
      for (const t of rawTimeEntries) {
        const ms = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
        if (ms > 0) {
          stampMinutes.set(t.staffId, (stampMinutes.get(t.staffId) ?? 0) + Math.round(ms / 60_000));
        }
      }
      return ids.map((id) => {
        const manual = manualByStaff.get(id);
        const row = allPoolRows.find((r) => r.staffId === id);
        const dept = staffDepartments.get(id) as "kitchen" | "service";
        const hoursMinutes = manual ? manual.hoursMinutes : (stampMinutes.get(id) ?? 0);
        // ZS1 — Plan-Markierung + Entfernbarkeit (Anzeige; Server prüft erneut).
        const touched = {
          hasClockEntry: clockedStaffIds.has(id),
          hasSettlement: settledStaffIds.has(id),
          note: row?.note ?? null,
          participatesOverride: manual ? (manual.participates ?? null) : null,
        };
        const notInPlan = !plannedStaffIds.has(id);
        return {
          staffId: id,
          displayName: staffNames[id] ?? id,
          department: dept,
          hoursMinutes,
          shiftStart: row?.shiftStart ? row.shiftStart.slice(0, 5) : null,
          shiftEnd: row?.shiftEnd ? row.shiftEnd.slice(0, 5) : null,
          participates: staffParticipates.get(id) ?? false,
          participatesOverride: manual ? (manual.participates ?? null) : null,
          notInPlan,
          removable: notInPlan && isUntouched(touched),
          removalBlockedReason: removalBlockedReason(touched),
        };
      });
    })(),
    glEntries: glRows.map((r) => {
      const touched = {
        hasClockEntry: clockedStaffIds.has(r.staffId),
        hasSettlement: settledStaffIds.has(r.staffId),
        note: r.note,
        participatesOverride: r.participates,
      };
      const notInPlan = !plannedStaffIds.has(r.staffId);
      return {
        staffId: r.staffId,
        displayName: staffNames[r.staffId] ?? r.staffId,
        shiftStart: r.shiftStart ? r.shiftStart.slice(0, 5) : null,
        shiftEnd: r.shiftEnd ? r.shiftEnd.slice(0, 5) : null,
        hoursMinutes: r.hoursMinutes,
        notInPlan,
        removable: notInPlan && isUntouched(touched),
        removalBlockedReason: removalBlockedReason(touched),
      };
    }),
  };
}

// ------------------------------------------------------------------------
// Admin-Ansicht: aufgelaufener Trinkgeld-Restcent je Geschäftstag
// ------------------------------------------------------------------------

export const getTipRemainderByPeriod = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        startDate: z.string().regex(ISO_DATE),
        endDate: z.string().regex(ISO_DATE),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    await assertLocationInOrg(caller.organizationId, data.locationId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadTipSettings(caller.organizationId, data.locationId);
    const { data: sessions, error } = await supabaseAdmin
      .from("sessions")
      .select("id, business_date, status, locked_at, location_id, tip_pool_settlement_only")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId)
      .gte("business_date", data.startDate)
      .lte("business_date", data.endDate)
      .order("business_date", { ascending: true });
    if (error) throw error;

    const rows: Array<{
      businessDate: string;
      kitchenRemainderCents: number;
      serviceRemainderCents: number;
    }> = [];
    let kitchenTotal = 0;
    let serviceTotal = 0;
    for (const s of sessions ?? []) {
      const res = await computeSessionTipPoolCore(caller, s, settings);
      rows.push({
        businessDate: s.business_date as string,
        kitchenRemainderCents: res.kitchenRemainder,
        serviceRemainderCents: res.serviceRemainder,
      });
      kitchenTotal += res.kitchenRemainder;
      serviceTotal += res.serviceRemainder;
    }
    return {
      rows,
      totals: {
        kitchenCents: kitchenTotal,
        serviceCents: serviceTotal,
        totalCents: kitchenTotal + serviceTotal,
      },
      servicePoolEnabled: settings.servicePoolEnabled,
    };
  });

// ------------------------------------------------------------------------
// Stammdaten-Reader (Manager+): revenue_channels & payment_terminals
// ------------------------------------------------------------------------

export const listRevenueChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ locationId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return listRevenueChannelsCore(caller, data?.locationId);
  });

export async function listRevenueChannelsCore(caller: AdminCaller, locationId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("revenue_channels")
    .select("id, label, kind, sort_order, is_active")
    .eq("organization_id", caller.organizationId);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind as string,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
}

export const listPaymentTerminals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ locationId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return listPaymentTerminalsCore(caller, data?.locationId);
  });

export async function listPaymentTerminalsCore(caller: AdminCaller, locationId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("payment_terminals")
    .select("id, label, sort_order, is_active, is_gl")
    .eq("organization_id", caller.organizationId);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isGl: r.is_gl,
  }));
}

// ------------------------------------------------------------------------
// Manager: Session
// ------------------------------------------------------------------------

export const getOrCreateOpenSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        businessDate: z.string().regex(ISO_DATE).optional(),
        locationId: z.string().uuid(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return getOrCreateOpenSessionCore(caller, data);
  });

export async function getOrCreateOpenSessionCore(
  caller: AdminCaller,
  data: { businessDate?: string; locationId: string },
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const businessDate = data.businessDate ?? (await getCurrentBusinessDate());
    await assertLocationInOrg(caller.organizationId, data.locationId);
    // LS1: keine Kassen-Session an reinen Planungs-Standorten.
    await assertLocationCashEnabled(caller.organizationId, data.locationId);
    const outcome = await ensureOpenSessionRaw({
      organizationId: caller.organizationId,
      locationId: data.locationId,
      businessDate,
    });
    return {
      result: {
        id: outcome.id,
        status: outcome.status,
        businessDate,
        created: outcome.created,
      },
      audit: outcome.created
        ? {
            action: "cash.session.created",
            entity: "session",
            entityId: outcome.id,
            meta: {
              businessDate,
              locationId: data.locationId,
              poolSnapshotCount: outcome.snapshotCount,
              source: "manager_manual",
            },
          }
        : {
            action: "cash.session.get_existing",
            entity: "session",
            entityId: outcome.id,
            meta: { businessDate, locationId: data.locationId },
          },
    };
  });
}

// Shared low-level "ensure exists" für getOrCreateOpenSession (Manager).
// Enthält keinerlei Rollen-/Audit-Logik — die Aufrufer setzen ihren
// jeweiligen Rechte- und Audit-Kontext.
async function ensureOpenSessionRaw(args: {
  organizationId: string;
  locationId: string;
  businessDate: string;
}): Promise<{ id: string; status: string; created: boolean; snapshotCount: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("sessions")
    .select("id, status")
    .eq("organization_id", args.organizationId)
    .eq("location_id", args.locationId)
    .eq("business_date", args.businessDate)
    .maybeSingle();
  if (existing) {
    return { id: existing.id, status: existing.status, created: false, snapshotCount: 0 };
  }
  const { data: created, error } = await supabaseAdmin
    .from("sessions")
    .insert({
      organization_id: args.organizationId,
      location_id: args.locationId,
      business_date: args.businessDate,
      status: "open",
    })
    .select("id, status")
    .single();
  if (error) {
    // Nur Unique-Violation (23505) auf sessions_org_loc_date_key ist ein
    // erwarteter Race — Doppelklick oder zwei parallele Aufrufe (Kellner
    // + Manager) haben gleichzeitig eingefügt. Andere Fehler werden
    // unverändert propagiert, damit sie nicht stillschweigend als „Race"
    // fehlinterpretiert werden.
    const code = (error as { code?: string }).code;
    if (code !== "23505") throw error;
    const { data: raced } = await supabaseAdmin
      .from("sessions")
      .select("id, status")
      .eq("organization_id", args.organizationId)
      .eq("location_id", args.locationId)
      .eq("business_date", args.businessDate)
      .maybeSingle();
    if (raced) {
      return { id: raced.id, status: raced.status, created: false, snapshotCount: 0 };
    }
    throw error;
  }
  // Roster→Trinkgeld-Pool-Snapshot einfrieren. Fehler hier dürfen die
  // Session-Eröffnung NICHT blocken (Komfort-Feature).
  let snapshotCount = 0;
  try {
    snapshotCount = await applyRosterPoolSnapshot({
      organizationId: args.organizationId,
      sessionId: created.id,
      locationId: args.locationId,
      businessDate: args.businessDate,
    });
  } catch (e) {
    console.error("roster pool snapshot failed:", e);
  }
  return { id: created.id, status: created.status, created: true, snapshotCount };
}

const updateSessionSchema = z.object({
  sessionId: z.string().uuid(),
  channelAmounts: z
    .array(z.object({ channelId: z.string().uuid(), amountCents: z.number().int() }))
    .default([]),
  terminalAmounts: z
    .array(z.object({ terminalId: z.string().uuid(), amountCents: z.number().int() }))
    .default([]),
  vouchersSoldCents: z.number().int().default(0),
  vouchersRedeemedCents: z.number().int().default(0),
  // FS1 (04.08.): Session-Felder können am Standort deaktiviert sein. Ein
  // deaktiviertes Feld wird vom Client WEGGELASSEN (nicht 0 gesendet) — der
  // Server behandelt „fehlt" als „nicht anfassen", damit historische Werte
  // nie durch einen späteren Speichervorgang genullt werden.
  finedineVouchersCents: z.number().int().optional(),
  // N15a (Fachentscheidung 13.07.): kein Client-Feld mehr — das Konzept
  // OpenTabs-Abzug ist durch SoUse abgelöst. Die DB-Spalte
  // `sessions.opentabs_deduction_cents` bleibt bewusst belassen bis
  // Cutover-Mapping verifiziert (§88, N15b).
  vorschussCents: z.number().int().default(0),
  einladungCents: z.number().int().default(0),
  // SE1 (04.08.): „Sonstige Einnahme" ist kein Session-Feld mehr, sondern eine
  // Positionsliste (session_other_incomes) wie Ausgaben/Vorschüsse. Die
  // DB-Spalte `sessions.sonstige_einnahme_cents` wird nicht mehr beschrieben.
  vectronDailyTotalCents: z.number().int().optional(),
  cashActualCents: z.number().int().nullable().optional(),
  guestCount: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).nullable().default(null),
});

export const updateSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSessionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return updateSessionCore(caller, data);
  });

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

// --- Änderungs-Log: Vorher-Zustand einer wieder geöffneten Session ---------
// Nur für Sessions mit `reopened_at` relevant. Liefert den Snapshot samt
// Kanal-/Terminal-Labels (aktiv UND inaktiv), damit der Log-Eintrag ohne
// Nachschlagen lesbar bleibt.
async function loadSessionChangeSnapshot(
  orgId: string,
  session: { id: string; location_id: string },
): Promise<{ snapshot: SessionSnapshot; labels: Map<string, string> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [row, channels, terminals, chanAmounts, termAmounts] = await Promise.all([
    supabaseAdmin
      .from("sessions")
      .select(
        "vouchers_sold_cents, vouchers_redeemed_cents, finedine_vouchers_cents, vorschuss_cents, einladung_cents, vectron_daily_total_cents, cash_actual_cents, guest_count, notes",
      )
      .eq("id", session.id)
      .eq("organization_id", orgId)
      .single(),
    supabaseAdmin
      .from("revenue_channels")
      .select("id, label")
      .eq("organization_id", orgId)
      .eq("location_id", session.location_id),
    supabaseAdmin
      .from("payment_terminals")
      .select("id, label")
      .eq("organization_id", orgId)
      .eq("location_id", session.location_id),
    supabaseAdmin
      .from("session_channel_amounts")
      .select("channel_id, amount_cents")
      .eq("organization_id", orgId)
      .eq("session_id", session.id),
    supabaseAdmin
      .from("session_terminal_amounts")
      .select("terminal_id, amount_cents")
      .eq("organization_id", orgId)
      .eq("session_id", session.id),
  ]);
  if (row.error) throw row.error;
  if (channels.error) throw channels.error;
  if (terminals.error) throw terminals.error;
  if (chanAmounts.error) throw chanAmounts.error;
  if (termAmounts.error) throw termAmounts.error;

  const labels = new Map<string, string>();
  for (const c of channels.data ?? []) labels.set(c.id, c.label);
  for (const t of terminals.data ?? []) labels.set(t.id, t.label);

  const s = row.data;
  return {
    labels,
    snapshot: {
      vouchersSoldCents: s.vouchers_sold_cents,
      vouchersRedeemedCents: s.vouchers_redeemed_cents,
      finedineVouchersCents: s.finedine_vouchers_cents,
      vorschussCents: s.vorschuss_cents,
      einladungCents: s.einladung_cents,
      vectronDailyTotalCents: s.vectron_daily_total_cents,
      cashActualCents: s.cash_actual_cents,
      guestCount: s.guest_count,
      notes: s.notes,
      channelAmounts: (chanAmounts.data ?? []).map((a) => ({
        id: a.channel_id,
        label: labels.get(a.channel_id) ?? a.channel_id.slice(0, 8),
        amountCents: a.amount_cents,
      })),
      terminalAmounts: (termAmounts.data ?? []).map((a) => ({
        id: a.terminal_id,
        label: labels.get(a.terminal_id) ?? a.terminal_id.slice(0, 8),
        amountCents: a.amount_cents,
      })),
    },
  };
}

function snapshotFromInput(
  before: SessionSnapshot,
  data: UpdateSessionInput,
  labels: Map<string, string>,
): SessionSnapshot {
  return {
    vouchersSoldCents: data.vouchersSoldCents,
    vouchersRedeemedCents: data.vouchersRedeemedCents,
    // FS1: fehlendes Feld = „nicht anfassen" — Vorher-Wert bleibt.
    finedineVouchersCents: data.finedineVouchersCents ?? before.finedineVouchersCents,
    vorschussCents: data.vorschussCents,
    einladungCents: data.einladungCents,
    vectronDailyTotalCents: data.vectronDailyTotalCents ?? 0,
    cashActualCents: data.cashActualCents ?? null,
    guestCount: data.guestCount,
    notes: data.notes,
    channelAmounts: data.channelAmounts.map((c) => ({
      id: c.channelId,
      label: labels.get(c.channelId) ?? c.channelId.slice(0, 8),
      amountCents: c.amountCents,
    })),
    terminalAmounts: data.terminalAmounts.map((t) => ({
      id: t.terminalId,
      label: labels.get(t.terminalId) ?? t.terminalId.slice(0, 8),
      amountCents: t.amountCents,
    })),
  };
}

export async function updateSessionCore(caller: AdminCaller, data: UpdateSessionInput) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
      // Nach finalize ist die Sessionsicht eingefroren; Korrekturen
      // einzelner Kellner-Abrechnungen laufen über correctWaiterSettlement.
      blockIfFinalized: true,
    });
    // MA2 (N11 „ganz oder gar nicht") — Guards VOR sessions-UPDATE:
    // Ungültige Kanal/Terminal-Referenzen dürfen kein halb aktualisiertes
    // Session-Objekt hinterlassen.
    await assertChannelsAtLocation(
      caller.organizationId,
      session.location_id,
      data.channelAmounts.map((c) => c.channelId),
    );
    await assertTerminalsAtLocation(
      caller.organizationId,
      session.location_id,
      data.terminalAmounts.map((t) => t.terminalId),
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // FS1 — Verteidigung in der Tiefe: explizite Werte ≠ 0 für ein am Standort
    // deaktiviertes Session-Feld werden abgelehnt. Fehlt das Feld, bleibt der
    // Bestandswert unangetastet (kein Nullen historischer Werte).
    const { loadDisabledSessionFields } = await import("./session-fields-access");
    const disabledFields = await loadDisabledSessionFields(
      supabaseAdmin,
      caller.organizationId,
      session.location_id,
    );
    assertSessionFieldWritable(
      "finedine",
      disabledFields,
      data.finedineVouchersCents,
      "Finedine-Gutscheine",
    );
    const { error: sErr } = await supabaseAdmin
      .from("sessions")
      .update({
        vouchers_sold_cents: data.vouchersSoldCents,
        vouchers_redeemed_cents: data.vouchersRedeemedCents,
        // FS1: nur schreiben, wenn der Client das Feld geschickt hat.
        ...(data.finedineVouchersCents === undefined
          ? {}
          : { finedine_vouchers_cents: data.finedineVouchersCents }),
        vorschuss_cents: data.vorschussCents,
        einladung_cents: data.einladungCents,
        vectron_daily_total_cents: data.vectronDailyTotalCents ?? 0,
        cash_actual_cents: data.cashActualCents ?? null,
        guest_count: data.guestCount,
        notes: data.notes,
      })
      .eq("id", session.id)
      .eq("organization_id", caller.organizationId);
    if (sErr) throw sErr;

    // Kanal-Beträge: alte löschen, neue setzen (einfacher als Upsert+Diff).
    await supabaseAdmin
      .from("session_channel_amounts")
      .delete()
      .eq("session_id", session.id)
      .eq("organization_id", caller.organizationId);
    if (data.channelAmounts.length > 0) {
      const { error } = await supabaseAdmin.from("session_channel_amounts").insert(
        data.channelAmounts.map((c) => ({
          organization_id: caller.organizationId,
          session_id: session.id,
          channel_id: c.channelId,
          amount_cents: c.amountCents,
        })),
      );
      if (error) throw error;
    }
    await supabaseAdmin
      .from("session_terminal_amounts")
      .delete()
      .eq("session_id", session.id)
      .eq("organization_id", caller.organizationId);
    if (data.terminalAmounts.length > 0) {
      const { error } = await supabaseAdmin.from("session_terminal_amounts").insert(
        data.terminalAmounts.map((t) => ({
          organization_id: caller.organizationId,
          session_id: session.id,
          terminal_id: t.terminalId,
          amount_cents: t.amountCents,
        })),
      );
      if (error) throw error;
    }

    return {
      result: { ok: true as const },
      audit: {
        action: "cash.session.updated",
        entity: "session",
        entityId: session.id,
        meta: { businessDate: session.business_date },
      },
    };
  });
}

export const finalizeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sessionId: z.string().uuid(),
        confirmPoolWarning: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return finalizeSessionCore(caller, data);
  });

export async function finalizeSessionCore(
  caller: AdminCaller,
  data: { sessionId: string; confirmPoolWarning?: boolean },
) {
  return runGuarded(
    caller.role,
    "manager",
    makeAuditWriter(caller),
    async () => {
      const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
      const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
      assertCashWritable({
        businessDate: session.business_date,
        sessionStatus: session.status as "open" | "finalized" | "locked",
        sessionLockedAt: session.locked_at,
        cashLockedThroughDate: waterline,
        blockIfFinalized: true, // Doppel-Finalize verboten.
      });

      // TG1 — Abschluss-Warnung: aktiver Pool, dessen Geld nicht verteilt
      // wird (voller Pool bliebe als Rest liegen). Wahrheit aus derselben
      // Quelle wie die Verteilung — sonst schlüpfen Fälle durch wie
      // „Küchen-Pool hat Geld, aber nur Service hat Stunden" oder
      // `tip_pool_settlement_only` ohne Settlement-Minuten (Lehre
      // 02.07.2026, 423-€-Vorfall).
      const tipSettings = await loadTipSettings(caller.organizationId, session.location_id);
      const pool = await computeSessionTipPoolCore(caller, session, tipSettings);
      const kitchenDistributed = pool.shares
        .filter((sh) => sh.department === "kitchen")
        .reduce((sum, sh) => sum + sh.shareCents, 0);
      const serviceDistributed = pool.shares
        .filter((sh) => sh.department === "service")
        .reduce((sum, sh) => sum + sh.shareCents, 0);
      const kitchenWarn = poolFullyUnallocated(pool.kitchenPoolCents, kitchenDistributed);
      const serviceWarn = poolFullyUnallocated(pool.servicePoolCents, serviceDistributed);
      // Nur informativ für Meldung/Audit; die Entscheidung selbst
      // kommt aus der Verteilung, nicht aus den Minuten.
      const eligibleMinutes = pool.poolEntries
        .filter((p) => p.participates)
        .reduce((s, p) => s + p.hoursMinutes, 0);
      if ((kitchenWarn || serviceWarn) && data.confirmPoolWarning !== true) {
        throw new PoolHoursWarningError(
          pool.servicePoolCents,
          pool.kitchenPoolCents,
          eligibleMinutes,
          { serviceWarn, kitchenWarn },
        );
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("sessions")
        .update({
          status: "finalized",
          finalized_at: new Date().toISOString(),
          finalized_by: caller.staffId,
        })
        .eq("id", session.id)
        .eq("organization_id", caller.organizationId);
      if (error) throw error;
      return {
        result: { ok: true as const },
        audit: {
          action: "cash.session.finalized",
          entity: "session",
          entityId: session.id,
          meta: {
            businessDate: session.business_date,
            ...(kitchenWarn || serviceWarn
              ? {
                  poolHoursWarningConfirmed: true,
                  poolServiceCents: pool.servicePoolCents,
                  poolKitchenCents: pool.kitchenPoolCents,
                  eligibleMinutes,
                }
              : {}),
          },
        },
      };
    },
    {
      op: "cash.session.finalize",
      orgId: caller.organizationId,
      callerStaffId: caller.staffId,
      critical: true,
      tags: { session_id: data.sessionId },
    },
  );
}

export const lockSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    assertRealIdentity(caller);
    return lockSessionCore(caller, data);
  });

// Admin-only: eine bereits gesperrte Session wieder entsperren und auf
// "open" zurücksetzen, damit ein irrtümlich gesperrter Tag noch einmal
// bearbeitet werden kann. Absichtlich OHNE Wasserlinien-Prüfung — die
// Standort-Wasserlinie (cash_locks) ist bewusst monoton und blockt
// Schreibversuche unabhängig vom Session-Status. Wenn der Tag also unter
// oder auf der Wasserlinie liegt, muss die Wasserlinie separat vom Admin
// zurückgefahren werden; hier wird nur der Session-Status geändert. Die
// UI zeigt in dem Fall eine Warnung im Bestätigungsdialog.
export const unlockSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    assertRealIdentity(caller);
    return unlockSessionCore(caller, data);
  });

export async function unlockSessionCore(caller: AdminCaller, data: { sessionId: string }) {
  return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    if (session.status !== "locked") {
      throw new Error("Nur gesperrte Sessions können entsperrt werden.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sessions")
      .update({
        status: "open",
        locked_at: null,
        locked_by: null,
        finalized_at: null,
        finalized_by: null,
      })
      .eq("id", session.id)
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
    return {
      result: { ok: true as const },
      audit: {
        action: "cash.session.unlocked",
        entity: "session",
        entityId: session.id,
        meta: { businessDate: session.business_date },
      },
    };
  });
}

// Admin-only: eine bereits finalisierte Session wieder auf "open" setzen,
// damit ein Vortag nachträglich bearbeitet werden kann. Bei `locked` oder
// unterhalb der Wasserlinie bleibt die Session gesperrt.
export const reopenSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sessionId: z.string().uuid(),
        // Pflicht-Grund: ohne Begründung keine nachträgliche Öffnung.
        reason: z.string().trim().min(5, "Bitte einen Grund angeben (mind. 5 Zeichen).").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    assertRealIdentity(caller);
    return reopenSessionCore(caller, data);
  });

export async function reopenSessionCore(
  caller: AdminCaller,
  data: { sessionId: string; reason: string },
) {
  return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    if (session.status === "locked") {
      throw new Error("Session ist gesperrt und kann nicht wieder geöffnet werden.");
    }
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
      blockIfFinalized: false,
    });
    if (session.status !== "finalized") {
      throw new Error("Nur abgeschlossene Sessions können wieder geöffnet werden.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sessions")
      .update({
        status: "open",
        finalized_at: null,
        finalized_by: null,
        reopened_at: new Date().toISOString(),
        reopened_by: caller.staffId,
        reopen_reason: data.reason,
      })
      .eq("id", session.id)
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
    return {
      result: { ok: true as const },
      audit: {
        action: "cash.session.reopened",
        entity: "session",
        entityId: session.id,
        meta: { businessDate: session.business_date, reason: data.reason },
      },
    };
  });
}

export async function lockSessionCore(caller: AdminCaller, data: { sessionId: string }) {
  return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sessions")
      .update({
        status: "locked",
        locked_at: new Date().toISOString(),
        locked_by: caller.staffId,
      })
      .eq("id", session.id)
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
    return {
      result: { ok: true as const },
      audit: {
        action: "cash.session.locked",
        entity: "session",
        entityId: session.id,
        meta: { businessDate: session.business_date },
      },
    };
  });
}

export const setCashLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        throughDate: z.string().regex(ISO_DATE),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    assertRealIdentity(caller);
    return setCashLockCore(caller, data);
  });

export async function setCashLockCore(
  caller: AdminCaller,
  data: { locationId: string; throughDate: string; reason: string },
) {
  return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
    await assertLocationInOrg(caller.organizationId, data.locationId);
    const before = await loadLocationCashLock(caller.organizationId, data.locationId);
    if (before && data.throughDate <= before) {
      throw new CashLockBackwardsError();
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("cash_locks").upsert(
      {
        organization_id: caller.organizationId,
        location_id: data.locationId,
        locked_through_date: data.throughDate,
        updated_by: caller.staffId,
      },
      { onConflict: "organization_id,location_id" },
    );
    if (error) throw error;
    return {
      result: { ok: true as const, lockedThrough: data.throughDate },
      audit: {
        action: "cash.lock.advanced",
        entity: "cash_locks",
        entityId: data.locationId,
        meta: {
          locationId: data.locationId,
          from: before,
          to: data.throughDate,
          reason: data.reason,
        },
      },
    };
  });
}

// ------------------------------------------------------------------------
// Satelliten
// ------------------------------------------------------------------------

const satelliteAddSchema = z.discriminatedUnion("kind", [
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("expense"),
    description: z.string().min(1).max(500),
    amountCents: z.number().int().positive(),
  }),
  // SE1: sonstige Einnahme als Position (identisches Muster zur Ausgabe).
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("other_income"),
    description: z.string().min(1).max(500),
    amountCents: z.number().int().positive(),
  }),
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("advance"),
    staffId: z.string().uuid(),
    amountCents: z.number().int().positive(),
    note: z.string().max(500).nullable().default(null),
  }),
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("card_transaction"),
    amountCents: z.number().int().positive(),
    note: z.string().max(500).nullable().default(null),
  }),
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("bank_deposit"),
    amountCents: z.number().int().positive(),
    reference: z.string().max(500).nullable().default(null),
  }),
  z.object({
    sessionId: z.string().uuid(),
    kind: z.literal("register_transfer"),
    direction: z.enum(["to_restaurant", "to_safe", "to_other", "from_restaurant"]),
    amountCents: z.number().int().positive(),
    note: z.string().max(500).nullable().default(null),
  }),
]);

export const addSessionSatellite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => satelliteAddSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return addSessionSatelliteCore(caller, data);
  });

export type AddSatelliteInput = z.infer<typeof satelliteAddSchema>;

export async function addSessionSatelliteCore(caller: AdminCaller, data: AddSatelliteInput) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
      blockIfFinalized: true,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let createdId: string | null = null;
    if (data.kind === "expense") {
      const { data: r, error } = await supabaseAdmin
        .from("session_expenses")
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          description: data.description,
          amount_cents: data.amountCents,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    } else if (data.kind === "other_income") {
      const { data: r, error } = await otherIncomesTable(supabaseAdmin)
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          description: data.description,
          amount_cents: data.amountCents,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    } else if (data.kind === "advance") {
      const { data: r, error } = await supabaseAdmin
        .from("session_advances")
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          staff_id: data.staffId,
          amount_cents: data.amountCents,
          note: data.note,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    } else if (data.kind === "card_transaction") {
      const { data: r, error } = await supabaseAdmin
        .from("session_card_transactions")
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          amount_cents: data.amountCents,
          note: data.note,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    } else if (data.kind === "bank_deposit") {
      const { data: r, error } = await supabaseAdmin
        .from("session_bank_deposits")
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          amount_cents: data.amountCents,
          reference: data.reference,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    } else {
      const { data: r, error } = await supabaseAdmin
        .from("session_register_transfers")
        .insert({
          organization_id: caller.organizationId,
          session_id: session.id,
          direction: data.direction,
          amount_cents: data.amountCents,
          note: data.note,
        })
        .select("id")
        .single();
      if (error) throw error;
      createdId = r.id;
    }
    return {
      result: { id: createdId! },
      audit: {
        action: "cash.satellite.added",
        entity: data.kind,
        entityId: createdId!,
        meta: {
          sessionId: session.id,
          businessDate: session.business_date,
          payload: data as unknown as Json,
        },
      },
    };
  });
}

const SATELLITE_TABLE = {
  expense: "session_expenses",
  advance: "session_advances",
  card_transaction: "session_card_transactions",
  bank_deposit: "session_bank_deposits",
  register_transfer: "session_register_transfers",
} as const;

export const removeSessionSatellite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sessionId: z.string().uuid(),
        kind: z.enum([
          "expense",
          "other_income",
          "advance",
          "card_transaction",
          "bank_deposit",
          "register_transfer",
        ]),
        id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
      const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
      const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
      assertCashWritable({
        businessDate: session.business_date,
        sessionStatus: session.status as "open" | "finalized" | "locked",
        sessionLockedAt: session.locked_at,
        cashLockedThroughDate: waterline,
      });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // SE1: neue Positionstabelle über den Typ-Shim, alles andere wie bisher.
      const { error } =
        data.kind === "other_income"
          ? await otherIncomesTable(supabaseAdmin)
              .delete()
              .eq("id", data.id)
              .eq("session_id", session.id)
              .eq("organization_id", caller.organizationId)
          : await supabaseAdmin
              .from(SATELLITE_TABLE[data.kind])
              .delete()
              .eq("id", data.id)
              .eq("session_id", session.id)
              .eq("organization_id", caller.organizationId);
      if (error) throw error;
      return {
        result: { ok: true as const },
        audit: {
          action: "cash.satellite.removed",
          entity: data.kind,
          entityId: data.id,
          meta: { sessionId: session.id, businessDate: session.business_date },
        },
      };
    });
  });

// ------------------------------------------------------------------------
// Kellner: Settlement absenden
// ------------------------------------------------------------------------

const settlementInputSchema = z.object({
  posSalesCents: z.number().int().min(0),
  // Abzugebender Betrag (kassiert_brutto). Optional aus Backwards-Kompat-
  // Gründen: Wenn weggelassen, wird posSalesCents übernommen (Leistung =
  // Abgabe, kein Tisch-Transfer). UI sendet ihn immer mit.
  kassiertBruttoCents: z.number().int().min(0).optional(),
  cardTotalCents: z.number().int().min(0),
  hilfMahlCents: z.number().int().min(0),
  openInvoicesCents: z.number().int().min(0),
  // Offene Rechnungen als Liste (Reservierungsname + Cent-Betrag).
  // Wenn nicht leer, ist DAS die Wahrheit — Server summiert und
  // überschreibt openInvoicesCents. Leere Liste + openInvoicesCents > 0
  // wird als Eingabefehler abgelehnt.
  openInvoiceEntries: openInvoiceEntriesSchema.optional(),
  cashHandedInCents: z.number().int().min(0),
  // Mitarbeitende Kellner (staff_ids). Werden nach Insert in
  // `settlement_partners` verknüpft. Leere Liste = solo. Duplikate und
  // die Haupt-Kellner-Id werden serverseitig herausgefiltert bzw.
  // abgelehnt.
  partnerStaffIds: z.array(z.string().uuid()).default([]),
});

export const submitWaiterSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => settlementInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    return submitWaiterSettlementCore(caller, data);
  });

export type SubmitSettlementInput = z.input<typeof settlementInputSchema>;

export async function submitWaiterSettlementCore(caller: StaffCaller, data: SubmitSettlementInput) {
  if (!caller.isActive) throw new Error("Mitarbeiter ist inaktiv.");
  const businessDate = await getCurrentBusinessDate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Mehrstandort: alle Sessions des Tages laden. Existiert genau eine,
  // wird gegen die staff_locations-Bindung des Kellners geprüft —
  // fehlt sie, schlägt der Aufruf mit StaffLocationNotBoundError fehl.
  // Existieren mehrere (mehrere Standorte gleichzeitig offen), wird
  // die auf den Kellner passende ausgewählt.
  const { data: sessions, error: sErr } = await supabaseAdmin
    .from("sessions")
    .select("id, business_date, status, locked_at, location_id")
    .eq("organization_id", caller.organizationId)
    .eq("business_date", businessDate);
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) throw new NoOpenSessionError(businessDate);

  let session: (typeof sessions)[number];
  if (sessions.length === 1) {
    session = sessions[0];
    await assertStaffBoundToLocation(caller.organizationId, caller.staffId, session.location_id);
  } else {
    const { data: bound, error: blErr } = await supabaseAdmin
      .from("staff_locations")
      .select("location_id")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId);
    if (blErr) throw blErr;
    const boundIds = new Set((bound ?? []).map((r) => r.location_id));
    const matches = sessions.filter((s) => boundIds.has(s.location_id));
    if (matches.length === 0) {
      throw new StaffLocationNotBoundError(caller.staffId, sessions[0].location_id);
    }
    if (matches.length > 1) {
      throw new Error(
        "Mehrdeutige Session: Kellner ist an mehreren Standorten mit offener Session gebunden.",
      );
    }
    session = matches[0];
  }
  if (session.status !== "open") throw new NoOpenSessionError(businessDate);

  const settings = await loadTipSettings(caller.organizationId, session.location_id);
  const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
  assertCashWritable({
    businessDate: session.business_date,
    sessionStatus: session.status as "open" | "finalized" | "locked",
    sessionLockedAt: session.locked_at,
    cashLockedThroughDate: waterline,
  });

  // Partner-Validierung (gleiche Regeln wie correctWaiterSettlement):
  //   (a) Partner ≠ Haupt-Kellner (Selbst-Wahl verboten).
  //   (b) Partner ist an denselben Standort gebunden (Org-Zugehörigkeit
  //       implizit über staff_locations mit org-Filter).
  //   (c) Kein beteiligter Kellner (Haupt oder Partner) ist bereits in
  //       einer anderen aktiven (nicht-superseded) Abrechnung derselben
  //       Session verknüpft.
  const partnerStaffIds = Array.from(new Set(data.partnerStaffIds ?? []));
  for (const pid of partnerStaffIds) {
    if (pid === caller.staffId) {
      throw new Error("Partner-Kellner darf nicht der Haupt-Kellner sein.");
    }
    await assertStaffBoundToLocation(caller.organizationId, pid, session.location_id);
  }

  // Idempotenz: existierende aktive Zeile prüfen.
  const { data: existing } = await supabaseAdmin
    .from("waiter_settlements")
    .select(
      "id, status, auto_clockout_time_entry_id, kitchen_tip_rate, pos_sales_cents, kassiert_brutto_cents, card_total_cents, hilf_mahl_cents, open_invoices_cents, cash_handed_in_cents",
    )
    .eq("organization_id", caller.organizationId)
    .eq("session_id", session.id)
    .eq("staff_id", caller.staffId)
    .neq("status", "superseded")
    .maybeSingle();

  await assertPartnersFree(
    caller.organizationId,
    session.id,
    [caller.staffId, ...partnerStaffIds],
    existing?.id ?? null,
  );

  // Rate snapshotten: draft/neu → aktuelle Org-Rate; submitted → Bestand erhalten.
  const kitchenTipRate =
    existing && existing.status === "submitted"
      ? Number(existing.kitchen_tip_rate)
      : settings.kitchenTipRate;

  // Abzugebender Betrag: leeres Feld → Fallback auf Leistung (posSales).
  const kassiertBruttoCents = data.kassiertBruttoCents ?? data.posSalesCents;

  // Offene Rechnungen: Liste ist Wahrheit; Summe wird serverseitig neu
  // berechnet. Ohne Namen bei Summe > 0 wirft resolveOpenInvoicesInput.
  const openInvoicesResolved = resolveOpenInvoicesInput(
    data.openInvoiceEntries,
    data.openInvoicesCents,
  );

  const calc = calcWaiterSettlement({
    posSalesCents: data.posSalesCents,
    kassiertBruttoCents: kassiertBruttoCents,
    cardTotalCents: data.cardTotalCents,
    hilfMahlCents: data.hilfMahlCents,
    openInvoicesCents: openInvoicesResolved.cents,
    kitchenTipRate,
  });

  let settlementId: string;
  let alreadyAutoClockedOut = false;

  if (existing && existing.status === "submitted") {
    // Idempotenz-Pfad: keine erneuten Geld-Änderungen, keine zweite
    // clockOut-Ausführung. Wir geben die bestehende Zeile zurück.
    settlementId = existing.id;
    alreadyAutoClockedOut = existing.auto_clockout_time_entry_id !== null;
    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "cash.settlement.resubmit_noop",
      entity: "waiter_settlement",
      entityId: settlementId,
      meta: { businessDate, sessionId: session.id },
    });
  } else if (existing) {
    // Draft → submitted.
    const { error } = await supabaseAdmin
      .from("waiter_settlements")
      .update({
        pos_sales_cents: data.posSalesCents,
        kassiert_brutto_cents: kassiertBruttoCents,
        card_total_cents: data.cardTotalCents,
        hilf_mahl_cents: data.hilfMahlCents,
        open_invoices_cents: openInvoicesResolved.cents,
        open_invoices_details: toJsonbDetails(openInvoicesResolved.details),
        cash_handed_in_cents: data.cashHandedInCents,
        differenz_cents: calc.differenzCents,
        kitchen_tip_cents: calc.kitchenTipCents,
        kitchen_tip_rate: kitchenTipRate,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        partner_staff_id: null,
      })
      .eq("id", existing.id)
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
    settlementId = existing.id;
  } else {
    const { data: created, error } = await supabaseAdmin
      .from("waiter_settlements")
      .insert({
        organization_id: caller.organizationId,
        session_id: session.id,
        staff_id: caller.staffId,
        pos_sales_cents: data.posSalesCents,
        kassiert_brutto_cents: kassiertBruttoCents,
        card_total_cents: data.cardTotalCents,
        hilf_mahl_cents: data.hilfMahlCents,
        open_invoices_cents: openInvoicesResolved.cents,
        open_invoices_details: toJsonbDetails(openInvoicesResolved.details),
        cash_handed_in_cents: data.cashHandedInCents,
        differenz_cents: calc.differenzCents,
        kitchen_tip_cents: calc.kitchenTipCents,
        kitchen_tip_rate: kitchenTipRate,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        partner_staff_id: null,
      })
      .select("id")
      .single();
    if (error) throw error;
    settlementId = created.id;
  }

  // Partner-Verknüpfung schreiben (delete-then-insert, atomar aus Sicht
  // der Zeile — bestehende Zeilen kommen nur aus früheren Drafts/Submits
  // derselben Abrechnung).
  await replaceSettlementPartners(caller.organizationId, settlementId, partnerStaffIds);

  // Auto-Ausstempeln — nur wenn nicht bereits passiert.
  let autoClockoutId: string | null = null;
  let noOpenTimeEntry = false;
  if (!alreadyAutoClockedOut) {
    const { data: openTE, error: openTEErr } = await supabaseAdmin
      .from("time_entries")
      .select("id, started_at")
      .eq("staff_id", caller.staffId)
      .is("ended_at", null)
      .maybeSingle();
    if (openTEErr) {
      console.error("[settlement.autoclock] open time_entries lookup failed", openTEErr);
      throw new Error(`Auto-Ausstempeln fehlgeschlagen: ${openTEErr.message ?? "DB-Fehler"}`);
    }
    if (openTE) {
      const gross = grossMinutesBetween(new Date(openTE.started_at), new Date());
      const breakMinutes = arbzgMinimumBreak(gross);
      const closed = await performClockOut(caller, breakMinutes, {
        triggered_by: "settlement",
        settlement_id: settlementId,
        arbzg_default: true,
      });
      autoClockoutId = closed?.id ?? null;
      if (autoClockoutId) {
        const { error: linkErr } = await supabaseAdmin
          .from("waiter_settlements")
          .update({ auto_clockout_time_entry_id: autoClockoutId })
          .eq("id", settlementId)
          .eq("organization_id", caller.organizationId);
        if (linkErr) throw linkErr;
        // Service-Pool-Ende aus dem Auto-Clockout-Zeitpunkt ableiten.
        // Ersetzt die frühere, an `default_checkout` gebundene Nachzugs-
        // Logik (`syncServicePoolEndFromAutoClockout`): Service hat kein
        // festes `default_checkout` mehr — das Ende kommt aus der
        // tatsächlichen Abgabe/Ausstempelzeit.
        const { data: teRow } = await supabaseAdmin
          .from("time_entries")
          .select("ended_at")
          .eq("id", autoClockoutId)
          .maybeSingle();
        if (teRow?.ended_at) {
          await applyServicePoolEnd({
            organizationId: caller.organizationId,
            sessionId: session.id,
            staffId: caller.staffId,
            submissionIso: teRow.ended_at as string,
            businessDate,
          });
        }
      }
    } else {
      noOpenTimeEntry = true;
      // Nicht-Stempler-Zweig: Service-Pool-Ende aus dem
      // Abgabezeitpunkt setzen, damit der B-2-Writeback unten einen
      // time_entry (source='pool') erzeugen kann.
      await applyServicePoolEnd({
        organizationId: caller.organizationId,
        sessionId: session.id,
        staffId: caller.staffId,
        submissionIso: new Date().toISOString(),
        businessDate,
      });
    }
  }

  // Partner-Kellner: gleiche Behandlung wie der Haupt-Kellner —
  // offene time_entries auto-ausstempeln UND Service-Pool-Ende setzen,
  // damit der Nicht-Stempler-Pfad im B-2-Writeback greift. Ohne diesen
  // Block bleibt der Partner mit shift_end=NULL im Pool zurück; sein
  // Pool-time_entry wird dann von syncPoolTimeEntry gelöscht statt
  // erzeugt (Live-Fall COCO am 06.07.). Best-effort: pro Partner
  // gekapselt, damit ein Fehler bei einem Partner die Abgabe nicht kippt.
  const submissionIso = new Date().toISOString();
  for (const partnerStaffId of partnerStaffIds) {
    try {
      const { data: openPartnerTE, error: openPartnerErr } = await supabaseAdmin
        .from("time_entries")
        .select("id, started_at")
        .eq("staff_id", partnerStaffId)
        .is("ended_at", null)
        .maybeSingle();
      if (openPartnerErr) {
        throw new Error(
          `Partner-Auto-Ausstempeln: DB-Lookup fehlgeschlagen (${openPartnerErr.message ?? "unbekannt"})`,
        );
      }
      let partnerEndedAt: string = submissionIso;
      if (openPartnerTE) {
        const gross = grossMinutesBetween(new Date(openPartnerTE.started_at), new Date());
        const breakMinutes = arbzgMinimumBreak(gross);
        const partnerCaller: StaffCaller = { ...caller, staffId: partnerStaffId };
        const closedPartner = await performClockOut(partnerCaller, breakMinutes, {
          triggered_by: "settlement_partner",
          settlement_id: settlementId,
          arbzg_default: true,
          primary_staff_id: caller.staffId,
        });
        if (closedPartner?.endedAt) partnerEndedAt = closedPartner.endedAt;
      }
      await applyServicePoolEnd({
        organizationId: caller.organizationId,
        sessionId: session.id,
        staffId: partnerStaffId,
        submissionIso: partnerEndedAt,
        businessDate,
      });
    } catch (err) {
      console.error("[settlement.partner-autoclock] failed", { partnerStaffId, err });
      try {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: "cash.settlement.partner_autoclock_failed",
          entity: "waiter_settlement",
          entityId: settlementId,
          meta: {
            sessionId: session.id,
            businessDate,
            partnerStaffId,
            error: String(err).slice(0, 300),
          },
        });
      } catch (auditErr) {
        console.error("[settlement.partner-autoclock] audit failed", auditErr);
      }
    }
  }

  // B-2: Pool-Zeit-Rückschreibung als time_entries (source='pool') für
  // Nicht-Stempler. Aktualisierend via syncPoolTimeEntry — überschreibt
  // frühere Pool-Zeiten und entfernt sie, wenn ein echter Stempel oder
  // eine geleerte Zeit vorliegt. Best-effort — Fehler dürfen die Abgabe
  // NICHT kippen.
  let poolWritebackChanged = 0;
  let poolWritebackSkippedLocked = false;
  try {
    await assertBusinessDateUnlocked(supabaseAdmin, caller.organizationId, businessDate);
    const { data: poolRows } = await supabaseAdmin
      .from("session_tip_pool_entries")
      .select("id, staff_id, department, shift_start, shift_end")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id);
    for (const p of poolRows ?? []) {
      const outcome = await syncPoolTimeEntry({
        organizationId: caller.organizationId,
        locationId: session.location_id,
        businessDate,
        entryId: p.id,
        staffId: p.staff_id,
        department: p.department as "kitchen" | "service" | "gl",
        shiftStart: (p.shift_start as string | null) ?? null,
        shiftEnd: (p.shift_end as string | null) ?? null,
      });
      if (outcome.changed) poolWritebackChanged += 1;
    }

    if (poolWritebackChanged > 0) {
      await writeAuditLog({
        organizationId: caller.organizationId,
        actorUserId: caller.userId,
        actorStaffId: caller.staffId,
        action: "pool_time.writeback",
        entity: "session",
        entityId: session.id,
        meta: { sessionId: session.id, businessDate, changed: poolWritebackChanged },
      });
    }
  } catch (err) {
    if (err instanceof TimeLockedError) {
      poolWritebackSkippedLocked = true;
    } else {
      // Best-effort: nicht werfen, damit die Abgabe nicht kippt.
      console.error("[pool-time-writeback] failed", err);
      // §51: Best-effort-Catches müssen eine auffindbare Spur hinterlassen —
      // sonst scheitert die Rückschreibung tagelang unsichtbar (Live-Fall 30.06.–03.07.).
      try {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: "pool_time.writeback_failed",
          entity: "session",
          entityId: session.id,
          meta: {
            sessionId: session.id,
            businessDate,
            error: String(err).slice(0, 300),
          },
        });
      } catch (auditErr) {
        console.error("[pool-time-writeback] audit failed", auditErr);
      }
    }
  }
  void poolWritebackSkippedLocked;

  await writeAuditLog({
    organizationId: caller.organizationId,
    actorUserId: caller.userId,
    actorStaffId: caller.staffId,
    action: "cash.settlement.submitted",
    entity: "waiter_settlement",
    entityId: settlementId,
    meta: {
      businessDate,
      sessionId: session.id,
      idempotent: existing?.status === "submitted",
      autoClockoutTimeEntryId: autoClockoutId,
      noOpenTimeEntry,
    },
  });

  return {
    settlementId,
    differenzCents: calc.differenzCents,
    kitchenTipCents: calc.kitchenTipCents,
    autoClockoutTimeEntryId: autoClockoutId,
    noOpenTimeEntry,
    idempotent: existing?.status === "submitted",
  };
}

// ------------------------------------------------------------------------
// Manager: Korrektur
// ------------------------------------------------------------------------

const correctSchema = z.object({
  originalId: z.string().uuid(),
  posSalesCents: z.number().int().min(0),
  kassiertBruttoCents: z.number().int().min(0).optional(),
  cardTotalCents: z.number().int().min(0),
  hilfMahlCents: z.number().int().min(0),
  openInvoicesCents: z.number().int().min(0),
  openInvoiceEntries: openInvoiceEntriesSchema.optional(),
  cashHandedInCents: z.number().int().min(0),
  partnerStaffIds: z.array(z.string().uuid()).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const correctWaiterSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => correctSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return correctWaiterSettlementCore(caller, data);
  });

export type CorrectSettlementInput = z.infer<typeof correctSchema>;

export async function correctWaiterSettlementCore(
  caller: AdminCaller,
  data: CorrectSettlementInput,
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: original, error: loadErr } = await supabaseAdmin
      .from("waiter_settlements")
      .select(
        "id, organization_id, session_id, staff_id, partner_staff_id, status, kitchen_tip_rate",
      )
      .eq("id", data.originalId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!original) throw new Error("Original-Settlement nicht gefunden.");
    if (original.status !== "submitted" && original.status !== "corrected") {
      throw new SettlementNotCorrectableError(original.id, original.status);
    }

    const session = await loadSessionWithLock(caller.organizationId, original.session_id);
    // Partner-Validierung. `undefined` = Partner unverändert übernehmen
    // (aus settlement_partners der Original-Zeile). Explizit `[]` =
    // leeren.
    let newPartnerIds: string[];
    if (data.partnerStaffIds === undefined) {
      const { data: existingParts, error: epErr } = await supabaseAdmin
        .from("settlement_partners")
        .select("staff_id")
        .eq("organization_id", caller.organizationId)
        .eq("settlement_id", original.id);
      if (epErr) throw epErr;
      newPartnerIds = (existingParts ?? []).map((r) => r.staff_id);
    } else {
      newPartnerIds = Array.from(new Set(data.partnerStaffIds));
    }
    for (const pid of newPartnerIds) {
      if (pid === original.staff_id) {
        throw new Error("Partner-Kellner darf nicht der Haupt-Kellner sein.");
      }
      await assertStaffBoundToLocation(caller.organizationId, pid, session.location_id);
    }
    await assertPartnersFree(
      caller.organizationId,
      session.id,
      [original.staff_id, ...newPartnerIds],
      original.id,
    );
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    // Korrektur erlaubt bei open + finalized; gesperrt bei locked / Wasserlinie.
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
    });

    // Rate ERBEN vom Original — Rate-Änderung darf rückwirkend nichts ändern.
    const inheritedRate = Number(original.kitchen_tip_rate);
    const kassiertBruttoCents = data.kassiertBruttoCents ?? data.posSalesCents;
    const openInvoicesResolved = resolveOpenInvoicesInput(
      data.openInvoiceEntries,
      data.openInvoicesCents,
    );
    const calc = calcWaiterSettlement({
      posSalesCents: data.posSalesCents,
      kassiertBruttoCents: kassiertBruttoCents,
      cardTotalCents: data.cardTotalCents,
      hilfMahlCents: data.hilfMahlCents,
      openInvoicesCents: openInvoicesResolved.cents,
      kitchenTipRate: inheritedRate,
    });

    // Reihenfolge: Original superseden ZUERST, damit der partial-Unique-Index
    // (status <> 'superseded') beim Einfügen der neuen Zeile nicht kollidiert.
    const { error: supErr } = await supabaseAdmin
      .from("waiter_settlements")
      .update({ status: "superseded" })
      .eq("id", original.id)
      .eq("organization_id", caller.organizationId);
    if (supErr) throw supErr;

    const { data: created, error: insErr } = await supabaseAdmin
      .from("waiter_settlements")
      .insert({
        organization_id: caller.organizationId,
        session_id: original.session_id,
        staff_id: original.staff_id,
        partner_staff_id: null,
        pos_sales_cents: data.posSalesCents,
        kassiert_brutto_cents: kassiertBruttoCents,
        card_total_cents: data.cardTotalCents,
        hilf_mahl_cents: data.hilfMahlCents,
        open_invoices_cents: openInvoicesResolved.cents,
        open_invoices_details: toJsonbDetails(openInvoicesResolved.details),
        cash_handed_in_cents: data.cashHandedInCents,
        differenz_cents: calc.differenzCents,
        kitchen_tip_cents: calc.kitchenTipCents,
        kitchen_tip_rate: inheritedRate,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        corrected_from_id: original.id,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    await replaceSettlementPartners(caller.organizationId, created.id, newPartnerIds);

    return {
      result: { newId: created.id, originalId: original.id },
      audit: {
        action: "cash.settlement.corrected",
        entity: "waiter_settlement",
        entityId: created.id,
        meta: {
          originalId: original.id,
          newId: created.id,
          reason: data.reason,
          inheritedKitchenTipRate: inheritedRate,
          businessDate: session.business_date,
        },
      },
    };
  });
}

// Re-export für UI/Test-Konsum.
export { CashLockedError };

// ------------------------------------------------------------------------
// Admin: Manuelle Neuanlage einer Kellner-Abrechnung
// ------------------------------------------------------------------------
//
// Reine Geld-Erfassung durch Admin/Manager. KEIN Auto-Clockout (im
// Gegensatz zu submitWaiterSettlement). Kitchen-Tip-Rate wird zum
// Zeitpunkt der Anlage aus den aktuellen Org-Settings gesnapshottet
// (es gibt kein Original, von dem geerbt werden könnte).

const adminCreateSettlementSchema = z.object({
  sessionId: z.string().uuid(),
  staffId: z.string().uuid(),
  posSalesCents: z.number().int().min(0),
  kassiertBruttoCents: z.number().int().min(0).optional(),
  cardTotalCents: z.number().int().min(0),
  hilfMahlCents: z.number().int().min(0),
  openInvoicesCents: z.number().int().min(0),
  openInvoiceEntries: openInvoiceEntriesSchema.optional(),
  cashHandedInCents: z.number().int().min(0),
  partnerStaffIds: z.array(z.string().uuid()).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const adminCreateWaiterSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminCreateSettlementSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return adminCreateWaiterSettlementCore(caller, data);
  });

export type AdminCreateSettlementInput = z.infer<typeof adminCreateSettlementSchema>;

export async function adminCreateWaiterSettlementCore(
  caller: AdminCaller,
  data: AdminCreateSettlementInput,
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    // Anlage erlaubt bei open/finalized; gesperrt bei locked/Wasserlinie
    // (gleiche Regeln wie correctWaiterSettlement).
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
    });

    await assertStaffBoundToLocation(caller.organizationId, data.staffId, session.location_id);
    const partnerStaffIds = Array.from(new Set(data.partnerStaffIds ?? []));
    for (const pid of partnerStaffIds) {
      if (pid === data.staffId) {
        throw new Error("Partner-Kellner darf nicht der Haupt-Kellner sein.");
      }
      await assertStaffBoundToLocation(caller.organizationId, pid, session.location_id);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Duplikate verhindern — falls bereits aktive Zeile, Korrektur-Pfad nutzen.
    // WICHTIG: Diese typisierte Prüfung MUSS vor assertPartnersFree laufen,
    // sonst schluckt der generische Doppelbelegungs-Fehler den typisierten
    // WaiterSettlementAlreadyExistsError (Nachprüfung §88, Fund 4).
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("waiter_settlements")
      .select("id, status")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .eq("staff_id", data.staffId)
      .neq("status", "superseded")
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing) throw new WaiterSettlementAlreadyExistsError(session.id, data.staffId);

    await assertPartnersFree(
      caller.organizationId,
      session.id,
      [data.staffId, ...partnerStaffIds],
      null,
    );

    const settings = await loadTipSettings(caller.organizationId, session.location_id);
    const kassiertBruttoCents = data.kassiertBruttoCents ?? data.posSalesCents;
    const openInvoicesResolved = resolveOpenInvoicesInput(
      data.openInvoiceEntries,
      data.openInvoicesCents,
    );
    const calc = calcWaiterSettlement({
      posSalesCents: data.posSalesCents,
      kassiertBruttoCents: kassiertBruttoCents,
      cardTotalCents: data.cardTotalCents,
      hilfMahlCents: data.hilfMahlCents,
      openInvoicesCents: openInvoicesResolved.cents,
      kitchenTipRate: settings.kitchenTipRate,
    });

    const { data: created, error: insErr } = await supabaseAdmin
      .from("waiter_settlements")
      .insert({
        organization_id: caller.organizationId,
        session_id: session.id,
        staff_id: data.staffId,
        partner_staff_id: null,
        pos_sales_cents: data.posSalesCents,
        kassiert_brutto_cents: kassiertBruttoCents,
        card_total_cents: data.cardTotalCents,
        hilf_mahl_cents: data.hilfMahlCents,
        open_invoices_cents: openInvoicesResolved.cents,
        open_invoices_details: toJsonbDetails(openInvoicesResolved.details),
        cash_handed_in_cents: data.cashHandedInCents,
        differenz_cents: calc.differenzCents,
        kitchen_tip_cents: calc.kitchenTipCents,
        kitchen_tip_rate: settings.kitchenTipRate,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    await replaceSettlementPartners(caller.organizationId, created.id, partnerStaffIds);

    return {
      result: {
        newId: created.id,
        differenzCents: calc.differenzCents,
        kitchenTipCents: calc.kitchenTipCents,
      },
      audit: {
        action: "cash.settlement.admin_created",
        entity: "waiter_settlement",
        entityId: created.id,
        meta: {
          sessionId: session.id,
          staffId: data.staffId,
          businessDate: session.business_date,
          reason: data.reason,
          kitchenTipRate: settings.kitchenTipRate,
        },
      },
    };
  });
}

// ------------------------------------------------------------------------
// B3c-2 — Kassensaldo-Kette (Carry-over) über einen Datumsbereich
// ------------------------------------------------------------------------
//
// Liest alle Sessions im Bereich [fromDate, toDate] (admin-only,
// organization_id-scoped), baut je Session einen DayInput, aggregiert
// gleiche business_date-Tage und reicht das Ganze durch accumulateChain
// aus cash-ledger.ts. Opening-Balance des ersten Tages = Σ
// opening_balance_cents aller Sessions an diesem Tag — damit closing[N]
// = opening[N+1] strikt innerhalb des Bereichs gilt.

import {
  accumulateChain,
  computeDailyCash,
  effectiveVorschussCents,
  type DayInput,
  type TransferDirection,
} from "./cash-ledger";
import { computeSafeChain, type SafeDayInput } from "./safe-balance";
import { rollOperativeDeficitCents } from "./cash-summary";

// Pro Tag aggregierter Roh-Datensatz. Wird sowohl von getCashLedgerCore
// (Saldokette) als auch von getCashDailyBreakdownCore (Bargeldübersicht)
// genutzt. Felder & Befüllung sind 1:1 aus der vorherigen Inline-Variante
// in getCashLedgerCore extrahiert — keine Verhaltensänderung.
export type CashDayAgg = {
  statuses: Set<string>;
  grossRevenue: number;
  vectronDailyTotal: number;
  cardTotal: number;
  deliverySouse: number;
  deliveryVectron: number;
  deliveryWolt: number;
  vouchersSold: number;
  vouchersRedeemed: number;
  finedine: number;
  einladung: number;
  sonstige: number;
  /**
   * SE1: Einzelpositionen der sonstigen Einnahmen des Tages (Beschreibung +
   * Betrag). `sonstige` ist ihre Summe — die EINE Rechenquelle; das frühere
   * Session-Feld wird nicht mehr gelesen.
   */
  otherIncomes: Array<{ description: string; amountCents: number }>;
  vorschuss: number;
  openInvoices: number[];
  expenses: number[];
  advances: number[];
  bankDeposits: number[];
  cardTransactions: number[];
  transfers: Array<{ direction: TransferDirection; amountCents: number }>;
  openingBalance: number;
  totalRevenueGross: number;
  totalExpenses: number;
  differenz: number;
  cashActualSum: number;
  cashActualCount: number;
  sessionCount: number;
  /**
   * Summe der Soll-Wechselgeld-Ziele der Sessions dieses Tages, aufgelöst
   * nach "Location-Ziel ?? Org-Ziel". Wird von getCashLedgerCore statt
   * `orgTarget * sessionCount` verwendet, damit Standorte mit abweichendem
   * Ziel den Tresor-/Kassenbuch-Verlauf korrekt beeinflussen.
   */
  cashTargetSum: number;
};

export type CashDayAggregates = {
  sortedDates: string[];
  firstDate: string;
  byDate: Map<string, CashDayAgg>;
};

function makeEmptyAgg(): CashDayAgg {
  return {
    statuses: new Set(),
    grossRevenue: 0,
    vectronDailyTotal: 0,
    cardTotal: 0,
    deliverySouse: 0,
    deliveryVectron: 0,
    deliveryWolt: 0,
    vouchersSold: 0,
    vouchersRedeemed: 0,
    finedine: 0,
    einladung: 0,
    sonstige: 0,
    otherIncomes: [],
    vorschuss: 0,
    openInvoices: [],
    expenses: [],
    advances: [],
    bankDeposits: [],
    cardTransactions: [],
    transfers: [],
    openingBalance: 0,
    totalRevenueGross: 0,
    totalExpenses: 0,
    differenz: 0,
    cashActualSum: 0,
    cashActualCount: 0,
    sessionCount: 0,
    cashTargetSum: 0,
  };
}

/**
 * Routet einen Kanal-Betrag in den richtigen Akkumulator.
 *
 * Wichtige Invariante: `delivery_vectron` (In-House Take-away) ist Vectron-Bar
 * und bereits in `vectron_daily_total_cents` enthalten. Er darf NICHT mit
 * `delivery_souse` zusammengelegt werden — sonst zieht `computeDailyCash` ihn
 * zusätzlich ab und das Bargeld wird um den Take-away-Betrag zu niedrig.
 */
export function applyRevenueChannel(a: CashDayAgg, kind: string | null, amt: number): void {
  switch (kind) {
    case "pos":
      a.grossRevenue += amt;
      break;
    case "delivery_souse":
      a.deliverySouse += amt;
      break;
    case "delivery_vectron":
      a.deliveryVectron += amt;
      break;
    case "delivery_wolt":
      a.deliveryWolt += amt;
      break;
    case "voucher_sold":
      a.vouchersSold += amt;
      break;
    case "voucher_redeemed":
      a.vouchersRedeemed += amt;
      break;
    case "finedine":
      a.finedine += amt;
      break;
    case "einladung":
      a.einladung += amt;
      break;
    case "sonstige":
      a.sonstige += amt;
      break;
    default:
      break;
  }
}

// 1:1-Extraktion der bisherigen Inline-Reads + Aggregation aus
// getCashLedgerCore. Verhaltensgleich.
export async function loadCashDayAggregates(
  caller: AdminCaller,
  data: { fromDate: string; toDate: string; locationId?: string },
): Promise<CashDayAggregates> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let sessionQuery = supabaseAdmin
    .from("sessions")
    .select(
      "id, business_date, status, location_id, opening_balance_cents, vouchers_sold_cents, vouchers_redeemed_cents, finedine_vouchers_cents, vorschuss_cents, einladung_cents, cash_actual_cents, vectron_daily_total_cents",
    )
    .eq("organization_id", caller.organizationId)
    .gte("business_date", data.fromDate)
    .lte("business_date", data.toDate);
  if (data.locationId) {
    sessionQuery = sessionQuery.eq("location_id", data.locationId);
  }
  const { data: sessions, error: sErr } = await sessionQuery.order("business_date", {
    ascending: true,
  });
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) {
    return { sortedDates: [], firstDate: "", byDate: new Map() };
  }

  const sessionIds = sessions.map((s) => s.id);

  // Location- und Org-Ziel für die per-Session-Auflösung "Location ?? Org"
  // laden — dieselbe Regel wie überall sonst in der Kassen-Logik.
  const locationIds = Array.from(new Set(sessions.map((s) => s.location_id).filter(Boolean)));
  const [locRes, orgRes] = await Promise.all([
    locationIds.length
      ? supabaseAdmin
          .from("locations")
          .select("id, cash_balance_target_cents")
          .eq("organization_id", caller.organizationId)
          .in("id", locationIds)
      : Promise.resolve({ data: [], error: null } as {
          data: Array<{ id: string; cash_balance_target_cents: number | null }>;
          error: null;
        }),
    supabaseAdmin
      .from("organizations")
      .select("cash_balance_target_cents")
      .eq("id", caller.organizationId)
      .maybeSingle(),
  ]);
  if (locRes.error) throw locRes.error;
  if (orgRes.error) throw orgRes.error;
  const orgTargetCents = Number(orgRes.data?.cash_balance_target_cents ?? 200_000);
  const locTargetById = new Map<string, number>(
    (locRes.data ?? []).map((l) => [
      l.id as string,
      l.cash_balance_target_cents == null ? orgTargetCents : Number(l.cash_balance_target_cents),
    ]),
  );

  const [chRes, tRes, expRes, advRes, depRes, trRes, wsRes, oiRes] = await Promise.all([
    supabaseAdmin
      .from("session_channel_amounts")
      .select("session_id, amount_cents, revenue_channels(kind)")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_terminal_amounts")
      .select("session_id, amount_cents, payment_terminals!inner(is_gl)")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_expenses")
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_advances")
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_bank_deposits")
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_register_transfers")
      .select("session_id, direction, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("waiter_settlements")
      .select("session_id, open_invoices_cents, differenz_cents, status")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds)
      .neq("status", "superseded"),
    // SE1: sonstige Einnahmen als Positionsliste.
    otherIncomesTable(supabaseAdmin)
      .select("session_id, description, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true }),
  ]);
  if (chRes.error) throw chRes.error;
  if (tRes.error) throw tRes.error;
  if (expRes.error) throw expRes.error;
  if (advRes.error) throw advRes.error;
  if (depRes.error) throw depRes.error;
  if (trRes.error) throw trRes.error;
  if (wsRes.error) throw wsRes.error;
  if (oiRes.error) throw oiRes.error;

  const byDate = new Map<string, CashDayAgg>();
  const sessionDate = new Map<string, string>();
  const sortedDates = Array.from(new Set(sessions.map((s) => s.business_date))).sort();
  const firstDate = sortedDates[0];

  function getAgg(date: string): CashDayAgg {
    let a = byDate.get(date);
    if (!a) {
      a = makeEmptyAgg();
      byDate.set(date, a);
    }
    return a;
  }

  for (const s of sessions) {
    sessionDate.set(s.id, s.business_date);
    const a = getAgg(s.business_date);
    a.statuses.add(s.status as string);
    a.sessionCount += 1;
    if (s.cash_actual_cents !== null && s.cash_actual_cents !== undefined) {
      a.cashActualSum += Number(s.cash_actual_cents);
      a.cashActualCount += 1;
    }
    a.vouchersSold += Number(s.vouchers_sold_cents ?? 0);
    a.vouchersRedeemed += Number(s.vouchers_redeemed_cents ?? 0);
    a.finedine += Number(s.finedine_vouchers_cents ?? 0);
    a.einladung += Number(s.einladung_cents ?? 0);
    a.vorschuss += Number(s.vorschuss_cents ?? 0);
    a.vectronDailyTotal += Number(s.vectron_daily_total_cents ?? 0);
    a.cashTargetSum += locTargetById.get(s.location_id as string) ?? orgTargetCents;
    if (s.business_date === firstDate) {
      a.openingBalance += Number(s.opening_balance_cents ?? 0);
    }
  }

  for (const r of chRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    const a = getAgg(d);
    const amt = Number(r.amount_cents);
    a.totalRevenueGross += amt;
    const kind = (r.revenue_channels as { kind: string } | null)?.kind ?? null;
    applyRevenueChannel(a, kind, amt);
  }
  for (const r of tRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    // GL-Karten sind Kontrollposten und mindern das Tages-Bargeld nicht
    // (Referenz: Legacy-tagesabrechnung). Nur physische Terminals summieren.
    if ((r.payment_terminals as { is_gl: boolean } | null)?.is_gl) continue;
    getAgg(d).cardTotal += Number(r.amount_cents);
  }
  for (const r of expRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    const a = getAgg(d);
    const amt = Number(r.amount_cents);
    a.expenses.push(amt);
    a.totalExpenses += amt;
  }
  for (const r of advRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    getAgg(d).advances.push(Number(r.amount_cents));
  }
  for (const r of depRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    getAgg(d).bankDeposits.push(Number(r.amount_cents));
  }
  for (const r of trRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    getAgg(d).transfers.push({
      direction: r.direction as TransferDirection,
      amountCents: Number(r.amount_cents),
    });
  }
  for (const r of wsRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    const a = getAgg(d);
    a.openInvoices.push(Number(r.open_invoices_cents));
    a.differenz += Number(r.differenz_cents);
  }
  for (const r of oiRes.data ?? []) {
    const d = sessionDate.get(r.session_id);
    if (!d) continue;
    const a = getAgg(d);
    const amt = Number(r.amount_cents);
    a.otherIncomes.push({ description: r.description, amountCents: amt });
    a.sonstige += amt;
  }

  return { sortedDates, firstDate, byDate };
}

// 1:1-Extraktion der bisherigen Agg → DayInput-Abbildung.
export function aggToDayInput(date: string, a: CashDayAgg): DayInput {
  return {
    businessDate: date,
    grossRevenueCents: a.grossRevenue,
    cardTotalCents: a.cardTotal,
    deliverySouseCents: a.deliverySouse,
    deliveryWoltCents: a.deliveryWolt,
    vouchersSoldCents: a.vouchersSold,
    vouchersRedeemedCents: a.vouchersRedeemed,
    finedineVouchersCents: a.finedine,
    einladungCents: a.einladung,
    openInvoicesCents: a.openInvoices,
    sonstigeEinnahmeCents: a.sonstige,
    vorschussCents: a.vorschuss,
    tipRemainderCents: 0,
    satellites: {
      expensesCents: a.expenses,
      advancesCents: a.advances,
      cardTransactionsCents: a.cardTransactions,
      bankDepositsCents: a.bankDeposits,
      registerTransfers: a.transfers,
    },
  };
}

export type CashLedgerRow = {
  businessDate: string;
  status: "open" | "finalized" | "locked" | "mixed" | "none";
  openingBalanceCents: number;
  totalRevenueCents: number;
  totalExpensesCents: number;
  closingBalanceCents: number;
  differenzCents: number;
  cashActualCents: number | null;
  surplusCents: number | null;
  shortfallCents: number | null;
  safeBalanceCents: number;
};

export const getCashLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(ISO_DATE),
        toDate: z.string().regex(ISO_DATE),
      })
      .refine((v) => v.fromDate <= v.toDate, { message: "fromDate > toDate" })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return getCashLedgerCore(caller, data);
  });

export async function getCashLedgerCore(
  caller: AdminCaller,
  data: { fromDate: string; toDate: string },
): Promise<CashLedgerRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { sortedDates, firstDate, byDate } = await loadCashDayAggregates(caller, data);
  if (sortedDates.length === 0) return [];

  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("cash_balance_target_cents, opening_safe_balance_cents")
    .eq("id", caller.organizationId)
    .maybeSingle();
  if (orgErr) throw orgErr;
  const openingSafe = Number(org?.opening_safe_balance_cents ?? 200_000);

  const days: DayInput[] = sortedDates.map((date) => aggToDayInput(date, byDate.get(date)!));

  const openingBalanceCents = byDate.get(firstDate)!.openingBalance;
  const chain = accumulateChain(openingBalanceCents, days);

  const safeDays: SafeDayInput[] = sortedDates.map((date) => {
    const a = byDate.get(date)!;
    return {
      businessDate: date,
      cashActualCents: a.cashActualCount > 0 ? a.cashActualSum : null,
      // Pro-Session aufgelöst nach "Location-Ziel ?? Org-Ziel" (siehe
      // loadCashDayAggregates). Fällt auf den Org-Wert zurück, wenn ein Tag
      // keine Sessions hat (sollte durch sortedDates ohnehin ausgeschlossen sein).
      cashTargetCents: a.sessionCount > 0 ? a.cashTargetSum : 200_000,
      bankDepositsCents: a.bankDeposits,
    };
  });
  const safeChain = computeSafeChain(openingSafe, safeDays);

  return sortedDates.map((date, i) => {
    const a = byDate.get(date)!;
    const r = chain[i];
    const sr = safeChain[i];
    const statuses = Array.from(a.statuses);
    const status: CashLedgerRow["status"] =
      statuses.length === 0
        ? "none"
        : statuses.length === 1
          ? (statuses[0] as CashLedgerRow["status"])
          : "mixed";
    return {
      businessDate: date,
      status,
      openingBalanceCents: r.previousCarryCents,
      totalRevenueCents: a.totalRevenueGross,
      totalExpensesCents: a.totalExpenses,
      closingBalanceCents: r.remainingCashCents,
      differenzCents: a.differenz,
      cashActualCents: sr.cashActualCents,
      surplusCents: sr.surplusCents,
      shortfallCents: sr.shortfallCents,
      safeBalanceCents: sr.safeBalanceCents,
    };
  });
}

// ------------------------------------------------------------------------
// Tägliche Bargeldübersicht (kein Carry-over, pro Tag eigenständig)
// ------------------------------------------------------------------------

export type CashDailyRow = {
  businessDate: string;
  tagesumsatzCents: number;
  kreditkartenCents: number;
  deliverySouseCents: number;
  deliveryVectronCents: number;
  deliveryWoltCents: number;
  finedineCents: number;
  vouchersRedeemedCents: number;
  vouchersSoldCents: number;
  einladungCents: number;
  openInvoicesCents: number;
  vorschussCents: number;
  expensesCents: number;
  sonstigeEinnahmeCents: number;
  /**
   * SE1: Einzelpositionen der sonstigen Einnahmen (Datum · Beschreibung ·
   * Betrag im Export). `sonstigeEinnahmeCents` bleibt ihre Summe.
   */
  otherIncomes: Array<{ description: string; amountCents: number }>;
  bargeldCents: number;
  /**
   * Trinkgeld-Rest des Tages (kitchen + service). Selbe Quelle wie
   * `getTipRemainderByPeriod` — beide Sichten müssen zwangsläufig
   * denselben Wert zeigen (identische Berechnung via
   * `computeSessionTipPoolCore`).
   */
  tipRemainderCents: number;
};

export const getCashDailyBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(ISO_DATE),
        toDate: z.string().regex(ISO_DATE),
        locationId: z.string().uuid().optional(),
      })
      .refine((v) => v.fromDate <= v.toDate, { message: "fromDate > toDate" })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    if (data.locationId) {
      await assertLocationInOrg(caller.organizationId, data.locationId);
    }
    return getCashDailyBreakdownCore(caller, data);
  });

export async function getCashDailyBreakdownCore(
  caller: AdminCaller,
  data: { fromDate: string; toDate: string; locationId?: string },
): Promise<CashDailyRow[]> {
  const { sortedDates, byDate } = await loadCashDayAggregates(caller, data);
  const tipByDate = await computeTipRemaindersByDate(caller, data);
  return sortedDates.map((date) => {
    const a = byDate.get(date)!;
    const day: DayInput = {
      ...aggToDayInput(date, a),
      grossRevenueCents: a.vectronDailyTotal,
    };
    return {
      businessDate: date,
      tagesumsatzCents: a.vectronDailyTotal,
      kreditkartenCents: a.cardTotal,
      deliverySouseCents: a.deliverySouse,
      deliveryVectronCents: a.deliveryVectron,
      deliveryWoltCents: a.deliveryWolt,
      finedineCents: a.finedine,
      vouchersRedeemedCents: a.vouchersRedeemed,
      vouchersSoldCents: a.vouchersSold,
      einladungCents: a.einladung,
      openInvoicesCents: a.openInvoices.reduce((s, x) => s + x, 0),
      vorschussCents: effectiveVorschussCents(day),
      expensesCents: a.expenses.reduce((s, x) => s + x, 0),
      sonstigeEinnahmeCents: a.sonstige,
      otherIncomes: a.otherIncomes,
      bargeldCents: computeDailyCash(day),
      tipRemainderCents: tipByDate.get(date) ?? 0,
    };
  });
}

// Aggregiert den Trinkgeld-Rest pro Geschäftstag über alle Sessions im
// Zeitraum. Nutzt EXAKT dieselbe Berechnung wie `getTipRemainderByPeriod`
// (computeSessionTipPoolCore + loadTipSettings pro Session-Location) —
// keine Duplikation der Rest-Formel.
async function computeTipRemaindersByDate(
  caller: AdminCaller,
  data: { fromDate: string; toDate: string; locationId?: string },
): Promise<Map<string, number>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("sessions")
    .select("id, business_date, status, locked_at, location_id, tip_pool_settlement_only")
    .eq("organization_id", caller.organizationId)
    .gte("business_date", data.fromDate)
    .lte("business_date", data.toDate);
  if (data.locationId) q = q.eq("location_id", data.locationId);
  const { data: sessions, error } = await q;
  if (error) throw error;
  const out = new Map<string, number>();
  const settingsCache = new Map<string, Awaited<ReturnType<typeof loadTipSettings>>>();
  for (const s of sessions ?? []) {
    const locId = s.location_id as string;
    let settings = settingsCache.get(locId);
    if (!settings) {
      settings = await loadTipSettings(caller.organizationId, locId);
      settingsCache.set(locId, settings);
    }
    const res = await computeSessionTipPoolCore(caller, s as unknown as LoadedSession, settings);
    const date = s.business_date as string;
    out.set(date, (out.get(date) ?? 0) + res.kitchenRemainder + res.serviceRemainder);
  }
  return out;
}

// ------------------------------------------------------------------------
// B4 — Manuelle Trinkgeldpool-Einträge (Manager+)
// ------------------------------------------------------------------------
//
// Ein manueller Eintrag pro (session, staff) ersetzt — falls vorhanden —
// die aus time_entries abgeleiteten Pool-Stunden desselben Mitarbeiters
// vollständig. hours_minutes = 0 schließt den Mitarbeiter explizit aus.

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const tipPoolEntryUpsertSchema = z
  .object({
    sessionId: z.string().uuid(),
    staffId: z.string().uuid(),
    department: z.enum(["kitchen", "service", "gl"]),
    hoursMinutes: z.number().int().min(0).max(1440).optional(),
    shiftStart: z.string().regex(HHMM_RE).optional(),
    shiftEnd: z.string().regex(HHMM_RE).optional(),
    note: z.string().trim().max(500).optional(),
    // NULL/undefined = Standard (staff.participates_in_pool).
    // true/false übersteuern die Pool-Teilnahme pro Session.
    participates: z.boolean().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const hasShift = v.shiftStart !== undefined && v.shiftEnd !== undefined;
    const hasMinutes = v.hoursMinutes !== undefined;
    if (!hasShift && !hasMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Entweder hoursMinutes oder shiftStart+shiftEnd angeben.",
      });
    }
    if ((v.shiftStart === undefined) !== (v.shiftEnd === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shiftStart und shiftEnd nur paarweise.",
      });
    }
  });

export type SessionTipPoolEntry = {
  staffId: string;
  department: "kitchen" | "service" | "gl";
  hoursMinutes: number;
  shiftStart: string | null;
  shiftEnd: string | null;
  note: string | null;
};

export const listSessionTipPoolEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const { data: rows, error } = await supabaseAdmin
      .from("session_tip_pool_entries")
      .select("staff_id, department, hours_minutes, shift_start, shift_end, note")
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id);
    if (error) throw error;
    return (rows ?? []).map<SessionTipPoolEntry>((r) => ({
      staffId: r.staff_id,
      department: r.department as "kitchen" | "service" | "gl",
      hoursMinutes: Number(r.hours_minutes),
      shiftStart: r.shift_start ? (r.shift_start as string).slice(0, 5) : null,
      shiftEnd: r.shift_end ? (r.shift_end as string).slice(0, 5) : null,
      note: r.note,
    }));
  });

export const upsertSessionTipPoolEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => tipPoolEntryUpsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return upsertSessionTipPoolEntryCore(caller, data);
  });

export async function upsertSessionTipPoolEntryCore(
  caller: AdminCaller,
  data: z.infer<typeof tipPoolEntryUpsertSchema>,
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
    });
    await assertStaffBoundToLocation(caller.organizationId, data.staffId, session.location_id);

    const hoursMinutes =
      data.shiftStart !== undefined && data.shiftEnd !== undefined
        ? kitchenShiftMinutes(data.shiftStart, data.shiftEnd)
        : (data.hoursMinutes as number);
    const shiftStart = data.shiftStart ?? null;
    const shiftEnd = data.shiftEnd ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Vorhandenen Eintrag lesen, um `participates` (Session-Übersteuerung)
    // bei Eingaben, die nur Zeiten ändern, nicht zu überschreiben.
    let participatesValue: boolean | null;
    if (data.participates !== undefined) {
      participatesValue = data.participates;
    } else {
      const { data: existing } = await supabaseAdmin
        .from("session_tip_pool_entries")
        .select("participates")
        .eq("organization_id", caller.organizationId)
        .eq("session_id", session.id)
        .eq("staff_id", data.staffId)
        .maybeSingle();
      participatesValue =
        (existing as { participates: boolean | null } | null)?.participates ?? null;
    }
    const { error: upErr } = await supabaseAdmin.from("session_tip_pool_entries").upsert(
      {
        organization_id: caller.organizationId,
        session_id: session.id,
        staff_id: data.staffId,
        department: data.department,
        hours_minutes: hoursMinutes,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        note: data.note ?? null,
        participates: participatesValue,
        created_by: caller.userId,
      },
      { onConflict: "session_id,staff_id" },
    );
    if (upErr) throw upErr;

    // Laufender Sync: den zugehörigen source='pool'-Zeiteintrag mit der
    // frisch gespeicherten Zeit synchronisieren (upsert oder delete).
    // Best-effort — Sync-Fehler kippen die Korrektur nicht.
    try {
      const { data: savedRow } = await supabaseAdmin
        .from("session_tip_pool_entries")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("session_id", session.id)
        .eq("staff_id", data.staffId)
        .maybeSingle();
      if (savedRow?.id) {
        await syncPoolTimeEntry({
          organizationId: caller.organizationId,
          locationId: session.location_id,
          businessDate: session.business_date,
          entryId: savedRow.id,
          staffId: data.staffId,
          department: data.department,
          shiftStart,
          shiftEnd,
        });
      }
    } catch (err) {
      console.error("[pool-time-sync] failed", err);
      void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
        m.captureServerError(err, {
          op: "cash.pool_time_sync",
          orgId: caller.organizationId,
          extra: { sessionId: session.id, staffId: data.staffId },
        }),
      );
      // §51: sichtbare Spur, ohne die Korrektur zu kippen.
      try {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: "pool_time.sync_failed",
          entity: "session_tip_pool_entry",
          entityId: session.id,
          meta: {
            sessionId: session.id,
            businessDate: session.business_date,
            staffId: data.staffId,
            error: String(err).slice(0, 300),
          },
        });
      } catch (auditErr) {
        console.error("[pool-time-sync] audit failed", auditErr);
      }
    }

    return {
      result: { ok: true as const },
      audit: {
        action: "cash.tip_pool.manual_upsert",
        entity: "session_tip_pool_entry",
        meta: {
          sessionId: session.id,
          staffId: data.staffId,
          department: data.department,
          hoursMinutes,
          shiftStart,
          shiftEnd,
          participates: participatesValue,
        },
      },
    };
  });
}

export const deleteSessionTipPoolEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ sessionId: z.string().uuid(), staffId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return deleteSessionTipPoolEntryCore(caller, data);
  });

export async function deleteSessionTipPoolEntryCore(
  caller: AdminCaller,
  data: { sessionId: string; staffId: string },
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("session_tip_pool_entries")
      .delete()
      .eq("organization_id", caller.organizationId)
      .eq("session_id", session.id)
      .eq("staff_id", data.staffId);
    if (error) throw error;
    return {
      result: { ok: true as const },
      audit: {
        action: "cash.tip_pool.manual_delete",
        entity: "session_tip_pool_entry",
        meta: { sessionId: session.id, staffId: data.staffId },
      },
    };
  });
}

// ZS1 — Ein-Klick-Entfernen für Pool-Zeilen, die nicht mehr im Dienstplan
// stehen und unberührt sind. Rollenanforderung exakt wie
// `deleteSessionTipPoolEntry` ("manager"), inklusive Vorschau-Sperre; die
// Unberührtheit wird serverseitig erneut geprüft, die Anzeige entscheidet
// nicht.
export const removeUnplannedPoolEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ sessionId: z.string().uuid(), staffId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [rowRes, plannedRes, timeRes, setRes] = await Promise.all([
      supabaseAdmin
        .from("session_tip_pool_entries")
        .select("staff_id, note, participates")
        .eq("organization_id", caller.organizationId)
        .eq("session_id", session.id)
        .eq("staff_id", data.staffId)
        .maybeSingle(),
      supabaseAdmin
        .from("roster_shifts")
        .select("staff_id")
        .eq("organization_id", caller.organizationId)
        .eq("location_id", session.location_id)
        .eq("shift_date", session.business_date)
        .eq("staff_id", data.staffId)
        .in("status", ["planned", "confirmed"])
        .limit(1),
      supabaseAdmin
        .from("time_entries")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("location_id", session.location_id)
        .eq("business_date", session.business_date)
        .eq("staff_id", data.staffId)
        .eq("source", "clock")
        .limit(1),
      supabaseAdmin
        .from("waiter_settlements")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("session_id", session.id)
        .eq("staff_id", data.staffId)
        .neq("status", "superseded")
        .limit(1),
    ]);
    if (rowRes.error) throw rowRes.error;
    if (plannedRes.error) throw plannedRes.error;
    if (timeRes.error) throw timeRes.error;
    if (setRes.error) throw setRes.error;
    if (!rowRes.data) throw new Error("Pool-Eintrag nicht gefunden.");
    if ((plannedRes.data ?? []).length > 0) {
      throw new Error("Eintrag steht weiterhin im Dienstplan — kein Ein-Klick-Entfernen.");
    }
    const reason = removalBlockedReason({
      hasClockEntry: (timeRes.data ?? []).length > 0,
      hasSettlement: (setRes.data ?? []).length > 0,
      note: (rowRes.data as { note: string | null }).note,
      participatesOverride: (rowRes.data as { participates: boolean | null }).participates,
    });
    if (reason) throw new Error(reason);
    return deleteSessionTipPoolEntryCore(caller, data);
  });

// Plan-Snapshot in den Pool: siehe `./roster-pool-sync` — dort liegt
// `applyRosterPoolSnapshot` (Eröffnung + manueller Nachzug) und der
// neue `syncOpenSessionsPoolAfterRosterWrite` (RS1, Nach-Sync bei
// Dienstplan-Änderungen an offenen Sessions).

// Service-Pool-Ende aus dem Abgabezeitpunkt setzen — ohne Bindung an
// `default_checkout` (Service hat kein festes Ende). Nur wenn der
// Pool-Eintrag Service ist und `shift_end` noch NULL (also nicht manuell
// oder durch einen früheren Abgabelauf gesetzt) → einmalig setzen.
// Küche/GL: kein Eingriff.
async function applyServicePoolEnd(input: {
  organizationId: string;
  sessionId: string;
  staffId: string;
  submissionIso: string;
  businessDate: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: entry } = await supabaseAdmin
    .from("session_tip_pool_entries")
    .select("department, shift_start, shift_end")
    .eq("session_id", input.sessionId)
    .eq("staff_id", input.staffId)
    .maybeSingle();
  if (!entry || entry.department !== "service") {
    void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
      m.captureServerError(new Error("applyServicePoolEnd: no pool entry"), {
        op: "cash.applyServicePoolEnd",
        orgId: input.organizationId,
        extra: { sessionId: input.sessionId, staffId: input.staffId, reason: "no_pool_entry" },
      }),
    );
    return;
  }
  if (entry.shift_end) return; // schon gesetzt (manuell oder früherer Lauf)
  const startHHMM = entry.shift_start ? (entry.shift_start as string).slice(0, 5) : null;
  const resolved = resolveServicePoolEnd({
    shiftStartHHMM: startHHMM,
    submissionIso: input.submissionIso,
    businessDate: input.businessDate,
  });
  if (!resolved) {
    void import(/* @vite-ignore */ "@/lib/monitoring/sentry.server").then((m) =>
      m.captureServerError(new Error("applyServicePoolEnd: no resolved end"), {
        op: "cash.applyServicePoolEnd",
        orgId: input.organizationId,
        extra: { sessionId: input.sessionId, staffId: input.staffId, reason: "no_resolved_end" },
      }),
    );
    return;
  }
  const { error: endErr } = await supabaseAdmin
    .from("session_tip_pool_entries")
    .update({ shift_end: resolved.shiftEndHHMM, hours_minutes: resolved.hoursMinutes })
    .eq("organization_id", input.organizationId)
    .eq("session_id", input.sessionId)
    .eq("staff_id", input.staffId);
  if (endErr) throw endErr;
}

// Manueller „Aus Dienstplan ergänzen"-Knopf — idempotent, überschreibt
// nie bestehende Zeilen.
export const addRosterSnapshotMissing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    assertRealIdentity(caller);
    return addRosterSnapshotMissingCore(caller, data);
  });

export async function addRosterSnapshotMissingCore(
  caller: AdminCaller,
  data: { sessionId: string },
) {
  return runGuarded(caller.role, "manager", makeAuditWriter(caller), async () => {
    const session = await loadSessionWithLock(caller.organizationId, data.sessionId);
    const waterline = await loadLocationCashLock(caller.organizationId, session.location_id);
    assertCashWritable({
      businessDate: session.business_date,
      sessionStatus: session.status as "open" | "finalized" | "locked",
      sessionLockedAt: session.locked_at,
      cashLockedThroughDate: waterline,
    });
    const count = await applyRosterPoolSnapshot({
      organizationId: caller.organizationId,
      sessionId: session.id,
      locationId: session.location_id,
      businessDate: session.business_date,
    });
    return {
      result: { added: count },
      audit: {
        action: "cash.tip_pool.snapshot_added",
        entity: "session",
        entityId: session.id,
        meta: { added: count },
      },
    };
  });
}

// ------------------------------------------------------------------------
// Vortagsdefizit (rollender operativer Saldo der Vortage, ≤ 0)
// ------------------------------------------------------------------------
//
// Liest Sessions im 90-Tage-Fenster VOR `businessDate` an `locationId`,
// baut je Session denselben DayInput wie getCashOverview/CashSummaryBlock,
// rechnet rawBargeld = computeDailyCash(day) und rollt mit
// rollOperativeDeficitCents zum heutigen Defizit. sourceDate ist die
// business_date der letzten Session, bei der der Saldo nach diesem Tag
// noch < 0 war (oder die letzte Session, falls kein Defizit).

export const getPreviousOperativeDeficit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        businessDate: z.string().regex(ISO_DATE),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    return getPreviousOperativeDeficitCore(caller, data);
  });

export async function getPreviousOperativeDeficitCore(
  caller: AdminCaller,
  data: { locationId: string; businessDate: string },
): Promise<{ deficitCents: number; sourceDate: string | null }> {
  await assertLocationInOrg(caller.organizationId, data.locationId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const fromDate = (() => {
    const d = new Date(data.businessDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  })();

  const { data: sessions, error: sErr } = await supabaseAdmin
    .from("sessions")
    .select(
      "id, business_date, vectron_daily_total_cents, vouchers_sold_cents, vouchers_redeemed_cents, finedine_vouchers_cents, einladung_cents, sonstige_einnahme_cents, vorschuss_cents",
    )
    .eq("organization_id", caller.organizationId)
    .eq("location_id", data.locationId)
    .gte("business_date", fromDate)
    .lt("business_date", data.businessDate)
    .order("business_date", { ascending: true });
  if (sErr) throw sErr;
  if (!sessions || sessions.length === 0) {
    return { deficitCents: 0, sourceDate: null };
  }

  const sessionIds = sessions.map((s) => s.id);

  const [chRes, tmRes, wsRes, expRes, advRes, chanRes, oiRes] = await Promise.all([
    supabaseAdmin
      .from("session_channel_amounts")
      .select("session_id, channel_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_terminal_amounts")
      .select("session_id, amount_cents, payment_terminals!inner(is_gl)")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("waiter_settlements")
      .select("session_id, open_invoices_cents, status")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_expenses")
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("session_advances")
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
    supabaseAdmin
      .from("revenue_channels")
      .select("id, kind")
      .eq("organization_id", caller.organizationId)
      .eq("location_id", data.locationId),
    // SE1: sonstige Einnahmen als Positionsliste.
    otherIncomesTable(supabaseAdmin)
      .select("session_id, amount_cents")
      .eq("organization_id", caller.organizationId)
      .in("session_id", sessionIds),
  ]);
  if (chRes.error) throw chRes.error;
  if (tmRes.error) throw tmRes.error;
  if (wsRes.error) throw wsRes.error;
  if (expRes.error) throw expRes.error;
  if (advRes.error) throw advRes.error;
  if (chanRes.error) throw chanRes.error;
  if (oiRes.error) throw oiRes.error;

  const channelKindById = new Map<string, string>(
    (chanRes.data ?? []).map((c) => [c.id, c.kind as string]),
  );

  type Bucket = {
    cardTotalCents: number;
    deliverySouseCents: number;
    deliveryWoltCents: number;
    openInvoicesCents: number[];
    expensesCents: number[];
    advancesCents: number[];
    otherIncomesCents: number[];
  };
  const bySession = new Map<string, Bucket>();
  const ensure = (id: string): Bucket => {
    let b = bySession.get(id);
    if (!b) {
      b = {
        cardTotalCents: 0,
        deliverySouseCents: 0,
        deliveryWoltCents: 0,
        openInvoicesCents: [],
        expensesCents: [],
        advancesCents: [],
        otherIncomesCents: [],
      };
      bySession.set(id, b);
    }
    return b;
  };

  for (const r of tmRes.data ?? []) {
    // GL-Terminals überspringen — sie mindern das Tages-Bargeld nicht.
    if ((r.payment_terminals as { is_gl: boolean } | null)?.is_gl) continue;
    ensure(r.session_id).cardTotalCents += Number(r.amount_cents);
  }
  for (const r of chRes.data ?? []) {
    const kind = channelKindById.get(r.channel_id);
    if (kind === "delivery_souse") {
      ensure(r.session_id).deliverySouseCents += Number(r.amount_cents);
    } else if (kind === "delivery_wolt") {
      ensure(r.session_id).deliveryWoltCents += Number(r.amount_cents);
    }
  }
  for (const r of wsRes.data ?? []) {
    if ((r.status as string) === "superseded") continue;
    ensure(r.session_id).openInvoicesCents.push(Number(r.open_invoices_cents));
  }
  for (const r of expRes.data ?? []) {
    ensure(r.session_id).expensesCents.push(Number(r.amount_cents));
  }
  for (const r of advRes.data ?? []) {
    ensure(r.session_id).advancesCents.push(Number(r.amount_cents));
  }
  for (const r of oiRes.data ?? []) {
    ensure(r.session_id).otherIncomesCents.push(Number(r.amount_cents));
  }

  // rawBargeld pro Session in chronologischer Reihenfolge sammeln — Endsaldo
  // kommt aus der getesteten Helper-Funktion, für sourceDate wird derselbe
  // Fold nachgerechnet.
  const rawByDay: number[] = [];
  const datesByDay: string[] = [];
  for (const sess of sessions) {
    const b = ensure(sess.id);
    const dayInput = sessionToDayInput(
      {
        business_date: sess.business_date,
        vectron_daily_total_cents: sess.vectron_daily_total_cents,
        vouchers_sold_cents: sess.vouchers_sold_cents,
        vouchers_redeemed_cents: sess.vouchers_redeemed_cents,
        finedine_vouchers_cents: sess.finedine_vouchers_cents,
        einladung_cents: sess.einladung_cents,
        vorschuss_cents: sess.vorschuss_cents,
      },
      {
        cardTotalCents: b.cardTotalCents,
        deliverySouseCents: b.deliverySouseCents,
        deliveryWoltCents: b.deliveryWoltCents,
        openInvoicesCents: b.openInvoicesCents,
        expensesCents: b.expensesCents,
        advancesCents: b.advancesCents,
        otherIncomesCents: b.otherIncomesCents,
      },
    );
    rawByDay.push(computeDailyCash(dayInput));
    datesByDay.push(sess.business_date);
  }

  const deficitCents = rollOperativeDeficitCents(rawByDay);

  // sourceDate: letzter Tag, an dem der rollende Saldo < 0 blieb;
  // sonst die letzte Session im Fenster.
  let running = 0;
  let lastDeficitDate: string | null = null;
  for (let i = 0; i < rawByDay.length; i++) {
    running += rawByDay[i];
    running -= Math.max(0, running);
    if (running < 0) lastDeficitDate = datesByDay[i];
  }
  const sourceDate = deficitCents < 0 ? lastDeficitDate : datesByDay[datesByDay.length - 1];
  return { deficitCents, sourceDate };
}
