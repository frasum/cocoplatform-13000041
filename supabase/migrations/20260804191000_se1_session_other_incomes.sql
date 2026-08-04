-- SE1 — Sonstige Einnahmen als Positionsliste (Muster: session_expenses).
--
-- Bauherren-Entscheid 04.08.2026: Sonstige Einnahmen werden wie Ausgaben und
-- Vorschüsse als Positionsliste mit Beschreibung geführt, nicht als anonymes
-- Betragsfeld auf der Session.
--
-- Struktur 1:1 nach public.session_expenses (id, organization_id, session_id,
-- description, amount_cents, created_at, RLS: nur SELECT für authenticated in
-- der eigenen Organisation; Schreibpfade laufen ausschließlich über die
-- Server-Funktionen mit service_role).
-- Abweichung zum Vorbild (bewusst, SE1-Vorgabe): CHECK amount_cents > 0.

create table public.session_other_incomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  description text not null,
  amount_cents bigint not null constraint session_other_incomes_amount_positive check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index session_other_incomes_session_id_idx on public.session_other_incomes (session_id);
create index session_other_incomes_org_id_idx on public.session_other_incomes (organization_id);

grant select on public.session_other_incomes to authenticated;
grant all on public.session_other_incomes to service_role;

alter table public.session_other_incomes enable row level security;

create policy "soi_select_own_org" on public.session_other_incomes
  for select to authenticated
  using (organization_id = public.current_organization_id());

-- Bestandsübernahme: jeder Session-Betrag > 0 wird EINE Position.
-- Referenzfall: 27.07.2026 / YUM mit 30,00 €.
insert into public.session_other_incomes (organization_id, session_id, description, amount_cents)
select s.organization_id, s.id, 'Übernahme Alt-Erfassung', s.sonstige_einnahme_cents
from public.sessions s
where coalesce(s.sonstige_einnahme_cents, 0) > 0;

-- Altfeld wird ab SE1 nicht mehr beschrieben und nicht mehr gelesen. Damit ein
-- versehentlicher Alt-Leser keine Doppelzählung erzeugt, wird der Restwert hier
-- genullt. Die SPALTE bleibt bewusst stehen — ihre Entfernung ist ein eigener,
-- späterer Schritt.
update public.sessions
set sonstige_einnahme_cents = 0
where coalesce(sonstige_einnahme_cents, 0) <> 0;
