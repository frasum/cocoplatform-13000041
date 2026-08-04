// Öffentlicher iCal-Feed für persönliche Dienstplan-Abos.
// Erreichbar ohne Login unter /api/public/calendar/<token>[.ics].
// Der Pfad /api/public/* umgeht die Publishing-Auth; Sicherheit liegt
// ausschließlich am zufälligen 32-Byte-Token (base64url, timing-safe
// verglichen). Bei jedem Fehler generisch 404 — kein Hinweis, warum.

import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { buildRosterIcs, type RosterIcsEvent } from "@/lib/calendar/roster-ics";
import { poolLocalTimeToIso } from "@/lib/cash/pool-time-writeback";
import { mergeAbsenceRanges } from "@/lib/roster/vacation-planner";
import { todayIso } from "@/lib/format";
import {
  ABSENCE_TYPE_FILTER,
  absenceBlockingType,
  normalizeAbsenceType,
} from "@/lib/roster/absence-types";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function shiftIso(iso: string, deltaDays: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const AREA_LABEL: Record<string, string> = {
  kitchen: "Küche",
  service: "Service",
  gl: "GL",
};

export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const raw = String(params.token ?? "");
        const token = raw.replace(/\.ics$/i, "");
        if (token.length < 16 || token.length > 256) return notFound();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Lookup ausschließlich über den Hash — der Klartext existiert
        // nirgends in der DB.
        const { data: tokenRow, error: tokenErr } = await supabaseAdmin
          .from("access_tokens")
          .select("staff_id, organization_id, expires_at, used_at")
          .eq("token_type", "calendar_feed")
          .eq("token_hash", sha256Hex(token))
          .is("used_at", null)
          .maybeSingle();
        if (tokenErr || !tokenRow) return notFound();
        if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
          return notFound();
        }
        if (!tokenRow.staff_id) return notFound();

        const staffId = tokenRow.staff_id;
        const orgId = tokenRow.organization_id;
        const windowStart = shiftIso(todayIso(), -30);
        const windowEnd = shiftIso(todayIso(), 120);

        const { data: shifts, error: shiftErr } = await supabaseAdmin
          .from("roster_shifts")
          .select("id, shift_date, area, location_id, skill_id, service_period")
          .eq("organization_id", orgId)
          .eq("staff_id", staffId)
          .gte("shift_date", windowStart)
          .lte("shift_date", windowEnd);
        if (shiftErr) return notFound();

        const locationIds = Array.from(new Set((shifts ?? []).map((s) => s.location_id)));
        const skillIds = Array.from(
          new Set((shifts ?? []).map((s) => s.skill_id).filter((v): v is string => !!v)),
        );

        const locMap = new Map<string, string>();
        if (locationIds.length) {
          const { data: locs } = await supabaseAdmin
            // ST1: bewusst ungefiltert — Daten-Zugriff (Kalender-ICS: Namen an historischen Schichten).
            .from("locations")
            .select("id, name")
            .eq("organization_id", orgId)
            .in("id", locationIds);
          for (const l of locs ?? []) locMap.set(l.id, l.name);
        }

        const skillMap = new Map<string, string>();
        if (skillIds.length) {
          const { data: sks } = await supabaseAdmin
            .from("skills")
            .select("id, name")
            .eq("organization_id", orgId)
            .in("id", skillIds);
          for (const s of sks ?? []) skillMap.set(s.id, s.name);
        }

        const defaults = new Map<string, { checkin: string | null; checkout: string | null }>();
        if (locationIds.length) {
          const { data: lddRows } = await supabaseAdmin
            .from("location_department_defaults")
            .select("location_id, department, default_checkin, default_checkout")
            .eq("organization_id", orgId)
            .in("location_id", locationIds);
          for (const r of lddRows ?? []) {
            defaults.set(`${r.location_id}|${r.department}`, {
              checkin: r.default_checkin ?? null,
              checkout: r.default_checkout ?? null,
            });
          }
        }

        const events: RosterIcsEvent[] = [];
        for (const s of shifts ?? []) {
          const areaLabel = AREA_LABEL[s.area] ?? s.area;
          const skillName = s.skill_id ? (skillMap.get(s.skill_id) ?? null) : null;
          const period = (s as { service_period?: string | null }).service_period ?? "abend";
          const periodLabel =
            period === "frueh" ? "Früh" : period === "mittag" ? "Mittag" : "Abend";
          const baseLabel = `${areaLabel} · ${periodLabel}`;
          const summary = skillName ? `${baseLabel} · ${skillName}` : baseLabel;
          const location = locMap.get(s.location_id) ?? "";
          const uid = `roster-${s.id}@coco`;
          const def = defaults.get(`${s.location_id}|${s.area}`);
          const checkin = def?.checkin ? def.checkin.slice(0, 5) : null;
          const checkout = def?.checkout ? def.checkout.slice(0, 5) : null;
          // Die location_department_defaults sind Abend-Defaults. Für
          // Früh-/Mittag-Schichten gibt es (noch) keine Fenster-Defaults —
          // solange fallen wir auf ein Ganztags-Event zurück, damit die
          // Abend-Uhrzeit nicht fälschlich einer Mittag-Schicht angehängt
          // wird.
          if (period === "abend" && checkin && checkout) {
            const crossesMidnight = checkout < checkin;
            events.push({
              uid,
              summary,
              location,
              allDay: false,
              startIso: poolLocalTimeToIso(s.shift_date, checkin, 0),
              endIso: poolLocalTimeToIso(s.shift_date, checkout, crossesMidnight ? 1 : 0),
            });
          } else {
            events.push({ uid, summary, location, allDay: true, date: s.shift_date });
          }
        }

        // UA1 — Abwesenheiten (Urlaub/Krank) als ganztägige Events.
        // Aufeinanderfolgende Tage pro Typ zu einem mehrtägigen Event
        // gemerged; DTEND;VALUE=DATE ist EXKLUSIV (Folgetag des letzten Tags).
        const { data: absences, error: absErr } = await supabaseAdmin
          .from("roster_absence")
          .select("date, type")
          .eq("organization_id", orgId)
          .eq("staff_id", staffId)
          .in("type", ABSENCE_TYPE_FILTER)
          .gte("date", windowStart)
          .lte("date", windowEnd);
        if (absErr) return notFound();
        // UB1: unbezahlter Urlaub erscheint im Feed als Urlaub.
        const byType = new Map<"urlaub" | "krank", string[]>();
        for (const a of absences ?? []) {
          const t = absenceBlockingType(normalizeAbsenceType(a.type));
          const arr = byType.get(t) ?? [];
          arr.push(a.date as string);
          byType.set(t, arr);
        }
        for (const [type, dates] of byType) {
          const summary = type === "urlaub" ? "Urlaub" : "Krank";
          for (const range of mergeAbsenceRanges(dates)) {
            const endExclusive = shiftIso(range.end, 1);
            events.push({
              uid: `absence-${type}-${staffId}-${range.start}@coco`,
              summary,
              location: "",
              allDay: true,
              date: range.start,
              endDateExclusive: endExclusive,
            });
          }
        }

        const ics = buildRosterIcs({ calendarName: "COCO Dienstplan", events });
        return new Response(ics, {
          status: 200,
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="coco-dienstplan.ics"',
            "cache-control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
