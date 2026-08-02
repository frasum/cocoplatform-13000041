// TRMNL2 — Extraktion der Payload-Aufbereitung aus
// src/routes/api/public/display.$locationId.ts. Kein Verhaltens-Unterschied
// gegenüber dem Original; die Display-Route ruft dieses Modul mit days=31
// auf. Die neue TRMNL-Dienstplan-Route nutzt es mit days=14 und
// area-Filter "service". Reine Datenaufbereitung — kein HTTP.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { businessDateOf } from "@/lib/business-date";
import { todayIso } from "@/lib/format";
import { resolveCellKind } from "@/lib/display/cell";
import { currentPeriodEnd, nextPeriodEnd, periodLabel } from "@/lib/display/period-split";
import { computeCrossBookingFlags, type ShiftForFlag } from "@/lib/roster/cross-booking";
import {
  loadRosterShiftsRaw,
  loadRosterAbsencesRaw,
  loadSkillsByIds,
} from "@/lib/display/roster-window.server";
import {
  remindersForBusinessDate,
  type Reminder,
  type ReminderColor,
} from "@/lib/display/reminders";

type Admin = SupabaseClient<Database>;

export type DisplayCell = {
  k: "shift" | "urlaub" | "krank" | "wish" | "available" | "empty";
  skill: string | null;
  color: string | null;
};
export type DisplayRow = {
  staffId: string;
  staffName: string;
  cells: DisplayCell[];
  shiftCountCurrent: number;
  shiftCountNext: number;
  // DP1 — Datumsliste (ISO, im Fenster), an denen der MA an einem anderen
  // Standort ODER in einem anderen Bereich desselben Standorts eingeteilt
  // ist. Bewusst minimal: KEINE Detailinfos (Ziel-Standort/Bereich/Skill)
  // — Display ist halböffentlich.
  crossBookingDates: string[];
};
export type DisplayBlock = {
  area: "kitchen" | "service";
  title: string;
  rows: DisplayRow[];
  dayCounts: number[];
};
export type DisplayPeriodBlocks = {
  period: "frueh" | "mittag" | "abend";
  blocks: DisplayBlock[];
};
export type DisplayReminder = {
  id: string;
  title: string;
  emoji: string | null;
  color: ReminderColor;
  weekday: number;
  intervalWeeks: 1 | 2;
  anchorDate: string | null;
  fromTime: string;
  untilTime: string;
  sortOrder: number;
};

export type DisplayData = {
  location: { id: string; name: string };
  generatedAt: string;
  enabledPeriods: Array<"frueh" | "mittag" | "abend">;
  windowStart: string;
  windowEnd: string;
  days: string[];
  blocks: DisplayBlock[];
  periodBlocks: DisplayPeriodBlocks[] | null;
  birthdays: string[];
  currentPeriodLabel: string;
  nextPeriodLabel: string;
  currentPeriodEnd: string;
  nextPeriodEnd: string;
  reminders: DisplayReminder[];
};

export type BuildResult =
  | { ok: true; data: DisplayData }
  | { ok: false; status: 404 | 500; message: string };

// N18a (13.07.): Berlin-„Heute" zentral aus `@/lib/format` — die alte
// UTC-Variante rechnete zwischen 00:00 und 02:00 Ortszeit bereits den
// nächsten Tag und ließ das Display eine Zeile zu früh weiterrutschen.
function rollingDays(startIso: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(startIso + "T00:00:00Z");
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function buildDisplayData(
  supabaseAdmin: Admin,
  opts: {
    organizationId: string;
    locationId: string;
    days: number;
    /** Optionaler Bereichsfilter (kitchen/service). null/undefined = alle. */
    showAreas?: string[] | null;
  },
): Promise<BuildResult> {
  const { organizationId, locationId, days: daysCount, showAreas } = opts;

  const { data: location, error: locErr } = await supabaseAdmin
    // ST1: bewusst ungefiltert — Daten-Zugriff (Display-API by id).
    .from("locations")
    .select("id, name, enabled_service_periods")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (locErr || !location) return { ok: false, status: 404, message: "Filiale nicht gefunden." };

  const PERIOD_ORDER = ["frueh", "mittag", "abend"] as const;
  const rawEnabled = (location as { enabled_service_periods?: string[] | null })
    .enabled_service_periods ?? ["abend"];
  const enabledPeriods = PERIOD_ORDER.filter((p) => rawEnabled.includes(p)) as Array<
    "frueh" | "mittag" | "abend"
  >;
  const enabledPeriodsSafe: Array<"frueh" | "mittag" | "abend"> =
    enabledPeriods.length > 0 ? enabledPeriods : ["abend"];
  const multiPeriod = enabledPeriodsSafe.length > 1;

  const today = todayIso();
  const businessDate = businessDateOf(new Date());
  const days = rollingDays(today, daysCount);
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  const curEnd = currentPeriodEnd(today);
  const nxtEnd = nextPeriodEnd(curEnd);
  const curLabel = periodLabel(curEnd);
  const nxtLabel = periodLabel(nxtEnd);
  const curEndY = Number(curEnd.slice(0, 4));
  const curEndM = Number(curEnd.slice(5, 7));
  const curStartY = curEndM === 1 ? curEndY - 1 : curEndY;
  const curStartM = curEndM === 1 ? 12 : curEndM - 1;
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));
  const curStart = `${curStartY}-${pad2(curStartM)}-26`;
  const countStart = curStart < windowStart ? curStart : windowStart;
  const countEnd = nxtEnd > windowEnd ? nxtEnd : windowEnd;

  // Reminders — Client entscheidet über Fälligkeit anhand fromTime.
  const { data: reminderRows } = await supabaseAdmin
    .from("display_reminders")
    .select(
      "id, title, emoji, color, weekday, interval_weeks, anchor_date, from_time, until_time, sort_order",
    )
    .eq("organization_id", organizationId)
    .eq("location_id", locationId)
    .eq("is_active", true);
  const reminderList: Reminder[] = (
    (reminderRows ?? []) as Array<{
      id: string;
      title: string;
      emoji: string | null;
      color: string;
      weekday: number;
      interval_weeks: number;
      anchor_date: string | null;
      from_time: string;
      until_time: string;
      sort_order: number;
    }>
  ).map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    color: r.color as ReminderColor,
    weekday: r.weekday,
    intervalWeeks: (r.interval_weeks === 2 ? 2 : 1) as 1 | 2,
    anchorDate: r.anchor_date,
    fromTime: (r.from_time ?? "").slice(0, 5),
    untilTime: (r.until_time ?? "01:00").slice(0, 5),
    sortOrder: r.sort_order,
  }));
  const todaysReminders: DisplayReminder[] = remindersForBusinessDate(
    reminderList,
    businessDate,
  ).map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    color: r.color,
    weekday: r.weekday,
    intervalWeeks: r.intervalWeeks,
    anchorDate: r.anchorDate,
    fromTime: r.fromTime,
    untilTime: r.untilTime,
    sortOrder: r.sortOrder,
  }));

  // Geburtstage.
  const todayMmDd = today.slice(5);
  const birthdays: string[] = [];
  const { data: locRows } = await supabaseAdmin
    .from("staff_locations")
    .select("staff_id")
    .eq("location_id", locationId)
    .eq("organization_id", organizationId);
  const teamIds = Array.from(
    new Set((locRows ?? []).map((r) => (r as { staff_id: string }).staff_id)),
  );
  if (teamIds.length) {
    const { data: teamRows } = await supabaseAdmin
      .from("staff")
      .select("id, first_name, last_name, display_name")
      .in("id", teamIds)
      .eq("is_active", true);
    const activeIds = (teamRows ?? []).map((r) => (r as { id: string }).id);
    if (activeIds.length) {
      const { data: dobRows } = await supabaseAdmin
        .from("staff_personal_details")
        .select("staff_id, date_of_birth")
        .in("staff_id", activeIds);
      const dobMap = new Map<string, string>();
      for (const d of dobRows ?? []) {
        const r = d as { staff_id: string; date_of_birth: string | null };
        if (r.date_of_birth) dobMap.set(r.staff_id, String(r.date_of_birth).slice(5, 10));
      }
      for (const t of teamRows ?? []) {
        const r = t as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          display_name: string | null;
        };
        if (dobMap.get(r.id) === todayMmDd) {
          const name = r.display_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
          if (name) birthdays.push(name);
        }
      }
    }
  }

  // Zeilenbasis.
  const { data: payrollRows, error: payrollErr } = await supabaseAdmin
    .from("role_assignments")
    .select("staff_id")
    .eq("organization_id", organizationId)
    .eq("role", "payroll");
  if (payrollErr) return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };
  const payrollIds = new Set((payrollRows ?? []).map((r) => r.staff_id as string));

  const { data: slRows, error: slErr } = await supabaseAdmin
    .from("staff_locations")
    // RS1 — roster_plannable mitlesen: nicht planbare Kräfte erscheinen nicht
    // auf Restaurant-Display / TRMNL-Feeds.
    .select("staff_id, department, staff(id, display_name, is_active, roster_plannable)")
    .eq("organization_id", organizationId)
    .eq("location_id", locationId);
  if (slErr) return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };

  type RowEntry = {
    staffId: string;
    staffName: string;
    area: "kitchen" | "service";
  };
  const rowEntries: RowEntry[] = [];
  const rowSeen = new Set<string>();
  for (const r of slRows ?? []) {
    const staffId = r.staff_id as string;
    if (payrollIds.has(staffId)) continue;
    const st = r.staff as {
      display_name: string | null;
      is_active: boolean;
      roster_plannable: boolean | null;
    } | null;
    if (!isPlannable({ isActive: st?.is_active, rosterPlannable: st?.roster_plannable })) continue;
    const dept = r.department as "kitchen" | "service" | "gl" | null;
    const area: "kitchen" | "service" = dept === "kitchen" ? "kitchen" : "service";
    const key = `${staffId}|${area}`;
    if (rowSeen.has(key)) continue;
    rowSeen.add(key);
    rowEntries.push({
      staffId,
      staffName: st?.display_name ?? "—",
      area,
    });
  }
  rowEntries.sort((a, b) => a.staffName.localeCompare(b.staffName, "de"));

  const rowStaffIds = Array.from(new Set(rowEntries.map((r) => r.staffId)));
  const idSafe = rowStaffIds.length ? rowStaffIds : ["00000000-0000-0000-0000-000000000000"];

  const shiftLoad = await loadRosterShiftsRaw(supabaseAdmin, {
    organizationId,
    locationIds: [locationId],
    from: countStart,
    to: countEnd,
  });
  if (!shiftLoad.ok)
    return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };
  const shiftRows = shiftLoad.rows;

  const shiftMap = new Map<string, string | null>();
  const skillIdSet = new Set<string>();
  const periodCounts = new Map<string, { cur: number; next: number }>();
  const periodSeen = new Set<string>();
  for (const sh of shiftRows) {
    const staffId = sh.staff_id as string;
    const date = sh.shift_date as string;
    const rawArea = sh.area as string;
    const blockArea: "kitchen" | "service" = rawArea === "kitchen" ? "kitchen" : "service";
    const skillId = (sh.skill_id as string | null) ?? null;
    const rawPeriod = (sh.service_period as string | null) ?? "abend";
    const period = (
      PERIOD_ORDER.includes(rawPeriod as (typeof PERIOD_ORDER)[number]) ? rawPeriod : "abend"
    ) as "frueh" | "mittag" | "abend";
    if (date >= windowStart && date <= windowEnd) {
      const keys = multiPeriod
        ? [`${staffId}|${date}|${blockArea}|${period}`]
        : [`${staffId}|${date}|${blockArea}`];
      for (const key of keys) {
        const existing = shiftMap.get(key);
        if (existing === undefined || (existing === null && skillId !== null)) {
          shiftMap.set(key, skillId);
        }
      }
      if (skillId) skillIdSet.add(skillId);
    }
    if (date >= curStart && date <= nxtEnd) {
      const dedupKey = `${staffId}|${date}|${blockArea}|${period}`;
      if (!periodSeen.has(dedupKey)) {
        periodSeen.add(dedupKey);
        const cntKey = `${staffId}|${blockArea}`;
        const bucket = periodCounts.get(cntKey) ?? { cur: 0, next: 0 };
        if (date <= curEnd) bucket.cur += 1;
        else bucket.next += 1;
        periodCounts.set(cntKey, bucket);
      }
    }
  }

  // DP1 — Cross-Booking-Flags: org-weit Schichten dieser MA im
  // Anzeigefenster laden und je Bereich (kitchen/service) einen
  // Flag-Set berechnen. Nur boolesch, keine Detailinfos.
  const orgShiftLoad = await loadRosterShiftsRaw(supabaseAdmin, {
    organizationId,
    staffIds: idSafe,
    from: windowStart,
    to: windowEnd,
  });
  if (!orgShiftLoad.ok)
    return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };
  const orgShifts: ShiftForFlag[] = orgShiftLoad.rows.map((r) => ({
    staffId: r.staff_id as string,
    shiftDate: r.shift_date as string,
    locationId: r.location_id as string,
    area: r.area as "kitchen" | "service" | "gl",
  }));
  const crossFlagsByArea: Record<"kitchen" | "service", Set<string>> = {
    kitchen: computeCrossBookingFlags(orgShifts, { locationId, area: "kitchen" }),
    service: computeCrossBookingFlags(orgShifts, { locationId, area: "service" }),
  };

  const skillIds = Array.from(skillIdSet);
  const skillLoad = await loadSkillsByIds(supabaseAdmin, skillIds);
  if (!skillLoad.ok)
    return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };
  const skillMap = skillLoad.byId;

  const [absLoad, wishRes, availRes] = await Promise.all([
    loadRosterAbsencesRaw(supabaseAdmin, {
      organizationId,
      staffIds: idSafe,
      from: windowStart,
      to: windowEnd,
    }),
    supabaseAdmin
      .from("day_off_wishes")
      .select("staff_id, wish_date")
      .eq("organization_id", organizationId)
      .in("staff_id", idSafe)
      .gte("wish_date", windowStart)
      .lte("wish_date", windowEnd),
    supabaseAdmin
      .from("roster_availability")
      .select("staff_id, date")
      .eq("organization_id", organizationId)
      .in("staff_id", idSafe)
      .gte("date", windowStart)
      .lte("date", windowEnd),
  ]);
  if (!absLoad.ok || wishRes.error || availRes.error) {
    return { ok: false, status: 500, message: "Daten konnten nicht geladen werden." };
  }
  const absenceMap = new Map<string, "urlaub" | "krank">();
  for (const a of absLoad.rows) {
    absenceMap.set(`${a.staff_id}|${a.date}`, a.type);
  }
  const wishSet = new Set<string>(
    (wishRes.data ?? []).map((w) => `${w.staff_id as string}|${w.wish_date as string}`),
  );
  const availSet = new Set<string>(
    (availRes.data ?? []).map((a) => `${a.staff_id as string}|${a.date as string}`),
  );

  const wantedAreas = showAreas ?? null;
  const areaOrder: Array<{ area: "kitchen" | "service"; title: string }> = [
    { area: "kitchen", title: "Küche" },
    { area: "service", title: "Service" },
  ];
  function buildBlocks(period: "frueh" | "mittag" | "abend" | null): DisplayBlock[] {
    const out: DisplayBlock[] = [];
    for (const { area, title } of areaOrder) {
      if (wantedAreas && !wantedAreas.includes(area)) continue;
      const blockRows = rowEntries.filter((r) => r.area === area);
      const dayCounts = new Array<number>(days.length).fill(0);
      const rows: DisplayRow[] = blockRows.map((entry) => {
        const cells: DisplayCell[] = days.map((date, i) => {
          const shiftKey = period
            ? `${entry.staffId}|${date}|${area}|${period}`
            : `${entry.staffId}|${date}|${area}`;
          const hasShift = shiftMap.has(shiftKey);
          const overlayKey = `${entry.staffId}|${date}`;
          const absenceType = absenceMap.get(overlayKey) ?? null;
          const hasWish = wishSet.has(overlayKey);
          const hasAvailability = availSet.has(overlayKey);
          const k = resolveCellKind({ hasShift, absenceType, hasWish, hasAvailability });
          let skill: string | null = null;
          let color: string | null = null;
          if (k === "shift") {
            const sid = shiftMap.get(shiftKey) ?? null;
            const meta = sid ? (skillMap.get(sid) ?? null) : null;
            skill = meta?.name ?? null;
            color = meta?.color ?? null;
            dayCounts[i] += 1;
          }
          return { k, skill, color };
        });
        const pc = periodCounts.get(`${entry.staffId}|${area}`) ?? { cur: 0, next: 0 };
        const flagSet = crossFlagsByArea[area];
        const crossBookingDates = days.filter((d) => flagSet.has(`${entry.staffId}|${d}`));
        return {
          staffId: entry.staffId,
          staffName: entry.staffName,
          cells,
          shiftCountCurrent: pc.cur,
          shiftCountNext: pc.next,
          crossBookingDates,
        };
      });
      out.push({ area, title, rows, dayCounts });
    }
    return out;
  }
  const blocks: DisplayBlock[] = multiPeriod ? [] : buildBlocks(null);
  const periodBlocks: DisplayPeriodBlocks[] | null = multiPeriod
    ? enabledPeriodsSafe.map((p) => ({ period: p, blocks: buildBlocks(p) }))
    : null;

  return {
    ok: true,
    data: {
      location: { id: location.id, name: location.name },
      generatedAt: new Date().toISOString(),
      enabledPeriods: enabledPeriodsSafe,
      windowStart,
      windowEnd,
      days,
      blocks,
      periodBlocks,
      birthdays,
      currentPeriodLabel: curLabel,
      nextPeriodLabel: nxtLabel,
      currentPeriodEnd: curEnd,
      nextPeriodEnd: nxtEnd,
      reminders: todaysReminders,
    },
  };
}
