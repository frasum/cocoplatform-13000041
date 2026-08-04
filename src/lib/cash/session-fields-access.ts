// FS1 — Zugriffs-Shim auf public.locations.disabled_session_fields.
//
// Die Spalte kommt mit der FS1-Migration (Ausführung Bauherr). Bis
// `src/integrations/supabase/types.ts` neu generiert ist, kennt der generierte
// Database-Typ sie nicht. Der Zugriff wird deshalb an GENAU EINER Stelle mit
// explizitem Row-Typ entkoppelt — kein `any`, keine zweite Stelle.
//
// TODO (nach Typ-Regeneration): Shim entfernen und direkt
// `supabaseAdmin.from("locations").select("disabled_session_fields")` nutzen.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDisabledSessionFields, type SessionFieldKey } from "./session-fields";

type LocationFieldsRow = {
  id: string;
  name: string;
  organization_id: string;
  disabled_session_fields: string[] | null;
};

type LocationFieldsDb = {
  public: {
    Tables: {
      locations: {
        Row: LocationFieldsRow;
        Insert: { id?: string; name?: string; disabled_session_fields?: string[] };
        Update: { disabled_session_fields?: string[] };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

function table(admin: unknown) {
  return (admin as SupabaseClient<LocationFieldsDb, "public">).from("locations");
}

/** Deaktivierte Session-Felder aller Standorte einer Organisation. */
export async function loadDisabledSessionFieldsByLocation(
  admin: unknown,
  organizationId: string,
): Promise<Map<string, SessionFieldKey[]>> {
  const { data, error } = await table(admin)
    .select("id, name, disabled_session_fields")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const out = new Map<string, SessionFieldKey[]>();
  for (const row of data ?? []) {
    out.set(row.id, parseDisabledSessionFields(row.disabled_session_fields));
  }
  return out;
}

/** Deaktivierte Session-Felder EINES Standorts (Schreibpfad-Guard). */
export async function loadDisabledSessionFields(
  admin: unknown,
  organizationId: string,
  locationId: string,
): Promise<SessionFieldKey[]> {
  const { data, error } = await table(admin)
    .select("id, name, disabled_session_fields")
    .eq("organization_id", organizationId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  return parseDisabledSessionFields(data?.disabled_session_fields);
}

/** Setzt die Liste (Whitelist-geprüft durch den Aufrufer). */
export async function saveDisabledSessionFields(
  admin: unknown,
  organizationId: string,
  locationId: string,
  keys: SessionFieldKey[],
): Promise<void> {
  const { error } = await table(admin)
    .update({ disabled_session_fields: keys })
    .eq("organization_id", organizationId)
    .eq("id", locationId);
  if (error) throw error;
}
