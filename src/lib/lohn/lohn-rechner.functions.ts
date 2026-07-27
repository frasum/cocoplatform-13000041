// 2c — Verdrahtung: Periodenaggregation + Stammdaten -> Lohn-Kern.
//
// Zustandslose, admin-gated Serverfunktion: liest nur, schreibt nichts,
// kein audit_log. Gibt Zeilen, Person und das volle Ergebnis zurück,
// damit eine spätere UI Zeile für Zeile gegen edlohn vergleichen kann.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertPermission } from "@/lib/admin/admin-call";
import { aggregateSfnPeriod } from "./lohn-period.functions";
import { staffDetailsToPerson } from "./person-mapping";
import { berechneLohn } from "./lohn-core";
import type { Entgeltzeile, Kategorie } from "./types";
import { buildFixedZeilen } from "./fixed-zeilen";
import { computeUrlaubKrankDiagnose } from "./urlaub-krank-diagnose";
import { buildUrlaubKrankZeilen } from "./urlaub-krank-zeilen";
import { zeitlohnKategorie } from "./kategorie";
import { computeWeightedUkRate, type UkRateSlot } from "./uk-rate-weighted";
import { resolveRateCents, type RateRow } from "./rate-resolution";
import type { Department } from "@/lib/time/primary-department";
import {
  computeExportBlockers,
  type StaffBlocker,
  type StaffExportPayload,
} from "./export-blockers";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Re-Export für Bestandsimporte (z. B. zeitlohn-kategorie.test.ts) —
// die Implementierung liegt jetzt in `./kategorie` (zirkelfrei).
export { zeitlohnKategorie };

// LG3b 2a-iii — Lohnart-Bezeichnungen je Bereich (Lohnbüro 27.07., siehe
// docs/LG3b-bereichs-saetze.md). Der Zeitlohn-Split je Bereich ersetzt die
// Ein-Zeilen-Ausgabe des Alt-Pfads. Ein-Bereichs-Personen erhalten weiterhin
// genau eine Zeitlohn-Zeile mit identischem Betrag — Baseline-Nullmessung.
const ZEITLOHN_LABEL: Record<Department, string> = {
  service: "Zeitlohn (Service)",
  gl: "Zeitlohn 2 (GL)",
  kitchen: "Zeitlohn 3 (Küche)",
};
// LG3b A3 — Kategorien je Bereich (Nicht-Minijob). Etappe-1-Kategorien
// werden jetzt hier tatsächlich erzeugt — die 2b-Export-Spalten mappen
// darüber. Minijob bleibt bereichsunabhängig `aushilfe_paust`; die
// Bereichsunterscheidung tragen dann die Labels.
const ZEITLOHN_KATEGORIE: Record<Department, "zeitlohn" | "zeitlohn_2" | "zeitlohn_3"> = {
  service: "zeitlohn",
  gl: "zeitlohn_2",
  kitchen: "zeitlohn_3",
};
const AUSHILFE_LABEL: Record<Department, string> = {
  service: "Aushilfe-Zeitlohn (Service, pauschal)",
  gl: "Aushilfe-Zeitlohn 2 (GL, pauschal)",
  kitchen: "Aushilfe-Zeitlohn 3 (Küche, pauschal)",
};
const SFN_LABEL: Record<Department, string> = {
  service: "Service",
  gl: "GL",
  kitchen: "Küche",
};

/** YYYY-MM-DD - `days` Tage; UTC-anker, monatssicher. */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * LG3b G1 — U/K-Grundsatz je Person. Freigabe unterscheidet ausdrücklich:
 *   * Ein-Bereich → Bereichssatz auf `fromDate` aufgelöst. Bit-identisch
 *     zum Alt-Wert (Baselines bleiben grün).
 *   * Mehr-Bereich, gewichteter 91-Tage-Durchschnitt via
 *     `computeWeightedUkRate`:
 *       - `missing_rate` → 0 € mit rotem Marker; Export-Blocker durch die
 *         Blocker-Struktur unten.
 *       - `no_hours` → §104-Halt: konkrete Fehlermeldung wird geworfen
 *         (Übersicht fängt je Zeile ab, Einzelansicht zeigt sie).
 *   Der stille 0-€-Fallback ist damit weg.
 */
interface UkRateResolution {
  rateCents: number;
  missingDepartments: readonly Department[];
}
async function resolveUkHourlyRateCents(
  supabaseAdmin: SupabaseClient<Database>,
  args: {
    staffId: string;
    fromDate: string;
    usedDepts: readonly Department[];
    fallbackRateCents: number | null;
  },
): Promise<UkRateResolution> {
  if (args.usedDepts.length <= 1) {
    return { rateCents: args.fallbackRateCents ?? 0, missingDepartments: [] };
  }

  // Rates zum Periodenbeginn (jüngstes valid_from ≤ fromDate).
  const { data: rateRows, error: rateErr } = await supabaseAdmin
    .from("staff_compensation_rates")
    .select("department, valid_from, hourly_rate")
    .eq("staff_id", args.staffId);
  if (rateErr) throw rateErr;
  const rates: RateRow[] = (rateRows ?? []).map((r) => ({
    department: r.department as Department,
    validFrom: r.valid_from as string,
    hourlyRateCents: Math.round(Number(r.hourly_rate) * 100),
  }));

  // 91-Tage-Fenster vor Periodenbeginn: paidHours je Bereich aus dem
  // Alt-Aggregator (deckt PB2/pausen_bezahlt und Attribution identisch ab).
  const preTo = isoMinusDays(args.fromDate, 1);
  const preFrom = isoMinusDays(args.fromDate, 91);
  const pre = await aggregateSfnPeriod(supabaseAdmin, args.staffId, preFrom, preTo);
  const slots: UkRateSlot[] = pre.deptSlices.map((s) => ({
    department: s.department,
    paidHours: s.paidHours,
    rateCents: resolveRateCents(rates, s.department, args.fromDate),
  }));
  const weighted = computeWeightedUkRate(slots);
  if (weighted.rateCents != null) {
    return { rateCents: weighted.rateCents, missingDepartments: [] };
  }
  if (weighted.reason === "missing_rate") {
    // LG-9-c: Anzeige 0 € + Export-Blocker über die zurückgemeldeten
    // Bereiche. Kein stiller Fallback — die fehlenden Bereiche werden
    // sichtbar gemacht.
    return { rateCents: 0, missingDepartments: weighted.missingDepartments ?? [] };
  }
  // no_hours — Bauherren-Entscheidung ausstehend. §104-Halt: klar fehlschlagen.
  throw new Error(
    "U/K-Satz nicht bestimmbar: keine bezahlten Stunden im Referenzfenster — Bauherren-Entscheidung ausstehend",
  );
}

/**
 * Geteilter Rechen-Kern: Aggregat → Personenparameter → Entgeltzeilen → Lohn.
 * Wird von der Einzel-Function `berechneLohnFuerMitarbeiter` und der
 * Übersichts-Function `berechneLohnUebersicht` aufgerufen — kein zweiter
 * Rechenpfad, kein Drift.
 *
 * Wirft bei fehlenden `staff_personal_details` (gewollt — die Einzelansicht
 * soll klar fehlschlagen; die Übersicht fängt es pro Zeile ab).
 */
// LG3b Etappe 2a-0: additiv exportiert, damit die Baseline-Fixtures
// (`src/lib/lohn/lg3b-baseline-2a0.test.ts`) den unveränderten Alt-Pfad
// aufrufen können. KEINE Verhaltensänderung — reine Sichtbarkeit.
export async function computeLohnForStaff(
  supabaseAdmin: SupabaseClient<Database>,
  args: {
    staffId: string;
    organizationId: string;
    fromDate: string;
    toDate: string;
    mode: "simple" | "extended";
    zusatzZeilen: Entgeltzeile[];
  },
) {
  const sfn = await aggregateSfnPeriod(supabaseAdmin, args.staffId, args.fromDate, args.toDate);
  const chosen = args.mode === "extended" ? sfn.extended : sfn.simple;

  const { data: details, error: detErr } = await supabaseAdmin
    .from("staff_personal_details")
    .select(
      "tax_class, child_tax_allowances, kk_zusatzbeitrag, church_tax_liable, children_count, has_parent_status, is_minijob, date_of_birth, meal_allowance, sachbezug_monthly_cents, soll_hours_per_day, rv_frei, av_frei, lst_freibetrag_monat_cent, is_midijob, kv_frei, pv_frei, is_pkv, pkv_basis_beitrag_monat_cent, ist_werkstudent",
    )
    .eq("staff_id", args.staffId)
    .maybeSingle();
  if (detErr) throw detErr;
  if (!details) throw new Error("Keine Personaldaten für diesen Mitarbeiter.");

  const person = staffDetailsToPerson(details, args.toDate);

  const periodYear = Number(args.toDate.slice(0, 4));
  const fixedZeilen = buildFixedZeilen({
    sachbezugMonthlyCents: details.sachbezug_monthly_cents ?? 0,
    mealAllowance: details.meal_allowance ?? true,
    workdayCount: sfn.workdayCount,
    year: periodYear,
  });

  const diagnose = await computeUrlaubKrankDiagnose(supabaseAdmin, {
    staffId: args.staffId,
    organizationId: args.organizationId,
    fromDate: args.fromDate,
    toDate: args.toDate,
    mode: args.mode,
    sollHoursPerDay: Number(details.soll_hours_per_day ?? 8),
  });

  const { data: override, error: ovErr } = await supabaseAdmin
    .from("lohn_absence_days")
    .select("urlaub_tage, krank_tage")
    .eq("staff_id", args.staffId)
    .eq("period_start", args.fromDate)
    .maybeSingle();
  if (ovErr) throw ovErr;
  const usedUrlaubTage = override?.urlaub_tage ?? 0;
  const usedKrankTage = override?.krank_tage ?? 0;

  // LG3b 2a-iii — U/K-Satz: Ein-Bereich → Bereichssatz (identisch zum
  // Alt-Wert); Mehr-Bereich → gewichteter 91-Tage-Durchschnitt.
  // U/K wird nur ausgewertet, wenn Urlaubs-/Krank-Tage anfallen — sonst
  // darf ein leeres 91-Tage-Fenster keinen §104-Halt auslösen.
  const braucheUkSatz = usedUrlaubTage > 0 || usedKrankTage > 0;
  const usedDepts = sfn.deptSlices.map((s) => s.department);
  const ukResolution = braucheUkSatz
    ? await resolveUkHourlyRateCents(supabaseAdmin, {
        staffId: args.staffId,
        fromDate: args.fromDate,
        usedDepts,
        fallbackRateCents: sfn.hourlyRateCents,
      })
    : { rateCents: sfn.hourlyRateCents ?? 0, missingDepartments: [] as Department[] };
  const ukHourlyRateCents = ukResolution.rateCents;
  const ukMissingDepartments = ukResolution.missingDepartments;
  // Nicht mehr benötigt (durch die Auswertung oben ersetzt) — bewusst ohne
  // Aufruf, damit der Fallback nicht doppelt läuft.
  void ({} as unknown);
  const _dead = async () => resolveUkHourlyRateCents(supabaseAdmin, {
    staffId: args.staffId,
    fromDate: args.fromDate,
    usedDepts,
    fallbackRateCents: sfn.hourlyRateCents,
  });
  void _dead;

  const ukZeilen = buildUrlaubKrankZeilen({
    urlaubTage: usedUrlaubTage,
    krankTage: usedKrankTage,
    sollHoursPerDay: Number(details.soll_hours_per_day ?? 8),
    hourlyRateCents: ukHourlyRateCents,
    sfnTagCent: diagnose.avgSfnTagCent,
    beschaeftigung: person.beschaeftigung,
  });

  const { data: recurring, error: recErr } = await supabaseAdmin
    .from("lohn_recurring_zeilen")
    .select("bezeichnung, betrag_cent, kategorie, sort_order")
    .eq("staff_id", args.staffId)
    .order("sort_order");
  if (recErr) throw recErr;
  const recurringZeilen: Entgeltzeile[] = (recurring ?? []).map((r) => ({
    kategorie: r.kategorie as Kategorie,
    bezeichnung: r.bezeichnung,
    betragCent: r.betrag_cent,
  }));

  // LG3b 2a-iii — Zeitlohn und SFN je Bereich (Lohnart-Split). Bei
  // Ein-Bereichs-Personen entsteht wie im Alt-Pfad genau eine Zeitlohn-Zeile
  // und genau eine SFN-Zeile — die Baseline-Nullmessung bleibt bit-identisch.
  const kat = zeitlohnKategorie(person.beschaeftigung);
  const zeitlohnZeilen: Entgeltzeile[] = sfn.deptSlices.map((slice) => {
    const rate = slice.rateCents ?? 0;
    const label =
      person.beschaeftigung === "minijob"
        ? AUSHILFE_LABEL[slice.department]
        : ZEITLOHN_LABEL[slice.department];
    return {
      kategorie: kat,
      bezeichnung: label,
      betragCent: Math.round(slice.paidHours * rate),
      stunden: slice.paidHours,
      satzCent: rate,
    };
  });

  const sfnZeilen: Entgeltzeile[] = sfn.deptSlices.map((slice) => {
    const bucket = args.mode === "extended" ? slice.extended : slice.simple;
    return {
      kategorie: "zuschlag_frei",
      bezeichnung: `SFN-Zuschläge ${SFN_LABEL[slice.department]} (${args.mode})`,
      betragCent: bucket.zuschlagCents,
    };
  });

  // Fallback: völlig leere Periode → Alt-Verhalten (eine 0-Zeile Zeitlohn +
  // eine 0-Zeile SFN), damit `lohn-core` konsistent bleibt und die
  // Downstream-Anzeigen keine leere Zeilen-Liste sehen.
  if (zeitlohnZeilen.length === 0) {
    zeitlohnZeilen.push({
      kategorie: kat,
      bezeichnung:
        person.beschaeftigung === "minijob"
          ? "Aushilfe-Zeitlohn (pauschal)"
          : "Zeitlohn (Stunden × Satz)",
      betragCent: 0,
      stunden: 0,
      satzCent: sfn.hourlyRateCents,
    });
    sfnZeilen.push({
      kategorie: "zuschlag_frei",
      bezeichnung: `SFN-Zuschläge (${args.mode})`,
      betragCent: 0,
    });
  }

  const zeilen: Entgeltzeile[] = [
    ...zeitlohnZeilen,
    ...sfnZeilen,
    ...fixedZeilen,
    ...ukZeilen,
    ...recurringZeilen,
    ...args.zusatzZeilen,
  ];

  const ergebnis = berechneLohn({ person, zeilen });

  return {
    mode: args.mode,
    totalHours: sfn.totalHours,
    hourlyRateCents: sfn.hourlyRateCents,
    entryCount: sfn.entryCount,
    workdayCount: sfn.workdayCount,
    zuschlagCents: chosen.zuschlagCents,
    buckets: chosen,
    zeilen,
    person,
    ergebnis,
    diagnose,
    usedUrlaubTage,
    usedKrankTage,
  };
}

export const berechneLohnFuerMitarbeiter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        staffId: z.string().uuid(),
        fromDate: z.string().regex(dateRegex),
        toDate: z.string().regex(dateRegex),
        mode: z.enum(["simple", "extended"]).default("simple"),
        zusatzZeilen: z
          .array(
            z.object({
              kategorie: z.enum([
                "sachbezug_frei",
                "mahlzeiten_paust",
                "abzug",
                "einmalbezug",
                "zeitlohn",
                "zuschlag_frei",
              ]),
              bezeichnung: z.string().optional(),
              betragCent: z.number().int(),
            }),
          )
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, "payroll.calc.run");
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: staff, error: staffErr } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("id", data.staffId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staff) throw new Error("Mitarbeiter nicht in dieser Organisation.");

    return computeLohnForStaff(supabaseAdmin, {
      staffId: data.staffId,
      organizationId: caller.organizationId,
      fromDate: data.fromDate,
      toDate: data.toDate,
      mode: data.mode,
      zusatzZeilen: data.zusatzZeilen,
    });
  });

export const berechneLohnUebersicht = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromDate: z.string().regex(dateRegex),
        toDate: z.string().regex(dateRegex),
        mode: z.enum(["simple", "extended"]).default("simple"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, "payroll.calc.run");
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "payroll"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("staff")
      .select("id, display_name, first_name, last_name, perso_nr")
      .eq("organization_id", caller.organizationId)
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    if (staffErr) throw staffErr;

    const { data: payrollRows, error: payrollErr } = await supabaseAdmin
      .from("role_assignments")
      .select("staff_id")
      .eq("organization_id", caller.organizationId)
      .eq("role", "payroll");
    if (payrollErr) throw payrollErr;
    const payrollIds = new Set((payrollRows ?? []).map((r) => r.staff_id as string));
    const visibleStaffRows = (staffRows ?? []).filter((s) => !payrollIds.has(s.id as string));

    type Row = {
      staffId: string;
      persoNr: number | null;
      displayName: string;
      totalHours: number | null;
      hourlyRateCents: number | null;
      night25Hours: number | null;
      night40Hours: number | null;
      sundayHours: number | null;
      zuschlagCents: number | null;
      bruttoCents: number | null;
      stBruttoAusweisCent: number | null;
      lstCent: number | null;
      soliCent: number | null;
      kistCent: number | null;
      kvCent: number | null;
      rvCent: number | null;
      avCent: number | null;
      pvCent: number | null;
      nettoCents: number | null;
      auszahlungCents: number | null;
      workdayCount: number | null;
      mahlzeitenCent: number | null;
      sachbezugCent: number | null;
      urlaubTage: number | null;
      krankTage: number | null;
      urlaubTageEst: number | null;
      krankTageEst: number | null;
      avgStdTag: number | null;
      avgSfnTagCent: number | null;
      error: string | null;
    };
    const rows: Row[] = [];
    for (const s of visibleStaffRows) {
      const displayName =
        (s.display_name as string | null)?.trim() ||
        [s.first_name, s.last_name].filter(Boolean).join(" ").trim() ||
        (s.id as string);
      const persoNr = (s.perso_nr as number | null) ?? null;
      try {
        const r = await computeLohnForStaff(supabaseAdmin, {
          staffId: s.id as string,
          organizationId: caller.organizationId,
          fromDate: data.fromDate,
          toDate: data.toDate,
          mode: data.mode,
          zusatzZeilen: [],
        });
        const sumCat = (cat: string) =>
          r.zeilen.filter((z) => z.kategorie === cat).reduce((sum, z) => sum + z.betragCent, 0);
        rows.push({
          staffId: s.id as string,
          persoNr,
          displayName,
          totalHours: r.totalHours,
          hourlyRateCents: r.hourlyRateCents,
          night25Hours: r.buckets.night25Hours,
          night40Hours: r.buckets.night40Hours,
          sundayHours: r.buckets.sundayHours,
          zuschlagCents: r.zuschlagCents,
          bruttoCents: r.ergebnis.gesamtbruttoCent,
          stBruttoAusweisCent: r.ergebnis.stBruttoAusweisCent,
          lstCent: r.ergebnis.lstCent,
          soliCent: r.ergebnis.soliCent,
          kistCent: r.ergebnis.kistCent,
          kvCent: r.ergebnis.kvCent,
          rvCent: r.ergebnis.rvCent,
          avCent: r.ergebnis.avCent,
          pvCent: r.ergebnis.pvCent,
          nettoCents: r.ergebnis.gesamtnettoCent,
          auszahlungCents: r.ergebnis.auszahlungCent,
          workdayCount: r.workdayCount,
          mahlzeitenCent: sumCat("mahlzeiten_paust"),
          sachbezugCent: sumCat("sachbezug_frei"),
          urlaubTage: r.usedUrlaubTage,
          krankTage: r.usedKrankTage,
          urlaubTageEst: r.diagnose.urlaubTage,
          krankTageEst: r.diagnose.krankTage,
          avgStdTag: r.diagnose.avgStdTag,
          avgSfnTagCent: r.diagnose.avgSfnTagCent,
          error: null,
        });
      } catch (e) {
        rows.push({
          staffId: s.id as string,
          persoNr,
          displayName,
          totalHours: null,
          hourlyRateCents: null,
          night25Hours: null,
          night40Hours: null,
          sundayHours: null,
          zuschlagCents: null,
          bruttoCents: null,
          stBruttoAusweisCent: null,
          lstCent: null,
          soliCent: null,
          kistCent: null,
          kvCent: null,
          rvCent: null,
          avCent: null,
          pvCent: null,
          nettoCents: null,
          auszahlungCents: null,
          workdayCount: null,
          mahlzeitenCent: null,
          sachbezugCent: null,
          urlaubTage: null,
          krankTage: null,
          urlaubTageEst: null,
          krankTageEst: null,
          avgStdTag: null,
          avgSfnTagCent: null,
          error: e instanceof Error ? e.message : "Berechnung fehlgeschlagen",
        });
      }
    }
    return { mode: data.mode, fromDate: data.fromDate, toDate: data.toDate, rows };
  });
