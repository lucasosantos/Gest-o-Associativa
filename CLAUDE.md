# Gestão Associativa

App desktop (Tauri, Windows e Linux) para administrar associações
comunitárias: sócios, mensalidades/cobranças, financeiro, documentos e
protocolo, patrimônio e histórico de atividades. Offline, um arquivo SQLite
por associação, várias associações por instalação (cada uma com senha
opcional). Domínio e decisões: [docs/dominio-associacoes.md](docs/dominio-associacoes.md)
(especificação original) e [docs/plano-implementacao.md](docs/plano-implementacao.md)
(histórico de cada etapa/mudança — registre lá toda mudança relevante).

## Stack

- Tauri v2 + Vue 3 (Composition API, `<script setup>`) + TypeScript + Vite
- Backend nativo em Rust: [src-tauri/src/](src-tauri/src/)
- Banco: SQLite via `tauri-plugin-sql` (migrations em [lib.rs](src-tauri/src/lib.rs), hoje até `version: 24`)
- Gerenciador de dependências: npm

## Comandos

| Comando | Ação |
|---|---|
| `npm run dev` | inicia o Vite (só frontend — sem Tauri, `invoke()` e banco não funcionam) |
| `npm run tauri dev` | roda o app completo (Tauri + Vite) |
| `npm run build` | `vue-tsc -b && vite build` |
| `npm run type-check` | typecheck isolado (`vue-tsc -b`; use `--force` pra rebuild limpo) |
| `npm run tauri build` | gera o binário/instalador |
| `cd src-tauri && cargo check` | checa o Rust |

Não há scripts de `lint` nem de `test` — **o projeto não tem testes
automatizados nem ESLint/Prettier configurados**. Não assuma nem invente
esses comandos. Validação usual: type-check, `cargo check`, SQL de migration
reproduzido num SQLite in-memory com `PRAGMA foreign_keys = ON`, e, para
impressão, PDF gerado com Chrome headless.

Versão do app: mesmo número em `package.json`, `src-tauri/tauri.conf.json` e
`src-tauri/Cargo.toml` (+ lockfiles). Uma tag `v*` dispara
[release.yml](.github/workflows/release.yml), que gera os instaladores.

## Estrutura

- [src/views/](src/views/) — uma tela por módulo: `Inicio` (seleção de associação, dashboard, backup),
  `Socios`/`SocioDetalhes`/`SocioForm`, `Planos`, `Cobrancas`, `Financeiro`, `Documentos`/`DocumentoDetalhes`,
  `Patrimonio`/`PatrimonioDetalhes`, `Atividades`, `Configuracoes`; telas de impressão em `Imprimir*.vue`
- [src/modals/](src/modals/) — formulários abertos via `useModal` (`openModal({ title, component, props })`)
- [src/models/](src/models/) — acesso a dados, uma classe estática por tabela/agregado (`MemberModel`, `AssetModel`, `ActivityLogModel`...)
- [src/composables/](src/composables/) — estado global leve, sem Vuex/Pinia: `useModal`, `useSidebar`,
  `useCurrentAssociation` (associação ativa), `useAssociationScopedData` (recarrega a tela ao trocar de associação),
  `usePaginaImpressao` (papel/`@page` das impressões)
- [src/services/](src/services/) — `database.ts` (conexão SQLite da associação ativa), `config.ts` (config via `invoke`),
  `backup.ts`, `memberCsv.ts` (importação/exportação CSV), arquivos/fotos/documentos
- [src/utils/](src/utils/) — `format.ts` (moeda, datas), `situacaoSocio.ts`, parcelas
- [src/router/index.ts](src/router/index.ts) — rotas (hash history)
- [src-tauri/src/](src-tauri/src/) — `lib.rs` (migrations + registro de comandos), `config.rs` (`config.json`),
  `backup.rs`, `documents.rs`, `photos.rs`, `files.rs`, `password.rs` (hash PBKDF2 da senha)

## Arquitetura — fluxo de dados

- **Dados de domínio:** View → Model (`src/models/*.ts`) → `getDatabase()`
  ([database.ts](src/services/database.ts)) → `tauri-plugin-sql` → SQLite.
  Sem camada de API/REST. Toda consulta filtra pela associação ativa
  (`getCurrentAssociationId()`).
- **Um `.db` por associação:** o `config.json` guarda a lista de associações
  (nome, hash de senha, caminho do banco). As migrations são registradas por
  URL de banco no início do processo — associação criada ou banco movido só
  fica utilizável depois de reiniciar o app (`restart_app`).
- **Configuração do app:** [Configuracoes.vue](src/views/Configuracoes.vue) →
  [config.ts](src/services/config.ts) → `invoke()` → [config.rs](src-tauri/src/config.rs)
  → `config.json` ao lado do executável. Guarda também o papel de impressão
  (`AppConfig.print`) — preferência da máquina, não da associação.
- **Histórico de atividades:** toda escrita passa por `comAtividade(...)`
  ([ActivityLog.ts](src/models/ActivityLog.ts)); só a chamada mais externa
  registra (uma ação = uma linha). `activity_logs` é imutável (triggers).
- **Impressão:** telas `Imprimir*.vue` abrem já chamando `imprimir()` de
  `usePaginaImpressao("PADRAO" | "RECIBO")`, que injeta o `@page` do papel
  configurado (A4/Carta/Ofício; recibo também A5 e bobina térmica 58/80 mm,
  com altura medida na hora). CSS de impressão comum fica no `@media print`
  de [App.vue](src/App.vue).

## Convenções gerais

- Comentários de código e textos de UI em **português**.
- TypeScript em modo `strict` (`noUnusedLocals`, `noUnusedParameters` ativos) — evite `any`.
- Dinheiro em centavos (`INTEGER`), datas `TEXT` ISO (`AAAA-MM-DD`), `created_at` em UTC
  (converter pra hora local na tela — ver `formatarDataHora`).
- Registro não se apaga quando tem história: sócio é desligado, lançamento é estornado,
  bem recebe baixa.
- Regras específicas por área ficam em `.claude/rules/`:
  [frontend.md](.claude/rules/frontend.md) ·
  [backend.md](.claude/rules/backend.md) ·
  [database.md](.claude/rules/database.md)
