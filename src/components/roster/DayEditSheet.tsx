// D5b — Bottom-Sheet für die mobile Tagesansicht. Ruft ausschließlich
// die bestehenden Server-Functions aus roster.functions.ts auf — keine
// eigenen Rechteprüfungen (das UX-Gate liegt im Aufrufer, die Sicherheit
// serverseitig).
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck2, Search, Trash2, Umbrella, HeartPulse } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/format-date";
import {
  createRosterShift,
  deleteRosterShift,
  updateRosterShiftSkill,
  updateRosterShiftStatus,
  setAbsenceRange,
  clearAbsence,
  type RosterSkill,
  type RosterStaffRow,
} from "@/lib/roster/roster.functions";
import { skillsForCell } from "./skills-for-cell";
import { AbsenceRangeForm } from "./AbsenceRangeForm";
import { ABSENCE_LABEL, type AbsenceType } from "@/lib/roster/absence-types";

export type DayEditTarget =
  | {
      mode: "edit";
      locationId: string;
      locationName: string;
      area: "kitchen" | "service";
      date: string;
      staffId: string;
      staffName: string;
      shiftId: string;
      status: "planned" | "confirmed";
      currentSkillId: string | null;
      hasAbsenceToday: boolean;
    }
  | {
      mode: "add";
      locationId: string;
      locationName: string;
      area: "kitchen" | "service";
      date: string;
      /** Kandidaten (Standort × Bereich); ohne die bereits am Tag eingeteilten. */
      candidates: RosterStaffRow[];
    };

type Props = {
  target: DayEditTarget | null;
  onClose: () => void;
  skills: RosterSkill[];
  /** Vollständige Staff-Liste des Standorts – für skillsForCell/AbsenceRangeForm. */
  staffForLocation: RosterStaffRow[];
  /** Alle Schichten des Tages (für Konflikthinweis im AbsenceRangeForm). */
  todaysShiftDates: (staffId: string) => string[];
};

export function DayEditSheet({
  target,
  onClose,
  skills,
  staffForLocation,
  todaysShiftDates,
}: Props) {
  const qc = useQueryClient();
  const [inner, setInner] = React.useState<
    | { view: "menu" }
    | { view: "skill" }
    | { view: "confirm-delete" }
    | { view: "absence"; type: AbsenceType }
    | { view: "add-pick-staff" }
    | { view: "add-pick-skill"; staffId: string; staffName: string }
  >({ view: "menu" });
  const [staffQuery, setStaffQuery] = React.useState("");

  React.useEffect(() => {
    if (!target) return;
    setInner(target.mode === "add" ? { view: "add-pick-staff" } : { view: "menu" });
    setStaffQuery("");
  }, [target]);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["roster-shifts"] }),
      qc.invalidateQueries({ queryKey: ["roster-absence"] }),
      qc.invalidateQueries({ queryKey: ["day-off-wishes"] }),
    ]);
  }
  function toastError(err: unknown) {
    toast.error(err instanceof Error ? err.message : String(err));
  }

  const create = useMutation({
    mutationFn: (v: { staffId: string; skillId: string }) =>
      target && target.mode === "add"
        ? createRosterShift({
            data: {
              locationId: target.locationId,
              staffId: v.staffId,
              shiftDate: target.date,
              area: target.area,
              skillId: v.skillId,
            },
          })
        : Promise.reject(new Error("Kein Ziel")),
    onSuccess: async () => {
      await invalidate();
      toast.success("Schicht angelegt.");
      onClose();
    },
    onError: toastError,
  });
  const confirmStatus = useMutation({
    mutationFn: (id: string) => updateRosterShiftStatus({ data: { id, status: "confirmed" } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Schicht bestätigt.");
      onClose();
    },
    onError: toastError,
  });
  const changeSkill = useMutation({
    mutationFn: (v: { id: string; skillId: string }) =>
      updateRosterShiftSkill({ data: { id: v.id, skillId: v.skillId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Skill geändert.");
      onClose();
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRosterShift({ data: { id } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Schicht entfernt.");
      onClose();
    },
    onError: toastError,
  });
  const setAbs = useMutation({
    mutationFn: (v: { staffId: string; from: string; to: string; type: AbsenceType }) =>
      setAbsenceRange({
        data: { staffId: v.staffId, fromDate: v.from, toDate: v.to, type: v.type },
      }),
    onSuccess: async (res, vars) => {
      await invalidate();
      const label = ABSENCE_LABEL[vars.type];
      const n = res?.deletedShiftCount ?? 0;
      toast.success(
        n > 0
          ? `${label} eingetragen — ${n} ${n === 1 ? "Schicht" : "Schichten"} entfernt.`
          : `${label} eingetragen.`,
      );
      onClose();
    },
    onError: toastError,
  });
  const clearAbs = useMutation({
    mutationFn: (v: { staffId: string; date: string }) =>
      clearAbsence({ data: { staffId: v.staffId, date: v.date } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Abwesenheit entfernt.");
      onClose();
    },
    onError: toastError,
  });

  const busy =
    create.isPending ||
    confirmStatus.isPending ||
    changeSkill.isPending ||
    remove.isPending ||
    setAbs.isPending ||
    clearAbs.isPending;

  if (!target) return null;

  const staffName = target.mode === "edit" ? target.staffName : null;
  const headStaff =
    target.mode === "add" && inner.view === "add-pick-skill" ? inner.staffName : staffName;
  const headTitle = `${headStaff ?? "Mitarbeiter wählen"} · ${target.locationName} · ${formatShortDate(target.date)}`;

  // Staff-Zeile für Skill/Absence-Kontext
  const currentStaffId =
    target.mode === "edit"
      ? target.staffId
      : inner.view === "add-pick-skill"
        ? inner.staffId
        : null;
  const currentStaffRow =
    currentStaffId != null
      ? (staffForLocation.find((s) => s.staffId === currentStaffId) ?? null)
      : null;

  return (
    <Sheet open={target != null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="text-sm font-medium">{headTitle}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {target.area === "kitchen" ? "Küche" : "Service"}
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {/* ADD: Personenauswahl */}
          {target.mode === "add" && inner.view === "add-pick-staff" && (
            <StaffPicker
              candidates={target.candidates}
              value={staffQuery}
              onValueChange={setStaffQuery}
              onPick={(s) =>
                setInner({ view: "add-pick-skill", staffId: s.staffId, staffName: s.displayName })
              }
            />
          )}

          {/* ADD/EDIT: Skill-Auswahl */}
          {((target.mode === "add" && inner.view === "add-pick-skill") ||
            (target.mode === "edit" && inner.view === "skill")) &&
            currentStaffRow && (
              <SkillPicker
                staff={currentStaffRow}
                area={target.area}
                skills={skills}
                busy={busy}
                onPick={(skillId) => {
                  if (target.mode === "edit") {
                    changeSkill.mutate({ id: target.shiftId, skillId });
                  } else {
                    create.mutate({ staffId: currentStaffRow.staffId, skillId });
                  }
                }}
                onBack={() =>
                  setInner(target.mode === "add" ? { view: "add-pick-staff" } : { view: "menu" })
                }
              />
            )}

          {/* EDIT: Hauptmenü */}
          {target.mode === "edit" && inner.view === "menu" && (
            <>
              {target.status === "planned" && (
                <Button
                  variant="default"
                  className="w-full justify-start"
                  disabled={busy}
                  onClick={() => confirmStatus.mutate(target.shiftId)}
                >
                  <CalendarCheck2 className="mr-2 h-4 w-4" /> Bestätigen
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={busy}
                onClick={() => setInner({ view: "skill" })}
              >
                Skill ändern
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={busy}
                onClick={() => setInner({ view: "confirm-delete" })}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Schicht entfernen
              </Button>
              <AbsenceButtons
                hasAbsence={target.hasAbsenceToday}
                busy={busy}
                onUrlaub={() => setInner({ view: "absence", type: "urlaub" })}
                onKrank={() => setInner({ view: "absence", type: "krank" })}
                onUrlaubUnbezahlt={() => setInner({ view: "absence", type: "urlaub_unbezahlt" })}
                onClear={() => clearAbs.mutate({ staffId: target.staffId, date: target.date })}
              />
            </>
          )}

          {/* EDIT: Confirm-Delete */}
          {target.mode === "edit" && inner.view === "confirm-delete" && (
            <div className="space-y-2">
              <p className="text-sm">
                Schicht von <span className="font-medium">{target.staffName}</span> am{" "}
                {formatShortDate(target.date)} entfernen?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setInner({ view: "menu" })}
                >
                  Abbrechen
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => remove.mutate(target.shiftId)}
                >
                  Entfernen
                </Button>
              </div>
            </div>
          )}

          {/* Absence-Range (edit + add gleich) */}
          {inner.view === "absence" && currentStaffId && (
            <AbsenceRangeForm
              type={inner.type}
              defaultDate={target.date}
              staffShiftDates={todaysShiftDates(currentStaffId)}
              staffId={currentStaffId}
              busy={busy}
              onCancel={() =>
                setInner(target.mode === "add" ? { view: "add-pick-staff" } : { view: "menu" })
              }
              onSubmit={async (from, to) => {
                setAbs.mutate({ staffId: currentStaffId, from, to, type: inner.type });
              }}
            />
          )}

          {/* ADD: unten Urlaub/Krank auch ohne Skill (nur wenn Person gewählt) */}
          {target.mode === "add" && inner.view === "add-pick-skill" && currentStaffId && (
            <div className="border-t pt-2">
              <AbsenceButtons
                hasAbsence={false}
                busy={busy}
                onUrlaub={() => setInner({ view: "absence", type: "urlaub" })}
                onKrank={() => setInner({ view: "absence", type: "krank" })}
                onUrlaubUnbezahlt={() => setInner({ view: "absence", type: "urlaub_unbezahlt" })}
                onClear={() => clearAbs.mutate({ staffId: currentStaffId, date: target.date })}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AbsenceButtons({
  hasAbsence,
  busy,
  onUrlaub,
  onKrank,
  onUrlaubUnbezahlt,
  onClear,
}: {
  hasAbsence: boolean;
  busy: boolean;
  onUrlaub: () => void;
  onKrank: () => void;
  onUrlaubUnbezahlt: () => void;
  onClear: () => void;
}) {
  if (hasAbsence) {
    return (
      <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={onClear}>
        Abwesenheit entfernen
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={onUrlaub}>
        <Umbrella className="mr-2 h-4 w-4 text-green-600" /> Urlaub eintragen
      </Button>
      <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={onKrank}>
        <HeartPulse className="mr-2 h-4 w-4 text-red-600" /> Krank eintragen
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start border-dashed"
        disabled={busy}
        onClick={onUrlaubUnbezahlt}
      >
        <Umbrella className="mr-2 h-4 w-4 text-green-600 opacity-60" /> Urlaub (unbezahlt)
      </Button>
    </>
  );
}

function StaffPicker({
  candidates,
  value,
  onValueChange,
  onPick,
}: {
  candidates: RosterStaffRow[];
  value: string;
  onValueChange: (v: string) => void;
  onPick: (s: RosterStaffRow) => void;
}) {
  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [candidates, value]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="Mitarbeiter suchen…"
          className="pl-8"
          autoFocus
        />
      </div>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Keine weiteren Mitarbeiter für diesen Bereich.
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto rounded-md border">
          {filtered.map((s) => (
            <li key={s.staffId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onPick(s)}
              >
                {s.displayName}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Keine Treffer.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function SkillPicker({
  staff,
  area,
  skills,
  busy,
  onPick,
  onBack,
}: {
  staff: RosterStaffRow;
  area: "kitchen" | "service";
  skills: RosterSkill[];
  busy: boolean;
  onPick: (skillId: string) => void;
  onBack: () => void;
}) {
  const { profile, other } = skillsForCell(staff, area, skills);
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Skill wählen</p>
      {profile.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Profil-Skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.map((s) => (
              <SkillChip key={s.id} skill={s} disabled={busy} onClick={() => onPick(s.id)} />
            ))}
          </div>
        </div>
      )}
      {other.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Weitere
          </p>
          <div className="flex flex-wrap gap-1.5">
            {other.map((s) => (
              <SkillChip key={s.id} skill={s} disabled={busy} faded onClick={() => onPick(s.id)} />
            ))}
          </div>
        </div>
      )}
      {profile.length === 0 && other.length === 0 && (
        <p className="text-xs text-muted-foreground">Keine passenden Skills hinterlegt.</p>
      )}
      <div className="flex justify-end pt-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onBack}>
          Zurück
        </Button>
      </div>
    </div>
  );
}

function SkillChip({
  skill,
  disabled,
  faded,
  onClick,
}: {
  skill: RosterSkill;
  disabled: boolean;
  faded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs font-bold text-white transition-opacity disabled:opacity-40 ${
        faded ? "opacity-70 hover:opacity-100" : ""
      }`}
      style={{ backgroundColor: skill.color ?? "#9ca3af" }}
    >
      {skill.name}
    </button>
  );
}
