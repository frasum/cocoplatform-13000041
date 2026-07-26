// B6 — Arbeitszeitübersicht (Zusammenfassung + Buchhaltung), 1:1 nach tagesabrechnung.

import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TabButton } from "@/components/ui/nav-tab";
import { Button } from "@/components/ui/button";
import { todayIso } from "@/lib/format";
import { ZeitSkeleton } from "@/components/ui/page-skeletons";
import { useAuth } from "@/hooks/use-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listLocations } from "@/lib/admin/locations.functions";
import { listStaff } from "@/lib/admin/staff.functions";
import { LocationPills } from "@/components/shared/LocationPills";
import {
  createPeriod,
  createTimeEntryShift,
  deletePeriod,
  deleteTimeEntry,
  getTimeOverview,
  getWeeklyTimeEntries,
  getSfnOverview,
  getTimeOverviewBatch,
  getWeeklyTimeEntriesBatch,
  getSfnOverviewBatch,
  listPayrollNotesBatch,
  listPeriods,
  listPayrollNotes,
  listAdvancesByStaff,
  listAbsencesByStaff,
  setTimeEntryShift,
  togglePeriodLock,
  upsertPayrollNote,
  listRecurringNotes,
  createRecurringNote,
  cancelRecurringNote,
} from "@/lib/time/time-admin.functions";
import { computeShiftHours, isSundayOrHoliday } from "@/lib/time/shift-hours";
import {
  buildFileBaseName,
  buildWeeklyPdf,
  buildWeeklyXlsx,
  blobToExportFormPayload,
  probeExportEndpoint,
  probeExportEndpointAsForm,
  submitExportForm,
  type ExportProbeResult,
  type WeeklyExportInput,
  type WeeklyExportRow,
} from "@/lib/time/weekly-export";
import {
  buildBuchhaltungPdf,
  buildBuchhaltungXlsx,
  buildBuchhaltungCsv,
  buildBuchhaltungFileBase,
  type BuchhaltungExportInput,
  type BuchhaltungExportRow,
  type BuchhaltungMode,
} from "@/lib/time/buchhaltung-export";
import { Download, FileDown, FileSpreadsheet, Search } from "lucide-react";
import { ProvisionTab } from "@/components/lohn/ProvisionTab";
import { LohnrechnerPanel } from "@/components/lohn/LohnrechnerPanel";
import { BatchTimesCard } from "@/components/zeit/BatchTimesCard";
import { entryRowDepartment } from "@/lib/time/primary-department";
import { filterWeeklyRows } from "@/lib/time/weekly-filter";
import { PillSelect } from "@/components/ui/pill-select";
import {
  type Department,
  type Entry,
  type WeeklyData,
  type WeeklyEntry,
  addDays,
  buildShiftIsosOrThrow,
  buildWeekColumns,
  ddmm,
  dayHeader,
  DEPT_BG,
  DEPT_HEADER_LABEL,
  DEPT_LABEL,
  DEPT_ORDER,
  firstOfMonthIso,
  fmtDDMM,
  fmtHHMM,
  fmtHm,
  fmtIso,
  floorToQuarterHours,
  isoWeek,
  aggregateHoursByStaffAndDept,
  mondayOf,
  parseIsoDate,
} from "@/lib/time/zeit-uebersicht-core";
import { primaryDepartment } from "@/lib/time/primary-department";
import { PayrollTab } from "@/components/zeit/PayrollTab";
import { activeNotesForPeriod, type RecurringNote } from "@/lib/time/recurring-notes";
import { WeeklyPlan } from "@/components/zeit/WeeklyPlan";
import { PeriodsPanel } from "@/components/zeit/PeriodsPanel";

export const Route = createFileRoute("/_authenticated/admin/zeit-uebersicht")({
  head: () => ({ meta: [{ title: "Arbeitszeiten" }] }),
  component: ZeitUebersichtPage,
});

function ZeitUebersichtPage() {
  const qc = useQueryClient();
  const { identity } = useAuth();
  const isAdmin = identity?.role === "admin";
  const isPayroll = identity?.role === "payroll";
  const isPlaner = identity?.role === "planer";
  const canOpenStaff = isAdmin || isPayroll;
  const currentHref = useRouterState({ select: (s) => s.location.href });
  const fetchLocations = useServerFn(listLocations);
  const fetchStaffAll = useServerFn(listStaff);
  const fetchOverview = useServerFn(getTimeOverview);
  const fetchWeekly = useServerFn(getWeeklyTimeEntries);
  const fetchNotes = useServerFn(listPayrollNotes);
  const fetchAdvances = useServerFn(listAdvancesByStaff);
  const fetchAbsences = useServerFn(listAbsencesByStaff);
  const fetchSfn = useServerFn(getSfnOverview);
  const fetchOverviewBatch = useServerFn(getTimeOverviewBatch);
  const fetchWeeklyBatch = useServerFn(getWeeklyTimeEntriesBatch);
  const fetchNotesBatch = useServerFn(listPayrollNotesBatch);
  const fetchSfnBatch = useServerFn(getSfnOverviewBatch);
  const callUpsert = useServerFn(upsertPayrollNote);
  const callSetShift = useServerFn(setTimeEntryShift);
  const callCreateShift = useServerFn(createTimeEntryShift);
  const callDeleteEntry = useServerFn(deleteTimeEntry);
  const fetchPeriods = useServerFn(listPeriods);
  const callCreatePeriod = useServerFn(createPeriod);
  const callToggleLock = useServerFn(togglePeriodLock);
  const callDeletePeriod = useServerFn(deletePeriod);
  const fetchRecurring = useServerFn(listRecurringNotes);
  const callCreateRecurring = useServerFn(createRecurringNote);
  const callCancelRecurring = useServerFn(cancelRecurringNote);

  const locationsQ = useQuery({
    queryKey: ["admin-locations"],
    queryFn: () => fetchLocations(),
  });
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  // WZ3 — Vollständige aktive Mitarbeiterliste (mit locationDepartments), damit
  // Zusammenfassung + Buchhaltung auch Personen ohne Zeit-Einträge zeigen.
  const staffAllQ = useQuery({
    queryKey: ["admin-staff-all"],
    queryFn: () => fetchStaffAll(),
  });
  // Wochenplan-Location-Filter: konkrete Location-ID oder "all".
  // WZ1: Default "all" für Zusammenfassung/Buchhaltung (org-weite Sicht ohne
  // Standort-blinde Flecken). Wochenplan-Batch trägt "all" ebenfalls.
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const effectiveLocationId =
    locationFilter && locationFilter !== "all" ? locationFilter : (locations[0]?.id ?? "");
  const isAllLocations = locationFilter === "all";

  // Periodenwahl
  const periodsQ = useQuery({
    queryKey: ["periods"],
    queryFn: () => fetchPeriods(),
  });
  const periods = useMemo(() => periodsQ.data ?? [], [periodsQ.data]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const today = todayIso();
  const periodContainingToday = periods.find((p) => p.startDate <= today && p.endDate >= today);
  const effectivePeriodId = selectedPeriodId || periodContainingToday?.id || periods[0]?.id || "";
  const selectedPeriod = periods.find((p) => p.id === effectivePeriodId);

  // Fallback: freie Daten, wenn keine Periode existiert.
  const [manualFrom] = useState<string>(firstOfMonthIso());
  const [manualTo] = useState<string>(todayIso());
  const fromDate = selectedPeriod ? selectedPeriod.startDate : manualFrom;
  const toDate = selectedPeriod ? selectedPeriod.endDate : manualTo;

  // Wochenplan: aktuelle Woche (Periode kommt aus selectedPeriodId).
  const [weekStart, setWeekStart] = useState<string>(() =>
    fmtIso(mondayOf(parseIsoDate(todayIso()))),
  );
  const weekStartDate = useMemo(() => parseIsoDate(weekStart), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i)),
    [weekStartDate],
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Z4 — Wochenplan-Filter (nur Anzeige, nicht Export/Buchhaltung).
  const [deptFilter, setDeptFilter] = useState<Department | "all">("all");
  const skillFilter = "all";
  const [activeTab, setActiveTab] = useState<string>("weekly");
  // Summen-Skope für die rechte Kennzahlen-Spalte im Wochenplan:
  // "week" = aktuelle Woche (Grid-Daten), "period" = Abrechnungsperiode (Overview-Daten).
  const [totalsScope, setTotalsScope] = useState<"week" | "period">("week");
  // Buchhaltung-Tab: §3b-Toggle + eigene Suche.
  const [payrollMode, setPayrollMode] = useState<BuchhaltungMode>("simple");
  const [payrollSearch, setPayrollSearch] = useState<string>("");

  // Wochen-Chips für die gewählte Abrechnungsperiode (Montage vom Periodenstart bis ≤ Periodenende).
  const periodWeeks = useMemo(() => {
    if (!selectedPeriod) return [] as { idx: number; start: string; end: string }[];
    const start = parseIsoDate(selectedPeriod.startDate);
    const end = parseIsoDate(selectedPeriod.endDate);
    const chips: { idx: number; start: string; end: string }[] = [];
    let cursor = mondayOf(start);
    let i = 1;
    while (cursor.getTime() <= end.getTime()) {
      chips.push({ idx: i, start: fmtIso(cursor), end: fmtIso(addDays(cursor, 6)) });
      cursor = addDays(cursor, 7);
      i++;
    }
    return chips;
  }, [selectedPeriod]);

  // Beim Periodenwechsel: weekStart in die Periode snappen (bevorzugt Woche mit "heute").
  useEffect(() => {
    if (!selectedPeriod) return;
    const firstMonday = fmtIso(mondayOf(parseIsoDate(selectedPeriod.startDate)));
    const todayMon = fmtIso(mondayOf(parseIsoDate(todayIso())));
    const todayInPeriod = todayMon >= firstMonday && todayMon <= selectedPeriod.endDate;
    if (weekStart < firstMonday || weekStart > selectedPeriod.endDate) {
      setWeekStart(todayInPeriod ? todayMon : firstMonday);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePeriodId]);

  // Wenn "Alle Standorte" gewählt: ein einziger Batch-Request statt N Fanouts.
  // Der Batch-Endpoint deduped locationIds und liefert Record<id, WeeklyData>.
  // crossLocationDates bleibt im Multi-Modus bewusst leer (Single-Location-Feature).
  const allLocationIds = useMemo(() => locations.map((l) => l.id), [locations]);
  const allLocationsKey = useMemo(() => [...allLocationIds].sort().join(","), [allLocationIds]);
  const weeklyBatchQ = useQuery({
    queryKey: ["weekly-entries", "batch", allLocationsKey, weekStart],
    queryFn: () => fetchWeeklyBatch({ data: { locationIds: allLocationIds, weekStart } }),
    enabled: isAllLocations && allLocationIds.length > 0 && Boolean(weekStart),
  });

  const weeklyQSingle = useQuery({
    queryKey: ["weekly-entries", effectiveLocationId, weekStart],
    queryFn: () => fetchWeekly({ data: { locationId: effectiveLocationId, weekStart } }),
    enabled: Boolean(effectiveLocationId) && !isAllLocations,
  });

  // Zusammengeführte Wochen-Daten.
  const weeklyData = useMemo<WeeklyData | undefined>(() => {
    if (isAllLocations) {
      const merged: WeeklyData = {
        weekStart,
        weekEnd: fmtIso(addDays(weekStartDate, 6)),
        entries: [],
        crossLocationDates: {},
        assignedStaff: [],
        rosterByStaff: {},
        rosterAreaByStaffDate: {},
        rosterGlByStaffDate: {},
      };
      const byLoc = weeklyBatchQ.data?.byLocation ?? {};
      for (const lid of allLocationIds) {
        const d = byLoc[lid] as WeeklyData | undefined;
        if (!d) continue;
        merged.entries.push(...d.entries);
        for (const s of d.assignedStaff ?? []) {
          // Z2: Dedupe pro (Mitarbeiter, Abteilung) — sonst verschwindet die
          // GL-Zeile eines Küchen-Primärmitarbeiters bei "Alle Standorte".
          if (
            !merged.assignedStaff!.some(
              (x) => x.staffId === s.staffId && x.department === s.department,
            )
          ) {
            merged.assignedStaff!.push(s);
          }
        }
        // Z4b — rosterByStaff über alle Standorte mergen (Union je Person
        // über areas/skillIds), damit „Alle Standorte" alle geplanten
        // Bereiche/Skills der Woche berücksichtigt.
        for (const [sid, bucket] of Object.entries(d.rosterByStaff ?? {})) {
          const cur = merged.rosterByStaff![sid] ?? { areas: [], skillIds: [] };
          for (const a of bucket.areas) if (!cur.areas.includes(a)) cur.areas.push(a);
          for (const s of bucket.skillIds) if (!cur.skillIds.includes(s)) cur.skillIds.push(s);
          merged.rosterByStaff![sid] = cur;
        }
        // Z3b — Per-Tag-Roster-Area über Standorte mergen. Konflikt (zwei
        // Standorte, unterschiedliche Area am selben Tag): kitchen>service>gl
        // gewinnt — konsistent mit primaryDepartment.
        for (const [sid, perDay] of Object.entries(d.rosterAreaByStaffDate ?? {})) {
          const cur = merged.rosterAreaByStaffDate![sid] ?? {};
          for (const [iso, area] of Object.entries(perDay)) {
            const existing = cur[iso];
            cur[iso] = existing
              ? existing === area
                ? existing
                : primaryDepartment([existing, area])
              : area;
          }
          merged.rosterAreaByStaffDate![sid] = cur;
        }
        // WZ2 — Per-Tag-GL-Skill-Flag über Standorte mergen (any-of).
        for (const [sid, perDay] of Object.entries(d.rosterGlByStaffDate ?? {})) {
          const cur = merged.rosterGlByStaffDate![sid] ?? {};
          for (const [iso, flag] of Object.entries(perDay)) {
            if (flag) cur[iso] = true;
          }
          merged.rosterGlByStaffDate![sid] = cur;
        }
      }
      return merged;
    }
    return weeklyQSingle.data;
  }, [
    isAllLocations,
    weeklyBatchQ.data,
    weeklyQSingle.data,
    weekStart,
    weekStartDate,
    allLocationIds,
  ]);
  const weeklyLoading = isAllLocations ? weeklyBatchQ.isLoading : weeklyQSingle.isLoading;

  const overviewQ = useQuery({
    queryKey: ["time-overview", effectiveLocationId, fromDate, toDate],
    queryFn: () => fetchOverview({ data: { locationId: effectiveLocationId, fromDate, toDate } }),
    enabled: Boolean(effectiveLocationId) && !isAllLocations,
  });

  // Schichten (Periode) — standortübergreifend: ein Batch-Request über alle Locations.
  // Wird sowohl für shiftsByStaff (immer) als auch für den Overview-Merge im
  // "Alle Standorte"-Modus genutzt.
  const overviewBatchQ = useQuery({
    queryKey: ["time-overview", "batch", allLocationsKey, fromDate, toDate],
    queryFn: () => fetchOverviewBatch({ data: { locationIds: allLocationIds, fromDate, toDate } }),
    enabled: allLocationIds.length > 0 && Boolean(fromDate) && Boolean(toDate),
  });
  const shiftsByStaff = useMemo(() => {
    const days = new Map<string, Set<string>>();
    const byLoc = overviewBatchQ.data?.byLocation ?? {};
    for (const lid of allLocationIds) {
      const entries = (byLoc[lid] as { entries?: Entry[] } | undefined)?.entries ?? [];
      for (const e of entries) {
        let set = days.get(e.staffId);
        if (!set) {
          set = new Set<string>();
          days.set(e.staffId, set);
        }
        set.add(e.businessDate);
      }
    }
    const counts = new Map<string, number>();
    for (const [staffId, set] of days) counts.set(staffId, set.size);
    return counts;
  }, [overviewBatchQ.data, allLocationIds]);

  // Bei "Alle Standorte": Overview aus dem Batch-Request mergen (jeder
  // time_entry hat genau einen Standort → keine Duplikate). Bei Bereichs-
  // Konflikt eines Mitarbeiters gewinnt in staffAggs unten das ERSTE Vorkommen
  // in der festen `locations`-Reihenfolge — die Person erscheint einmal mit der Summe.
  const overviewEntries = useMemo<Entry[]>(() => {
    if (isAllLocations) {
      const out: Entry[] = [];
      const byLoc = overviewBatchQ.data?.byLocation ?? {};
      for (const lid of allLocationIds) {
        const entries = (byLoc[lid] as { entries?: Entry[] } | undefined)?.entries ?? [];
        out.push(...entries);
      }
      return out;
    }
    return overviewQ.data?.entries ?? [];
  }, [isAllLocations, overviewBatchQ.data, allLocationIds, overviewQ.data]);
  const overviewLoading = isAllLocations ? overviewBatchQ.isLoading : overviewQ.isLoading;

  // N-Toggle — Perioden-Summen (Ges/20–24/24–x/SF) je Mitarbeiter für den
  // Wochenplan-Header-Switch. Nutzt dieselbe Schichten-Zerlegung wie der
  // Buchhaltung-Tab (computeShiftHours), aggregiert über die ganze
  // Abrechnungsperiode. Aggregation nach staffId (Zeilen mit gleicher Person
  // und unterschiedlicher Abteilung zeigen dieselbe Perioden-Summe).
  const periodTotalsByStaff = useMemo(() => {
    const m = new Map<string, { total: number; evening: number; night: number; sunHol: number }>();
    for (const e of overviewEntries) {
      if (!e.startedAt || !e.endedAt) continue;
      const h = computeShiftHours(e.startedAt, e.endedAt, e.businessDate);
      const cur = m.get(e.staffId) ?? { total: 0, evening: 0, night: 0, sunHol: 0 };
      cur.total += h.totalHours;
      cur.evening += h.eveningHours;
      cur.night += h.nightHours;
      cur.sunHol += h.sundayHolidayHours;
      m.set(e.staffId, cur);
    }
    return m;
  }, [overviewEntries]);

  const notesQ = useQuery({
    queryKey: ["payroll-notes", effectiveLocationId, fromDate, toDate],
    queryFn: () =>
      fetchNotes({
        data: { locationId: effectiveLocationId, periodStart: fromDate, periodEnd: toDate },
      }),
    enabled: Boolean(effectiveLocationId) && !isAllLocations,
  });
  // Bei "Alle Standorte": Notes in einem Batch-Request laden.
  const notesBatchQ = useQuery({
    queryKey: ["payroll-notes", "batch", allLocationsKey, fromDate, toDate],
    queryFn: () =>
      fetchNotesBatch({
        data: { locationIds: allLocationIds, periodStart: fromDate, periodEnd: toDate },
      }),
    enabled: isAllLocations && allLocationIds.length > 0 && Boolean(fromDate) && Boolean(toDate),
  });

  const advancesQ = useQuery({
    queryKey: ["payroll-advances", fromDate, toDate],
    queryFn: () => fetchAdvances({ data: { periodStart: fromDate, periodEnd: toDate } }),
  });

  const absencesQ = useQuery({
    queryKey: ["payroll-absences", fromDate, toDate],
    queryFn: () => fetchAbsences({ data: { periodStart: fromDate, periodEnd: toDate } }),
  });

  const sfnQ = useQuery({
    queryKey: ["payroll-sfn", effectiveLocationId, fromDate, toDate],
    queryFn: () => fetchSfn({ data: { locationId: effectiveLocationId, fromDate, toDate } }),
    enabled: Boolean(effectiveLocationId) && !isAllLocations,
  });
  // Bei "Alle Standorte": SFN in einem Batch-Request laden.
  const sfnBatchQ = useQuery({
    queryKey: ["payroll-sfn", "batch", allLocationsKey, fromDate, toDate],
    queryFn: () => fetchSfnBatch({ data: { locationIds: allLocationIds, fromDate, toDate } }),
    enabled: isAllLocations && allLocationIds.length > 0 && Boolean(fromDate) && Boolean(toDate),
  });

  const weekCols = useMemo(() => buildWeekColumns(fromDate, toDate), [fromDate, toDate]);

  // Aggregations
  type StaffAgg = {
    staffId: string;
    displayName: string;
    department: Department;
    perWeek: Map<string, number>;
    totalHours: number;
    shiftDates: Set<string>;
  };
  const staffAggs = useMemo(() => {
    const entries: Entry[] = overviewEntries;
    const map = new Map<string, StaffAgg>();
    // WZ3 — Seed: alle aktiven Mitarbeiter aus dem Standort-Filter anlegen,
    // damit Personen ohne time_entries in der Periode trotzdem erscheinen
    // (0:00, keine Notizen). Der Aggregations-Key bleibt `staffId` — kommen
    // Einträge dazu, gewinnt (wie bisher) die Abteilung des ersten Entry.
    for (const s of staffAllQ.data ?? []) {
      if (!s.isActive) continue;
      const deps = isAllLocations
        ? Array.from(new Set(s.locationDepartments.map((ld) => ld.department)))
        : Array.from(
            new Set(
              s.locationDepartments
                .filter((ld) => ld.locationId === effectiveLocationId)
                .map((ld) => ld.department),
            ),
          );
      if (deps.length === 0) continue;
      // Genau eine Zeile pro Mitarbeiter (Key = staffId); als Startabteilung
      // die erste zugeordnete — konsistent mit dem Verhalten heute (Einträge
      // überschreiben nicht, sie erweitern).
      if (!map.has(s.id)) {
        map.set(s.id, {
          staffId: s.id,
          displayName: s.displayName,
          department: deps[0] as Department,
          perWeek: new Map(),
          totalHours: 0,
          shiftDates: new Set(),
        });
      }
    }
    for (const e of entries) {
      let agg = map.get(e.staffId);
      if (!agg) {
        agg = {
          staffId: e.staffId,
          displayName: e.displayName,
          department: e.department,
          perWeek: new Map(),
          totalHours: 0,
          shiftDates: new Set(),
        };
        map.set(e.staffId, agg);
      }
      const wk = isoWeek(parseIsoDate(e.businessDate));
      const wkKey = `${wk.year}-W${String(wk.week).padStart(2, "0")}`;
      agg.perWeek.set(wkKey, (agg.perWeek.get(wkKey) ?? 0) + e.hoursWorked);
      agg.totalHours += e.hoursWorked;
      agg.shiftDates.add(e.businessDate);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "de"),
    );
  }, [overviewEntries, staffAllQ.data, isAllLocations, effectiveLocationId]);

  // LG2 — Perioden-Roster (Union über Standorte) für die Payroll-Stunden-
  // aufteilung nach Schichtart. Quelle: getTimeOverview (single) /
  // getTimeOverviewBatch (all). Dieselben Signale wie im Wochenplan, aber
  // über die ganze Abrechnungsperiode.
  const periodRoster = useMemo(() => {
    const staffDeptsByStaff = new Map<string, Department[]>();
    const rosterAreaByStaffDate: Record<string, Record<string, Department>> = {};
    const rosterGlByStaffDate: Record<string, Record<string, boolean>> = {};

    const mergeAssigned = (
      assigned: ReadonlyArray<{ staffId: string; staffDepts: Department[] }> | undefined,
    ) => {
      for (const a of assigned ?? []) {
        const cur = staffDeptsByStaff.get(a.staffId) ?? [];
        for (const d of a.staffDepts) if (!cur.includes(d)) cur.push(d);
        staffDeptsByStaff.set(a.staffId, cur);
      }
    };
    const mergeAreas = (
      src: Record<string, Record<string, Department>> | undefined,
    ) => {
      for (const [sid, perDay] of Object.entries(src ?? {})) {
        const cur = rosterAreaByStaffDate[sid] ?? {};
        for (const [iso, area] of Object.entries(perDay)) {
          const existing = cur[iso];
          cur[iso] = existing ? primaryDepartment([existing, area]) : area;
        }
        rosterAreaByStaffDate[sid] = cur;
      }
    };
    const mergeGl = (src: Record<string, Record<string, boolean>> | undefined) => {
      for (const [sid, perDay] of Object.entries(src ?? {})) {
        const cur = rosterGlByStaffDate[sid] ?? {};
        for (const [iso, flag] of Object.entries(perDay)) {
          if (flag) cur[iso] = true;
        }
        rosterGlByStaffDate[sid] = cur;
      }
    };

    if (isAllLocations) {
      const byLoc = (overviewBatchQ.data?.byLocation ?? {}) as Record<
        string,
        {
          assignedStaff?: Array<{ staffId: string; staffDepts: Department[] }>;
          rosterAreaByStaffDate?: Record<string, Record<string, Department>>;
          rosterGlByStaffDate?: Record<string, Record<string, boolean>>;
        }
      >;
      for (const lid of allLocationIds) {
        const d = byLoc[lid];
        if (!d) continue;
        mergeAssigned(d.assignedStaff);
        mergeAreas(d.rosterAreaByStaffDate);
        mergeGl(d.rosterGlByStaffDate);
      }
    } else {
      const d = overviewQ.data as
        | {
            assignedStaff?: Array<{ staffId: string; staffDepts: Department[] }>;
            rosterAreaByStaffDate?: Record<string, Record<string, Department>>;
            rosterGlByStaffDate?: Record<string, Record<string, boolean>>;
          }
        | undefined;
      mergeAssigned(d?.assignedStaff);
      mergeAreas(d?.rosterAreaByStaffDate);
      mergeGl(d?.rosterGlByStaffDate);
    }

    return { staffDeptsByStaff, rosterAreaByStaffDate, rosterGlByStaffDate };
  }, [isAllLocations, overviewBatchQ.data, overviewQ.data, allLocationIds]);

  // LG2 — Stundenaufteilung nach Schichtart je Mitarbeiter über die
  // Abrechnungsperiode (Wochenplan-Attribution, Union über alle Standorte).
  const hoursByStaffAndDept = useMemo(
    () =>
      aggregateHoursByStaffAndDept({
        entries: overviewEntries,
        staffDeptsByStaff: periodRoster.staffDeptsByStaff,
        rosterAreaByStaffDate: periodRoster.rosterAreaByStaffDate,
        rosterGlByStaffDate: periodRoster.rosterGlByStaffDate,
      }),
    [overviewEntries, periodRoster],
  );

  const byDept = useMemo(() => {
    const m = new Map<Department, StaffAgg[]>();
    for (const dept of DEPT_ORDER) m.set(dept, []);
    for (const s of staffAggs) {
      const arr = m.get(s.department) ?? [];
      arr.push(s);
      m.set(s.department, arr);
    }
    return m;
  }, [staffAggs]);

  const notesByStaff = useMemo(() => {
    const m = new Map<string, { vorschuss: number; besonderheiten: string }>();
    if (isAllLocations) {
      // Pro Standort mergen: Vorschüsse summieren, Besonderheiten mit ` · `
      // konkatenieren — OHNE Standort-Präfix (Frank 19.07.: Präfix stört den
      // Lesefluss im Lohnbüro-Export).
      const byLoc = notesBatchQ.data?.byLocation ?? {};
      for (const loc of locations) {
        const data = byLoc[loc.id] as
          | Array<{ staffId: string; vorschuss: number; besonderheiten: string }>
          | undefined;
        if (!data) continue;
        for (const n of data) {
          const prev = m.get(n.staffId);
          const noteText = n.besonderheiten?.trim() ?? "";
          const merged = prev
            ? {
                vorschuss: prev.vorschuss + n.vorschuss,
                besonderheiten:
                  prev.besonderheiten && noteText
                    ? `${prev.besonderheiten} · ${noteText}`
                    : prev.besonderheiten || noteText,
              }
            : { vorschuss: n.vorschuss, besonderheiten: noteText };
          m.set(n.staffId, merged);
        }
      }
    } else {
      for (const n of notesQ.data ?? []) {
        m.set(n.staffId, { vorschuss: n.vorschuss, besonderheiten: n.besonderheiten });
      }
    }
    return m;
  }, [isAllLocations, notesQ.data, notesBatchQ.data, locations]);

  const advanceCentsByStaff = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of advancesQ.data ?? []) m.set(a.staffId, a.totalCents);
    return m;
  }, [advancesQ.data]);

  const absencesByStaff = useMemo(() => {
    const m = new Map<string, { krankDays: number; urlaubDays: number; absenceNote: string }>();
    for (const a of absencesQ.data ?? []) {
      m.set(a.staffId, {
        krankDays: a.krankDays,
        urlaubDays: a.urlaubDays,
        absenceNote: a.absenceNote ?? "",
      });
    }
    return m;
  }, [absencesQ.data]);

  // Anzeige-Ergänzung: voller Name (Vor- + Nachname) je Mitarbeiter für die
  // zweizeilige Darstellung unter dem Rufnamen in Zusammenfassung + Buchhaltung.
  // Nur Anzeige — Exporte bleiben unverändert.
  const fullNameByStaffId = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staffAllQ.data ?? []) {
      const full = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
      if (full && full.toLowerCase() !== (s.displayName ?? "").toLowerCase()) {
        m.set(s.id, full);
      }
    }
    return m;
  }, [staffAllQ.data]);

  // Personalnummer je Mitarbeiter für Kleinanzeige (Wochenplan/Zusammenfassung/
  // Buchhaltung) und Exporte. Nur gefüllte Werte werden übernommen.
  const persoNrByStaffId = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of staffAllQ.data ?? []) {
      if (s.persoNr != null) m.set(s.id, s.persoNr);
    }
    return m;
  }, [staffAllQ.data]);

  type SfnAgg = {
    simple: { night25Hours: number; night40Hours: number; sundayHours: number };
    extended: {
      night25Hours: number;
      night40Hours: number;
      sundayHours: number;
      holidayHours: number;
      holiday150Hours: number;
    };
    zuschlagCents: number;
  };
  const sfnByStaff = useMemo(() => {
    const m = new Map<string, SfnAgg>();
    const addOne = (s: {
      staffId: string;
      simple: SfnAgg["simple"];
      extended: SfnAgg["extended"];
      zuschlagCents: number;
    }) => {
      const prev = m.get(s.staffId);
      if (!prev) {
        m.set(s.staffId, {
          simple: { ...s.simple },
          extended: { ...s.extended },
          zuschlagCents: s.zuschlagCents,
        });
        return;
      }
      prev.simple.night25Hours += s.simple.night25Hours;
      prev.simple.night40Hours += s.simple.night40Hours;
      prev.simple.sundayHours += s.simple.sundayHours;
      prev.extended.night25Hours += s.extended.night25Hours;
      prev.extended.night40Hours += s.extended.night40Hours;
      prev.extended.sundayHours += s.extended.sundayHours;
      prev.extended.holidayHours += s.extended.holidayHours;
      prev.extended.holiday150Hours += s.extended.holiday150Hours;
      prev.zuschlagCents += s.zuschlagCents;
    };
    if (isAllLocations) {
      const byLoc = sfnBatchQ.data?.byLocation ?? {};
      for (const lid of allLocationIds) {
        const data = byLoc[lid] as { sfn?: Array<Parameters<typeof addOne>[0]> } | undefined;
        for (const s of data?.sfn ?? []) addOne(s);
      }
    } else {
      for (const s of sfnQ.data?.sfn ?? []) addOne(s);
    }
    return m;
  }, [isAllLocations, sfnQ.data, sfnBatchQ.data, allLocationIds]);

  const upsertMut = useMutation({
    mutationFn: (vars: { staffId: string; vorschuss: number; besonderheiten: string | null }) =>
      callUpsert({
        data: {
          locationId: effectiveLocationId,
          staffId: vars.staffId,
          periodStart: fromDate,
          periodEnd: toDate,
          vorschuss: vars.vorschuss,
          besonderheiten: vars.besonderheiten,
        },
      }),
    onSuccess: () => {
      // Deckt sowohl Single- als auch Batch-Key ab.
      void qc.invalidateQueries({ queryKey: ["payroll-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Recurring Notes (Rate / Dauer) — pro Standort ODER org-weit.
  const recurringQ = useQuery({
    queryKey: ["payroll-recurring", isAllLocations ? "all" : effectiveLocationId],
    queryFn: () =>
      fetchRecurring({
        data: { locationId: isAllLocations ? null : effectiveLocationId || null },
      }),
    enabled: isAllLocations || Boolean(effectiveLocationId),
  });
  const invalidateRecurring = () => {
    void qc.invalidateQueries({ queryKey: ["payroll-recurring"] });
  };
  const createRecurringMut = useMutation({
    mutationFn: (vars: {
      staffId: string;
      kind: "rate" | "dauer";
      text: string;
      periodsTotal: number | null;
    }) =>
      callCreateRecurring({
        data: {
          staffId: vars.staffId,
          locationId: isAllLocations ? null : effectiveLocationId || null,
          kind: vars.kind,
          text: vars.text,
          firstPeriodStart: fromDate,
          periodsTotal: vars.periodsTotal,
        },
      }),
    onSuccess: invalidateRecurring,
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelRecurringMut = useMutation({
    mutationFn: (id: string) => callCancelRecurring({ data: { id } }),
    onSuccess: invalidateRecurring,
    onError: (e: Error) => toast.error(e.message),
  });

  // Aktive Notizen pro Mitarbeiter für die aktuell gewählte Periode.
  const activeRecurringByStaff = useMemo(() => {
    const m = new Map<
      string,
      Array<{ id: string; kind: "rate" | "dauer"; display: string; canceled: boolean }>
    >();
    const notes = (recurringQ.data ?? []) as RecurringNote[];
    const periodList = periods.map((p) => ({ startDate: p.startDate, endDate: p.endDate }));
    const currentStart = fromDate;
    if (!currentStart) return m;
    // Group by staff
    const byStaff = new Map<string, RecurringNote[]>();
    for (const n of notes) {
      const arr = byStaff.get(n.staffId) ?? [];
      arr.push(n);
      byStaff.set(n.staffId, arr);
    }
    for (const [staffId, list] of byStaff) {
      const active = activeNotesForPeriod(
        list,
        periodList,
        currentStart,
        isAllLocations ? null : effectiveLocationId || null,
      );
      if (active.length === 0) continue;
      m.set(
        staffId,
        active.map((a) => ({
          id: a.note.id,
          kind: a.note.kind,
          display: a.display,
          canceled: Boolean(a.note.canceledAt),
        })),
      );
    }
    return m;
  }, [recurringQ.data, periods, fromDate, isAllLocations, effectiveLocationId]);

  function invalidateWeekly() {
    // Deckt Single- (["weekly-entries", locId, weekStart]) und Batch-Key
    // (["weekly-entries", "batch", …]) ab.
    void qc.invalidateQueries({ queryKey: ["weekly-entries"] });
    // CI1 (26.07.): Zusammenfassung/Buchhaltung und SFN-abhängige Tabs hängen
    // an denselben time_entries — sonst zeigt die Zusammenfassung nach einer
    // Wochenplan-Korrektur den alten Cache-Wert bis zum harten Reload.
    void qc.invalidateQueries({ queryKey: ["time-overview"] });
    void qc.invalidateQueries({ queryKey: ["payroll-sfn"] });
    void qc.invalidateQueries({ queryKey: ["payroll-absences"] });
  }

  const setShiftMut = useMutation({
    mutationFn: (vars: {
      id: string;
      startedAt: string;
      endedAt: string;
      department?: Department | null;
    }) => callSetShift({ data: vars }),
    onSuccess: () => {
      invalidateWeekly();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Z3 — alle Abteilungen der Person am Standort, gebündelt für Grid + Popover.
  const staffDeptsByStaff = useMemo(() => {
    const m = new Map<string, Department[]>();
    for (const s of weeklyData?.assignedStaff ?? []) {
      const arr = m.get(s.staffId) ?? [];
      const from = s.staffDepts ?? [s.department];
      for (const d of from) if (!arr.includes(d)) arr.push(d);
      m.set(s.staffId, arr);
    }
    return m;
  }, [weeklyData]);

  // Z4b — Dienstplan-Realität der angezeigten Woche je Mitarbeiter
  // (aus roster_shifts). Filtergrundlage für Bereich und Skill.
  const rosterByStaffMap = useMemo(() => {
    const m = new Map<string, { areas: Department[]; skillIds: string[] }>();
    for (const [sid, bucket] of Object.entries(weeklyData?.rosterByStaff ?? {})) {
      m.set(sid, { areas: [...bucket.areas], skillIds: [...bucket.skillIds] });
    }
    return m;
  }, [weeklyData]);

  const createShiftMut = useMutation({
    mutationFn: (vars: {
      staffId: string;
      locationId: string;
      startedAt: string;
      endedAt: string;
      department?: Department | null;
    }) => callCreateShift({ data: vars }),
    onSuccess: () => {
      invalidateWeekly();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // WP1 — Löschen eines Zeit-Eintrags aus dem Wochenplan. Ehrlichkeitsregel:
  // die zugehörige Server-Fn deleteTimeEntry existierte bis WP1 nicht — jetzt
  // schon (Audit "time_entry.manual_delete" mit vollständigem Row-Snapshot,
  // Wasserlinien-Guard serverseitig).
  const deleteEntryMut = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => callDeleteEntry({ data: vars }),
    onSuccess: () => {
      invalidateWeekly();
      toast.success("Schicht gelöscht.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalidatePeriods = () => {
    void qc.invalidateQueries({ queryKey: ["periods"] });
  };
  const createPeriodMut = useMutation({
    mutationFn: (vars: { label: string; startDate: string; endDate: string }) =>
      callCreatePeriod({ data: vars }),
    onSuccess: () => {
      invalidatePeriods();
      toast.success("Periode angelegt.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleLockMut = useMutation({
    mutationFn: (id: string) => callToggleLock({ data: { id } }),
    onSuccess: () => invalidatePeriods(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deletePeriodMut = useMutation({
    mutationFn: (id: string) => callDeletePeriod({ data: { id } }),
    onSuccess: () => {
      invalidatePeriods();
      toast.success("Periode gelöscht.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ============ Wochenplan-Aggregation (für Render + Export) ============
  const weeklyExportInput = useMemo<WeeklyExportInput | null>(() => {
    const data = weeklyData;
    if (!data) return null;
    const days = weekDays.map((d) => ({
      iso: fmtIso(d),
      label: dayHeader(d),
      isSunOrHol: isSundayOrHoliday(d),
    }));

    type AccRow = {
      staffId: string;
      displayName: string;
      department: Department;
      isPrimary: boolean;
      byDate: Map<string, WeeklyEntry[]>;
      totals: { total: number; evening: number; night: number; sunHol: number };
      mismatched: boolean;
    };
    const rowKey = (staffId: string, dept: Department) => `${staffId}:${dept}`;
    const rowMap = new Map<string, AccRow>();
    // Z2/Z3 — Grundmenge: EINE Zeile pro (Mitarbeiter, Zuordnung). Alle
    // Zeilen sind ab Z3 voll editierbar; isPrimary bleibt nur für die
    // NULL-Attribution (Fallback auf Primär-Zeile) relevant.
    const staffDeptsByStaff = new Map<string, Department[]>();
    for (const s of data.assignedStaff ?? []) {
      const arr = staffDeptsByStaff.get(s.staffId) ?? s.staffDepts ?? [];
      staffDeptsByStaff.set(s.staffId, arr);
      const key = rowKey(s.staffId, s.department);
      if (rowMap.has(key)) continue;
      rowMap.set(key, {
        staffId: s.staffId,
        displayName: s.displayName,
        department: s.department,
        isPrimary: s.isPrimary ?? true,
        byDate: new Map(),
        totals: { total: 0, evening: 0, night: 0, sunHol: 0 },
        mismatched: false,
      });
    }
    for (const e of data.entries) {
      // Out-of-Period-Skip: Einträge außerhalb der gewählten Abrechnungs-
      // periode (Mo–So-Woche kann an Periodengrenzen überlappen) werden
      // weder in byDate noch in die Wochensummen aufgenommen.
      if (e.businessDate < fromDate || e.businessDate > toDate) continue;
      // Z3 — Attribution zentral über entryRowDepartment:
      //   - department != null & ∈ staffDepts → eigene Zeile
      //   - NULL → Primär-Zeile
      //   - department gesetzt, aber nicht mehr zugeordnet → Primär-Zeile
      //     + `mismatched` (Tooltip-Warnung)
      const staffDepts = staffDeptsByStaff.get(e.staffId) ?? [e.department];
      const rosterArea =
        (data.rosterAreaByStaffDate?.[e.staffId]?.[e.businessDate] as Department | undefined) ??
        null;
      const rosterHasGlSkill = Boolean(data.rosterGlByStaffDate?.[e.staffId]?.[e.businessDate]);
      // WZ2 — rosterPlanned darf NICHT allein aus rosterArea abgeleitet werden:
      // GL-Schichten haben area=null (Skill-only, D-3). Ohne dieses Signal
      // würde die W2-Fallback-Regel für GL-Personen an einem geplanten
      // Service-Tag fälschlich greifen.
      const rosterPlanned = Boolean(rosterArea) || rosterHasGlSkill;
      const attr = entryRowDepartment(e.rawDepartment ?? null, staffDepts, {
        rosterArea,
        rosterHasGlSkill,
        rosterPlanned,
      });
      const key = rowKey(e.staffId, attr.department);
      let r = rowMap.get(key);
      if (!r) {
        r = {
          staffId: e.staffId,
          displayName: e.displayName,
          department: attr.department,
          isPrimary: true,
          byDate: new Map(),
          totals: { total: 0, evening: 0, night: 0, sunHol: 0 },
          mismatched: false,
        };
        rowMap.set(key, r);
      }
      if (attr.mismatched) r.mismatched = true;
      const arr = r.byDate.get(e.businessDate) ?? [];
      arr.push(e);
      r.byDate.set(e.businessDate, arr);
      const s = computeShiftHours(e.startedAt, e.endedAt, e.businessDate);
      r.totals.total += s.totalHours;
      r.totals.evening += s.eveningHours;
      r.totals.night += s.nightHours;
      r.totals.sunHol += s.sundayHolidayHours;
    }
    const cross = data.crossLocationDates ?? {};
    const q = searchQuery.trim().toLowerCase();

    const buildExportRow = (r: AccRow): WeeklyExportRow => ({
      staffId: r.staffId,
      displayName: r.displayName,
      fullName: fullNameByStaffId.get(r.staffId) ?? "",
      persoNr: persoNrByStaffId.get(r.staffId) ?? null,
      department: r.department,
      isPrimary: r.isPrimary,
      days: days.map((d) => {
        const dayEntries = r.byDate.get(d.iso) ?? [];
        return {
          iso: d.iso,
          label: d.label,
          isSunOrHol: d.isSunOrHol,
          shifts: dayEntries.map((e) => ({
            from: fmtHHMM(e.startedAt),
            to: fmtHHMM(e.endedAt),
          })),
          crossLocation: dayEntries.length === 0 && (cross[r.staffId] ?? []).includes(d.iso),
        };
      }),
      totals: r.totals,
    });

    const rowsByDept: WeeklyExportInput["rowsByDept"] = DEPT_ORDER.map((dept) => ({
      dept,
      deptLabel: DEPT_HEADER_LABEL[dept],
      rows: Array.from(rowMap.values())
        .filter((r) => r.department === dept)
        .filter((r) => q === "" || r.displayName.toLowerCase().includes(q))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "de"))
        .map(buildExportRow),
    }));

    const locLabel = isAllLocations
      ? "Alle"
      : (locations.find((l) => l.id === effectiveLocationId)?.name ?? "");
    const wk = isoWeek(weekStartDate);
    return {
      locationLabel: locLabel,
      weekNo: wk.week,
      weekYear: wk.year,
      rangeLabel: `${ddmm(weekDays[0])}–${ddmm(weekDays[6])}${weekDays[6].getUTCFullYear()}`,
      days,
      rowsByDept,
    };
  }, [
    weeklyData,
    weekDays,
    weekStartDate,
    searchQuery,
    isAllLocations,
    locations,
    effectiveLocationId,
    fromDate,
    toDate,
    fullNameByStaffId,
    persoNrByStaffId,
  ]);

  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const submitBlobExport = async (
    key: string,
    buildBlob: () => Promise<Blob> | Blob,
    filename: string,
  ) => {
    setExportBusy(key);
    try {
      const blob = await buildBlob();
      const payload = await blobToExportFormPayload(blob, filename);
      submitExportForm(payload);
    } catch (e) {
      toast.error((e as Error).message || "Export fehlgeschlagen");
    } finally {
      setExportBusy(null);
    }
  };

  const handleExportXlsx = () => {
    if (!weeklyExportInput) return;
    const filename = `${buildFileBaseName(weeklyExportInput)}.xlsx`;
    void submitBlobExport("weekly-xlsx", () => buildWeeklyXlsx(weeklyExportInput), filename);
  };

  const handleExportPdf = () => {
    if (!weeklyExportInput) return;
    const filename = `${buildFileBaseName(weeklyExportInput)}.pdf`;
    void submitBlobExport("weekly-pdf", () => buildWeeklyPdf(weeklyExportInput), filename);
  };

  // Debug-Diagnose: sendet dieselbe Payload wie ein PDF-Export an
  // /api/export/download, zeigt aber Statuscode + Response-Header
  // (Content-Type, Content-Disposition) an — hilft bei Safari-Downloads,
  // die stumm fehlschlagen.
  const [exportProbe, setExportProbe] = useState<ExportProbeResult | null>(null);
  const [exportProbeRunning, setExportProbeRunning] = useState(false);
  const runExportDiagnose = async (transport: "fetch" | "form") => {
    if (!weeklyExportInput) return;
    setExportProbeRunning(true);
    setExportProbe(null);
    try {
      const blob = await buildWeeklyPdf(weeklyExportInput);
      const filename = `${buildFileBaseName(weeklyExportInput)}.pdf`;
      const result =
        transport === "form"
          ? await probeExportEndpointAsForm(blob, filename)
          : await probeExportEndpoint(blob, filename);
      setExportProbe(result);
      const label = transport === "form" ? "Formular-Probe" : "Diagnose";
      if (result.ok) toast.success(`${label} OK · ${result.status}`);
      else toast.error(`${label} fehlgeschlagen · HTTP ${result.status}`);
    } catch (e) {
      toast.error((e as Error).message || "Diagnose fehlgeschlagen");
    } finally {
      setExportProbeRunning(false);
    }
  };

  // Z4 — nur der Grid-Render folgt Bereich/Skill-Filtern; die Exporte oben
  // nutzen weiterhin `weeklyExportInput` (alle Bereiche/Skills unabhängig
  // vom Filter, damit ein Export nie ein stilles Teil-Ergebnis wird).
  const weeklyDisplayInput = useMemo<WeeklyExportInput | null>(() => {
    if (!weeklyExportInput) return null;
    return {
      ...weeklyExportInput,
      rowsByDept: filterWeeklyRows(
        weeklyExportInput.rowsByDept,
        { dept: deptFilter, skillId: skillFilter, query: "" },
        rosterByStaffMap,
      ),
    };
  }, [weeklyExportInput, deptFilter, skillFilter, rosterByStaffMap]);

  // ============ Buchhaltung-Aggregation (Render + Export) ============
  const payrollRowsByStaff = useMemo(() => {
    const is3b = payrollMode === "section3b";
    const m = new Map<string, BuchhaltungExportRow & { staffId: string; department: Department }>();
    for (const s of staffAggs) {
      const sfn = sfnByStaff.get(s.staffId);
      const b = is3b ? sfn?.extended : sfn?.simple;
      const note = notesByStaff.get(s.staffId);
      const advCents = advanceCentsByStaff.get(s.staffId) ?? 0;
      const abs = absencesByStaff.get(s.staffId);
      const recur = activeRecurringByStaff.get(s.staffId) ?? [];
      void recur; // rendered separately in PayrollTab; export mergt weiter unten.
      m.set(s.staffId, {
        staffId: s.staffId,
        department: s.department,
        displayName: s.displayName,
        fullName: fullNameByStaffId.get(s.staffId) ?? "",
        persoNr: persoNrByStaffId.get(s.staffId) ?? null,
        totalHours: s.totalHours,
        stundenGl: hoursByStaffAndDept.get(s.staffId)?.get("gl") ?? 0,
        stundenKueche: hoursByStaffAndDept.get(s.staffId)?.get("kitchen") ?? 0,
        stundenService: hoursByStaffAndDept.get(s.staffId)?.get("service") ?? 0,
        shifts: s.shiftDates.size,
        evening: b?.night25Hours ?? 0,
        night: b?.night40Hours ?? 0,
        sunHol: sfn?.simple.sundayHours ?? 0,
        sonntag: sfn?.extended.sundayHours ?? 0,
        feiertag: sfn?.extended.holidayHours ?? 0,
        feiertag150: sfn?.extended.holiday150Hours ?? 0,
        urlaubDays: abs?.urlaubDays ?? 0,
        krankDays: abs?.krankDays ?? 0,
        vorschussEUR: advCents / 100,
        besonderheiten: note?.besonderheiten ?? "",
        absenceNote: abs?.absenceNote ?? "",
      });
    }
    return m;
  }, [
    staffAggs,
    sfnByStaff,
    notesByStaff,
    advanceCentsByStaff,
    absencesByStaff,
    payrollMode,
    activeRecurringByStaff,
    fullNameByStaffId,
    persoNrByStaffId,
    hoursByStaffAndDept,
  ]);

  const payrollSearchActive = payrollSearch.trim().length > 0;
  const payrollFilteredByDept = useMemo(() => {
    const q = payrollSearch.trim().toLowerCase();
    const m = new Map<Department, BuchhaltungExportRow[]>();
    for (const dept of DEPT_ORDER) m.set(dept, []);
    for (const row of payrollRowsByStaff.values()) {
      if (q !== "" && !row.displayName.toLowerCase().includes(q)) continue;
      const arr = m.get(row.department) ?? [];
      arr.push(row);
      m.set(row.department, arr);
    }
    return m;
  }, [payrollRowsByStaff, payrollSearch]);

  const payrollAllVisible = useMemo(() => {
    const out: BuchhaltungExportRow[] = [];
    for (const dept of DEPT_ORDER) {
      for (const r of payrollFilteredByDept.get(dept) ?? []) out.push(r);
    }
    return out;
  }, [payrollFilteredByDept]);

  const payrollTotals = useMemo(() => {
    // BH1 — Summen-Konsistenz: Fußzeile = Σ der GERUNDETEN Personenwerte
    // (Stunden-Spalten). Zähler-/Vorschuss-Spalten summieren roh.
    const sum = (sel: (r: BuchhaltungExportRow) => number) =>
      payrollAllVisible.reduce((a, r) => a + sel(r), 0);
    const sumQ = (sel: (r: BuchhaltungExportRow) => number) =>
      payrollAllVisible.reduce((a, r) => a + floorToQuarterHours(sel(r)), 0);
    return {
      totalHours: sumQ((r) => r.totalHours),
      shifts: sum((r) => r.shifts),
      evening: sumQ((r) => r.evening),
      night: sumQ((r) => r.night),
      sunHol: sumQ((r) => r.sunHol),
      sonntag: sumQ((r) => r.sonntag),
      feiertag: sumQ((r) => r.feiertag),
      feiertag150: sumQ((r) => r.feiertag150),
      urlaubDays: sum((r) => r.urlaubDays),
      krankDays: sum((r) => r.krankDays),
      vorschussEUR: sum((r) => r.vorschussEUR),
    };
  }, [payrollAllVisible]);

  const buchhaltungExportInput = useMemo<BuchhaltungExportInput>(() => {
    const locLabel = locations.find((l) => l.id === effectiveLocationId)?.name ?? "";
    const perLabel = selectedPeriod?.label ?? `${fromDate}_${toDate}`;
    const mergeRecurring = (rows: BuchhaltungExportRow[]): BuchhaltungExportRow[] =>
      rows.map((r) => {
        const staffId = (r as BuchhaltungExportRow & { staffId?: string }).staffId;
        const recur = staffId ? activeRecurringByStaff.get(staffId) : undefined;
        if (!recur || recur.length === 0) return r;
        const recurText = recur.map((x) => x.display).join(" · ");
        const combined = [r.besonderheiten ?? "", recurText].filter(Boolean).join(" · ");
        return { ...r, besonderheiten: combined };
      });
    return {
      locationLabel: locLabel,
      periodLabel: perLabel,
      rangeLabel: `${fmtDDMM(fromDate)}–${fmtDDMM(toDate)}`,
      mode: payrollMode,
      rowsByDept: DEPT_ORDER.map((dept) => ({
        dept,
        deptLabel: DEPT_HEADER_LABEL[dept],
        rows: mergeRecurring(payrollFilteredByDept.get(dept) ?? []),
      })),
    };
  }, [
    locations,
    effectiveLocationId,
    selectedPeriod,
    fromDate,
    toDate,
    payrollMode,
    payrollFilteredByDept,
    activeRecurringByStaff,
  ]);

  const handlePayrollExportPdf = () => {
    const filename = `${buildBuchhaltungFileBase(buchhaltungExportInput)}.pdf`;
    void submitBlobExport(
      "payroll-pdf",
      () => buildBuchhaltungPdf(buchhaltungExportInput),
      filename,
    );
  };

  const handlePayrollExportXlsx = () => {
    const filename = `${buildBuchhaltungFileBase(buchhaltungExportInput)}.xlsx`;
    void submitBlobExport(
      "payroll-xlsx",
      () => buildBuchhaltungXlsx(buchhaltungExportInput),
      filename,
    );
  };

  const handlePayrollExportCsv = () => {
    const filename = `${buildBuchhaltungFileBase(buchhaltungExportInput)}.csv`;
    void submitBlobExport(
      "payroll-csv",
      () => {
        const csv = buildBuchhaltungCsv(buchhaltungExportInput);
        return new Blob([csv], { type: "text/csv;charset=utf-8" });
      },
      filename,
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Arbeitszeiten</h1>
        <p className="text-sm text-muted-foreground">
          Arbeitszeit nach Kalenderwochen und Lohnbuchhaltungs-Übersicht.
        </p>
      </div>

      <Tabs value={isPlaner ? "weekly" : activeTab} onValueChange={setActiveTab}>
        <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
          <TabButton
            active={isPlaner || activeTab === "weekly"}
            onClick={() => setActiveTab("weekly")}
          >
            Wochenplan
          </TabButton>
          {!isPlaner && (
            <>
              <TabButton active={activeTab === "summary"} onClick={() => setActiveTab("summary")}>
                Zusammenfassung
              </TabButton>
              <TabButton active={activeTab === "payroll"} onClick={() => setActiveTab("payroll")}>
                Buchhaltung
              </TabButton>
              <TabButton active={activeTab === "periods"} onClick={() => setActiveTab("periods")}>
                Perioden
              </TabButton>
              <TabButton
                active={activeTab === "lohnrechner"}
                onClick={() => setActiveTab("lohnrechner")}
              >
                Brutto/Netto
              </TabButton>
              <TabButton
                active={activeTab === "provision"}
                onClick={() => setActiveTab("provision")}
              >
                Provision
              </TabButton>
            </>
          )}
        </div>

        {(activeTab === "summary" || activeTab === "payroll" || activeTab === "provision") && (
          <Card className="my-3 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="loc-zr">Standort</Label>
                <div id="loc-zr">
                  <LocationPills
                    locations={locations}
                    value={isAllLocations ? "all" : locationFilter || locations[0]?.id || ""}
                    onChange={setLocationFilter}
                    includeAll
                    allValue="all"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="period">Periode</Label>
                <select
                  id="period"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={effectivePeriodId}
                  onChange={(e) => setSelectedPeriodId(e.target.value)}
                >
                  <option value="">— freie Auswahl —</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} {p.status === "locked" ? "🔒" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>
        )}

        {/* WZ1: Lücken-Banner in Standort-Sicht (nicht bei "Alle Standorte").
            unlocated = Einträge ohne location_id, open = laufende Schichten
            im Zeitraum an DIESEM Standort. Rein informativ, keine Aktion. */}
        {(activeTab === "summary" || activeTab === "payroll" || activeTab === "provision") &&
          !isAllLocations &&
          overviewQ.data?.gaps &&
          (overviewQ.data.gaps.unlocatedShifts > 0 || overviewQ.data.gaps.openShifts > 0) && (
            <div className="my-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              Hinweis: In diesem Zeitraum{" "}
              {overviewQ.data.gaps.unlocatedShifts > 0 && (
                <>
                  <strong>{overviewQ.data.gaps.unlocatedShifts}</strong> Einträge ohne Standort
                </>
              )}
              {overviewQ.data.gaps.unlocatedShifts > 0 &&
                overviewQ.data.gaps.openShifts > 0 &&
                " und "}
              {overviewQ.data.gaps.openShifts > 0 && (
                <>
                  <strong>{overviewQ.data.gaps.openShifts}</strong> offene Schichten
                </>
              )}
              . Wechsel auf „Alle Standorte", um sie zu prüfen.
            </div>
          )}

        <TabsContent value="weekly">
          <Card className="p-4 mb-3 space-y-3">
            {/* Zeile 1: Monat + Location-Pills + Exporte */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={effectivePeriodId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedPeriodId(id);
                  const p = periods.find((x) => x.id === id);
                  if (p) setWeekStart(fmtIso(mondayOf(parseIsoDate(p.startDate))));
                }}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({ddmm(parseIsoDate(p.startDate))}–{ddmm(parseIsoDate(p.endDate))})
                    {p.status === "locked" ? " 🔒" : ""}
                  </option>
                ))}
              </select>
              <LocationPills
                locations={locations}
                value={isAllLocations ? "all" : locationFilter || locations[0]?.id || ""}
                onChange={setLocationFilter}
                includeAll
                allValue="all"
              />
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPdf}
                  disabled={exportBusy === "weekly-pdf"}
                >
                  <FileDown className="mr-1 h-4 w-4" />
                  {exportBusy === "weekly-pdf" ? "Erstelle…" : "PDF"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportXlsx}
                  disabled={exportBusy === "weekly-xlsx"}
                >
                  <FileSpreadsheet className="mr-1 h-4 w-4" />
                  {exportBusy === "weekly-xlsx" ? "Erstelle…" : "Excel"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePayrollExportCsv}
                  disabled={exportBusy === "payroll-csv"}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {exportBusy === "payroll-csv" ? "Erstelle…" : "CSV"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runExportDiagnose("fetch")}
                  disabled={exportProbeRunning}
                  title="Sendet einen Test-Export an /api/export/download und zeigt Statuscode + Response-Header (für Safari-Debugging)."
                >
                  {exportProbeRunning ? "Prüfe…" : "Diagnose"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runExportDiagnose("form")}
                  disabled={exportProbeRunning}
                  title="Sendet dieselbe Probe als echtes Formular-POST."
                >
                  {exportProbeRunning ? "Prüfe…" : "Probe als Formular"}
                </Button>
              </div>
            </div>
            {exportProbe && (
              <div
                className={`rounded-md border p-3 text-xs ${
                  exportProbe.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <strong>
                    Export-Diagnose ({exportProbe.transport === "form" ? "Formular" : "Fetch"}) ·
                    HTTP {exportProbe.status} {exportProbe.statusText}
                  </strong>
                  <button
                    type="button"
                    className="text-[11px] underline"
                    onClick={() => setExportProbe(null)}
                  >
                    schließen
                  </button>
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono">
                  <dt>Endpoint</dt>
                  <dd className="break-all">{exportProbe.url}</dd>
                  <dt>Pfad</dt>
                  <dd>{exportProbe.transport === "form" ? "Formular-POST" : "Fetch-POST"}</dd>
                  <dt>Content-Type</dt>
                  <dd className="break-all">{exportProbe.contentType ?? "—"}</dd>
                  <dt>Content-Disposition</dt>
                  <dd className="break-all">{exportProbe.contentDisposition ?? "—"}</dd>
                  <dt>Content-Length</dt>
                  <dd>{exportProbe.contentLength ?? "—"}</dd>
                  <dt>Body</dt>
                  <dd className="break-all">{exportProbe.bodyPreview}</dd>
                </dl>
              </div>
            )}
            {/* Zeile 2: Suche */}
            <div className="relative max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Mitarbeiter suchen…"
                className="h-9 pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {/* Z4 — Bereich + Skill (nur Anzeige-Filter, kombinieren per UND). */}
            <div className="flex flex-wrap items-center gap-3">
              <PillSelect<Department | "all">
                ariaLabel="Bereich"
                size="sm"
                options={[
                  { value: "all", label: "Alle" },
                  { value: "kitchen", label: "Küche" },
                  { value: "service", label: "Service" },
                  { value: "gl", label: "GL" },
                ]}
                value={deptFilter}
                onChange={setDeptFilter}
              />
              {deptFilter !== "all" && (
                <span
                  className="text-xs text-muted-foreground"
                  title="Bereich-Filter matcht die Dienstplan-Realität der angezeigten Woche (roster_shifts), nicht die Skill-Stammdaten."
                >
                  Zeigt nur in dieser Woche entsprechend Eingeplante
                </span>
              )}
            </div>
            {/* Zeile 3: Wochen-Chips */}
            <div className="flex flex-wrap items-center gap-2">
              {periodWeeks.map((c) => {
                const active = c.start === weekStart;
                return (
                  <button
                    key={c.start}
                    type="button"
                    onClick={() => setWeekStart(c.start)}
                    className={`h-8 rounded-md px-3 text-sm transition ${
                      active
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <span className="font-semibold">W{c.idx}</span>{" "}
                    <span className="opacity-80">
                      ({ddmm(parseIsoDate(c.start))}–{ddmm(parseIsoDate(c.end))})
                    </span>
                  </button>
                );
              })}
              {!isPayroll && (
                <button
                  type="button"
                  onClick={() => {
                    const today = todayIso();
                    const containing = periods.find(
                      (p) => p.startDate <= today && today <= p.endDate,
                    );
                    if (containing) setSelectedPeriodId(containing.id);
                    setWeekStart(fmtIso(mondayOf(parseIsoDate(today))));
                  }}
                  className="ml-auto h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-muted"
                >
                  Heute
                </button>
              )}
            </div>
          </Card>
          <WeeklyPlan
            input={weeklyDisplayInput}
            isLoading={weeklyLoading}
            weekDays={weekDays}
            periodStart={fromDate}
            periodEnd={toDate}
            isAdmin={isAdmin}
            pending={setShiftMut.isPending || createShiftMut.isPending || deleteEntryMut.isPending}
            onUpdateInline={(id, iso, from, to) => {
              try {
                const { startedAt, endedAt } = buildShiftIsosOrThrow(iso, from, to);
                setShiftMut.mutate({ id, startedAt, endedAt });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            onCreateInline={(staffId, iso, from, to, department) => {
              if (!effectiveLocationId) {
                toast.error("Bitte erst einen Standort wählen.");
                return;
              }
              try {
                const { startedAt, endedAt } = buildShiftIsosOrThrow(iso, from, to);
                createShiftMut.mutate({
                  staffId,
                  locationId: effectiveLocationId,
                  startedAt,
                  endedAt,
                  department,
                });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            onReassign={(id, department) => {
              const entry = weeklyData?.entries.find((e) => e.id === id);
              if (!entry) return;
              setShiftMut.mutate({
                id,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
                department,
              });
            }}
            onDeleteEntry={(id, reason) => {
              deleteEntryMut.mutate({ id, reason });
            }}
            staffDeptsByStaff={staffDeptsByStaff}
            entriesById={useMemo(() => {
              const m = new Map<string, WeeklyEntry>();
              for (const e of weeklyData?.entries ?? []) m.set(e.id, e);
              return m;
            }, [weeklyData])}
            shiftsByStaff={shiftsByStaff}
            absencesByStaff={absencesByStaff}
            totalsScope={totalsScope}
            onTotalsScopeChange={setTotalsScope}
            periodTotalsByStaff={periodTotalsByStaff}
            persoNrByStaffId={persoNrByStaffId}
          />
        </TabsContent>

        <TabsContent value="lohnrechner">
          <LohnrechnerPanel />
        </TabsContent>

        <TabsContent value="provision">
          <ProvisionTab
            locationId={effectiveLocationId}
            locationLabel={locations.find((l) => l.id === effectiveLocationId)?.name ?? ""}
            isAllLocations={isAllLocations}
            periodStart={fromDate}
            periodEnd={toDate}
            isAdmin={isAdmin}
          />
        </TabsContent>

        <TabsContent value="summary">
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  {weekCols.map((w) => (
                    <TableHead key={w.key} className="text-right whitespace-nowrap">
                      {w.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Gesamt</TableHead>
                  <TableHead
                    className="text-right text-red-600"
                    title="Schichten in der Abrechnungsperiode"
                  >
                    S
                  </TableHead>
                  <TableHead className="text-right text-green-600">U</TableHead>
                  <TableHead className="text-right text-blue-600">K</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overviewLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5 + weekCols.length}
                      className="text-center text-muted-foreground"
                    >
                      <ZeitSkeleton />
                    </TableCell>
                  </TableRow>
                )}
                {!overviewLoading && staffAggs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5 + weekCols.length}
                      className="text-center text-muted-foreground"
                    >
                      Keine Einträge im Zeitraum.
                    </TableCell>
                  </TableRow>
                )}
                {DEPT_ORDER.map((dept) => {
                  const list = byDept.get(dept) ?? [];
                  if (list.length === 0) return null;
                  const deptWeek = new Map<string, number>();
                  let deptTotal = 0;
                  let deptShifts = 0;
                  let deptUrlaub = 0;
                  let deptKrank = 0;
                  for (const s of list) {
                    for (const [k, v] of s.perWeek) {
                      deptWeek.set(k, (deptWeek.get(k) ?? 0) + v);
                    }
                    // BH1 — Bereichs-Summe = Σ der GERUNDETEN Personenwerte.
                    deptTotal += floorToQuarterHours(s.totalHours);
                    deptShifts += s.shiftDates.size;
                    const abs = absencesByStaff.get(s.staffId);
                    deptUrlaub += abs?.urlaubDays ?? 0;
                    deptKrank += abs?.krankDays ?? 0;
                  }
                  return (
                    <Fragment key={`grp-${dept}`}>
                      <TableRow className={DEPT_BG[dept]}>
                        <TableCell
                          colSpan={5 + weekCols.length}
                          className="font-semibold text-foreground"
                        >
                          {DEPT_LABEL[dept]}
                        </TableCell>
                      </TableRow>
                      {list.map((s, idx) => {
                        const abs = absencesByStaff.get(s.staffId);
                        const u = abs?.urlaubDays ?? 0;
                        const k = abs?.krankDays ?? 0;
                        return (
                          <TableRow key={s.staffId} className={idx % 2 === 1 ? "bg-muted/60" : ""}>
                            <TableCell>
                              <div>
                                {canOpenStaff ? (
                                  <Link
                                    to="/admin/staff/$staffId"
                                    params={{ staffId: s.staffId }}
                                    search={{ from: currentHref }}
                                    className="hover:underline"
                                  >
                                    {s.displayName}
                                  </Link>
                                ) : (
                                  s.displayName
                                )}
                                {persoNrByStaffId.get(s.staffId) != null && (
                                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                    #{persoNrByStaffId.get(s.staffId)}
                                  </span>
                                )}
                              </div>
                              {fullNameByStaffId.get(s.staffId) && (
                                <div className="text-xs text-muted-foreground">
                                  {fullNameByStaffId.get(s.staffId)}
                                </div>
                              )}
                            </TableCell>
                            {weekCols.map((w) => (
                              <TableCell key={w.key} className="text-right tabular-nums">
                                {fmtHm(s.perWeek.get(w.key) ?? 0)}
                              </TableCell>
                            ))}
                            <TableCell className="text-right tabular-nums font-medium">
                              {fmtHm(floorToQuarterHours(s.totalHours))}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${s.shiftDates.size > 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}
                            >
                              {s.shiftDates.size}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${u > 0 ? "text-green-600 font-medium" : "text-muted-foreground/50"}`}
                            >
                              {u > 0 ? u : "–"}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${k > 0 ? "text-blue-600 font-medium" : "text-muted-foreground/50"}`}
                            >
                              {k > 0 ? k : "–"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className={`${DEPT_BG[dept]} font-medium`}>
                        <TableCell>Summe {DEPT_LABEL[dept]}</TableCell>
                        {weekCols.map((w) => (
                          <TableCell key={w.key} className="text-right tabular-nums">
                            {fmtHm(deptWeek.get(w.key) ?? 0)}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">
                          {fmtHm(deptTotal)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deptShifts > 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {deptShifts}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deptUrlaub > 0 ? "text-green-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {deptUrlaub > 0 ? deptUrlaub : "–"}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${deptKrank > 0 ? "text-blue-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {deptKrank > 0 ? deptKrank : "–"}
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
                {staffAggs.length > 0 &&
                  (() => {
                    const totWeek = new Map<string, number>();
                    let tot = 0;
                    let totShifts = 0;
                    let totUrlaub = 0;
                    let totKrank = 0;
                    for (const s of staffAggs) {
                      for (const [k, v] of s.perWeek) {
                        totWeek.set(k, (totWeek.get(k) ?? 0) + v);
                      }
                      // BH1 — Gesamt-Fußzeile = Σ der GERUNDETEN Personenwerte.
                      tot += floorToQuarterHours(s.totalHours);
                      totShifts += s.shiftDates.size;
                      const abs = absencesByStaff.get(s.staffId);
                      totUrlaub += abs?.urlaubDays ?? 0;
                      totKrank += abs?.krankDays ?? 0;
                    }
                    return (
                      <TableRow className="bg-muted font-semibold">
                        <TableCell>Gesamt</TableCell>
                        {weekCols.map((w) => (
                          <TableCell key={w.key} className="text-right tabular-nums">
                            {fmtHm(totWeek.get(w.key) ?? 0)}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">{fmtHm(tot)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${totShifts > 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {totShifts}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${totUrlaub > 0 ? "text-green-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {totUrlaub > 0 ? totUrlaub : "–"}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${totKrank > 0 ? "text-blue-600 font-medium" : "text-muted-foreground/50"}`}
                        >
                          {totKrank > 0 ? totKrank : "–"}
                        </TableCell>
                      </TableRow>
                    );
                  })()}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">
            Stundensummen auf Viertelstunden abgerundet (Lohn-Übergabe). Wochenzellen bleiben exakt.
          </p>
        </TabsContent>

        <TabsContent value="payroll">
          <PayrollTab
            mode={payrollMode}
            onModeChange={setPayrollMode}
            search={payrollSearch}
            onSearchChange={setPayrollSearch}
            searchActive={payrollSearchActive}
            rowsByDept={payrollFilteredByDept}
            staffRows={payrollRowsByStaff}
            totals={payrollTotals}
            hoursByStaffAndDept={hoursByStaffAndDept}
            readOnly={isPayroll}
            fullNameByStaffId={fullNameByStaffId}
            persoNrByStaffId={persoNrByStaffId}
            onSaveNote={(staffId, besonderheiten) =>
              upsertMut.mutate({
                staffId,
                vorschuss: 0,
                besonderheiten: besonderheiten.trim() === "" ? null : besonderheiten,
              })
            }
            recurringByStaff={activeRecurringByStaff}
            onAddRecurring={(vars) => createRecurringMut.mutate(vars)}
            onCancelRecurring={(id) => cancelRecurringMut.mutate(id)}
            onExportPdf={handlePayrollExportPdf}
            onExportXlsx={handlePayrollExportXlsx}
            onExportCsv={handlePayrollExportCsv}
            exportBusy={
              exportBusy === "payroll-pdf"
                ? "pdf"
                : exportBusy === "payroll-xlsx"
                  ? "xlsx"
                  : exportBusy === "payroll-csv"
                    ? "csv"
                    : null
            }
            renderStaffName={
              canOpenStaff
                ? (staffId, displayName) => (
                    <Link
                      to="/admin/staff/$staffId"
                      params={{ staffId }}
                      search={{ from: currentHref }}
                      className="hover:underline"
                    >
                      {displayName}
                    </Link>
                  )
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value="periods">
          <PeriodsPanel
            periods={periods}
            isAdmin={isAdmin}
            isLoading={periodsQ.isLoading}
            onCreate={(vars) => createPeriodMut.mutate(vars)}
            onToggleLock={(id) => toggleLockMut.mutate(id)}
            onDelete={(id) => deletePeriodMut.mutate(id)}
            pending={
              createPeriodMut.isPending || toggleLockMut.isPending || deletePeriodMut.isPending
            }
          />
        </TabsContent>
      </Tabs>

      {isAdmin &&
        activeTab === "payroll" &&
        !isAllLocations &&
        effectiveLocationId &&
        fromDate &&
        toDate && (
          <BatchTimesCard
            locationId={effectiveLocationId}
            periodStart={fromDate}
            periodEnd={toDate}
            periodLabel={selectedPeriod?.label ?? `${fromDate} – ${toDate}`}
          />
        )}
    </div>
  );
}
