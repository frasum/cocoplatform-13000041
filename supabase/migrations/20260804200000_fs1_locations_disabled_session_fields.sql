-- FS1 — Session-Feld-Sichtbarkeit je Standort.
--
-- „Finedine-Gutscheine" ist ein SESSION-FELD (feste Eingabemaske), kein
-- Katalog-Kanal. Standorte, die ein Feld nie nutzen, schalten es hier ab.
-- Deaktivierung wirkt AB JETZT: historische Werte in `sessions` bleiben
-- unverändert lesbar; Export/Druck zeigen die Spalte bei historischen
-- Werten weiterhin.
--
-- Erlaubte Schlüssel (Code-Konstante SESSION_FIELD_KEYS): 'finedine'.

alter table public.locations
  add column if not exists disabled_session_fields text[] not null default '{}';

alter table public.locations
  drop constraint if exists locations_disabled_session_fields_check;

alter table public.locations
  add constraint locations_disabled_session_fields_check
  check (disabled_session_fields <@ array['finedine']::text[]);

comment on column public.locations.disabled_session_fields is
  'FS1: am Standort deaktivierte Session-Felder der Kassenmaske (Schlüssel, heute nur ''finedine'').';
