// TRMNL1 — Stille, token-geschützte HTML-Route für das E-Ink-Display
// TRMNL X (1872×1404, 16 Graustufen). Pfad /api/public/* umgeht die
// Publishing-Auth; einzige Sicherheit ist ein zufälliges Token, das pro
// Organisation in `organizations.trmnl_token` liegt (siehe Migration).
// Token wird timing-safe verglichen; bei jedem Fehler generisch 404.
//
// Datenfluss (paged, BFIX2):
// - Handlungspunkte: leave_requests(offen), shift_swap_requests(open|peer_accepted),
//   day_off_wishes(wish_date >= today), orders(email_sent=false, status!=cancelled)
// - Aufgaben: tasks(status IN open|in_progress), Standort-Namen dazu
// - Personal: roster_shifts + staff.display_name + locations.name + roster_absence,
//   Zieltag laut resolveRosterTarget (Umschlag 20:00 Europe/Berlin)
//
// Reine Aufbereitung liegt in src/lib/trmnl/board.ts (mit Vitest getestet).

import { createFileRoute } from "@tanstack/react-router";
import { TASK_CATEGORY_LABEL, TASK_STATUS_LABEL, type Task } from "@/lib/aufgaben/types";
import { todayIso as todayIsoBerlin } from "@/lib/format";
import { selectAllPaged } from "@/lib/supabase/select-all";
import { getHolidayName } from "@/lib/roster/holidays-display";
import {
  actionBadges,
  buildBoard,
  ellipsize,
  groupRosterByLocation,
  isOverdue,
  resolveRosterTarget,
  truncateNames,
  type RosterShiftLite,
} from "@/lib/trmnl/board";
import { ABSENCE_TYPE_FILTER } from "@/lib/roster/absence-types";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

// Hash-Lookup ersetzt den früheren timing-safe Klartext-Vergleich.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

export const Route = createFileRoute("/api/public/trmnl-tasks/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = String(params.token ?? "");
        if (token.length < 16 || token.length > 256) return notFound();

        const url = new URL(request.url);
        const columnsParam = url.searchParams.get("columns");
        const showAll = columnsParam === "all";
        const sizeParam = url.searchParams.get("size");
        const isSmall = sizeParam === "small";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Lookup ausschließlich über den Hash — der Klartext liegt nicht
        // mehr in der DB.
        const { createHash } = await import("node:crypto");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        type OrgTokenRow = { id: string; name: string };
        type OrgQuery = {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              maybeSingle: () => Promise<{
                data: OrgTokenRow | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
        const orgQ = supabaseAdmin.from("organizations") as unknown as OrgQuery;
        const { data: orgRow, error: orgErr } = await orgQ
          .select("id, name")
          .eq("trmnl_token_hash", tokenHash)
          .maybeSingle();
        if (orgErr || !orgRow) return notFound();

        const orgId = orgRow.id;
        const orgName = orgRow.name;
        const now = new Date();
        const nowIso = now.toISOString();
        const target = resolveRosterTarget(now);
        const today = todayIsoBerlin();

        // ------- Handlungspunkte (Zähler, paged) -------
        const [openLeavesRes, openSwapsRes, wishesRes, unsentOrdersRes] = await Promise.all([
          supabaseAdmin
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "offen"),
          supabaseAdmin
            .from("shift_swap_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["open", "peer_accepted"]),
          supabaseAdmin
            .from("day_off_wishes")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .gte("wish_date", today),
          supabaseAdmin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("email_sent", false)
            .neq("status", "cancelled"),
        ]);

        const badges = actionBadges({
          openLeaves: openLeavesRes.count ?? 0,
          openSwaps: openSwapsRes.count ?? 0,
          futureWishes: wishesRes.count ?? 0,
          unsentOrders: unsentOrdersRes.count ?? 0,
        });

        // ------- Aufgaben (paged) -------
        const statusFilter = showAll
          ? (["open", "in_progress", "done", "cancelled"] as const)
          : (["open", "in_progress"] as const);
        const tasks = await selectAllPaged<Task>(
          (from, to) =>
            supabaseAdmin
              .from("tasks")
              .select("*")
              .eq("organization_id", orgId)
              .in("status", [...statusFilter])
              .is("archived_at", null)
              .order("id")
              .range(from, to),
          500,
        );

        // Erledigt/Abgebrochen heute – nur als Zähler in der Fußzeile.
        const [doneRes, cancelledRes] = await Promise.all([
          supabaseAdmin
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "done")
            .gte("completed_at", `${today}T00:00:00`),
          supabaseAdmin
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "cancelled")
            .gte("updated_at", `${today}T00:00:00`),
        ]);

        // Standort-Kürzel für Karten & Roster-Blocks.
        const locationIds = Array.from(
          new Set(tasks.map((t) => t.location_id).filter((x): x is string => !!x)),
        );

        // ------- Personal für Zieltag -------
        const shiftsRaw = await selectAllPaged<{
          staff_id: string;
          location_id: string;
          area: string;
          service_period: string | null;
        }>(
          (from, to) =>
            supabaseAdmin
              .from("roster_shifts")
              .select("staff_id, location_id, area, service_period")
              .eq("organization_id", orgId)
              .eq("shift_date", target.iso)
              .order("staff_id")
              .range(from, to),
          500,
        );

        const absencesRaw = await selectAllPaged<{ staff_id: string; type: string }>(
          (from, to) =>
            supabaseAdmin
              .from("roster_absence")
              .select("staff_id, type")
              .eq("organization_id", orgId)
              .eq("date", target.iso)
              .in("type", ABSENCE_TYPE_FILTER)
              .order("staff_id")
              .range(from, to),
          500,
        );
        const absentStaffIds = new Set(absencesRaw.map((a) => a.staff_id));

        const staffIds = Array.from(new Set(shiftsRaw.map((s) => s.staff_id)));
        const rosterLocationIds = Array.from(new Set(shiftsRaw.map((s) => s.location_id)));
        const allLocIds = Array.from(new Set([...locationIds, ...rosterLocationIds]));

        const [staffRes, locRes] = await Promise.all([
          staffIds.length
            ? supabaseAdmin
                .from("staff")
                .select("id, display_name")
                .eq("organization_id", orgId)
                .in("id", staffIds)
            : Promise.resolve({ data: [] as { id: string; display_name: string }[], error: null }),
          allLocIds.length
            ? supabaseAdmin
                .from("locations")
                .select("id, name")
                .eq("organization_id", orgId)
                .in("id", allLocIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        ]);
        const staffNames = new Map<string, string>();
        for (const s of staffRes.data ?? []) staffNames.set(s.id, s.display_name ?? "—");
        const locationNames = new Map<string, string>();
        for (const l of locRes.data ?? []) locationNames.set(l.id, l.name);

        const rosterShifts: RosterShiftLite[] = shiftsRaw.map((s) => ({
          staffId: s.staff_id,
          locationId: s.location_id,
          area: s.area,
          servicePeriod: s.service_period,
        }));
        const rosterBlocks = groupRosterByLocation({
          shifts: rosterShifts,
          staffNames,
          locationNames,
          absentStaffIds,
        });

        // ------- Kanban -------
        const COLUMN_LIMIT = 6;
        const board = buildBoard(
          tasks,
          COLUMN_LIMIT,
          showAll
            ? (["open", "in_progress", "done", "cancelled"] as const)
            : (["open", "in_progress"] as const),
        );

        const renderInput: RenderInput = {
          orgName,
          nowIso,
          targetLabel: target.label,
          targetIso: target.iso,
          targetDateHuman: formatDate(target.iso),
          badges,
          rosterBlocks,
          board,
          locationNames,
          now,
          doneToday: doneRes.count ?? 0,
          cancelledToday: cancelledRes.count ?? 0,
        };
        const html = isSmall ? renderPageSmall(renderInput) : renderPage(renderInput);

        return new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});

type RenderInput = {
  orgName: string;
  nowIso: string;
  targetLabel: string;
  targetIso: string;
  targetDateHuman: string;
  badges: ReturnType<typeof actionBadges>;
  rosterBlocks: ReturnType<typeof groupRosterByLocation>;
  board: ReturnType<typeof buildBoard>;
  locationNames: Map<string, string>;
  now: Date;
  doneToday: number;
  cancelledToday: number;
};

function renderPage(input: RenderInput): string {
  const timeStr = input.now.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const badgesHtml = input.badges.length
    ? input.badges
        .map((b) => {
          const cls = b.emphasize ? "badge badge-emph" : "badge";
          return `<span class="${cls}">${escapeHtml(b.icon)} <b>${b.count}</b> ${escapeHtml(b.label)}</span>`;
        })
        .join("")
    : `<span class="muted">Keine offenen Vorgänge — alles erledigt.</span>`;

  const rosterHtml = input.rosterBlocks.length
    ? input.rosterBlocks
        .map((b) => {
          const groupsHtml = b.groups
            .map(
              (g) =>
                `<div class="roster-group"><div class="roster-group-head">${escapeHtml(g.areaLabel)} <span class="count">${g.names.length}</span></div><div class="roster-names">${g.names.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join("")}</div></div>`,
            )
            .join("");
          return `<div class="roster-loc"><div class="roster-loc-head"><b>${escapeHtml(b.locationName)}</b> <span class="count">${b.total}</span></div>${groupsHtml || '<div class="muted">— keine Einteilung —</div>'}</div>`;
        })
        .join("")
    : `<div class="muted">— keine Einteilung —</div>`;

  const columnsHtml = input.board
    .map((col) => {
      const cardsHtml = col.visible
        .map((t) => {
          const overdue = isOverdue(t.due_at, input.now);
          const cls = ["card", overdue ? "overdue" : "", t.priority >= 2 ? "prio" : ""]
            .filter(Boolean)
            .join(" ");
          const loc = input.locationNames.get(t.location_id) ?? "—";
          const due = formatDue(t.due_at);
          const meta = [
            escapeHtml(loc),
            escapeHtml(TASK_CATEGORY_LABEL[t.category]),
            due ? escapeHtml(due) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return `<div class="${cls}"><div class="card-title">${overdue ? "! " : ""}${escapeHtml(t.title)}</div><div class="card-meta">${meta}</div></div>`;
        })
        .join("");
      const overflowHtml =
        col.overflow > 0 ? `<div class="overflow">+${col.overflow} weitere</div>` : "";
      const total = col.visible.length + col.overflow;
      return `<section class="col"><header class="col-head">${escapeHtml(TASK_STATUS_LABEL[col.status])} <span class="count">${total}</span></header>${cardsHtml || '<div class="muted">Keine Aufgaben</div>'}${overflowHtml}</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>COCO TRMNL — Aufgaben &amp; Dienst</title>
<meta name="viewport" content="width=1872, initial-scale=1">
<style>
  :root { color-scheme: only light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 1872px; height: 1404px;
    padding: 40px;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 22px; line-height: 1.25;
    -webkit-font-smoothing: none;
  }
  h1 { font-size: 40px; margin: 0; letter-spacing: -0.5px; }
  h2 { font-size: 30px; margin: 0 0 12px 0; }
  .muted { color: #000; opacity: 0.5; }
  .header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 4px solid #000; padding-bottom: 10px; }
  .header .right { font-size: 22px; text-align: right; }
  .action-strip { display: flex; flex-wrap: wrap; gap: 12px; margin: 14px 0 18px 0; align-items: center; min-height: 44px; }
  .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 2px solid #000; font-size: 22px; font-weight: 500; border-radius: 4px; }
  .badge b { font-size: 26px; }
  .badge-emph { background: #000; color: #fff; font-weight: 700; }
  .roster { border-top: 2px solid #000; padding-top: 14px; }
  .roster-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .roster-header .date { font-size: 22px; }
  .roster-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .roster-loc { border: 2px solid #000; padding: 10px 14px; }
  .roster-loc-head { font-size: 24px; margin-bottom: 6px; display: flex; justify-content: space-between; }
  .roster-group { margin-top: 6px; }
  .roster-group-head { font-size: 20px; font-weight: 600; }
  .roster-names { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-block; padding: 2px 10px; border: 1.5px solid #000; border-radius: 999px; font-size: 20px; }
  .count { font-weight: 700; }
  .board { display: grid; grid-template-columns: repeat(${input.board.length}, 1fr); gap: 20px; margin-top: 18px; }
  .col { border: 3px solid #000; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .col-head { font-size: 26px; font-weight: 700; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 4px; display: flex; justify-content: space-between; }
  .card { border: 2px solid #000; padding: 8px 10px; position: relative; }
  .card.prio { border-width: 4px; }
  .card.overdue { padding-left: 20px; }
  .card.overdue::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 10px; background: #000; }
  .card-title { font-weight: 700; font-size: 22px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card-meta { font-size: 18px; margin-top: 4px; opacity: 0.8; }
  .overflow { font-size: 20px; font-weight: 600; text-align: center; padding: 4px; border-top: 1px dashed #000; }
  .holiday-note { font-size: 22px; font-weight: 600; border: 2px solid #000; padding: 4px 10px; margin: 4px 0 10px 0; display: inline-block; }
  .footer { position: absolute; left: 40px; right: 40px; bottom: 20px; border-top: 2px solid #000; padding-top: 8px; font-size: 20px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header class="header">
    <h1>Aufgaben &amp; Dienst — ${escapeHtml(input.orgName)}</h1>
    <div class="right"><div>${escapeHtml(timeStr)} Uhr</div><div class="muted">Stand-Abruf 9:00 / 21:00</div></div>
  </header>
  <div class="action-strip">${badgesHtml}</div>
  <section class="roster">
    <div class="roster-header"><h2>${escapeHtml(input.targetLabel)}</h2><div class="date">${escapeHtml(input.targetDateHuman)}</div></div>
    ${(() => {
      const h = getHolidayName(input.targetIso);
      return h ? `<div class="holiday-note"><b>Feiertag:</b> ${escapeHtml(h)}</div>` : "";
    })()}
    <div class="roster-grid">${rosterHtml}</div>
  </section>
  <div class="board">${columnsHtml}</div>
  <footer class="footer">
    <span>Heute erledigt: <b>${input.doneToday}</b> · Abgebrochen: <b>${input.cancelledToday}</b></span>
    <span class="muted">COCO · TRMNL X</span>
  </footer>
</body>
</html>`;
}

function renderPageSmall(input: RenderInput): string {
  const dateShort = input.now.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
  });
  const timeShort = input.now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const badgesHtml = input.badges.length
    ? input.badges
        .map((b) => {
          const cls = b.emphasize ? "sbadge sbadge-emph" : "sbadge";
          return `<span class="${cls}">${escapeHtml(b.icon)} <b>${b.count}</b> ${escapeHtml(b.label)}</span>`;
        })
        .join("")
    : `<span class="smuted">Alles erledigt.</span>`;

  const MAX_ROSTER_NAMES = 9;
  const rosterLinesHtml = input.rosterBlocks
    .map((b) => {
      const kitchen: string[] = [];
      const service: string[] = [];
      for (const g of b.groups) {
        if (g.areaKey === "kitchen") kitchen.push(...g.names);
        else if (g.areaKey === "service") service.push(...g.names);
      }
      const total = kitchen.length + service.length;
      if (total === 0) return "";
      // Kappen über beide Bereiche hinweg auf MAX_ROSTER_NAMES gesamt.
      const kTrim = truncateNames(kitchen, Math.min(kitchen.length, MAX_ROSTER_NAMES));
      const remaining = Math.max(0, MAX_ROSTER_NAMES - kTrim.visible.length);
      const sTrim = truncateNames(service, Math.min(service.length, remaining));
      const overflow =
        kTrim.overflow + sTrim.overflow + (service.length - sTrim.visible.length - sTrim.overflow);
      const parts: string[] = [];
      if (kTrim.visible.length)
        parts.push(`<span class="tag">K:</span> ${escapeHtml(kTrim.visible.join(" "))}`);
      if (sTrim.visible.length)
        parts.push(`<span class="tag">S:</span> ${escapeHtml(sTrim.visible.join(" "))}`);
      const overflowHtml = overflow > 0 ? ` <span class="smuted">+${overflow}</span>` : "";
      return `<div class="rline"><b>${escapeHtml(b.locationName)}</b> ${parts.join(" · ")}${overflowHtml}</div>`;
    })
    .filter(Boolean)
    .join("");

  const TASK_ROWS = 4;
  const TITLE_MAX = 46;
  const columnsHtml = input.board
    .map((col) => {
      const visibleRows = col.visible.slice(0, TASK_ROWS);
      const extra = col.visible.length - visibleRows.length + col.overflow;
      const rowsHtml = visibleRows
        .map((t) => {
          const overdue = isOverdue(t.due_at, input.now);
          const loc = input.locationNames.get(t.location_id) ?? "—";
          const title = ellipsize(`${overdue ? "! " : ""}${t.title} — ${loc}`, TITLE_MAX);
          return `<div class="trow">${escapeHtml(title)}</div>`;
        })
        .join("");
      const overflowHtml = extra > 0 ? `<div class="trow smuted">+${extra} weitere</div>` : "";
      const total = col.visible.length + col.overflow;
      const label =
        col.status === "open" ? "Offen" : col.status === "in_progress" ? "Läuft" : col.status;
      return `<section class="scol"><header class="scol-head">${escapeHtml(label)} <span class="count">${total}</span></header>${rowsHtml || '<div class="trow smuted">—</div>'}${overflowHtml}</section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>COCO TRMNL — Kompakt</title>
<meta name="viewport" content="width=800">
<style>
  :root { color-scheme: only light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 800px; height: 480px; overflow: hidden;
    padding: 8px 12px;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 18px; line-height: 1.2;
    -webkit-font-smoothing: none;
  }
  .smuted { opacity: 0.6; }
  .shead { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 4px; }
  .shead h1 { font-size: 20px; margin: 0; font-weight: 700; }
  .shead .right { font-size: 16px; }
  .sbadges { display: flex; gap: 8px; margin: 6px 0; flex-wrap: nowrap; overflow: hidden; }
  .sbadge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 2px solid #000; font-size: 16px; white-space: nowrap; }
  .sbadge b { font-size: 22px; font-weight: 800; }
  .sbadge-emph { background: #000; color: #fff; }
  .rblock { margin: 6px 0; }
  .rblock h2 { font-size: 14px; margin: 0 0 2px 0; font-weight: 600; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
  .rline { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 2px 0; }
  .tag { font-weight: 700; }
  .sboard { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px; }
  .scol { border-top: 2px solid #000; padding-top: 2px; }
  .scol-head { font-size: 16px; font-weight: 700; display: flex; justify-content: space-between; }
  .trow { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-weight: 800; }
</style>
</head>
<body>
  <header class="shead">
    <h1>Aufgaben &amp; Dienst</h1>
    <div class="right">${escapeHtml(dateShort)} ${escapeHtml(timeShort)}</div>
  </header>
  <div class="sbadges">${badgesHtml}</div>
  <div class="rblock">
    <h2>${escapeHtml(input.targetLabel)}</h2>
    ${rosterLinesHtml || '<div class="rline smuted">— keine Einteilung —</div>'}
  </div>
  <div class="sboard">${columnsHtml}</div>
</body>
</html>`;
}
