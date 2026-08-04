// TA1 — Schichttausch (Server-Functions).
//
// Grundsatz:
//  - staffId kommt IMMER aus loadStaffCaller (auth.uid → user_links).
//    Der Client kann keine Identität mit-schicken.
//  - Alle Schreibpfade nutzen supabaseAdmin NACH Berechtigungsprüfung.
//  - shift_swap_requests und shift_swap_declines sind DENY-ALL für Clients.
//  - KEINE Änderung an roster_shifts. Der Vollzug ist TA2 (Manager-Genehmigung).
//  - Perioden-Sperren werden respektiert wie bei roster.functions.
//  - Audit bei jeder Schreibaktion.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadStaffCaller } from "@/lib/time/time.functions";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { assertRealIdentity } from "@/lib/admin/impersonation";
import { runWithPermission } from "@/lib/admin/admin-call";
import { makeAuditWriter } from "@/lib/admin/audit";
import { writeAuditLog } from "@/lib/admin/audit";
import { ForbiddenError } from "@/lib/admin/role-guard";
import { resolvePlanerScope, scopeIncludes, assertScopeNotEmpty } from "./scope-util";
import { sendTelegramToStaff } from "@/lib/telegram/telegram.functions";
import { syncOpenSessionsPoolAfterRosterWrite } from "@/lib/cash/roster-pool-sync";
import { businessDateOf } from "@/lib/business-date";
import {
  canAcceptCounterShift,
  canOfferShift,
  eligiblePeerFilter,
  type SwapArea,
  type SwapPeer,
  type SwapShift,
} from "./swap-rules";
import { ABSENCE_TYPE_FILTER } from "./absence-types";

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

// "Heute" für Schichttausch-Regeln = aktueller Geschäftstag (Europe/Berlin,
// 3-Uhr-Cutoff). Damit gilt eine bereits laufende Spätschicht nachts nicht
// als „zukünftig".
function todayIso(): string {
  return businessDateOf(new Date());
}

async function assertShiftDateUnlocked(
  admin: SupabaseClient<Database>,
  organizationId: string,
  shiftDate: string,
): Promise<void> {
  const { data, error } = await admin
    .from("periods")
    .select("status")
    .eq("organization_id", organizationId)
    .lte("start_date", shiftDate)
    .gte("end_date", shiftDate)
    .maybeSingle();
  if (error) throw error;
  if (data?.status === "locked") throw new Error("Periode gesperrt");
}

type ShiftRow = {
  id: string;
  staff_id: string;
  location_id: string;
  area: SwapArea;
  shift_date: string;
  organization_id: string;
  service_period: "frueh" | "mittag" | "abend";
};

async function loadShift(
  admin: SupabaseClient<Database>,
  organizationId: string,
  shiftId: string,
): Promise<ShiftRow> {
  const { data, error } = await admin
    .from("roster_shifts")
    .select("id, staff_id, location_id, area, shift_date, organization_id, service_period")
    .eq("id", shiftId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Schicht nicht gefunden.");
  return {
    ...(data as ShiftRow),
    service_period: ((data as { service_period: string | null }).service_period ?? "abend") as
      | "frueh"
      | "mittag"
      | "abend",
  };
}

async function hasActiveRequestForShift(
  admin: SupabaseClient<Database>,
  shiftId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("shift_swap_requests")
    .select("id")
    .eq("shift_id", shiftId)
    .in("status", ["open", "peer_accepted"])
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * TA4 — Prüft, ob ein Mitarbeiter an einem konkreten Datum eine roster_absence
 * (Urlaub oder Krank) hat. Wird von der Berechtigten-Regel und der TA2-
 * Re-Validierung genutzt, damit Abwesende nicht in einen Tausch geraten.
 */
async function hasAbsenceOnDate(
  admin: SupabaseClient<Database>,
  organizationId: string,
  staffId: string,
  isoDate: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("roster_absence")
    .select("staff_id")
    .eq("organization_id", organizationId)
    .eq("staff_id", staffId)
    .eq("date", isoDate)
    .in("type", ABSENCE_TYPE_FILTER)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function loadPeerForShift(
  admin: SupabaseClient<Database>,
  organizationId: string,
  peerStaffId: string,
  shift: SwapShift,
): Promise<SwapPeer | null> {
  const { data: staff, error: staffErr } = await admin
    .from("staff")
    .select("id, is_active")
    .eq("id", peerStaffId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (staffErr) throw staffErr;
  if (!staff) return null;
  const { data: scopes, error: scopeErr } = await admin
    .from("staff_locations")
    .select("location_id, department")
    .eq("staff_id", peerStaffId)
    .eq("organization_id", organizationId);
  if (scopeErr) throw scopeErr;
  const { data: dayShifts, error: dayErr } = await admin
    .from("roster_shifts")
    .select("shift_date")
    .eq("organization_id", organizationId)
    .eq("staff_id", peerStaffId)
    .eq("location_id", shift.locationId)
    .eq("area", shift.area)
    .eq("shift_date", shift.shiftDate);
  if (dayErr) throw dayErr;
  return {
    staffId: peerStaffId,
    isActive: !!staff.is_active,
    scopes: (scopes ?? []).map((s) => ({
      locationId: s.location_id as string,
      area: s.department as SwapArea,
    })),
    shiftDatesAtScope: new Set((dayShifts ?? []).map((r) => r.shift_date as string)),
  };
}

/**
 * Liefert alle staff_ids der Organisation, die grundsätzlich in Frage kommen
 * (Standort + Bereich passt, aktiv, nicht der Anfragende). Der Tageskonflikt
 * wird pro Kandidat mit eligiblePeerFilter geprüft.
 */
async function eligiblePeerStaffIds(
  admin: SupabaseClient<Database>,
  organizationId: string,
  shift: SwapShift,
): Promise<string[]> {
  const { data: scopeRows, error: scopeErr } = await admin
    .from("staff_locations")
    .select("staff_id")
    .eq("organization_id", organizationId)
    .eq("location_id", shift.locationId)
    .eq("department", shift.area);
  if (scopeErr) throw scopeErr;
  const candidateIds = Array.from(
    new Set(
      (scopeRows ?? []).map((r) => r.staff_id as string).filter((id) => id !== shift.staffId),
    ),
  );
  if (candidateIds.length === 0) return [];
  const { data: activeRows, error: activeErr } = await admin
    .from("staff")
    // RS1 — nicht planbare Kräfte erhalten keine neuen Schichten per Tausch.
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("roster_plannable", true)
    .in("id", candidateIds);
  if (activeErr) throw activeErr;
  const activeSet = new Set((activeRows ?? []).map((r) => r.id as string));
  const active = candidateIds.filter((id) => activeSet.has(id));
  if (active.length === 0) return [];
  const { data: dayRows, error: dayErr } = await admin
    .from("roster_shifts")
    .select("staff_id")
    .eq("organization_id", organizationId)
    .eq("location_id", shift.locationId)
    .eq("area", shift.area)
    .eq("shift_date", shift.shiftDate)
    .in("staff_id", active);
  if (dayErr) throw dayErr;
  const conflicting = new Set((dayRows ?? []).map((r) => r.staff_id as string));
  return active.filter((id) => !conflicting.has(id));
}

// ---------------------------------------------------------------------------
// createSwapRequest
// ---------------------------------------------------------------------------

export const createSwapRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        shiftId: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shift = await loadShift(supabaseAdmin, caller.organizationId, data.shiftId);
    if (shift.staff_id !== caller.staffId) {
      throw new Error("Nur eigene Schichten können angeboten werden.");
    }
    const active = await hasActiveRequestForShift(supabaseAdmin, shift.id);
    if (
      !canOfferShift({
        shiftDate: shift.shift_date,
        todayIso: todayIso(),
        hasActiveRequest: active,
      })
    ) {
      if (active) throw new Error("Für diese Schicht läuft bereits eine Anfrage.");
      throw new Error("Nur zukünftige Schichten (ab morgen) können angeboten werden.");
    }
    await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, shift.shift_date);

    const { data: inserted, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .insert({
        organization_id: caller.organizationId,
        shift_id: shift.id,
        requester_staff_id: caller.staffId,
        note: data.note ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (error) {
      // Partieller Unique-Index kann bei Race greifen — freundliche Meldung.
      throw new Error(`Anfrage konnte nicht erstellt werden: ${error.message}`);
    }
    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "swap.request_created",
      entity: "shift_swap_request",
      entityId: inserted.id,
      meta: { shiftId: shift.id, shiftDate: shift.shift_date },
    });
    return { id: inserted.id as string };
  });

// ---------------------------------------------------------------------------
// cancelSwapRequest
// ---------------------------------------------------------------------------

export const cancelSwapRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select("id, requester_staff_id, status, organization_id")
      .eq("id", data.requestId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!req) throw new Error("Anfrage nicht gefunden.");
    if (req.requester_staff_id !== caller.staffId) {
      throw new Error("Nur eigene Anfragen können storniert werden.");
    }
    if (req.status !== "open" && req.status !== "peer_accepted") {
      throw new Error("Diese Anfrage kann nicht mehr storniert werden.");
    }
    const { error: updErr } = await supabaseAdmin
      .from("shift_swap_requests")
      .update({ status: "cancelled" })
      .eq("id", req.id);
    if (updErr) throw updErr;
    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "swap.request_cancelled",
      entity: "shift_swap_request",
      entityId: req.id,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// listMySwapRequests
// ---------------------------------------------------------------------------

export type MySwapRequestRow = {
  id: string;
  shiftId: string;
  shiftDate: string;
  locationName: string;
  area: SwapArea;
  status: "open" | "peer_accepted" | "approved" | "rejected" | "cancelled";
  note: string | null;
  peerStaffName: string | null;
  declineCount: number;
  eligibleCount: number;
  createdAt: string;
};

export const listMySwapRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySwapRequestRow[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reqs, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select(
        "id, shift_id, status, note, created_at, peer_staff_id, roster_shifts:roster_shifts!shift_swap_requests_shift_id_fkey(id, staff_id, shift_date, area, location_id, locations(name)), peer:staff!shift_swap_requests_peer_staff_id_fkey(display_name)",
      )
      .eq("organization_id", caller.organizationId)
      .eq("requester_staff_id", caller.staffId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (reqs ?? []) as Array<{
      id: string;
      shift_id: string;
      status: MySwapRequestRow["status"];
      note: string | null;
      created_at: string;
      peer_staff_id: string | null;
      roster_shifts: {
        id: string;
        staff_id: string;
        shift_date: string;
        area: SwapArea;
        location_id: string;
        locations: { name: string } | null;
      } | null;
      peer: { display_name: string } | null;
    }>;

    const out: MySwapRequestRow[] = [];
    for (const r of rows) {
      const rs = r.roster_shifts;
      if (!rs) continue;
      let declineCount = 0;
      let eligibleCount = 0;
      if (r.status === "open" || r.status === "peer_accepted") {
        const { count, error: declineErr } = await supabaseAdmin
          .from("shift_swap_declines")
          .select("staff_id", { head: true, count: "exact" })
          .eq("request_id", r.id);
        if (declineErr) throw declineErr;
        declineCount = count ?? 0;
        const eligibles = await eligiblePeerStaffIds(supabaseAdmin, caller.organizationId, {
          id: rs.id,
          staffId: rs.staff_id,
          locationId: rs.location_id,
          area: rs.area,
          shiftDate: rs.shift_date,
        });
        eligibleCount = eligibles.length;
      }
      out.push({
        id: r.id,
        shiftId: rs.id,
        shiftDate: rs.shift_date,
        locationName: rs.locations?.name ?? "—",
        area: rs.area,
        status: r.status,
        note: r.note,
        peerStaffName: r.peer?.display_name ?? null,
        declineCount,
        eligibleCount,
        createdAt: r.created_at,
      });
    }
    return out;
  });

// ---------------------------------------------------------------------------
// listOpenSwapsForMe
// ---------------------------------------------------------------------------

export type OpenSwapRow = {
  id: string;
  shiftId: string;
  shiftDate: string;
  locationName: string;
  locationId: string;
  area: SwapArea;
  skillLabel: string | null;
  requesterName: string;
  note: string | null;
  createdAt: string;
};

export const listOpenSwapsForMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpenSwapRow[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Kandidaten: alle offenen Anfragen in der Organisation, die nicht von mir stammen.
    const { data: reqs, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select(
        "id, shift_id, note, created_at, requester_staff_id, roster_shifts:roster_shifts!shift_swap_requests_shift_id_fkey(id, staff_id, shift_date, area, location_id, locations(name), skills(name)), requester:staff!shift_swap_requests_requester_staff_id_fkey(display_name)",
      )
      .eq("organization_id", caller.organizationId)
      .eq("status", "open")
      .neq("requester_staff_id", caller.staffId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const candidates = (reqs ?? []) as Array<{
      id: string;
      shift_id: string;
      note: string | null;
      created_at: string;
      requester_staff_id: string;
      roster_shifts: {
        id: string;
        staff_id: string;
        shift_date: string;
        area: SwapArea;
        location_id: string;
        locations: { name: string } | null;
        skills: { name: string } | null;
      } | null;
      requester: { display_name: string } | null;
    }>;
    if (candidates.length === 0) return [];

    // 2) Meine Ablehnungen auf einen Schlag.
    const requestIds = candidates.map((r) => r.id);
    const { data: myDeclines, error: declErr } = await supabaseAdmin
      .from("shift_swap_declines")
      .select("request_id")
      .eq("staff_id", caller.staffId)
      .in("request_id", requestIds);
    if (declErr) throw declErr;
    const declined = new Set((myDeclines ?? []).map((r) => r.request_id as string));

    // 3) Berechtigungsprüfung pro Anfrage.
    const out: OpenSwapRow[] = [];
    for (const c of candidates) {
      if (declined.has(c.id)) continue;
      const rs = c.roster_shifts;
      if (!rs) continue;
      const shift: SwapShift = {
        id: rs.id,
        staffId: rs.staff_id,
        locationId: rs.location_id,
        area: rs.area,
        shiftDate: rs.shift_date,
      };
      const peer = await loadPeerForShift(
        supabaseAdmin,
        caller.organizationId,
        caller.staffId,
        shift,
      );
      if (!peer) continue;
      const peerHasAbsence = await hasAbsenceOnDate(
        supabaseAdmin,
        caller.organizationId,
        caller.staffId,
        shift.shiftDate,
      );
      if (!eligiblePeerFilter({ peer, shift, hasAbsenceOnShiftDate: peerHasAbsence })) continue;
      out.push({
        id: c.id,
        shiftId: rs.id,
        shiftDate: rs.shift_date,
        locationName: rs.locations?.name ?? "—",
        locationId: rs.location_id,
        area: rs.area,
        skillLabel: rs.skills?.name ?? null,
        requesterName: c.requester?.display_name ?? "Kollege",
        note: c.note,
        createdAt: c.created_at,
      });
    }
    return out;
  });

// ---------------------------------------------------------------------------
// acceptSwapRequest
// ---------------------------------------------------------------------------

export const acceptSwapRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        requestId: z.string().uuid(),
        counterShiftId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: reqRow, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select("id, status, shift_id, requester_staff_id, organization_id")
      .eq("id", data.requestId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!reqRow) throw new Error("Anfrage nicht gefunden.");
    if (reqRow.status !== "open") {
      throw new Error("Diese Anfrage wurde bereits übernommen oder ist geschlossen.");
    }
    if (reqRow.requester_staff_id === caller.staffId) {
      throw new Error("Eigene Anfragen können nicht angenommen werden.");
    }

    // Bereits abgelehnt? → aus dem Spiel.
    const { data: myDecline, error: declErr } = await supabaseAdmin
      .from("shift_swap_declines")
      .select("staff_id")
      .eq("request_id", reqRow.id)
      .eq("staff_id", caller.staffId)
      .maybeSingle();
    if (declErr) throw declErr;
    if (myDecline) {
      throw new Error("Diese Anfrage wurde von dir bereits abgelehnt.");
    }

    const reqShiftRow = await loadShift(supabaseAdmin, caller.organizationId, reqRow.shift_id);
    const reqShift: SwapShift = {
      id: reqShiftRow.id,
      staffId: reqShiftRow.staff_id,
      locationId: reqShiftRow.location_id,
      area: reqShiftRow.area,
      shiftDate: reqShiftRow.shift_date,
    };
    const peer = await loadPeerForShift(
      supabaseAdmin,
      caller.organizationId,
      caller.staffId,
      reqShift,
    );
    const peerHasAbsence = await hasAbsenceOnDate(
      supabaseAdmin,
      caller.organizationId,
      caller.staffId,
      reqShift.shiftDate,
    );
    if (
      !peer ||
      !eligiblePeerFilter({ peer, shift: reqShift, hasAbsenceOnShiftDate: peerHasAbsence })
    ) {
      throw new Error("Du bist für diese Anfrage nicht (mehr) berechtigt.");
    }

    let counterShiftId: string | null = null;
    if (data.counterShiftId) {
      const counter = await loadShift(supabaseAdmin, caller.organizationId, data.counterShiftId);
      if (counter.staff_id !== caller.staffId) {
        throw new Error("Gegentausch-Schicht gehört dir nicht.");
      }
      const counterActive = await hasActiveRequestForShift(supabaseAdmin, counter.id);
      const requesterAbsent = await hasAbsenceOnDate(
        supabaseAdmin,
        caller.organizationId,
        reqShiftRow.staff_id,
        counter.shift_date,
      );
      const ok = canAcceptCounterShift({
        counterShift: {
          id: counter.id,
          staffId: counter.staff_id,
          locationId: counter.location_id,
          area: counter.area,
          shiftDate: counter.shift_date,
          hasActiveRequest: counterActive,
        },
        requestShift: reqShift,
        peerStaffId: caller.staffId,
        todayIso: todayIso(),
        requesterHasAbsenceOnCounterDate: requesterAbsent,
      });
      if (!ok) {
        if (requesterAbsent) {
          throw new Error(
            "Der Anfragende ist an diesem Tag abwesend (Urlaub/Krank) — Gegentausch nicht möglich.",
          );
        }
        throw new Error("Diese Gegentausch-Schicht passt nicht (Bereich, Standort oder Datum).");
      }
      counterShiftId = counter.id;
    }

    // Optimistischer Update mit Status-Guard, damit ein zweiter Peer den Race verliert.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("shift_swap_requests")
      .update({
        status: "peer_accepted",
        peer_staff_id: caller.staffId,
        peer_shift_id: counterShiftId,
        responded_at: new Date().toISOString(),
      })
      .eq("id", reqRow.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (updErr) throw updErr;
    if (!updated) {
      throw new Error("Anfrage wurde inzwischen von jemand anderem übernommen.");
    }

    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "swap.peer_accepted",
      entity: "shift_swap_request",
      entityId: reqRow.id,
      meta: { counterShiftId },
    });

    // TA2 — Manager per Telegram anpingen. Best-effort (§51): Fehler landen im
    // audit_log (swap.alert_failed), kippen aber die Annahme NICHT.
    try {
      await notifyManagersOfPeerAccepted(supabaseAdmin, {
        organizationId: caller.organizationId,
        requestId: reqRow.id,
      });
    } catch (err) {
      await writeAuditLog({
        organizationId: caller.organizationId,
        actorUserId: caller.userId,
        actorStaffId: caller.staffId,
        action: "swap.alert_failed",
        entity: "shift_swap_request",
        entityId: reqRow.id,
        meta: { message: err instanceof Error ? err.message : String(err) },
      });
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// declineSwapRequest
// ---------------------------------------------------------------------------

export const declineSwapRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    assertRealIdentity(caller);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: reqRow, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select("id, status, shift_id, requester_staff_id")
      .eq("id", data.requestId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!reqRow) throw new Error("Anfrage nicht gefunden.");
    if (reqRow.status !== "open") {
      throw new Error("Diese Anfrage ist nicht mehr offen.");
    }
    if (reqRow.requester_staff_id === caller.staffId) {
      throw new Error("Eigene Anfragen können nicht abgelehnt werden.");
    }

    const reqShiftRow = await loadShift(supabaseAdmin, caller.organizationId, reqRow.shift_id);
    const shift: SwapShift = {
      id: reqShiftRow.id,
      staffId: reqShiftRow.staff_id,
      locationId: reqShiftRow.location_id,
      area: reqShiftRow.area,
      shiftDate: reqShiftRow.shift_date,
    };
    const peer = await loadPeerForShift(
      supabaseAdmin,
      caller.organizationId,
      caller.staffId,
      shift,
    );
    const peerHasAbsence = await hasAbsenceOnDate(
      supabaseAdmin,
      caller.organizationId,
      caller.staffId,
      shift.shiftDate,
    );
    if (!peer || !eligiblePeerFilter({ peer, shift, hasAbsenceOnShiftDate: peerHasAbsence })) {
      throw new Error("Du bist für diese Anfrage nicht berechtigt.");
    }

    const { error: insErr } = await supabaseAdmin.from("shift_swap_declines").upsert(
      {
        request_id: reqRow.id,
        staff_id: caller.staffId,
      },
      { onConflict: "request_id,staff_id", ignoreDuplicates: true },
    );
    if (insErr) throw insErr;

    await writeAuditLog({
      organizationId: caller.organizationId,
      actorUserId: caller.userId,
      actorStaffId: caller.staffId,
      action: "swap.peer_declined",
      entity: "shift_swap_request",
      entityId: reqRow.id,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// myCandidateCounterShifts — Vorschlags-Liste für Gegentausch beim Annehmen
// ---------------------------------------------------------------------------

export type CandidateCounterShift = {
  id: string;
  shiftDate: string;
};

export const listMyCandidateCounterShifts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        locationId: z.string().uuid(),
        area: z.enum(["kitchen", "service", "gl"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CandidateCounterShift[]> => {
    const caller = await loadStaffCaller(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = todayIso();
    const { data: rows, error } = await supabaseAdmin
      .from("roster_shifts")
      .select("id, shift_date")
      .eq("organization_id", caller.organizationId)
      .eq("staff_id", caller.staffId)
      .eq("location_id", data.locationId)
      .eq("area", data.area)
      .gt("shift_date", today)
      .order("shift_date", { ascending: true });
    if (error) throw error;
    const candidates = (rows ?? []) as Array<{ id: string; shift_date: string }>;
    if (candidates.length === 0) return [];
    const ids = candidates.map((r) => r.id);
    const { data: active, error: aErr } = await supabaseAdmin
      .from("shift_swap_requests")
      .select("shift_id")
      .in("shift_id", ids)
      .in("status", ["open", "peer_accepted"]);
    if (aErr) throw aErr;
    const blocked = new Set((active ?? []).map((r) => r.shift_id as string));
    return candidates
      .filter((r) => !blocked.has(r.id))
      .map((r) => ({ id: r.id, shiftDate: r.shift_date }));
  });

// ---------------------------------------------------------------------------
// TA2 — Telegram-Ping Helper (best-effort, siehe §51)
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDeDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y?.slice(2) ?? ""}`;
}

function areaLabel(a: SwapArea): string {
  return a === "kitchen" ? "Küche" : a === "service" ? "Service" : "GL";
}

async function notifyManagersOfPeerAccepted(
  admin: SupabaseClient<Database>,
  params: { organizationId: string; requestId: string },
): Promise<void> {
  const { data: req, error: reqErr } = await admin
    .from("shift_swap_requests")
    .select(
      "id, note, requester:staff!shift_swap_requests_requester_staff_id_fkey(display_name), peer:staff!shift_swap_requests_peer_staff_id_fkey(display_name), req_shift:roster_shifts!shift_swap_requests_shift_id_fkey(shift_date, area, location:locations(name)), peer_shift:roster_shifts!shift_swap_requests_peer_shift_id_fkey(shift_date, area, location:locations(name))",
    )
    .eq("id", params.requestId)
    .maybeSingle();
  if (reqErr) throw reqErr;
  if (!req) return;
  const r = req as unknown as {
    requester: { display_name: string } | null;
    peer: { display_name: string } | null;
    req_shift: {
      shift_date: string;
      area: SwapArea;
      location: { name: string } | null;
    } | null;
    peer_shift: {
      shift_date: string;
      area: SwapArea;
      location: { name: string } | null;
    } | null;
  };
  if (!r.req_shift) return;
  const aName = escapeHtml(r.requester?.display_name ?? "Kollege");
  const bName = escapeHtml(r.peer?.display_name ?? "Kollege");
  const line1 = `🔁 Tauschanfrage wartet auf Freigabe: <b>${aName}</b> → <b>${bName}</b>, ${escapeHtml(areaLabel(r.req_shift.area))} ${escapeHtml(fmtDeDate(r.req_shift.shift_date))} (${escapeHtml(r.req_shift.location?.name ?? "—")})`;
  const line2 = r.peer_shift
    ? `\nGegentausch: ${escapeHtml(areaLabel(r.peer_shift.area))} ${escapeHtml(fmtDeDate(r.peer_shift.shift_date))} (${escapeHtml(r.peer_shift.location?.name ?? "—")})`
    : "";
  const text = line1 + line2;

  const { data: rows, error } = await admin
    .from("staff_telegram_links")
    .select("staff_id")
    .eq("organization_id", params.organizationId)
    .eq("receives_swap_alerts", true)
    .not("linked_at", "is", null);
  if (error) throw error;
  const staffIds = (rows ?? []).map((x) => x.staff_id as string);
  for (const staffId of staffIds) {
    await sendTelegramToStaff({ staffId, text });
  }
}

// ---------------------------------------------------------------------------
// TA2 — listPendingSwaps (Manager+): peer_accepted + open (informativ)
// ---------------------------------------------------------------------------

export type PendingSwapRow = {
  id: string;
  status: "open" | "peer_accepted";
  createdAt: string;
  respondedAt: string | null;
  note: string | null;
  declineCount: number;
  requester: { staffId: string; name: string };
  peer: { staffId: string; name: string } | null;
  requesterShift: {
    id: string;
    shiftDate: string;
    area: SwapArea;
    locationId: string;
    locationName: string;
    skillLabel: string | null;
  };
  peerShift: {
    id: string;
    shiftDate: string;
    area: SwapArea;
    locationId: string;
    locationName: string;
    skillLabel: string | null;
  } | null;
};

export const listPendingSwaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingSwapRow[]> => {
    // PL1 — planer zusätzlich zugelassen; Rechte-Check via has_permission.
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "planer",
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("shift_swap_requests")
      .select(
        "id, status, note, created_at, responded_at, requester:staff!shift_swap_requests_requester_staff_id_fkey(id, display_name), peer:staff!shift_swap_requests_peer_staff_id_fkey(id, display_name), req_shift:roster_shifts!shift_swap_requests_shift_id_fkey(id, shift_date, area, location_id, locations(name), skills(name)), peer_shift:roster_shifts!shift_swap_requests_peer_shift_id_fkey(id, shift_date, area, location_id, locations(name), skills(name))",
      )
      .eq("organization_id", caller.organizationId)
      .in("status", ["peer_accepted", "open"])
      .order("status", { ascending: true }) // 'open' < 'peer_accepted' alphabetisch
      .order("created_at", { ascending: false });
    if (error) throw error;
    const raw = (rows ?? []) as unknown as Array<{
      id: string;
      status: "open" | "peer_accepted";
      note: string | null;
      created_at: string;
      responded_at: string | null;
      requester: { id: string; display_name: string } | null;
      peer: { id: string; display_name: string } | null;
      req_shift: {
        id: string;
        shift_date: string;
        area: SwapArea;
        location_id: string;
        locations: { name: string } | null;
        skills: { name: string } | null;
      } | null;
      peer_shift: {
        id: string;
        shift_date: string;
        area: SwapArea;
        location_id: string;
        locations: { name: string } | null;
        skills: { name: string } | null;
      } | null;
    }>;

    const ids = raw.map((r) => r.id);
    const declineByRequest = new Map<string, number>();
    if (ids.length > 0) {
      const { data: decl, error: dErr } = await supabaseAdmin
        .from("shift_swap_declines")
        .select("request_id")
        .in("request_id", ids);
      if (dErr) throw dErr;
      for (const d of decl ?? []) {
        const k = d.request_id as string;
        declineByRequest.set(k, (declineByRequest.get(k) ?? 0) + 1);
      }
    }

    // peer_accepted zuerst, danach open — unabhängig von der DB-Sortierung.
    const sorted = [...raw].sort((a, b) => {
      if (a.status !== b.status) return a.status === "peer_accepted" ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });

    // PL1 — Scope-Filter über die Schicht des Anfragenden (locationId + area).
    const scope = await resolvePlanerScope(
      context.supabase,
      supabaseAdmin,
      caller.organizationId,
      "roster.swap.view_pending",
    );
    // PL2 — Aufrufer ohne jede Freigabe ⇒ Forbidden.
    assertScopeNotEmpty(scope, "roster.swap.view_pending");
    const inScope = (row: (typeof sorted)[number]) => {
      const rs = row.req_shift;
      if (!rs) return false;
      if (rs.area !== "kitchen" && rs.area !== "service") {
        // GL-Schichten fallen ausserhalb der Bereichs-Freigaben; für admin/manager
        // liefert scopeIncludes bei all=true trotzdem true.
        return scope.all;
      }
      return scopeIncludes(scope, rs.location_id, rs.area);
    };

    return sorted
      .filter(inScope)
      .filter((r) => r.req_shift && r.requester)
      .map((r) => ({
        id: r.id,
        status: r.status,
        note: r.note,
        createdAt: r.created_at,
        respondedAt: r.responded_at,
        declineCount: declineByRequest.get(r.id) ?? 0,
        requester: { staffId: r.requester!.id, name: r.requester!.display_name },
        peer: r.peer ? { staffId: r.peer.id, name: r.peer.display_name } : null,
        requesterShift: {
          id: r.req_shift!.id,
          shiftDate: r.req_shift!.shift_date,
          area: r.req_shift!.area,
          locationId: r.req_shift!.location_id,
          locationName: r.req_shift!.locations?.name ?? "—",
          skillLabel: r.req_shift!.skills?.name ?? null,
        },
        peerShift: r.peer_shift
          ? {
              id: r.peer_shift.id,
              shiftDate: r.peer_shift.shift_date,
              area: r.peer_shift.area,
              locationId: r.peer_shift.location_id,
              locationName: r.peer_shift.locations?.name ?? "—",
              skillLabel: r.peer_shift.skills?.name ?? null,
            }
          : null,
      }));
  });

// ---------------------------------------------------------------------------
// TA2 — decideSwapRequest (Manager+): approve → RPC-Vollzug, reject → Status
// ---------------------------------------------------------------------------

async function assertNoConflictingShift(
  admin: SupabaseClient<Database>,
  organizationId: string,
  params: {
    staffId: string;
    locationId: string;
    area: SwapArea;
    shiftDate: string;
    excludeShiftId: string;
  },
): Promise<void> {
  const { data, error } = await admin
    .from("roster_shifts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("staff_id", params.staffId)
    .eq("location_id", params.locationId)
    .eq("area", params.area)
    .eq("shift_date", params.shiftDate)
    .neq("id", params.excludeShiftId);
  if (error) throw error;
  if ((data ?? []).length > 0) {
    throw new Error(
      `Slot-Konflikt: Kollege hat am ${fmtDeDate(params.shiftDate)} bereits eine Schicht (${areaLabel(params.area)}).`,
    );
  }
}

export const decideSwapRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        requestId: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, [
      "manager",
      "admin",
      "planer",
    ]);
    type DecideResult = { ok: true; decision: "approved" | "rejected" };
    return runWithPermission<DecideResult>(
      context.supabase,
      "roster.swap.decide",
      null,
      makeAuditWriter(caller),
      async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: reqRow, error } = await supabaseAdmin
          .from("shift_swap_requests")
          .select(
            "id, status, shift_id, peer_shift_id, requester_staff_id, peer_staff_id, note, organization_id",
          )
          .eq("id", data.requestId)
          .eq("organization_id", caller.organizationId)
          .maybeSingle();
        if (error) throw error;
        if (!reqRow) throw new Error("Anfrage nicht gefunden.");
        if (reqRow.status !== "peer_accepted") {
          throw new Error("Anfrage wartet nicht auf Freigabe.");
        }

        // PL1 — Scope-Validierung der Anfragenden-Schicht VOR jeder Schreibaktion.
        const scope = await resolvePlanerScope(
          context.supabase,
          supabaseAdmin,
          caller.organizationId,
          "roster.swap.decide",
        );
        if (!scope.all) {
          const reqShiftForScope = await loadShift(
            supabaseAdmin,
            caller.organizationId,
            reqRow.shift_id,
          );
          if (reqShiftForScope.area !== "kitchen" && reqShiftForScope.area !== "service") {
            throw new ForbiddenError("Anfrage liegt außerhalb deines Bereichs.");
          }
          if (!scopeIncludes(scope, reqShiftForScope.location_id, reqShiftForScope.area)) {
            throw new ForbiddenError("Anfrage liegt außerhalb deines Bereichs.");
          }
        }

        if (data.decision === "rejected") {
          const nextNote = data.note
            ? `${reqRow.note ? reqRow.note + "\n" : ""}Ablehnung: ${data.note}`
            : reqRow.note;
          const { error: uErr } = await supabaseAdmin
            .from("shift_swap_requests")
            .update({
              status: "rejected",
              decided_at: new Date().toISOString(),
              decided_by: caller.userId,
              note: nextNote,
            })
            .eq("id", reqRow.id)
            .eq("status", "peer_accepted");
          if (uErr) throw uErr;
          return {
            result: { ok: true as const, decision: "rejected" as const },
            audit: {
              action: "swap.rejected",
              entity: "shift_swap_request",
              entityId: reqRow.id,
              meta: {
                requesterStaffId: reqRow.requester_staff_id,
                peerStaffId: reqRow.peer_staff_id,
                shiftId: reqRow.shift_id,
                peerShiftId: reqRow.peer_shift_id,
              },
            },
          };
        }

        // approved — Re-Validierung im Genehmigungsmoment.
        const reqShift = await loadShift(supabaseAdmin, caller.organizationId, reqRow.shift_id);
        const today = todayIso();
        if (reqShift.shift_date <= today) {
          throw new Error("Die Schicht liegt nicht mehr in der Zukunft.");
        }
        await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, reqShift.shift_date);

        let peerShift: ShiftRow | null = null;
        if (reqRow.peer_shift_id) {
          peerShift = await loadShift(supabaseAdmin, caller.organizationId, reqRow.peer_shift_id);
          if (peerShift.shift_date <= today) {
            throw new Error("Die Gegenschicht liegt nicht mehr in der Zukunft.");
          }
          await assertShiftDateUnlocked(supabaseAdmin, caller.organizationId, peerShift.shift_date);
        }

        // Slot-Konflikt-Check: Peer bekommt reqShift → darf am gleichen Slot keine
        // andere Schicht haben. Umgekehrt bei Gegentausch.
        if (reqRow.peer_staff_id) {
          await assertNoConflictingShift(supabaseAdmin, caller.organizationId, {
            staffId: reqRow.peer_staff_id,
            locationId: reqShift.location_id,
            area: reqShift.area,
            shiftDate: reqShift.shift_date,
            excludeShiftId: reqShift.id,
          });
        }
        if (peerShift) {
          await assertNoConflictingShift(supabaseAdmin, caller.organizationId, {
            staffId: reqRow.requester_staff_id,
            locationId: peerShift.location_id,
            area: peerShift.area,
            shiftDate: peerShift.shift_date,
            excludeShiftId: peerShift.id,
          });
        }

        // TA4 — Abwesenheits-Re-Validierung: zwischen Peer-Annahme und
        // Manager-Genehmigung kann Urlaub/Krank genehmigt worden sein.
        if (reqRow.peer_staff_id) {
          const peerAbsent = await hasAbsenceOnDate(
            supabaseAdmin,
            caller.organizationId,
            reqRow.peer_staff_id,
            reqShift.shift_date,
          );
          if (peerAbsent) {
            throw new Error(
              `Der Kollege ist am ${fmtDeDate(reqShift.shift_date)} abwesend (Urlaub/Krank) — Tausch kann nicht genehmigt werden.`,
            );
          }
        }
        if (peerShift) {
          const requesterAbsent = await hasAbsenceOnDate(
            supabaseAdmin,
            caller.organizationId,
            reqRow.requester_staff_id,
            peerShift.shift_date,
          );
          if (requesterAbsent) {
            throw new Error(
              `Der Anfragende ist am ${fmtDeDate(peerShift.shift_date)} abwesend (Urlaub/Krank) — Tausch kann nicht genehmigt werden.`,
            );
          }
        }

        // Atomarer Vollzug via RPC (SECURITY DEFINER, service_role).
        const { error: rpcErr } = await supabaseAdmin.rpc("execute_shift_swap", {
          p_request_id: reqRow.id,
          p_decided_by: caller.userId,
        });
        if (rpcErr) {
          throw new Error(`Vollzug fehlgeschlagen: ${rpcErr.message}`);
        }

        // RS1 — Nach-Sync für offene Sessions an beiden getauschten Tagen.
        await syncOpenSessionsPoolAfterRosterWrite({
          organizationId: caller.organizationId,
          targets: [
            { locationId: reqShift.location_id, businessDate: reqShift.shift_date },
            ...(peerShift
              ? [{ locationId: peerShift.location_id, businessDate: peerShift.shift_date }]
              : []),
          ],
          op: "roster.swap.decide",
        });

        return {
          result: { ok: true as const, decision: "approved" as const },
          audit: {
            action: "swap.approved",
            entity: "shift_swap_request",
            entityId: reqRow.id,
            meta: {
              requesterStaffId: reqRow.requester_staff_id,
              peerStaffId: reqRow.peer_staff_id,
              shiftId: reqRow.shift_id,
              shiftDate: reqShift.shift_date,
              peerShiftId: reqRow.peer_shift_id,
              peerShiftDate: peerShift?.shift_date ?? null,
            },
          },
        };
      },
    );
  });
