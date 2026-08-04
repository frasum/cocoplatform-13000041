// Server-only Kern für den Telegram-Tagesbericht.
// Wird von der cron-Route und der Test-Server-Fn geteilt, damit „Testbericht
// jetzt senden" und der scheduled Aufruf denselben Weg gehen — mit einem
// einzigen Schalter (`skipGate`) für Uhrzeit/Idempotenz.
//
// Bewusst *.server.ts: importiert supabaseAdmin und wird darum nie ins
// Client-Bundle geleakt (siehe tanstack-supabase-import-graph).

import type { AdminCaller } from "@/lib/admin/admin-context";
import { getCashOverviewCore, getPreviousOperativeDeficitCore } from "@/lib/cash/cash.functions";
import { computeDailyCash, type DayInput } from "@/lib/cash/cash-ledger";
import { computeWechselgeld } from "@/lib/cash/cash-summary";
import { sessionToDayInput } from "@/lib/cash/session-day-input";
import { sumNonGlTerminalCents } from "@/lib/cash/session-channels";
import { buildChannelKindMap } from "@/lib/cash/channel-mapping";
import { decomposeRevenue } from "@/lib/statistics/revenue-core";
import { loadPausenBezahlt, loadWorkMinutesEntries } from "@/lib/statistics/work-minutes.server";
import { workMinutesByDate } from "@/lib/statistics/work-minutes";
import { revenuePerWorkHourCents } from "./revenue-per-hour";
import { sendTelegramToStaff } from "./telegram.functions";
import { decideReportGate } from "./report-gate";
import {
  describeNetworkFailure,
  formatFailures,
  maskChatId,
  normalizeSendReason,
  type DeliveryFailure,
} from "./delivery-failures";
import {
  buildDailyReport,
  DEFAULT_REPORT_FLAGS,
  type ReportFlags,
  type ReportInput,
  type ReportLocationInput,
} from "./telegram-report";

export type OrgReportResult =
  | {
      organizationId: string;
      skipped: "disabled" | "wrong-hour" | "already-sent" | "no-recipients";
    }
  | {
      organizationId: string;
      businessDate: string;
      recipientsTotal: number;
      recipientsDelivered: number;
      recipientsFailed: number;
      locationsTotal: number;
      /** TG4 — je Empfänger der Fehlergrund (Chat-ID maskiert). */
      failures: DeliveryFailure[];
    };

function berlinDateISO(now: Date = new Date()): string {
  // YYYY-MM-DD im Europe/Berlin-Kalender.
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Berlin",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function berlinHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Berlin",
  }).format(now);
  // Node liefert je nach Runtime "07" oder "24" — "24" bei Mitternacht mappen.
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : 0;
}

function yesterdayISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseFlags(raw: unknown): ReportFlags {
  const flags: ReportFlags = { ...DEFAULT_REPORT_FLAGS, excludedLocationIds: [] };
  if (!raw || typeof raw !== "object") return flags;
  const r = raw as Record<string, unknown>;
  for (const key of [
    "umsatz",
    "umsatzStd",
    "gaeste",
    "kontrolle",
    "kellner",
    "kueche",
    "notizen",
  ] as const) {
    if (typeof r[key] === "boolean") flags[key] = r[key] as boolean;
  }
  if (Array.isArray(r.excludedLocationIds)) {
    flags.excludedLocationIds = r.excludedLocationIds.filter(
      (v): v is string => typeof v === "string",
    );
  }
  return flags;
}

async function loadReportInputForOrg(
  organizationId: string,
  businessDate: string,
): Promise<ReportInput> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: locations, error: locErr } = await supabaseAdmin
    .from("locations")
    .select("id, name, cash_balance_target_cents")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");
  if (locErr) throw locErr;

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("cash_balance_target_cents")
    .eq("id", organizationId)
    .maybeSingle();
  const orgTarget = Number(org?.cash_balance_target_cents ?? 200_000);

  const caller: AdminCaller = {
    userId: "system:telegram-cron",
    staffId: "system:telegram-cron",
    organizationId,
    role: "admin",
  };

  // CH1/TG5 — Kanal-Landkarte ORG-WEIT (kein Standort-Race) für die
  // kind-Auflösung von Lieferkanälen und für den Tagesumsatz (STAT1).
  const { data: allChannels } = await supabaseAdmin
    .from("revenue_channels")
    .select("id, kind")
    .eq("organization_id", organizationId);
  const kindById = buildChannelKindMap(
    (allChannels ?? []).map((c) => ({ id: c.id as string, kind: String(c.kind) })),
  );

  // TG5 — Netto-Arbeitsminuten aus der EINEN Statistik-Stundenquelle (STAT2).
  const pausenBezahlt = await loadPausenBezahlt(supabaseAdmin, organizationId);

  const locationInputs: ReportLocationInput[] = [];
  for (const l of locations ?? []) {
    const ov = await getCashOverviewCore(caller, {
      businessDate,
      locationId: l.id,
    });
    if (!ov.session) {
      locationInputs.push({ locationId: l.id, name: l.name, hasSession: false });
      continue;
    }
    const sess = ov.session;
    const active = ov.settlements.filter((s) => s.status !== "superseded");

    // Bargeld-Berechnung identisch zum PDF/Bildschirm (§33): GL-Terminal-Zeilen
    // (Kredit Karten GL) zählen NICHT zum Kartenabzug — sie sind Kontrollposten
    // und dürfen das Tages-Bargeld nicht mindern. Wir joinen die Terminal-
    // Beträge daher mit `payment_terminals.is_gl` und summieren via der einen
    // §33-Implementierung `sumNonGlTerminalCents` (Referenz: pdfExport, KGL-2).
    const { data: terminalsMeta } = await supabaseAdmin
      .from("payment_terminals")
      .select("id, is_gl")
      .eq("organization_id", organizationId)
      .eq("location_id", l.id);
    const isGlById = new Map<string, boolean>(
      (terminalsMeta ?? []).map((t) => [t.id as string, Boolean(t.is_gl)]),
    );
    const cardTerminalTotal = sumNonGlTerminalCents(
      ov.terminalAmounts.map((a) => ({
        amountCents: a.amountCents,
        isGl: isGlById.get(a.terminalId) ?? false,
      })),
    );
    const channelTotals = ov.channelAmounts.reduce(
      (acc, ca) => {
        acc[ca.channelId] = (acc[ca.channelId] ?? 0) + ca.amountCents;
        return acc;
      },
      {} as Record<string, number>,
    );
    // delivery_souse / delivery_wolt aus der org-weiten Kanal-Landkarte.
    let deliverySouse = 0;
    let deliveryWolt = 0;
    for (const [channelId, amt] of Object.entries(channelTotals)) {
      const kind = kindById.get(channelId);
      if (kind === "delivery_souse") deliverySouse += amt;
      else if (kind === "delivery_wolt") deliveryWolt += amt;
    }

    // TG5 — Tagesumsatz identisch zur Statistik (STAT1-Zerlegung) und
    // Netto-Arbeitsminuten des Geschäftstags am Standort (STAT2-Quelle).
    const sessionChannels = Object.entries(channelTotals)
      .map(([channelId, amountCents]) => ({
        kind: kindById.get(channelId),
        amountCents,
      }))
      .filter((c): c is { kind: string; amountCents: number } => typeof c.kind === "string");
    const dayTotalCents = decomposeRevenue({
      vectronCents: Number(sess.vectron_daily_total_cents ?? 0),
      channels: sessionChannels,
    }).totalCents;
    const workEntries = await loadWorkMinutesEntries(supabaseAdmin, {
      organizationId,
      startDate: businessDate,
      endDate: businessDate,
      locationId: l.id,
      pausenBezahlt,
    });
    const workMinutes = workMinutesByDate(workEntries).get(businessDate) ?? 0;
    const perHourCents = revenuePerWorkHourCents({ totalCents: dayTotalCents, workMinutes });

    const dayInput: DayInput = sessionToDayInput(
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
        cardTotalCents: cardTerminalTotal,
        deliverySouseCents: deliverySouse,
        deliveryWoltCents: deliveryWolt,
        openInvoicesCents: active.map((s) => Number(s.open_invoices_cents)),
        expensesCents: ov.expenses.map((e) => e.amountCents),
        advancesCents: ov.advances.map((a) => a.amountCents),
        // SE1: sonstige Einnahmen als Positionsliste.
        otherIncomesCents: ov.otherIncomes.map((o) => o.amountCents),
      },
    );
    const tagesBargeldCents = computeDailyCash(dayInput);

    const { deficitCents } = await getPreviousOperativeDeficitCore(caller, {
      locationId: l.id,
      businessDate,
    });
    const cashTarget = Number(l.cash_balance_target_cents ?? orgTarget);
    const { diffCents, wechselgeldbestandCents } = computeWechselgeld({
      tagesBargeldCents,
      previousDeficitCents: deficitCents,
      cashTargetCents: cashTarget,
    });
    const ausgabenCents = ov.expenses.reduce((a, e) => a + e.amountCents, 0);

    // Küchen-Einträge (Namen + Schichtzeiten). Nur teilnehmende Zeilen.
    const { data: kitchen } = await supabaseAdmin
      .from("session_tip_pool_entries")
      .select(
        "staff_id, shift_start, shift_end, participates, department, staff:staff(display_name)",
      )
      .eq("organization_id", organizationId)
      .eq("session_id", sess.id)
      .eq("department", "kitchen");
    const kitchenList = (kitchen ?? [])
      .filter((r) => r.participates !== false)
      .map((r) => ({
        staffId: r.staff_id as string,
        name:
          (r.staff as { display_name?: string } | null)?.display_name ??
          String(r.staff_id).slice(0, 8),
        shiftStart: (r.shift_start as string | null) ?? null,
        shiftEnd: (r.shift_end as string | null) ?? null,
        minutes: null as number | null,
      }));

    // Fallback: echte Stempel aus time_entries laden (Küche mit Uhr).
    const missingStaffIds = kitchenList
      .filter((k) => !k.shiftStart || !k.shiftEnd)
      .map((k) => k.staffId);
    if (missingStaffIds.length > 0) {
      const { data: teRows } = await supabaseAdmin
        .from("time_entries")
        .select("staff_id, started_at, ended_at, break_minutes")
        .eq("organization_id", organizationId)
        .eq("business_date", businessDate)
        .in("staff_id", missingStaffIds)
        .in("source", ["clock", "manual", "import"]);
      const byStaff = new Map<string, { start: Date | null; end: Date | null; breakMin: number }>();
      for (const r of teRows ?? []) {
        const staffId = r.staff_id as string;
        const start = r.started_at ? new Date(r.started_at as string) : null;
        const end = r.ended_at ? new Date(r.ended_at as string) : null;
        const bm = Number(r.break_minutes ?? 0);
        const cur = byStaff.get(staffId) ?? { start: null, end: null, breakMin: 0 };
        if (start && (!cur.start || start < cur.start)) cur.start = start;
        if (end && (!cur.end || end > cur.end)) cur.end = end;
        cur.breakMin += bm;
        byStaff.set(staffId, cur);
      }
      for (const k of kitchenList) {
        const agg = byStaff.get(k.staffId);
        if (!agg) continue;
        if (!k.shiftStart && agg.start) k.shiftStart = agg.start.toISOString();
        if (!k.shiftEnd && agg.end) k.shiftEnd = agg.end.toISOString();
        if (agg.start && agg.end) {
          const min = Math.max(
            0,
            Math.round((agg.end.getTime() - agg.start.getTime()) / 60000) - agg.breakMin,
          );
          k.minutes = min;
        }
      }
    }

    locationInputs.push({
      locationId: l.id,
      name: l.name,
      hasSession: true,
      vectronCents: Number(sess.vectron_daily_total_cents ?? 0),
      guestCount: Number(sess.guest_count ?? 0),
      revenuePerWorkHourCents: perHourCents,
      kontrolle: {
        fehlbetragVortagCents: deficitCents,
        ausgabenCents,
        tagesBargeldCents,
        differenzWechselgeldCents: diffCents,
        wechselgeldbestandCents,
      },
      waiters: active.map((s) => ({
        name: s.staffName,
        posSalesCents: Number(s.pos_sales_cents),
        submittedAt: (s.submitted_at as string | null) ?? null,
      })),
      kitchen: kitchenList,
      notes: (sess.notes as string | null) ?? null,
    });
  }

  return { businessDate, locations: locationInputs };
}

export async function runDailyReportForOrg(params: {
  organizationId: string;
  skipGate: boolean;
  now?: Date;
}): Promise<OrgReportResult> {
  const { organizationId, skipGate } = params;
  const now = params.now ?? new Date();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: settings, error: sErr } = await supabaseAdmin
    .from("organization_settings")
    .select(
      "telegram_report_enabled, telegram_report_hour, telegram_report_flags, telegram_report_last_sent",
    )
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (sErr) throw sErr;

  const todayBerlin = berlinDateISO(now);
  if (!skipGate) {
    if (!settings?.telegram_report_enabled) {
      return { organizationId, skipped: "disabled" };
    }
    const hourNow = berlinHour(now);
    const wantedHour = Number(settings.telegram_report_hour ?? 7);
    if (hourNow !== wantedHour) {
      return { organizationId, skipped: "wrong-hour" };
    }
    const lastSent = settings.telegram_report_last_sent as string | null;
    if (lastSent && lastSent >= todayBerlin) {
      return { organizationId, skipped: "already-sent" };
    }
  }

  // Empfänger: alle verknüpften Konten mit Häkchen.
  const { data: recipients, error: rErr } = await supabaseAdmin
    .from("staff_telegram_links")
    .select("staff_id, telegram_chat_id, linked_at, receives_daily_report")
    .eq("organization_id", organizationId)
    .eq("receives_daily_report", true)
    .not("linked_at", "is", null);
  if (rErr) throw rErr;
  if (!recipients || recipients.length === 0) {
    return { organizationId, skipped: "no-recipients" };
  }

  const businessDate = yesterdayISO(todayBerlin);
  const flags = parseFlags(settings?.telegram_report_flags);
  const reportInput = await loadReportInputForOrg(organizationId, businessDate);
  const text = buildDailyReport(reportInput, flags);

  let delivered = 0;
  let failed = 0;
  const failures: DeliveryFailure[] = [];
  for (const r of recipients) {
    const recipient = maskChatId(r.telegram_chat_id as string | number | null);
    try {
      const res = await sendTelegramToStaff({ staffId: r.staff_id, text });
      if (res.delivered) delivered += 1;
      else {
        failed += 1;
        failures.push({ recipient, reason: normalizeSendReason(res.reason) });
      }
    } catch (e) {
      failed += 1;
      failures.push({ recipient, reason: describeNetworkFailure(e) });
    }
  }

  // TG3 — `last_sent` markiert einen ZUGESTELLTEN Bericht, nicht einen
  // versuchten. Bei Totalausfall (delivered === 0) bleibt der Tag offen:
  // der stündliche Cron greift wegen wrong-hour zwar erst am Folgetag wieder,
  // aber der Sentry-Alarm unten macht den Ausfall sofort sichtbar, und der
  // Admin kann über „Jetzt senden" manuell nachversenden (Bauherren-Entscheid:
  // kein automatischer Same-Day-Retry).
  const gate = decideReportGate({
    skipGate,
    recipientsTotal: recipients.length,
    delivered,
  });

  if (gate.markSent) {
    await supabaseAdmin
      .from("organization_settings")
      .update({ telegram_report_last_sent: todayBerlin })
      .eq("organization_id", organizationId);
  }

  // Der Alarm läuft BEWUSST auch im skipGate-Pfad (manuelles „Jetzt senden"):
  // auch dort soll ein Totalausfall in Sentry stehen, nicht nur im UI-Ergebnis.
  if (gate.alarmNoDelivery) {
    const { captureServerError } = await import("@/lib/monitoring/sentry.server");
    await captureServerError(new Error("Telegram-Tagesbericht: keine einzige Zustellung"), {
      op: "telegram.daily_report",
      orgId: organizationId,
      critical: false,
      tags: {
        recipients: recipients.length,
        failed,
        manual: skipGate === true,
      },
      extra: { failures },
    });
  } else if (failed > 0) {
    // Teilausfall: sichtbar machen, aber ohne High-Priority-Alarm.
    console.warn(
      `[telegram.daily_report] Teilausfall org=${organizationId}: ${delivered}/${recipients.length} zugestellt — ${formatFailures(failures)}`,
    );
  }

  return {
    organizationId,
    businessDate,
    recipientsTotal: recipients.length,
    recipientsDelivered: delivered,
    recipientsFailed: failed,
    locationsTotal: reportInput.locations.length,
    failures,
  };
}

export async function listOrgsWithReportEnabled(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("organization_settings")
    .select("organization_id")
    .eq("telegram_report_enabled", true);
  if (error) throw error;
  return (data ?? []).map((r) => r.organization_id as string);
}
