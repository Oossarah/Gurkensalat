create table if not exists public.tischwahl_rooms (
  room_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tischwahl_rooms enable row level security;

grant select, insert, update on public.tischwahl_rooms to anon;

drop policy if exists "Anyone can read Tischwahl rooms" on public.tischwahl_rooms;
create policy "Anyone can read Tischwahl rooms"
on public.tischwahl_rooms
for select
to anon
using (true);

drop policy if exists "Anyone can create Tischwahl rooms" on public.tischwahl_rooms;
create policy "Anyone can create Tischwahl rooms"
on public.tischwahl_rooms
for insert
to anon
with check (true);

drop policy if exists "Anyone can update Tischwahl rooms" on public.tischwahl_rooms;
create policy "Anyone can update Tischwahl rooms"
on public.tischwahl_rooms
for update
to anon
using (true)
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.tischwahl_rooms;
exception
  when duplicate_object then null;
end $$;
