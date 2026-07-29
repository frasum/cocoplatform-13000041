import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listStaff,
  listStaffPersonalSummary,
  setStaffRole,
  setStaffLocationDepartment,
} from "@/lib/admin/staff.functions";
import { assignStaffSkills, listSkills } from "@/lib/admin/skills.functions";
import { listLocations } from "@/lib/admin/locations.functions";
import {
  getSofortmeldungOverview,
  getSofortmeldungDetail,
} from "@/lib/sofortmeldung/sofortmeldung.functions";
import type { SofortmeldungStatus } from "@/lib/sofortmeldung/sofortmeldung-rules";
import {
  distinctDepartments,
  ineligibleSkills,
  type StaffDepartment,
} from "@/lib/admin/skill-eligibility";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Users, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/admin/role-guard";
import { computeAgeYears } from "@/lib/profile/age";
import { SkillAssignPopover } from "@/components/admin/SkillAssignPopover";
import {
  listOrphanAuthAccounts,
  type OrphanAuthAccount,
} from "@/lib/admin/orphan-accounts.functions";

function formatTenure(startDate: string | null | undefined): string | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null;
  return `${years}-${months}`;
}

export const Route = createFileRoute("/_authenticated/admin/staff/")({
  head: () => ({ meta: [{ title: "Mitarbeiter · Verwaltung" }] }),
  component: StaffListPage,
});

const ROLE_OPTIONS: { value: AppRole | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "planer", label: "Planer" },
  { value: "payroll", label: "Payroll" },
  { value: "staff", label: "Staff" },
];

const DEPARTMENT_ORDER: StaffDepartment[] = ["service", "kitchen", "gl"];
const DEPARTMENT_SHORT: Record<StaffDepartment, string> = {
  service: "S",
  kitchen: "K",
  gl: "GL",
};
const DEPARTMENT_LABEL: Record<StaffDepartment, string> = {
  service: "Service",
  kitchen: "Küche",
  gl: "Geschäftsleitung",
};
const DEPARTMENT_ACTIVE_CLASS: Record<StaffDepartment, string> = {
  service: "border-dept-service bg-dept-service text-dept-service-foreground",
  kitchen: "border-dept-kitchen bg-dept-kitchen text-dept-kitchen-foreground",
  gl: "border-dept-gl bg-dept-gl text-dept-gl-foreground",
};

type StaffRow = NonNullable<Awaited<ReturnType<typeof listStaff>>>[number];
type SkillRow = Awaited<ReturnType<typeof listSkills>>[number];
type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];

type DeptFilter = "all" | "service" | "kitchen";

function SofortmeldungDot({ staffId, status }: { staffId: string; status: SofortmeldungStatus }) {
  const [open, setOpen] = useState(false);
  const callDetail = useServerFn(getSofortmeldungDetail);
  const enabled = open && status === "unvollstaendig";
  const detailQ = useQuery({
    queryKey: ["admin", "sofortmeldung-detail", staffId],
    queryFn: () => callDetail({ data: { staffId } }),
    enabled,
    staleTime: 30_000,
  });
  if (status !== "unvollstaendig" && status !== "bereit") return null;
  const dotCls = status === "unvollstaendig" ? "bg-destructive" : "bg-amber-500 dark:bg-amber-400";
  const label =
    status === "unvollstaendig"
      ? "Sofortmeldung unvollständig"
      : "Sofortmeldung noch nicht gemeldet";
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={cn("inline-block h-2 w-2 flex-shrink-0 rounded-full", dotCls)}
        />
      </TooltipTrigger>
      <TooltipContent>
        {status === "bereit" ? (
          <p className="text-xs">Sofortmeldung noch nicht gemeldet</p>
        ) : detailQ.isLoading ? (
          <p className="text-xs">Lade…</p>
        ) : detailQ.data && detailQ.data.missingFields.length > 0 ? (
          <div className="text-xs">
            <p className="mb-1 font-medium">Fehlende Pflichtfelder:</p>
            <ul className="list-disc pl-4">
              {detailQ.data.missingFields.map((f) => (
                <li key={f.key}>{f.label}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs">Pflichtfelder fehlen</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function StaffListPage() {
  const { identity } = useRouteContext({ from: "/_authenticated/admin" });
  const isAdmin = identity.role === "admin";
  const queryClient = useQueryClient();

  const staffQ = useQuery({ queryKey: ["admin", "staff"], queryFn: () => listStaff() });
  // SD1b — Tenure/Alter kommen aus dediziertem admin/payroll-Reader,
  // damit listStaff keine Personaldaten mehr transportiert.
  const personalSummaryQ = useQuery({
    queryKey: ["admin", "staff-personal-summary"],
    queryFn: () => listStaffPersonalSummary(),
  });
  const personalByStaff = useMemo(() => {
    const m = new Map<string, { employmentStartDate: string | null; dateOfBirth: string | null }>();
    for (const r of personalSummaryQ.data ?? [])
      m.set(r.staffId, {
        employmentStartDate: r.employmentStartDate,
        dateOfBirth: r.dateOfBirth,
      });
    return m;
  }, [personalSummaryQ.data]);
  const skillsQ = useQuery({
    queryKey: ["admin", "skills"],
    queryFn: () => listSkills(),
    enabled: isAdmin,
  });
  const locationsQ = useQuery({
    queryKey: ["admin", "locations"],
    queryFn: () => listLocations(),
    enabled: isAdmin,
  });
  const sofortQ = useQuery({
    queryKey: ["admin", "sofortmeldung-overview"],
    queryFn: () => getSofortmeldungOverview(),
    enabled: isAdmin,
  });
  const sofortBy = useMemo(() => {
    const m = new Map<string, SofortmeldungStatus>();
    for (const r of sofortQ.data ?? []) m.set(r.staffId, r.status);
    return m;
  }, [sofortQ.data]);
  const sofortAlert = useMemo(
    () =>
      (sofortQ.data ?? []).filter((r) => r.status === "unvollstaendig" || r.status === "bereit")
        .length,
    [sofortQ.data],
  );

  // AC2 — Verwaiste Auth-Konten (nur Admin).
  const orphansQ = useQuery({
    queryKey: ["admin", "orphan-accounts"],
    queryFn: () => listOrphanAuthAccounts(),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const orphans = orphansQ.data ?? [];

  const [activeGroup, setActiveGroup] = useState<"active" | "inactive">("active");
  const [search, setSearch] = useState("");
  const [deptTab, setDeptTab] = useState<DeptFilter>("all");

  const data = useMemo(() => staffQ.data ?? [], [staffQ.data]);
  const skills = useMemo(() => skillsQ.data ?? [], [skillsQ.data]);
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);

  const activeCount = useMemo(() => data.filter((s) => s.isActive).length, [data]);
  const inactiveCount = useMemo(() => data.filter((s) => !s.isActive).length, [data]);
  const groupData = useMemo(
    () => data.filter((s) => (activeGroup === "active" ? s.isActive : !s.isActive)),
    [data, activeGroup],
  );
  const groupTotal = groupData.length;
  const serviceCount = useMemo(
    () => groupData.filter((s) => s.departments.includes("service")).length,
    [groupData],
  );
  const kitchenCount = useMemo(
    () => groupData.filter((s) => s.departments.includes("kitchen")).length,
    [groupData],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupData
      .filter((s) => {
        if (deptTab === "all") return true;
        return s.departments.includes(deptTab);
      })
      .filter((s) => {
        if (!q) return true;
        const name = s.displayName?.toLowerCase() ?? "";
        const first = s.firstName?.toLowerCase() ?? "";
        const last = s.lastName?.toLowerCase() ?? "";
        // SD1 — Kontaktdaten (email/phone) sind nicht mehr Teil von listStaff;
        // Suche greift auf Anzeigename + Vor-/Nachname.
        return name.includes(q) || first.includes(q) || last.includes(q);
      })
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [groupData, deptTab, search]);

  // --- Server-Function calls (Logik unverändert) ---
  const callSetDept = useServerFn(setStaffLocationDepartment);
  const callAssignSkills = useServerFn(assignStaffSkills);
  // setStaffActive-Aufruf bleibt im Stammblatt; hier nur Listen-UI.

  const deptMutation = useMutation({
    mutationFn: (v: {
      staffId: string;
      locationId: string;
      department: StaffDepartment;
      enabled: boolean;
    }) =>
      callSetDept({
        data: {
          staffId: v.staffId,
          locationId: v.locationId,
          department: v.department,
          enabled: v.enabled,
        },
      }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ["admin", "staff"] });
      const previous = queryClient.getQueryData(["admin", "staff"]);
      queryClient.setQueryData<unknown>(["admin", "staff"], (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return (old as StaffRow[]).map((row) => {
          if (row.id !== v.staffId) return row;
          const has = row.locationDepartments.some(
            (r) => r.locationId === v.locationId && r.department === v.department,
          );
          const nextLD = v.enabled
            ? has
              ? row.locationDepartments
              : [...row.locationDepartments, { locationId: v.locationId, department: v.department }]
            : row.locationDepartments.filter(
                (r) => !(r.locationId === v.locationId && r.department === v.department),
              );
          return {
            ...row,
            locationDepartments: nextLD,
            departments: distinctDepartments(nextLD),
          };
        });
      });
      return { previous };
    },
    onError: (err: unknown, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(["admin", "staff"], ctx.previous);
      }
      toast.error(err instanceof Error ? err.message : "Fehler.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
  });

  const skillMutation = useMutation({
    mutationFn: (v: { staffId: string; skillIds: string[] }) =>
      callAssignSkills({ data: { staffId: v.staffId, skillIds: v.skillIds } }),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ["admin", "staff"] });
      const previous = queryClient.getQueryData(["admin", "staff"]);
      queryClient.setQueryData<unknown>(["admin", "staff"], (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return (old as StaffRow[]).map((row) =>
          row.id === v.staffId ? { ...row, skillIds: v.skillIds } : row,
        );
      });
      return { previous };
    },
    onError: (err: unknown, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(["admin", "staff"], ctx.previous);
      }
      toast.error(err instanceof Error ? err.message : "Fehler.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
  });

  function toggleDept(
    staffId: string,
    locationId: string,
    department: StaffDepartment,
    active: boolean,
  ) {
    deptMutation.mutate({ staffId, locationId, department, enabled: !active });
  }

  function saveSkills(staffId: string, skillIds: string[]) {
    skillMutation.mutate({ staffId, skillIds });
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 sm:p-8">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-2xl font-bold lg:text-3xl">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                Mitarbeiterverwaltung
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {activeCount} Mitarbeiter · {serviceCount} Service · {kitchenCount} Küche
                {inactiveCount > 0 && (
                  <span className="text-muted-foreground/60"> · {inactiveCount} inaktiv</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                to="/admin/staff/new"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Neuer Mitarbeiter
              </Link>
            </div>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="pl-8"
              aria-label="Mitarbeiter suchen"
            />
          </div>
          <div className="flex items-center gap-3">
            <Tabs
              value={activeGroup}
              onValueChange={(v) => setActiveGroup(v as "active" | "inactive")}
            >
              <TabsList>
                <TabsTrigger value="active">Aktive ({activeCount})</TabsTrigger>
                <TabsTrigger value="inactive">Inaktive ({inactiveCount})</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={deptTab} onValueChange={(v) => setDeptTab(v as DeptFilter)}>
              <TabsList>
                <TabsTrigger value="all">Alle ({groupTotal})</TabsTrigger>
                <TabsTrigger value="service">Service ({serviceCount})</TabsTrigger>
                <TabsTrigger value="kitchen">Küche ({kitchenCount})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {staffQ.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
        {staffQ.error && <p className="text-sm text-destructive">Fehler beim Laden.</p>}

        {isAdmin && sofortAlert > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {sofortAlert} aktive/r Mitarbeiter mit offener Sofortmeldung (unvollständig oder noch
            nicht in sv.net gemeldet).
          </div>
        )}

        {isAdmin && orphans.length > 0 && <OrphanAccountsCard orphans={orphans} />}

        {/* Matrix */}
        {!staffQ.isLoading && !staffQ.error && (
          <Card className="overflow-hidden">
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead className="sticky left-0 z-20 min-w-[180px] bg-muted">
                      Name
                    </TableHead>
                    <TableHead className="min-w-[120px]">Berechtigung</TableHead>
                    {locations.map((loc) => (
                      <TableHead key={loc.id} className="min-w-[120px] text-center">
                        <div className="font-medium text-foreground">{loc.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Abteilung
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="min-w-[260px]">Skills</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <StaffMatrixRow
                      key={s.id}
                      staff={s}
                      locations={locations}
                      skills={skills}
                      isAdmin={isAdmin}
                      sofortStatus={sofortBy.get(s.id) ?? null}
                      deptPending={deptMutation.isPending}
                      skillPending={skillMutation.isPending}
                      onToggleDept={toggleDept}
                      onSaveSkills={saveSkills}
                      employmentStartDate={personalByStaff.get(s.id)?.employmentStartDate ?? null}
                      dateOfBirth={personalByStaff.get(s.id)?.dateOfBirth ?? null}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3 + locations.length}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {data.length > 0 ? "Keine Treffer." : "Noch keine Mitarbeiter."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}

function StaffMatrixRow({
  staff,
  locations,
  skills,
  isAdmin,
  sofortStatus,
  deptPending,
  skillPending,
  onToggleDept,
  onSaveSkills,
  employmentStartDate,
  dateOfBirth,
}: {
  staff: StaffRow;
  locations: LocationRow[];
  skills: SkillRow[];
  isAdmin: boolean;
  sofortStatus: SofortmeldungStatus | null;
  deptPending: boolean;
  skillPending: boolean;
  onToggleDept: (
    staffId: string,
    locationId: string,
    department: StaffDepartment,
    active: boolean,
  ) => void;
  onSaveSkills: (staffId: string, skillIds: string[]) => void;
  employmentStartDate: string | null;
  dateOfBirth: string | null;
}) {
  const heldSkills = useMemo(
    () =>
      staff.skillIds
        .map((id) => skills.find((sk) => sk.id === id))
        .filter((sk): sk is SkillRow => sk !== undefined)
        .map((sk) => ({ id: sk.id, name: sk.name, category: sk.category })),
    [staff.skillIds, skills],
  );

  const isPayroll = staff.role === "payroll";

  return (
    <TableRow className={cn("group", !staff.isActive && "opacity-50")}>
      {/* Name (sticky) */}
      <TableCell className="sticky left-0 z-10 bg-background group-hover:bg-muted/50">
        <div className="flex items-center gap-1.5">
          {isAdmin && sofortStatus && <SofortmeldungDot staffId={staff.id} status={sofortStatus} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={staff.hasAccount ? "Online-Konto vorhanden" : "Kein Online-Konto"}
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-full",
                  staff.hasAccount ? "text-emerald-600" : "text-muted-foreground/50",
                )}
              >
                {staff.hasAccount ? (
                  <UserCheck className="h-3.5 w-3.5" />
                ) : (
                  <UserX className="h-3.5 w-3.5" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {staff.hasAccount ? "Online-Konto eingerichtet" : "Noch kein Online-Konto"}
              </p>
            </TooltipContent>
          </Tooltip>
          <Link
            to="/admin/staff/$staffId"
            params={{ staffId: staff.id }}
            className="font-medium text-foreground hover:underline"
          >
            {staff.displayName}
            {formatTenure(employmentStartDate) && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({formatTenure(employmentStartDate)})
              </span>
            )}
            {computeAgeYears(dateOfBirth) !== null && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({computeAgeYears(dateOfBirth)})
              </span>
            )}
          </Link>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {[staff.firstName, staff.lastName].filter(Boolean).join(" ") || "—"}
          </span>
          {!staff.isActive && (
            <Badge variant="outline" className="text-[10px]">
              Inaktiv
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Berechtigung */}
      <TableCell>
        {isAdmin ? (
          <RoleCell staffId={staff.id} role={staff.role} />
        ) : (
          <span className="text-muted-foreground">{staff.role ?? "—"}</span>
        )}
      </TableCell>

      {/* Eine Spalte pro Standort */}
      {locations.map((loc) => (
        <TableCell key={loc.id} className="py-2 text-center">
          {isPayroll ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex items-center justify-center gap-1">
              {DEPARTMENT_ORDER.map((dept) => {
                const active = staff.locationDepartments.some(
                  (ld) => ld.locationId === loc.id && ld.department === dept,
                );
                const rowsAfter = staff.locationDepartments.filter(
                  (ld) => !(ld.locationId === loc.id && ld.department === dept),
                );
                const blocking = active
                  ? ineligibleSkills(heldSkills, distinctDepartments(rowsAfter))
                  : [];
                const disabled = !isAdmin || deptPending || (active && blocking.length > 0);
                const tooltip =
                  active && blocking.length > 0
                    ? `Benötigt von Skill: ${blocking.map((b) => b.name).join(", ")}`
                    : active
                      ? `${DEPARTMENT_LABEL[dept]} entfernen`
                      : `${DEPARTMENT_LABEL[dept]} zuweisen`;
                return (
                  <Tooltip key={dept}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={`${loc.name} · ${DEPARTMENT_LABEL[dept]}`}
                        disabled={disabled}
                        onClick={() => onToggleDept(staff.id, loc.id, dept, active)}
                        className={cn(
                          "inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border px-1.5 text-[11px] font-bold transition-all",
                          active
                            ? `${DEPARTMENT_ACTIVE_CLASS[dept]} shadow-sm`
                            : "border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground",
                          disabled && "cursor-not-allowed",
                          disabled && !active && "opacity-40",
                        )}
                      >
                        {DEPARTMENT_SHORT[dept]}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </TableCell>
      ))}

      {/* Skill-Chips */}
      <TableCell>
        {isPayroll ? (
          <span className="text-xs text-muted-foreground">Lohnbüro – keine Bereiche/Skills</span>
        ) : isAdmin ? (
          <SkillAssignPopover
            skills={skills}
            currentIds={staff.skillIds}
            pending={skillPending}
            onSave={(next) => onSaveSkills(staff.id, next)}
            trigger={
              <button
                type="button"
                aria-label="Skills bearbeiten"
                className="flex min-h-[32px] w-full flex-wrap items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left hover:border-border hover:bg-muted/40"
              >
                {heldSkills.length === 0 ? (
                  <span className="text-xs text-muted-foreground">+ Skills wählen</span>
                ) : (
                  <>
                    {heldSkills.map((sk) => {
                      const meta = skills.find((m) => m.id === sk.id);
                      const color = meta?.color ?? undefined;
                      return (
                        <span
                          key={sk.id}
                          className="inline-flex min-w-[36px] items-center justify-center rounded-md border-2 px-2 py-0.5 text-xs font-bold"
                          style={
                            color
                              ? { backgroundColor: color, borderColor: color, color: "#fff" }
                              : { borderColor: "hsl(var(--border))" }
                          }
                        >
                          {sk.name}
                        </span>
                      );
                    })}
                    <span
                      aria-hidden="true"
                      className="inline-flex min-w-[36px] items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs font-bold text-muted-foreground"
                    >
                      +
                    </span>
                  </>
                )}
              </button>
            }
          />
        ) : (
          <span className="text-muted-foreground">
            {staff.skillIds.length > 0 ? `${staff.skillIds.length} Skills` : "—"}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function RoleCell({ staffId, role }: { staffId: string; role: AppRole | null }) {
  const queryClient = useQueryClient();
  const callSetRole = useServerFn(setStaffRole);
  const mutation = useMutation({
    mutationFn: (next: AppRole | null) => callSetRole({ data: { staffId, role: next } }),
    onSuccess: async () => {
      toast.success("Rolle gespeichert.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "staff"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Fehler."),
  });
  return (
    <select
      className="rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
      value={role ?? ""}
      disabled={mutation.isPending}
      onChange={(e) => {
        const v = e.target.value;
        mutation.mutate(v === "" ? null : (v as AppRole));
      }}
      aria-label="Rolle"
    >
      {ROLE_OPTIONS.map((o) => (
        <option key={o.value || "none"} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// AC2 — Panel: Auth-Konten, die nicht als Mitarbeiter dieser Organisation
// verknüpft sind. Rein informativ; keine Aktionen (Verknüpfen/Löschen läuft
// über Einladung im Stammblatt bzw. das Supabase-Dashboard).
function OrphanAccountsCard({ orphans }: { orphans: OrphanAuthAccount[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-amber-300/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <UserX className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-medium">Anmeldungen ohne Mitarbeiter</span>
          <Badge variant="outline" className="text-xs">
            {orphans.length}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "Ausblenden" : "Anzeigen"}</span>
      </button>
      {open && (
        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-Mail</TableHead>
                <TableHead className="min-w-[140px]">Angelegt</TableHead>
                <TableHead className="min-w-[160px]">Letzte Anmeldung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orphans.map((o) => (
                <TableRow key={o.userId}>
                  <TableCell className="font-mono text-xs">{o.email ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.createdAt ? new Date(o.createdAt).toLocaleString("de-DE") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.lastSignInAt ? new Date(o.lastSignInAt).toLocaleString("de-DE") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Diese Konten existieren in der Anmeldung, sind aber keinem Mitarbeiter zugeordnet. Über
            „Neuer Mitarbeiter" oder die Einladung im Stammblatt lässt sich das Konto zuordnen.
          </p>
        </div>
      )}
    </Card>
  );
}
