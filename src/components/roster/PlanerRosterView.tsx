// DP-A1 — Bereichs-Ansicht des Dienstplans für die Rolle `planer`.
// Oben Zyklus-Navigation (26.–25.) und Tabs KÜCHE|SERVICE (URL `?bereich=`).
// Im aktiven Tab werden alle aktiven Standorte gestapelt als eigenständige
// `RosterAreaBlock`s gerendert. Editierbarkeit je Block über PL1-Helfer
// `canEditScope(scopes, locationId, area)`; fremde Bereiche sind read-only
// mit „Nur Lesen"-Badge (Malen/Drag wirkungslos). Sicherheit setzt der
// Server (PL1) durch — dieses Gate ist ausschließlich UX.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChefHat, UtensilsCrossed } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { listLocations } from "@/lib/admin/locations.functions";
import { listPeriods } from "@/lib/time/time-admin.functions";
import {
  getAbsences,
  getAvailability,
  getDayOffWishes,
  getMyRosterScopes,
  getStaffCrossBookings,
  listSkills,
  type RosterSkill,
} from "@/lib/roster/roster.functions";
import { allowedLocations, canEditScope } from "@/lib/roster/scope-util";
import { PaintToolbar, type PaintSelection } from "@/components/roster/PaintToolbar";
import { PeriodNav } from "@/components/roster/PeriodNav";
import { SkillFilterChips } from "@/components/roster/SkillFilterChips";
import { RosterAreaBlock } from "@/components/roster/RosterAreaBlock";
import { parseIso, todayIso } from "@/lib/format";
import { type AbsenceType } from "@/lib/roster/absence-types";

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

type Props = {
  bereich: "kueche" | "service";
};

export function PlanerRosterView({ bereich }: Props) {
  const today = todayIso();
  const navigate = useNavigate();
  const area: GridArea = bereich === "service" ? "service" : "kitchen";

  const periodsQ = useQuery({ queryKey: ["periods"], queryFn: () => listPeriods() });
  const locationsQ = useQuery({ queryKey: ["locations"], queryFn: () => listLocations() });
  const skillsQ = useQuery({ queryKey: ["skills"], queryFn: () => listSkills() });
  const scopesQ = useQuery({
    queryKey: ["roster-scopes"],
    queryFn: () => getMyRosterScopes(),
  });
  const scopes = useMemo(() => scopesQ.data ?? [], [scopesQ.data]);

  const [periodId, setPeriodId] = useState<string | null>(null);
  const [halfOffset, setHalfOffset] = useState(false);
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [paintEnabled, setPaintEnabled] = useState(false);
  const [paint, setPaint] = useState<PaintSelection>(null);

  const periods = useMemo(
    () => [...(periodsQ.data ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [periodsQ.data],
  );
  // Standort-Sichtbarkeit: mindestens ein Bereich planbar → sichtbar (mit
  // Nur-Lesen für den fremden Bereich). Das entspricht den PL1-Vorgaben.
  const locations = useMemo(
    () => allowedLocations(locationsQ.data ?? [], scopes),
    [locationsQ.data, scopes],
  );
  const allSkills: RosterSkill[] = useMemo(() => skillsQ.data ?? [], [skillsQ.data]);

  const effectivePeriod = useMemo(() => {
    if (periodId) return periods.find((p) => p.id === periodId) ?? null;
    return periods.find((p) => p.startDate <= today && today <= p.endDate) ?? periods[0] ?? null;
  }, [periods, periodId, today]);

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

  // Globale (nicht-standortgebundene) Datensätze — einmal geladen, an alle
  // Blöcke gereicht.
  const crossQ = useQuery({
    queryKey: ["roster-cross-bookings", windowStart, windowEnd],
    queryFn: () => getStaffCrossBookings({ data: { fromDate: windowStart!, toDate: windowEnd! } }),
    enabled: !!windowStart && !!windowEnd,
  });
  const availabilityQ = useQuery({
    queryKey: ["roster-availability", windowStart, windowEnd],
    queryFn: () => getAvailability({ data: { fromDate: windowStart!, toDate: windowEnd! } }),
    enabled: !!windowStart && !!windowEnd,
  });
  const absenceQ = useQuery({
    queryKey: ["roster-absence", windowStart, windowEnd],
    queryFn: () => getAbsences({ data: { fromDate: windowStart!, toDate: windowEnd! } }),
    enabled: !!windowStart && !!windowEnd,
  });
  const wishesQ = useQuery({
    queryKey: ["day-off-wishes", windowStart, windowEnd],
    queryFn: () => getDayOffWishes({ data: { fromDate: windowStart!, toDate: windowEnd! } }),
    enabled: !!windowStart && !!windowEnd,
  });

  const crossBookings = useMemo(() => crossQ.data ?? [], [crossQ.data]);
  const unavailableSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of availabilityQ.data ?? []) s.add(`${a.staffId}|${a.date}`);
    return s;
  }, [availabilityQ.data]);
  const absenceMap = useMemo(() => {
    const m = new Map<string, AbsenceType>();
    for (const a of absenceQ.data ?? []) m.set(`${a.staffId}|${a.date}`, a.type);
    return m;
  }, [absenceQ.data]);
  const wishMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const w of wishesQ.data ?? []) m.set(`${w.staffId}|${w.wishDate}`, w.note);
    return m;
  }, [wishesQ.data]);

  const paintSkills = useMemo(() => {
    const allowed =
      area === "service"
        ? new Set<RosterSkill["category"]>(["service", "gl", "other"])
        : new Set<RosterSkill["category"]>(["kitchen"]);
    return allSkills.filter((s) => allowed.has(s.category));
  }, [allSkills, area]);

  function switchArea(next: "kueche" | "service") {
    if (next === bereich) return;
    setPaint(null);
    setSkillFilter([]);
    void navigate({
      to: "/admin/dienstplan",
      search: (prev: Record<string, unknown>) => ({ ...prev, bereich: next }),
    });
  }

  // Mindestens ein Standort muss in diesem Bereich editierbar sein, damit die
  // Paint-Toolbar überhaupt Sinn ergibt.
  const anyEditable = useMemo(
    () => locations.some((l) => canEditScope(scopes, l.id, area)),
    [locations, scopes, area],
  );

  return (
    <div className="space-y-4">
      <TooltipProvider delayDuration={150}>
        <header>
          <h1 className="text-2xl font-semibold">Dienstplan</h1>
        </header>

        {!effectivePeriod ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Keine Periode angelegt. Lege im Tab „Perioden" eine an.
          </Card>
        ) : locations.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Kein Standort verfügbar.</Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Tabs value={bereich} onValueChange={(v) => switchArea(v as "kueche" | "service")}>
                <TabsList>
                  <TabsTrigger value="kueche" className="gap-2">
                    <ChefHat className="h-3.5 w-3.5" /> Küche
                  </TabsTrigger>
                  <TabsTrigger value="service" className="gap-2">
                    <UtensilsCrossed className="h-3.5 w-3.5" /> Service
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <PeriodNav
                periods={periods}
                currentPeriodId={effectivePeriod.id}
                halfOffset={halfOffset}
                hasTodayJump={(() => {
                  const tp = periods.find((p) => p.startDate <= today && today <= p.endDate);
                  if (!tp) return false;
                  return halfOffset || tp.id !== effectivePeriod.id;
                })()}
                onToday={() => {
                  const tp = periods.find((p) => p.startDate <= today && today <= p.endDate);
                  if (tp) setPeriodId(tp.id);
                  setHalfOffset(false);
                }}
                onPrevPeriod={() => {
                  const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                  if (i > 0) {
                    setPeriodId(periods[i - 1].id);
                    setHalfOffset(false);
                  }
                }}
                onNextPeriod={() => {
                  const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                  if (i >= 0 && i < periods.length - 1) {
                    setPeriodId(periods[i + 1].id);
                    setHalfOffset(false);
                  }
                }}
                onPrevHalf={() => {
                  if (halfOffset) setHalfOffset(false);
                  else {
                    const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                    if (i > 0) {
                      setPeriodId(periods[i - 1].id);
                      setHalfOffset(true);
                    }
                  }
                }}
                onNextHalf={() => {
                  if (halfOffset) {
                    const i = periods.findIndex((p) => p.id === effectivePeriod.id);
                    if (i >= 0 && i < periods.length - 1) {
                      setPeriodId(periods[i + 1].id);
                      setHalfOffset(false);
                    }
                  } else setHalfOffset(true);
                }}
              />
            </div>

            {anyEditable && (
              <PaintToolbar
                enabled={paintEnabled}
                onToggle={() =>
                  setPaintEnabled((v) => {
                    if (v) setPaint(null);
                    return !v;
                  })
                }
                skills={paintSkills}
                active={paintEnabled ? paint : null}
                onChange={setPaint}
              />
            )}
            <SkillFilterChips
              skills={paintSkills}
              selected={skillFilter}
              onChange={setSkillFilter}
            />

            <div className="space-y-8">
              {locations.map((loc) => {
                const canEdit = canEditScope(scopes, loc.id, area);
                return (
                  <RosterAreaBlock
                    key={`${loc.id}-${area}`}
                    locationId={loc.id}
                    locationName={loc.name}
                    area={area}
                    period={effectivePeriod}
                    windowStart={windowStart!}
                    windowEnd={windowEnd!}
                    days={days}
                    today={today}
                    canEdit={canEdit}
                    paint={paint}
                    paintEnabled={paintEnabled}
                    skillFilter={skillFilter}
                    allSkills={allSkills}
                    crossBookings={crossBookings}
                    unavailableSet={unavailableSet}
                    absenceMap={absenceMap}
                    wishMap={wishMap}
                    dayServiceEnabled={
                      (
                        (loc as { enabled_service_periods?: string[] | null })
                          .enabled_service_periods ?? []
                      ).length > 1
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </TooltipProvider>
    </div>
  );
}
