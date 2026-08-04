// Roster-Grid mit Tabs (Küche/Service), Header-Zählungen, Σ-Spalte
// mit Cross-Restaurant-Tooltip, Drag-&-Drop-Drop-Zellen und
// Paint-Mode-Klicklogik. Service-Schichten nutzen service-marker.ts.
import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  ChefHat,
  UtensilsCrossed,
  Umbrella,
  HeartPulse,
  Cake,
  Heart,
  Sun,
  Moon,
  Sunrise,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { parseIso } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ShiftPill } from "./ShiftPill";
import { CellQuickPopover } from "./CellQuickPopover";
import { PillConfirmPopover } from "./PillConfirmPopover";
import type { PaintSelection } from "./PaintToolbar";
import { getHolidayName } from "@/lib/roster/holidays-display";
import type {
  RosterShift,
  RosterSkill,
  RosterStaffRow,
  RosterCrossBooking,
} from "@/lib/roster/roster.functions";

const FIT_ROW_HEIGHT = 32;
const FIT_LAYOUT = {
  staffColPx: 96,
  dayMinPx: 0,
  tableFixed: true,
  horizontalScroll: false,
};

type GridArea = "kitchen" | "service";

const AREA_LABEL: Record<GridArea, string> = { kitchen: "Küche", service: "Service" };
const AREA_SHORT: Record<"kitchen" | "service" | "gl", string> = {
  kitchen: "Küche",
  service: "Service",
  gl: "Service",
};

function isWeekendIso(iso: string): boolean {
  const dow = parseIso(iso).getUTCDay();
  return dow === 0 || dow === 6;
}
function dayHeader(iso: string): { dow: string; dm: string } {
  const d = parseIso(iso);
  const dows = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return {
    dow: dows[d.getUTCDay()],
    dm: `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`,
  };
}

import { skillsForCell } from "./skills-for-cell";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/roster/absence-types";

type Props = {
  activeArea: GridArea;
  onActiveAreaChange: (a: GridArea) => void;
  visibleAreas?: GridArea[];
  days: string[];
  today: string;
  staff: RosterStaffRow[];
  shifts: RosterShift[];
  allSkills: RosterSkill[];
  crossBookings: RosterCrossBooking[];
  /**
   * Cross-Bookings über die gesamte Abrechnungsperiode (26.–25.), unabhängig
   * vom sichtbaren Halb-Fenster. Basis für die Σ-Spalte + Breakdown-Popover.
   * Fällt auf `crossBookings` zurück, falls nicht angegeben.
   */
  monthCrossBookings?: RosterCrossBooking[];
  lockMap: Map<
    string,
    { locationId: string; locationName: string; area: "kitchen" | "service" | "gl" }
  >;
  unavailableSet: Set<string>;
  absenceMap: Map<string, AbsenceType>;
  wishMap: Map<string, string | null>;
  canEdit: boolean;
  locked: boolean;
  paint: PaintSelection;
  busy: boolean;
  /**
   * SP1 — Aktives Planungsfenster des Grids. Wird für die Farbe der
   * Cross-Booking-Punkte gebraucht: gleicher-Fenster-Buchungen = Konflikt
   * (rot), anderer-Fenster-Buchungen = Info (blau, legitime Doppelschicht).
   * Default `"abend"` — deckt alle Nicht-Tagesbetrieb-Standorte ab.
   */
  viewportServicePeriod?: "frueh" | "mittag" | "abend";
  onCreate: (staffId: string, iso: string, area: GridArea, skillId: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onChangeSkill: (id: string, skillId: string) => Promise<void> | void;
  onChangeStatus: (id: string, status: "planned" | "confirmed") => Promise<void> | void;
  onSetUnavailable: (staffId: string, iso: string) => Promise<void> | void;
  onClearUnavailable: (staffId: string, iso: string) => Promise<void> | void;
  onSetAbsenceRange: (
    staffId: string,
    fromIso: string,
    toIso: string,
    type: AbsenceType,
  ) => Promise<void> | void;
  onClearAbsence: (staffId: string, iso: string) => Promise<void> | void;
  onSetWish: (staffId: string, iso: string) => Promise<void> | void;
  onClearWish: (staffId: string, iso: string) => Promise<void> | void;
  /**
   * Optionaler Render-Slot für den Mitarbeiter-Namen (linke/rechte
   * Sticky-Spalte). Wird u. a. genutzt, um für Admin/Payroll einen
   * Link auf die Stammdaten zu setzen.
   */
  renderStaffName?: (row: RosterStaffRow) => React.ReactNode;
};

export function RosterGrid({
  activeArea,
  onActiveAreaChange,
  visibleAreas,
  days,
  today,
  staff,
  shifts,
  allSkills,
  crossBookings,
  monthCrossBookings,
  lockMap,
  unavailableSet,
  absenceMap,
  wishMap,
  canEdit,
  locked,
  paint,
  busy,
  viewportServicePeriod = "abend",
  onCreate,
  onDelete,
  onChangeSkill,
  onChangeStatus,
  onSetUnavailable,
  onClearUnavailable,
  onSetAbsenceRange,
  onClearAbsence,
  onSetWish,
  onClearWish,
  renderStaffName,
}: Props) {
  const [openCell, setOpenCell] = React.useState<string | null>(null);
  const [openPill, setOpenPill] = React.useState<string | null>(null);

  const editable = canEdit && !locked;

  const visibleStaff = React.useMemo(
    () => staff.filter((r) => r.department === activeArea),
    [staff, activeArea],
  );

  const shiftIndex = React.useMemo(() => {
    const m = new Map<string, RosterShift>();
    for (const s of shifts) m.set(`${s.staffId}|${s.shiftDate}|${s.area}`, s);
    return m;
  }, [shifts]);

  // Alle Schicht-Tage pro Mitarbeiter (über alle Standorte/Areas) — Basis für die
  // Vorab-Anzeige im Abwesenheits-Zeitraum-Formular.
  const shiftDatesByStaff = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of crossBookings) {
      const arr = m.get(b.staffId) ?? [];
      arr.push(b.shiftDate);
      m.set(b.staffId, arr);
    }
    return m;
  }, [crossBookings]);

  // Tages-Zählung pro (iso, area=activeArea).
  const dayCount = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts) {
      const a: GridArea = s.area === "kitchen" ? "kitchen" : "service";
      if (a !== activeArea) continue;
      m.set(s.shiftDate, (m.get(s.shiftDate) ?? 0) + 1);
    }
    return m;
  }, [shifts, activeArea]);

  // Monats-Σ pro Mitarbeiter (über alle Standorte/Bereiche via crossBookings).
  const monthSum = React.useMemo(() => {
    const m = new Map<string, number>();
    const src = monthCrossBookings ?? crossBookings;
    for (const b of src) m.set(b.staffId, (m.get(b.staffId) ?? 0) + 1);
    return m;
  }, [monthCrossBookings, crossBookings]);

  const monthBreakdown = React.useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    const src = monthCrossBookings ?? crossBookings;
    for (const b of src) {
      const inner = m.get(b.staffId) ?? new Map<string, number>();
      const k = `${b.locationName} · ${AREA_SHORT[b.area]}`;
      inner.set(k, (inner.get(k) ?? 0) + 1);
      m.set(b.staffId, inner);
    }
    return m;
  }, [monthCrossBookings, crossBookings]);

  // Cross-Booking-Index für Markierungen in leeren Zellen.
  const otherByStaffDate = React.useMemo(() => {
    const m = new Map<string, RosterCrossBooking[]>();
    for (const b of crossBookings) {
      const k = `${b.staffId}|${b.shiftDate}`;
      const arr = m.get(k) ?? [];
      arr.push(b);
      m.set(k, arr);
    }
    return m;
  }, [crossBookings]);

  // SP1b — Gegenfenster-Marker (Sonne/Mond) auf bereits besetzten Zellen.
  // Zeigt an, dass dieselbe Person am selben Tag im JEWEILS ANDEREN
  // Fenster (gleicher oder anderer Standort) eine Schicht hat. Für die
  // aktive Zelle im aktiven Fenster wird nur nach Buchungen im anderen
  // Fenster gefiltert. Der rote Konflikt-Punkt (gleiches Fenster
  // woanders) bleibt separat und hat weiter Vorrang.
  const otherPeriodByStaffDate = React.useMemo(() => {
    const m = new Map<string, RosterCrossBooking[]>();
    for (const b of crossBookings) {
      if (b.servicePeriod === viewportServicePeriod) continue;
      const k = `${b.staffId}|${b.shiftDate}`;
      const arr = m.get(k) ?? [];
      arr.push(b);
      m.set(k, arr);
    }
    return m;
  }, [crossBookings, viewportServicePeriod]);

  const totalArea = React.useMemo(() => {
    let n = 0;
    for (const v of dayCount.values()) n += v;
    return n;
  }, [dayCount]);

  const rowH = FIT_ROW_HEIGHT;
  const layout = FIT_LAYOUT;
  const isFit = true;

  async function handleEmptyCellClick(row: RosterStaffRow, iso: string) {
    if (!editable) return;
    if (paint?.kind === "skill") {
      await onCreate(row.staffId, iso, activeArea, paint.skillId);
      return;
    }
    // Eraser auf leerer Zelle: nichts tun.
    if (paint?.kind === "eraser") return;
    setOpenCell(`${row.staffId}|${iso}`);
  }

  async function handlePillClick(shift: RosterShift) {
    if (!editable) return;
    if (paint?.kind === "eraser") {
      await onDelete(shift.id);
      return;
    }
    if (paint?.kind === "skill") {
      if (shift.skillId !== paint.skillId) await onChangeSkill(shift.id, paint.skillId);
      return;
    }
    setOpenPill(shift.id);
  }

  return (
    <div className="space-y-2">
      <Tabs value={activeArea} onValueChange={(v) => onActiveAreaChange(v as GridArea)}>
        <TabsList>
          {(!visibleAreas || visibleAreas.includes("kitchen")) && (
            <TabsTrigger value="kitchen" className="gap-2">
              <ChefHat className="h-3.5 w-3.5" /> Küche
            </TabsTrigger>
          )}
          {(!visibleAreas || visibleAreas.includes("service")) && (
            <TabsTrigger value="service" className="gap-2">
              <UtensilsCrossed className="h-3.5 w-3.5" /> Service
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <Card className={cn(layout.horizontalScroll ? "overflow-x-auto" : "overflow-x-visible")}>
        <table
          className={cn("w-full border-collapse", isFit ? "table-fixed text-[10px]" : "text-xs")}
        >
          <colgroup>
            <col style={{ width: `${layout.staffColPx}px` }} />
            {days.map((iso) => (
              <col
                key={iso}
                style={layout.dayMinPx > 0 ? { width: `${layout.dayMinPx}px` } : undefined}
              />
            ))}
            <col style={{ width: `${layout.staffColPx}px` }} />
            <col style={{ width: isFit ? "32px" : "48px" }} />
          </colgroup>
          <thead>
            <tr className="border-b bg-muted/50">
              <th
                className={cn(
                  "sticky left-0 z-10 bg-muted/50 text-center font-medium",
                  isFit ? "px-2 py-1" : "px-3 py-2",
                )}
              >
                Mitarbeiter
              </th>
              {days.map((iso) => {
                const we = isWeekendIso(iso);
                const isToday = iso === today;
                const cnt = dayCount.get(iso) ?? 0;
                const { dow, dm } = dayHeader(iso);
                const holiday = getHolidayName(iso);
                return (
                  <th
                    key={iso}
                    className={cn(
                      "text-center font-medium",
                      isFit ? "px-0.5 py-1" : "px-1 py-1.5",
                      we && "bg-muted-foreground/25 text-foreground",
                      holiday && "bg-amber-100/60 text-foreground",
                      isToday && "bg-yellow-200/70 ring-2 ring-yellow-400 ring-inset",
                    )}
                    title={holiday ?? undefined}
                  >
                    <div className="flex flex-col items-center leading-tight">
                      <span className={cn("uppercase", isFit ? "text-[9px]" : "text-[10px]")}>
                        {dow}
                      </span>
                      <span className={cn(isFit && "text-[10px]")}>{dm}</span>
                      {holiday && !isFit && (
                        <span
                          className="max-w-full truncate text-[9px] font-medium text-amber-800"
                          title={holiday}
                        >
                          {holiday}
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          isFit ? "text-[9px]" : "mt-0.5 text-[10px]",
                          cnt === 0
                            ? "text-muted-foreground/40"
                            : cnt < 5
                              ? "text-red-600"
                              : cnt > 5
                                ? "text-green-600"
                                : "text-foreground",
                        )}
                      >
                        {cnt > 0 ? cnt : "·"}
                      </span>
                    </div>
                  </th>
                );
              })}
              <th
                className={cn(
                  "sticky z-10 border-l bg-muted/50 text-center font-medium",
                  isFit ? "px-2 py-1" : "px-3 py-2",
                )}
                style={{ right: isFit ? 32 : 48 }}
              >
                Mitarbeiter
              </th>
              <th
                className={cn(
                  "sticky right-0 z-10 border-l bg-muted text-center font-mono uppercase text-muted-foreground",
                  isFit ? "px-0.5 py-1 text-[9px]" : "px-1 py-1.5 text-[10px]",
                )}
              >
                <div className="flex flex-col items-center">
                  <span>Σ</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {totalArea}
                  </span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.length === 0 ? (
              <tr>
                <td
                  colSpan={days.length + 3}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Keine Mitarbeiter im Bereich {AREA_LABEL[activeArea]}.
                </td>
              </tr>
            ) : (
              visibleStaff.map((row) => {
                const sum = monthSum.get(row.staffId) ?? 0;
                const breakdown = monthBreakdown.get(row.staffId);
                return (
                  <tr
                    key={`${activeArea}-${row.staffId}`}
                    className="group/row border-b last:border-b-0 even:bg-muted-foreground/15 hover:bg-muted/30"
                    style={{ height: rowH }}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 bg-background text-center font-medium group-even/row:bg-muted-foreground/15",
                        isFit ? "truncate px-2 py-0.5 text-[11px]" : "px-3 py-1",
                      )}
                    >
                      {renderStaffName ? renderStaffName(row) : row.displayName}
                    </td>
                    {days.map((iso) => {
                      const shift = shiftIndex.get(`${row.staffId}|${iso}|${activeArea}`);
                      const we = isWeekendIso(iso);
                      const isToday = iso === today;
                      const others = !shift
                        ? (otherByStaffDate.get(`${row.staffId}|${iso}`) ?? [])
                        : [];
                      const pickedSkills = skillsForCell(row, activeArea, allSkills);
                      const candidates = [...pickedSkills.profile, ...pickedSkills.other];
                      const isUnavailable = unavailableSet.has(`${row.staffId}|${iso}`);
                      const absenceType = absenceMap.get(`${row.staffId}|${iso}`) ?? null;
                      const isAbsent = absenceType !== null;
                      const wishKey = `${row.staffId}|${iso}`;
                      const hasWish = wishMap.has(wishKey);
                      const wishNote = hasWish ? (wishMap.get(wishKey) ?? null) : null;
                      const lockEntry = !shift
                        ? (lockMap.get(`${row.staffId}|${iso}`) ?? null)
                        : null;
                      const isLocked = lockEntry !== null;
                      const isBirthday =
                        row.birthdayMonthDay != null && row.birthdayMonthDay === iso.slice(5, 10);
                      // SP1b — Marker für Doppelschicht im Gegenfenster
                      // nur auf besetzten Zellen; leere Zellen behalten den
                      // vorhandenen blauen Punkt (Info) / roten Punkt (Konflikt).
                      const otherPeriod = shift
                        ? (otherPeriodByStaffDate.get(`${row.staffId}|${iso}`) ?? [])
                        : [];
                      return (
                        <DropCell
                          key={iso}
                          staffId={row.staffId}
                          iso={iso}
                          area={activeArea}
                          editable={editable}
                          weekend={we}
                          today={isToday}
                          paintKind={paint?.kind ?? null}
                          unavailable={isUnavailable}
                          hasShift={!!shift}
                          absent={isAbsent}
                          absenceType={absenceType}
                          birthday={isBirthday}
                          birthdayLabel={isBirthday ? `Geburtstag: ${row.displayName}` : null}
                          hasWish={hasWish}
                          wishNote={wishNote}
                          locked={isLocked}
                          lockLabel={
                            lockEntry
                              ? `Bereits in ${lockEntry.locationName} · ${AREA_SHORT[lockEntry.area]} eingeteilt`
                              : null
                          }
                          otherPeriod={otherPeriod}
                        >
                          {shift ? (
                            <PillConfirmPopover
                              open={openPill === shift.id}
                              onOpenChange={(o) => setOpenPill(o ? shift.id : null)}
                              shift={shift}
                              candidates={candidates}
                              busy={busy}
                              isUnavailable={isUnavailable}
                              canEdit={editable}
                              onChangeSkill={async (sid) => {
                                await onChangeSkill(shift.id, sid);
                                setOpenPill(null);
                              }}
                              onChangeStatus={async (st) => {
                                await onChangeStatus(shift.id, st);
                                setOpenPill(null);
                              }}
                              onDelete={async () => {
                                await onDelete(shift.id);
                                setOpenPill(null);
                              }}
                              onSetUnavailable={async () => {
                                await onSetUnavailable(shift.staffId, shift.shiftDate);
                                setOpenPill(null);
                              }}
                              onClearUnavailable={async () => {
                                await onClearUnavailable(shift.staffId, shift.shiftDate);
                                setOpenPill(null);
                              }}
                              absenceType={absenceType}
                              onSetAbsenceRange={async (from, to, t) => {
                                await onSetAbsenceRange(shift.staffId, from, to, t);
                                setOpenPill(null);
                              }}
                              onClearAbsence={async () => {
                                await onClearAbsence(shift.staffId, shift.shiftDate);
                                setOpenPill(null);
                              }}
                              staffShiftDates={shiftDatesByStaff.get(shift.staffId) ?? []}
                            >
                              <span className="block">
                                <ShiftPill
                                  shift={shift}
                                  area={activeArea}
                                  draggable={editable}
                                  onClick={() => void handlePillClick(shift)}
                                />
                              </span>
                            </PillConfirmPopover>
                          ) : (
                            <EmptyCell
                              row={row}
                              iso={iso}
                              activeArea={activeArea}
                              allSkills={allSkills}
                              editable={editable && !isLocked}
                              busy={busy}
                              paintActive={paint !== null}
                              open={openCell === `${row.staffId}|${iso}`}
                              onOpenChange={(o) => setOpenCell(o ? `${row.staffId}|${iso}` : null)}
                              onPick={async (skillId) => {
                                await onCreate(row.staffId, iso, activeArea, skillId);
                                setOpenCell(null);
                              }}
                              onCellClick={() => void handleEmptyCellClick(row, iso)}
                              others={others}
                              viewportServicePeriod={viewportServicePeriod}
                              isUnavailable={isUnavailable}
                              onSetUnavailable={async () => {
                                await onSetUnavailable(row.staffId, iso);
                                setOpenCell(null);
                              }}
                              onClearUnavailable={async () => {
                                await onClearUnavailable(row.staffId, iso);
                                setOpenCell(null);
                              }}
                              absenceType={absenceType}
                              onSetAbsenceRange={async (from, to, t) => {
                                await onSetAbsenceRange(row.staffId, from, to, t);
                                setOpenCell(null);
                              }}
                              onClearAbsence={async () => {
                                await onClearAbsence(row.staffId, iso);
                                setOpenCell(null);
                              }}
                              hasWish={hasWish}
                              onSetWish={async () => {
                                await onSetWish(row.staffId, iso);
                                setOpenCell(null);
                              }}
                              onClearWish={async () => {
                                await onClearWish(row.staffId, iso);
                                setOpenCell(null);
                              }}
                              defaultDate={iso}
                              staffShiftDates={shiftDatesByStaff.get(row.staffId) ?? []}
                            />
                          )}
                        </DropCell>
                      );
                    })}
                    <td
                      className={cn(
                        "sticky z-10 border-l bg-background text-center font-medium group-even/row:bg-muted-foreground/15",
                        isFit ? "truncate px-2 py-0.5 text-[11px]" : "px-3 py-1",
                      )}
                      style={{ right: isFit ? 32 : 48 }}
                    >
                      {renderStaffName ? renderStaffName(row) : row.displayName}
                    </td>
                    <td className="sticky right-0 z-10 border-l bg-muted px-1 py-1 text-center font-mono text-xs tabular-nums group-even/row:bg-muted-foreground/20">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-block min-w-[1.5rem]",
                              sum > 0 ? "text-foreground" : "text-muted-foreground/40",
                            )}
                          >
                            {sum > 0 ? sum : "·"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {breakdown && breakdown.size > 0 ? (
                            <div className="space-y-0.5 text-xs">
                              {[...breakdown.entries()].map(([k, v]) => (
                                <div key={k}>
                                  {v}× {k}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs">Keine Schichten in dieser Periode.</span>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function DropCell({
  staffId,
  iso,
  area,
  editable,
  weekend,
  today,
  paintKind,
  unavailable,
  hasShift,
  absent,
  absenceType,
  birthday,
  birthdayLabel,
  hasWish,
  wishNote,
  locked,
  lockLabel,
  otherPeriod,
  children,
}: {
  staffId: string;
  iso: string;
  area: GridArea;
  editable: boolean;
  weekend: boolean;
  today: boolean;
  paintKind: "skill" | "eraser" | null;
  unavailable: boolean;
  hasShift: boolean;
  absent: boolean;
  absenceType: AbsenceType | null;
  birthday: boolean;
  birthdayLabel: string | null;
  hasWish: boolean;
  wishNote: string | null;
  locked: boolean;
  lockLabel: string | null;
  otherPeriod?: RosterCrossBooking[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${staffId}:${iso}:${area}`,
    data: { staffId, iso, area },
    disabled: !editable || locked,
  });
  const cursor =
    paintKind === "skill" ? "cursor-crosshair" : paintKind === "eraser" ? "cursor-not-allowed" : "";
  // Urlaub hat Vorrang vor der grauen Unavailable-Box, wenn beides leer ist.
  // Nicht-verfügbar wird als dezente, gefüllte graue Box dargestellt – aber nur,
  // wenn die Zelle leer ist UND kein Urlaub markiert ist. Pille gewinnt sonst.
  const showUnavailableBox = unavailable && !hasShift && !absent;
  const showAbsenceFull = absent && !hasShift;
  const showAbsenceCorner = absent && hasShift;
  // Hat die Zelle SOWOHL eine Schicht ALS AUCH den Unavailability-Marker, sollen
  // beide Infos lesbar bleiben: gestrichelter Rahmen über der Pille + grauer
  // Punkt unten links (analog zum roten Cross-Booking-Punkt oben rechts).
  const showUnavailableOnShift = unavailable && hasShift;
  const showBirthdayFull = birthday && !hasShift && !absent && !showUnavailableBox;
  const tdInner = (
    <td
      ref={setNodeRef}
      // UB1/E2E — stabile Prüf-Haken: Zelle je Mitarbeiter/Tag plus der
      // Abwesenheitstyp, der die Planung blockt (leer = keine Abwesenheit).
      data-testid={`roster-cell-${staffId}-${iso}`}
      data-absence={absenceType ?? ""}
      className={cn(
        "relative px-0.5 py-1 text-center align-middle",
        weekend && "bg-muted-foreground/15",
        today && "bg-yellow-200/40",
        isOver && editable && "bg-accent/20 ring-1 ring-accent ring-inset",
        editable && cursor,
        locked && "cursor-not-allowed opacity-40",
      )}
    >
      {showUnavailableBox ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 z-0 rounded-md"
          style={{
            backgroundColor: "color-mix(in oklch, var(--muted-foreground) 30%, transparent)",
          }}
        />
      ) : null}
      {showAbsenceFull ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            >
              {absenceType === "krank" ? (
                <HeartPulse className="h-4 w-4 text-red-600" />
              ) : (
                <Umbrella
                  className={cn(
                    "h-4 w-4 text-green-600",
                    absenceType === "urlaub_unbezahlt" && "opacity-50",
                  )}
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{absenceType ? ABSENCE_LABEL[absenceType] : "Urlaub"}</TooltipContent>
        </Tooltip>
      ) : null}
      {showBirthdayFull ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-md bg-pink-500/15"
            >
              <Cake className="h-5 w-5 text-pink-600" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{birthdayLabel ?? "Geburtstag"}</TooltipContent>
        </Tooltip>
      ) : null}
      {children}
      {birthday && hasShift ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0.5 top-0.5 z-30"
            >
              <Cake className="h-3 w-3 text-pink-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{birthdayLabel ?? "Geburtstag"}</TooltipContent>
        </Tooltip>
      ) : null}
      {showAbsenceCorner ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span aria-hidden="true" className="pointer-events-none absolute left-0.5 top-0.5 z-20">
              {absenceType === "krank" ? (
                <HeartPulse className="h-3 w-3 text-red-600" />
              ) : (
                <Umbrella
                  className={cn(
                    "h-3 w-3 text-green-600",
                    absenceType === "urlaub_unbezahlt" && "opacity-50",
                  )}
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{absenceType ? ABSENCE_LABEL[absenceType] : "Urlaub"}</TooltipContent>
        </Tooltip>
      ) : null}
      {hasWish ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0.5 right-0.5 z-30"
            >
              <Heart className="h-3 w-3 fill-purple-600 text-purple-600" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">Wunsch frei</div>
            {wishNote ? <div className="text-xs text-muted-foreground">{wishNote}</div> : null}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {showUnavailableOnShift ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-1 z-20 rounded-md"
            style={{
              outline: "1.5px dashed color-mix(in oklch, var(--muted-foreground) 65%, transparent)",
              outlineOffset: "-1px",
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 left-1 z-20 h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: "color-mix(in oklch, var(--muted-foreground) 75%, transparent)",
            }}
          />
        </>
      ) : null}
      {hasShift && otherPeriod && otherPeriod.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0.5 top-0.5 z-30 inline-flex items-center justify-center text-amber-500"
            >
              {otherPeriod[0].servicePeriod === "frueh" ? (
                <Sunrise className="h-3 w-3 text-orange-400" />
              ) : otherPeriod[0].servicePeriod === "mittag" ? (
                <Sun className="h-3 w-3" />
              ) : (
                <Moon className="h-3 w-3 text-indigo-400" />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-0.5 text-xs">
              {otherPeriod.map((b, i) => (
                <div key={i}>
                  {b.servicePeriod === "frueh"
                    ? "Früh"
                    : b.servicePeriod === "mittag"
                      ? "Mittag"
                      : "Abend"}
                  : {b.locationName} · {b.area === "kitchen" ? "Küche" : "Service"}
                  {b.skillName ? ` · ${b.skillName}` : ""}
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </td>
  );
  if (locked && lockLabel) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{tdInner}</TooltipTrigger>
        <TooltipContent>{lockLabel}</TooltipContent>
      </Tooltip>
    );
  }
  if (!unavailable) return tdInner;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tdInner}</TooltipTrigger>
      <TooltipContent>
        {hasShift ? "War als nicht verfügbar markiert" : "Nicht verfügbar"}
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyCell({
  row,
  iso,
  activeArea,
  allSkills,
  editable,
  busy,
  paintActive,
  open,
  onOpenChange,
  onPick,
  onCellClick,
  others,
  isUnavailable,
  onSetUnavailable,
  onClearUnavailable,
  absenceType,
  onSetAbsenceRange,
  onClearAbsence,
  defaultDate,
  staffShiftDates,
  hasWish,
  onSetWish,
  onClearWish,
  viewportServicePeriod,
}: {
  row: RosterStaffRow;
  iso: string;
  activeArea: GridArea;
  allSkills: RosterSkill[];
  editable: boolean;
  busy: boolean;
  paintActive: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (skillId: string) => void;
  onCellClick: () => void;
  others: RosterCrossBooking[];
  isUnavailable: boolean;
  onSetUnavailable: () => void;
  onClearUnavailable: () => void;
  absenceType: AbsenceType | null;
  onSetAbsenceRange: (fromIso: string, toIso: string, type: AbsenceType) => void | Promise<void>;
  onClearAbsence: () => void;
  defaultDate: string;
  staffShiftDates: string[];
  hasWish: boolean;
  onSetWish: () => void;
  onClearWish: () => void;
  viewportServicePeriod: "frueh" | "mittag" | "abend";
}) {
  const { profile, other } = skillsForCell(row, activeArea, allSkills);
  const marker = (
    <button
      type="button"
      disabled={!editable}
      onClick={(e) => {
        e.stopPropagation();
        onCellClick();
      }}
      aria-label={`Schicht anlegen: ${row.displayName}, ${iso}`}
      className={cn(
        "mx-auto block h-6 w-full max-w-10 rounded border border-dashed bg-transparent",
        editable ? "border-muted-foreground/30 hover:border-primary" : "border-transparent",
      )}
    />
  );

  const cellInner = (
    <span className="relative block">
      {marker}
      {others.length > 0 &&
        (() => {
          const hasConflict = others.some((b) => b.servicePeriod === viewportServicePeriod);
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "absolute right-0.5 top-0.5 inline-block h-1.5 w-1.5 rounded-full",
                    hasConflict ? "bg-red-500" : "bg-sky-500",
                  )}
                  aria-label={
                    hasConflict
                      ? "Bereits im gleichen Fenster eingeteilt"
                      : "In anderem Fenster eingeteilt (Doppelschicht)"
                  }
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="space-y-0.5 text-xs">
                  {others.map((b, i) => (
                    <div key={i}>
                      {b.servicePeriod === "frueh"
                        ? "Früh"
                        : b.servicePeriod === "mittag"
                          ? "Mittag"
                          : "Abend"}
                      : {b.locationName} · {AREA_SHORT[b.area]}
                      {b.skillName ? ` · ${b.skillName}` : ""}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })()}
    </span>
  );

  if (!editable || paintActive) return cellInner;

  return (
    <CellQuickPopover
      open={open}
      onOpenChange={onOpenChange}
      profileSkills={profile}
      otherSkills={other}
      busy={busy}
      onPick={onPick}
      isUnavailable={isUnavailable}
      onSetUnavailable={onSetUnavailable}
      onClearUnavailable={onClearUnavailable}
      absenceType={absenceType}
      onSetAbsenceRange={onSetAbsenceRange}
      onClearAbsence={onClearAbsence}
      defaultDate={defaultDate}
      staffShiftDates={staffShiftDates}
      staffId={row.staffId}
      hasWish={hasWish}
      onSetWish={onSetWish}
      onClearWish={onClearWish}
    >
      {cellInner}
    </CellQuickPopover>
  );
}
