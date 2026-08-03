import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtCents } from "@/lib/format";
import {
  deleteSessionTipPoolEntry,
  removeUnplannedPoolEntry,
  getTipPoolOverview,
  listSessionTipPoolEntries,
  upsertSessionTipPoolEntry,
  addRosterSnapshotMissing,
} from "@/lib/cash/cash.functions";
import { kitchenShiftMinutes } from "@/lib/cash/kitchen-shift-hours";

function minutesToHm(m: number): string {
  const safe = Math.max(0, Math.round(m));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

type StaffListItem = {
  id: string;
  displayName: string;
  isActive: boolean;
  locationIds: string[];
};

type ManualDraft = {
  staffId: string;
  department: "kitchen" | "service" | "gl";
  hours: string;
  minutes: string;
  shiftStart: string;
  shiftEnd: string;
};

export function TipPoolCard({
  sessionId,
  locationId,
  hasSettlements,
  editable,
  staffList,
}: {
  sessionId: string;
  locationId: string;
  hasSettlements: boolean;
  editable: boolean;
  staffList: StaffListItem[];
}) {
  const qc = useQueryClient();
  const fetchPool = useServerFn(getTipPoolOverview);
  const fetchEntries = useServerFn(listSessionTipPoolEntries);
  const callUpsert = useServerFn(upsertSessionTipPoolEntry);
  const callDelete = useServerFn(deleteSessionTipPoolEntry);
  const callAddSnapshot = useServerFn(addRosterSnapshotMissing);
  const callRemoveUnplanned = useServerFn(removeUnplannedPoolEntry);

  const poolQ = useQuery({
    queryKey: ["cash", "tip-pool", sessionId],
    queryFn: () => fetchPool({ data: { sessionId } }),
    enabled: hasSettlements,
  });
  const entriesQ = useQuery({
    queryKey: ["cash", "tip-pool-entries", sessionId],
    queryFn: () => fetchEntries({ data: { sessionId } }),
    enabled: hasSettlements,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<ManualDraft>({
    staffId: "",
    department: "service",
    hours: "0",
    minutes: "00",
    shiftStart: "",
    shiftEnd: "",
  });

  const invalidatePool = () => {
    void qc.invalidateQueries({ queryKey: ["cash", "tip-pool", sessionId] });
    void qc.invalidateQueries({ queryKey: ["cash", "tip-pool-entries", sessionId] });
  };

  const upsertMut = useMutation({
    mutationFn: () => {
      if (!draft.staffId) throw new Error("Bitte einen Mitarbeiter wählen.");
      // TP-GL: Wer heute eine GL-Schicht hat, ist laut Hausregel nicht
      // poolbeteiligt. Manuelles Hinzufügen fragt zur Sicherheit nach;
      // bewusstes Übersteuern durch Manager bleibt möglich (Audit läuft).
      const hasGlToday =
        draft.department !== "gl" &&
        (poolQ.data?.glEntries ?? []).some((g) => g.staffId === draft.staffId);
      if (hasGlToday) {
        const name = poolQ.data?.staffNames[draft.staffId] ?? draft.staffId;
        const ok = window.confirm(
          `${name} hat heute eine GL-Schicht — laut Hausregel nicht poolbeteiligt. Trotzdem hinzufügen?`,
        );
        if (!ok) throw new Error("Abgebrochen.");
      }
      // Von/Bis ist primärer Eingabepfad für service und gl, und für
      // Küche, wenn der Standortmodus „Küche manuell" aktiv ist.
      const useShift =
        draft.department === "service" ||
        draft.department === "gl" ||
        (draft.department === "kitchen" && Boolean(poolQ.data?.kitchenManualOnly));
      if (useShift) {
        // GL darf leere Zeiten haben (reine Arbeitszeit-Anker-Zeile).
        if (draft.department !== "gl" && (!draft.shiftStart || !draft.shiftEnd)) {
          throw new Error("Start- und Endzeit angeben.");
        }
        if (draft.shiftStart && draft.shiftEnd) {
          // Frühe Validierung; Server prüft erneut.
          kitchenShiftMinutes(draft.shiftStart, draft.shiftEnd);
          return callUpsert({
            data: {
              sessionId,
              staffId: draft.staffId,
              department: draft.department,
              shiftStart: draft.shiftStart,
              shiftEnd: draft.shiftEnd,
            },
          });
        }
        // GL ohne Zeiten → 0 Minuten als Anker-Eintrag.
        return callUpsert({
          data: {
            sessionId,
            staffId: draft.staffId,
            department: draft.department,
            hoursMinutes: 0,
          },
        });
      }
      const h = Number.parseInt(draft.hours, 10);
      const m = Number.parseInt(draft.minutes, 10);
      if (!Number.isFinite(h) || h < 0 || h > 24) throw new Error("Stunden 0–24.");
      if (!Number.isFinite(m) || m < 0 || m > 59) throw new Error("Minuten 0–59.");
      const total = h * 60 + m;
      if (total > 1440) throw new Error("Maximal 24 Stunden.");
      return callUpsert({
        data: {
          sessionId,
          staffId: draft.staffId,
          department: draft.department,
          hoursMinutes: total,
        },
      });
    },
    onSuccess: () => {
      toast.success("Pool-Eintrag gespeichert.");
      setDraft({
        staffId: "",
        department: "service",
        hours: "0",
        minutes: "00",
        shiftStart: "",
        shiftEnd: "",
      });
      invalidatePool();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (staffId: string) => callDelete({ data: { sessionId, staffId } }),
    onSuccess: () => {
      toast.success("Pool-Eintrag entfernt.");
      invalidatePool();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const snapshotMut = useMutation({
    mutationFn: () => callAddSnapshot({ data: { sessionId } }),
    onSuccess: (r: { added: number }) => {
      toast.success(
        r.added > 0
          ? `${r.added} Plan-Schicht(en) in den Pool übernommen.`
          : "Keine neuen Plan-Schichten zu ergänzen.",
      );
      invalidatePool();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!hasSettlements) return null;
  if (poolQ.isLoading) {
    return <Card className="p-4 text-sm text-muted-foreground">Lade Trinkgeld-Pool…</Card>;
  }
  if (poolQ.error || !poolQ.data) {
    return (
      <Card className="p-4 text-sm text-destructive">
        Trinkgeld-Pool konnte nicht geladen werden.
      </Card>
    );
  }
  const data = poolQ.data;
  const kitchenManualOnly = data.kitchenManualOnly;
  const manualSet = new Set(data.manualStaffIds);
  const sharesByStaff = new Map(data.shares.map((s) => [s.staffId, s]));
  const poolEntries = data.poolEntries ?? [];
  const kitchenRows = poolEntries.filter((p) => p.department === "kitchen");
  const serviceRows = poolEntries.filter((p) => p.department === "service");
  const entries = entriesQ.data ?? [];
  const glEntries = data.glEntries ?? [];
  const eligibleStaff = staffList.filter(
    (s) => s.isActive && (locationId === "" || s.locationIds.includes(locationId)),
  );

  const toggleParticipates = async (
    row: (typeof poolEntries)[number],
    nextParticipates: boolean,
  ) => {
    try {
      // Wenn nur Stempel vorhanden (kein manueller Eintrag), eine
      // Pool-Zeile mit den aktuellen Stempel-Minuten anlegen, damit
      // die Stunden erhalten bleiben, wenn der MA wieder zugeschaltet
      // wird.
      await callUpsert({
        data: {
          sessionId,
          staffId: row.staffId,
          department: row.department,
          ...(row.shiftStart && row.shiftEnd
            ? { shiftStart: row.shiftStart, shiftEnd: row.shiftEnd }
            : { hoursMinutes: row.hoursMinutes }),
          participates: nextParticipates,
        },
      });
      invalidatePool();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // ZS1 — Ein-Klick-Entfernen unberührter Zeilen ohne Plan-Schicht.
  const removeUnplanned = async (staffId: string) => {
    try {
      await callRemoveUnplanned({ data: { sessionId, staffId } });
      toast.success("Eintrag entfernt.");
      invalidatePool();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const renderTable = (title: string, rows: typeof poolEntries) => {
    return (
      <Card className="flex-1">
        <div className="border-b px-4 py-3 text-sm font-medium">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mitarbeiter</TableHead>
              <TableHead className="w-20 text-center">Im Pool</TableHead>
              <TableHead>Abt.</TableHead>
              <TableHead className="w-28">Anfang</TableHead>
              <TableHead className="w-28">Ende</TableHead>
              <TableHead className="text-right">Stunden</TableHead>
              <TableHead className="text-right">Anteil</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Keine Mitarbeiter erfasst.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const share = sharesByStaff.get(r.staffId);
              const timeEditable =
                r.department === "service" ||
                (r.department === "kitchen" && Boolean(kitchenManualOnly));
              return (
                <PoolRow
                  key={r.staffId}
                  row={r}
                  share={share}
                  manual={manualSet.has(r.staffId)}
                  editable={editable}
                  timeEditable={timeEditable}
                  onToggleParticipates={(v) => void toggleParticipates(r, v)}
                  onRemove={() => void removeUnplanned(r.staffId)}
                  onSaveTimes={(shiftStart, shiftEnd) =>
                    callUpsert({
                      data: {
                        sessionId,
                        staffId: r.staffId,
                        department: r.department,
                        shiftStart,
                        shiftEnd,
                      },
                    }).then(() => {
                      toast.success("Zeit gespeichert.");
                      invalidatePool();
                    })
                  }
                />
              );
            })}
          </TableBody>
        </Table>
      </Card>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Trinkgeld-Pool</div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!editable || snapshotMut.isPending}
            onClick={() => snapshotMut.mutate()}
            title="Bestätigte Plan-Schichten ohne Eintrag in den Pool übernehmen (idempotent)."
          >
            {snapshotMut.isPending ? "Ergänze…" : "Aus Dienstplan ergänzen"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!editable}
            onClick={() => setEditOpen(true)}
          >
            Pool bearbeiten
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 md:flex-row">
        {renderTable(
          kitchenManualOnly
            ? "Küchen-Pool (manuell — Stempelzeiten der Küche werden ignoriert)"
            : "Küchen-Pool",
          kitchenRows,
        )}
        {renderTable("Service-Pool", serviceRows)}
      </div>

      {glEntries.length > 0 && (
        <Card className="opacity-80">
          <div className="border-b px-4 py-3 text-sm font-medium">
            Geschäftsleitung — GL, nicht poolbeteiligt{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (Arbeitszeit-Anker; keine Trinkgeld-Beteiligung)
            </span>
          </div>
          <Table className="text-muted-foreground">
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead className="w-32">Von</TableHead>
                <TableHead className="w-32">Bis</TableHead>
                <TableHead className="text-right">Stunden</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {glEntries.map((g) => (
                <GlRow
                  key={g.staffId}
                  entry={g}
                  editable={editable}
                  onSave={(shiftStart, shiftEnd) =>
                    callUpsert({
                      data: {
                        sessionId,
                        staffId: g.staffId,
                        department: "gl",
                        ...(shiftStart && shiftEnd
                          ? { shiftStart, shiftEnd }
                          : { hoursMinutes: 0 }),
                      },
                    }).then(invalidatePool)
                  }
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manuelle Pool-Einträge</DialogTitle>
            <DialogDescription>
              Manueller Eintrag ersetzt die Stempelzeiten dieses Mitarbeiters für die
              Pool-Verteilung. Stunden = 0 schließt jemanden explizit aus.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Abt.</TableHead>
                  <TableHead className="text-right">Stunden</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Noch keine manuellen Einträge.
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((e) => {
                  const h = Math.floor(e.hoursMinutes / 60);
                  const m = e.hoursMinutes % 60;
                  return (
                    <TableRow key={e.staffId}>
                      <TableCell>{data.staffNames[e.staffId] ?? e.staffId}</TableCell>
                      <TableCell>{e.department}</TableCell>
                      <TableCell className="text-right font-mono">
                        {e.shiftStart && e.shiftEnd
                          ? `${e.shiftStart}–${e.shiftEnd}`
                          : `${h}:${m.toString().padStart(2, "0")}`}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => deleteMut.mutate(e.staffId)}
                        >
                          <X className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="grid grid-cols-12 items-end gap-2 border-t pt-3">
              <div className="col-span-5">
                <Label className="text-xs">Mitarbeiter</Label>
                <Select
                  value={draft.staffId}
                  onValueChange={(v) => setDraft({ ...draft, staffId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Abt.</Label>
                <Select
                  value={draft.department}
                  onValueChange={(v) =>
                    setDraft({ ...draft, department: v as "kitchen" | "service" | "gl" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">service</SelectItem>
                    <SelectItem value="kitchen">kitchen</SelectItem>
                    <SelectItem value="gl">gl (ohne Trinkgeld)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.department === "service" ||
              draft.department === "gl" ||
              (draft.department === "kitchen" && kitchenManualOnly) ? (
                <>
                  <div className="col-span-2">
                    <Label className="text-xs">Von</Label>
                    <Input
                      type="time"
                      value={draft.shiftStart}
                      onChange={(e) => setDraft({ ...draft, shiftStart: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Bis</Label>
                    <Input
                      type="time"
                      value={draft.shiftEnd}
                      onChange={(e) => setDraft({ ...draft, shiftEnd: e.target.value })}
                    />
                  </div>
                  {draft.shiftStart && draft.shiftEnd && (
                    <div className="col-span-12 -mt-1 text-xs text-muted-foreground">
                      Dauer:{" "}
                      {(() => {
                        try {
                          const mins = kitchenShiftMinutes(draft.shiftStart, draft.shiftEnd);
                          const hh = Math.floor(mins / 60);
                          const mm = mins % 60;
                          return `${hh}:${mm.toString().padStart(2, "0")} h`;
                        } catch {
                          return "ungültig";
                        }
                      })()}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="col-span-2">
                    <Label className="text-xs">Std.</Label>
                    <Input
                      inputMode="numeric"
                      value={draft.hours}
                      onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Min.</Label>
                    <Input
                      inputMode="numeric"
                      value={draft.minutes}
                      onChange={(e) => setDraft({ ...draft, minutes: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Schließen
            </Button>
            <Button
              onClick={() => upsertMut.mutate()}
              disabled={!draft.staffId || upsertMut.isPending}
            >
              {upsertMut.isPending ? "Speichert…" : "Eintrag speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GlRow({
  entry,
  editable,
  onSave,
}: {
  entry: {
    staffId: string;
    displayName: string;
    shiftStart: string | null;
    shiftEnd: string | null;
    hoursMinutes: number;
  };
  editable: boolean;
  onSave: (shiftStart: string, shiftEnd: string) => Promise<unknown>;
}) {
  return <GlRowInner entry={entry} editable={editable} onSave={onSave} />;
}

type PoolRowData = {
  staffId: string;
  displayName: string;
  department: "kitchen" | "service";
  hoursMinutes: number;
  shiftStart: string | null;
  shiftEnd: string | null;
  participates: boolean;
  participatesOverride: boolean | null;
  notInPlan: boolean;
  removable: boolean;
  removalBlockedReason: string | null;
};

function PoolRow({
  row,
  share,
  manual,
  editable,
  timeEditable,
  onToggleParticipates,
  onSaveTimes,
  onRemove,
}: {
  row: PoolRowData;
  share: { hoursWorked: number; shareCents: number } | undefined;
  manual: boolean;
  editable: boolean;
  timeEditable: boolean;
  onToggleParticipates: (v: boolean) => void;
  onSaveTimes: (shiftStart: string, shiftEnd: string) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [start, setStart] = useState(row.shiftStart ?? "");
  const [end, setEnd] = useState(row.shiftEnd ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = start !== (row.shiftStart ?? "") || end !== (row.shiftEnd ?? "");

  let hoursDisplay: string;
  if (dirty && start && end) {
    try {
      const m = kitchenShiftMinutes(start, end);
      hoursDisplay = minutesToHm(m);
    } catch {
      hoursDisplay = "ungültig";
    }
  } else if (share) {
    hoursDisplay = minutesToHm(Math.round(share.hoursWorked * 60));
  } else {
    hoursDisplay = minutesToHm(row.hoursMinutes);
  }

  return (
    <TableRow>
      <TableCell>
        {row.displayName}
        {manual && (
          <Badge variant="secondary" className="ml-2">
            manuell
          </Badge>
        )}
        {row.participatesOverride === null ? null : (
          <Badge variant="outline" className="ml-2">
            übersteuert
          </Badge>
        )}
        {/* ZS1 — Badge ist für jeden sichtbar, der die Liste sieht; der
            Entfernen-Klick gehorcht den bestehenden Schreibrechten. */}
        {row.notInPlan && (
          <span className="ml-2 inline-flex items-center gap-1 align-middle">
            <Badge
              variant="outline"
              className="border-amber-500 text-amber-700"
              title={row.removalBlockedReason ?? "Keine Plan-Schicht mehr für diesen Tag."}
            >
              nicht mehr im Plan
            </Badge>
            {row.removable && editable && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Unberührten Eintrag entfernen"
                aria-label="Unberührten Eintrag entfernen"
                onClick={onRemove}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={row.participates}
          disabled={!editable}
          onCheckedChange={onToggleParticipates}
          aria-label="Im Pool"
        />
      </TableCell>
      <TableCell>{row.department}</TableCell>
      <TableCell>
        {timeEditable ? (
          <Input
            type="time"
            value={start}
            disabled={!editable}
            onChange={(e) => setStart(e.target.value)}
          />
        ) : (
          <span className="font-mono text-sm">{row.shiftStart ?? "—"}</span>
        )}
      </TableCell>
      <TableCell>
        {timeEditable ? (
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={end}
              disabled={!editable}
              onChange={(e) => setEnd(e.target.value)}
            />
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                disabled={!editable || saving || !start || !end}
                onClick={() => {
                  setSaving(true);
                  void Promise.resolve(onSaveTimes(start, end)).finally(() => setSaving(false));
                }}
              >
                {saving ? "…" : "OK"}
              </Button>
            )}
          </div>
        ) : (
          <span className="font-mono text-sm">{row.shiftEnd ?? "—"}</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono">{hoursDisplay}</TableCell>
      <TableCell className="text-right font-mono">
        {share ? fmtCents(share.shareCents) : "—"}
      </TableCell>
    </TableRow>
  );
}

function GlRowInner({
  entry,
  editable,
  onSave,
}: {
  entry: {
    staffId: string;
    displayName: string;
    shiftStart: string | null;
    shiftEnd: string | null;
    hoursMinutes: number;
  };
  editable: boolean;
  onSave: (shiftStart: string, shiftEnd: string) => Promise<unknown>;
}) {
  const [start, setStart] = useState(entry.shiftStart ?? "");
  const [end, setEnd] = useState(entry.shiftEnd ?? "");
  const dirty = start !== (entry.shiftStart ?? "") || end !== (entry.shiftEnd ?? "");
  let preview = `${Math.floor(entry.hoursMinutes / 60)}:${(entry.hoursMinutes % 60)
    .toString()
    .padStart(2, "0")}`;
  if (start && end) {
    try {
      const m = kitchenShiftMinutes(start, end);
      preview = `${Math.floor(m / 60)}:${(m % 60).toString().padStart(2, "0")}`;
    } catch {
      preview = "ungültig";
    }
  }
  return (
    <TableRow>
      <TableCell>{entry.displayName}</TableCell>
      <TableCell>
        <Input
          type="time"
          value={start}
          disabled={!editable}
          onChange={(e) => setStart(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="time"
          value={end}
          disabled={!editable}
          onChange={(e) => setEnd(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-right font-mono">
        <div className="flex items-center justify-end gap-2">
          <span>{preview}</span>
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={!editable}
              onClick={() => {
                void onSave(start, end).then(() => toast.success("GL-Zeit gespeichert."));
              }}
            >
              Speichern
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
