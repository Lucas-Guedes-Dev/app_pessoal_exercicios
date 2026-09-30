-- Alimentação: base de alimentos, medidas caseiras e diário.
-- Rode no SQL Editor do Supabase (pode rodar de novo sem problema).
-- Depois rode supabase/alimentos_seed.sql para subir a base TACO.
--
-- IDs dos alimentos (iguais aos do app, sem tabela de mapeamento):
--   < 100000            base TACO + complementos (src/data/foods.json)
--   100000 – 999999     alimentos próprios criados no app
--   >= 1000000          alimentos próprios criados pelo Claude (sequence abaixo)
-- Medidas personalizadas e registros do diário usam uuid, gerado por quem cria
-- (app ou servidor), para que reenviar o mesmo item não duplique.
-- Valores nutricionais sempre por 100 g.

create sequence if not exists public.alimentos_custom_id_seq start with 1000000 minvalue 1000000;

create table if not exists public.alimentos (
  id            bigint primary key default nextval('public.alimentos_custom_id_seq'),
  nome          text not null check (length(trim(nome)) > 0),
  busca         text not null,                  -- nome sem acento e em minúsculas
  categoria     text,
  kcal          numeric not null check (kcal >= 0),
  proteina      numeric not null default 0 check (proteina >= 0),
  carbo         numeric not null default 0 check (carbo >= 0),
  gordura       numeric not null default 0 check (gordura >= 0),
  fibra         numeric not null default 0 check (fibra >= 0),
  fonte         text not null check (fonte in ('taco', 'complemento', 'custom')),
  observacao    text,
  comum         boolean not null default false,
  deletado      boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter sequence public.alimentos_custom_id_seq owned by public.alimentos.id;

create table if not exists public.alimento_porcoes (
  id            uuid primary key default gen_random_uuid(),
  alimento_id   bigint not null references public.alimentos (id) on delete cascade,
  rotulo        text not null check (length(trim(rotulo)) > 0),
  gramas        numeric not null check (gramas > 0),
  personalizada boolean not null default true,  -- false = medida da base (vem do seed)
  deletado      boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.registros_alimentacao (
  id            uuid primary key default gen_random_uuid(),
  data          date not null,
  refeicao      text not null check (refeicao in ('cafe', 'almoco', 'lanche', 'jantar', 'ceia')),
  alimento_id   bigint references public.alimentos (id) on delete set null,
  nome          text not null,
  gramas        numeric not null check (gramas > 0),
  porcao_rotulo text,
  porcao_qtd    numeric,
  -- nutrientes calculados no momento do registro (cópia, como no app)
  kcal          numeric not null,
  proteina      numeric not null default 0,
  carbo         numeric not null default 0,
  gordura       numeric not null default 0,
  deletado      boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists alimentos_atualizado_em_idx on public.alimentos (atualizado_em, id);
create index if not exists alimentos_busca_idx on public.alimentos (busca);
create index if not exists alimento_porcoes_alimento_idx on public.alimento_porcoes (alimento_id);
create index if not exists alimento_porcoes_atualizado_em_idx on public.alimento_porcoes (atualizado_em, id);
create index if not exists registros_alimentacao_data_idx on public.registros_alimentacao (data);
create index if not exists registros_alimentacao_atualizado_em_idx on public.registros_alimentacao (atualizado_em, id);

-- atualizado_em sempre com a hora do servidor: é o cursor da sincronização do app
create or replace function public.alimentacao_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists alimentos_set_atualizado_em on public.alimentos;
create trigger alimentos_set_atualizado_em
  before insert or update on public.alimentos
  for each row execute function public.alimentacao_set_atualizado_em();

drop trigger if exists alimento_porcoes_set_atualizado_em on public.alimento_porcoes;
create trigger alimento_porcoes_set_atualizado_em
  before insert or update on public.alimento_porcoes
  for each row execute function public.alimentacao_set_atualizado_em();

drop trigger if exists registros_alimentacao_set_atualizado_em on public.registros_alimentacao;
create trigger registros_alimentacao_set_atualizado_em
  before insert or update on public.registros_alimentacao
  for each row execute function public.alimentacao_set_atualizado_em();

-- Segurança:
-- - O servidor MCP usa a service_role key (ignora o RLS).
-- - O app (anon) lê tudo e grava só o que é da pessoa: alimentos 'custom',
--   medidas personalizadas e o diário. Nunca altera a base TACO.
--   Não há DELETE: exclusão é soft delete (deletado = true), via UPDATE.
alter table public.alimentos enable row level security;
alter table public.alimento_porcoes enable row level security;
alter table public.registros_alimentacao enable row level security;

drop policy if exists "anon pode ler alimentos" on public.alimentos;
create policy "anon pode ler alimentos"
  on public.alimentos for select to anon using (true);

drop policy if exists "anon pode inserir alimentos proprios" on public.alimentos;
create policy "anon pode inserir alimentos proprios"
  on public.alimentos for insert to anon with check (fonte = 'custom');

drop policy if exists "anon pode atualizar alimentos proprios" on public.alimentos;
create policy "anon pode atualizar alimentos proprios"
  on public.alimentos for update to anon using (fonte = 'custom') with check (fonte = 'custom');

drop policy if exists "anon pode ler porcoes" on public.alimento_porcoes;
create policy "anon pode ler porcoes"
  on public.alimento_porcoes for select to anon using (true);

drop policy if exists "anon pode inserir porcoes personalizadas" on public.alimento_porcoes;
create policy "anon pode inserir porcoes personalizadas"
  on public.alimento_porcoes for insert to anon with check (personalizada);

drop policy if exists "anon pode atualizar porcoes personalizadas" on public.alimento_porcoes;
create policy "anon pode atualizar porcoes personalizadas"
  on public.alimento_porcoes for update to anon using (personalizada) with check (personalizada);

drop policy if exists "anon pode ler registros" on public.registros_alimentacao;
create policy "anon pode ler registros"
  on public.registros_alimentacao for select to anon using (true);

drop policy if exists "anon pode inserir registros" on public.registros_alimentacao;
create policy "anon pode inserir registros"
  on public.registros_alimentacao for insert to anon with check (true);

drop policy if exists "anon pode atualizar registros" on public.registros_alimentacao;
create policy "anon pode atualizar registros"
  on public.registros_alimentacao for update to anon using (true) with check (true);
