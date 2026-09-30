-- Tabela de exercícios: fonte da verdade do plano de treino.
-- Rode no SQL Editor do Supabase (pode rodar de novo sem problema).
--
-- Mesma representação do app (src/utils/dates.js e src/utils/weeks.js):
--   dia_semana: códigos separados por vírgula, na ordem Seg → Dom. Ex.: 'Ter,Qui'
--               Códigos: Dom, Seg, Ter, Qua, Qui, Sex, Sab (sem acento)
--   semanas:    letras do ciclo de semanas. Ex.: 'A,B,C,D,E,F' (todas)

create extension if not exists pgcrypto;

create table if not exists public.exercicios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(trim(nome)) > 0),
  quantidade    text not null check (length(trim(quantidade)) > 0),
  descricao     text,
  dia_semana    text not null
                check (dia_semana ~ '^(Dom|Seg|Ter|Qua|Qui|Sex|Sab)(,(Dom|Seg|Ter|Qua|Qui|Sex|Sab))*$'),
  semanas       text not null default 'A,B,C,D,E,F'
                check (semanas ~ '^[A-F](,[A-F])*$'),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  deletado      boolean not null default false
);

create index if not exists exercicios_atualizado_em_idx on public.exercicios (atualizado_em);

-- Mantém atualizado_em em dia a cada UPDATE
create or replace function public.exercicios_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists exercicios_set_atualizado_em on public.exercicios;
create trigger exercicios_set_atualizado_em
  before update on public.exercicios
  for each row execute function public.exercicios_set_atualizado_em();

-- Segurança:
-- - O servidor MCP usa a service_role key, que ignora o RLS (lê e escreve tudo).
-- - O app usa a anon key: pode ler tudo e inserir exercícios novos
--   (botão "Enviar para o Supabase"). Não pode editar nem apagar.
alter table public.exercicios enable row level security;

drop policy if exists "anon pode ler exercicios" on public.exercicios;
create policy "anon pode ler exercicios"
  on public.exercicios for select
  to anon
  using (true);

drop policy if exists "anon pode inserir exercicios" on public.exercicios;
create policy "anon pode inserir exercicios"
  on public.exercicios for insert
  to anon
  with check (deletado = false);
