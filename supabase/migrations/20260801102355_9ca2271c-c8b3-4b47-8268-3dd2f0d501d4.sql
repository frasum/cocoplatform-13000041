-- MB1: Monatsumsatz-Historie (Legacy-Import + Referenzpunkt fuer die Live-Grenze).
CREATE TABLE public.monthly_revenue_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  total_cents bigint NOT NULL,
  takeaway_cents bigint,
  source text NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, year, month)
);

COMMENT ON TABLE public.monthly_revenue_history IS
  'MB1: Vor-COCO-Monatsumsaetze (Excel-Import 2002ff). Ab Maerz 2026 rechnet COCO live aus sessions (decomposeRevenue) — Live-Monate werden hier NICHT gespeichert (kein abgeleiteter Wert).';

-- DENY-ALL fuer Clients; Zugriff ausschliesslich via Server-Functions (service_role).
GRANT ALL ON public.monthly_revenue_history TO service_role;
ALTER TABLE public.monthly_revenue_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX monthly_revenue_history_org_year_idx
  ON public.monthly_revenue_history (organization_id, year, month);