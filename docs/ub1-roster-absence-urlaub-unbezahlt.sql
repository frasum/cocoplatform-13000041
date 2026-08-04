-- UB1 — Abwesenheitstyp 'urlaub_unbezahlt' zulassen.
--
-- HINWEIS (§104): Diese Datei liegt bewusst NICHT unter supabase/migrations/.
-- Der Auftrag verlangt „Datei liefern, Ausführung Bauherr"; das Migrations-
-- Werkzeug würde die Migration anlegen UND (nach Freigabe) ausführen.
-- Der Bauherr kopiert den Inhalt in den SQL-Editor bzw. legt daraus die
-- Migration an. Muster: 20260629160444 (krank-Erweiterung).
--
-- Bis zur Ausführung lehnt der CHECK Schreibversuche mit dem neuen Typ ab —
-- der Code ist bereits vorbereitet, die Kalendertypen bleiben sonst gleich.

alter table public.roster_absence drop constraint if exists roster_absence_type_check;
alter table public.roster_absence
  add  constraint roster_absence_type_check check (type in ('urlaub','krank','urlaub_unbezahlt'));
