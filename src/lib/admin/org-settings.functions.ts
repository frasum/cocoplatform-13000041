// Organisations-weite Einstellungen (B1c-Erweiterung).
//
// Schnitt:
//   * getOrgSettings — manager+ darf lesen (für Anzeige in /admin/einstellungen).
//   * updateOrgSettings — admin schreibt, runGuarded + audit_log.
//
// Geld-/Pool-Regeln werden hier nur transportiert; die eigentliche
// Geld-Logik (kitchen_tip_rate-Anwendung, Mindeststunden-Filter) lebt
// in src/lib/cash/*. Validierungs-Grenzen unten sind defensiv (keine
// Negativwerte, Trinkgeldsatz 0..1, Mindeststunden 0..24).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "./admin-context";
import { runGuarded } from "./admin-call";
import { writeAuditLog } from "./audit";
import { expectMaybe, expectVoid } from "@/lib/supabase/expect-ok";

export type OrgSettings = {
  kitchenTipRate: number; // 0..1, z. B. 0.02
  tipPoolMinHours: number; // Tagessumme, inklusive Grenze
  kitchenManualOnly: boolean;
  testModeEnabled: boolean;
  testModeEmail: string | null;
  betriebsnummer: string | null;
  arbeitgeberName: string | null;
  arbeitgeberAdresse: string | null;
  arbeitgeberVertreter: string | null;
  telegramBotUsername: string | null;
  orderReplyTelegramEnabled: boolean;
  orderReplyForwardUnassigned: boolean;
  // PB1 — Runde 1: Wert wird angezeigt und bedienbar, aber NICHT von
  // Stunden-/Lohnberechnung gelesen. Default true = Alt-Verhalten.
  pausenBezahlt: boolean;
};

const updateSchema = z
  .object({
    kitchenTipRate: z.number().min(0).max(1),
    tipPoolMinHours: z.number().min(0).max(24),
    kitchenManualOnly: z.boolean(),
    testModeEnabled: z.boolean(),
    testModeEmail: z
      .string()
      .trim()
      .max(254)
      .email("Ungültige E-Mail-Adresse.")
      .nullable()
      .or(z.literal("").transform(() => null)),
    orderReplyTelegramEnabled: z.boolean().optional(),
    orderReplyForwardUnassigned: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.testModeEnabled && !v.testModeEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["testModeEmail"],
        message: "Bei aktivem Testmodus ist eine gültige E-Mail-Adresse Pflicht.",
      });
    }
  });

export const getOrgSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrgSettings> => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const data = expectMaybe<{
      kitchen_tip_rate: number | string | null;
      tip_pool_min_hours: number | string | null;
      kitchen_manual_only: boolean | null;
      test_mode_enabled: boolean | null;
      test_mode_email: string | null;
      betriebsnummer: string | null;
      arbeitgeber_name: string | null;
      arbeitgeber_adresse: string | null;
      arbeitgeber_vertreter: string | null;
      telegram_bot_username: string | null;
      order_reply_telegram_enabled: boolean | null;
      order_reply_forward_unassigned: boolean | null;
    }>(
      await supabaseAdmin
        .from("organization_settings")
        .select(
          "kitchen_tip_rate, tip_pool_min_hours, kitchen_manual_only, test_mode_enabled, test_mode_email, betriebsnummer, arbeitgeber_name, arbeitgeber_adresse, arbeitgeber_vertreter, telegram_bot_username, order_reply_telegram_enabled, order_reply_forward_unassigned, pausen_bezahlt",
        )
        .eq("organization_id", caller.organizationId)
        .maybeSingle(),
      "getOrgSettings",
    );
    return {
      kitchenTipRate: Number(data?.kitchen_tip_rate ?? 0.02),
      tipPoolMinHours: Number(data?.tip_pool_min_hours ?? 2.5),
      kitchenManualOnly: Boolean(data?.kitchen_manual_only ?? false),
      testModeEnabled: Boolean(data?.test_mode_enabled ?? false),
      testModeEmail: data?.test_mode_email ?? null,
      betriebsnummer: data?.betriebsnummer ?? null,
      arbeitgeberName: data?.arbeitgeber_name ?? null,
      arbeitgeberAdresse: data?.arbeitgeber_adresse ?? null,
      arbeitgeberVertreter: data?.arbeitgeber_vertreter ?? null,
      telegramBotUsername: data?.telegram_bot_username ?? null,
      orderReplyTelegramEnabled: Boolean(data?.order_reply_telegram_enabled ?? false),
      orderReplyForwardUnassigned: Boolean(data?.order_reply_forward_unassigned ?? false),
      // Default true bewahrt das Alt-Verhalten, falls die Zeile noch nichts
      // enthält (Migration setzt DB-Default ebenfalls auf true).
      pausenBezahlt: Boolean(
        (data as { pausen_bezahlt?: boolean | null } | null)?.pausen_bezahlt ?? true,
      ),
    };
  });

export const updateOrgSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(
      caller.role,
      "admin",
      async (entry) => {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: entry.meta,
        });
      },
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        expectVoid(
          await supabaseAdmin
            .from("organization_settings")
            .update({
              kitchen_tip_rate: data.kitchenTipRate,
              tip_pool_min_hours: data.tipPoolMinHours,
              kitchen_manual_only: data.kitchenManualOnly,
              test_mode_enabled: data.testModeEnabled,
              test_mode_email: data.testModeEmail,
              ...(data.orderReplyTelegramEnabled !== undefined
                ? { order_reply_telegram_enabled: data.orderReplyTelegramEnabled }
                : {}),
              ...(data.orderReplyForwardUnassigned !== undefined
                ? { order_reply_forward_unassigned: data.orderReplyForwardUnassigned }
                : {}),
            })
            .eq("organization_id", caller.organizationId),
          "updateOrgSettings.update",
        );
        return {
          result: { ok: true as const },
          audit: {
            action: "org_settings.update",
            entity: "organization_settings",
            entityId: caller.organizationId,
            meta: {
              kitchenTipRate: data.kitchenTipRate,
              tipPoolMinHours: data.tipPoolMinHours,
              kitchenManualOnly: data.kitchenManualOnly,
              testModeEnabled: data.testModeEnabled,
              testModeEmail: data.testModeEmail,
              orderReplyTelegramEnabled: data.orderReplyTelegramEnabled ?? null,
              orderReplyForwardUnassigned: data.orderReplyForwardUnassigned ?? null,
            },
          },
        };
      },
    );
  });

// Arbeitgeber-Stammdaten (V2 Dokumentengenerierung). Gleiches Muster wie
// setBetriebsnummer: admin-gated, runGuarded + Audit, Werte NICHT ins Meta
// (nur hasValue-Flags), damit z. B. Vertreter-Namen nicht ins audit_log gehen.

const stammdatenSchema = z.object({
  arbeitgeberName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .or(z.literal("").transform(() => null)),
  arbeitgeberAdresse: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .or(z.literal("").transform(() => null)),
  arbeitgeberVertreter: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .or(z.literal("").transform(() => null)),
});

export const setArbeitgeberStammdaten = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => stammdatenSchema.parse(i))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(
      caller.role,
      "admin",
      async (entry) => {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: entry.meta,
        });
      },
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        expectVoid(
          await supabaseAdmin
            .from("organization_settings")
            .update({
              arbeitgeber_name: data.arbeitgeberName,
              arbeitgeber_adresse: data.arbeitgeberAdresse,
              arbeitgeber_vertreter: data.arbeitgeberVertreter,
            })
            .eq("organization_id", caller.organizationId),
          "setArbeitgeberStammdaten.update",
        );
        return {
          result: { ok: true as const },
          audit: {
            action: "settings.arbeitgeber_changed",
            entity: "organization_settings",
            entityId: caller.organizationId,
            meta: {
              hasName: !!data.arbeitgeberName,
              hasAdresse: !!data.arbeitgeberAdresse,
              hasVertreter: !!data.arbeitgeberVertreter,
            },
          },
        };
      },
    );
  });

// Telegram-Bot-Username (nur der öffentliche @handle, kein Token).
// Wird für den Deep-Link https://t.me/<username>?start=<token> gebraucht.
// Der Bot-Token selbst liegt im Connector-Secret TELEGRAM_API_KEY.

const telegramBotSchema = z.object({
  telegramBotUsername: z
    .string()
    .trim()
    .max(64)
    .regex(
      /^[A-Za-z][A-Za-z0-9_]{3,63}$/,
      "Ungültiger Bot-Username (nur A-Z, a-z, 0-9, _; 4–64 Zeichen).",
    )
    .nullable()
    .or(z.literal("").transform(() => null)),
});

export const setTelegramBotUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => telegramBotSchema.parse(i))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, "admin");
    return runGuarded(
      caller.role,
      "admin",
      async (entry) => {
        await writeAuditLog({
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          actorStaffId: caller.staffId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          meta: entry.meta,
        });
      },
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        expectVoid(
          await supabaseAdmin
            .from("organization_settings")
            .update({ telegram_bot_username: data.telegramBotUsername })
            .eq("organization_id", caller.organizationId),
          "setTelegramBotUsername.update",
        );
        return {
          result: { ok: true as const },
          audit: {
            action: "settings.telegram_bot_changed",
            entity: "organization_settings",
            entityId: caller.organizationId,
            meta: { hasBotUsername: !!data.telegramBotUsername },
          },
        };
      },
    );
  });

// N6 — UZ1-Schalter „Feiertage zählen als Urlaubstage" entfernt: im
// 5-Tage-Modell gegenstandslos (Feiertage = normale Mo–Fr-Tage). Die
// DB-Spalte `count_holidays_as_leave` bleibt aus Kompatibilitätsgründen
// bestehen und wird beim Cutover aufgeräumt.
