// G1a Scheibe 2 — 1:1 aus src/routes/_authenticated/admin/zeit-uebersicht.tsx
// extrahiert. Verhaltensgleich; Props-Verträge unverändert.

import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZeitSkeleton } from "@/components/ui/page-skeletons";
import type { WeeklyExportInput } from "@/lib/time/weekly-export";
import { bavarianHolidayName, isBavarianHoliday, isSundayOrHoliday } from "@/lib/time/shift-hours";
import {
  DEPT_BAR,
  DEPT_BG,
  dayHeader,
  fmtDec,
  fmtHHMM,
  fmtIso,
  type Department,
  type WeeklyEntry,
} from "@/lib/time/zeit-uebersicht-core";
import { ReassignPopover } from "./ReassignPopover";
import { resolveEditorAction } from "@/lib/time/weekly-editor-actions";

export function WeeklyPlan({
  input,
  isLoading,
  weekDays,
  isAdmin,
  entriesById,
  pending,
  onUpdateInline,
  onCreateInline,
  onReassign,
  onDeleteEntry,
  onRemoveUnplanned,
  staffDeptsByStaff,
  periodStart,
  periodEnd,
  shiftsByStaff,
  absencesByStaff,
  totalsScope = "week",
  onTotalsScopeChange,
  periodTotalsByStaff,
  persoNrByStaffId,
}: {
  input: WeeklyExportInput | null;
  isLoading: boolean;
  weekDays: Date[];
  isAdmin: boolean;
  entriesById: Map<string, WeeklyEntry>;
  pending: boolean;
  onUpdateInline: (id: string, iso: string, from: string, to: string) => void;
  onCreateInline: (
    staffId: string,
    iso: string,
    from: string,
    to: string,
    department: Department,
  ) => void;
  // Z3 — Abteilung eines bestehenden Eintrags umhängen.
  onReassign: (id: string, department: Department | null) => void;
  // WP1 — Löschen eines einzelnen Eintrags aus dem Wochenplan.
  // Aufrufer öffnet die eigentliche Server-Mutation; die UI hat die
  // Begründung bereits per Popover eingesammelt (≥3 Zeichen).
  onDeleteEntry: (id: string, reason: string) => void;
  // ZS1 — Ein-Klick-Entfernen unberührter Einträge ohne Plan-Schicht.
  onRemoveUnplanned: (id: string) => void;
  staffDeptsByStaff: Map<string, Department[]>;
  periodStart?: string;
  periodEnd?: string;
  shiftsByStaff: Map<string, number>;
  absencesByStaff: Map<string, { krankDays: number; urlaubDays: number; absenceNote?: string }>;
  totalsScope?: "week" | "period";
  onTotalsScopeChange?: (v: "week" | "period") => void;
  periodTotalsByStaff?: Map<
    string,
    { total: number; evening: number; night: number; sunHol: number }
  >;
  persoNrByStaffId?: Map<string, number | null>;
}) {
  // Header-Tagesmeta (Wochentag-Label + Feiertags-Hint)
  const dayMeta = weekDays.map((d) => {
    const iso = fmtIso(d);
    return {
      date: d,
      iso,
      isSun: d.getUTCDay() === 0,
      isHol: isBavarianHoliday(d),
      isSunOrHol: isSundayOrHoliday(d),
      holidayName: bavarianHolidayName(d),
      outOfPeriod: periodStart && periodEnd ? iso < periodStart || iso > periodEnd : false,
    };
  });

  // Spalten: Mitarbeiter (links) + 7 Tage × (Anf. | Ende)
  // + Mitarbeiter (rechts) + 4 Zeit-Summen + S + U + K
  const totalCols = 1 + 7 * 2 + 1 + 4 + 3;

  const groups = useMemo(() => input?.rowsByDept ?? [], [input?.rowsByDept]);
  const anyRows = groups.some((g) => g.rows.length > 0);

  // Hilfsfunktion: aus staffId + ISO → die echten WeeklyEntry-Objekte
  // (für onEdit/onCreate, da WeeklyExportRow nur Strings hält).
  const findEntries = (staffId: string, iso: string): WeeklyEntry[] => {
    const out: WeeklyEntry[] = [];
    for (const e of entriesById.values()) {
      if (e.staffId === staffId && e.businessDate === iso) out.push(e);
    }
    return out;
  };

  type EditState = {
    staffId: string;
    iso: string;
    field: "from" | "to";
    from: string;
    to: string;
    existingId: string | null;
    origFrom: string;
    origTo: string;
    // Z3 — Abteilung der Zeile (für Create-Pfad; Updates lassen die Spalte
    // unverändert, damit ein Time-Edit keinen Umhänge-Effekt hat).
    department: Department;
  };
  const [edit, setEdit] = useState<EditState | null>(null);
  // WP1 — Lösch-Bestätigungs-Popover. Wird gefüllt, wenn beide Zellen-Felder
  // geleert wurden (Blur/Enter) ODER das ✕ in der Zelle geklickt wird.
  type DeleteTarget = {
    id: string;
    displayName: string;
    iso: string;
    from: string;
    to: string;
  };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteReason, setDeleteReason] = useState<string>("Wochenplan-Korrektur");
  const editStaffId = edit?.staffId;
  const editIso = edit?.iso;
  const editField = edit?.field;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigatingRef = useRef(false);

  // Fokus + Selektion nur, wenn eine NEUE Zielzelle aktiv wird
  // (nicht bei jedem Tastenanschlag → kein Cursor-Flackern).
  useEffect(() => {
    if (!editStaffId) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editStaffId, editIso, editField]);

  const startEdit = (
    staffId: string,
    iso: string,
    field: "from" | "to",
    department: Department,
  ) => {
    if (!isAdmin) return;
    const found = findEntries(staffId, iso);
    if (found.length > 1) return;
    if (found.length === 1) {
      const f = fmtHHMM(found[0].startedAt);
      const t = fmtHHMM(found[0].endedAt);
      setEdit({
        staffId,
        iso,
        field,
        from: f,
        to: t,
        existingId: found[0].id,
        origFrom: f,
        origTo: t,
        department,
      });
    } else {
      // WP1 — Neue Zelle startet LEER. Die "15:00"/"23:00" erscheinen nur
      // noch als placeholder-Attribut im Input; wegklicken erzeugt nichts.
      setEdit({
        staffId,
        iso,
        field,
        from: "",
        to: "",
        existingId: null,
        origFrom: "",
        origTo: "",
        department,
      });
    }
  };

  const cellKey = (staffId: string, iso: string) => `${staffId}|${iso}`;

  // WP1 — Ergebnis der zentralen Editor-Aktion. "closed" schließt den Editor,
  // "kept-open" hält ihn offen (Ungültige Uhrzeit), "delete-pending" öffnet
  // das Bestätigungs-Popover; der Aufrufer entscheidet, ob er dann schließt.
  type CommitResult = "closed" | "kept-open" | "delete-pending";
  const commit = (e: EditState): CommitResult => {
    const action = resolveEditorAction({
      from: e.from,
      to: e.to,
      existingId: e.existingId,
      origFrom: e.origFrom,
      origTo: e.origTo,
    });
    switch (action.kind) {
      case "close":
      case "noop":
        return "closed";
      case "create":
        onCreateInline(e.staffId, e.iso, action.from, action.to, e.department);
        return "closed";
      case "update":
        onUpdateInline(action.id, e.iso, action.from, action.to);
        return "closed";
      case "delete": {
        const en = findEntries(e.staffId, e.iso).find((x) => x.id === action.id);
        const row = flatRows.find((r) => r.staffId === e.staffId);
        setDeleteReason("Wochenplan-Korrektur");
        setDeleteTarget({
          id: action.id,
          displayName: row?.displayName ?? "",
          iso: e.iso,
          from: en ? fmtHHMM(en.startedAt) : e.origFrom,
          to: en ? fmtHHMM(en.endedAt) : e.origTo,
        });
        return "delete-pending";
      }
      case "error":
        toast.error("Ungültige Uhrzeit.");
        return "kept-open";
    }
  };

  const handleBlur = (ev: React.FocusEvent<HTMLInputElement>, current: EditState) => {
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }
    const next = ev.relatedTarget as HTMLElement | null;
    const nextKey = next?.getAttribute?.("data-edit-key");
    if (nextKey === cellKey(current.staffId, current.iso)) return;
    const r = commit(current);
    if (r === "kept-open") return;
    setEdit((cur) =>
      cur &&
      cur.staffId === current.staffId &&
      cur.iso === current.iso &&
      cur.field === current.field
        ? null
        : cur,
    );
  };

  // Flache Liste aller sichtbaren Mitarbeiter-Zeilen (für Tab/Pfeil-Navigation).
  const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const isCellEditable = (row: (typeof flatRows)[number] | undefined, dayIdx: number): boolean => {
    if (!row || !isAdmin) return false;
    // Z3 — alle Zeilen editierbar. Neu erstellte Einträge tragen die
    // Abteilung ihrer Zeile und bleiben nach dem Refetch dort.
    const dm = dayMeta[dayIdx];
    if (!dm || dm.outOfPeriod) return false;
    const day = row.days[dayIdx];
    if (!day || day.shifts.length > 1) return false;
    return true;
  };

  // Nächste editierbare Zelle in einer der beiden Richtungen.
  const findNextRow = (
    rowIdx: number,
    dayIdx: number,
    dir: 1 | -1,
  ): { rowIdx: number; dayIdx: number } | null => {
    let r = rowIdx + dir;
    while (r >= 0 && r < flatRows.length) {
      if (isCellEditable(flatRows[r], dayIdx)) return { rowIdx: r, dayIdx };
      r += dir;
    }
    return null;
  };

  // Nächste editierbare Zelle in Leserichtung über Tag/Feld-Grenzen hinweg.
  const findNextField = (
    rowIdx: number,
    dayIdx: number,
    field: "from" | "to",
    dir: 1 | -1,
  ): { rowIdx: number; dayIdx: number; field: "from" | "to" } | null => {
    let d = dayIdx;
    let f: "from" | "to" = field;
    for (let guard = 0; guard < 20; guard++) {
      if (dir === 1) {
        if (f === "from") f = "to";
        else {
          f = "from";
          d += 1;
        }
      } else {
        if (f === "to") f = "from";
        else {
          f = "to";
          d -= 1;
        }
      }
      if (d < 0 || d >= dayMeta.length) return null;
      if (isCellEditable(flatRows[rowIdx], d)) return { rowIdx, dayIdx: d, field: f };
    }
    return null;
  };

  // Wechselt die aktive Edit-Zelle. Committed die aktuelle, wenn wir das Feld/die Zelle verlassen.
  const navigateTo = (
    current: EditState,
    nextStaffId: string,
    nextIso: string,
    nextField: "from" | "to",
    nextDepartment: Department = current.department,
  ) => {
    const sameCell = nextStaffId === current.staffId && nextIso === current.iso;
    if (!sameCell) {
      const r = commit(current);
      if (r !== "closed") return; // ungültig oder Lösch-Popover → aktuelle Zelle bleibt/wird über Popover-Flow zu
    }
    navigatingRef.current = true;
    if (sameCell) {
      setEdit({ ...current, field: nextField });
    } else {
      startEdit(nextStaffId, nextIso, nextField, nextDepartment);
    }
  };

  return (
    <>
      <Card className="overflow-x-auto">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead
                rowSpan={2}
                className="w-[56px] min-w-[56px] px-1 align-middle text-center text-xs"
              />
              {dayMeta.map((dm) => (
                <TableHead
                  key={dm.iso}
                  colSpan={2}
                  className={`text-center whitespace-nowrap border-l ${
                    dm.outOfPeriod
                      ? "bg-muted/40 text-muted-foreground/60"
                      : dm.isHol || dm.isSun
                        ? "bg-yellow-50"
                        : ""
                  }`}
                >
                  {dayHeader(dm.date)}
                  {dm.holidayName && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {dm.holidayName}
                    </span>
                  )}
                </TableHead>
              ))}
              <TableHead
                rowSpan={2}
                className="w-[72px] min-w-[72px] px-1 align-middle border-l text-center"
              >
                {onTotalsScopeChange ? (
                  <div className="flex flex-col gap-1" role="group" aria-label="Summen-Bezug">
                    <button
                      type="button"
                      onClick={() => onTotalsScopeChange("week")}
                      aria-pressed={totalsScope === "week"}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition ${
                        totalsScope === "week"
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      Woche
                    </button>
                    <button
                      type="button"
                      onClick={() => onTotalsScopeChange("period")}
                      aria-pressed={totalsScope === "period"}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition ${
                        totalsScope === "period"
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      Monat
                    </button>
                  </div>
                ) : null}
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap"
                title={
                  totalsScope === "period"
                    ? "Gesamt in der Abrechnungsperiode"
                    : "Gesamt in dieser Woche"
                }
              >
                Ges{totalsScope === "period" ? "*" : ""}
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap"
                title={
                  totalsScope === "period"
                    ? "Abendzuschlag (20–24) in der Abrechnungsperiode"
                    : "Abendzuschlag (20–24) in dieser Woche"
                }
              >
                20–24{totalsScope === "period" ? "*" : ""}
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap"
                title={
                  totalsScope === "period"
                    ? "Nachtzuschlag (24–x) in der Abrechnungsperiode"
                    : "Nachtzuschlag (24–x) in dieser Woche"
                }
              >
                24–x{totalsScope === "period" ? "*" : ""}
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap"
              >
                <span
                  title={
                    totalsScope === "period"
                      ? "Sonntag/Feiertag in der Abrechnungsperiode"
                      : "Sonntag/Feiertag in dieser Woche"
                  }
                >
                  SF{totalsScope === "period" ? "*" : ""}
                </span>
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap text-red-600"
                title="Schichten in der Abrechnungsperiode"
              >
                S
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap text-green-600"
                title="Urlaubstage in der Abrechnungsperiode"
              >
                U
              </TableHead>
              <TableHead
                rowSpan={2}
                className="px-1 text-right text-xs align-middle whitespace-nowrap text-blue-600"
                title="Kranktage in der Abrechnungsperiode"
              >
                K
              </TableHead>
            </TableRow>
            <TableRow>
              {dayMeta.map((dm) => {
                const bg = dm.outOfPeriod
                  ? "bg-muted/40 text-muted-foreground/60"
                  : dm.isHol || dm.isSun
                    ? "bg-yellow-50"
                    : "";
                return (
                  <Fragment key={`sub-${dm.iso}`}>
                    <TableHead
                      className={`w-[44px] min-w-[44px] border-l text-center text-[11px] font-normal ${bg}`}
                    >
                      Anf.
                    </TableHead>
                    <TableHead
                      className={`w-[44px] min-w-[44px] text-center text-[11px] font-normal ${bg}`}
                    >
                      Ende
                    </TableHead>
                  </Fragment>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={totalCols} className="text-center text-muted-foreground">
                  <ZeitSkeleton />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !anyRows && (
              <TableRow>
                <TableCell colSpan={totalCols} className="text-center text-muted-foreground">
                  Keine Einträge in dieser Woche.
                </TableCell>
              </TableRow>
            )}
            {groups.map((grp) => {
              if (grp.rows.length === 0) return null;
              return (
                <Fragment key={`w-${grp.dept}`}>
                  <TableRow className={DEPT_BG[grp.dept]}>
                    <TableCell colSpan={totalCols} className="font-semibold text-foreground">
                      {grp.deptLabel}
                    </TableCell>
                  </TableRow>
                  {grp.rows.map((row) => {
                    // Z3 — Warnung, wenn ein Eintrag eine Abteilung trägt, die
                    // der Person am Standort nicht (mehr) zugeordnet ist. Er
                    // erscheint dann auf der Primär-Zeile.
                    const mismatchedTitle = (row as { mismatched?: boolean }).mismatched
                      ? "Achtung: mindestens ein Eintrag trägt eine Abteilung, die der Person am Standort nicht zugeordnet ist — er wird hier auf der Primär-Zeile angezeigt."
                      : undefined;
                    return (
                      <TableRow
                        key={`${row.staffId}:${row.department}`}
                        className="even:bg-muted/70"
                      >
                        <TableCell className="group relative px-1 font-bold align-middle text-center text-[10px] w-[56px] min-w-[56px] max-w-[56px]">
                          <span
                            className={`absolute left-0 top-0 bottom-0 w-[2px] ${DEPT_BAR[row.department]}`}
                          />
                          <span
                            className="block truncate"
                            title={mismatchedTitle ?? row.displayName}
                          >
                            {row.displayName}
                            {mismatchedTitle ? (
                              <span className="ml-0.5 text-amber-600">⚠</span>
                            ) : null}
                          </span>
                          {persoNrByStaffId?.get(row.staffId) != null && (
                            <span className="block text-[9px] font-normal text-muted-foreground leading-none">
                              #{persoNrByStaffId.get(row.staffId)}
                            </span>
                          )}
                          {isAdmin && (staffDeptsByStaff.get(row.staffId)?.length ?? 0) > 1 ? (
                            <ReassignPopover
                              row={row}
                              entriesById={entriesById}
                              onReassign={onReassign}
                              pending={pending}
                              staffDeptsByStaff={staffDeptsByStaff}
                            />
                          ) : null}
                        </TableCell>
                        {row.days.map((day, idx) => {
                          const dm = dayMeta[idx];
                          const cellBg = dm.outOfPeriod
                            ? "bg-muted/40"
                            : dm.isHol || dm.isSun
                              ? "bg-yellow-50"
                              : "";
                          const empty = day.shifts.length === 0;
                          // Z3 — alle Zeilen sind editierbar; das Grid attribuiert
                          // Einträge über entryRowDepartment.
                          const clickable = isAdmin && !dm.outOfPeriod;
                          const multi = day.shifts.length > 1;
                          const isEditingCell =
                            edit !== null && edit.staffId === row.staffId && edit.iso === day.iso;
                          const editable = clickable && !multi;
                          const handleCellClick = (which: "from" | "to") => {
                            if (!editable) return;
                            if (isEditingCell) return;
                            startEdit(row.staffId, day.iso, which, row.department);
                          };
                          const singleExisting =
                            !empty && day.shifts.length === 1 && !isEditingCell;
                          // ZS1 — Plan-Abgleich für diese Zelle. Badge/Marker
                          // ist für jeden sichtbar, der die Liste sieht; der
                          // Entfernen-Klick bleibt an isAdmin (Schreibrecht)
                          // gebunden und wird serverseitig erneut geprüft.
                          const cellEntries = empty ? [] : findEntries(row.staffId, day.iso);
                          const unplannedEntry =
                            cellEntries.length === 1 && cellEntries[0].notInPlan
                              ? cellEntries[0]
                              : null;
                          const openDeleteFromCell = (ev: React.MouseEvent) => {
                            ev.stopPropagation();
                            const en = findEntries(row.staffId, day.iso)[0];
                            if (!en) return;
                            setDeleteReason("Wochenplan-Korrektur");
                            setDeleteTarget({
                              id: en.id,
                              displayName: row.displayName,
                              iso: day.iso,
                              from: fmtHHMM(en.startedAt),
                              to: fmtHHMM(en.endedAt),
                            });
                          };
                          const renderShift = (which: "from" | "to") => {
                            if (isEditingCell && edit.field === which) {
                              const val = which === "from" ? edit.from : edit.to;
                              return (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={5}
                                  value={val}
                                  placeholder={which === "from" ? "15:00" : "23:00"}
                                  disabled={pending}
                                  data-edit-key={cellKey(row.staffId, day.iso)}
                                  ref={inputRef}
                                  onChange={(ev) =>
                                    setEdit({
                                      ...edit,
                                      [which]: ev.target.value,
                                    } as EditState)
                                  }
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter") {
                                      ev.preventDefault();
                                      if (commit(edit)) setEdit(null);
                                      return;
                                    }
                                    if (ev.key === "Escape") {
                                      ev.preventDefault();
                                      navigatingRef.current = true;
                                      setEdit(null);
                                      return;
                                    }
                                    const rIdx = flatRows.findIndex(
                                      (r) => r.staffId === edit.staffId,
                                    );
                                    const dIdx = dayMeta.findIndex((d) => d.iso === edit.iso);
                                    if (rIdx < 0 || dIdx < 0) return;
                                    if (ev.key === "Tab") {
                                      ev.preventDefault();
                                      const t = findNextRow(rIdx, dIdx, ev.shiftKey ? -1 : 1);
                                      if (t)
                                        navigateTo(
                                          edit,
                                          flatRows[t.rowIdx].staffId,
                                          dayMeta[t.dayIdx].iso,
                                          edit.field,
                                          flatRows[t.rowIdx].department,
                                        );
                                      return;
                                    }
                                    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                                      ev.preventDefault();
                                      const t = findNextRow(
                                        rIdx,
                                        dIdx,
                                        ev.key === "ArrowDown" ? 1 : -1,
                                      );
                                      if (t)
                                        navigateTo(
                                          edit,
                                          flatRows[t.rowIdx].staffId,
                                          dayMeta[t.dayIdx].iso,
                                          edit.field,
                                          flatRows[t.rowIdx].department,
                                        );
                                      return;
                                    }
                                    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
                                      ev.preventDefault();
                                      const t = findNextField(
                                        rIdx,
                                        dIdx,
                                        edit.field,
                                        ev.key === "ArrowRight" ? 1 : -1,
                                      );
                                      if (t)
                                        navigateTo(
                                          edit,
                                          flatRows[t.rowIdx].staffId,
                                          dayMeta[t.dayIdx].iso,
                                          t.field,
                                        );
                                      return;
                                    }
                                  }}
                                  onBlur={(ev) => handleBlur(ev, edit)}
                                  className={`block w-full h-6 min-w-0 px-0 text-center tabular-nums text-sm rounded border border-primary/50 bg-background box-border ${pending ? "opacity-60" : ""}`}
                                />
                              );
                            }
                            if (isEditingCell) {
                              const val = which === "from" ? edit.from : edit.to;
                              return <span className="tabular-nums">{val}</span>;
                            }
                            if (empty) {
                              if (day.crossLocation && which === "from" && !dm.outOfPeriod)
                                return <span className="text-muted-foreground">×</span>;
                              if (editable && which === "from")
                                return <span className="text-muted-foreground/40">+</span>;
                              return "";
                            }
                            return (
                              <div className="flex flex-col divide-y divide-border/60">
                                {day.shifts.map((s, i) => (
                                  <span key={i} className="tabular-nums">
                                    {s[which]}
                                  </span>
                                ))}
                              </div>
                            );
                          };
                          return (
                            <Fragment key={day.iso}>
                              <TableCell
                                onClick={() => handleCellClick("from")}
                                title={mismatchedTitle}
                                className={`group/cell relative w-[44px] min-w-[44px] border-l px-0.5 py-1 text-center align-middle tabular-nums text-xs ${cellBg} ${editable ? "cursor-pointer hover:bg-muted/60" : ""}`}
                              >
                                {renderShift("from")}
                                {unplannedEntry ? (
                                  unplannedEntry.removable && isAdmin ? (
                                    <button
                                      type="button"
                                      aria-label="Nicht mehr im Plan — unberührten Eintrag entfernen"
                                      title="Nicht mehr im Dienstplan und unberührt — hier entfernen"
                                      disabled={pending}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        onRemoveUnplanned(unplannedEntry.id);
                                      }}
                                      className="absolute bottom-0 left-0 text-[10px] leading-none px-0.5 text-amber-600 hover:text-red-600"
                                    >
                                      ⚑
                                    </button>
                                  ) : (
                                    <span
                                      aria-label="Nicht mehr im Plan"
                                      title="Nicht mehr im Dienstplan (Stempel, Abrechnung oder Notiz vorhanden — bewusst löschen)"
                                      className="absolute bottom-0 left-0 text-[10px] leading-none px-0.5 text-amber-600"
                                    >
                                      ⚑
                                    </span>
                                  )
                                ) : null}
                                {editable && singleExisting ? (
                                  <button
                                    type="button"
                                    aria-label="Schicht löschen"
                                    title="Schicht löschen"
                                    onClick={openDeleteFromCell}
                                    disabled={pending}
                                    className="absolute top-0 right-0 hidden group-hover/cell:block text-[10px] leading-none px-0.5 text-muted-foreground hover:text-red-600 focus:block"
                                  >
                                    ×
                                  </button>
                                ) : null}
                              </TableCell>
                              <TableCell
                                onClick={() => handleCellClick("to")}
                                title={mismatchedTitle}
                                className={`w-[44px] min-w-[44px] px-0.5 py-1 text-center align-middle tabular-nums text-xs ${cellBg} ${editable ? "cursor-pointer hover:bg-muted/60" : ""}`}
                              >
                                {renderShift("to")}
                              </TableCell>
                            </Fragment>
                          );
                        })}
                        <TableCell className="font-bold align-middle border-l text-center text-[10px] px-1 w-[56px] min-w-[56px] max-w-[56px]">
                          <span className="block truncate" title={row.displayName}>
                            {row.displayName}
                          </span>
                          {persoNrByStaffId?.get(row.staffId) != null && (
                            <span className="block text-[9px] font-normal text-muted-foreground leading-none">
                              #{persoNrByStaffId.get(row.staffId)}
                            </span>
                          )}
                        </TableCell>
                        {(() => {
                          const pt = periodTotalsByStaff?.get(row.staffId);
                          const t =
                            totalsScope === "period" && pt
                              ? pt
                              : {
                                  total: row.totals.total,
                                  evening: row.totals.evening,
                                  night: row.totals.night,
                                  sunHol: row.totals.sunHol,
                                };
                          return (
                            <>
                              <TableCell className="px-1 text-xs text-right tabular-nums font-medium">
                                {fmtDec(t.total)}
                              </TableCell>
                              <TableCell className="px-1 text-xs text-right tabular-nums">
                                {fmtDec(t.evening)}
                              </TableCell>
                              <TableCell className="px-1 text-xs text-right tabular-nums">
                                {fmtDec(t.night)}
                              </TableCell>
                              <TableCell className="px-1 text-xs text-right tabular-nums">
                                {fmtDec(t.sunHol)}
                              </TableCell>
                            </>
                          );
                        })()}
                        {(() => {
                          const s = shiftsByStaff.get(row.staffId) ?? 0;
                          return (
                            <TableCell
                              className={`px-1 text-xs text-right tabular-nums ${s > 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}
                            >
                              {s > 0 ? s : "–"}
                            </TableCell>
                          );
                        })()}
                        {(() => {
                          const abs = absencesByStaff.get(row.staffId);
                          const u = abs?.urlaubDays ?? 0;
                          const k = abs?.krankDays ?? 0;
                          return (
                            <>
                              <TableCell
                                className={`px-1 text-xs text-right tabular-nums ${u > 0 ? "text-green-600 font-medium" : "text-muted-foreground/50"}`}
                              >
                                {u > 0 ? u : "–"}
                              </TableCell>
                              <TableCell
                                className={`px-1 text-xs text-right tabular-nums ${k > 0 ? "text-blue-600 font-medium" : "text-muted-foreground/50"}`}
                              >
                                {k > 0 ? k : "–"}
                              </TableCell>
                            </>
                          );
                        })()}
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Schicht löschen?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.displayName} · ${deleteTarget.iso} · ${deleteTarget.from}–${deleteTarget.to}`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="wp1-delete-reason" className="text-xs text-muted-foreground">
              Begründung (mind. 3 Zeichen — landet im Audit-Log)
            </label>
            <Textarea
              id="wp1-delete-reason"
              value={deleteReason}
              onChange={(ev) => setDeleteReason(ev.target.value)}
              rows={3}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={pending || deleteReason.trim().length < 3}
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteReason.trim().length < 3) {
                  toast.error("Bitte mindestens 3 Zeichen Begründung.");
                  return;
                }
                onDeleteEntry(deleteTarget.id, deleteReason.trim());
                setDeleteTarget(null);
              }}
            >
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
