create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  date_from date not null,
  date_to date not null,
  category text not null,
  location_text text,
  distance_text text,
  impact text not null check (impact in ('sehr_hoch','hoch','mittel_hoch','mittel')),
  recommendation text,
  source text,
  provisional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_date_order check (date_to >= date_from),
  constraint events_org_name_from_key unique (organization_id, name, date_from)
);

create index if not exists events_org_date_from_idx
  on public.events (organization_id, date_from);

grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;

alter table public.events enable row level security;

drop policy if exists events_select on public.events;
create policy events_select on public.events
for select to authenticated
using (organization_id = public.current_organization_id());

drop policy if exists events_write on public.events;
create policy events_write on public.events
for all to authenticated
using (organization_id = public.current_organization_id() and public.has_min_permission('admin'))
with check (organization_id = public.current_organization_id() and public.has_min_permission('admin'));

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
before update on public.events
for each row execute function public.tg_set_updated_at();