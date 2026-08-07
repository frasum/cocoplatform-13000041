ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopen_reason text;

CREATE INDEX IF NOT EXISTS sessions_reopened_by_idx ON public.sessions (reopened_by);

COMMENT ON COLUMN public.sessions.reopened_at IS 'Zeitpunkt des letzten Wiederoeffnens einer finalisierten Session (Aenderungs-Log).';
COMMENT ON COLUMN public.sessions.reopened_by IS 'staff_id des Admins, der die Session wieder geoeffnet hat.';
COMMENT ON COLUMN public.sessions.reopen_reason IS 'Pflicht-Grund fuer das Wiederoeffnen; wird im Aenderungs-Log angezeigt.';