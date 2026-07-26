alter table public.organization_settings
  add column if not exists pausen_bezahlt boolean not null default true;

comment on column public.organization_settings.pausen_bezahlt is
  'true = Pausenzeit wird vergütet (Vergütungsstunden brutto). '
  'false = Pausenzeit wird abgezogen (netto). Default true = bisheriges '
  'Verhalten des Altsystems, das keine Pausenerfassung kannte. '
  'Wirkung auf SFN-Töpfe: siehe PB2 — in PB1 wird die Spalte nicht gelesen.';

notify pgrst, 'reload schema';