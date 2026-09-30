# Servidor MCP — App de Exercícios

Servidor MCP remoto que deixa o Claude (claude.ai, inclusive pelo celular) cuidar do app:
exercícios, ciclo de semanas e alimentação (base TACO, alimentos próprios e diário).

É **multiusuário**: cada pessoa tem a própria conta no app (e-mail e senha) e conecta o Claude
dela na **mesma URL**. No primeiro uso, o Claude abre uma tela de login deste servidor; depois
disso ele só vê e altera os dados daquela pessoa.

```
Claude da pessoa ──OAuth (login do app)──▶ este servidor (Render) ──service_role + filtro user_id──▶ Supabase
App da pessoa ────────────JWT da pessoa (RLS por user_id)─────────────────────────────────────────▶ Supabase
```

- **Conector:** `https://SEU-SERVICO.onrender.com/mcp` — a mesma URL para todo mundo, sem segredo nela.
- **OAuth 2.1** no próprio servidor: metadata em `/.well-known/oauth-protected-resource` e
  `/.well-known/oauth-authorization-server`, registro dinâmico de cliente (`/register`),
  authorization code com PKCE (`/authorize` → tela de login → `/token`), refresh token rotativo
  e `/revoke`. Sem token, `/mcp` responde `401` com `WWW-Authenticate` apontando para a metadata.
- **Tokens** são do próprio servidor (opacos, guardados só como hash no Supabase), valem 1 hora e
  são renovados sozinhos pelo Claude por até 90 dias sem uso. Não é o token do Supabase: ele só
  vale neste servidor e pode ser revogado.
- **Isolamento:** as ferramentas só acessam dados pelo helper `src/escopo.ts`, que prende toda
  consulta ao `user_id` de quem fez login. A base TACO é compartilhada e só de leitura.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `cadastrar_exercicios(dias[], exercicios[{nome, quantidade, descricao?}], semanas?[])` | Cria um registro por exercício, valendo para todos os `dias` informados |
| `listar_exercicios(dia?)` | Lista os exercícios ativos, com o `id` de cada um |
| `editar_exercicio(id, campos)` | Altera nome, quantidade, descrição, dias ou semanas |
| `remover_exercicio(id)` | Soft delete (`deletado = true`). O app apaga o exercício localmente na próxima sincronização |
| `ver_ciclo()` | Quantas semanas tem o ciclo e qual é a semana de hoje |
| `configurar_ciclo(semanas?, semana_atual?)` | Muda a quantidade de semanas e/ou a semana atual |

Dias usam os códigos do app: `Seg, Ter, Qua, Qui, Sex, Sab, Dom` ("terça" e "Quinta-feira"
também são aceitos). `semanas` são as letras do ciclo (A–F). Quando não é informado, o
exercício vale para todas as semanas.

### Alimentação

| Ferramenta | O que faz |
|---|---|
| `buscar_alimentos(texto, limite?)` | Busca sem acento, por todas as palavras, na mesma ordem do app. Devolve id, nutrientes por 100 g e medidas caseiras |
| `detalhar_alimento(id)` | Um alimento com todas as medidas |
| `cadastrar_alimento(nome, gramas_base, kcal, proteina, carbo, gordura, fibra?, porcao_rotulo?, confirmar?)` | Alimento próprio. Valores "por porção" são convertidos para 100 g, e a porção do rótulo vira medida caseira. Avisa se já existe nome parecido |
| `editar_alimento(id, campos)` / `remover_alimento(id)` | Só alimentos próprios (`custom`). A TACO nunca é alterada |
| `adicionar_porcao(alimento_id, rotulo, gramas)` | Medida caseira nova (ex.: "pote" = 170 g) em qualquer alimento |
| `registrar_alimentacao(data?, refeicao, itens[{alimento_id, gramas? \| porcao + quantidade?}])` | Registra vários itens de uma vez. Data padrão: hoje (Brasília) |
| `listar_diario(data? \| de, ate)` | Registros por refeição, com totais por refeição e por dia |
| `editar_registro(id, campos)` / `remover_registro(id)` | Muda data, refeição ou quantidade (recalcula nutrientes) / soft delete |
| `copiar_refeicao(de_data, para_data?, refeicao)` | Repete uma refeição de outro dia |
| `resumo_alimentacao(de, ate)` | Média diária, calorias por refeição e alimentos mais usados |

Refeições: `cafe`, `almoco`, `lanche`, `jantar`, `ceia`. IDs de alimentos: TACO/complementos
< 100000 (iguais no app e no Supabase); alimentos próprios recebem o id do servidor (≥ 1000000,
exceto os que já existiam antes das contas).

---

## 1. Supabase

1. Crie o projeto em <https://supabase.com> (**New project**, plano Free, região *South America (São Paulo)*).
2. No **SQL Editor → New query**, rode estes arquivos, **um de cada vez e nesta ordem**
   (todos podem ser rodados de novo sem duplicar nada):
   1. [`../supabase/schema.sql`](../supabase/schema.sql) — exercícios;
   2. [`../supabase/seed.sql`](../supabase/seed.sql) — exercícios iniciais (só na primeira instalação, já estão nos dados do Lucas);
   3. [`../supabase/ciclo.sql`](../supabase/ciclo.sql) — ciclo de semanas;
   4. [`../supabase/alimentacao.sql`](../supabase/alimentacao.sql) — tabelas de alimentação;
   5. [`../supabase/alimentos_seed.sql`](../supabase/alimentos_seed.sql) — base TACO (~115 KB; cole tudo de uma vez).
      Gerado por `node tools/taco/build-supabase-seed.mjs` a partir de `src/data/foods.json`;
   6. [`../supabase/multiusuario.sql`](../supabase/multiusuario.sql) — contas: `user_id`, RLS por usuário
      (o acesso anônimo deixa de existir) e as tabelas do OAuth.
3. Em **Authentication → Sign In / Providers → Email**, desligue **Confirm email**. Assim, quem
   cria conta no app já entra direto, sem precisar clicar em link de confirmação.
4. Depois de criar a **sua** conta no app, abra [`../supabase/atribuir_dados.sql`](../supabase/atribuir_dados.sql),
   troque o e-mail no topo pelo da sua conta e rode. Os dados que já existiam passam a ser seus.
5. Quando as contas de todo mundo existirem, desligue novos cadastros em
   **Authentication → Sign In / Providers → Allow new users to sign up**.
6. Em **Project Settings → API Keys**, anote:
   - **Project URL** (ex.: `https://abcd1234.supabase.co`);
   - a chave **publishable / anon** — vai no app (`.env`) e no servidor (`SUPABASE_ANON_KEY`);
   - a chave **secret / service_role** — vai **só** no servidor. Ela ignora o RLS: não coloque no app nem no git.

## 2. Variáveis de ambiente do servidor

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secret / service_role |
| `SUPABASE_ANON_KEY` | chave publishable / anon (a tela de login confere e-mail e senha com ela) |
| `PUBLIC_URL` | endereço público do servidor, sem barra no final. Ex.: `https://app-exercicios.onrender.com` |
| `LEGACY_SECRET_ROUTE` | `on` só enquanto você migra o conector antigo (`/mcp/<segredo>`); depois apague ou use `off` |
| `MCP_SECRET` | segredo da rota antiga (só com `LEGACY_SECRET_ROUTE=on`) |
| `LEGACY_USER_EMAIL` | e-mail da conta que a rota antiga representa (só com `LEGACY_SECRET_ROUTE=on`) |
| `OAUTH_ACCESS_TTL`, `OAUTH_REFRESH_TTL` | opcionais: validade dos tokens em segundos (padrão 3600 e 7776000) |

## 3. Rodar localmente (opcional)

```bash
cd mcp-server
cp .env.example .env      # preencha as variáveis (PUBLIC_URL=http://localhost:3000)
npm install
npm run build
npm start                 # conector: http://localhost:3000/mcp
```

Para testar com o MCP Inspector, rode `npx @modelcontextprotocol/inspector`, adicione um servidor
*Streamable HTTP* com a URL `http://localhost:3000/mcp` e conecte: o Inspector recebe o `401`,
faz o registro dinâmico e abre a tela de login do app.

## 4. Publicar no Render (plano grátis)

1. Suba o repositório no GitHub (este diretório `mcp-server/` precisa estar nele).
2. Em <https://render.com>, faça login com o GitHub e clique em **New → Web Service**.
3. Escolha o repositório e configure:
   - **Root Directory:** `mcp-server`
   - **Runtime / Language:** `Docker` (usa o `Dockerfile` daqui). Se preferir Node:
     - Build Command: `npm ci && npm run build`
     - Start Command: `npm start`
   - **Instance Type:** `Free`
4. Em **Environment Variables**, adicione as variáveis da seção 2. Não defina `PORT`: o Render define sozinho.
5. Clique em **Deploy Web Service**. Quando terminar, abra `https://SEU-SERVICO.onrender.com/health`:
   deve aparecer `{"ok":true}`.

### Não deixe o servidor dormir

No plano grátis, o Render "dorme" depois de ~15 min sem uso e leva quase 1 minuto para acordar.
O Claude espera no máximo 10 segundos pelo login e 30 pela renovação do token, então com o
servidor dormindo **a conexão falha** ("o conector parou"). Para evitar:

1. Crie uma conta grátis em <https://uptimerobot.com>.
2. **Add New Monitor → HTTP(s)**, URL `https://SEU-SERVICO.onrender.com/health`, intervalo **5 minutos**.

Isso mantém o servidor acordado. (Um plano pago do Render também resolve.)

## 5. Conectar o Claude (quem é técnico)

1. Em <https://claude.ai>, vá em **Customize → Connectors → Add custom connector**.
2. **Nome:** `Exercícios`. **URL:** `https://SEU-SERVICO.onrender.com/mcp`.
3. Se aparecer a escolha de autenticação, deixe **Sign in now** e, em *OAuth client*,
   **Register automatically**. Não preencha *Client ID*, *Client Secret* nem *Request headers*.
4. Clique em **Add** e depois em **Connect**: abre a tela de login do app. Entre com o e-mail e a
   senha da sua conta do app.
5. O conector também aparece no app do Claude no celular, na mesma conta.

**Trocando o conector antigo (`/mcp/<segredo>`) pelo novo:** adicione o novo como acima, teste
("quais exercícios eu tenho?"), remova o antigo em **Customize → Connectors** e, no Render, mude
`LEGACY_SECRET_ROUTE` para `off`.

## Como adicionar o conector (para quem não é técnico)

Você vai precisar de: o app instalado no celular com a **sua conta criada**, e o **endereço do
conector** (quem configurou o app te passa; é algo como `https://app-exercicios.onrender.com/mcp`).

1. No celular, abra o **navegador** (Chrome ou Safari) e entre em **claude.ai** com a sua conta do Claude.
2. Toque no seu nome ou no menu (☰) e vá em **Customize → Connectors**.
3. Toque em **Add custom connector**.
4. Em **Nome**, escreva `Exercícios`. Em **URL**, cole o endereço do conector.
   Não mexa em mais nada (deixe os campos avançados em branco) e toque em **Add**.
5. Toque em **Connect**. Vai abrir a tela **"⚽ App de Exercícios"**.
6. Digite o **mesmo e-mail e a mesma senha do app** e toque em **Entrar e permitir**.
7. Pronto! Volte para uma conversa, toque no **+** → **Connectors** e confira se
   **Exercícios** está ligado. Agora é só pedir, por exemplo:
   - "No almoço comi 2 conchas de feijão e 150 g de arroz"
   - "Quais exercícios eu tenho na quinta?"
   - "Cadastra prancha 3x40s na segunda e na quarta"

   Na primeira vez, o Claude pergunta se pode usar a ferramenta: toque em **Permitir sempre**.

Se aparecer erro ao conectar, espere 1 minuto e toque em **Connect** de novo (o servidor pode
estar acordando). Se pedir para entrar de novo algum dia, é só repetir os passos 5 e 6.

## 6. App

1. Na raiz do projeto, copie `.env.example` para `.env` e preencha `EXPO_PUBLIC_SUPABASE_URL` e
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` (chave **publishable/anon**, nunca a secret).
2. Gere e instale o APK (`npm run apk`). As variáveis `EXPO_PUBLIC_` entram no build.
3. Ao abrir, o app pede **Entrar** ou **Criar conta**. Cada conta tem os próprios treinos, ciclo,
   alimentação, perfil, medições e jogos, num banco separado no celular.
4. No primeiro login num celular que já tinha dados de antes das contas, o app pergunta
   **"Eles são seus?"**: "Sim" faz a conta assumir esses dados (histórico de feito/não feito
   incluso); "Não" começa do zero sem apagar nada.
5. Depois do primeiro login, o app funciona sem internet. Ele sincroniza ao abrir, ao voltar para
   a tela e no "puxar para atualizar". **Sair** fica em **Editar Perfil**.

## Segurança, em resumo

- Cada pessoa só enxerga os próprios dados: no app pelo RLS do Supabase (`user_id = auth.uid()`)
  e no servidor pelo helper `escopo.ts`. A base TACO é compartilhada e não pode ser alterada.
- O acesso anônimo (chave publishable sem login) foi removido.
- A tela de login confere e-mail e senha no Supabase Auth e limita tentativas (20 a cada 15 min por IP).
- Códigos de autorização valem 5 minutos e uma única vez; refresh tokens são rotativos (o antigo
  deixa de valer ao ser usado). Tokens e códigos ficam no Supabase só como hash.
