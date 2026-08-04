// SE1 — Zugriffs-Shim auf public.session_other_incomes.
//
// Die Tabelle kommt mit der SE1-Migration (Ausführung Bauherr). Bis
// `src/integrations/supabase/types.ts` neu generiert ist, kennt der generierte
// Database-Typ sie nicht. Der Zugriff wird deshalb an GENAU EINER Stelle mit
// explizitem Row-/Insert-Typ entkoppelt — kein `any`, keine zweite Stelle.
//
// TODO (nach Typ-Regeneration): Shim entfernen und direkt
// `supabaseAdmin.from("session_other_incomes")` verwenden.

import type { SupabaseClient } from "@supabase/supabase-js";

export type OtherIncomeRow = {
  id: string;
  organization_id: string;
  session_id: string;
  description: string;
  amount_cents: number;
  created_at: string;
};

type OtherIncomeInsert = {
  organization_id: string;
  session_id: string;
  description: string;
  amount_cents: number;
};

type OtherIncomesDb = {
  public: {
    Tables: {
      session_other_incomes: {
        Row: OtherIncomeRow;
        Insert: OtherIncomeInsert;
        Update: Partial<OtherIncomeInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** Typisierter Tabellen-Handle. `admin` ist der generierte Admin-Client. */
export function otherIncomesTable(admin: unknown) {
  return (admin as SupabaseClient<OtherIncomesDb, "public">).from("session_other_incomes");
}

/** Positions-Summe — die EINE Rechenstelle für „sonstige Einnahmen". */
export function sumOtherIncomeCents(items: Array<{ amountCents: number }>): number {
  let total = 0;
  for (const i of items) total += i.amountCents;
  return total;
}
