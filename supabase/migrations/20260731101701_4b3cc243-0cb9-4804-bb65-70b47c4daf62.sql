-- SL1: edlohn-Zeitlohn-Slot je Person und Arbeitsbereich.
--
-- Der Slot ist in edlohn die Anlage-Reihenfolge der Zeitlohn-Lohnarten JE
-- PERSON — kein bereichsweites Schema. 38 von 40 Personen laufen dort auf
-- Slot 1 (edlohn-Ist Juli 2026, Lohnbüro-bestätigt 31.07.2026). Diese
-- Tabelle ist ausschließlich EXPORT-relevant: Bezeichnung, Kategorie und
-- Spaltenzuordnung folgen dem Slot; die Engine rechnet unverändert nach
-- Bereichen (Stunden, Sätze, Beträge, SFN-Töpfe bleiben bit-identisch).
--
-- DENY-ALL für Client, identisch zu staff_compensation_rates: Zugriff nur
-- über Server-Functions mit requireSupabaseAuth + has_permission-Check.

CREATE TABLE IF NOT EXISTS public.staff_edlohn_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  department public.staff_department NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, department),
  UNIQUE (staff_id, slot)
);

COMMENT ON TABLE public.staff_edlohn_slots IS
  'SL1: edlohn-Zeitlohn-Slot (1..3) je Mitarbeiter und Arbeitsbereich. Nur export-relevant (Bezeichnung/Kategorie/Spalte); die Lohn-Engine rechnet unverändert nach Bereichen. DENY-ALL für Client — Zugriff nur via Server-Functions.';
COMMENT ON COLUMN public.staff_edlohn_slots.slot IS
  'Anlage-Reihenfolge der Zeitlohn-Lohnart in edlohn JE PERSON (1 = Zeitlohn, 2 = Zeitlohn 2, 3 = Zeitlohn 3).';

CREATE INDEX IF NOT EXISTS idx_staff_edlohn_slots_org
  ON public.staff_edlohn_slots(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_edlohn_slots_staff
  ON public.staff_edlohn_slots(staff_id);

-- Nur service_role — Client hat keinerlei direkten Zugriff.
GRANT ALL ON public.staff_edlohn_slots TO service_role;

ALTER TABLE public.staff_edlohn_slots ENABLE ROW LEVEL SECURITY;

-- Keine Policies für authenticated/anon: RLS verweigert damit jeden
-- Client-Zugriff. service_role bypasst RLS.

DROP TRIGGER IF EXISTS trg_staff_edlohn_slots_updated_at ON public.staff_edlohn_slots;
CREATE TRIGGER trg_staff_edlohn_slots_updated_at
  BEFORE UPDATE ON public.staff_edlohn_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();