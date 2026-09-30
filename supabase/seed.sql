-- Exercícios iniciais: terça e quinta, em todas as semanas do ciclo.
-- Rode depois do schema.sql. Não duplica se rodar de novo (confere pelo nome).

insert into public.exercicios (nome, quantidade, descricao, dia_semana)
select v.nome, v.quantidade, v.descricao, 'Ter,Qui'
from (values
  ('Isometric hold (afundo)', '30s',
   'Posição de afundo, joelho de trás perto do chão, segurar.'),
  ('Leg raises em pé', '10x cada perna',
   'Do afundo, subir apoiado na perna da frente e voltar.'),
  ('Glute bridge', '30s',
   'Deitado, calcanhares no chão, quadril alto, segurar.'),
  ('Heel walks', '6x',
   'Na ponte, afastar os calcanhares em passinhos e voltar.'),
  ('Leg raises na ponte', '6x cada perna',
   'Na ponte, estender uma perna para cima e descer, quadril alto.')
) as v(nome, quantidade, descricao)
where not exists (
  select 1 from public.exercicios e
  where e.nome = v.nome and e.deletado = false
);
