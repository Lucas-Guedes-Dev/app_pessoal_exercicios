-- Multiusuário: cada pessoa vê e altera só os próprios dados (treinos, ciclo e alimentação).
-- Rode no SQL Editor do Supabase DEPOIS de schema.sql, ciclo.sql, alimentacao.sql e
-- alimentos_seed.sql. Pode rodar de novo sem problema.
--
-- Depois de criar a sua conta no app, rode supabase/atribuir_dados.sql para que os dados que
-- já existem passem a ser seus.
--
-- - user_id em todas as tabelas de dados pessoais, preenchido sozinho com o usuário logado
--   (default auth.uid()). A base TACO (e as medidas dela) fica com user_id nulo: é de todos.
-- - Acesso só para usuários logados (role authenticated), sempre com user_id = auth.uid().
--   O acesso anônimo (chave anon/publishable sem login) é removido.
-- - Tabelas do OAuth do servidor MCP (clientes, códigos e tokens): só a service_role acessa.

-- ---------- user_id ----------

do $$
declare
  t text;
begin
  foreach t in array array['exercicios', 'ciclo', 'alimentos', 'alimento_porcoes', 'registros_alimentacao'] loop
    execute format(
      'alter table public.%I add column if not exists user_id uuid references auth.users (id) on delete cascade', t);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- Alimentos criados no app ganham o id do servidor (sequence) no envio; a chave gerada no
-- celular garante que reenviar o mesmo alimento não crie outro.
alter table public.alimentos add column if not exists chave_cliente uuid;
create unique index if not exists alimentos_chave_cliente_key on public.alimentos (chave_cliente);

-- ciclo: uma linha por usuário. A PK antiga (id = 1) sai já; a PK em user_id entra em
-- atribuir_dados.sql, quando a linha que já existe ganhar dono.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ciclo' and column_name = 'id') then
    alter table public.ciclo drop constraint if exists ciclo_pkey;
    alter table public.ciclo drop constraint if exists ciclo_id_check;
    alter table public.ciclo alter column id drop not null;
    alter table public.ciclo alter column id drop default;
  end if;
end $$;
create unique index if not exists ciclo_user_id_key on public.ciclo (user_id);

-- ---------- permissões ----------

-- remove todas as policies antigas de anon nessas tabelas
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('exercicios', 'ciclo', 'alimentos', 'alimento_porcoes', 'registros_alimentacao')
       and 'anon' = any (roles)
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

revoke all on public.exercicios, public.ciclo, public.alimentos, public.alimento_porcoes,
              public.registros_alimentacao from anon;
revoke all on sequence public.alimentos_custom_id_seq from anon;
grant select, insert, update on public.exercicios, public.ciclo, public.alimentos,
                                public.alimento_porcoes, public.registros_alimentacao to authenticated;
grant usage on sequence public.alimentos_custom_id_seq to authenticated;

alter table public.exercicios enable row level security;
alter table public.ciclo enable row level security;
alter table public.alimentos enable row level security;
alter table public.alimento_porcoes enable row level security;
alter table public.registros_alimentacao enable row level security;

-- exercícios: o app lê e envia exercícios criados nele (editar/remover é pelo Claude)
drop policy if exists "usuario le os proprios exercicios" on public.exercicios;
create policy "usuario le os proprios exercicios"
  on public.exercicios for select to authenticated using (user_id = auth.uid());
drop policy if exists "usuario cria os proprios exercicios" on public.exercicios;
create policy "usuario cria os proprios exercicios"
  on public.exercicios for insert to authenticated with check (user_id = auth.uid() and deletado = false);

-- ciclo
drop policy if exists "usuario le o proprio ciclo" on public.ciclo;
create policy "usuario le o proprio ciclo"
  on public.ciclo for select to authenticated using (user_id = auth.uid());
drop policy if exists "usuario cria o proprio ciclo" on public.ciclo;
create policy "usuario cria o proprio ciclo"
  on public.ciclo for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "usuario altera o proprio ciclo" on public.ciclo;
create policy "usuario altera o proprio ciclo"
  on public.ciclo for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- alimentos: a base (TACO/complementos, sem dono) é de todos; os próprios, só do dono
drop policy if exists "usuario le a base e os proprios alimentos" on public.alimentos;
create policy "usuario le a base e os proprios alimentos"
  on public.alimentos for select to authenticated
  using ((user_id is null and fonte <> 'custom') or user_id = auth.uid());
drop policy if exists "usuario cria os proprios alimentos" on public.alimentos;
create policy "usuario cria os proprios alimentos"
  on public.alimentos for insert to authenticated with check (fonte = 'custom' and user_id = auth.uid());
drop policy if exists "usuario altera os proprios alimentos" on public.alimentos;
create policy "usuario altera os proprios alimentos"
  on public.alimentos for update to authenticated
  using (fonte = 'custom' and user_id = auth.uid()) with check (fonte = 'custom' and user_id = auth.uid());

-- medidas: as da base são de todos; as personalizadas, só do dono
drop policy if exists "usuario le as medidas da base e as proprias" on public.alimento_porcoes;
create policy "usuario le as medidas da base e as proprias"
  on public.alimento_porcoes for select to authenticated
  using ((user_id is null and not personalizada) or user_id = auth.uid());
drop policy if exists "usuario cria as proprias medidas" on public.alimento_porcoes;
create policy "usuario cria as proprias medidas"
  on public.alimento_porcoes for insert to authenticated with check (personalizada and user_id = auth.uid());
drop policy if exists "usuario altera as proprias medidas" on public.alimento_porcoes;
create policy "usuario altera as proprias medidas"
  on public.alimento_porcoes for update to authenticated
  using (personalizada and user_id = auth.uid()) with check (personalizada and user_id = auth.uid());

-- diário
drop policy if exists "usuario le o proprio diario" on public.registros_alimentacao;
create policy "usuario le o proprio diario"
  on public.registros_alimentacao for select to authenticated using (user_id = auth.uid());
drop policy if exists "usuario cria no proprio diario" on public.registros_alimentacao;
create policy "usuario cria no proprio diario"
  on public.registros_alimentacao for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "usuario altera o proprio diario" on public.registros_alimentacao;
create policy "usuario altera o proprio diario"
  on public.registros_alimentacao for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- OAuth do servidor MCP (só service_role) ----------
-- Tokens e códigos são guardados apenas como hash (sha256), nunca em texto.

create table if not exists public.oauth_clientes (
  client_id  text primary key,
  dados      jsonb not null,            -- registro completo do cliente (RFC 7591)
  criado_em  timestamptz not null default now()
);

create table if not exists public.oauth_codigos (
  codigo_hash    text primary key,
  client_id      text not null references public.oauth_clientes (client_id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  code_challenge text not null,
  redirect_uri   text not null,
  escopos        text[] not null default '{}',
  recurso        text,
  expira_em      timestamptz not null,
  usado_em       timestamptz,
  criado_em      timestamptz not null default now()
);

create table if not exists public.oauth_tokens (
  token_hash  text primary key,
  tipo        text not null check (tipo in ('access', 'refresh')),
  client_id   text not null references public.oauth_clientes (client_id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  escopos     text[] not null default '{}',
  recurso     text,
  expira_em   timestamptz not null,
  revogado_em timestamptz,
  criado_em   timestamptz not null default now()
);
create index if not exists oauth_tokens_expira_em_idx on public.oauth_tokens (expira_em);
create index if not exists oauth_codigos_expira_em_idx on public.oauth_codigos (expira_em);

alter table public.oauth_clientes enable row level security;
alter table public.oauth_codigos enable row level security;
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_clientes, public.oauth_codigos, public.oauth_tokens from anon, authenticated;
