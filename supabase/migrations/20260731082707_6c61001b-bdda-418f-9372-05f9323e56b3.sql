-- TG4: Verteilmodus des Trinkgeld-Pools, datiert.
-- Nachgereichte Versionierung: die Spalten wurden bei TG4 direkt in der
-- Datenbank angelegt, aber nicht als Migration abgelegt. Idempotent.
-- Verhaltensneutral: Default 'hours' + _from NULL => Verteilung nach Stunden.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS tip_distribution_mode text NOT NULL DEFAULT 'hours',
  ADD COLUMN IF NOT EXISTS tip_distribution_mode_from date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organization_settings_tip_distribution_mode_check'
  ) THEN
    ALTER TABLE public.organization_settings
      ADD CONSTRAINT organization_settings_tip_distribution_mode_check
      CHECK (tip_distribution_mode IN ('hours', 'headcount'));
  END IF;
END $$;

COMMENT ON COLUMN public.organization_settings.tip_distribution_mode IS
  'Verteilmodus des Trinkgeld-Pools, gueltig AB tip_distribution_mode_from. Davor gilt immer hours.';
COMMENT ON COLUMN public.organization_settings.tip_distribution_mode_from IS
  'Stichtag als business_date. NULL = Modus nicht aktiv, es gilt durchgaengig hours.';

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS tip_distribution_mode_override text,
  ADD COLUMN IF NOT EXISTS tip_distribution_mode_from_override date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'locations_tip_distribution_mode_override_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_tip_distribution_mode_override_check
      CHECK (tip_distribution_mode_override IS NULL
             OR tip_distribution_mode_override IN ('hours', 'headcount'));
  END IF;
END $$;

COMMENT ON COLUMN public.locations.tip_distribution_mode_override IS
  'Standort-Uebersteuerung. Wirkt nur als PAAR mit tip_distribution_mode_from_override.';