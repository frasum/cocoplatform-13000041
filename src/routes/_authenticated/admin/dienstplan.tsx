// D2a/D2b/D2c/D2f — Dienstplan-Seite. Schlanke Shell: lädt Periode/Standort,
// abonniert Realtime, ruft Server-Functions auf. UI in <RosterGrid>.
// Erhaltungs-Constraints: Realtime, Cross-Booking-Markierung, Service-Marker,
// GL→Service-Mapping bleiben funktional erhalten (vgl. .lovable/plan.md).

import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { parseIso, todayIso } from "@/lib/format";
import { TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { listLocations } from "@/lib/admin/locations.functions";
import { LocationPills } from "@/components/shared/LocationPills";
import { listPeriods } from "@/lib/time/time-admin.functions";
import {
  createRosterShift,
  deleteRosterShift,
  getRosterShifts,
  getStaffForRoster,
  getStaffCrossBookings,
  getAvailability,
  setUnavailable,
  clearUnavailable,
  getAbsences,
  setAbsenceRange,
  clearAbsence,
  getDayOffWishes,
  createDayOffWishFor,
  deleteDayOffWishFor,
  listSkills,
  moveRosterShift,
  updateRosterShiftSkill,
  updateRosterShiftStatus,
  getRosterRelease,
  setRosterRelease,
  getMyRosterScopes,
  type RosterShift,
  type RosterSkill,
} from "@/lib/roster/roster.functions";
import { allowedLocations, canEditScope } from "@/lib/roster/scope-util";
import { Button } from "@/components/ui/button";
import { RosterGrid } from "@/components/roster/RosterGrid";
import { PaintToolbar, type PaintSelection } from "@/components/roster/PaintToolbar";
import { SkillFilterChips } from "@/components/roster/SkillFilterChips";
import { PeriodNav } from "@/components/roster/PeriodNav";
import { PlanerRosterView } from "@/components/roster/PlanerRosterView";
import { RosterDayView } from "@/components/roster/RosterDayView";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/roster/absence-types";

export const Route = createFileRoute("/_authenticated/admin/dienstplan")({
  head: () => ({ meta: [{ title: "Dienstplan" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { bereich?: "kueche" | "service"; ansicht?: "grid" | "tag"; tag?: string } => ({
    bereich:
      search.bereich === "service" || search.bereich === "kueche"
        ? (search.bereich as "kueche" | "service")
        : undefined,
    ansicht:
      search.ansicht === "grid" || search.ansicht === "tag"
        ? (search.ansicht as "grid" | "tag")
        : undefined,
    tag:
      typeof search.tag === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.tag)
        ? search.tag
        : undefined,
  }),
  component: DienstplanPage,
});

type GridArea = "kitchen" | "service";

function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function daysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = parseIso(fromIso);
  const end = parseIso(toIso);
  while (cur.getTime() <= end.getTime()) {
    out.push(fmtIso(cur));
    cur = addDays(cur, 1);
  }
  return out;
}
function DienstplanPage() {
  // DP-A1 — Weiche über die Rolle. Nur `planer` erhält die neue Bereichs-
  // Ansicht (stapelt Standorte, Tabs pro Bereich). Alle übrigen Rollen sehen
  // die bestehende Seite unverändert.
  const { identity } = Route.useRouteContext();
  const { bereich, ansicht, tag } = Route.useSearch();
  const navigate = Route.useNavigate();

  // D5 — Ansichts-Wahl: Ohne Param entscheidet einmalig beim Mount die
  // Bildschirmbreite (<768px → Tag). Kein Live-Umschalten beim Resize.
  const [autoView] = useState<"grid" | "tag">(() => {
    if (typeof window === "undefined") return "grid";
    return window.matchMedia("(max-width: 767px)").matches ? "tag" : "grid";
  });
  const effectiveView = ansicht ?? autoView;

  if (effectiveView === "tag") {
    return (
      <>
        <ViewToggle current="tag" />
        <RosterDayView
          date={tag ?? todayIso()}
          onDateChange={(iso) =>
            void navigate({
              search: (prev: Record<string, unknown>) => ({ ...prev, ansicht: "tag", tag: iso }),
            })
          }
        />
      </>
    );
  }

  if (identity.role === "planer") {
    return (
      <>
        <ViewToggle current="grid" />
        <PlanerRosterView bereich={bereich ?? "kueche"} />
      </>
    );
  }
  return (
    <>
      <ViewToggle current="grid" />
      <AdminManagerDienstplan />
    </>
  );
}

function ViewToggle({ current }: { current: "grid" | "tag" }) {
  const navigate = Route.useNavigate();
  return (
    <div className="mb-2 flex justify-end gap-1">
      <Button
        size="sm"
        variant={current === "grid" ? "default" : "outline"}
        onClick={() =>
          void navigate({
            search: (prev: Record<string, unknown>) => ({ ...prev, ansicht: "grid" }),
          })
        }
      >
        Grid
      </Button>
      <Button
        size="sm"
        variant={current === "tag" ? "default" : "outline"}
        onClick={() =>
          void navigate({
            search: (prev: Record<string, unknown>) => ({ ...prev, ansicht: "tag" }),
          })
        }
      >
        Tag
      </Button>
    </div>
  );
}

function AdminManagerDienstplan() {
  const today = todayIso();
  const qc = useQueryClient();
  const { identity } = Route.useRouteContext();
  const canOpenStaff = identity.role === "admin" || identity.role === "payroll";
  const currentHref = useRouterState({ select: (s) => s.location.href });

  const periodsQ = useQuery({ queryKey: ["periods"], queryFn: () => listPeriods() });
  const locationsQ = useQuery({ queryKey: ["locations"], queryFn: () => listLocations() });
  const skillsQ = useQuery({ queryKey: ["skills"], queryFn: () => listSkills() });
  const scopesQ = useQuery({
    queryKey: ["roster-scopes"],
    queryFn: () => getMyRosterScopes(),
  });
  const scopes = useMemo(() => scopesQ.data ?? [], [scopesQ.data]);

  const [periodId, setPeriodId] = useState<string | null>(null);
  // Halb-Offset: false = Periode 1:1, true = Fenster +14 Tage (überlappt
  // in die Folgeperiode). Wird über die einzelnen Pfeile ‹/› gesteuert.
  const [halfOffset, setHalfOffset] = useState(false);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeArea, setActiveArea] = useState<GridArea>("kitchen");
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [paintEnabled, setPaintEnabled] = useState(false);
  const [paint, setPaint] = useState<PaintSelection>(null);

  const periods = useMemo(
    () => [...(periodsQ.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [periodsQ.data],
  );
  const locations = useMemo(
    () => allowedLocations(locationsQ.data ?? [], scopes),
    [locationsQ.data, scopes],
  );
  const allSkills: RosterSkill[] = useMemo(() => skillsQ.data ?? [], [skillsQ.data]);

  const effectivePeriod = useMemo(() => {
    if (periodId) return periods.find((p) => p.id === periodId) ?? null;
    return periods.find((p) => p.startDate <= today && today <= p.endDate) ?? periods[0] ?? null;
  }, [periods, periodId, today]);
  const effectiveLocationId = locationId ?? locations[0]?.id ?? null;
  const visibleAreas = useMemo<GridArea[]>(() => {
    if (!effectiveLocationId) return ["kitchen", "service"];
    const areas = scopes.filter((s) => s.locationId === effectiveLocationId).map((s) => s.area);
    // Wenn keine Scopes geladen sind (z. B. Admin/Manager via globalem Default),
    // sind beide Bereiche sichtbar.
    if (areas.length === 0) return ["kitchen", "service"];
    return areas;
  }, [scopes, effectiveLocationId]);
  useEffect(() => {
    if (!visibleAreas.includes(activeArea) && visibleAreas[0]) {
      setActiveArea(visibleAreas[0]);
    }
  }, [visibleAreas, activeArea]);
  const canEdit = useMemo(
    () => canEditScope(scopes, effectiveLocationId, activeArea),
    [scopes, effectiveLocationId, activeArea],
  );

  const periodLocked = effectivePeriod?.status === "locked";

  const releaseQ = useQuery({
    queryKey: ["roster-release", effectiveLocationId, effectivePeriod?.id],
    queryFn: () =>
      getRosterRelease({
        data: { locationId: effectiveLocationId!, periodId: effectivePeriod!.id },
      }),
    enabled: !!effectiveLocationId && !!effectivePeriod,
  });
  const kitchenReleased = releaseQ.data?.kitchen ?? false;
  const serviceReleased = releaseQ.data?.service ?? false;

  async function handleToggleArea(area: "kitchen" | "service", currentlyReleased: boolean) {
    if (!canEdit || !effectiveLocationId || !effectivePeriod) return;
    setBusy(true);
    try {
      await setRosterRelease({
        data: {
          locationId: effectiveLocationId,
          periodId: effectivePeriod.id,
          area,
          released: !currentlyReleased,
        },
      });
      qc.setQueryData<{ kitchen: boolean; service: boolean }>(
        ["roster-release", effectiveLocationId, effectivePeriod.id],
        (old) => ({
          kitchen: old?.kitchen ?? false,
          service: old?.service ?? false,
          [area]: !currentlyReleased,
        }),
      );
      await qc.invalidateQueries({ queryKey: ["roster-release"] });
      toast.success(
        currentlyReleased
          ? `Freigabe ${area === "kitchen" ? "Küche" : "Service"} zurückgezogen.`
          : `${area === "kitchen" ? "Küche" : "Service"} freigegeben.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Anzeigefenster = Periode ± 14 Tage je nach Halb-Offset.
  const windowStart = useMemo(() => {
    if (!effectivePeriod) return null;
    return halfOffset
      ? fmtIso(addDays(parseIso(effectivePeriod.startDate), 14))
      : effectivePeriod.startDate;
  }, [effectivePeriod, halfOffset]);
  const windowEnd = useMemo(() => {
    if (!effectivePeriod) return null;
    return halfOffset
      ? fmtIso(addDays(parseIso(effectivePeriod.endDate), 14))
      : effectivePeriod.endDate;
  }, [effectivePeriod, halfOffset]);

  const days = useMemo(
    () => (windowStart && windowEnd ? daysBetween(windowStart, windowEnd) : []),
    [windowStart, windowEnd],
  );

  const staffQ = useQuery({
    queryKey: ["roster-staff", effectiveLocationId],
    queryFn: () => getStaffForRoster({ data: { locationId: effectiveLocationId! } }),
    enabled: !!effectiveLocationId,
  });
  const shiftsQ = useQuery({
    queryKey: ["roster-shifts", effectiveLocationId, windowStart, windowEnd],
    queryFn: () =>
      getRosterShifts({
        data: {
          locationId: effectiveLocationId!,
          fromDate: windowStart!,
          toDate: windowEnd!,
        },
      }),
    enabled: !!effectiveLocationId && !!windowStart && !!windowEnd,
  });
  const crossQ = useQuery({
    queryKey: ["roster-cross-bookings", windowStart, windowEnd],
    queryFn: () =>
      getStaffCrossBookings({
        data: {
          fromDate: windowStart!,
          toDate: windowEnd!,
        },
      }),
    enabled: !!windowStart && !!windowEnd,
  });
  // Σ-Spalte: Cross-Bookings der gesamten Abrechnungsperiode (26.–25.),
  // unabhängig vom sichtbaren Halb-Fenster. Dient nur der Summe/Breakdown.
  const crossMonthQ = useQuery({
    queryKey: ["roster-cross-bookings-month", effectivePeriod?.startDate, effectivePeriod?.endDate],
    queryFn: () =>
      getStaffCrossBookings({
        data: {
          fromDate: effectivePeriod!.startDate,
          toDate: effectivePeriod!.endDate,
        },
      }),
    enabled: !!effectivePeriod,
  });
  const availabilityQ = useQuery({
    queryKey: ["roster-availability", windowStart, windowEnd],
    queryFn: () =>
      getAvailability({
        data: {
          fromDate: windowStart!,
          toDate: windowEnd!,
        },
      }),
    enabled: !!windowStart && !!windowEnd,
  });
  const absenceQ = useQuery({
    queryKey: ["roster-absence", windowStart, windowEnd],
    queryFn: () =>
      getAbsences({
        data: {
          fromDate: windowStart!,
          toDate: windowEnd!,
        },
      }),
    enabled: !!windowStart && !!windowEnd,
  });
  const wishesQ = useQuery({
    queryKey: ["day-off-wishes", windowStart, windowEnd],
    queryFn: () =>
      getDayOffWishes({
        data: {
          fromDate: windowStart!,
          toDate: windowEnd!,
        },
      }),
    enabled: !!windowStart && !!windowEnd,
  });

  // Realtime: jede Änderung an roster_shifts → invalidate (live update).
  useEffect(() => {
    if (!effectiveLocationId) return;
    const channel = supabase
      .channel(`roster-shifts-${effectiveLocationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "roster_shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["roster-shifts"] });
        qc.invalidateQueries({ queryKey: ["roster-cross-bookings"] });
        qc.invalidateQueries({ queryKey: ["roster-cross-bookings-month"] });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "roster_availability" },
        () => {
          qc.invalidateQueries({ queryKey: ["roster-availability"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "roster_absence" }, () => {
        qc.invalidateQueries({ queryKey: ["roster-absence"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "day_off_wishes" }, () => {
        qc.invalidateQueries({ queryKey: ["day-off-wishes"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [effectiveLocationId, qc]);

  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data]);
  const shifts: RosterShift[] = useMemo(() => shiftsQ.data ?? [], [shiftsQ.data]);
  const crossBookings = useMemo(() => crossQ.data ?? [], [crossQ.data]);
  const monthCrossBookings = useMemo(
    () => crossMonthQ.data ?? crossBookings,
    [crossMonthQ.data, crossBookings],
  );

  // SP2 — Fenster-Umschalter oberhalb des Grids. Sichtbar, sobald mehr als
  // ein Planungsfenster für den Standort aktiviert ist (Legacy-Verhalten
  // bleibt für Standorte mit nur „abend" erhalten). Die eigentliche
  // Umschalter-UI mit „Früh" folgt in Commit 2.
  const activeLocationRaw = (locationsQ.data ?? []).find((l) => l.id === effectiveLocationId) as
    | { enabled_service_periods?: string[] | null }
    | undefined;
  const dayServiceEnabled = (activeLocationRaw?.enabled_service_periods ?? []).length > 1;
  const [activePeriod, setActivePeriod] = useState<"mittag" | "abend">("abend");
  useEffect(() => {
    if (!dayServiceEnabled && activePeriod !== "abend") setActivePeriod("abend");
  }, [dayServiceEnabled, activePeriod]);

  const shiftsForGrid: RosterShift[] = useMemo(
    () => (dayServiceEnabled ? shifts.filter((s) => s.servicePeriod === activePeriod) : shifts),
    [shifts, dayServiceEnabled, activePeriod],
  );
  const unavailable = useMemo(() => availabilityQ.data ?? [], [availabilityQ.data]);
  const unavailableSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of unavailable) s.add(`${a.staffId}|${a.date}`);
    return s;
  }, [unavailable]);
  const absences = useMemo(() => absenceQ.data ?? [], [absenceQ.data]);
  const absenceMap = useMemo(() => {
    const m = new Map<string, AbsenceType>();
    for (const a of absences) m.set(`${a.staffId}|${a.date}`, a.type);
    return m;
  }, [absences]);
  const wishMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const w of wishesQ.data ?? []) m.set(`${w.staffId}|${w.wishDate}`, w.note);
    return m;
  }, [wishesQ.data]);
  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of staff) m.set(r.staffId, r.displayName);
    return m;
  }, [staff]);

  // Lock-Map: max. 1 Einteilung pro MA/Tag (standort-/bereichsübergreifend).
  // Speist sich aus crossBookings (Realtime-invalidated).
  const lockMap = useMemo(() => {
    const m = new Map<
      string,
      { locationId: string; locationName: string; area: "kitchen" | "service" | "gl" }
    >();
    for (const b of crossBookings) {
      // SP1: nur Fenster-gleiche Fremdbuchungen blocken den Slot.
      if (dayServiceEnabled && b.servicePeriod !== activePeriod) continue;
      const k = `${b.staffId}|${b.shiftDate}`;
      if (!m.has(k)) {
        m.set(k, { locationId: b.locationId, locationName: b.locationName, area: b.area });
      }
    }
    return m;
  }, [crossBookings, dayServiceEnabled, activePeriod]);

  function warnIfUnavailable(staffId: string, iso: string) {
    if (!unavailableSet.has(`${staffId}|${iso}`)) return;
    const name = staffNameById.get(staffId) ?? "Mitarbeiter";
    toast.message(`Hinweis: ${name} ist an diesem Tag als nicht verfügbar markiert.`);
  }

  // Skill-Filter (Mehrfach, ODER): nur Mitarbeiter zeigen, die mind. einen
  // der gewählten Skills haben. Leere Auswahl = alle.
  const filteredStaff = useMemo(() => {
    if (skillFilter.length === 0) return staff;
    return staff.filter((r) => r.skillIds.some((sid) => skillFilter.includes(sid)));
  }, [staff, skillFilter]);

  // Skill-Pool fürs Paint-Toolbar: passende Kategorien je aktivem Tab.
  const paintSkills = useMemo(() => {
    const allowed =
      activeArea === "service"
        ? new Set<RosterSkill["category"]>(["service", "gl", "other"])
        : new Set<RosterSkill["category"]>(["kitchen"]);
    return allSkills.filter((s) => allowed.has(s.category));
  }, [allSkills, activeArea]);

  // Filter-Chips zeigen ebenfalls nur Skills der aktiven Area-Kategorien.
  const filterSkills = paintSkills;

  async function handleCreate(staffId: string, iso: string, area: GridArea, skillId: string) {
    if (!canEdit || periodLocked || !effectiveLocationId) return;
    const lock = lockMap.get(`${staffId}|${iso}`);
    if (lock) {
      const name = staffNameById.get(staffId) ?? "Mitarbeiter";
      toast.error(`${name} ist bereits in ${lock.locationName} · ${lock.area} eingeteilt.`);
      return;
    }
    setBusy(true);
    try {
      await createRosterShift({
        data: {
          locationId: effectiveLocationId,
          staffId,
          shiftDate: iso,
          area,
          skillId,
          servicePeriod: activePeriod,
        },
      });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
      qc.invalidateQueries({ queryKey: ["roster-cross-bookings"] });
      warnIfUnavailable(staffId, iso);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!canEdit || periodLocked) return;
    setBusy(true);
    try {
      await deleteRosterShift({ data: { id } });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
      qc.invalidateQueries({ queryKey: ["roster-cross-bookings"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeSkill(id: string, skillId: string) {
    if (!canEdit || periodLocked) return;
    setBusy(true);
    try {
      await updateRosterShiftSkill({ data: { id, skillId } });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeStatus(id: string, status: "planned" | "confirmed") {
    if (!canEdit || periodLocked) return;
    setBusy(true);
    try {
      await updateRosterShiftStatus({ data: { id, status } });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // iPad + Apple Pencil: PointerSensor unterdrückt Pen-Klicks via
  // pointerdown.preventDefault(); getrennte Mouse-/Touch-Sensoren umgehen das
  // (Safari emuliert Pencil als Maus).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  async function handleDragEnd(e: DragEndEvent) {
    if (!canEdit || periodLocked) return;
    const { active, over } = e;
    if (!over) return;
    const shift = active.data.current?.shift as RosterShift | undefined;
    const target = over.data.current as
      | { staffId?: string; iso?: string; area?: GridArea }
      | undefined;
    if (!shift || !target?.staffId || !target?.iso || !target?.area) return;
    if (
      shift.staffId === target.staffId &&
      shift.shiftDate === target.iso &&
      shift.area === target.area
    ) {
      return;
    }
    const lock = lockMap.get(`${target.staffId}|${target.iso}`);
    // Eigene Schicht ausschließen (Bereichswechsel desselben Tages bleibt erlaubt).
    if (
      lock &&
      !(
        lock.locationId === shift.locationId &&
        lock.area === shift.area &&
        shift.staffId === target.staffId &&
        shift.shiftDate === target.iso
      )
    ) {
      const name = staffNameById.get(target.staffId) ?? "Mitarbeiter";
      toast.error(`${name} ist bereits in ${lock.locationName} · ${lock.area} eingeteilt.`);
      return;
    }
    setBusy(true);
    try {
      await moveRosterShift({
        data: {
          id: shift.id,
          staffId: target.staffId,
          shiftDate: target.iso,
          area: target.area,
          servicePeriod: shift.servicePeriod,
        },
      });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
      qc.invalidateQueries({ queryKey: ["roster-cross-bookings"] });
      warnIfUnavailable(target.staffId, target.iso);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function togglePaint() {
    setPaintEnabled((v) => {
      const next = !v;
      if (!next) setPaint(null);
      return next;
    });
  }

  async function handleSetUnavailable(staffId: string, iso: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await setUnavailable({ data: { staffId, date: iso } });
      qc.invalidateQueries({ queryKey: ["roster-availability"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearUnavailable(staffId: string, iso: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await clearUnavailable({ data: { staffId, date: iso } });
      qc.invalidateQueries({ queryKey: ["roster-availability"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetAbsenceRange(
    staffId: string,
    fromIso: string,
    toIso: string,
    type: AbsenceType,
  ) {
    if (!canEdit) return;
    setBusy(true);
    try {
      const res = await setAbsenceRange({
        data: { staffId, fromDate: fromIso, toDate: toIso, type },
      });
      qc.invalidateQueries({ queryKey: ["roster-absence"] });
      qc.invalidateQueries({ queryKey: ["roster-shifts"] });
      const label = ABSENCE_LABEL[type];
      const days = res.daysCount;
      const del = res.deletedShiftCount;
      toast.success(
        del > 0
          ? `${label} für ${days} ${days === 1 ? "Tag" : "Tage"} eingetragen — ${del} ${del === 1 ? "Schicht" : "Schichten"} entfernt.`
          : `${label} für ${days} ${days === 1 ? "Tag" : "Tage"} eingetragen.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAbsence(staffId: string, iso: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await clearAbsence({ data: { staffId, date: iso } });
      qc.invalidateQueries({ queryKey: ["roster-absence"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSetWish(staffId: string, iso: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await createDayOffWishFor({ data: { staffId, wishDate: iso } });
      qc.invalidateQueries({ queryKey: ["day-off-wishes"] });
      toast.success("Wunschfrei eingetragen.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearWish(staffId: string, iso: string) {
    if (!canEdit) return;
    setBusy(true);
    try {
      await deleteDayOffWishFor({ data: { staffId, wishDate: iso } });
      qc.invalidateQueries({ queryKey: ["day-off-wishes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <TooltipProvider delayDuration={150}>
        <header>
          <h1 className="text-2xl font-semibold">Dienstplan</h1>
          {(periodLocked || !canEdit) && (
            <p className="text-sm text-muted-foreground">
              {!canEdit ? (
                <span>(Read-only)</span>
              ) : (
                <span className="text-destructive">Periode gesperrt.</span>
              )}
            </p>
          )}
        </header>

        {!effectivePeriod ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Keine Periode angelegt. Lege im Tab „Perioden" eine an.
          </Card>
        ) : !effectiveLocationId ? (
          <Card className="p-6 text-sm text-muted-foreground">Kein Standort verfügbar.</Card>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            {canEdit && !periodLocked && (
              <PaintToolbar
                enabled={paintEnabled}
                onToggle={togglePaint}
                skills={paintSkills}
                active={paintEnabled ? paint : null}
                onChange={setPaint}
              />
            )}
            <SkillFilterChips
              skills={filterSkills}
              selected={skillFilter}
              onChange={setSkillFilter}
            />
            <div className="grid grid-cols-3 items-end gap-3">
              <LocationPills
                locations={locations}
                value={effectiveLocationId ?? ""}
                onChange={setLocationId}
              />
              <div className="flex justify-center">
                <PeriodNav
                  periods={periods}
                  currentPeriodId={effectivePeriod?.id ?? null}
                  halfOffset={halfOffset}
                  hasTodayJump={(() => {
                    const todayPeriod = periods.find(
                      (p) => p.startDate <= today && today <= p.endDate,
                    );
                    if (!todayPeriod) return false;
                    return halfOffset || todayPeriod.id !== effectivePeriod?.id;
                  })()}
                  onToday={() => {
                    const todayPeriod = periods.find(
                      (p) => p.startDate <= today && today <= p.endDate,
                    );
                    if (todayPeriod) setPeriodId(todayPeriod.id);
                    setHalfOffset(false);
                  }}
                  onPrevPeriod={() => {
                    if (!effectivePeriod) return;
                    const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                    if (i > 0) {
                      setPeriodId(periods[i - 1].id);
                      setHalfOffset(false);
                    }
                  }}
                  onNextPeriod={() => {
                    if (!effectivePeriod) return;
                    const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                    if (i >= 0 && i < periods.length - 1) {
                      setPeriodId(periods[i + 1].id);
                      setHalfOffset(false);
                    }
                  }}
                  onPrevHalf={() => {
                    if (!effectivePeriod) return;
                    if (halfOffset) {
                      // Aus 2. Hälfte zurück auf volle Periode.
                      setHalfOffset(false);
                    } else {
                      // Aus voller Periode in 2. Hälfte der Vorperiode.
                      const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                      if (i > 0) {
                        setPeriodId(periods[i - 1].id);
                        setHalfOffset(true);
                      }
                    }
                  }}
                  onNextHalf={() => {
                    if (!effectivePeriod) return;
                    if (halfOffset) {
                      // Aus 2. Hälfte in volle Folgeperiode.
                      const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                      if (i >= 0 && i < periods.length - 1) {
                        setPeriodId(periods[i + 1].id);
                        setHalfOffset(false);
                      }
                    } else {
                      // Aus voller Periode in 2. Hälfte derselben.
                      setHalfOffset(true);
                    }
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-4">
                {activeArea === "kitchen" ? (
                  <AreaReleaseControl
                    label="Küche"
                    released={kitchenReleased}
                    canEdit={canEdit}
                    busy={busy}
                    disabled={!effectivePeriod || !effectiveLocationId}
                    onToggle={() => handleToggleArea("kitchen", kitchenReleased)}
                  />
                ) : (
                  <AreaReleaseControl
                    label="Service"
                    released={serviceReleased}
                    canEdit={canEdit}
                    busy={busy}
                    disabled={!effectivePeriod || !effectiveLocationId}
                    onToggle={() => handleToggleArea("service", serviceReleased)}
                  />
                )}
              </div>
            </div>
            {dayServiceEnabled && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Servicezeit:</span>
                <div
                  role="tablist"
                  aria-label="Servicezeit"
                  className="inline-flex overflow-hidden rounded-md border border-input"
                >
                  {(["mittag", "abend"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={activePeriod === p}
                      onClick={() => setActivePeriod(p)}
                      className={
                        "px-3 py-1 text-xs font-medium " +
                        (activePeriod === p
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-accent")
                      }
                    >
                      {p === "mittag" ? "Mittag" : "Abend"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <RosterGrid
              activeArea={activeArea}
              visibleAreas={visibleAreas}
              onActiveAreaChange={(a) => {
                setActiveArea(a);
                setPaint(null); // Paint-Auswahl zurücksetzen, da Skill-Pool wechselt
                setSkillFilter([]);
              }}
              days={days}
              today={today}
              staff={filteredStaff}
              shifts={shiftsForGrid}
              allSkills={allSkills}
              crossBookings={crossBookings}
              monthCrossBookings={monthCrossBookings}
              viewportServicePeriod={dayServiceEnabled ? activePeriod : "abend"}
              lockMap={lockMap}
              unavailableSet={unavailableSet}
              absenceMap={absenceMap}
              wishMap={wishMap}
              canEdit={canEdit}
              locked={!!periodLocked}
              paint={paintEnabled ? paint : null}
              busy={busy}
              onCreate={handleCreate}
              onDelete={handleDelete}
              onChangeSkill={handleChangeSkill}
              onChangeStatus={handleChangeStatus}
              onSetUnavailable={handleSetUnavailable}
              onClearUnavailable={handleClearUnavailable}
              onSetAbsenceRange={handleSetAbsenceRange}
              onClearAbsence={handleClearAbsence}
              onSetWish={handleSetWish}
              onClearWish={handleClearWish}
              renderStaffName={
                canOpenStaff
                  ? (row) => (
                      <Link
                        to="/admin/staff/$staffId"
                        params={{ staffId: row.staffId }}
                        search={{ from: currentHref }}
                        className="hover:underline"
                      >
                        {row.displayName}
                      </Link>
                    )
                  : undefined
              }
            />
          </DndContext>
        )}
      </TooltipProvider>
    </div>
  );
}

function AreaReleaseControl({
  label,
  released,
  canEdit,
  busy,
  disabled,
  onToggle,
}: {
  label: string;
  released: boolean;
  canEdit: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {released && (
        <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          ✓ freigegeben
        </span>
      )}
      {canEdit && (
        <Button
          type="button"
          size="sm"
          variant={released ? "outline" : "default"}
          disabled={busy || disabled}
          onClick={onToggle}
        >
          {released ? "Freigabe zurückziehen" : "freigeben"}
        </Button>
      )}
    </div>
  );
}
