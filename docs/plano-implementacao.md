# Plano de implementação — módulo "Gestão de Associações Comunitárias"

> Complementa [dominio-associacoes.md](dominio-associacoes.md) (a
> especificação recebida do usuário). Este arquivo é o plano de etapas para
> implementar esse domínio no app real (SQLite via `tauri-plugin-sql`, sem
> API REST, models estáticos em `src/models/*.ts`), decidido em conjunto com
> o usuário em 2026-09-01.
>
> **Progresso: MVP completo.** Etapas 0 a 8 concluídas (2026-09-01), nesta
> ordem de implementação: 0, 1, 2, 3, 5, 4, 6, 7, 8 — as Etapas 4 e 5 foram
> implementadas fora da sequência do plano, a pedido do usuário; não havia
> dependência real entre elas (`receivables.member_id` referencia `members`
> diretamente, sem precisar de `membership_charges`). A numeração de
> `version` das migrations é sequencial pela ordem de implementação, não
> pela numeração da etapa no plano: Etapa 5 = `version: 4`, Etapa 4 =
> `version: 5`, Etapa 6 = `version: 6`, Etapa 7 = `version: 7`, Etapa 8 =
> `version: 8`. Depois do MVP, duas mudanças pós-MVP já concluídas: a
> reorganização do menu por módulo, e a correção que removeu usuários/
> perfis/auditoria, trouxe senha por associação e voltou a "1 arquivo `.db`
> por associação" via registro em `config.json` (`version: 9`, ver seção
> própria abaixo). Seguem as Fases 2 e 3 (pós-MVP), ainda sem implementação.

## Decisões estruturais confirmadas

1. ~~**1 arquivo `.db` = 1 associação.**~~ **Superada em 2026-09-01** (ver
   seção "Mudança pós-MVP — múltiplas associações por arquivo", depois da
   Etapa 8): o app passou a suportar várias associações no mesmo arquivo,
   com um seletor de "associação ativa" na tela Início. A decisão original
   dizia que "várias associações no mesmo computador" seria atendida
   trocando o caminho do banco em `Configuracoes.vue` — isso continua
   funcionando para quem preferir arquivos separados, mas agora também é
   possível ter várias no mesmo arquivo.
2. **Financeiro/Caixa vem antes de Mensalidades**, invertendo a ordem do
   documento original — evita implementar a lógica de baixa duas vezes,
   já que uma cobrança paga precisa gravar em `cash_transactions`.

Ordem final das etapas do MVP: **0 (fundações) → 1 (institucional) →
2 (sócios) → 3 (financeiro/caixa) → 4 (mensalidades) →
5 (contas a pagar/receber) → 6 (protocolos) → 7 (documentos) →
8 (usuários/permissões/auditoria)**, seguido de blocos resumidos para
Fase 2 e Fase 3.

Cada etapa, ao final, deve: (a) somar uma nova `Migration` em
`src-tauri/src/lib.rs` com `version` incrementado (nunca editar uma
existente — regra de `.claude/rules/database.md`), (b) adicionar os models
TS correspondentes em `src/models/`, (c) adicionar view(s)/rota(s)/modais
mínimos para operar aquele pedaço pela UI, (d) validar com
`npm run type-check` + `npm run tauri dev` + teste manual de CRUD.

## Convenções técnicas comuns (Etapa 0 — sem tabela de domínio) ✅ concluída

Implementado: [src/services/id.ts](../src/services/id.ts) (`newId()`) e
[src/utils/format.ts](../src/utils/format.ts) (`centavosParaReais`,
`reaisParaCentavos`, `formatarMoeda`, `formatarData`, `formatarCompetencia`,
`hojeIso`). `npm run type-check` validado sem erros. Sem tabela/migration
nesta etapa, como previsto.

- **UUID:** `crypto.randomUUID()` nativo do webview — sem nova dependência.
  `src/services/id.ts` com `export function newId(): string`.
- **Dinheiro:** `INTEGER` (centavos) em toda coluna monetária, formatado na
  UI com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
  `src/utils/format.ts` com `centavosParaReais`/`reaisParaCentavos` e
  formatação de data.
- **Datas:** `TEXT` ISO (`'YYYY-MM-DD'`), exibidas via
  `Intl.DateTimeFormat('pt-BR', ...)`. Avaliar `date-fns` só quando a Etapa
  4 (Mensalidades) precisar de aritmética de mês mais elaborada — com
  confirmação antes de tocar `package.json`.
- **`ENUM` do Postgres → `TEXT` + `CHECK(col IN (...))`.**
- **Saldo de conta financeira:** calculado sob demanda por `SUM` sobre
  `cash_transactions`, nunca persistido/incrementado.
- **Chaves polimórficas** (`source_type`/`source_id`,
  `entity_type`/`entity_id`): sem FK real; validação em TypeScript contra
  lista fechada de tipos.
- `documents.current_version_id` pode referenciar `document_versions`
  criada depois **na mesma migration** sem problema, porque a tabela já
  existe antes de qualquer INSERT/UPDATE rodar.
- **⚠️ Correção (descoberta na Etapa 2):** `REFERENCES` para uma tabela de
  uma etapa **futura** (ainda não escrita) NÃO é seguro, mesmo com o valor
  sempre `NULL`. O `sqlx-sqlite` usado pelo `tauri-plugin-sql` liga `PRAGMA
  foreign_keys = ON` por padrão, e o SQLite valida a existência da tabela
  referenciada a cada INSERT/UPDATE, não só quando o valor não é nulo. Isso
  quebrou `members.membership_plan_id REFERENCES membership_plans(id)`
  (`membership_plans` só existe na Etapa 4) e travaria toda a tabela
  `members` até lá; a correção foi declarar a coluna como `TEXT` solto, sem
  `REFERENCES`, com a mesma disciplina de validação em código já usada para
  `source_type`/`source_id`. Regra daqui pra frente: só declare `REFERENCES`
  para uma tabela que já existe (migration anterior, ou mais cedo na mesma
  migration) — nunca para uma tabela de uma etapa posterior do plano.

## Etapa 1 — Institucional ✅ concluída

Implementado: migration `version: 1` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`associations` + `addresses`,
com trigger de `updated_at`), models
[src/models/Association.ts](../src/models/Association.ts) e
[src/models/Address.ts](../src/models/Address.ts), e a tela
[src/views/Instituicional.vue](../src/views/Instituicional.vue) em
`/instituicional` (aba "Instituição"). Validado: `npm run type-check`,
`cargo check` e o SQL da migration reproduzido num banco SQLite in-memory
(inserts, trigger de `updated_at` e ambos os `CHECK` testados manualmente).

**Migration `version: 1`:** `associations` (`status TEXT CHECK(status IN
('ATIVA','INATIVA','ENCERRADA'))`, `settings TEXT` JSON serializado
manualmente), `addresses` (`association_id` OU `person_id`, `CHECK` exige
ao menos um). Sem tabela de contato institucional — `email`/`phone`/
`website` já são colunas de `associations`.

**Models:** `Association.ts` (`getCurrent()`, `create()`, `update()`),
`Address.ts` (CRUD por dono).

**Tela:** `/instituicional` (`meta.label: "Instituição"`) — tela de
"editar meus dados" (só 1 associação por arquivo), sem lista.

## Etapa 2 — Sócios ✅ concluída

Implementado: migration `version: 2` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`people`, `person_contacts`,
`members`, `member_dependents`, `member_representatives`,
`member_status_history`); models
[Person.ts](../src/models/Person.ts) (com `findByCpf`),
[PersonContact.ts](../src/models/PersonContact.ts),
[Member.ts](../src/models/Member.ts) (com `search`, `changeStatus`,
`statusHistory`), [MemberDependent.ts](../src/models/MemberDependent.ts) e
[MemberRepresentative.ts](../src/models/MemberRepresentative.ts); telas
[Socios.vue](../src/views/Socios.vue) (lista + busca) e
[SocioDetalhes.vue](../src/views/SocioDetalhes.vue) (ficha com abas: dados,
contatos, dependentes, representantes, histórico); modais
`MemberForm.vue`, `MemberStatusChangeForm.vue`, `MemberDependentForm.vue`,
`MemberRepresentativeForm.vue` e `PersonContactForm.vue` (este último não
estava no plano original — necessário para a aba de contatos da ficha).
`member_documents` adiada para depois da Etapa 7, como planejado.

Validado: `npm run type-check` (incl. rebuild limpo com `--force`),
`cargo check`, e as migrations 1+2 reproduzidas juntas num SQLite
in-memory com `PRAGMA foreign_keys = ON` (todos os `UNIQUE`/`CHECK`
testados, além da query de busca com `JOIN`+`EXISTS`).

**Migration `version: 2`:** `people`, `person_contacts`, `members`
(`status TEXT CHECK(...'PENDENTE','ATIVO','INATIVO','SUSPENSO','DESLIGADO',
'FALECIDO')`, `UNIQUE(association_id, registration_number)`,
`UNIQUE(association_id, person_id)`), `member_dependents`,
`member_representatives`, `member_status_history`. `member_documents`
adiada para depois da Etapa 7.

**Models:** `Person.ts`, `PersonContact.ts`, `Member.ts` (com
`changeStatus()` gravando em `member_status_history`),
`MemberDependent.ts`, `MemberRepresentative.ts`.

**Telas:** `/socios` (lista + busca por nome/CPF/matrícula/telefone/
e-mail) + `/socios/:id` (`meta.hidden: true`, ficha com abas: contatos,
dependentes, representantes, histórico). Modais `MemberForm.vue`,
`MemberDependentForm.vue`, `MemberStatusChangeForm.vue`.

## Etapa 3 — Financeiro / Fluxo de caixa ✅ concluída

Implementado: migration `version: 3` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`financial_accounts`,
`financial_categories`, `cost_centers`, `payment_methods`, `payees`,
`payers`, `cash_transactions`, `cash_transaction_reversals`); models
[FinancialAccount.ts](../src/models/FinancialAccount.ts) (saldo calculado
sob demanda via `opening_balance` + soma assinada dos lançamentos, com
`ESTORNO` resolvido por `JOIN` em `cash_transaction_reversals`),
[FinancialCategory.ts](../src/models/FinancialCategory.ts),
[CostCenter.ts](../src/models/CostCenter.ts),
[PaymentMethod.ts](../src/models/PaymentMethod.ts) e
[CashTransaction.ts](../src/models/CashTransaction.ts) (`create`,
`transfer`, `reverse`); tela [Financeiro.vue](../src/views/Financeiro.vue)
em `/financeiro` com sub-navegação por abas (Contas, Lançamentos,
Categorias, Centros de custo, Formas de pagamento — esta última não estava
no plano original, adicionada porque `CashTransactionForm` precisa de
opções de forma de pagamento para escolher); modais
`FinancialAccountForm.vue`, `FinancialCategoryForm.vue`,
`CostCenterForm.vue`, `PaymentMethodForm.vue` (os dois últimos também não
estavam na lista original), `CashTransactionForm.vue`, `TransferForm.vue`.
`payees`/`payers` foram criadas nesta migration (junto do resto do
financeiro, como no dicionário de dados original) mas sem model/tela ainda
— chegam na Etapa 5, que é quem de fato os usa.

Validado: `npm run type-check` (incl. `--force`), `cargo check`, e as três
migrations reproduzidas juntas num SQLite in-memory com
`PRAGMA foreign_keys = ON`: `UNIQUE`/`CHECK` de contas e categorias, e o
cálculo de saldo testado passo a passo (saldo inicial, receita,
transferência entre contas, estorno revertendo o valor corretamente, e
bloqueio de estornar duas vezes o mesmo lançamento via
`UNIQUE(original_transaction_id)`).

**Migration `version: 3`:** `financial_accounts`, `financial_categories`
(`parent_id` auto-relacionado), `cost_centers`, `payment_methods`,
`cash_transactions` (`transaction_type TEXT CHECK(...'RECEITA','DESPESA',
'TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA','ESTORNO')`, `status TEXT
CHECK(...'PENDENTE','CONFIRMADA','ESTORNADA','CANCELADA')`, `source_type`/
`source_id` soltos, `transfer_group_id`), `cash_transaction_reversals`,
`payees`, `payers`. `bank_reconciliations`/`bank_reconciliation_items`
adiadas (não bloqueiam nada).

**Models:** `FinancialAccount.ts` (saldo sob demanda),
`FinancialCategory.ts`, `CostCenter.ts`, `PaymentMethod.ts`,
`CashTransaction.ts` (`transfer()`, `reverse()`).

**Tela:** `/financeiro` (`meta.label: "Financeiro"`) com sub-navegação
para Contas, Categorias, Centros de Custo e Lançamentos. Modais
`CashTransactionForm.vue`, `TransferForm.vue`, `FinancialAccountForm.vue`,
`FinancialCategoryForm.vue`.

## Etapa 4 — Mensalidades ✅ concluída

Implementada por último (depois da Etapa 5), a pedido do usuário — ver
nota de progresso no topo deste arquivo.

Implementado: migration `version: 5` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`membership_plans`,
`member_plan_history`, `membership_charges`, `charge_adjustments`,
`charge_payments`, `member_exemptions`); models
[MembershipPlan.ts](../src/models/MembershipPlan.ts),
[MembershipCharge.ts](../src/models/MembershipCharge.ts) (`generateForCompetence`
em lote, idempotente, com `due_date` ajustado para o último dia do mês
quando o dia do plano não existir nele) e
[ChargePayment.ts](../src/models/ChargePayment.ts) (baixa gera
`CashTransaction` da Etapa 3, bloqueia baixa de cobrança já paga/cancelada/
isenta); tela [Mensalidades.vue](../src/views/Mensalidades.vue) em
`/mensalidades`, com abas Cobranças (filtro por competência/situação) e
Planos; modais `MembershipPlanForm.vue`, `ChargeGenerateForm.vue`,
`ChargePaymentForm.vue`.

Ajuste retroativo necessário: `Member.ts`/`MemberForm.vue` (Etapa 2) não
tinham campo para atribuir plano ao sócio — `membership_plan_id` não
existia como plano até agora. Adicionei um seletor de "Plano de
mensalidade" no formulário de sócio, já que sem isso não haveria como
`generateForCompetence` encontrar quem cobrar. `member_plan_history` e
`charge_adjustments`/`member_exemptions` foram criadas (schema completo),
mas sem model/UI ainda — não bloqueiam o fluxo básico de gerar+cobrar e
ficam para uma iteração futura.

Validado: `npm run type-check` (incl. `--force`) e `cargo check` sem
erros; as 5 migrations reproduzidas juntas num SQLite in-memory com
`PRAGMA foreign_keys = ON`; e a lógica de negócio simulada passo a passo
replicando exatamente as instruções de `MembershipChargeModel`/
`ChargePaymentModel`: geração ignorando sócio sem plano e sócio inativo,
idempotência ao gerar duas vezes a mesma competência, ajuste do
vencimento para o fim do mês (dia 31 configurado num plano, testado em
fevereiro), baixa parcial seguida de baixa final, e bloqueio de pagar uma
cobrança já quitada.

**Migration `version: 4`:** `membership_plans`, `member_plan_history`,
`membership_charges` (`competence_month TEXT` ISO `'YYYY-MM-01'`, `status
TEXT CHECK(...'ABERTA','PARCIAL','PAGA','VENCIDA','CANCELADA','ISENTA')`,
`UNIQUE(association_id, member_id, charge_type, competence_month)`),
`charge_adjustments`, `charge_payments`, `member_exemptions`.

**Models:** `MembershipPlan.ts`, `MembershipCharge.ts` (com
`generateForCompetence(mes)` em lote, idempotente via `UNIQUE`),
`ChargePayment.ts` (baixa gera `CashTransaction` da Etapa 3).

**Tela:** `/mensalidades` (filtro por competência/situação). Modais
`MembershipPlanForm.vue`, `ChargeGenerateForm.vue`, `ChargePaymentForm.vue`.

## Etapa 5 — Contas a pagar / Contas a receber ✅ concluída

Implementada fora de ordem (antes da Etapa 4), a pedido do usuário — ver
nota de progresso no topo deste arquivo.

Implementado: migration `version: 4` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`payables`,
`payable_installments`, `payable_payments`, `receivables`,
`receivable_installments`, `receivable_payments`, `donors`, `donations` —
`payees`/`payers` já existiam desde a migration `version: 3`, só ganharam
model agora); models
[Payee.ts](../src/models/Payee.ts), [Payer.ts](../src/models/Payer.ts),
[Payable.ts](../src/models/Payable.ts) (parcelas geradas por
[utils/installments.ts](../src/utils/installments.ts), `payInstallment` +
`refreshStatus`), [Receivable.ts](../src/models/Receivable.ts) (espelha
`Payable.ts`, em receita), [Donor.ts](../src/models/Donor.ts) e
[Donation.ts](../src/models/Donation.ts); telas
[ContasAPagar.vue](../src/views/ContasAPagar.vue) e
[ContasAReceber.vue](../src/views/ContasAReceber.vue) (esta com abas "A
receber"/"Doações") em `/contas-a-pagar` e `/contas-a-receber`; modais
`PayableForm.vue`, `PayableInstallmentPaymentForm.vue`, `ReceivableForm.vue`,
`ReceivableInstallmentPaymentForm.vue`, `DonationForm.vue`, e mais
`PayeeForm.vue`/`PayerForm.vue` (não estavam na lista original — precisos
para cadastrar fornecedor/pagador antes de vincular a uma conta).

Desvio do dicionário de dados original: `payables`/`receivables` não tinham
um ENUM de status definido na especificação (só `membership_charges`
tinha); os valores usados (`ABERTA`, `APROVACAO_PENDENTE`, `PARCIAL`,
`PAGA`/`RECEBIDA`, `CANCELADA`) foram escolhidos seguindo o mesmo espírito.
`payables.project_id`/`document_id` e `receivables.document_id` ficam
`TEXT` soltos, sem `REFERENCES` (tabelas de etapas futuras — mesma regra
corrigida na Etapa 2).

Validado: `npm run type-check` (incl. `--force`) e `cargo check` sem erros;
as 4 migrations reproduzidas juntas num SQLite in-memory com
`PRAGMA foreign_keys = ON`; e a lógica de negócio (geração de parcelas
iguais com resto absorvido pela última, baixa parcial seguida de baixa
total, recálculo de status do título a partir das parcelas, bloqueio de
pagar acima do saldo restante) simulada passo a passo replicando
exatamente as instruções SQL de `Payable.ts`.

**Migration `version: 5`:** `payables`, `payable_installments`,
`payable_payments`, `receivables`, `receivable_installments`,
`receivable_payments`, `donors`, `donations`. `status` de `payables` já
com valor `APROVACAO_PENDENTE` no `CHECK`, sem implementar aprovação de
fato (depende da Etapa 8).

**Models:** `Payable.ts` (+ parcelas), `Receivable.ts` (+ parcelas),
`Donor.ts`, `Donation.ts`. Baixa de parcela cria `CashTransaction`.

**Telas:** `/contas-a-pagar`, `/contas-a-receber`. Modais `PayableForm.vue`,
`PayableInstallmentPaymentForm.vue`, `ReceivableForm.vue`,
`ReceivableInstallmentPaymentForm.vue`, `DonationForm.vue`.

## Etapa 6 — Protocolos ✅ concluída

Implementado: migration `version: 6` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`protocol_books`,
`protocol_entries`); models
[ProtocolBook.ts](../src/models/ProtocolBook.ts) e
[ProtocolEntry.ts](../src/models/ProtocolEntry.ts) (`create()` faz a
numeração atômica via `UPDATE ... RETURNING` + `INSERT`, `updateStatus()`
nunca apaga um registro lançado); tela
[Protocolos.vue](../src/views/Protocolos.vue) em `/protocolos`, com abas
Protocolos (filtro por livro/situação, troca de situação inline) e Livros;
modais `ProtocolEntryForm.vue`, `ProtocolBookForm.vue`.

Desvio do dicionário de dados original: **não** foi criada a tabela
`protocol_sequences`. O documento original pede `protocol_books` (com
`next_number`) **e** uma `protocol_sequences` separada (`protocol_book_id`,
`year`, `last_number`) para numeração "segura" — pensada para concorrência
em Postgres multiusuário. Como `protocol_books` já é único por
`(association_id, protocol_type, year)` e o SQLite deste app é
single-writer por arquivo, usei só `protocol_books.next_number` como
contador atômico; uma segunda tabela de sequência só duplicaria o estado
sem reduzir risco real de concorrência neste projeto.

**Verificação técnica confirmada nesta etapa** (pendência que o plano
original apontava): `UPDATE ... RETURNING` funciona — `libsqlite3-sys`
0.30.1 (usado pelo `sqlx-sqlite`, via `Cargo.lock`) empacota SQLite 3.46.x,
bem acima do mínimo 3.35 exigido pelo `RETURNING`. Testado tanto
isoladamente quanto dentro do fluxo real de `ProtocolEntryModel.create()`.

Validado: `npm run type-check` (incl. `--force`) e `cargo check` sem
erros; as 6 migrations reproduzidas juntas num SQLite in-memory com
`PRAGMA foreign_keys = ON`; numeração atômica gerando 1, 2, 3... em
sequência dentro de um livro sem interferir na numeração de outro livro
(tipo/ano diferentes), `UNIQUE(protocol_book_id, number)` bloqueando
duplicidade, `CHECK` de `direction` inválida, e um protocolo com
`response_protocol_id` apontando para outro (auto-relacionamento).

**Migration `version: 6`:** `protocol_books`, `protocol_sequences`,
`protocol_entries` (`direction TEXT CHECK(...'RECEBIDO','EXPEDIDO',
'INTERNO')`, `status TEXT CHECK(...'ABERTO','EM_ANDAMENTO','RESPONDIDO',
'ENCERRADO','CANCELADO')`, `UNIQUE(protocol_book_id, number)`).

**A confirmar no início desta etapa:** suporte a `UPDATE ... RETURNING`
(SQLite ≥ 3.35) na versão empacotada pelo `tauri-plugin-sql`/`sqlx`, usado
para obter o próximo número de protocolo de forma atômica. Se não
suportado, avaliar transação explícita.

**Models:** `ProtocolBook.ts`, `ProtocolEntry.ts` (`create()` faz a
numeração atômica + `INSERT`).

**Tela:** `/protocolos`. Modais `ProtocolEntryForm.vue`,
`ProtocolBookForm.vue`.

## Etapa 7 — Documentos e registros ✅ concluída

**Decisão tomada no início da etapa (era um item aberto do plano):**
comandos Rust dedicados em vez de `@tauri-apps/plugin-fs`. O app já segue
esse padrão para operações de arquivo (`config.rs`: mover o banco, ler/
gravar `config.json`), então um módulo novo (`documents.rs`) com
`import_document_file`/`get_document_file_path` (`Result<T, String>`, sem
`unwrap`/`panic!`, ver `.claude/rules/backend.md`) evita somar uma
dependência nova ao frontend só para copiar um arquivo. Também resolveu o
checksum: em vez de `crypto.subtle.digest` no frontend (que exigiria ler o
arquivo em JS, e só `plugin-fs` faria isso), o SHA-256 é calculado no Rust
no mesmo passo em que o arquivo é lido para ser copiado — usa a crate
`sha2` (`0.10.9`, já baixada localmente como dependência transitiva de
`sqlx`, então virar dependência direta não exigiu acesso à rede). O
arquivo copiado fica numa pasta `documentos/` ao lado do arquivo do banco
de dados (mesmo espírito de `config::exe_dir` para o `config.json`); mover
o banco pela tela de Configurações **não** move essa pasta — limitação
conhecida, não implementada nesta etapa. Abrir um arquivo usa
`@tauri-apps/plugin-opener` (`openPath`), que já era uma dependência do
projeto mas só tinha a permissão `opener:default` nas capabilities — que
cobre `open_url`/`reveal_item_in_dir`, não `open_path` — então
`opener:allow-open-path` foi adicionada a `src-tauri/capabilities/
default.json`.

Implementado: migration `version: 7` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`document_types`,
`documents`, `document_versions`, `document_links`, `document_tags`,
`document_tag_links`, `document_access_logs`, `records`); módulo
[documents.rs](../src-tauri/src/documents.rs) com os dois comandos Rust
citados acima; models
[DocumentType.ts](../src/models/DocumentType.ts),
[Document.ts](../src/models/Document.ts) (`create()` já importa o arquivo
escolhido como versão 1; `addVersion()` importa uma nova versão e atualiza
`current_version_id`; `logAccess()` grava em `document_access_logs`),
[DocumentLink.ts](../src/models/DocumentLink.ts) (lista fechada
`TIPOS_ENTIDADE_VINCULAVEL` validada em código — mesmo espírito de
`source_type`/`source_id` — com seletor dedicado só para `MEMBER` e
`PROTOCOL_ENTRY`, que já têm tela; os demais tipos aceitam colar o `id`
manualmente), [DocumentTag.ts](../src/models/DocumentTag.ts) e
[InstitutionalRecord.ts](../src/models/InstitutionalRecord.ts) (nome
diferente de `records` para não colidir com o tipo utilitário `Record<K,
V>` do TypeScript); serviço
[documentFiles.ts](../src/services/documentFiles.ts) fazendo a ponte com
os comandos Rust; telas
[Documentos.vue](../src/views/Documentos.vue) em `/documentos`
(sub-navegação por abas: Documentos, Tipos, Etiquetas, Registros — as três
últimas não estavam na lista original de telas, adicionadas pelo mesmo
motivo de outras etapas: as entidades administrativas do módulo precisam
de alguma UI para existir) e
[DocumentoDetalhes.vue](../src/views/DocumentoDetalhes.vue) em
`/documentos/:id` (`meta.hidden: true`, abas Versões/Vínculos/Etiquetas —
padrão de tela de detalhe já usado em `SocioDetalhes.vue`); modais
`DocumentUploadForm.vue`, `DocumentVersionForm.vue`,
`DocumentTypeForm.vue`, `DocumentTagForm.vue`,
`InstitutionalRecordForm.vue` e `DocumentLinkForm.vue` (um só formulário
reaproveitado nos dois sentidos do vínculo: a partir da ficha do documento
escolhendo a entidade, ou a partir da ficha de uma entidade escolhendo o
documento).

Diferente do previsto no plano, o vínculo com Sócios não ficou "adiado até
a tela existir" — como a Etapa 2 já existe, `SocioDetalhes.vue` ganhou uma
aba "Documentos" nesta mesma etapa, usando `DocumentLinkModel.
listForEntity('MEMBER', ...)` e abrindo `DocumentLinkForm` com
`entityType`/`entityId` já fixos. O que ficou mesmo adiado (conforme o
plano original já previa) foi `member_documents` — a tabela de documentos
*cadastrais* do sócio (RG, CPF, comprovante...), que é uma tabela
diferente de `document_links` e ainda não existe.

`records` foi implementada com o mínimo descrito no dicionário de dados
original: é a entrada mais rasa de todo aquele documento — aparece só na
tabela-resumo da seção 4.5, sem `CREATE TABLE` correspondente na íntegra
do DDL e sem relação com nenhuma outra tabela — então não foi inventado
campo ou comportamento além do que está listado ali.

Validado: `npm run type-check` (incl. rebuild limpo com `vue-tsc -b
--force`), `cargo check` (que já compila `documents.rs` e a dependência
nova `sha2`), e as sete migrations reproduzidas juntas num SQLite
in-memory com `PRAGMA foreign_keys = ON`: numeração de versão sequencial e
`UNIQUE(document_id, version_number)`/`UNIQUE(document_id,
checksum_sha256)` bloqueando duplicidade, `CHECK` de `status`/
`confidentiality`/`action` inválidos, `UNIQUE` de vínculo e de etiqueta
duplicados, e `ON DELETE CASCADE` removendo versões, vínculos, etiquetas e
logs de acesso ao apagar um documento.

**Migration `version: 7`:** `document_types`, `documents`,
`document_versions`, `document_links`, `document_tags`,
`document_tag_links`, `document_access_logs`, `records`.
`document_access_logs.ip_address` (previsto no documento original) foi
removida — este é um app desktop local de usuário único, não uma
aplicação web onde IP de origem faz sentido.

**A confirmar no início desta etapa:** app só tem `@tauri-apps/
plugin-dialog` e `@tauri-apps/plugin-opener` hoje — nenhum copia arquivo
para pasta gerenciada. Avaliar `@tauri-apps/plugin-fs` ou comandos Rust
dedicados. Checksum SHA-256 via `crypto.subtle.digest` nativo.

**Models:** `DocumentType.ts`, `Document.ts` (`addVersion()`),
`DocumentLink.ts`, `DocumentTag.ts`.

**Tela:** `/documentos`. Modais `DocumentUploadForm.vue`,
`DocumentLinkForm.vue` (completo só após Etapas 2/5/6 existirem).

**Adiado:** vincular `member_documents` (Etapa 2) à ficha do sócio.

## Etapa 8 — Usuários, permissões e auditoria ✅ concluída — MVP completo

**Decisão tomada no início da etapa (era um item aberto do plano):** sem
gate de login, seguindo o default que o próprio plano já propunha. O app
continua desktop local sem tela de autenticação; `users` existe só para
*atribuir autoria* a ações sensíveis. Como não há sessão, foi criado um
seletor de "usuário atual" (`useCurrentUser.ts`, persistido em
`localStorage`) exibido no topo da tela (`CurrentUserPicker.vue`, dentro de
`TopMenu.vue`) — o operador escolhe manualmente quem é antes de mexer em
caixa, sócio ou permissão. Por não haver login real, `users` não ganhou
coluna de senha nem os campos `external_subject`/`last_login_at` do
dicionário de dados original (sem uso sem um fluxo de autenticação de
verdade).

Implementado: migration `version: 8` em
[src-tauri/src/lib.rs](../src-tauri/src/lib.rs) (`users`, `roles`,
`permissions`, `role_permissions`, `user_roles`, `audit_logs`,
`notifications`, `system_settings`; `user_association_access` ficou de
fora, como já previsto — só faria sentido no modelo N-associações-por-
arquivo, descartado). `audit_logs.user_id` é a primeira coluna de autoria
de todo o app que é uma FK de verdade (`REFERENCES users(id)`), porque
`users` já existe nesta mesma migration; as colunas soltas de autoria
criadas em etapas anteriores (`cash_transactions.created_by`,
`member_status_history.changed_by`, `protocol_entries.responsible_user_id`,
`documents.owner_user_id` etc.) continuam sem `REFERENCES` — SQLite não
permite adicionar FK a coluna já existente sem recriar a tabela inteira
(mesma regra da migration `version: 5`) — mas passaram a ser preenchidas de
fato com `getCurrentUserId()` nos dois fluxos tratados como sensíveis
nesta etapa (ver abaixo). `document_access_logs.ip_address`/`user_agent`
do dicionário original não entraram, mesma razão já registrada na Etapa 7
(app desktop local).

Models: [Permission.ts](../src/models/Permission.ts) (catálogo GLOBAL, sem
`association_id` — igual ao dicionário original —, com `ensureCatalog()`
semeando os códigos de exemplo da seção 7 do documento de domínio),
[Role.ts](../src/models/Role.ts) (`seedDefaultRoles()` cria os 7 perfis
sugeridos na seção 7 — Administrador, Presidência, Tesouraria, Secretaria,
Atendimento, Consulta, Auditoria — sem nenhuma permissão pré-marcada, já
que o documento só descreve o escopo de cada perfil em prosa;
`setPermissions()` substitui o conjunto inteiro e audita a alteração),
[User.ts](../src/models/User.ts) (sem exclusão física — nem seria possível
depois da primeira ação auditada, `audit_logs.user_id` bloqueia o
`DELETE`, confirmado na simulação —, só `setActive()`), e
[AuditLog.ts](../src/models/AuditLog.ts) (`log()` grava com o autor de
`getCurrentUserId()`, podendo ser `null` se ninguém foi selecionado —
preferiu-se auditar sem autor a não auditar). `Notification.ts` e
`SystemSetting.ts` entraram só como camada de dados, sem tela: o próprio
plano já previa isso para `notifications` na Fase 3 ("Comunicação"), e
`system_settings` fica pronta para o primeiro valor configurável de
verdade (ex.: o limite de aprovação de despesa da seção 6) sem exigir
migration nova.

Auditoria efetivamente wireada nos três fluxos sensíveis do MVP citados no
plano — financeiro, sócio, permissão:
- **Sócio:** `MemberModel.changeStatus` (Etapa 2) grava `changed_by` em
  `member_status_history` e chama `AuditLogModel.log` (`ALTERACAO`).
- **Financeiro:** `CashTransactionModel.create/transfer/reverse` (Etapa 3)
  gravam `created_by` e auditam `CRIACAO`/`ESTORNO`.
- **Permissão:** `UserModel.assignRole/revokeRole` e
  `RoleModel.setPermissions` (esta etapa) auditam `ALTERACAO_PERMISSAO`.

Isso significa que as colunas de autoria das Etapas 4, 5, 6 e 7
(`payables.created_by`, `receivable`/`payable_payments`,
`protocol_entries.responsible_user_id`, `documents.owner_user_id`,
`document_versions.uploaded_by` etc.) continuam sem preenchimento — ficam
como trabalho futuro fora do escopo que o plano definiu para esta etapa,
não uma omissão silenciosa.

Telas: [Usuarios.vue](../src/views/Usuarios.vue) em `/usuarios` (abas
Usuários — cadastro, ativar/desativar, gerenciar perfis por usuário via
[UserRolesForm.vue](../src/modals/UserRolesForm.vue) — e Auditoria, uma
tela de consulta que não estava na lista original de telas, adicionada
para poder de fato verificar que a trilha de auditoria funciona) e
[Perfis.vue](../src/views/Perfis.vue) em `/perfis` (lista de perfis +
"Criar perfis sugeridos" + [RolePermissionsForm.vue](../src/modals/RolePermissionsForm.vue),
checklist de permissões agrupada por módulo).

Validado: `npm run type-check` (com rebuild limpo `--force`), `cargo
check`, e as 8 migrations juntas num SQLite in-memory: `UNIQUE` de e-mail
de usuário e de código de permissão, `CHECK` de status de usuário
inválido, `PRIMARY KEY` composta bloqueando vínculo duplicado de
usuário-perfil, `ON DELETE CASCADE` limpando `role_permissions`/
`user_roles` ao remover um perfil, e a FK de `audit_logs.user_id`
efetivamente impedindo apagar um usuário com histórico. Também replicado,
com os mesmos parâmetros posicionais usados nos models editados, o INSERT
de `cash_transactions`/`member_status_history` com as colunas de autoria
novas, para garantir que a contagem de `$N` bate com a lista de colunas
depois da edição.

**Isso fecha o MVP** (Etapas 0 a 8). Seguem, sem implementação ainda, os
blocos resumidos de Fase 2 (Governança, Projetos, Patrimônio, Atendimento,
Eventos) e Fase 3 (Comunicação, Indicadores) descritos abaixo.

**Migration `version: 8`:** `users`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `audit_logs`, `notifications`,
`system_settings` (`user_association_access` fica de fora — só faz
sentido no modelo N-associações-por-arquivo, descartado).

**A confirmar no início desta etapa:** app é mono-usuário local sem tela
de login hoje — usuários/perfis servem só para atribuir responsabilidade
a registros, ou é preciso gate de login real? Default proposto: sem gate
de login. Se houver senha real, hashing Argon2id/bcrypt exige crate Rust
(`argon2`) via comando `#[tauri::command]` (`.claude/rules/backend.md`).

**Models:** `User.ts`, `Role.ts`, `Permission.ts`, `AuditLog.ts`
(auditoria só de operações sensíveis no MVP: financeiro, sócio,
permissão).

**Telas:** `/usuarios`, `/perfis`.

## Mudança pós-MVP — múltiplas associações por arquivo ✅ concluída (2026-09-01)

Pedido do usuário depois do MVP fechado: remover a tela "Instituição" e
suportar de verdade várias associações no mesmo arquivo `.db`, com um
dropdown para trocar qual está ativa e um dashboard-resumo dela na tela
Início. Antes de implementar, confirmei explicitamente com o usuário que
isso significava reverter a decisão estrutural nº 1 (não só mudar a tela) —
resposta: sim, multi-associação de verdade, com todo o app filtrando pela
associação ativa.

**O que mudou:**

- **`AssociationModel`** perdeu `getCurrent()`/`getCurrentId()` (que liam
  "a única linha existente") e ganhou `list()`/`get(id)` — CRUD comum,
  sem noção de "atual".
- **Nova composable [useCurrentAssociation.ts](../src/composables/useCurrentAssociation.ts)**
  (mesmo padrão de `useCurrentUser.ts`, Etapa 8): guarda qual associação
  está ativa, persistida em `localStorage` (não no banco — é preferência
  local, não dado de domínio). `getCurrentAssociationId()` lança erro se
  nada foi selecionado, herdando o comportamento de guarda que
  `getCurrentId()` tinha.
- **Todo model de domínio que grava `association_id`** (25 arquivos:
  `Member`, `CashTransaction`, `FinancialAccount`, `FinancialCategory`,
  `CostCenter`, `PaymentMethod`, `Payee`, `Payer`, `Donor`, `Donation`,
  `Payable`, `Receivable`, `MembershipPlan`, `MembershipCharge`,
  `ProtocolBook`, `ProtocolEntry`, `DocumentType`, `Document`,
  `DocumentTag`, `InstitutionalRecord`, `User`, `Role`, `AuditLog`,
  `Notification`, `SystemSetting`) trocou `await AssociationModel.
  getCurrentId()` por `getCurrentAssociationId()` (síncrono) em `create()`,
  e todo método de listagem/busca de topo (`list()`/`search()`) ganhou
  `WHERE association_id = $1` (ou o equivalente via `JOIN`, para tabelas
  sem a coluna direta, como `protocol_entries` via `protocol_books`).
  Consultas por id de um registro específico (`get(id)`) e tabelas-filhas
  já alcançadas por um id de pai correto (parcelas, contatos, versões de
  documento etc.) não ganharam filtro extra — o pai já garante o
  isolamento, e filtrar de novo seria redundante.
- **Dois bugs latentes corrigidos no processo** (só existiam por causa da
  suposição de associação única, escondidos até multi-associação virar
  realidade): `DonorModel.findByDocument` não filtrava por associação —
  reaproveitaria um doador de outra associação pelo mesmo documento;
  `SystemSettingModel.get(key)` idem, apesar de a `UNIQUE` já ser
  `(association_id, key)`. Os dois agora filtram corretamente.
- **`Instituicional.vue` removido** (rota `/instituicional` também) — seu
  conteúdo virou [InstitutionalDataEditor.vue](../src/components/InstitutionalDataEditor.vue),
  um componente que recebe `associationId` por prop (sempre edita uma
  associação existente e específica, nunca mais "a única que existe"),
  reaproveitado dentro da tela Início.
- **[Inicio.vue](../src/views/Inicio.vue) reescrita**: dropdown de
  associação ativa + botão "Nova associação" (abre
  [AssociationForm.vue](../src/modals/AssociationForm.vue), modal mínimo
  — só razão social/nome fantasia/CNPJ; endereço e o resto se completam
  depois na aba Instituição) no topo; abaixo, duas abas — "Dashboard"
  (cards com sócios ativos, saldo total de caixa, mensalidades em
  aberto/vencidas, contas a pagar/receber em aberto, protocolos abertos e
  total de documentos — tudo calculado no cliente reaproveitando os
  `list()` já existentes de cada model, mesma filosofia de não otimizar
  prematuramente já usada no cálculo de saldo) e "Instituição" (o editor
  citado acima). Sem nenhuma associação cadastrada, a tela pula direto
  para a aba Instituição com uma chamada para cadastrar a primeira.

**Limitação conhecida, documentada e não corrigida** (risco/esforço não
compensava): `users.email` continua `UNIQUE` **global**, não por
associação — corrigir exigiria reconstruir `users` e, em cadeia (por causa
de `PRAGMA foreign_keys = ON` + a migration inteira rodar dentro de uma
transação do sqlx, onde essa pragma não tem efeito), também
`audit_logs`/`notifications`/`user_roles`, que têm FK para `users`. Duas
associações diferentes não conseguem cadastrar um usuário com o mesmo
e-mail — falha com um erro claro no cadastro, não corrompe nada. Registrado
como comentário na migration `version: 8` em `src-tauri/src/lib.rs` (só o
comentário foi adicionado depois; o SQL já aplicado não mudou).

**Validado:** `npx vue-tsc -b --force` (limpo, sem nenhum erro de tipo nas
~30 alterações) e `cargo check` (a migration ganhou só comentário, sem
mudança de SQL). Simulação em SQLite in-memory com duas associações no
mesmo arquivo, confirmando isolamento: sócios com a mesma matrícula em
associações diferentes (permitido, `UNIQUE` é por associação), saldo de
caixa calculado sem vazar entre associações, `findByDocument`/`get(key)`
isolados corretamente após a correção, e confirmação explícita de que
`users.email` é mesmo global (documentada acima como limitação, não como
bug não percebido). Testado também que `DROP TABLE`/reconstrução de
`users` dentro de uma transação com `PRAGMA foreign_keys = ON` falha
mesmo com `PRAGMA foreign_keys = OFF` no meio do script — foi isso que
confirmou que a limitação acima não tem uma correção barata.

## Mudança pós-MVP — reorganização do menu por módulo ✅ concluída (2026-09-01)

Pedido do usuário logo em seguida: três telas de topo eram, na prática,
sub-assuntos de outras — viraram abas em vez de itens próprios do menu
superior. Só reorganização de UI, nenhuma migration nem model mudou:

- **Contas a pagar** e **Contas a receber** (rotas `/contas-a-pagar` e
  `/contas-a-receber`, removidas) viraram as abas "A pagar" e "A receber"
  de [Financeiro.vue](../src/views/Financeiro.vue). "A receber" preserva a
  sub-aba "Doações" que já tinha.
- **Protocolos** (rota `/protocolos`, removida) virou a aba "Protocolos"
  de [Documentos.vue](../src/views/Documentos.vue), com sua sub-aba
  "Livros" preservada.
- **Mensalidades** (rota `/mensalidades`, removida) virou a aba
  "Mensalidades" de [Socios.vue](../src/views/Socios.vue), com sua
  sub-aba "Planos" preservada.

Cada tela absorvente ganhou o estado, as funções e os modais da tela
incorporada dentro do mesmo componente (mesmo padrão que `Documentos.vue`
já usava para `Tipos`/`Etiquetas`/`Registros` desde a Etapa 7) — nada virou
componente filho à parte, para não complicar o ciclo de vida do
`setSidebarTools()` por aba. Onde havia duas abas de primeiro nível com o
mesmo nome de variável local (ex.: `contas` de contas financeiras vs. de
contas a pagar), as variáveis/rótulos incorporados foram renomeados
(`contasAPagar`, `STATUS_PAGAR_LABEL` etc.) para não colidir.

Validado: `npx vue-tsc -b --force` limpo. Sem mudança de schema, então sem
simulação de migration nesta mudança.

## Mudança pós-MVP — sem usuários, senha por associação, config.json com registro de associações, pasta `docs` ✅ concluída (2026-09-01)

Quatro correções pedidas juntas pelo usuário, planejadas em modo de plano
(`EnterPlanMode`) antes de implementar por causa do tamanho — revertem boa
parte da mudança "múltiplas associações num `.db` só" do turno anterior:

1. **Sem usuários no sistema.** Perfis e permissões saem junto (sem
   usuário, não há a quem atribuir um perfil) e a trilha de auditoria
   também — decisões confirmadas com o usuário antes de implementar.
   **Migration `version: 9`** (`remove_usuarios_permissoes_auditoria`):
   `DROP TABLE` em cadeia de `user_roles`, `role_permissions`,
   `notifications`, `audit_logs`, `roles`, `users`, `permissions`
   (dependentes antes das tabelas referenciadas — testado num SQLite
   in-memory com `PRAGMA foreign_keys = ON` dentro de uma transação só,
   igual ao sqlx faz ao aplicar migration). Removidos do frontend:
   `User.ts`, `Role.ts`, `Permission.ts`, `AuditLog.ts`, `Notification.ts`,
   `useCurrentUser.ts`, `CurrentUserPicker.vue` (e o dropdown dele no
   `TopMenu.vue`), `Usuarios.vue`, `Perfis.vue` e os modais associados;
   rotas `/usuarios`/`/perfis` removidas. `Member.changeStatus` e
   `CashTransactionModel.create/transfer/reverse` (Etapa 8) perderam as
   chamadas de `getCurrentUserId()`/`AuditLogModel.log()` — as colunas
   soltas de autoria (`created_by`, `changed_by` etc., nunca tiveram FK)
   continuam existindo, só que para sempre `NULL`.

2. **Volta a "1 arquivo `.db` por associação"**, revertendo a mudança do
   turno anterior — cada associação tem seu próprio banco. A tabela
   `associations` de cada arquivo continua existindo e é usada (sempre com
   0 ou 1 linha agora), então **todo o filtro por `association_id` feito
   nos ~25 models no turno anterior não precisou ser revertido** — com um
   arquivo por associação, esse filtro é sempre trivialmente verdadeiro.

3. **`config.json` vira o registro de associações**: `AssociationEntry
   { id, name, password_hash: Option<String>, db_path }` dentro de
   `AppConfig { associations: Vec<...> }` (`src-tauri/src/config.rs`,
   reescrito). `load_or_init()` migra sozinho quem já tinha o formato
   antigo (`{ database: { path } }`) ou nem tinha `config.json` ainda mas
   já tinha um banco no local legado — vira a primeira associação da lista
   nova, sem passo manual (comportamento crítico verificado com testes
   Rust reais e descartados depois, não só lidos no código: confirmado que
   um `config.json` no formato antigo **não** é aceito pelo `serde` como
   formato novo — se fosse aceito silenciosamente, a lista viraria vazia
   em vez de cair no fallback de migração).

   Senha guardada como **hash PBKDF2-HMAC-SHA256** (`src-tauri/src/
   password.rs`, formato `pbkdf2$<iterações>$<salt-hex>$<hash-hex>`),
   implementado à mão com as crates `hmac`+`sha2` (já resolvidas no
   `Cargo.lock` desde a Etapa 7) em vez de `argon2`: essa não estava no
   lockfile e arriscaria exigir rede para compilar — verificado antes de
   decidir (`ls` no cache local do cargo). Testado com testes Rust reais
   (hash/verify de senha certa e errada, formato inválido sem pânico, e
   que duas senhas iguais geram hashes diferentes por causa do salt).

   Comandos novos em `config.rs`: `list_associations` (sem o hash — o
   frontend nunca recebe isso), `create_association`, `update_association`
   (reaproveita a lógica de mover arquivo + sidecars `-wal`/`-shm` que já
   existia), `set_association_password`, `verify_association_password`,
   `remove_association` (só tira do `config.json`, não apaga o arquivo).
   `get_config`/`save_config`/`get_default_db_path`/`move_database`
   saíram, substituídos por esses.

   **Limitação técnica descoberta e documentada** (molda o design, não é
   bug): `tauri-plugin-sql` registra migrations por URL exata de banco, uma
   vez, no início do processo (`add_migrations`). Por isso o `lib.rs` foi
   ajustado para, no `run()`, iterar todas as associações já conhecidas no
   `config.json` e registrar migrations para cada uma — mas uma associação
   **criada durante a sessão atual** só fica utilizável depois de
   **reiniciar o app** (a `all_migrations()` foi extraída para uma função,
   chamada uma vez por associação). O mesmo vale para mover o arquivo de
   uma associação já existente. Ambos os fluxos (`AssociationForm.vue`,
   `AssociationSettingsForm.vue`) avisam isso e oferecem "Reiniciar agora".

   Telas: `Inicio.vue` — dropdown lê `listAssociations()` (não mais
   `AssociationModel.list()` de uma tabela compartilhada); selecionar uma
   com senha abre `AssociationPasswordPrompt.vue` antes de conectar
   (`selectAssociation`, em `useCurrentAssociation.ts`); reconexão
   automática ao reabrir o app só acontece para associações **sem** senha.
   `Configuracoes.vue` reescrita como administração do registro (renomear,
   mover arquivo, definir/trocar/remover senha, remover entrada) — a tela
   Início ficou só para escolher/desbloquear e cadastrar uma nova.

4. **Pasta `docs`** (era `documentos`) ao lado do `.db` de cada
   associação, para os arquivos anexados. `import_document_file`/
   `get_document_file_path` (`documents.rs`) passaram a receber `db_path`
   como parâmetro em vez de ler um `config::load_or_init().database.path`
   único (que não existe mais) — o frontend já sabe qual é
   (`getCurrentDbPath()`, em `database.ts`).

Validado: `cargo check` limpo; as 9 migrations juntas num SQLite in-memory
(incluindo o `DROP TABLE` em cadeia da `version: 9`, sem erro de FK, e uma
associação/sócio/histórico inseridos normalmente depois, sem `changed_by`
nem `user_id`); testes Rust reais (escritos, rodados com `cargo test`, e
removidos depois — não ficou infraestrutura de teste no projeto, só a
verificação) para o hash de senha e para a migração de formato do
`config.json`; `npx vue-tsc -b --force` limpo depois de mexer em ~30
arquivos de frontend (services, composable, telas, remoções).

## Mudança pós-MVP — reestruturação do fluxo de mensalidades ✅ concluída (2026-09-01)

Planejada em modo de plano (`EnterPlanMode`) por causa do tamanho.
`Mensalidades` deixa de ser aba de `Socios.vue` e vira aba da **ficha do
sócio** (mensalidade é individual); `Planos` (CRUD de `MembershipPlan`)
sai de dentro de Sócios e vira tela própria; plano fica obrigatório;
introduzida uma tabela `parcelas` como calendário de competências; troca
de plano ganhou trava e regras de inadimplência.

**Migration `version: 10`** (`cria_parcelas_e_voto_do_plano`) — só
`CREATE TABLE`/`ALTER TABLE ADD COLUMN`, nenhum rebuild:
- `parcelas` (id, association_id, competence_month, created_at) — 1 linha
  por competência, **sem sócio**; `membership_charges` ganha `parcela_id`
  (nullable, com `REFERENCES`) apontando pra ela. `MembershipChargeModel.
  generateForCompetence` passou a chamar `ParcelaModel.getOrCreate` antes
  de inserir a cobrança.
- `membership_plans.grants_voting_right` (`INTEGER NOT NULL DEFAULT 1`) —
  novo checkbox em `MembershipPlanForm.vue`.
- Backfill de `parcelas`/`parcela_id` a partir das `membership_charges` já
  existentes, e de `member_plan_history` (tabela existente desde a
  `version: 5`, nunca usada até agora) a partir de `members.
  membership_plan_id` de quem já tinha plano.

**`membership_plan_id` de `members` continua sem `NOT NULL`/FK no banco —
decisão definitiva, não só "para o MVP"**: mapeei todas as FKs reais do
schema antes de decidir e descobri que recriar `members` puxaria, na mesma
transação, o rebuild de **12 tabelas** transitivamente dependentes dela
(`member_dependents`, `member_representatives`, `member_status_history`,
`member_plan_history`, `member_exemptions`, `receivables` →
`receivable_installments` → `receivable_payments`, `membership_charges` →
`charge_adjustments`/`charge_payments`) — o `sqlx` não permite `PRAGMA
foreign_keys=OFF` no meio de uma transação já aberta (mesma limitação da
`version: 9`), e testei em SQLite que o `DROP TABLE members` sozinho já
falha com "FOREIGN KEY constraint failed" (tabelas sem cascade) ou apaga
dependentes/histórico silenciosamente (tabelas com `ON DELETE CASCADE`).
Apresentei o escopo real ao usuário, que confirmou manter só na aplicação.
Obrigatoriedade agora é 100% em `MemberModel`/`MemberForm.vue`.

**Regras de negócio** (`MemberModel`, `src/models/Member.ts`):
- `create()` exige `membership_plan_id` e grava a primeira linha em
  `member_plan_history` (`start_date = association_date`).
- `changePlan(memberId, newPlanId, { effectiveDate, reason? })`: bloqueia
  com erro claro se houver mensalidade do plano atual `ABERTA`/`PARCIAL`
  com `due_date` vencida; senão cancela as `ABERTA`/`PARCIAL` **ainda não
  vencidas** do plano atual, fecha a vigência corrente em
  `member_plan_history` e abre uma nova.
- `isInadimplente(memberId)`: 1+ cobrança `ABERTA`/`PARCIAL` vencida do
  plano atual, contando só a partir de `start_date` da vigência aberta em
  `member_plan_history` (não da associação original — cobre troca de
  plano).

**Telas**: `Socios.vue` perdeu a aba Mensalidades (só lista de sócios);
nova `Planos.vue` (rota `/planos`) com CRUD de plano + "Gerar cobranças do
mês" (`ChargeGenerateForm.vue`, mudou de dono); `MemberForm.vue` só pede
plano na criação (edição não mexe mais em plano); novo
`MemberPlanChangeForm.vue` (mesmo padrão de `MemberStatusChangeForm.vue`)
acionado pela ficha; `SocioDetalhes.vue` ganhou aba "Mensalidades"
(paginada — primeira paginação do projeto, `MembershipChargeModel.
listByMember` com `LIMIT`/`OFFSET` + `COUNT(*)`) com plano atual, badge
"Inadimplente" e baixa reaproveitando `ChargePaymentForm.vue`.

**Geração de parcelas**: novo `src/models/Parcela.ts`
(`ParcelaModel.ensureAteMesAtual`), chamado dentro de `selectAssociation`
(`useCurrentAssociation.ts`) — é o ponto mais próximo de "iniciar o app"
que existe nesta arquitetura (banco só fica acessível depois que o usuário
escolhe a associação). Marco: `Association.foundation_date`, senão a
competência do plano mais antigo, senão só o mês atual.

**Geração automática de cobrança** (ajustada mais de uma vez, testando o
fluxo — versão final consolidada numa função só, a pedido do usuário):
`MembershipChargeModel.ensureAteMesAtual` é a ÚNICA função de geração
automática do projeto. Usa `marcoInicial()` (extraído de `Parcela.ts`,
reaproveitado pelas duas: fundação da associação, senão o plano mais
antigo, senão só o mês atual) e varre toda competência entre o marco e o
mês atual — se a competência já tem qualquer cobrança de `MENSALIDADE`
registrada, ignora e passa pra próxima; senão chama `generateForCompetence`.
Chamada em três pontos: (1) logo depois de `ParcelaModel.ensureAteMesAtual`
dentro de `selectAssociation`, ao conectar numa associação; (2) em
`InstitutionalDataEditor.vue`, ao salvar os dados institucionais com
fundação preenchida (cobre quem cadastra os sócios com plano antes de
preencher/corrigir a fundação); (3) sob demanda, botão "Forçar geração de
cobranças" na tela Planos, pra recuperar de algum erro (ex.: cobrança
apagada sem querer). Existiu uma versão intermediária com duas funções
separadas (uma só completando a partir da última competência gerada,
outra fazendo o backfill desde a fundação) — descartada em favor desta
única função mais simples.

Validado: simulação em SQLite da `version: 10` completa (backfill via
`INSERT`/`UPDATE` simples, sem o problema de FK do cenário de rebuild
descartado); `cargo check`; `npx vue-tsc -b --force` limpo.

## Mudança pós-MVP — remove planos de mensalidade, valor único por associação ✅ concluída (2026-09-01)

Planejada em modo de plano (`EnterPlanMode`). O sistema de vários planos de
mensalidade (Etapa 4 + reestruturação anterior) ficou confuso de usar — o
usuário pediu pra simplificar: a associação passa a ter **um valor de
contribuição mensal só**, e cada sócio só recebe cobrança **a partir da
data em que entrou na associação** (`association_date`) — corrige de vez a
falha que já existia de cobrar sócio por mês anterior à entrada dele.

**Migration `version: 11`** (`remove_planos_valor_unico_por_associacao`):
`associations` ganha `monthly_contribution_amount` (centavos) e
`monthly_contribution_due_day` (`CHECK BETWEEN 1 AND 31`, testado que
`ALTER TABLE ADD COLUMN` com `CHECK` funciona normalmente pra linhas
existentes já que `NULL` sempre passa no `CHECK`). `membership_plans` e
`member_plan_history` são removidas — ordem testada em simulação SQLite:
`member_plan_history` primeiro (nada mais referencia ela), depois
`UPDATE membership_charges SET membership_plan_id = NULL` (zera a única
referência real restante a `membership_plans` — só então dá pra
`DROP TABLE membership_plans` sem esbarrar no problema de FK já documentado
na `version: 9`/`version: 10`). `members.membership_plan_id` e
`membership_charges.membership_plan_id` continuam existindo como colunas,
só que pra sempre `NULL` — mesmo espírito de outras colunas soltas do
projeto.

Direito a voto (`membership_plans.grants_voting_right`, criado na
`version: 10`) não ganha substituto — virou regra implícita ("sócio ATIVO
tem direito a voto"), só documentada, sem campo (decisão do usuário).
Mudar o valor da contribuição não mexe em cobrança já gerada, mesmo em
aberto — só vale pra cobrança gerada dali pra frente (decisão do usuário).

**Removidos**: `src/models/MembershipPlan.ts`,
`src/modals/MembershipPlanForm.vue`, `src/modals/MemberPlanChangeForm.vue`
("trocar de plano" não existe mais — só tem um valor), `src/modals/
ChargeGenerateForm.vue` (gerar um mês específico na mão não agregava mais
nada sobre `ensureAteMesAtual`, que já varre tudo e pula o que já existe).
`Member.ts` perdeu `changePlan`/`planHistory`/`currentPlanTenure`;
`isInadimplente` simplificou pra só olhar cobrança vencida em aberto (sem
"vigência de plano" — a própria geração nunca cria cobrança anterior à
entrada do sócio).

`MembershipChargeModel.generateForCompetence` passou a filtrar sócio por
`status = 'ATIVO' AND substr(association_date,1,7) <= substr(competência,1,7)`
(em vez de `membership_plan_id IS NOT NULL` + buscar o plano), usando o
valor/dia de vencimento únicos de `Association` — sem valor configurado
ainda, não gera nada (`skipped` = todos, sem erro). `ParcelaModel.
marcoInicial` perdeu o fallback pro "plano mais antigo" (só fundação, senão
mês atual).

**Tela**: `Planos.vue` → `Cobrancas.vue` (rota `/planos` → `/cobrancas`,
label "Cobranças") — sem plano pra administrar, sobrou só a lista de
cobranças (filtro por competência/situação, paginada, botão "Pagar") e o
botão "Forçar geração de cobranças" na barra lateral.

Validado: simulação em SQLite da migration completa (`PRAGMA
foreign_key_check` limpo, `CHECK` do dia de vencimento continua validando);
`cargo check`; `npx vue-tsc -b --force` limpo.

### Correção — `version: 12`, `no such table: main.membership_plans` ✅ concluída (2026-09-01)

Bug encontrado pelo usuário ao clicar em "Forçar geração de cobranças"
logo depois da `version: 11`. A suposição de que
`membership_charges.membership_plan_id` podia ficar solto (só zerado, sem
tirar `REFERENCES membership_plans(id)` do schema) estava errada:
reproduzido em simulação SQLite que, com `PRAGMA foreign_keys=ON`, todo
`INSERT`/`UPDATE` em `membership_charges` passa a falhar com
`"no such table: main.membership_plans"` mesmo gravando `NULL` na coluna —
diferente de `DELETE`/`DROP TABLE`, que só checam FK de linhas com valor
não-nulo, `INSERT`/`UPDATE` recriam a checagem contra a tabela referenciada
no schema mesmo pra coluna fora da lista (vira `NULL` por padrão). Também
testado e descartado o truque clássico de recriar a tabela (`CREATE
... _new` + copiar + `DROP TABLE` + `RENAME`): o `DROP TABLE
membership_charges` nessas condições falha do mesmo jeito, porque
`charge_adjustments`/`charge_payments` têm `charge_id NOT NULL REFERENCES
membership_charges(id)` com dados reais apontando pra ela.

Migration `version: 12` (`remove_coluna_solta_membership_plan_id_de_charges`)
resolve com `ALTER TABLE membership_charges DROP COLUMN membership_plan_id`
(SQLite 3.35+, testado e seguro) — remove a coluna de vez, já que ela não
tinha uso nenhum na aplicação além de sempre gravar `NULL`.
`members.membership_plan_id` nunca teve `REFERENCES` (documentado desde a
`version: 2`) e não sofre desse bug. `MembershipCharge` (`src/models/
MembershipCharge.ts`) perdeu o campo `membership_plan_id` da interface,
já que a coluna deixou de existir no banco.

## Mudança pós-MVP — mensalidade por ausência de pagamento ✅ concluída (2026-09-01)

Planejada em modo de plano (`EnterPlanMode`). Pedido do usuário: parar de
pré-gerar uma cobrança por sócio/mês (o mecanismo que gerou o bug da
`version: 12`) e passar a considerar que um sócio deve um mês quando
simplesmente **não existe pagamento dele pra aquele mês** — sem
materializar nada além do pagamento em si. Confirmado com o usuário
(`AskUserQuestion`): modelo binário, sem baixa parcial — um pagamento por
sócio/mês já quita o mês inteiro, mesmo que o valor pago seja diferente do
valor de contribuição vigente.

**Migration `version: 13`** (`mensalidade_por_ausencia_de_pagamento`): nova
tabela `membership_payments` (`member_id` + `parcela_id`, `UNIQUE` nos
dois — reforça o binário no próprio banco), com backfill de qualquer baixa
já registrada em `charge_payments` (baixas parciais da mesma cobrança
colapsam pro pagamento mais recente — perda aceita, sem dado de produção).
`membership_charges`/`charge_payments`/`charge_adjustments` (Etapa 4,
`version: 5`) são inteiramente removidas — confirmado por grep que
`charge_type` só tinha `MENSALIDADE` usado de verdade, `charge_adjustments`
nunca teve model/tela consumindo, e os status `ISENTA`/`CANCELADA` nunca
eram setados por nenhuma tela. Ordem do `DROP` testada em simulação
(cadeia completa das 13 migrations rodada em sequência contra SQLite,
`PRAGMA foreign_key_check` limpo ao final): filha antes da mãe
(`charge_adjustments`/`charge_payments` antes de `membership_charges`), e
depois disso nenhuma tabela sobrevivente referencia essas três — diferente
da `version: 11`, aqui não sobra coluna solta com FK pra tabela removida.

**Novo model `src/models/MembershipPayment.ts`** (substitui
`MembershipCharge.ts` + `ChargePayment.ts`, ambos apagados): a leitura
("quem deve o quê") nunca é persistida — `buscarLinhas` cruza `members`
(sócios já dentro da vigência: `association_date` até `exit_date`, se
houver) com `parcelas` (`version: 10`) via `LEFT JOIN` em
`membership_payments`, e computa a situação (`PAGO`/`VENCIDO`/`ABERTO`) na
hora usando `calcularVencimento` (movida pra `utils/format.ts`, reusável).
`listar` (geral, só sócios `ATIVO`) e `listarPorSocio` (ficha do sócio,
qualquer situação — quer ver o histórico mesmo de quem já saiu) paginam em
memória sobre esse resultado computado; `isInadimplente` (chamado por
`MemberModel.isInadimplente`) é só `algum VENCIDO existe?`. `pagar` cria o
lançamento de receita no caixa (mesmo fluxo de antes, via
`CashTransactionModel.create`, `source_type: 'MEMBERSHIP_PAYMENT'`) e
insere em `membership_payments` — erro amigável se já existe pagamento
pra aquele `(member_id, parcela_id)`.

Isso elimina de vez `MembershipChargeModel.ensureAteMesAtual`/
`generateForCompetence` e o botão "Forçar geração de cobranças" (não
sobrou nada pra gerar): `useCurrentAssociation.ts` mantém só
`ParcelaModel.ensureAteMesAtual()` ao conectar (garante o calendário de
meses), e `InstitutionalDataEditor.vue` chama o mesmo método ao salvar a
fundação, sem geração de cobrança nenhuma. **Telas**: `Cobrancas.vue`
(antes lia `membership_charges`, agora `MembershipPaymentModel.listar`, sem
o botão de forçar geração) e a aba Mensalidades de `SocioDetalhes.vue`
(`listarPorSocio`) — ambas reaproveitam `MembershipPaymentForm.vue`
(substitui `ChargePaymentForm.vue`) pra registrar o pagamento.

Validado: simulação Python/SQLite rodando as 13 migrations em sequência
(`PRAGMA foreign_key_check` limpo, tabelas finais conferidas) mais um
teste de dados (sócio entrando em janeiro, pagando só janeiro, aparecendo
corretamente como devendo fevereiro/setembro); `cargo check`;
`npx vue-tsc -b --force` limpo; grep confirma zero referência residual a
`MembershipCharge`/`ChargePayment`/`membership_charges`/`charge_payments`/
`charge_adjustments` em `src/`.

### Nº do recibo de mensalidade segue livro de protocolo ✅ concluída (2026-09-01)

Pedido do usuário: o campo "Nº do recibo" (antes texto livre em
`MembershipPaymentForm.vue`) devia seguir a numeração de um livro de
protocolo (`protocol_books`, migration `version: 6`) do tipo `RECIBO`, com
dropdown pra escolher qual livro e a escolha lembrada pra próxima vez.
`MembershipPaymentModel.listarLivrosRecibo()` filtra os livros ativos com
`protocol_type === 'RECIBO'`; `pagar()` ganhou `protocol_book_id` opcional
— quando informado, chama `ProtocolEntryModel.create()` (mesma numeração
atômica `UPDATE ... RETURNING` já usada pelos protocolos comuns) DEPOIS de
confirmar que o mês ainda não tem pagamento, pra nunca queimar um número
de protocolo à toa; o recibo vira um protocolo `EXPEDIDO`/`RECIBO` de
verdade, rastreável no livro, e o número formatado
(`formatarNumeroProtocolo`) é o que fica salvo em
`membership_payments.receipt_number`. Sem livro escolhido, fica `null`
(comportamento anterior). Escolha do livro lembrada em `localStorage`,
por associação (`app:livro-recibo:${currentAssociationConfigId}` — os ids
de livro só existem dentro do `.db` de uma associação específica).
`Cobrancas.vue`/aba Mensalidades da ficha ganharam a coluna "Recibo".

### Tipo de livro de protocolo vira dropdown com tipos no `config.json` ✅ concluída (2026-09-01)

Pedido do usuário: o campo "Tipo" de `ProtocolBookForm.vue` (texto livre)
virou um `<select>` com tipos pré-cadastrados (`RECIBO`, `OFICIO`,
`PORTARIA`, `EDITAL`, `DECLARACAO`, `RECEBIDO`) + opção "+ Novo tipo..."
que cadastra um tipo novo na hora. Guardado no `config.json` da instalação
(`AppConfig.protocol_types`, `src-tauri/src/config.rs`) — não no banco de
uma associação, porque é uma preferência da instalação inteira,
compartilhada por todas as associações abertas nela (diferente de
`protocol_books`, que é por associação). `#[serde(default =
"default_protocol_types")]` garante que um `config.json` de antes deste
campo existir carregue com a lista padrão em vez de falhar a leitura —
mesmo cuidado de compatibilidade já usado pros outros campos opcionais de
`AppConfig`. Dois comandos novos (`list_protocol_types`/`add_protocol_type`,
espelhados em `src/services/config.ts`), registrados no
`invoke_handler!` de `lib.rs` — não precisam de entrada em
`capabilities/default.json` (só comandos de plugin são gateados por
capability, comando próprio do app não).

### Editar/excluir livro de protocolo + imprimir lista de registros ✅ concluída (2026-09-01)

Pedido do usuário: a aba Livros (Documentos › Protocolos › Livros) só
permitia criar. Acrescentado:
- `ProtocolBookModel.update()` (edita nome/tipo/ano/prefixo — nunca
  `next_number`/`is_active`, mesmo padrão de `PaymentMethodModel.update`,
  `SET` dinâmico a partir dos campos informados) e `ProtocolBookForm.vue`
  ganhou prop `bookId` opcional pra reaproveitar o mesmo modal em criar/editar
  (inclusive tipo que não está mais na lista pré-cadastrada do
  `config.json` é injetado na hora pra não cair sem querer em "+ Novo
  tipo...").
- `ProtocolBookModel.remove()` só apaga se `protocol_entries` desse livro
  estiver vazio — checado de novo no model como defesa em profundidade,
  já que `protocol_entries.protocol_book_id REFERENCES protocol_books(id)`
  sem `ON DELETE CASCADE` já rejeitaria o `DELETE` do banco nesse caso
  (confirmado em simulação SQLite: `FOREIGN KEY constraint failed`), mas
  com mensagem mais amigável. `ProtocolBookModel.listComContagem()` (nova)
  traz `entry_count` por `LEFT JOIN` + `GROUP BY` — o botão "Excluir" só
  aparece na tabela quando esse número é `0`.
- **Imprimir**: nova rota escondida `/livros/:id/imprimir` →
  `src/views/ImprimirLivroProtocolo.vue`, mostrando TODOS os protocolos do
  livro (sem os filtros da aba Protocolos), ordenados por `number`
  (sequência real do livro, não `protocol_date` — pode haver lançamento
  fora de ordem cronológica) — chama `window.print()` sozinha ao carregar
  (mais um botão manual, caso o usuário cancele o diálogo do SO). `App.vue`
  ganhou um bloco `@media print` global tirando o menu superior/sidebar e
  destravando a altura/scroll fixos do layout de tela (senão a lista
  impressa cortaria numa página só); a própria tela de impressão marca os
  botões de ação com `.no-print` pra não saírem no papel.

Validado: simulação SQLite confirmando `listComContagem` (contagem certa
por livro) e o bloqueio de FK ao tentar apagar livro com protocolo;
`cargo check`; `npx vue-tsc -b --force` limpo.

### Ligação Documentos ↔ Protocolos, aba Protocolos ✅ concluída (2026-09-01)

Usuário questionou se as abas "Documentos" e "Registros" eram redundantes
("todo protocolo é um documento"). Concordei em parte: `documents`
(arquivo com versão/checksum/confidencialidade) e `protocol_entries`
(registro numerado de correspondência, sem armazenar arquivo nenhum) são
conceitos genuinamente diferentes — fundir os dois faria perder
versionamento e controle de confidencialidade justo nos documentos que
mais precisam disso (estatuto, atas). "Registros" (`InstitutionalRecord`)
ficou como está, a pedido do usuário. O ponto real, porém: o vínculo
polimórfico `document_links` já aceita `entity_type: 'PROTOCOL_ENTRY'`
desde a Etapa 6/7 (`DocumentLinkForm.vue` já tinha a opção "Protocolo" no
dropdown, usável a partir de `DocumentoDetalhes.vue` → aba Vínculos), mas
o sentido inverso — ver/gerenciar documentos a partir de um protocolo —
nunca tinha sido ligado em tela nenhuma.

Fechado agora: `DocumentLinkModel.listForEntities()` (nova) busca
documentos vinculados de VÁRIOS protocolos numa query só (evita 1 query
por linha da tabela — `WHERE entity_type = $1 AND entity_id IN (...)`,
testado em simulação SQLite). A aba Protocolos de `Documentos.vue` ganhou
uma coluna "Documentos": lista os vínculos de cada linha (nome clicável →
`documento-detalhes`, "×" remove o vínculo) e um "+ Vincular". **Revisado
logo em seguida** (pedido do usuário): "+ Vincular" não abre mais
`DocumentLinkForm.vue` escolhendo um documento já existente — abre
`DocumentUploadForm.vue` (ganhou prop opcional `protocolEntryId` +
`tituloSugerido`/`dataSugerida`, pré-preenchidos com o número/assunto/data
do próprio protocolo), que importa um arquivo NOVO e já cria o vínculo
junto, num passo só. `DocumentLinkForm.vue` continua existindo e sendo
usado nos outros sentidos (a partir do documento, aba Vínculos de
`DocumentoDetalhes.vue`; a partir do sócio, `SocioDetalhes.vue`) — só o
sentido "a partir do protocolo" deixou de escolher entre documentos
existentes.

### Recibo de mensalidade abre tela de impressão automaticamente ✅ concluída (2026-09-01)

Pedido do usuário: depois de registrar o pagamento de uma mensalidade
(`MembershipPaymentForm.vue`), abrir direto uma tela de impressão do
recibo — pra imprimir de verdade ou só ler os dados na tela e copiar num
talão físico. `MembershipPaymentModel.pagar()` passou a devolver o
pagamento recém-criado (antes era `Promise<void>`) via um novo
`MembershipPaymentModel.get(id)` (junta sócio/matrícula/competência,
mesmo padrão de "buscar de volta o que acabou de inserir" já usado em
outros models). Nova rota escondida `/recibos/:id/imprimir` →
`src/views/ImprimirRecibo.vue` — mesmo padrão de impressão já estabelecido
em `ImprimirLivroProtocolo.vue` (chama `window.print()` sozinha ao
carregar, botão manual de reforço, `.no-print` nos botões de ação,
reaproveita o bloco `@media print` global de `App.vue`), com o valor bem
grande na tela pra ficar fácil de ler/copiar à mão. `MembershipPaymentForm.vue`
fecha o modal e navega pra essa rota logo após o pagamento ser confirmado.

Validado: `cargo check`; `npx vue-tsc -b --force` limpo; simulação SQLite
confirmando que a query de `MembershipPaymentModel.get` traz exatamente os
campos que `MembershipPaymentComDetalhes` espera.

### "Livros" vira aba própria de Documentos, separada de Protocolos ✅ concluída (2026-09-01)

Pedido do usuário: "Livros" vivia como sub-aba dentro de "Protocolos"
(`abaProtocoloAtiva`); virou uma aba de primeiro nível igual às outras
(Documentos, Protocolos, Livros, Tipos, Etiquetas, Registros), e
"Protocolos" passou a mostrar só a tabela de protocolos. Mudança
inteiramente de `Documentos.vue`: `Aba` ganhou `"livros"`, o tipo/estado
`AbaProtocolo`/`abaProtocoloAtiva` (aba aninhada) foi removido,
`atualizarSidebar()` simplificou pra um único `Record<Aba, ...>` sem
branch especial pra "protocolos" (cada aba de primeiro nível já tem sua
própria ação "Novo..."). Nenhum model/rota mudou — só a organização das
abas na tela.

Validado: `npx vue-tsc -b --force`; `cargo check`; grep confirma zero
referência residual a `abaProtocoloAtiva`/`AbaProtocolo`/`.nested-tabs`.

### Botão "Imprimir" na lista de Protocolos ✅ concluída (2026-09-01)

Pedido do usuário: poder reimprimir um recibo (ou qualquer protocolo) sem
precisar navegar até o sócio de novo. Antes de expor o botão, precisei de
um jeito confiável de saber SE um protocolo é o recibo de um pagamento de
mensalidade — a única pista que existia era comparar
`membership_payments.receipt_number` (string formatada) contra o número
do protocolo, frágil por natureza.

**Migration `version: 14`** (`liga_pagamento_ao_protocolo_do_recibo`):
`membership_payments.protocol_entry_id` (nova, `REFERENCES
protocol_entries(id)`) — FK de verdade, segura aqui porque
`protocol_entries` nunca é apagada (só cancela via `status`, mesma regra
documentada em `ProtocolEntryModel`), diferente do cenário que gerou o bug
da `version: 12` (tabela referenciada sendo derrubada). Backfill de
melhor esforço: reconstrói a string que `formatarNumeroProtocolo` geraria
(`prefixo || número || '/' || ano`) e casa contra `receipt_number` já
gravado — pagamento sem correspondência fica `NULL`, sem problema.
`MembershipPaymentModel.pagar()` agora grava esse id (já tinha `entry.id`
disponível, só não guardava). Validado com as 14 migrations rodando em
sequência + teste do backfill em simulação SQLite.

**Nova tela `src/views/ImprimirProtocolo.vue`** (rota escondida
`/protocolos/:id/imprimir`) — comprovante genérico de QUALQUER protocolo
(número, livro, tipo, direção, data, assunto, remetente/destinatário,
prazo, situação), mesmo padrão de impressão das outras telas
(`window.print()` automático, `.no-print`, `@media print` global de
`App.vue`). `Documentos.vue` ganhou `imprimirProtocolo()`: chama
`MembershipPaymentModel.buscarPorProtocolo(protocolo.id)` — se achar um
pagamento, vai pro recibo dedicado (`recibo-imprimir`, com valor/sócio já
formatados); senão, cai no comprovante genérico
(`protocolo-imprimir`). Um único botão "Imprimir" na tabela de Protocolos
cobre os dois casos sem o usuário precisar saber a diferença.

### Cabeçalho padrão de impressão, declaração, acordos, prestação de contas, sidebar e correção de dados obsoletos ✅ concluída (2026-09-02)

Lote de 9 melhorias pedidas de uma vez. Migrations novas: `version: 15`
(`people.gender`, `protocol_entries.member_id`) e `version: 16`
(`membership_agreements` + `membership_payments.membership_agreement_id`)
— ambas com FK real segura (tabelas referenciadas nunca são apagadas,
mesmo raciocínio das `version: 14`/`12`), validadas em simulação
Python/SQLite com a cadeia completa (16 migrations) + `cargo check`.

1. **`src/components/PrintHeader.vue`** (novo): cabeçalho institucional
   padrão (nome, localização do endereço principal, fundação por extenso,
   CNPJ) — `AddressModel.primaryForAssociation()` (novo) +
   `formatarDataPorExtenso()` (novo, `utils/format.ts`). Aplicado nas 3
   telas de impressão existentes (Recibo, Protocolo, Livro) e nas 3 novas
   abaixo.
2. **Declaração de associado**: `Person.gender` (M/F, flexão via novo
   `src/utils/genero.ts`), numerada como protocolo (livro tipo
   `DECLARACAO`, já pré-cadastrado em `config.rs`). `DeclaracaoForm.vue`
   bloqueia a geração se o sócio estiver inadimplente (mostra os meses em
   aberto) — decisão do usuário, já que o texto afirma quitação financeira.
   `ImprimirDeclaracao.vue` gera o texto e oferece "Vincular como
   documento" (reaproveita `DocumentUploadForm.vue`, sem geração de PDF —
   não existe lib nenhuma de PDF no projeto; usuário salva via caixa de
   impressão do SO e importa o arquivo).
3. **Acordos de renegociação** (`MembershipAgreement.ts`, novo): quita
   várias parcelas vencidas por um valor único, rateado em centavos entre
   elas (sobra de arredondamento na última), um único lançamento de caixa
   e um único recibo cobrindo o intervalo de competências. Seleção
   múltipla (checkbox) na aba Mensalidades de `SocioDetalhes.vue` + botão
   "Fazer acordo" → `MembershipAgreementForm.vue`. Reimpressão via lista de
   Protocolos checa `MembershipAgreementModel.buscarPorProtocolo` ANTES do
   recibo de pagamento comum (senão reabriria só a fatia rateada de uma
   parcela, não o valor negociado) → `ImprimirReciboAcordo.vue`.
4. **Prestação de contas** (todas as contas, por período):
   `CashTransactionModel.listarPorPeriodo()` (novo) + `SINAL_LANCAMENTO_SQL`
   extraído (evita duplicar a lógica de sinal de estorno já usada no saldo
   de conta). Aba "Relatórios" em `Financeiro.vue` → `ImprimirPrestacaoContas.vue`.
5. **Extrato de uma conta** por período: `FinancialAccountModel.extrato()`
   (novo, saldo inicial + movimentos + saldo final, reaproveita o mesmo
   `SINAL_LANCAMENTO_SQL`) → `ImprimirExtratoConta.vue`.
6. **Seletor de associação na sidebar**: `AssociationSwitcher.vue` (novo,
   montado fixo em `SidebarTools.vue`, antes dos grupos dinâmicos por rota)
   — lógica movida de `Inicio.vue` (select, "Entrar novamente", senha),
   apoiada em `useAssociationList.ts` (novo, lista compartilhada). Sai de
   `Inicio.vue` de vez (decisão do usuário — evita dois controles
   redundantes).
7. **Bug: dados obsoletos ao navegar** — corrigido com dois ajustes
   únicos: `<router-view :key="route.fullPath">` em `App.vue` (força
   remount ao trocar `:id` na mesma rota) + `useAssociationScopedData.ts`
   (novo composable: `onMounted` + `watch(currentAssociationId)`),
   aplicado no lugar de `onMounted(carregar)` em `Socios.vue`,
   `SocioDetalhes.vue`, `Cobrancas.vue`, `Financeiro.vue`, `Documentos.vue`
   e `DocumentoDetalhes.vue` — essencial depois do item 6, que tornou
   possível trocar de associação com qualquer tela aberta.
8. **Encerramento de livro de protocolo**: `ProtocolBookModel.setActive()`
   (novo, dedicado — `is_active` já existia e já era respeitado pelos
   dropdowns de numeração, só faltava a UI). Botão Encerrar/Reabrir +
   badge de situação na aba Livros de `Documentos.vue`.
9. **Abrir documento direto da lista**: `DocumentModel.list()` passou a
   trazer `current_version_storage_key` (`SELECT_COM_DETALHES`). Botão
   "Abrir" na aba Documentos de `Documentos.vue`, mesmo par de chamadas de
   `DocumentoDetalhes.vue` (`logAccess` + `abrirArquivoDocumento`).

Verificado: `cargo check`, `npx vue-tsc -b --force` e simulação Python das
16 migrations, todos limpos ao final do lote inteiro.

## Mudança pós-MVP — patrimônio e histórico de atividades ✅ concluída (2026-09-24)

Pedido do usuário, duas coisas juntas. **Migration `version: 24`**
(`patrimonio_e_historico_de_atividades`), só `CREATE TABLE`/`TRIGGER`.

**1. Patrimônio** — `assets` (bem: nº de patrimônio único por associação,
origem da aquisição `COMPRA`/`DOACAO`/`CESSAO`/`PRODUCAO_PROPRIA`/`OUTRO`,
fornecedor/doador, valor, nota/termo, local, responsável, conservação,
situação `EM_USO`/`EM_MANUTENCAO`/`EMPRESTADO`/`BAIXADO` e, quando baixado,
tipo/data/motivo/valor/destinatário da baixa — um `CHECK` amarra os campos
de baixa à situação) e `asset_events` (linha do tempo; substitui o
`asset_movements` do dicionário original, que só previa transferência e
baixa). Fluxo decidido: situação, local, responsável e conservação **não
se editam direto** — mudam só por evento (movimentação, envio/retorno de
manutenção, empréstimo/devolução, conservação, ocorrência, baixa, baixa
desfeita), cada um permitido só a partir de certas situações
(`EVENTOS_PERMITIDOS` em [Asset.ts](../src/models/Asset.ts)). Baixa exige
motivo; baixa por engano se desfaz com justificativa (evento `REATIVACAO`,
a baixa continua visível). Compra, custo de manutenção e venda podem gerar
o lançamento no caixa na hora (`source_type = 'ASSET'`,
`asset_events.cash_transaction_id`). Exclusão física só pra cadastro feito
por engano, bloqueada se algum evento gerou lançamento. Documentos (nota
fiscal, termo de doação, laudo) se vinculam pelo `document_links` já
existente (`ASSET`). Telas: [Patrimonio.vue](../src/views/Patrimonio.vue)
(`/patrimonio`) e [PatrimonioDetalhes.vue](../src/views/PatrimonioDetalhes.vue);
modais `AssetForm`, `AssetEventForm`, `AssetDisposalForm`,
`AssetReactivateForm` e o componente `CashEntryOption`. Relatório
"Balanço de patrimônio" ([ImprimirBalancoPatrimonio.vue](../src/views/ImprimirBalancoPatrimonio.vue),
rota `/patrimonio/balanco/imprimir`, botão na sidebar de Patrimônio): bens
em posse agrupados por categoria com subtotal e total do valor de
aquisição, seção opcional de bens baixados e linhas de assinatura.

**2. Histórico de atividades** — `activity_logs` (módulo, descrição
legível, `entity_type`/`entity_id` opcionais, `created_at` UTC com
milissegundos). Imutável: triggers abortam `UPDATE`/`DELETE`. Sem usuário
(o app não tem desde a `version: 9`). Gravado pelos models via
`comAtividade(acao, descrever)` ([ActivityLog.ts](../src/models/ActivityLog.ts)):
só a chamada **mais externa** registra, então uma ação composta (ex.:
pagamento de mensalidade = lançamento de caixa + protocolo do recibo +
pagamento) vira UMA linha. Falha ao gravar o histórico nunca desfaz nem
quebra a ação. Coberto: sócios (cadastro, edição, situação, dependentes,
representantes, contatos, endereços, importação por planilha — uma linha
por sócio + resumo), mensalidades (pagamento, acordo, planos), financeiro
(lançamentos, transferência, estorno, contas, categorias, centros de custo,
formas de pagamento, fornecedores/pagadores/doadores, doações, contas a
pagar/receber e baixas), documentos (cadastro, edição, situação, download,
vínculos, tipos, registros institucionais), protocolos (livros, emissão,
situação, fechamento automático de ano), patrimônio, instituição, abertura
da associação, backup exportado e troca/remoção de senha. **Fora**:
visualização de documento (continua só em `document_access_logs`),
importação de backup (o banco é substituído) e mudança de local do arquivo
(o banco é fechado antes). Tela [Atividades.vue](../src/views/Atividades.vue)
(`/atividades`), paginada **por dia** (todas as atividades do dia em ordem
cronológica; "Dia anterior"/"Próximo dia" pulam direto pro dia mais
próximo com atividade — `ActivityLogModel.diaVizinho` —, abrindo em hoje
ou no último dia com registro), filtro por módulo/texto, link pra ficha do
sócio/documento/bem e impressão do dia com o cabeçalho da associação.

**Regra daqui pra frente:** todo método novo de escrita em
`src/models/*.ts` deve passar por `comAtividade` (ver
`.claude/rules/database.md`).

Validado: `npx vue-tsc -b --force` limpo, `cargo check`, e as 24
migrations aplicadas em sequência num SQLite in-memory com
`PRAGMA foreign_keys = ON` (`CHECK` de baixa incompleta e de data de baixa
anterior à aquisição, `UNIQUE` do nº de patrimônio, FK impedindo apagar
lançamento ligado a evento, cascade dos eventos ao excluir o bem, triggers
bloqueando alteração/exclusão do histórico, filtro por data local).

## Mudança pós-MVP — papel de impressão configurável e revisão das impressões ✅ concluída (2026-09-24)

**Configuração:** `AppConfig.print` (`PrintConfig { default_paper, receipt_paper }`)
em [config.rs](../src-tauri/src/config.rs), com `#[serde(default)]` — um
`config.json` antigo continua sendo lido como formato atual (A4 nos dois).
É preferência da instalação (impressora/papel da máquina), não da
associação, por isso fica no `config.json` e não no banco. Comandos
`get_print_config`/`set_print_config` (validam os códigos). Papel padrão:
A4, Carta, Ofício — relatórios, listas, livro de protocolo, extrato,
prestação de contas, declaração, balanço de patrimônio, aptos a votar e
atividades. Papel de recibo: A4, A5, Carta e bobina de impressora térmica 58 mm
/ 80 mm (`TERMICA_58`/`TERMICA_80`) — recibo de mensalidade, recibo de
acordo e comprovante de protocolo. Bobina: como `@page` não tem papel de
altura contínua, o recibo (`.documento-recibo`) é desenhado na largura da
bobina já na tela (área útil 48/72 mm, letra 8/9,5 pt, rótulos acima dos
valores — CSS global em `App.vue`) e `imprimir()` mede a altura dele pra
criar uma página do tamanho exato (sem puxar papel em branco). Validado em
PDF: 58 × 106 mm e 80 × 116 mm, uma página cada, nada fora da largura. Tela: seção "Impressão" em
[Configuracoes.vue](../src/views/Configuracoes.vue).

**Aplicação:** [usePaginaImpressao.ts](../src/composables/usePaginaImpressao.ts)
injeta `@page { size; margin }` no `<head>` enquanto a tela de impressão
está montada (`@page` não funciona em `<style scoped>`) e devolve
`imprimir()`, que espera o papel estar aplicado antes do `window.print()`.

**Por que vazava do A4:** `.app-shell` tem `width: 100vw` e o CSS de
impressão só desfazia a altura — no papel, a página tinha a largura da
JANELA (ex.: 1600px). Corrigido no `@media print` global do `App.vue`,
que também: força as cores do tema claro no papel (no modo escuro o texto
saía claro), quebra texto livre sem espaço dentro da célula
(`overflow-wrap: anywhere`) com colunas curtas protegidas por
`.nao-quebrar`, repete o cabeçalho de tabela em cada folha e não parte
linha entre páginas. Declaração perde a moldura de tela no papel (ocupa a
página); recibos/comprovante mantêm a moldura, sem largura fixa e sem
dividir em duas folhas (cabe em A5).

Validado: `npx vue-tsc -b --force`, `cargo check`, e PDFs gerados com o
Chrome headless numa janela de 1600px reproduzindo a casca do app: antes,
o navegador encolhia a página inteira pra caber (em Carta); depois, A4 com
tabela de livro de protocolo dentro da margem (inclusive com nome de
arquivo sem espaços) e recibo inteiro numa folha A5.

## Mudança pós-MVP — lista de sócios impressa ✅ concluída (2026-09-25)

Botão "Imprimir lista" na sidebar de [Socios.vue](../src/views/Socios.vue)
→ modal [ListaSociosPrintForm.vue](../src/modals/ListaSociosPrintForm.vue)
(situação — padrão "Ativo", ou todas — e ordem por nome/matrícula) →
[ImprimirListaSocios.vue](../src/views/ImprimirListaSocios.vue)
(`/socios/lista/imprimir?situacao=&ordem=`, filtros também trocáveis na
barra de ações). Cada sócio ocupa duas linhas (um `<tbody>` por sócio, que
não se parte entre folhas): matrícula e nome; data de associação, CPF, RG
e nascimento, cada campo com rótulo. Dados via
`MemberModel.listarParaImpressao` (sem a foto). Rótulos de situação
centralizados em [situacaoSocio.ts](../src/utils/situacaoSocio.ts).
Validado em PDF A4 (Chrome headless, CSS real): ~11 sócios por folha.

## Fase 2 (bloco resumido, pós-MVP)

Cada item vira sua própria migration (`version: 14, 15, ...`), model e view:
- **Governança** (`meetings`, `board_terms`, `committees`, ...) — depende
  de Sócios (2) e Documentos (7).
- **Projetos** (`projects`, `project_expenses`, ...) — depende de
  Financeiro (3) e Contas a Pagar (5).
- ~~**Patrimônio** (`assets`, `asset_movements`)~~ ✅ concluído em
  2026-09-24 (`assets` + `asset_events`, ver seção própria acima).
- **Atendimento comunitário** (`service_cases`, ...) — só após Permissões
  (8) estar sólida (confidencialidade reforçada).
- **Eventos** (`events`, `event_registrations`) — depende de Sócios e,
  para cobrança, de Financeiro.

## Fase 3 (bloco resumido, pós-Fase 2)

- **Comunicação**: `notifications` já existe desde a Etapa 8; resto é UI
  sobre tabelas novas simples.
- **Indicadores/dashboards**: leitura agregada sobre tabelas existentes,
  sem migration nova esperada.

## Verificação de cada etapa

`npm run type-check` (compila) + `npm run tauri dev` (migration nova roda
sem erro no primeiro start) + teste manual de CRUD completo na tela nova,
contra um banco de desenvolvimento (não o de produção). Sem suíte
automatizada no projeto hoje.

## Pendências a resolver no início de cada etapa específica (não bloqueiam
## o plano, só a implementação daquela etapa)

- Etapa 6: suporte a `UPDATE ... RETURNING`.
- Etapa 7: `@tauri-apps/plugin-fs` vs. comandos Rust dedicados.
- Etapa 8: gate de login real ou não; Argon2id vs. PBKDF2.
- Etapa 4 (ou quando a aritmética de datas exigir): adicionar `date-fns`.
