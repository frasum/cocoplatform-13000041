// Klick auf eine bestehende Pille → Popover mit Skill-Wechsler,
// Status-Toggle (geplant/bestätigt) und Löschen.
import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Trash2, CalendarX, CalendarCheck, Umbrella, HeartPulse } from "lucide-react";
import type { RosterShift, RosterSkill } from "@/lib/roster/roster.functions";
import { AbsenceRangeForm } from "./AbsenceRangeForm";
import { type AbsenceType } from "@/lib/roster/absence-types";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: React.ReactNode;
  shift: RosterShift;
  candidates: RosterSkill[];
  busy: boolean;
  isUnavailable: boolean;
  canEdit: boolean;
  onChangeSkill: (skillId: string) => void;
  onChangeStatus: (status: "planned" | "confirmed") => void;
  onDelete: () => void;
  onSetUnavailable: () => void;
  onClearUnavailable: () => void;
  absenceType: AbsenceType | null;
  onSetAbsenceRange: (fromIso: string, toIso: string, type: AbsenceType) => void | Promise<void>;
  onClearAbsence: () => void;
  staffShiftDates: string[];
};

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dows = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${dows[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
}

export function PillConfirmPopover({
  open,
  onOpenChange,
  children,
  shift,
  candidates,
  busy,
  isUnavailable,
  canEdit,
  onChangeSkill,
  onChangeStatus,
  onDelete,
  onSetUnavailable,
  onClearUnavailable,
  absenceType,
  onSetAbsenceRange,
  onClearAbsence,
  staffShiftDates,
}: Props) {
  const [mode, setMode] = React.useState<"menu" | AbsenceType>("menu");
  React.useEffect(() => {
    if (!open) setMode("menu");
  }, [open]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={4}
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        {mode !== "menu" ? (
          <AbsenceRangeForm
            type={mode}
            defaultDate={shift.shiftDate}
            staffShiftDates={staffShiftDates}
            staffId={shift.staffId}
            busy={busy}
            onCancel={() => setMode("menu")}
            onSubmit={async (from, to) => {
              await onSetAbsenceRange(from, to, mode);
            }}
          />
        ) : (
          <>
            <div className="mb-2 text-xs text-muted-foreground">
              {shift.staffName} · {fmtDate(shift.shiftDate)}
            </div>

            <div className="mb-2 text-xs font-medium">Skill ändern</div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {candidates.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onChangeSkill(s.id)}
                  className={`rounded px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50 ${
                    s.id === shift.skillId ? "ring-2 ring-offset-1 ring-foreground" : ""
                  }`}
                  style={{ backgroundColor: s.color ?? "#9ca3af" }}
                >
                  {s.name}
                </button>
              ))}
              {candidates.length === 0 && (
                <span className="text-xs text-muted-foreground">Keine Skills verfügbar.</span>
              )}
            </div>

            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Status</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={shift.status === "planned" ? "default" : "outline"}
                  disabled={busy || shift.status === "planned"}
                  onClick={() => onChangeStatus("planned")}
                  className="h-7 text-xs"
                >
                  geplant
                </Button>
                <Button
                  size="sm"
                  variant={shift.status === "confirmed" ? "default" : "outline"}
                  disabled={busy || shift.status === "confirmed"}
                  onClick={() => onChangeStatus("confirmed")}
                  className="h-7 text-xs"
                >
                  bestätigt
                </Button>
              </div>
            </div>

            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={onDelete}
              className="h-7 w-full text-xs"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Schicht löschen
            </Button>

            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={isUnavailable ? onClearUnavailable : onSetUnavailable}
                className="mt-2 h-7 w-full text-xs"
              >
                {isUnavailable ? (
                  <>
                    <CalendarCheck className="mr-1.5 h-3.5 w-3.5" /> Verfügbarkeit wiederherstellen
                  </>
                ) : (
                  <>
                    <CalendarX className="mr-1.5 h-3.5 w-3.5" /> Als nicht verfügbar markieren
                  </>
                )}
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={absenceType === "urlaub" ? onClearAbsence : () => setMode("urlaub")}
                className="mt-2 h-7 w-full text-xs"
              >
                <Umbrella className="mr-1.5 h-3.5 w-3.5 text-green-600" />
                {absenceType === "urlaub" ? "Urlaub entfernen" : "Urlaub eintragen"}
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={absenceType === "krank" ? onClearAbsence : () => setMode("krank")}
                className="mt-2 h-7 w-full text-xs"
              >
                <HeartPulse className="mr-1.5 h-3.5 w-3.5 text-red-600" />
                {absenceType === "krank" ? "Krank entfernen" : "Krank eintragen"}
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={
                  absenceType === "urlaub_unbezahlt"
                    ? onClearAbsence
                    : () => setMode("urlaub_unbezahlt")
                }
                className="mt-2 h-7 w-full border-dashed text-xs"
              >
                <Umbrella className="mr-1.5 h-3.5 w-3.5 text-green-600 opacity-60" />
                {absenceType === "urlaub_unbezahlt"
                  ? "Urlaub (unbezahlt) entfernen"
                  : "Urlaub (unbezahlt) eintragen"}
              </Button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
