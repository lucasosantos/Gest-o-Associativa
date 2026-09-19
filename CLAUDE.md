# App Base

Base neutra de um app desktop (Tauri) — casca de interface (menu superior,
sidebar de ferramentas, modal, tela de Início e tela de Configurações) pronta
para receber os módulos de um domínio de negócio ainda não definido.

## Stack

- Tauri v2 + Vue 3 (Composition API, `<script setup>`) + TypeScript + Vite
- Backend nativo em Rust: [src-tauri/src/](src-tauri/src/)
- Banco: SQLite via `tauri-plugin-sql` (hoje sem nenhuma tabela de domínio)
- Gerenciador de dependências: npm

## Comandos

| Comando | Ação |
|---|---|
| `npm run dev` | inicia o Vite (só frontend, sem shell nativo) |
| `npm run tauri dev` | roda o app completo (Tauri + Vite) |
| `npm run build` | `vue-tsc -b && vite build` |
| `npm run type-check` | typecheck isolado (`vue-tsc -b`) |
| `npm run tauri build` | gera o binário/instalador |

Não há scripts de `lint` nem de `test` — **o projeto ainda não tem testes
automatizados nem ESLint/Prettier configurados**. Não assuma nem invente
esses comandos.

## Estrutura

- [src/views/](src/views/) — uma tela por módulo; hoje só `Inicio.vue` e `Configuracoes.vue`
- [src/modals/](src/modals/) — formulários/seletores abertos via `useModal` (vazio, crie conforme o módulo precisar)
- [src/models/](src/models/) — acesso a dados (uma classe estática por tabela; vazio até o primeiro módulo de domínio)
- [src/composables/](src/composables/) — estado global leve (`useModal`, `useSidebar`), sem Vuex/Pinia
- [src/router/index.ts](src/router/index.ts) — rotas (hash history)
- [src/services/](src/services/) — `database.ts` (conexão SQLite) e `config.ts` (config do app via Tauri invoke)
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — comandos Tauri + migrations SQL
- [src-tauri/src/config.rs](src-tauri/src/config.rs) — `config.json` persistido ao lado do executável

## Arquitetura — fluxo de dados

- **Dados de domínio:** View → Model (`src/models/*.ts`) → `getDatabase()`
  ([src/services/database.ts](src/services/database.ts)) → `tauri-plugin-sql` → SQLite.
  Não há camada de API/REST — o frontend fala direto com o banco. Nenhum model
  existe ainda: o primeiro módulo de negócio deve criar seu próprio em
  `src/models/`.
- **Configuração do app:** tela [Configuracoes.vue](src/views/Configuracoes.vue) →
  [src/services/config.ts](src/services/config.ts) → `invoke()` → comandos Rust em
  [src-tauri/src/config.rs](src-tauri/src/config.rs) → `config.json` ao lado do executável.
  Mudar o local do banco exige reiniciar o app (`restart_app`).

## Convenções gerais

- Comentários de código e textos de UI em **português**.
- TypeScript em modo `strict` (`noUnusedLocals`, `noUnusedParameters` ativos) — evite `any`.
- Sem testes automatizados e sem lint configurados hoje; não presuma sua existência.
- Regras específicas por área ficam em `.claude/rules/`:
  [frontend.md](.claude/rules/frontend.md) ·
  [backend.md](.claude/rules/backend.md) ·
  [database.md](.claude/rules/database.md)
