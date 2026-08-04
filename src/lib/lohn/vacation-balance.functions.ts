// UB2 — Urlaubskonto-Vorschlag lesen und (explizit) in den Kalender übernehmen.
//
// Rechte wie die übrige Lohnpflege: admin + payroll, Permission
// `payroll.compensation.edit`. Die Rechnung selbst liegt rein in
// vacation-balance.ts; hier ist ausschließlich Zugriff + Audit.
//
// KEIN Auto-Lauf: der Vorschlag wird gelesen und angezeigt; die Umstellung
// auf `urlaub_unbezahlt` passiert nur, wenn ein Mensch `applyVacationSplit`
// auslöst. Wochenend- und Feiertagstage des Zeitraums bleiben unangetastet.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { runWithPermission } from "@/lib/admin/admin-call";
import { writeAuditLog } from "@/lib/admin/audit";
import {
  availablePaidVacationDays,
  isVacationWorkday,
  splitVacationProposal,
} from "./vacation-balance";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const rangeInput = z.object({
  staffId: z.string().uuid(),
  fromDate: z.string().regex(dateRegex),
  toDate: z.string().regex(dateRegex),
});

export type VacationBalanceProposal = {
  /** null = Urlaubskonto im Stammblatt nicht gepflegt. */
  available: number | null;
  previousYear: number | null;
  currentYear: number | null;
  taken: number | null;
  /** Bestätigte U-Tage des laufenden Jahres OHNE die betrachtete Periode. */
  confirmedOtherPeriods: number;
  /** Arbeitstage (Mo–Fr, kein Feiertag) mit bezahltem Urlaub im Zeitraum. */
  requestedWorkdays: number;
  paidDates: string[];
  unpaidDates: string[];
};

type StaffAccountRow = {
  vacation_days_previous_year: number | null;
  vacation_days_current_year: number | null;
  vacation_days_taken: number | null;
};

async function loadProposal(
  organizationId: string,
  args: { staffId: string; fromDate: string; toDate: string },
): Promise<VacationBalanceProposal> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Urlaubskonto liegt im Stammblatt (staff_personal_details), nicht auf staff.
  const staffRes = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("id", args.staffId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (!staffRes.data) throw new Error("Mitarbeiter nicht in dieser Organisation.");

  const detailsRes = await supabaseAdmin
    .from("staff_personal_details")
    .select("vacation_days_previous_year, vacation_days_current_year, vacation_days_taken")
    .eq("staff_id", args.staffId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (detailsRes.error) throw new Error(detailsRes.error.message);
  // Kein Stammblatt ⇒ Konto nicht gepflegt (null-Felder), kein Fehler.
  const staff: StaffAccountRow = (detailsRes.data as StaffAccountRow | null) ?? {
    vacation_days_previous_year: null,
    vacation_days_current_year: null,
    vacation_days_taken: null,
  };

  // Bestätigte U-Tage des laufenden Jahres — die betrachtete Periode wird
  // ausgenommen, damit der eigene Antrag den eigenen Anspruch nicht kürzt.
  const year = args.fromDate.slice(0, 4);
  const confRes = await supabaseAdmin
    .from("lohn_absence_days")
    .select("period_start, urlaub_tage")
    .eq("staff_id", args.staffId)
    .eq("organization_id", organizationId)
    .gte("period_start", `${year}-01-01`)
    .lte("period_start", `${year}-12-31`);
  if (confRes.error) throw new Error(confRes.error.message);
  let confirmedOtherPeriods = 0;
  for (const row of confRes.data ?? []) {
    if (row.period_start === args.fromDate) continue;
    confirmedOtherPeriods += row.urlaub_tage ?? 0;
  }

  const absRes = await supabaseAdmin
    .from("roster_absence")
    .select("date, type")
    .eq("staff_id", args.staffId)
    .eq("organization_id", organizationId)
    .gte("date", args.fromDate)
    .lte("date", args.toDate)
    .eq("type", "urlaub");
  if (absRes.error) throw new Error(absRes.error.message);
  const workdays = (absRes.data ?? []).map((r) => r.date).filter(isVacationWorkday);

  const available = availablePaidVacationDays({
    previousYear: staff.vacation_days_previous_year,
    currentYear: staff.vacation_days_current_year,
    taken: staff.vacation_days_taken,
    confirmedNotInTaken: confirmedOtherPeriods,
  });

  const split =
    available == null
      ? { paid: [...workdays].sort(), unpaid: [] }
      : splitVacationProposal(workdays, available);

  return {
    available,
    previousYear: staff.vacation_days_previous_year,
    currentYear: staff.vacation_days_current_year,
    taken: staff.vacation_days_taken,
    confirmedOtherPeriods,
    requestedWorkdays: workdays.length,
    paidDates: split.paid,
    unpaidDates: split.unpaid,
  };
}

export const getVacationBalanceProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rangeInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return loadProposal(caller.organizationId, data);
  });

export const applyVacationSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rangeInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    return runWithPermission(
      context.supabase,
      "payroll.compensation.edit",
      null,
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
        const proposal = await loadProposal(caller.organizationId, data);
        if (proposal.available == null) {
          throw new Error(
            "Urlaubskonto im Stammblatt nicht gepflegt — keine automatische Aufteilung.",
          );
        }
        if (proposal.unpaidDates.length > 0) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin
            .from("roster_absence")
            .update({ type: "urlaub_unbezahlt" })
            .eq("staff_id", data.staffId)
            .eq("organization_id", caller.organizationId)
            .eq("type", "urlaub")
            .in("date", proposal.unpaidDates);
          if (error) throw new Error(error.message);
        }
        return {
          result: { ok: true as const, changed: proposal.unpaidDates.length },
          audit: {
            action: "roster_absence.vacation_split_applied",
            entity: "roster_absence",
            meta: {
              staff_id: data.staffId,
              von: data.fromDate,
              bis: data.toDate,
              anspruch_verfuegbar: proposal.available,
              arbeitstage_beantragt: proposal.requestedWorkdays,
              bezahlt: proposal.paidDates.length,
              unbezahlt: proposal.unpaidDates,
            },
          },
        };
      },
    );
  });
