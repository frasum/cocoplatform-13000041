// Server-Fns für den Telegram-Tagesbericht (admin-only).
// Der eigentliche Bericht-Kern lebt in telegram-report.server.ts und wird
// erst innerhalb des Handlers dynamic-importiert (damit der Server-only-
// Import nie ins Client-Bundle leakt).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runGuarded } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";

export type TelegramReportRecipient = {
  staffId: string;
  displayName: string;
  telegramUsername: string | null;
  linkedAt: string | null;
  receivesDailyReport: boolean;
  receivesSwapAlerts: boolean;
};

export type TelegramReportSettings = {
  enabled: boolean;
  hour: number;
  flags: {
    umsatz: boolean;
    umsatzStd: boolean;
    gaeste: boolean;
    kontrolle: boolean;
    kellner: boolean;
    kueche: boolean;
    notizen: boolean;
    excludedLocationIds: string[];
  };
  lastSent: string | null;
  botUsername: string | null;
  recipients: TelegramReportRecipient[];
};

const flagsSchema = z.object({
  umsatz: z.boolean(),
  // TG5-b — fehlendes Flag ⇒ true (bestehende Konfigurationen behalten die Kennzahl).
  umsatzStd: z.boolean().default(true),
  gaeste: z.boolean(),
  kontrolle: z.boolean(),
  kellner: z.boolean(),
  kueche: z.boolean(),
  notizen: z.boolean(),
  excludedLocationIds: z.array(z.string().uuid()).max(100),
});

const updateSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  flags: flagsSchema,
});

export const getTelegramReportSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TelegramReportSettings> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [settingsRes, linksRes] = await Promise.all([
      supabaseAdmin
        .from("organization_settings")
        .select(
          "telegram_report_enabled, telegram_report_hour, telegram_report_flags, telegram_report_last_sent, telegram_bot_username",
        )
        .eq("organization_id", caller.organizationId)
        .maybeSingle(),
      supabaseAdmin
        .from("staff_telegram_links")
        .select(
          "staff_id, telegram_username, linked_at, receives_daily_report, receives_swap_alerts, staff:staff(display_name)",
        )
        .eq("organization_id", caller.organizationId)
        .not("linked_at", "is", null)
        .order("linked_at", { ascending: true }),
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (linksRes.error) throw linksRes.error;

    const s = settingsRes.data;
    const rawFlags = (s?.telegram_report_flags ?? {}) as Record<string, unknown>;
    const flags = {
      umsatz: rawFlags.umsatz !== false,
      umsatzStd: rawFlags.umsatzStd !== false,
      gaeste: rawFlags.gaeste !== false,
      kontrolle: rawFlags.kontrolle !== false,
      kellner: rawFlags.kellner !== false,
      kueche: rawFlags.kueche !== false,
      notizen: rawFlags.notizen !== false,
      excludedLocationIds: Array.isArray(rawFlags.excludedLocationIds)
        ? (rawFlags.excludedLocationIds as unknown[]).filter(
            (v): v is string => typeof v === "string",
          )
        : [],
    };

    return {
      enabled: Boolean(s?.telegram_report_enabled ?? false),
      hour: Number(s?.telegram_report_hour ?? 7),
      flags,
      lastSent: (s?.telegram_report_last_sent as string | null) ?? null,
      botUsername: (s?.telegram_bot_username as string | null) ?? null,
      recipients: (linksRes.data ?? []).map((r) => ({
        staffId: r.staff_id as string,
        displayName:
          (r.staff as { display_name?: string } | null)?.display_name ??
          String(r.staff_id).slice(0, 8),
        telegramUsername: (r.telegram_username as string | null) ?? null,
        linkedAt: (r.linked_at as string | null) ?? null,
        receivesDailyReport: Boolean(r.receives_daily_report),
        receivesSwapAlerts: Boolean(r.receives_swap_alerts),
      })),
    };
  });

export const updateTelegramReportSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: before } = await supabaseAdmin
        .from("organization_settings")
        .select("telegram_report_enabled, telegram_report_hour, telegram_report_flags")
        .eq("organization_id", caller.organizationId)
        .maybeSingle();
      const { error } = await supabaseAdmin
        .from("organization_settings")
        .update({
          telegram_report_enabled: data.enabled,
          telegram_report_hour: data.hour,
          telegram_report_flags: data.flags,
        })
        .eq("organization_id", caller.organizationId);
      if (error) throw error;
      return {
        result: { ok: true as const },
        audit: {
          action: "telegram.report_settings_updated",
          entity: "organization_settings",
          entityId: caller.organizationId,
          meta: {
            before: {
              enabled: before?.telegram_report_enabled ?? null,
              hour: before?.telegram_report_hour ?? null,
              flags: before?.telegram_report_flags ?? null,
            },
            after: { enabled: data.enabled, hour: data.hour, flags: data.flags },
          },
        },
      };
    });
  });

export const setDailyReportRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ staffId: z.string().uuid(), receives: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("staff_telegram_links")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("staff_id", data.staffId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!existing) throw new Error("Kein verknüpftes Telegram-Konto für diesen Mitarbeiter.");
      const { error } = await supabaseAdmin
        .from("staff_telegram_links")
        .update({ receives_daily_report: data.receives })
        .eq("id", existing.id);
      if (error) throw error;
      return {
        result: { ok: true as const },
        audit: {
          action: "telegram.report_recipient_changed",
          entity: "staff_telegram_links",
          entityId: existing.id as string,
          meta: { staffId: data.staffId, receives: data.receives },
        },
      };
    });
  });

// TA2 — Empfänger für Schichttausch-Pings pflegen (analog Tagesbericht).
export const setSwapAlertsRecipient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ staffId: z.string().uuid(), receives: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("staff_telegram_links")
        .select("id")
        .eq("organization_id", caller.organizationId)
        .eq("staff_id", data.staffId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!existing) throw new Error("Kein verknüpftes Telegram-Konto für diesen Mitarbeiter.");
      const { error } = await supabaseAdmin
        .from("staff_telegram_links")
        .update({ receives_swap_alerts: data.receives })
        .eq("id", existing.id);
      if (error) throw error;
      return {
        result: { ok: true as const },
        audit: {
          action: "telegram.swap_alerts_recipient_changed",
          entity: "staff_telegram_links",
          entityId: existing.id as string,
          meta: { staffId: data.staffId, receives: data.receives },
        },
      };
    });
  });

export const sendTestReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(caller.role, "admin", makeAuditWriter(caller), async () => {
      const { runDailyReportForOrg } = await import("./telegram-report.server");
      const result = await runDailyReportForOrg({
        organizationId: caller.organizationId,
        skipGate: true,
      });
      const meta =
        "skipped" in result
          ? { skipped: result.skipped }
          : {
              businessDate: result.businessDate,
              recipientsTotal: result.recipientsTotal,
              recipientsDelivered: result.recipientsDelivered,
              recipientsFailed: result.recipientsFailed,
              locationsTotal: result.locationsTotal,
            };
      return {
        result,
        audit: {
          action: "telegram.test_report_sent",
          entity: "organization_settings",
          entityId: caller.organizationId,
          meta,
        },
      };
    });
  });
