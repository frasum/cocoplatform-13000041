ALTER TABLE public.roster_absence
  DROP CONSTRAINT IF EXISTS roster_absence_type_check;

ALTER TABLE public.roster_absence
  ADD CONSTRAINT roster_absence_type_check
  CHECK (type IN ('urlaub','krank','urlaub_unbezahlt'));

COMMENT ON CONSTRAINT roster_absence_type_check
  ON public.roster_absence IS
  'UB1: urlaub_unbezahlt ergänzt (04.08.2026) — unbezahlter Urlaub, keine Fortzahlung; Diagnose zählt ihn nicht als bezahlte U-Tage.';