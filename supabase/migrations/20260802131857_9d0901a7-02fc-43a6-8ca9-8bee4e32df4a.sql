ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS roster_plannable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.staff.roster_plannable IS
  'Erscheint in Dienstplan-/Planungsansichten. false für Feste-Zeiten-Kräfte; Zeiterfassung/Lohn unberührt.';