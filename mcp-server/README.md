# Servidor MCP — App de Exercícios

Servidor MCP remoto que deixa o Claude (claude.ai, inclusive pelo celular) cadastrar, listar,
editar e remover exercícios do app. Os dados ficam no Supabase, e o app sincroniza sozinho
ao abrir, ao voltar para a tela e no "puxar para atualizar".

```
Claude (claude.ai) ──HTTPS──▶ este servidor (Render) ──service_role──▶ Supabase ◀──anon── App
```

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `cadastrar_exercicios(dias[], exercicios[{nome, quantidade, descricao?}], semanas?[])` | Cria um registro por exercício, valendo para todos os `dias` informados |
| `listar_exercicios(dia?)` | Lista os exercícios ativos, com o `id` de cada um |
| `editar_exercicio(id, campos)` | Altera nome, quantidade, descrição, dias ou semanas |
| `remover_exercicio(id)` | Soft delete (`deletado = true`). O app apaga o exercício localmente na próxima sincronização |

Dias usam os códigos do app: `Seg, Ter, Qua, Qui, Sex, Sab, Dom` ("terça" e "Quinta-feira"
também são aceitos). `semanas` são as letras do ciclo (A–F). Quando não é informado, o
exercício vale para todas as semanas.

---

## 1. Criar o projeto no Supabase

1. Crie uma conta em <https://supabase.com> e clique em **New project** (o plano Free basta).
   Escolha a região mais próxima (ex.: *South America (São Paulo)*).
2. Quando o projeto terminar de criar, abra **SQL Editor → New query**, cole o conteúdo de
   [`../supabase/schema.sql`](../supabase/schema.sql) e clique em **Run**.
3. Numa nova query, cole [`../supabase/seed.sql`](../supabase/seed.sql) e clique em **Run**.
   Em **Table Editor → exercicios** devem aparecer os 5 exercícios de terça e quinta.
4. Em **Project Settings → API Keys**, anote:
   - **Project URL** (ex.: `https://abcd1234.supabase.co`, também em *Project Settings → Data API*);
   - a chave **anon / publishable**, que vai no app;
   - a chave **service_role / secret**, que vai **só** neste servidor. Ela ignora o RLS: não coloque no app nem no git.

## 2. Rodar localmente (opcional)

```bash
cd mcp-server
cp .env.example .env      # preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e MCP_SECRET
npm install
npm run build
npm start                 # http://localhost:3000/mcp/<MCP_SECRET>
```

Para gerar um `MCP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Para testar com o MCP Inspector (em outro terminal):

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp/<MCP_SECRET> --transport http --method tools/list
```

Sem `--cli`, o Inspector abre uma interface web. Nela, escolha o transporte *Streamable HTTP*
e cole a URL.

## 3. Publicar no Render (plano grátis)

1. Suba o repositório no GitHub (este diretório `mcp-server/` precisa estar nele).
2. Em <https://render.com>, faça login com o GitHub e clique em **New → Web Service**.
3. Escolha o repositório e configure:
   - **Root Directory:** `mcp-server`
   - **Runtime / Language:** `Docker` (usa o `Dockerfile` daqui). Se preferir Node:
     - Build Command: `npm ci && npm run build`
     - Start Command: `npm start`
   - **Instance Type:** `Free`
4. Em **Environment Variables**, adicione:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MCP_SECRET`

   Não defina `PORT`: o Render define sozinho.
5. Clique em **Deploy Web Service**. Quando terminar, abra
   `https://SEU-SERVICO.onrender.com/health`. Deve aparecer `{"ok":true}`.

> No plano grátis, o serviço "dorme" depois de ~15 min sem uso. A primeira chamada depois
> disso pode levar perto de 1 minuto. Se o Claude reclamar de timeout, é só pedir de novo.

## 4. Adicionar como conector no Claude

1. Em <https://claude.ai>, vá em **Settings → Connectors → Add custom connector**.
2. **Name:** `Exercícios`.
   **URL:** `https://SEU-SERVICO.onrender.com/mcp/SEU_MCP_SECRET`
3. Salve. O conector também fica disponível no app do Claude no celular, com a mesma conta.
4. Numa conversa, confira se o conector está ativado (menu de ferramentas) e peça, por exemplo:
   - "Cadastra prancha 3x40s na segunda e na quarta"
   - "Quais exercícios eu tenho na quinta?"
   - "Troca a quantidade do glute bridge para 45s"

> A URL contém o segredo: quem tiver a URL consegue mexer no seu plano. Se ela vazar, troque
> o `MCP_SECRET` no Render e atualize a URL do conector.

## 5. Configurar o app

1. Na raiz do projeto do app, copie `.env.example` para `.env` e preencha
   `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Use a chave **anon/publishable**,
   nunca a service_role.
2. Gere o app de novo (ex.: `npx expo run:android --variant release`, ou o comando que você usa
   para gerar o APK). As variáveis `EXPO_PUBLIC_` são embutidas no build, então um APK antigo não as enxerga.
3. O app sincroniza ao abrir, ao voltar para a tela e no "puxar para atualizar" da tela inicial
   e de "Todos os Exercícios". Sem internet, ele usa o que já está salvo.
4. Exercícios que vieram do Supabase aparecem com "☁ Claude" em "Todos os Exercícios". No app dá
   para mudar só o tipo de atividade e a duração deles. Exercícios criados no app têm o botão
   **Enviar para o Supabase** na tela de edição.

## Segurança, em resumo

- `/mcp/:secret`: o segredo é comparado com `MCP_SECRET` em tempo constante. Com segredo errado, a resposta é 404.
- O servidor usa a service_role key. O app usa a anon key, que só pode **ler** e **inserir**
  (políticas de RLS em `schema.sql`). Editar e remover só pelo servidor.
