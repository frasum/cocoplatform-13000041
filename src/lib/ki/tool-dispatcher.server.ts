// KI1 — Serverseitige Ausführung der Tools. Wird nur aus `ask-coco.functions`
// aufgerufen (Handler-Body). Kein direkter Client-Import — `.server.ts`
// bleibt aus dem Browser-Bundle draußen.
//
// Regel: JEDES Tool delegiert an bestehende Kern-Module (aggregateRennerPenner,
// aggregatePersonnel, mapToSessionInputs …). KEINE Zweitimplementierung —
// wir bauen nur den Datenzuschnitt (Query + Rückgabe-Shape für das Modell).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { selectAllPaged } from "@/lib/supabase/select-all";
import { normalizeName } from "@/lib/bestellung/sales-stats";
import { grossMinutesBetween } from "@/lib/time/break-rules";
import { primaryDepartment, type Department } from "@/lib/time/primary-department";
import {
  aggregateRennerPenner,
  matchesGroupFilter,
  mergeAcrossLocations,
  type RennerEntry,
  type RennerRawRow,
} from "@/lib/pos/renner-penner-core";
import { aggregatePersonnel, type WorkEntry } from "@/lib/statistics/personnel-core";
import {
  aggregateByBusinessDate,
  groupTakeawayByChannel,
  summarize,
} from "@/lib/statistics/revenue-core";
import {
  mapToSessionInputs,
  type ChannelAmountRow,
  type SessionRow,
} from "@/lib/statistics/revenue-map";
import {
  computeSessionTipPoolCore,
  loadTipSettings,
  type LoadedSession,
} from "@/lib/cash/cash.functions";
import type { TipSettings } from "@/lib/cash/tip-settings";
import { aggregateTips, type SessionTipResult } from "@/lib/statistics/tip-aggregate";
import type { AdminCaller } from "@/lib/admin/admin-context";
import { computePresets } from "./period-resolver";
import type { ToolName } from "./tools";
import { pseudonymizeDeep, type PseudonymMap } from "./pseudonym";
import {
  BENCHMARK_QUELLE,
  BENCHMARK_STAND,
  listBenchmarks,
  lookupBenchmark,
  type BenchmarkKennzahl,
} from "./branchenbenchmark";

type Admin = SupabaseClient<Database>;

export type ToolContext = {
  admin: Admin;
  organizationId: string;
  /** Aufruferkontext — für Kern-Module wie computeSessionTipPoolCore, die
   *  organizationId + Rolle des Admins erwarten. */
  caller: AdminCaller;
  /** Pseudonymisierungs-Map — Tools mit Personenbezug (arbeitsstunden,
   *  abwesenheiten) wenden sie auf ihr Ergebnis an, damit der Modell-Input
   *  garantiert keine Klarnamen enthält. */
  pseudonym: PseudonymMap;
};

/** Fehler, den das Modell als tool_result mit is_error=true sehen soll. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

// ─────────────────────────────────────────────────── branchenbenchmark_lookup

function branchenbenchmarkLookup(input: Record<string, unknown>) {
  const raw = input.kennzahl;
  const meta = {
    quelle: BENCHMARK_QUELLE,
    stand: BENCHMARK_STAND,
    segment: "Vollgastronomie Deutschland",
    hinweis:
      "Richtwerte, keine Punktschätzung. Für belastbare Vergleiche Definition (netto/brutto, inkl./ohne AG-Anteil) prüfen.",
  };
  if (raw === undefined || raw === null || raw === "") {
    return { ...meta, kennzahlen: listBenchmarks() };
  }
  if (typeof raw !== "string") {
    throw new ToolError("Parameter 'kennzahl' muss ein String sein.");
  }
  const entry = lookupBenchmark(raw as BenchmarkKennzahl);
  if (!entry) {
    throw new ToolError(
      `Unbekannte Kennzahl '${raw}'. Verfügbar: umsatz_pro_arbeitsstunde, personalkostenquote, wareneinsatzquote, bon_pro_gast.`,
    );
  }
  return { ...meta, kennzahl: entry };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireDate(input: unknown, field: string): string {
  if (typeof input !== "string" || !ISO_DATE.test(input)) {
    throw new ToolError(`Parameter '${field}' fehlt oder ist kein ISO-Datum YYYY-MM-DD.`);
  }
  return input;
}
function optionalUuid(input: unknown, field: string): string | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input !== "string" || !UUID_RE.test(input)) {
    throw new ToolError(`Parameter '${field}' ist keine gültige UUID.`);
  }
  return input;
}
function requireRange(a: unknown, b: unknown) {
  const from = requireDate(a, "from");
  const to = requireDate(b, "to");
  if (to < from) throw new ToolError("'to' muss >= 'from' sein.");
  return { from, to };
}

/** Eintrittspunkt. Wirft ToolError bei Nutzer-/Parameterfehlern. */
export async function runTool(
  ctx: ToolContext,
  name: ToolName,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "stammdaten_lookup":
      return await stammdatenLookup(ctx, input);
    case "getraenke_ranking":
      return await getraenkeRanking(ctx, input);
    case "umsatz_zeitraum":
      return await umsatzZeitraum(ctx, input);
    case "arbeitsstunden":
      return await arbeitsstunden(ctx, input);
    case "abwesenheiten":
      return await abwesenheiten(ctx, input);
    case "personalkosten_quote":
      return await personalkostenQuote(ctx, input);
    case "kasse_tagesabschluss":
      return await kasseTagesabschluss(ctx, input);
    case "bestellungen_zeitraum":
      return await bestellungenZeitraum(ctx, input);
    case "inventur_aktuell":
      return await inventurAktuell(ctx, input);
    case "bwa_monat":
      return await bwaMonat(ctx, input);
    case "bilanz_summen":
      return await bilanzSummen(ctx, input);
    case "dienstplan_geplant":
      return await dienstplanGeplant(ctx, input);
    case "aufgaben_status":
      return await aufgabenStatus(ctx, input);
    case "tausch_anfragen":
      return await tauschAnfragen(ctx, input);
    case "urlaub_antraege":
      return await urlaubAntraege(ctx, input);
    case "branchenbenchmark_lookup":
      return branchenbenchmarkLookup(input);
    case "personal_bestand":
      return await personalBestand(ctx, input);
    case "trinkgeld_aggregat":
      return await trinkgeldAggregat(ctx, input);
  }
}

// ───────────────────────────────────────────────────────────────── Tools ────

async function stammdatenLookup(ctx: ToolContext, input: Record<string, unknown>) {
  const art = String(input.art ?? "");
  if (art === "warengruppen") {
    const rows = await selectAllPaged<{
      hauptgruppe: string | null;
      warengruppe: string | null;
      is_active: boolean;
    }>((from, to) =>
      ctx.admin
        .from("sales_articles")
        .select("hauptgruppe, warengruppe, is_active")
        .eq("organization_id", ctx.organizationId)
        .eq("is_active", true)
        .order("hauptgruppe", { ascending: true, nullsFirst: false })
        .range(from, to),
    );
    const set = new Set<string>();
    for (const r of rows) {
      if (r.hauptgruppe) set.add(r.hauptgruppe);
      if (r.warengruppe) set.add(r.warengruppe);
    }
    return {
      warengruppen: [...set].sort((a, b) => a.localeCompare(b, "de")),
      hinweis: "Namen sind case-insensitiv, sowohl hauptgruppe als auch warengruppe.",
    };
  }
  if (art === "standorte") {
    const { data, error } = await ctx.admin
      .from("locations")
      .select("id, name")
      .eq("organization_id", ctx.organizationId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { standorte: (data ?? []).map((l) => ({ id: l.id, name: l.name })) };
  }
  if (art === "zeitraum_presets") {
    const presets = computePresets(new Date());
    return {
      heute: presets[0]!.from,
      presets,
      hinweis:
        "Wenn der Nutzer 'letzter Monat', 'letzte Woche' etc. sagt, nimm exakt den zugehörigen Preset-Zeitraum und nenne ihn im Antworttext.",
    };
  }
  throw new ToolError(`Unbekannte Stammdaten-Art: ${art}`);
}

async function getraenkeRanking(ctx: ToolContext, input: Record<string, unknown>) {
  const period = input.period === "alltime" ? "alltime" : "d365";
  const gruppen = Array.isArray(input.gruppen)
    ? (input.gruppen as unknown[]).filter((g): g is string => typeof g === "string" && g.length > 0)
    : [];
  const locationId = optionalUuid(input.location_id, "location_id");
  const topN = Math.min(Math.max(Number(input.top_n ?? 10) | 0, 1), 20);

  // Ziel-Standorte auflösen: entweder nur einer, oder alle der Org.
  const { data: locs, error: locErr } = await ctx.admin
    .from("locations")
    .select("id, name")
    .eq("organization_id", ctx.organizationId);
  if (locErr) throw new Error(locErr.message);
  const scope = locationId ? (locs ?? []).filter((l) => l.id === locationId) : (locs ?? []);
  if (scope.length === 0) throw new ToolError("Keine Standorte im Scope.");

  const perLoc: {
    locationId: string;
    locationName: string;
    entries: RennerEntry[];
    reportDate: string | null;
  }[] = [];
  for (const loc of scope) {
    const single = await loadRankingForLocation(ctx, loc, period, gruppen);
    perLoc.push(single);
  }
  const merged = mergeAcrossLocations(
    perLoc.map((p) => ({
      locationId: p.locationId,
      locationName: p.locationName,
      entries: p.entries,
    })),
    normalizeName,
  );

  const byUmsatz = [...merged].sort((a, b) => b.umsatzCents - a.umsatzCents).slice(0, topN);
  const byMenge = [...merged].sort((a, b) => b.einheitenGesamt - a.einheitenGesamt).slice(0, topN);
  const bottomUmsatz = [...merged]
    .filter((e) => e.einheitenGesamt > 0)
    .sort((a, b) => a.umsatzCents - b.umsatzCents)
    .slice(0, topN);

  const reportDate = perLoc.reduce<string | null>(
    (acc, p) => (p.reportDate && (acc === null || p.reportDate > acc) ? p.reportDate : acc),
    null,
  );

  const shape = (e: RennerEntry) => ({
    name: e.name,
    hauptgruppe: e.hauptgruppe,
    warengruppe: e.warengruppe,
    umsatz_eur: Math.round(e.umsatzCents) / 100,
    einheiten: e.einheitenGesamt,
    flaschen_aequivalent: e.flaschenAequivalent,
    offene_glaeser: e.offeneGlaeserCount,
    flaschen: e.flaschenCount,
    ekw_pct: e.ekwPct,
    db_eur: e.dbCents === null ? null : Math.round(e.dbCents) / 100,
  });

  return {
    period,
    scope: scope.map((s) => s.name),
    report_date: reportDate,
    hinweis:
      "period='d365' = Snapshot letzte 365 Tage, 'alltime' = Gesamt. Beliebige Datumsfenster sind hier nicht möglich.",
    top_umsatz: byUmsatz.map(shape),
    top_menge: byMenge.map(shape),
    penner_umsatz: bottomUmsatz.map(shape),
  };
}

async function loadRankingForLocation(
  ctx: ToolContext,
  loc: { id: string; name: string },
  period: "d365" | "alltime",
  gruppen: string[],
) {
  const stats = await selectAllPaged<{
    nummer: number;
    name: string;
    verkauf_count: number;
    umsatz_cents: number;
    report_date: string;
  }>((from, to) =>
    ctx.admin
      .from("sales_article_stats")
      .select("id, nummer, name, verkauf_count, umsatz_cents, report_date")
      .eq("organization_id", ctx.organizationId)
      .eq("location_id", loc.id)
      .eq("period", period)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const articles = await selectAllPaged<{
    name: string;
    hauptgruppe: string | null;
    warengruppe: string | null;
    is_active: boolean;
    ek_source_article_id: string | null;
    ek_portion_ml: number | null;
    ek_source_volume_ml: number | null;
    ek_price_cents: number | null;
    price_cents: number | null;
  }>((from, to) =>
    ctx.admin
      .from("sales_articles")
      .select(
        "name, hauptgruppe, warengruppe, is_active, ek_source_article_id, ek_portion_ml, ek_source_volume_ml, ek_price_cents, price_cents",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("location_id", loc.id)
      .order("name", { ascending: true })
      .range(from, to),
  );
  const vaByName = new Map<string, (typeof articles)[number]>();
  for (const a of articles) {
    const key = normalizeName(a.name);
    if (!vaByName.has(key)) vaByName.set(key, a);
  }
  const raw: RennerRawRow[] = [];
  for (const s of stats) {
    const va = vaByName.get(normalizeName(s.name));
    if (!va) continue;
    const row: RennerRawRow = {
      nummer: Number(s.nummer),
      name: va.name,
      hauptgruppe: va.hauptgruppe,
      warengruppe: va.warengruppe,
      verkaufCount: Number(s.verkauf_count),
      umsatzCents: Number(s.umsatz_cents),
      ekSourceArticleId: va.ek_source_article_id,
      ekPortionMl: va.ek_portion_ml === null ? null : Number(va.ek_portion_ml),
      ekSourceVolumeMl: va.ek_source_volume_ml === null ? null : Number(va.ek_source_volume_ml),
      ekPriceCents: va.ek_price_cents === null ? null : Number(va.ek_price_cents),
      priceCents: va.price_cents === null ? null : Number(va.price_cents),
    };
    if (!matchesGroupFilter(row, gruppen)) continue;
    raw.push(row);
  }
  const agg = aggregateRennerPenner(raw, [], { id: loc.id, name: loc.name });
  const reportDate = stats.reduce<string | null>(
    (acc, s) => (acc === null || s.report_date > acc ? s.report_date : acc),
    null,
  );
  return {
    locationId: loc.id,
    locationName: loc.name,
    entries: agg.entries,
    reportDate,
  };
}

async function umsatzZeitraum(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");

  let q = ctx.admin
    .from("sessions")
    .select(
      "id, business_date, location_id, vectron_daily_total_cents, vouchers_sold_cents, vouchers_redeemed_cents",
    )
    .eq("organization_id", ctx.organizationId)
    .gte("business_date", from)
    .lte("business_date", to);
  if (locationId) q = q.eq("location_id", locationId);
  const { data: sess, error } = await q;
  if (error) throw new Error(error.message);

  const sessions: SessionRow[] = (sess ?? []).map((r) => ({
    id: r.id as string,
    businessDate: r.business_date as string,
    locationId: r.location_id as string,
    vectronCents: (r.vectron_daily_total_cents as number | null) ?? 0,
  }));

  const voucherRows = (sess ?? []).map((r) => ({
    vouchersSoldCents: Number(r.vouchers_sold_cents ?? 0),
    vouchersRedeemedCents: Number(r.vouchers_redeemed_cents ?? 0),
  }));

  let channels: ChannelAmountRow[] = [];
  const takeawayRaw: { name: string; amountCents: number }[] = [];
  const settlementRows: { cardTotalCents: number; kassiertBruttoCents: number }[] = [];
  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id);
    const { data: ch, error: chErr } = await ctx.admin
      .from("session_channel_amounts")
      .select("session_id, amount_cents, revenue_channels(is_takeaway, label)")
      .eq("organization_id", ctx.organizationId)
      .in("session_id", ids)
      .returns<
        {
          session_id: string;
          amount_cents: number;
          revenue_channels: { is_takeaway: boolean; label: string } | null;
        }[]
      >();
    if (chErr) throw new Error(chErr.message);
    channels = (ch ?? []).map((r) => ({
      sessionId: r.session_id,
      amountCents: r.amount_cents,
      isTakeaway: r.revenue_channels?.is_takeaway ?? false,
    }));
    for (const r of ch ?? []) {
      if (r.revenue_channels?.is_takeaway) {
        takeawayRaw.push({
          name: r.revenue_channels.label,
          amountCents: r.amount_cents,
        });
      }
    }

    const { data: wsRows, error: wsErr } = await ctx.admin
      .from("waiter_settlements")
      .select("card_total_cents, kassiert_brutto_cents, pos_sales_cents, status")
      .eq("organization_id", ctx.organizationId)
      .in("session_id", ids)
      .neq("status", "superseded");
    if (wsErr) throw new Error(wsErr.message);
    for (const r of wsRows ?? []) {
      const kb =
        r.kassiert_brutto_cents === null || r.kassiert_brutto_cents === undefined
          ? Number(r.pos_sales_cents ?? 0)
          : Number(r.kassiert_brutto_cents);
      settlementRows.push({
        cardTotalCents: Number(r.card_total_cents ?? 0),
        kassiertBruttoCents: kb,
      });
    }
  }

  const daily = aggregateByBusinessDate(mapToSessionInputs(sessions, channels));
  const sum = summarize(daily);
  const zahlung = computePaymentBreakdown(settlementRows, voucherRows, takeawayRaw);

  return {
    range: { from, to },
    umsatz_eur: sum.totalCents / 100,
    umsatz_haus_eur: sum.houseCents / 100,
    umsatz_takeaway_eur: sum.takeawayCents / 100,
    tage_mit_umsatz: sum.daysWithRevenue,
    session_count: sessions.length,
    zahlungswege: {
      karte_eur: round2(zahlung.karteCents / 100),
      bar_rechnerisch_eur: round2(zahlung.barCentsRechnerisch / 100),
      gutscheine_verkauft_eur: round2(zahlung.gutscheineVerkauftCents / 100),
      gutscheine_eingeloest_eur: round2(zahlung.gutscheineEingeloestCents / 100),
      hinweis:
        "Bar ist eine rechnerische Restgröße = Σ kassiert_brutto − Σ Karte aus den aktiven Kellner-Abrechnungen (keine Kassenzählung).",
    },
    takeaway_kanaele: zahlung.takeawayKanaele.map((c) => ({
      name: c.name,
      betrag_eur: round2(c.amountCents / 100),
    })),
    hinweis:
      "Servicezeit-Aufschlüsselung (Mittag/Abend) ist aus den Kassendaten NICHT ableitbar — sessions sind Tages-Einheiten.",
  };
}

/** A1′ — Reine Aufbereitung der Zahlungsweg-Antwort. Exportiert für Tests. */
export type PaymentBreakdown = {
  karteCents: number;
  barCentsRechnerisch: number;
  gutscheineVerkauftCents: number;
  gutscheineEingeloestCents: number;
  takeawayKanaele: { name: string; amountCents: number }[];
};

export function computePaymentBreakdown(
  settlements: readonly { cardTotalCents: number; kassiertBruttoCents: number }[],
  vouchers: readonly { vouchersSoldCents: number; vouchersRedeemedCents: number }[],
  takeawayRaw: readonly { name: string; amountCents: number }[],
): PaymentBreakdown {
  let karteCents = 0;
  let kassiertBruttoCents = 0;
  for (const s of settlements) {
    karteCents += s.cardTotalCents;
    kassiertBruttoCents += s.kassiertBruttoCents;
  }
  let gutscheineVerkauftCents = 0;
  let gutscheineEingeloestCents = 0;
  for (const v of vouchers) {
    gutscheineVerkauftCents += v.vouchersSoldCents;
    gutscheineEingeloestCents += v.vouchersRedeemedCents;
  }
  return {
    karteCents,
    barCentsRechnerisch: Math.max(0, kassiertBruttoCents - karteCents),
    gutscheineVerkauftCents,
    gutscheineEingeloestCents,
    takeawayKanaele: groupTakeawayByChannel(takeawayRaw),
  };
}

async function arbeitsstunden(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");
  const rawDept = typeof input.department === "string" ? input.department : undefined;
  const dept =
    rawDept === "kueche" || rawDept === "kitchen"
      ? "kitchen"
      : rawDept === "service"
        ? "service"
        : undefined;

  let q = ctx.admin
    .from("time_entries")
    .select(
      "staff_id, started_at, ended_at, break_minutes, business_date, location_id, staff(display_name)",
    )
    .eq("organization_id", ctx.organizationId)
    .gte("business_date", from)
    .lte("business_date", to)
    .not("ended_at", "is", null);
  if (locationId) q = q.eq("location_id", locationId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  // Standort-Departments — für Filter/Bericht.
  const { data: deptRows, error: deptErr } = await ctx.admin
    .from("staff_locations")
    .select("staff_id, location_id, department");
  if (deptErr) throw new Error(deptErr.message);
  const deptByStaffLocation = new Map<string, string>();
  const byStaffLoc = new Map<string, Department[]>();
  for (const r of deptRows ?? []) {
    const key = `${r.location_id as string}|${r.staff_id as string}`;
    const arr = byStaffLoc.get(key) ?? [];
    arr.push(r.department as Department);
    byStaffLoc.set(key, arr);
  }
  for (const [key, depts] of byStaffLoc) {
    deptByStaffLocation.set(key, primaryDepartment(depts));
  }

  type Agg = { netMinutes: number; department: string; displayName: string };
  const perStaff = new Map<string, Agg>();
  let totalNet = 0;
  let totalGross = 0;
  for (const r of rows ?? []) {
    if (!r.ended_at || !r.started_at) continue;
    const gross = grossMinutesBetween(new Date(r.started_at), new Date(r.ended_at));
    const net = Math.max(0, gross - Number(r.break_minutes ?? 0));
    const d =
      deptByStaffLocation.get(`${r.location_id as string}|${r.staff_id as string}`) ?? "service";
    if (dept && d !== dept) continue;
    totalNet += net;
    totalGross += gross;
    const cur = perStaff.get(r.staff_id as string) ?? {
      netMinutes: 0,
      department: d,
      displayName: (r.staff as { display_name: string } | null)?.display_name ?? String(r.staff_id),
    };
    cur.netMinutes += net;
    perStaff.set(r.staff_id as string, cur);
  }

  const perDeptMinutes = new Map<string, number>();
  for (const a of perStaff.values()) {
    perDeptMinutes.set(a.department, (perDeptMinutes.get(a.department) ?? 0) + a.netMinutes);
  }

  const result = {
    range: { from, to },
    filter: { department: dept ?? null, location_id: locationId ?? null },
    netto_stunden: round1(totalNet / 60),
    brutto_stunden: round1(totalGross / 60),
    per_department: [...perDeptMinutes.entries()]
      .map(([d, m]) => ({ department: d, netto_stunden: round1(m / 60) }))
      .sort((a, b) => b.netto_stunden - a.netto_stunden),
    per_staff: [...perStaff.entries()]
      .map(([staffId, a]) => ({
        staff_id: staffId,
        name: a.displayName,
        department: a.department,
        netto_stunden: round1(a.netMinutes / 60),
      }))
      .sort((a, b) => b.netto_stunden - a.netto_stunden),
  };
  return pseudonymizeDeep(result, ctx.pseudonym);
}

async function abwesenheiten(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const typ = input.typ === "krank" || input.typ === "urlaub" ? input.typ : undefined;

  const { data: rows, error } = await ctx.admin
    .from("roster_absence")
    .select("staff_id, date, type, staff(display_name)")
    .eq("organization_id", ctx.organizationId)
    .gte("date", from)
    .lte("date", to);
  if (error) throw new Error(error.message);

  type Agg = { krankDays: number; urlaubDays: number; displayName: string };
  const perStaff = new Map<string, Agg>();
  let totalKrank = 0;
  let totalUrlaub = 0;
  for (const r of rows ?? []) {
    if (typ && r.type !== typ) continue;
    const staffId = r.staff_id as string;
    const cur = perStaff.get(staffId) ?? {
      krankDays: 0,
      urlaubDays: 0,
      displayName: (r.staff as { display_name: string } | null)?.display_name ?? staffId,
    };
    if (r.type === "krank") {
      cur.krankDays += 1;
      totalKrank += 1;
    } else if (r.type === "urlaub") {
      cur.urlaubDays += 1;
      totalUrlaub += 1;
    }
    perStaff.set(staffId, cur);
  }

  const result = {
    range: { from, to },
    filter_typ: typ ?? null,
    gesamt_krank_tage: totalKrank,
    gesamt_urlaub_tage: totalUrlaub,
    per_staff: [...perStaff.entries()]
      .map(([staffId, a]) => ({
        staff_id: staffId,
        name: a.displayName,
        krank_tage: a.krankDays,
        urlaub_tage: a.urlaubDays,
      }))
      .sort((a, b) => b.krank_tage + b.urlaub_tage - (a.krank_tage + a.urlaub_tage)),
  };
  return pseudonymizeDeep(result, ctx.pseudonym);
}

async function personalkostenQuote(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");

  let q = ctx.admin
    .from("time_entries")
    .select("staff_id, started_at, ended_at, break_minutes, business_date, location_id")
    .eq("organization_id", ctx.organizationId)
    .gte("business_date", from)
    .lte("business_date", to)
    .not("ended_at", "is", null);
  if (locationId) q = q.eq("location_id", locationId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);

  const workEntries: WorkEntry[] = [];
  const staffIdSet = new Set<string>();
  for (const r of rows ?? []) {
    if (!r.ended_at || !r.started_at) continue;
    const gross = grossMinutesBetween(new Date(r.started_at), new Date(r.ended_at));
    const net = Math.max(0, gross - Number(r.break_minutes ?? 0));
    staffIdSet.add(r.staff_id as string);
    workEntries.push({
      staffId: r.staff_id as string,
      businessDate: r.business_date as string,
      netMinutes: net,
    });
  }

  const compByStaff: Record<string, CompRow[]> = {};
  if (staffIdSet.size > 0) {
    const { data: comp, error: compErr } = await ctx.admin
      .from("staff_compensation")
      .select("staff_id, valid_from, hourly_rate")
      .eq("organization_id", ctx.organizationId)
      .in("staff_id", [...staffIdSet]);
    if (compErr) throw new Error(compErr.message);
    for (const c of comp ?? []) {
      if (!c.staff_id || !c.valid_from || c.hourly_rate === null) continue;
      (compByStaff[c.staff_id as string] ??= []).push({
        validFrom: c.valid_from as string,
        hourlyRateEur: Number(c.hourly_rate),
      });
    }
  }
  const agg = aggregatePersonnel(workEntries, compByStaff);

  // Umsatz derselbe Ausschnitt.
  const umsatz = await umsatzZeitraum(ctx, { from, to, location_id: locationId ?? "" });
  const kostenEur = agg.totalLaborCostCents / 100;
  const umsatzEur = (umsatz as { umsatz_eur: number }).umsatz_eur;
  const quote = umsatzEur > 0 ? +(100 * (kostenEur / umsatzEur)).toFixed(1) : null;

  return {
    range: { from, to },
    location_id: locationId ?? null,
    personalkosten_eur: round2(kostenEur),
    netto_stunden: round1(agg.totalNetHours),
    mitarbeiter_ohne_lohnsatz: agg.staffWithoutRate.length,
    umsatz_eur: round2(umsatzEur),
    quote_pct: quote,
    hinweis:
      "Nur Brutto-Basis (Netto-Stunden × Stundensatz). AG-SV-Anteil und SFN-Zuschläge sind NICHT enthalten — Quote ist eine Näherung.",
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────── Kasse & Umsätze ───

async function kasseTagesabschluss(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");

  let sq = ctx.admin
    .from("sessions")
    .select(
      "id, business_date, location_id, guest_count, vectron_daily_total_cents, vouchers_sold_cents, vouchers_redeemed_cents, einladung_cents, sonstige_einnahme_cents, opening_balance_cents, cash_actual_cents",
    )
    .eq("organization_id", ctx.organizationId)
    .gte("business_date", from)
    .lte("business_date", to);
  if (locationId) sq = sq.eq("location_id", locationId);
  const { data: sess, error } = await sq;
  if (error) throw new Error(error.message);
  const sessions = sess ?? [];
  const ids = sessions.map((s) => s.id as string);

  async function sumBy<T extends { session_id: string; amount_cents: number }>(
    table: "session_expenses" | "session_card_transactions" | "session_bank_deposits",
  ): Promise<{ total: number; count: number }> {
    if (ids.length === 0) return { total: 0, count: 0 };
    const { data, error: e } = await ctx.admin
      .from(table)
      .select("session_id, amount_cents")
      .eq("organization_id", ctx.organizationId)
      .in("session_id", ids)
      .returns<T[]>();
    if (e) throw new Error(e.message);
    let total = 0;
    for (const r of data ?? []) total += Number(r.amount_cents ?? 0);
    return { total, count: (data ?? []).length };
  }
  const expenses = await sumBy("session_expenses");
  const cardTx = await sumBy("session_card_transactions");
  const bank = await sumBy("session_bank_deposits");

  let transfersIn = 0;
  let transfersOut = 0;
  if (ids.length > 0) {
    const { data: tr, error: trErr } = await ctx.admin
      .from("session_register_transfers")
      .select("session_id, amount_cents, direction")
      .eq("organization_id", ctx.organizationId)
      .in("session_id", ids);
    if (trErr) throw new Error(trErr.message);
    for (const r of tr ?? []) {
      const c = Number(r.amount_cents ?? 0);
      if (r.direction === "to_restaurant") transfersIn += c;
      else transfersOut += c; // to_safe / to_other / from_restaurant = Abfluss
    }
  }

  let guests = 0;
  let vectron = 0;
  let vouchersSold = 0;
  let vouchersRedeemed = 0;
  let einladung = 0;
  let sonstige = 0;
  for (const s of sessions) {
    guests += Number(s.guest_count ?? 0);
    vectron += Number(s.vectron_daily_total_cents ?? 0);
    vouchersSold += Number(s.vouchers_sold_cents ?? 0);
    vouchersRedeemed += Number(s.vouchers_redeemed_cents ?? 0);
    einladung += Number(s.einladung_cents ?? 0);
    sonstige += Number(s.sonstige_einnahme_cents ?? 0);
  }

  return {
    range: { from, to },
    location_id: locationId ?? null,
    session_count: sessions.length,
    gaeste_gesamt: guests,
    vectron_umsatz_eur: round2(vectron / 100),
    ausgaben_eur: round2(expenses.total / 100),
    ausgaben_anzahl: expenses.count,
    kartenzahlung_eur: round2(cardTx.total / 100),
    kartenzahlung_anzahl: cardTx.count,
    bank_einzahlung_eur: round2(bank.total / 100),
    bank_einzahlung_anzahl: bank.count,
    tresor_zufuhr_eur: round2(transfersIn / 100),
    tresor_entnahme_eur: round2(transfersOut / 100),
    gutscheine_verkauft_eur: round2(vouchersSold / 100),
    gutscheine_eingeloest_eur: round2(vouchersRedeemed / 100),
    einladungen_eur: round2(einladung / 100),
    sonstige_einnahmen_eur: round2(sonstige / 100),
    hinweis:
      "Umsatz-Kanäle mit Haus/Takeaway-Splittung: nutze umsatz_zeitraum. Trinkgeldpool: aktuell nicht als eigenes Werkzeug — steht in Kassen-Detailseite.",
  };
}

// ────────────────────────────────────────────────────── Bestellungen ───

async function bestellungenZeitraum(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");
  const supplierId = optionalUuid(input.supplier_id, "supplier_id");
  const status = typeof input.status === "string" ? input.status : "any";

  // Wir filtern nach created_at (Bestelltag). Range inklusive Enddatum → +1 Tag.
  const toExclusive = new Date(to + "T00:00:00Z");
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const toIso = toExclusive.toISOString().slice(0, 10);

  let q = ctx.admin
    .from("orders")
    .select("supplier_id, location_id, total_amount_cents, status, suppliers(name)")
    .eq("organization_id", ctx.organizationId)
    .gte("created_at", from)
    .lt("created_at", toIso);
  if (locationId) q = q.eq("location_id", locationId);
  if (supplierId) q = q.eq("supplier_id", supplierId);
  if (status !== "any") q = q.eq("status", status);
  const { data, error } = await q.returns<
    {
      supplier_id: string;
      location_id: string | null;
      total_amount_cents: number;
      status: string;
      suppliers: { name: string } | null;
    }[]
  >();
  if (error) throw new Error(error.message);

  type Agg = { name: string; count: number; totalCents: number };
  const perSup = new Map<string, Agg>();
  let totalCents = 0;
  for (const r of data ?? []) {
    const cur = perSup.get(r.supplier_id) ?? {
      name: r.suppliers?.name ?? "?",
      count: 0,
      totalCents: 0,
    };
    cur.count += 1;
    cur.totalCents += Number(r.total_amount_cents ?? 0);
    perSup.set(r.supplier_id, cur);
    totalCents += Number(r.total_amount_cents ?? 0);
  }
  const list = [...perSup.entries()]
    .map(([id, a]) => ({
      supplier_id: id,
      name: a.name,
      bestellungen: a.count,
      summe_eur: round2(a.totalCents / 100),
    }))
    .sort((a, b) => b.summe_eur - a.summe_eur);

  return {
    range: { from, to },
    filter: { location_id: locationId ?? null, supplier_id: supplierId ?? null, status },
    bestellungen_gesamt: data?.length ?? 0,
    summe_eur: round2(totalCents / 100),
    per_lieferant: list.slice(0, 20),
    hinweis:
      "Zeitraumfilter bezieht sich auf das Bestelldatum (created_at), nicht das Lieferdatum.",
  };
}

// ─────────────────────────────────────────────────────────── Inventur ───

async function inventurAktuell(ctx: ToolContext, input: Record<string, unknown>) {
  const locationId = optionalUuid(input.location_id, "location_id");
  let q = ctx.admin
    .from("inventory_sessions")
    .select("id, location_id, name, completed_at, total_value_cents, locations(name)")
    .eq("organization_id", ctx.organizationId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.returns<
    {
      id: string;
      location_id: string;
      name: string;
      completed_at: string | null;
      total_value_cents: number;
      locations: { name: string } | null;
    }[]
  >();
  if (error) throw new Error(error.message);

  const latestByLoc = new Map<string, (typeof data)[number]>();
  for (const r of data ?? []) {
    if (!latestByLoc.has(r.location_id)) latestByLoc.set(r.location_id, r);
  }
  const sessions = [...latestByLoc.values()];

  // Anzahl gezählter Artikel je Session (kompakt).
  const perLoc: {
    location_id: string;
    location_name: string;
    inventur_name: string;
    completed_at: string | null;
    gesamtwert_eur: number;
    artikel_anzahl: number;
  }[] = [];
  for (const s of sessions) {
    const { count, error: cErr } = await ctx.admin
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("session_id", s.id);
    if (cErr) throw new Error(cErr.message);
    perLoc.push({
      location_id: s.location_id,
      location_name: s.locations?.name ?? "?",
      inventur_name: s.name,
      completed_at: s.completed_at,
      gesamtwert_eur: round2(Number(s.total_value_cents ?? 0) / 100),
      artikel_anzahl: count ?? 0,
    });
  }
  perLoc.sort((a, b) => a.location_name.localeCompare(b.location_name, "de"));

  return {
    inventuren: perLoc,
    hinweis:
      "Jeweils LETZTE abgeschlossene Inventur je Standort. Ältere Inventuren sind hier nicht enthalten.",
  };
}

// ─────────────────────────────────────────────────────────── BWA / Bilanz ───

async function bwaMonat(ctx: ToolContext, input: Record<string, unknown>) {
  const monthRaw = String(input.month ?? "");
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(monthRaw);
  if (!m) throw new ToolError("Parameter 'month' muss YYYY-MM (oder YYYY-MM-01) sein.");
  const monthIso = `${m[1]}-${m[2]}-01`;
  const entity = typeof input.entity === "string" && input.entity ? input.entity : null;
  const cc = typeof input.cost_center === "string" && input.cost_center ? input.cost_center : null;

  let q = ctx.admin
    .from("bwa_monthly")
    .select(
      "entity, cost_center, umsatz_cents, personal_cents, wareneinsatz_cents, sachkosten_cents, abschreibung_cents, sonst_ertraege_cents, sonstige_erloese_cents, speisen_haus_cents, speisen_ausser_haus_cents, getraenke_cents, betriebsergebnis_cents",
    )
    .eq("organization_id", ctx.organizationId)
    .eq("month", monthIso);
  if (entity) q = q.eq("entity", entity);
  if (cc) q = q.eq("cost_center", cc);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    return {
      month: monthIso,
      filter: { entity, cost_center: cc },
      gefunden: false,
      hinweis: "Keine BWA-Daten für diesen Monat/Filter.",
    };
  }

  const sum = {
    umsatz: 0,
    personal: 0,
    wareneinsatz: 0,
    sachkosten: 0,
    abschreibung: 0,
    sonstErtraege: 0,
    sonstigeErloese: 0,
    speisenHaus: 0,
    speisenAusser: 0,
    getraenke: 0,
    ergebnis: 0,
  };
  for (const r of data) {
    sum.umsatz += Number(r.umsatz_cents ?? 0);
    sum.personal += Number(r.personal_cents ?? 0);
    sum.wareneinsatz += Number(r.wareneinsatz_cents ?? 0);
    sum.sachkosten += Number(r.sachkosten_cents ?? 0);
    sum.abschreibung += Number(r.abschreibung_cents ?? 0);
    sum.sonstErtraege += Number(r.sonst_ertraege_cents ?? 0);
    sum.sonstigeErloese += Number(r.sonstige_erloese_cents ?? 0);
    sum.speisenHaus += Number(r.speisen_haus_cents ?? 0);
    sum.speisenAusser += Number(r.speisen_ausser_haus_cents ?? 0);
    sum.getraenke += Number(r.getraenke_cents ?? 0);
    sum.ergebnis += Number(r.betriebsergebnis_cents ?? 0);
  }
  const c2e = (c: number) => round2(c / 100);
  const perCC = data.map((r) => ({
    entity: r.entity,
    cost_center: r.cost_center,
    umsatz_eur: c2e(Number(r.umsatz_cents ?? 0)),
    personal_eur: c2e(Number(r.personal_cents ?? 0)),
    wareneinsatz_eur: c2e(Number(r.wareneinsatz_cents ?? 0)),
    sachkosten_eur: c2e(Number(r.sachkosten_cents ?? 0)),
    ergebnis_eur: c2e(Number(r.betriebsergebnis_cents ?? 0)),
  }));

  return {
    month: monthIso,
    filter: { entity, cost_center: cc },
    gefunden: true,
    zeilen_anzahl: data.length,
    summe: {
      umsatz_eur: c2e(sum.umsatz),
      speisen_haus_eur: c2e(sum.speisenHaus),
      speisen_ausser_haus_eur: c2e(sum.speisenAusser),
      getraenke_eur: c2e(sum.getraenke),
      sonstige_erloese_eur: c2e(sum.sonstigeErloese),
      sonstige_ertraege_eur: c2e(sum.sonstErtraege),
      personal_eur: c2e(sum.personal),
      wareneinsatz_eur: c2e(sum.wareneinsatz),
      sachkosten_eur: c2e(sum.sachkosten),
      abschreibung_eur: c2e(sum.abschreibung),
      betriebsergebnis_eur: c2e(sum.ergebnis),
    },
    per_cost_center: perCC,
  };
}

async function bilanzSummen(ctx: ToolContext, input: Record<string, unknown>) {
  const fy = Number(input.fiscal_year);
  if (!Number.isFinite(fy) || fy < 2000 || fy > 2100) {
    throw new ToolError("Parameter 'fiscal_year' muss eine gültige Jahreszahl sein.");
  }
  const entity = typeof input.entity === "string" ? input.entity : "";
  if (!entity) throw new ToolError("Parameter 'entity' fehlt.");

  const { data, error } = await ctx.admin
    .from("bilanz_positions")
    .select("statement, level, code, label, betrag_cents, vorjahr_cents")
    .eq("organization_id", ctx.organizationId)
    .eq("entity", entity)
    .eq("fiscal_year", fy)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    return {
      entity,
      fiscal_year: fy,
      gefunden: false,
      hinweis: "Keine Bilanzdaten für diesen Betrieb/Jahr.",
    };
  }
  const top = data.filter((r) => Number(r.level ?? 99) === 1);
  const per = top.map((r) => ({
    statement: r.statement,
    code: r.code,
    label: r.label,
    betrag_eur: round2(Number(r.betrag_cents ?? 0) / 100),
    vorjahr_eur: r.vorjahr_cents === null ? null : round2(Number(r.vorjahr_cents) / 100),
  }));
  const byStatement = new Map<string, number>();
  for (const r of top) {
    byStatement.set(r.statement, (byStatement.get(r.statement) ?? 0) + Number(r.betrag_cents ?? 0));
  }
  return {
    entity,
    fiscal_year: fy,
    gefunden: true,
    summe_pro_statement_eur: Object.fromEntries(
      [...byStatement.entries()].map(([k, v]) => [k, round2(v / 100)]),
    ),
    positionen_top_level: per,
    hinweis: "Nur Positionen auf oberster Ebene (level=1). Konten-Detail nicht enthalten.",
  };
}

// ─────────────────────────────────────────────────────────── Dienstplan ───

async function dienstplanGeplant(ctx: ToolContext, input: Record<string, unknown>) {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");
  const dept = typeof input.department === "string" ? input.department : undefined;
  const validDept = dept === "service" || dept === "kitchen" || dept === "gl" ? dept : undefined;

  let q = ctx.admin
    .from("roster_shifts")
    .select("staff_id, location_id, area, service_period, shift_date, staff(display_name)")
    .eq("organization_id", ctx.organizationId)
    .gte("shift_date", from)
    .lte("shift_date", to);
  if (locationId) q = q.eq("location_id", locationId);
  if (validDept) q = q.eq("area", validDept);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  let total = 0;
  const perDept = new Map<string, number>();
  const perPeriod = new Map<string, number>();
  type S = { name: string; shifts: number };
  const perStaff = new Map<string, S>();
  for (const r of data ?? []) {
    total += 1;
    const d = String(r.area);
    perDept.set(d, (perDept.get(d) ?? 0) + 1);
    const p = String(r.service_period ?? "abend");
    perPeriod.set(p, (perPeriod.get(p) ?? 0) + 1);
    const staffId = r.staff_id as string;
    const cur = perStaff.get(staffId) ?? {
      name: (r.staff as { display_name: string } | null)?.display_name ?? staffId,
      shifts: 0,
    };
    cur.shifts += 1;
    perStaff.set(staffId, cur);
  }
  const result = {
    range: { from, to },
    filter: { location_id: locationId ?? null, department: validDept ?? null },
    geplante_schichten: total,
    per_department: [...perDept.entries()].map(([d, n]) => ({ department: d, schichten: n })),
    per_servicezeit: [...perPeriod.entries()].map(([p, n]) => ({ servicezeit: p, schichten: n })),
    per_staff: [...perStaff.entries()]
      .map(([id, s]) => ({ staff_id: id, name: s.name, schichten: s.shifts }))
      .sort((a, b) => b.schichten - a.schichten),
    hinweis:
      "Nur Schichtanzahl — geplante Stunden werden nicht gespeichert. Für tatsächliche Stunden nutze arbeitsstunden.",
  };
  return pseudonymizeDeep(result, ctx.pseudonym);
}

// ─────────────────────────────────────────────────────────── Aufgaben ───

async function aufgabenStatus(ctx: ToolContext, input: Record<string, unknown>) {
  const locationId = optionalUuid(input.location_id, "location_id");
  const category = typeof input.category === "string" ? input.category : undefined;
  const validCat =
    category === "service" ||
    category === "kitchen" ||
    category === "maintenance" ||
    category === "manager_admin"
      ? category
      : undefined;

  let q = ctx.admin
    .from("tasks")
    .select("status, category, due_at, location_id, locations(name)")
    .eq("organization_id", ctx.organizationId)
    .is("archived_at", null);
  if (locationId) q = q.eq("location_id", locationId);
  if (validCat) q = q.eq("category", validCat);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const now = new Date();
  let overdue = 0;
  const perStatus = new Map<string, number>();
  const perCat = new Map<string, number>();
  const perLoc = new Map<string, { name: string; count: number }>();
  for (const r of data ?? []) {
    const s = String(r.status);
    perStatus.set(s, (perStatus.get(s) ?? 0) + 1);
    const c = String(r.category);
    perCat.set(c, (perCat.get(c) ?? 0) + 1);
    const loc = r.location_id as string;
    const cur = perLoc.get(loc) ?? {
      name: (r.locations as { name: string } | null)?.name ?? "?",
      count: 0,
    };
    cur.count += 1;
    perLoc.set(loc, cur);
    if (r.due_at && s === "open" && new Date(r.due_at as string) < now) overdue += 1;
  }
  return {
    filter: { location_id: locationId ?? null, category: validCat ?? null },
    gesamt: data?.length ?? 0,
    ueberfaellig: overdue,
    per_status: [...perStatus.entries()].map(([s, n]) => ({ status: s, anzahl: n })),
    per_kategorie: [...perCat.entries()].map(([c, n]) => ({ kategorie: c, anzahl: n })),
    per_standort: [...perLoc.entries()]
      .map(([id, v]) => ({ location_id: id, name: v.name, anzahl: v.count }))
      .sort((a, b) => b.anzahl - a.anzahl),
    hinweis:
      "Nur nicht-archivierte Aufgaben. Überfällig = Status offen und due_at in der Vergangenheit.",
  };
}

// ─────────────────────────────────────────────────────── Tausch & Urlaub ───

async function tauschAnfragen(ctx: ToolContext, input: Record<string, unknown>) {
  const status = typeof input.status === "string" ? input.status : "open";
  const from = typeof input.from === "string" && ISO_DATE.test(input.from) ? input.from : null;
  const to = typeof input.to === "string" && ISO_DATE.test(input.to) ? input.to : null;

  let q = ctx.admin
    .from("shift_swap_requests")
    .select(
      "id, status, created_at, requester_staff_id, peer_staff_id, shift_id, roster_shifts!shift_swap_requests_shift_id_fkey(shift_date, location_id, area, locations(name)), req:staff!shift_swap_requests_requester_staff_id_fkey(display_name), peer:staff!shift_swap_requests_peer_staff_id_fkey(display_name)",
    )
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false });
  if (status === "any") {
    // kein Filter
  } else if (status === "open") {
    q = q.in("status", ["pending", "peer_accepted"]);
  } else {
    q = q.eq("status", status);
  }
  const { data, error } = await q.returns<
    {
      id: string;
      status: string;
      created_at: string;
      requester_staff_id: string;
      peer_staff_id: string | null;
      shift_id: string;
      roster_shifts: {
        shift_date: string;
        location_id: string;
        area: string;
        locations: { name: string } | null;
      } | null;
      req: { display_name: string } | null;
      peer: { display_name: string } | null;
    }[]
  >();
  if (error) throw new Error(error.message);

  let filtered = data ?? [];
  if (from) filtered = filtered.filter((r) => (r.roster_shifts?.shift_date ?? "") >= from);
  if (to) filtered = filtered.filter((r) => (r.roster_shifts?.shift_date ?? "9999") <= to);

  const perStatus = new Map<string, number>();
  for (const r of filtered) perStatus.set(r.status, (perStatus.get(r.status) ?? 0) + 1);

  const list = filtered.slice(0, 25).map((r) => ({
    id: r.id,
    status: r.status,
    shift_date: r.roster_shifts?.shift_date ?? null,
    standort: r.roster_shifts?.locations?.name ?? "?",
    bereich: r.roster_shifts?.area ?? null,
    anfragender: r.req?.display_name ?? r.requester_staff_id,
    peer: r.peer?.display_name ?? null,
    erstellt: r.created_at,
  }));

  return pseudonymizeDeep(
    {
      filter: { status, from, to },
      gesamt: filtered.length,
      per_status: [...perStatus.entries()].map(([s, n]) => ({ status: s, anzahl: n })),
      anfragen: list,
      hinweis: "Max. 25 Einträge, nach Erstelldatum absteigend.",
    },
    ctx.pseudonym,
  );
}

async function urlaubAntraege(ctx: ToolContext, input: Record<string, unknown>) {
  const status = typeof input.status === "string" ? input.status : "offen";
  const from = typeof input.from === "string" && ISO_DATE.test(input.from) ? input.from : null;
  const to = typeof input.to === "string" && ISO_DATE.test(input.to) ? input.to : null;

  let q = ctx.admin
    .from("leave_requests")
    .select("id, status, start_date, end_date, staff_id, reason, staff(display_name)")
    .eq("organization_id", ctx.organizationId)
    .order("start_date", { ascending: true });
  if (status !== "any") q = q.eq("status", status);
  const { data, error } = await q.returns<
    {
      id: string;
      status: string;
      start_date: string;
      end_date: string;
      staff_id: string;
      reason: string | null;
      staff: { display_name: string } | null;
    }[]
  >();
  if (error) throw new Error(error.message);

  let filtered = data ?? [];
  if (from) filtered = filtered.filter((r) => r.end_date >= from);
  if (to) filtered = filtered.filter((r) => r.start_date <= to);

  const perStatus = new Map<string, number>();
  for (const r of filtered) perStatus.set(r.status, (perStatus.get(r.status) ?? 0) + 1);

  const list = filtered.slice(0, 50).map((r) => ({
    id: r.id,
    status: r.status,
    von: r.start_date,
    bis: r.end_date,
    mitarbeiter: r.staff?.display_name ?? r.staff_id,
    grund: r.reason ?? null,
  }));

  return pseudonymizeDeep(
    {
      filter: { status, from, to },
      gesamt: filtered.length,
      per_status: [...perStatus.entries()].map(([s, n]) => ({ status: s, anzahl: n })),
      antraege: list,
    },
    ctx.pseudonym,
  );
}

// ─────────────────────────────────────────────────────────── personal_bestand

async function personalBestand(ctx: ToolContext, input: Record<string, unknown>) {
  const includeInactive = input.include_inactive === true;

  // Standorte für Namensauflösung
  const { data: locs, error: locErr } = await ctx.admin
    .from("locations")
    .select("id, name")
    .eq("organization_id", ctx.organizationId);
  if (locErr) throw new Error(locErr.message);
  const locName = new Map((locs ?? []).map((l) => [l.id, l.name]));

  // Staff
  const staff = await selectAllPaged<{ id: string; is_active: boolean }>((from, to) =>
    ctx.admin
      .from("staff")
      .select("id, is_active")
      .eq("organization_id", ctx.organizationId)
      .range(from, to),
  );
  const aktive = staff.filter((s) => s.is_active);
  const inaktive = staff.filter((s) => !s.is_active);
  const scopeIds = new Set((includeInactive ? staff : aktive).map((s) => s.id));

  // Rollen
  const roles = await selectAllPaged<{ staff_id: string; role: string }>((from, to) =>
    ctx.admin
      .from("role_assignments")
      .select("staff_id, role")
      .eq("organization_id", ctx.organizationId)
      .range(from, to),
  );
  const perRolle = new Map<string, number>();
  const rolesByStaff = new Map<string, Set<string>>();
  for (const r of roles) {
    if (!scopeIds.has(r.staff_id)) continue;
    const set = rolesByStaff.get(r.staff_id) ?? new Set<string>();
    set.add(r.role);
    rolesByStaff.set(r.staff_id, set);
  }
  for (const set of rolesByStaff.values()) {
    for (const role of set) perRolle.set(role, (perRolle.get(role) ?? 0) + 1);
  }

  // Standort- und Abteilungszuordnungen
  const sl = await selectAllPaged<{
    staff_id: string;
    location_id: string;
    department: string | null;
  }>((from, to) =>
    ctx.admin
      .from("staff_locations")
      .select("staff_id, location_id, department")
      .eq("organization_id", ctx.organizationId)
      .range(from, to),
  );
  const perStandort = new Map<string, Set<string>>();
  const perAbteilung = new Map<string, Set<string>>();
  for (const row of sl) {
    if (!scopeIds.has(row.staff_id)) continue;
    const locSet = perStandort.get(row.location_id) ?? new Set<string>();
    locSet.add(row.staff_id);
    perStandort.set(row.location_id, locSet);
    if (row.department) {
      const dSet = perAbteilung.get(row.department) ?? new Set<string>();
      dSet.add(row.staff_id);
      perAbteilung.set(row.department, dSet);
    }
  }

  return {
    hinweis:
      "Aggregierte Zählungen ohne Personendaten. Ein Mitarbeiter kann mehreren Standorten/Abteilungen/Rollen zugeordnet sein — die Summen sind daher nicht additiv.",
    gesamt_aktiv: aktive.length,
    gesamt_inaktiv: inaktive.length,
    gezaehlt: scopeIds.size,
    per_standort: [...perStandort.entries()]
      .map(([id, s]) => ({
        standort: locName.get(id) ?? id,
        anzahl: s.size,
      }))
      .sort((a, b) => b.anzahl - a.anzahl),
    per_rolle: [...perRolle.entries()]
      .map(([role, n]) => ({ rolle: role, anzahl: n }))
      .sort((a, b) => b.anzahl - a.anzahl),
    per_abteilung: [...perAbteilung.entries()]
      .map(([d, s]) => ({ abteilung: d, anzahl: s.size }))
      .sort((a, b) => b.anzahl - a.anzahl),
  };
}

// ─────────────────────────────────────────────────────── trinkgeld_aggregat
//
// Pool-Summen (Service/Küche) je Zeitraum, wahlweise ein Standort oder
// über alle Standorte der Organisation. Delegiert an
// computeSessionTipPoolCore + aggregateTips — keine Zweit-Implementierung.
// Datenschutz-Kanon: KEINE Personenanteile (auch nicht pseudonymisiert),
// weil einzelne shares eindeutig einer Person zuordenbar sind.

export type TrinkgeldAggregat = {
  range: { from: string; to: string };
  location_id: string | null;
  serviceCents: number;
  kitchenCents: number;
  totalCents: number;
  daysWithData: number;
  per_standort: {
    location_id: string;
    name: string;
    serviceCents: number;
    kitchenCents: number;
    totalCents: number;
  }[];
  hinweis: string;
};

async function trinkgeldAggregat(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<TrinkgeldAggregat> {
  const { from, to } = requireRange(input.from, input.to);
  const locationId = optionalUuid(input.location_id, "location_id");

  // Standorte für Namen und ggf. Auflistung.
  const { data: locs, error: locErr } = await ctx.admin
    .from("locations")
    .select("id, name")
    .eq("organization_id", ctx.organizationId);
  if (locErr) throw new Error(locErr.message);
  const locationName = new Map((locs ?? []).map((l) => [l.id as string, l.name as string]));

  let sq = ctx.admin
    .from("sessions")
    .select("id, business_date, status, locked_at, location_id, tip_pool_settlement_only")
    .eq("organization_id", ctx.organizationId)
    .gte("business_date", from)
    .lte("business_date", to);
  if (locationId) sq = sq.eq("location_id", locationId);
  const { data: sess, error } = await sq;
  if (error) throw new Error(error.message);

  // Settings je Standort cachen — analog getTipStats.
  const settingsCache = new Map<string, TipSettings>();
  async function settingsFor(locId: string): Promise<TipSettings> {
    const hit = settingsCache.get(locId);
    if (hit) return hit;
    const s = await loadTipSettings(ctx.organizationId, locId);
    settingsCache.set(locId, s);
    return s;
  }

  const perLoc = new Map<
    string,
    { serviceCents: number; kitchenCents: number; results: SessionTipResult[] }
  >();
  const allResults: SessionTipResult[] = [];

  for (const s of (sess ?? []) as LoadedSession[]) {
    const res = await computeSessionTipPoolCore(ctx.caller, s, await settingsFor(s.location_id));
    let svcShares = 0;
    let kitShares = 0;
    for (const sh of res.shares) {
      if (sh.department === "service") svcShares += sh.shareCents;
      else kitShares += sh.shareCents;
    }
    const svcTotal = res.serviceRemainder + svcShares;
    const kitTotal = res.kitchenRemainder + kitShares;
    const bucket = perLoc.get(s.location_id) ?? {
      serviceCents: 0,
      kitchenCents: 0,
      results: [] as SessionTipResult[],
    };
    bucket.serviceCents += svcTotal;
    bucket.kitchenCents += kitTotal;
    const shape: SessionTipResult = {
      businessDate: s.business_date as string,
      serviceRemainderCents: res.serviceRemainder,
      kitchenRemainderCents: res.kitchenRemainder,
      shares: res.shares.map((sh) => ({
        staffId: sh.staffId,
        department: sh.department,
        shareCents: sh.shareCents,
      })),
    };
    bucket.results.push(shape);
    perLoc.set(s.location_id, bucket);
    allResults.push(shape);
  }

  const agg = aggregateTips(allResults, {});
  const daysWithData = agg.daily.filter((d) => d.serviceCents + d.kitchenCents > 0).length;

  return {
    range: { from, to },
    location_id: locationId ?? null,
    serviceCents: agg.totals.serviceCents,
    kitchenCents: agg.totals.kitchenCents,
    totalCents: agg.totals.totalCents,
    daysWithData,
    per_standort: locationId
      ? []
      : [...perLoc.entries()]
          .map(([id, v]) => ({
            location_id: id,
            name: locationName.get(id) ?? id,
            serviceCents: v.serviceCents,
            kitchenCents: v.kitchenCents,
            totalCents: v.serviceCents + v.kitchenCents,
          }))
          .sort((a, b) => b.totalCents - a.totalCents),
    hinweis: "Nur Aggregatsummen — Einzelanteile werden aus Datenschutzgründen nicht ausgeliefert.",
  };
}
