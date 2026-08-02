// EV1-R1 — Server-Functions der Events-Verwaltung (admin).
//
// Dünne Wrapper-Datei: Modul-Scope hält nur Imports, Zod-Schemata und die
// Server-Function-Deklarationen. Parser und Mapping leben in events-core.ts
// bzw. parse-events-xlsx.ts, `supabaseAdmin` wird erst im Handler geladen.
//
// Idempotenz (F10): Upsert auf (organization_id, name, date_from). Bestehende
// Zeilen werden vollständig aktualisiert (inkl. provisional), neue angelegt.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { loadAdminCaller } from "@/lib/admin/admin-context";
import { makeAuditWriter } from "@/lib/admin/audit";
import {
  EVENT_IMPACTS,
  detectTermChanges,
  importKey,
  isEventImpact,
  type EventRow,
  type TermChangeHint,
} from "./events-core";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format YYYY-MM-DD erwartet");

const eventFields = z.object({
  name: z.string().trim().min(1).max(300),
  dateFrom: isoDate,
  dateTo: isoDate,
  category: z.string().trim().min(1).max(120),
  locationText: z.string().trim().max(300).nullable().default(null),
  distanceText: z.string().trim().max(120).nullable().default(null),
  impact: z.enum(EVENT_IMPACTS),
  recommendation: z.string().trim().max(2000).nullable().default(null),
  source: z.string().trim().max(500).nullable().default(null),
  provisional: z.boolean().default(false),
});

const createInput = eventFields.refine((v) => v.dateTo >= v.dateFrom, {
  message: "Bis-Datum darf nicht vor dem Von-Datum liegen.",
});

const updateInput = eventFields
  .extend({ id: z.string().uuid() })
  .refine((v) => v.dateTo >= v.dateFrom, {
    message: "Bis-Datum darf nicht vor dem Von-Datum liegen.",
  });

const importInput = z.object({
  rows: z.array(createInput).min(1, "Keine Zeilen zum Übernehmen."),
});

type DbRow = {
  id: string;
  name: string;
  date_from: string;
  date_to: string;
  category: string;
  location_text: string | null;
  distance_text: string | null;
  impact: string;
  recommendation: string | null;
  source: string | null;
  provisional: boolean;
};

const SELECT_COLS =
  "id, name, date_from, date_to, category, location_text, distance_text, impact, recommendation, source, provisional";

function rowFromDb(r: DbRow): EventRow {
  return {
    id: r.id,
    name: r.name,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    category: r.category,
    locationText: r.location_text,
    distanceText: r.distance_text,
    // DB hält `impact` als text mit CHECK; unbekannte Werte können nur durch
    // manuelles SQL entstehen und werden hier konservativ auf "mittel" gelesen.
    impact: isEventImpact(r.impact) ? r.impact : "mittel",
    recommendation: r.recommendation,
    source: r.source,
    provisional: r.provisional,
  };
}

type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

function payload(
  organizationId: string,
  v: z.infer<typeof eventFields>,
): Omit<EventInsert, "id"> {
  return {
    organization_id: organizationId,
    name: v.name,
    date_from: v.dateFrom,
    date_to: v.dateTo,
    category: v.category,
    location_text: v.locationText,
    distance_text: v.distanceText,
    impact: v.impact,
    recommendation: v.recommendation,
    source: v.source,
    provisional: v.provisional,
  };
}

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin", "manager"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("events")
      .select(SELECT_COLS)
      .eq("organization_id", caller.organizationId)
      .order("date_from", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => rowFromDb(r as unknown as DbRow));
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin
      .from("events")
      .insert(payload(caller.organizationId, data) as EventInsert)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = rowFromDb(saved as unknown as DbRow);
    await makeAuditWriter(caller)({
      action: "events.create",
      entity: "events",
      entityId: row.id,
      meta: { name: row.name, date_from: row.dateFrom, impact: row.impact },
    });
    return row;
  });

export const updateEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...fields } = data;
    const { data: saved, error } = await supabaseAdmin
      .from("events")
      .update(payload(caller.organizationId, fields))
      .eq("id", id)
      .eq("organization_id", caller.organizationId)
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!saved) throw new Error("Veranstaltung nicht gefunden.");
    const row = rowFromDb(saved as unknown as DbRow);
    await makeAuditWriter(caller)({
      action: "events.update",
      entity: "events",
      entityId: row.id,
      meta: { name: row.name, date_from: row.dateFrom, impact: row.impact },
    });
    return row;
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: snap, error: snapErr } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    if (snapErr) throw snapErr;
    if (!snap) throw new Error("Veranstaltung nicht gefunden.");
    const { error: delErr } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", data.id)
      .eq("organization_id", caller.organizationId);
    if (delErr) throw delErr;
    await makeAuditWriter(caller)({
      action: "events.delete",
      entity: "events",
      entityId: data.id,
      meta: { snapshot: snap as Record<string, unknown> },
    });
    return { ok: true as const };
  });

/**
 * Vorschau-Hilfe: liefert die Schlüssel des Bestands, damit die Import-UI
 * „neu / aktualisiert / möglicher Terminwechsel" ohne Schreibzugriff anzeigen
 * kann.
 */
export const getEventImportContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("events")
      .select("id, name, date_from")
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      dateFrom: r.date_from as string,
    }));
  });

export const importEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    const caller = await loadAdminCaller(context.supabase, context.userId, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("events")
      .select("id, name, date_from")
      .eq("organization_id", caller.organizationId);
    if (exErr) throw exErr;
    const existingKeys = new Set(
      (existing ?? []).map((r) => importKey(r.name as string, r.date_from as string)),
    );
    const existingList = (existing ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      dateFrom: r.date_from as string,
    }));

    let created = 0;
    let updated = 0;
    const failed: { name: string; dateFrom: string; message: string }[] = [];

    for (const row of data.rows) {
      const wasUpdate = existingKeys.has(importKey(row.name, row.dateFrom));
      const { error } = await supabaseAdmin
        .from("events")
        .upsert(payload(caller.organizationId, row) as EventInsert, {
          onConflict: "organization_id,name,date_from",
        });
      if (error) {
        failed.push({ name: row.name, dateFrom: row.dateFrom, message: error.message });
        continue;
      }
      if (wasUpdate) updated += 1;
      else created += 1;
    }

    const termChanges: TermChangeHint[] = detectTermChanges(data.rows, existingList);

    await makeAuditWriter(caller)({
      action: "events.import",
      entity: "events",
      meta: {
        created,
        updated,
        failed: failed.length,
        term_change_hints: termChanges.length,
      },
    });

    return { created, updated, failed, termChanges };
  });