// 13-Wochen-Diagnose (READ-ONLY): aus dem Muster der letzten 91 Tage vor Periodenbeginn
// die regulären Arbeits-Wochentage ableiten und Urlaub/Krank-Tage der Periode darauf
// einschränken. Liefert zusätzlich Tagesdurchschnitte (Stunden, SFN-Cent) aus dem
// Referenzfenster. Erzeugt KEINE Lohnart, verändert KEIN Brutto.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aggregateSfnPeriod } from "./lohn-period.functions";
import { workRate, estimateWorkdays, splitAbsenceCalDays } from "./urlaub-krank-core";
import { ABSENCE_TYPE_FILTER } from "@/lib/roster/absence-types";

function addDaysIso(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export interface UrlaubKrankDiagnose {
  urlaubTage: number;
  krankTage: number;
  /** UB1 — unbezahlter Urlaub: separat ausgewiesen, NICHT fortzahlungsrelevant. */
  urlaubUnbezahltTage: number;
  avgStdTag: number;
  avgSfnTagCent: number;
  absCalDays: number;
  refWorkedDays: number;
  refAbsenceDays: number;
}

export async function computeUrlaubKrankDiagnose(
  supabaseAdmin: SupabaseClient<Database>,
  args: {
    staffId: string;
    organizationId: string;
    fromDate: string;
    toDate: string;
    mode: "simple" | "extended";
    sollHoursPerDay: number;
  },
): Promise<UrlaubKrankDiagnose> {
  const refTo = addDaysIso(args.fromDate, -1);
  const refFrom = addDaysIso(args.fromDate, -91);

  const refAgg = await aggregateSfnPeriod(supabaseAdmin, args.staffId, refFrom, refTo);
  const chosen = args.mode === "extended" ? refAgg.extended : refAgg.simple;

  const { data: refAbsences, error: refAbsErr } = await supabaseAdmin
    .from("roster_absence")
    .select("date, type")
    .eq("staff_id", args.staffId)
    .eq("organization_id", args.organizationId)
    .gte("date", refFrom)
    .lte("date", refTo)
    // UB1: unbezahlte Tage zählen im Referenzfenster wie bisherige
    // Abwesenheitstage — die Durchschnittsbildung ändert sich nicht.
    .in("type", ABSENCE_TYPE_FILTER);
  if (refAbsErr) throw refAbsErr;
  const refAbsenceDays = (refAbsences ?? []).length;
  const refWorkedDays = refAgg.workdayCount;
  const scheduledDays = refWorkedDays + refAbsenceDays;

  const avgSfnTagCent = scheduledDays > 0 ? Math.round(chosen.zuschlagCents / scheduledDays) : 0;
  const rate = workRate(scheduledDays, 91);

  const { data: absences, error: absErr } = await supabaseAdmin
    .from("roster_absence")
    .select("date, type")
    .eq("staff_id", args.staffId)
    .eq("organization_id", args.organizationId)
    .gte("date", args.fromDate)
    .lte("date", args.toDate)
    .in("type", ABSENCE_TYPE_FILTER);
  if (absErr) throw absErr;

  const split = splitAbsenceCalDays(absences ?? []);
  const urlaubCalDays = split.urlaub;
  const krankCalDays = split.krank;

  return {
    urlaubTage: estimateWorkdays(urlaubCalDays, rate),
    krankTage: estimateWorkdays(krankCalDays, rate),
    urlaubUnbezahltTage: estimateWorkdays(split.urlaubUnbezahlt, rate),
    avgStdTag: args.sollHoursPerDay,
    avgSfnTagCent,
    absCalDays: urlaubCalDays + krankCalDays,
    refWorkedDays,
    refAbsenceDays,
  };
}
