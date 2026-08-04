// KA2 — Schlanke Stundenquelle für die Kassen-Kachel „Umsatz / Arbeitsstunde".
//
// KEINE zweite Stundenformel: geladen wird über die gemeinsame
// Statistik-Quelle (`work-minutes.server` + `workMinutesByDate`), also
// identisch zu Statistik-Umsatz-Tab, Personalquote und TG5-Telegram.
// Fenster = genau EIN Geschäftstag, gefiltert auf den Standort.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { loadPausenBezahlt, loadWorkMinutesEntries } from "@/lib/statistics/work-minutes.server";
import { workMinutesByDate } from "@/lib/statistics/work-minutes";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const getCashDayWorkMinutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        businessDate: z.string().regex(ISO_DATE),
        locationId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Sichtbarkeit wie die übrige Kassen-Kachelzone (getCashOverview: manager+).
    const caller = await loadAdminCaller(context.supabase, context.userId, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pausenBezahlt = await loadPausenBezahlt(supabaseAdmin, caller.organizationId);
    const entries = await loadWorkMinutesEntries(supabaseAdmin, {
      organizationId: caller.organizationId,
      startDate: data.businessDate,
      endDate: data.businessDate,
      locationId: data.locationId,
      pausenBezahlt,
    });
    return { workMinutes: workMinutesByDate(entries).get(data.businessDate) ?? 0 };
  });
