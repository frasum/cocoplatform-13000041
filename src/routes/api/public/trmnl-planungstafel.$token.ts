// EP1a — Stille, token-geschützte HTML-Route für die GL-Planungstafel auf
// den zwei TRMNL X (1872×1404, 16 Graustufen). Sicherheitsmuster identisch
// zu TRMNL1/2 (trmnl-tasks.$token.ts, trmnl-dienstplan.$token.ts):
// Längen-Gate, SHA-256 Hash-Lookup, generisches 404 bei JEDEM Fehler,
// cache-control: no-store, escapeHtml überall.
//
// Query-Parameter `locations` (Pflicht): komma-separierte Location-UUIDs
// (erwartet zwei — Spicery + YUM; die Auswahl steckt in der Geräte-URL,
// kein Hardcode). Jede UUID muss zur Token-Organisation gehören, sonst 404.
//
// Reine Aufbereitung liegt in src/lib/trmnl/planungstafel.ts (getestet).

import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { todayIso as todayIsoBerlin } from "@/lib/format";
import { getHolidayName } from "@/lib/roster/holidays-display";
import {
  buildPlanungstafelData,
  PT_AREAS,
  type PtAbsence,
  type PtAbsenceType,
  type PtArea,
  type PtCell,
  type PtLocation,
  type PtLocationBlock,
  type PtRelease,
  type PtShift,
  type PtStaff,
  type PtStaffLocation,
} from "@/lib/trmnl/planungstafel";
import type { StaffDepartment } from "@/lib/staff-domain";

// Spalten-Anzahl. Dritter Tag (Übermorgen) bleibt an; ob er auf dem echten
// Panel lesbar bleibt, entscheidet der Geräte-Klicktest — Abschalten hier
// durch `3 → 2`.
const DAY_COUNT = 3;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nextDays(startIso: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(startIso + "T00:00:00Z");
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function dayHeader(iso: string, todayIso: string): { label: string; human: string; dow: number } {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  const wd = d.toLocaleDateString("de-DE", { weekday: "long", timeZone: "UTC" });
  const dm = d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", timeZone: "UTC" });
  let label: string;
  if (iso === todayIso) label = "Heute";
  else {
    const t = new Date(todayIso + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + 1);
    label = iso === t.toISOString().slice(0, 10) ? "Morgen" : "Übermorgen";
  }
  return { label, human: `${wd}, ${dm}`, dow };
}

export const Route = createFileRoute("/api/public/trmnl-planungstafel/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = String(params.token ?? "");
        if (token.length < 16 || token.length > 256) return notFound();

        const url = new URL(request.url);
        const rawLocs = url.searchParams.get("locations") ?? "";
        const locIds = rawLocs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (locIds.length === 0 || locIds.length > 6) return notFound();
        if (!locIds.every((id) => UUID_RE.test(id))) return notFound();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Org via Token-Hash (Klartext existiert nur auf dem Gerät).
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
          .eq("trmnl_token_hash", sha256Hex(token))
          .maybeSingle();
        if (orgErr || !orgRow) return notFound();

        const orgId = orgRow.id;

        // Locations laden, in Eingabe-Reihenfolge sortieren.
        const { data: locRows, error: locErr } = await supabaseAdmin
          .from("locations")
          .select("id, name")
          .eq("organization_id", orgId)
          .in("id", locIds);
        if (locErr || !locRows || locRows.length !== locIds.length) return notFound();
        const locById = new Map<string, PtLocation>();
        for (const l of locRows) locById.set(l.id, { id: l.id, name: l.name });
        const orderedLocations: PtLocation[] = locIds
          .map((id) => locById.get(id))
          .filter((l): l is PtLocation => !!l);

        const today = todayIsoBerlin();
        const days = nextDays(today, DAY_COUNT);
        const windowStart = days[0];
        const windowEnd = days[days.length - 1];

        // Freigaben × Perioden joinen — nur (locationId, area, [start,end])
        // deren Periode das Fenster berührt.
        const { data: releaseRows, error: relErr } = await supabaseAdmin
          .from("roster_releases")
          .select("location_id, area, periods(start_date, end_date)")
          .eq("organization_id", orgId)
          .in("location_id", locIds);
        if (relErr) return notFound();
        const releases: PtRelease[] = [];
        for (const r of releaseRows ?? []) {
          const p = (r as { periods: { start_date: string; end_date: string } | null }).periods;
          if (!p) continue;
          if (p.end_date < windowStart || p.start_date > windowEnd) continue;
          releases.push({
            locationId: (r as { location_id: string }).location_id,
            area: (r as { area: PtArea }).area,
            startDate: p.start_date,
            endDate: p.end_date,
          });
        }

        // Team-Zuordnungen (staff_locations) für die Zielstandorte.
        const { data: slRows, error: slErr } = await supabaseAdmin
          .from("staff_locations")
          .select("staff_id, location_id, department")
          .eq("organization_id", orgId)
          .in("location_id", locIds);
        if (slErr) return notFound();
        const staffLocations: PtStaffLocation[] = (slRows ?? []).map((r) => ({
          staffId: (r as { staff_id: string }).staff_id,
          locationId: (r as { location_id: string }).location_id,
          department: (r as { department: StaffDepartment }).department,
        }));

        // Cross-Location braucht Schichten ORGANISATIONSWEIT — nicht auf die
        // zwei Anzeigen-Locations begrenzen.
        const { data: shiftRows, error: shiftErr } = await supabaseAdmin
          .from("roster_shifts")
          .select("staff_id, shift_date, location_id, area")
          .eq("organization_id", orgId)
          .gte("shift_date", windowStart)
          .lte("shift_date", windowEnd);
        if (shiftErr) return notFound();
        const shifts: PtShift[] = (shiftRows ?? []).map((r) => ({
          staffId: (r as { staff_id: string }).staff_id,
          shiftDate: (r as { shift_date: string }).shift_date,
          locationId: (r as { location_id: string }).location_id,
          area: (r as { area: PtArea }).area,
        }));

        const { data: absRows, error: absErr } = await supabaseAdmin
          .from("roster_absence")
          .select("staff_id, date, type")
          .eq("organization_id", orgId)
          .in("type", ["urlaub", "krank"])
          .gte("date", windowStart)
          .lte("date", windowEnd);
        if (absErr) return notFound();
        const absences: PtAbsence[] = (absRows ?? []).map((r) => ({
          staffId: (r as { staff_id: string }).staff_id,
          date: (r as { date: string }).date,
          type: (r as { type: PtAbsenceType }).type,
        }));

        // Namen für alle beteiligten MA (Schichten ∪ Abwesenheiten ∪
        // Team-Zuordnungen) — sonst fehlen die Anzeigenamen.
        const staffIdSet = new Set<string>();
        for (const s of shifts) staffIdSet.add(s.staffId);
        for (const a of absences) staffIdSet.add(a.staffId);
        for (const sl of staffLocations) staffIdSet.add(sl.staffId);
        const staffIds = Array.from(staffIdSet);
        let staff: PtStaff[] = [];
        if (staffIds.length > 0) {
          const { data: stRows, error: stErr } = await supabaseAdmin
            .from("staff")
            .select("id, display_name")
            .eq("organization_id", orgId)
            .in("id", staffIds);
          if (stErr) return notFound();
          staff = (stRows ?? []).map((r) => ({
            id: (r as { id: string }).id,
            displayName: (r as { display_name: string | null }).display_name ?? "—",
          }));
        }

        const blocks = buildPlanungstafelData({
          days,
          locations: orderedLocations,
          staff,
          staffLocations,
          shifts,
          absences,
          releases,
        });

        const html = renderPage({ blocks, days, todayIso: today, now: new Date() });
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

function renderPage(input: {
  blocks: PtLocationBlock[];
  days: string[];
  todayIso: string;
  now: Date;
}): string {
  const stamp = input.now.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  // Spaltenbreiten: Heute/Morgen breit, Übermorgen schmal.
  const widths = input.days.map((_, i) => (i < 2 ? 2 : 1));
  const widthSum = widths.reduce((a, b) => a + b, 0);
  const gridCols = `320px ${widths.map((w) => `${w}fr`).join(" ")}`;

  const headerCells = input.days
    .map((iso) => {
      const h = dayHeader(iso, input.todayIso);
      const holiday = getHolidayName(iso);
      const cls = [
        "day-head",
        h.dow === 0 || h.dow === 6 ? "we" : "",
        iso === input.todayIso ? "today" : "",
        holiday ? "holiday" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const holidayHtml = holiday ? `<div class="hol">${escapeHtml(holiday)}</div>` : "";
      return `<div class="${cls}"><div class="lbl">${escapeHtml(h.label)}</div><div class="dm">${escapeHtml(h.human)}</div>${holidayHtml}</div>`;
    })
    .join("");

  const bodyHtml = input.blocks.map((b) => renderLocationBlock(b, input.days)).join("");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>COCO TRMNL — Planungstafel</title>
<meta name="viewport" content="width=1872, initial-scale=1">
<style>
  :root { color-scheme: only light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: 1872px; height: 1404px;
    padding: 28px 36px;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 22px; line-height: 1.25;
    -webkit-font-smoothing: none;
  }
  h1 { font-size: 40px; margin: 0; letter-spacing: -0.5px; }
  .muted { color: #000; opacity: 0.55; }
  .header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 4px solid #000; padding-bottom: 10px; }
  .header .right { font-size: 22px; text-align: right; }
  .grid { display: grid; grid-template-columns: ${gridCols}; margin-top: 14px; }
  .grid > * { border-bottom: 1.5px solid #000; padding: 8px 12px; }
  .grid > .row-head { border-right: 1.5px solid #000; }
  .grid > .col-head { border-right: 1.5px solid #000; }
  .grid > .col-head:last-child { border-right: none; }
  .col-head-cell { display: block; }
  .day-head { text-align: left; }
  .day-head .lbl { font-size: 30px; font-weight: 800; }
  .day-head .dm { font-size: 20px; }
  .day-head .hol { font-size: 16px; font-weight: 600; margin-top: 2px; }
  .day-head.we { background: #eee; }
  .day-head.today { background: #000; color: #fff; }
  .day-head.today .hol { color: #fff; }
  .loc-title { grid-column: 1 / -1; font-size: 28px; font-weight: 800; border-top: 4px solid #000; border-bottom: 2px solid #000; padding: 10px 12px; background: #f2f2f2; }
  .row-head { font-size: 22px; font-weight: 700; }
  .row-head .sub { font-size: 15px; font-weight: 500; opacity: 0.7; }
  .cell { border-right: 1.5px solid #000; padding: 8px 12px; min-height: 72px; }
  .cell:last-child { border-right: none; }
  .cell.not-released { color: #000; opacity: 0.45; font-style: italic; font-size: 18px; }
  .cell.empty { opacity: 0.35; }
  .cell.we { background: #eee; }
  .cell.today { outline: 3px solid #000; outline-offset: -3px; }
  .entry { display: inline-flex; align-items: baseline; margin-right: 14px; margin-bottom: 4px; font-size: 22px; }
  .entry.absent { opacity: 0.45; text-decoration: line-through; }
  .entry .dot { width: 10px; height: 10px; border-radius: 999px; background: #000; margin-right: 8px; display: inline-block; }
  .entry .sym { margin-left: 6px; font-size: 18px; }
  .footer { position: absolute; left: 36px; right: 36px; bottom: 16px; border-top: 2px solid #000; padding-top: 8px; font-size: 18px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header class="header">
    <h1>Planungstafel</h1>
    <div class="right"><div>${escapeHtml(stamp)} Uhr</div><div class="muted">${input.days.length} Tage · ${widthSum} Spalten</div></div>
  </header>
  <div class="grid">
    <div class="col-head row-head"><span class="col-head-cell muted">Standort · Bereich</span></div>
    ${headerCells
      .replace(/<div class="day-head/g, '<div class="col-head day-head')
      .replace(/day-head col-head/g, "col-head day-head")}
    ${bodyHtml}
  </div>
  <footer class="footer">
    <span>● Cross-Standort · ⛱ Urlaub · ✚ krank · Nicht freigegebene Tage sind ausgegraut.</span>
    <span>Abruf ${escapeHtml(stamp)} Uhr</span>
  </footer>
</body>
</html>`;
}

function renderLocationBlock(block: PtLocationBlock, days: readonly string[]): string {
  const title = `<div class="loc-title">${escapeHtml(block.locationName)}</div>`;
  const rows = block.areas
    .map((row) => {
      const rowLabel = PT_AREAS.find((a) => a.area === row.area)?.label ?? row.area;
      const head = `<div class="row-head"><div>${escapeHtml(rowLabel)}</div><div class="sub">${escapeHtml(block.locationName)}</div></div>`;
      const cells = days.map((iso) => renderCell(row.cellsByDate[iso], iso)).join("");
      return `${head}${cells}`;
    })
    .join("");
  return `${title}${rows}`;
}

function renderCell(cell: PtCell | undefined, iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  const we = dow === 0 || dow === 6 ? " we" : "";
  if (!cell || cell.kind === "not_released") {
    return `<div class="cell not-released${we}">— noch nicht freigegeben —</div>`;
  }
  if (cell.kind === "empty") {
    return `<div class="cell empty${we}">—</div>`;
  }
  const entriesHtml = cell.entries
    .map((e) => {
      const dot = e.crossLocation ? `<span class="dot"></span>` : "";
      const sym =
        e.absent === "urlaub"
          ? `<span class="sym">⛱</span>`
          : e.absent === "krank"
            ? `<span class="sym">✚</span>`
            : "";
      const cls = ["entry", e.absent ? "absent" : ""].filter(Boolean).join(" ");
      return `<span class="${cls}">${dot}${escapeHtml(e.staffName)}${sym}</span>`;
    })
    .join("");
  return `<div class="cell${we}">${entriesHtml}</div>`;
}