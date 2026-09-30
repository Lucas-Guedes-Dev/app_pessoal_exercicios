-- Atribui a você os dados que já existiam antes das contas (treinos, ciclo, alimentos próprios,
-- medidas personalizadas e diário) e trava a estrutura multiusuário.
--
-- 1. Rode supabase/multiusuario.sql antes.
-- 2. Crie a sua conta no app (Entrar → Criar conta).
-- 3. Troque o e-mail abaixo pelo da sua conta e rode este arquivo no SQL Editor.
-- Pode rodar de novo: só mexe no que ainda está sem dono.

do $$
declare
  meu_email text := 'SEU-EMAIL@exemplo.com';   -- <<< troque aqui
  uid uuid;
  n int;
begin
  select id into uid from auth.users where lower(email) = lower(trim(meu_email));
  if uid is null then
    raise exception 'Nenhuma conta com o e-mail "%". Crie a conta no app primeiro (ou confira o e-mail).', meu_email;
  end if;

  update public.exercicios set user_id = uid where user_id is null;
  get diagnostics n = row_count; raise notice 'exercicios: % atribuído(s)', n;

  -- se o app já criou um ciclo para você depois do login, ele vale e o antigo sai
  if exists (select 1 from public.ciclo where user_id = uid) then
    delete from public.ciclo where user_id is null;
  else
    update public.ciclo set user_id = uid where user_id is null;
  end if;

  update public.alimentos set user_id = uid where user_id is null and fonte = 'custom';
  get diagnostics n = row_count; raise notice 'alimentos próprios: % atribuído(s)', n;

  update public.alimento_porcoes set user_id = uid where user_id is null and personalizada;
  get diagnostics n = row_count; raise notice 'medidas personalizadas: % atribuída(s)', n;

  update public.registros_alimentacao set user_id = uid where user_id is null;
  get diagnostics n = row_count; raise notice 'registros do diário: % atribuído(s)', n;
end $$;

-- ---------- estrutura final ----------

alter table public.exercicios alter column user_id set not null;
alter table public.registros_alimentacao alter column user_id set not null;

-- ciclo: PK passa a ser o usuário
alter table public.ciclo drop column if exists id;
alter table public.ciclo alter column user_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ciclo_pkey' and conrelid = 'public.ciclo'::regclass) then
    alter table public.ciclo add constraint ciclo_pkey primary key (user_id);
  end if;
end $$;

-- alimento próprio ⇔ tem dono; medida personalizada ⇔ tem dono (a base fica sem dono)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alimentos_dono_check') then
    alter table public.alimentos
      add constraint alimentos_dono_check check ((fonte = 'custom') = (user_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alimento_porcoes_dono_check') then
    alter table public.alimento_porcoes
      add constraint alimento_porcoes_dono_check check (personalizada = (user_id is not null));
  end if;
end $$;
