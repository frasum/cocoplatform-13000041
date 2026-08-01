// STAT2 — IO-Rand der gemeinsamen Arbeitszeit-Quelle.
//
// Lädt `time_entries` im Fenster (paginiert, BFIX3) und den Org-Schalter
// `pausen_bezahlt`. Beide Statistik-Server-Funktionen (Personalquote und
// Umsatz) nutzen genau diesen Loader — die Minuten-Regel selbst liegt rein in
// `work-minutes.ts`.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { selectAllPaged } from "@/lib/supabase/select-all";
import { mapTimeEntryRows, type TimeEntryRow, type WorkMinutesEntry } from "./work-minutes";

/** PB2 — Vergütungsminuten folgen dem Org-Schalter (Default TRUE). */
export async function loadPausenBezahlt(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("organization_settings")
    .select("pausen_bezahlt")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data?.pausen_bezahlt ?? true;
}

export async function loadWorkMinutesEntries(
  admin: SupabaseClient<Database>,
  args: {
    organizationId: string;
    startDate: string;
    endDate: string;
    locationId?: string | undefined;
    pausenBezahlt: boolean;
  },
): Promise<WorkMinutesEntry[]> {
  // BFIX3: PostgREST kappt bei 1000 Zeilen — paginieren, sonst wird die
  // Statistik still unvollständig.
  const rows = await selectAllPaged<TimeEntryRow & { id: string; location_id: string | null }>(
    (from, to) => {
      let q = admin
        .from("time_entries")
        .select(
          "id, staff_id, started_at, ended_at, break_minutes, business_date, location_id, department",
        )
        .eq("organization_id", args.organizationId)
        .gte("business_date", args.startDate)
        .lte("business_date", args.endDate)
        .not("ended_at", "is", null)
        .order("id", { ascending: true });
      if (args.locationId) q = q.eq("location_id", args.locationId);
      return q.range(from, to);
    },
  );
  return mapTimeEntryRows(rows ?? [], args.pausenBezahlt);
}