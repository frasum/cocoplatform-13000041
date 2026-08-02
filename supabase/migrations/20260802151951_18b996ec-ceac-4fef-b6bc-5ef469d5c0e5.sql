ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS cash_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.locations.cash_enabled IS
  'Nimmt am Kassenbetrieb/Auswertungen teil. false = reiner Planungs-Standort (Dienstplan/Zeit), z. B. TSB.';