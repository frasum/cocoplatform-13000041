-- WX1 — Wetterdaten (vorgezogener PG0-Baustein).
-- Ein Datensatz je Organisation und Geschäftstag: beide Häuser stehen im
-- selben München-Wetter (PG-Beschluss: Wetter ist gemeinsamer Faktor).
--
-- numeric hier ausdrücklich begründet: Es sind GEMESSENE Größen (Temperatur,
-- Niederschlag, Sonnenscheindauer), keine Geldbeträge. Die Cent-Integer-Regel
-- des Projekts gilt für gerechnete Geldgrößen, nicht für Messwerte.

CREATE TABLE IF NOT EXISTS public.weather_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  business_date date NOT NULL,
  temp_max_c numeric(4, 1),
  temp_min_c numeric(4, 1),
  precipitation_mm numeric(5, 1),
  sunshine_hours numeric(4, 1),
  source text NOT NULL CHECK (source IN ('forecast', 'archive')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, business_date)
);

COMMENT ON TABLE public.weather_days IS
  'WX1 — Tageswetter (Open-Meteo, München) je Organisation. Schreiben nur via Server-Functions (Service-Role).';

GRANT SELECT ON public.weather_days TO authenticated;
GRANT ALL ON public.weather_days TO service_role;

ALTER TABLE public.weather_days ENABLE ROW LEVEL SECURITY;

-- Drops vor Creates (ODER-Falle vermeiden).
DROP POLICY IF EXISTS weather_days_select_own_org ON public.weather_days;

CREATE POLICY weather_days_select_own_org ON public.weather_days
  FOR SELECT
  TO authenticated
  USING (organization_id = public.current_organization_id());

-- Kein INSERT/UPDATE/DELETE für authenticated: DENY-ALL beim Schreiben.
-- Schreibpfade laufen ausschließlich über syncWeather/backfillWeather
-- (Service-Role + admin-Rollencheck).