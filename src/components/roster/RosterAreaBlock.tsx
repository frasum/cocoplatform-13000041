// DP-A1 — Ein-Bereichs-Block (ein Standort × ein Bereich) für die
// Planer-Ansicht. Kapselt die pro-Standort-Queries (staff, shifts, release,
// Realtime) und rendert das bestehende `RosterGrid` mit `visibleAreas=[area]`,
// damit intern nur der eine Tab sichtbar ist. Editierbarkeit kommt als Prop
// aus dem PL1-Helfer `canEditScope`; nicht editierbare Blöcke zeigen ein
// „Nur Lesen"-Badge und deaktivieren alle Schreib-Handler.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { RosterGrid } from "@/components/roster/RosterGrid";
import type { PaintSelection } from "@/components/roster/PaintToolbar";
import {
  createRosterShift,
  deleteRosterShift,
  getRosterRelease,
  getRosterShifts,
  getStaffForRoster,
  moveRosterShift,
  setRosterRelease,
  updateRosterShiftSkill,
  updateRosterShiftStatus,
  setUnavailable,
  clearUnavailable,
  setAbsenceRange,
  clearAbsence,
  createDayOffWishFor,
  deleteDayOffWishFor,
  type RosterShift,
  type RosterSkill,
  type RosterCrossBooking,
} from "@/lib/roster/roster.functions";
import type { ServicePeriod } from "@/lib/roster/cross-booking";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/roster/absence-types";

type GridArea = "kitchen" | "service";

type Props = {
  locationId: string;
  locationName: string;
  area: GridArea;
  period: { id: string; startDate: string; endDate: string; status?: string } | null;
  windowStart: string;
  windowEnd: string;
  days: string[];
  today: string;
  canEdit: boolean;
  paint: PaintSelection;
  paintEnabled: boolean;
  skillFilter: string[];
  allSkills: RosterSkill[];
  crossBookings: RosterCrossBooking[];
  unavailableSet: Set<string>;
  absenceMap: Map<string, AbsenceType>;
  wishMap: Map<string, string | null>;
  /** SP1 — Standort hat Tagesbetrieb aktiv. Nur dann wird der Mittag/Abend-Umschalter angezeigt. */
  dayServiceEnabled?: boolean;
};

export function RosterAreaBlock({
  locationId,
  locationName,
  area,
  period,
  windowStart,
  windowEnd,
  days,
  today,
  canEdit,
  paint,
  paintEnabled,
  skillFilter,
  allSkills,
  crossBookings,
  unavailableSet,
  absenceMap,
  wishMap,
  dayServiceEnabled,
}: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const periodLocked = period?.status === "locked";
  const [activePeriod, setActivePeriod] = useState<ServicePeriod>("abend");
  const windowOn = dayServiceEnabled === true;

  const staffQ = useQuery({
    queryKey: ["roster-staff", locationId],
    queryFn: () => getStaffForRoster({ data: { locationId } }),
  });
  const shiftsQ = useQuery({
    queryKey: ["roster-shifts", locationId, windowStart, windowEnd],
    queryFn: () =>
      getRosterShifts({
        data: { locationId, fromDate: windowStart, toDate: windowEnd },
      }),
    enabled: !!windowStart && !!windowEnd,
  });
  const releaseQ = useQuery({
    queryKey: ["roster-release", locationId, period?.id],
    queryFn: () => getRosterRelease({ data: { locationId, periodId: period!.id } }),
    enabled: !!period,
  });
  const released = area === "kitchen" ? releaseQ.data?.kitchen : releaseQ.data?.service;

  // Realtime: Änderungen an roster_shifts dieses Standorts → invalidate.
  useEffect(() => {
    const channel = supabase
      .channel(`roster-shifts-${locationId}-${area}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "roster_shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["roster-shifts"] });
        qc.invalidateQueries({ queryKey: ["roster-cross-bookings"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [locationId, area, qc]);

  const staff = useMemo(() => staffQ.data ?? [], [staffQ.data]);
  const shifts: RosterShift[] = useMemo(() => shiftsQ.data ?? [], [shiftsQ.data]);
  // SP1 — bei Tagesbetrieb nur Schichten des aktiven Fensters ins Grid geben.
  const shiftsForGrid: RosterShift[] = useMemo(
    () => (windowOn ? shifts.filter((s) => s.servicePeriod === activePeriod) : shifts),
    [shifts, windowOn, activePeriod],
  );
  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of staff) m.set(r.staffId, r.displayName);
    return m;
  }, [staff]);

  // Lock-Map: alle Cross-Bookings (organisationsweit) — verhindert
  // Doppelbelegungen im gleichen Fenster auch über Standorte/Bereiche hinweg.
  // SP1: Cross-Bookings in anderem Fenster blockieren nicht (Doppelschicht ok).
  const lockMap = useMemo(() => {
    const m = new Map<
      string,
      { locationId: string; locationName: string; area: "kitchen" | "service" | "gl" }
    >();
    for (const b of crossBookings) {
      if (b.servicePeriod !== activePeriod) continue;
      const k = `${b.staffId}|${b.shiftDate}`;
      if (!m.has(k)) {
        m.set(k, { locationId: b.locationId, locationName: b.locationName, area: b.area });
      }
    }
    return m;
  }, [crossBookings, activePeriod]);

  const filteredStaff = useMemo(() => {
    if (skillFilter.length === 0) return staff;
    return staff.filter((r) => r.skillIds.some((sid) => skillFilter.includes(sid)));
  }, [staff, skillFilter]);

  function warnIfUnavailable(staffId: string, iso: string) {
    if (!unavailableSet.has(`${staffId}|${iso}`)) return;
    const name = staffNameById.get(staffId) ?? "Mitarbeiter";
    toast.message(`Hinweis: ${name} ist an diesem Tag als nicht verfügbar markiert.`);
  }

  async function handleCreate(staffId: string, iso: string, a: GridArea, skillId: string) {
    if (!canEdit || periodLocked) return;
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
          locationId,
          staffId,
          shiftDate: iso,
          area: a,
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
      const daysCount = res.daysCount;
      const del = res.deletedShiftCount;
      toast.success(
        del > 0
          ? `${label} für ${daysCount} ${daysCount === 1 ? "Tag" : "Tage"} eingetragen — ${del} ${del === 1 ? "Schicht" : "Schichten"} entfernt.`
          : `${label} für ${daysCount} ${daysCount === 1 ? "Tag" : "Tage"} eingetragen.`,
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

  async function handleToggleRelease() {
    if (!canEdit || !period) return;
    const cur = !!released;
    setBusy(true);
    try {
      await setRosterRelease({
        data: { locationId, periodId: period.id, area, released: !cur },
      });
      await qc.invalidateQueries({ queryKey: ["roster-release"] });
      toast.success(cur ? "Freigabe zurückgezogen." : "Freigegeben.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // iPad + Apple Pencil: `PointerSensor` ruft auf pointerdown `preventDefault()`
  // auf und unterdrückt damit den nachfolgenden Klick bei pointerType="pen"
  // (Safari liefert Pen-Klicks nicht als synthetischen Mouse-Click nach).
  // Getrennte Mouse-/Touch-Sensoren: Safari emuliert Pencil als Maus → Klick
  // und Drag funktionieren, Finger nutzt Touch mit Delay/Toleranz gegen
  // versehentliche Drags beim Scrollen.
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

  // Nur-Lesen-Blöcke: keine Schreib-Handler → No-ops, damit Paint/Klicks ins
  // Leere laufen. Server-Durchsetzung (PL1) bleibt die eigentliche Sicherung.
  const ro = !canEdit;
  const noopA = async () => {};
  return (
    <section
      className={ro ? "cursor-not-allowed opacity-95" : undefined}
      aria-label={`${locationName} · ${area === "kitchen" ? "Küche" : "Service"}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{locationName}</h2>
          {ro && (
            <Badge variant="secondary" className="text-[10px]">
              Nur Lesen
            </Badge>
          )}
          {periodLocked && (
            <Badge variant="destructive" className="text-[10px]">
              Periode gesperrt
            </Badge>
          )}
          {windowOn && (
            <div
              role="tablist"
              aria-label="Servicezeit"
              className="ml-2 inline-flex overflow-hidden rounded-md border border-input"
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
          )}
        </div>
        {canEdit && period && (
          <div className="flex items-center gap-2">
            {released && (
              <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                ✓ freigegeben
              </span>
            )}
            <Button
              type="button"
              size="sm"
              variant={released ? "outline" : "default"}
              disabled={busy}
              onClick={handleToggleRelease}
            >
              {released ? "Freigabe zurückziehen" : "freigeben"}
            </Button>
          </div>
        )}
      </div>
      <Card className={ro ? "pointer-events-none" : undefined}>
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <RosterGrid
            activeArea={area}
            onActiveAreaChange={() => {}}
            visibleAreas={[area]}
            days={days}
            today={today}
            staff={filteredStaff}
            shifts={shiftsForGrid}
            allSkills={allSkills}
            crossBookings={crossBookings}
            viewportServicePeriod={windowOn ? activePeriod : "abend"}
            lockMap={lockMap}
            unavailableSet={unavailableSet}
            absenceMap={absenceMap}
            wishMap={wishMap}
            canEdit={canEdit}
            locked={!!periodLocked}
            paint={canEdit && paintEnabled ? paint : null}
            busy={busy}
            onCreate={ro ? noopA : handleCreate}
            onDelete={ro ? noopA : handleDelete}
            onChangeSkill={ro ? noopA : handleChangeSkill}
            onChangeStatus={ro ? noopA : handleChangeStatus}
            onSetUnavailable={ro ? noopA : handleSetUnavailable}
            onClearUnavailable={ro ? noopA : handleClearUnavailable}
            onSetAbsenceRange={ro ? noopA : handleSetAbsenceRange}
            onClearAbsence={ro ? noopA : handleClearAbsence}
            onSetWish={ro ? noopA : handleSetWish}
            onClearWish={ro ? noopA : handleClearWish}
          />
        </DndContext>
      </Card>
    </section>
  );
}
