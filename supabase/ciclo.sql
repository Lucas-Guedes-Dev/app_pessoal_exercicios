-- Configuração do ciclo de semanas, controlada pelo Claude (via MCP) e pelo app.
-- Rode no SQL Editor do Supabase (pode rodar de novo sem problema).
--
-- Uma linha só (id = 1):
--   semanas:       quantas semanas tem o ciclo (1 a 6 → A..F)
--   semana_atual:  letra da semana que valia na segunda-feira "semana_inicio".
--                  O app calcula a letra de hoje avançando uma letra por segunda-feira.
--   semana_inicio: segunda-feira (YYYY-MM-DD) em que "semana_atual" valia

create table if not exists public.ciclo (
  id            smallint primary key default 1 check (id = 1),
  semanas       smallint not null check (semanas between 1 and 6),
  semana_atual  text check (semana_atual ~ '^[A-F]$'),
  semana_inicio date,
  atualizado_em timestamptz not null default now(),
  check ((semana_atual is null) = (semana_inicio is null))
);

create or replace function public.ciclo_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists ciclo_set_atualizado_em on public.ciclo;
create trigger ciclo_set_atualizado_em
  before update on public.ciclo
  for each row execute function public.ciclo_set_atualizado_em();

-- O app (anon) lê e também grava, para mudanças feitas na tela "Semanas" chegarem ao Claude.
alter table public.ciclo enable row level security;

drop policy if exists "anon pode ler ciclo" on public.ciclo;
create policy "anon pode ler ciclo"
  on public.ciclo for select to anon using (true);

drop policy if exists "anon pode inserir ciclo" on public.ciclo;
create policy "anon pode inserir ciclo"
  on public.ciclo for insert to anon with check (id = 1);

drop policy if exists "anon pode atualizar ciclo" on public.ciclo;
create policy "anon pode atualizar ciclo"
  on public.ciclo for update to anon using (id = 1) with check (id = 1);
