use std::fs;
use std::path::Path;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

mod backup;
mod config;
mod documents;
mod files;
mod password;
mod photos;

// Migrations são append-only (ver .claude/rules/database.md): nunca editar
// uma já existente, toda mudança de schema é uma nova entrada com
// `version` incrementado. Extraído para uma função (em vez de um `let`
// dentro de `run()`) porque agora precisa ser registrado uma vez PARA CADA
// associação conhecida no `config.json` (ver nota em `run()`), não uma
// única vez — `tauri_plugin_sql::Migration` não implementa `Clone`, então
// reconstruir a lista a cada chamada evita esse problema.
fn all_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "cria_institucional",
        // Etapa 1 do módulo de associações (ver docs/plano-implementacao.md):
        // cadastro da associação e endereços reutilizáveis. `addresses.person_id`
        // referencia `people(id)`, criada só na Etapa 2 — SQLite não valida a
        // tabela referenciada no momento do CREATE TABLE, então isso é seguro.
        sql: "
            CREATE TABLE associations (
                id TEXT PRIMARY KEY,
                legal_name TEXT NOT NULL,
                trade_name TEXT,
                cnpj TEXT,
                foundation_date TEXT,
                status TEXT NOT NULL DEFAULT 'ATIVA'
                    CHECK (status IN ('ATIVA', 'INATIVA', 'ENCERRADA')),
                email TEXT,
                phone TEXT,
                website TEXT,
                settings TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TRIGGER trg_associations_updated_at
            AFTER UPDATE ON associations
            BEGIN
                UPDATE associations SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE TABLE addresses (
                id TEXT PRIMARY KEY,
                association_id TEXT REFERENCES associations(id),
                person_id TEXT REFERENCES people(id),
                address_type TEXT NOT NULL DEFAULT 'RESIDENCIAL',
                street TEXT NOT NULL,
                number TEXT,
                complement TEXT,
                district TEXT,
                city TEXT NOT NULL,
                state TEXT NOT NULL,
                country TEXT NOT NULL DEFAULT 'Brasil',
                zip_code TEXT,
                is_primary INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (association_id IS NOT NULL OR person_id IS NOT NULL)
            );

            CREATE INDEX idx_addresses_association ON addresses(association_id);
            CREATE INDEX idx_addresses_person ON addresses(person_id);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "cria_socios",
        // Etapa 2 do módulo de associações: pessoas físicas e o vínculo
        // associativo (sócio), com histórico de situação, dependentes e
        // representantes.
        //
        // `members.membership_plan_id` é `TEXT` solto, SEM `REFERENCES`:
        // `membership_plans` só é criada na Etapa 4 (Mensalidades), e o
        // `sqlx-sqlite` usado por este plugin liga `PRAGMA foreign_keys = ON`
        // por padrão — uma FK para uma tabela que ainda não existe quebra
        // qualquer insert/update na tabela, mesmo com valor NULL. (Isso é
        // diferente de `addresses.person_id REFERENCES people(id)` na
        // migration anterior: `people` é criada logo abaixo, na mesma leva de
        // migrations que roda antes de qualquer INSERT em `addresses`.) A
        // validação do vínculo fica por conta da aplicação até lá.
        sql: "
            CREATE TABLE people (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                birth_date TEXT,
                nationality TEXT NOT NULL DEFAULT 'Brasileira',
                marital_status TEXT,
                cpf TEXT,
                rg TEXT,
                profession TEXT,
                mother_name TEXT,
                father_name TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (cpf)
            );

            CREATE TRIGGER trg_people_updated_at
            AFTER UPDATE ON people
            BEGIN
                UPDATE people SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE TABLE person_contacts (
                id TEXT PRIMARY KEY,
                person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                contact_type TEXT NOT NULL
                    CHECK (contact_type IN ('TELEFONE', 'CELULAR', 'EMAIL', 'OUTRO')),
                contact_value TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                is_verified INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_person_contacts_person ON person_contacts(person_id);

            CREATE TABLE members (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                person_id TEXT NOT NULL REFERENCES people(id),
                registration_number TEXT NOT NULL,
                association_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDENTE'
                    CHECK (status IN ('PENDENTE', 'ATIVO', 'INATIVO', 'SUSPENSO', 'DESLIGADO', 'FALECIDO')),
                exit_date TEXT,
                exit_reason TEXT,
                membership_plan_id TEXT,
                observations TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, registration_number),
                UNIQUE (association_id, person_id),
                CHECK (exit_date IS NULL OR exit_date >= association_date)
            );

            CREATE TRIGGER trg_members_updated_at
            AFTER UPDATE ON members
            BEGIN
                UPDATE members SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE INDEX idx_members_status ON members(association_id, status);

            CREATE TABLE member_dependents (
                id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                dependent_person_id TEXT REFERENCES people(id),
                dependent_name TEXT,
                relationship TEXT NOT NULL,
                is_financial_dependent INTEGER NOT NULL DEFAULT 0,
                birth_date TEXT,
                observations TEXT,
                CHECK (dependent_person_id IS NOT NULL OR dependent_name IS NOT NULL)
            );

            CREATE INDEX idx_member_dependents_member ON member_dependents(member_id);

            CREATE TABLE member_representatives (
                id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                person_id TEXT NOT NULL REFERENCES people(id),
                relationship TEXT NOT NULL,
                start_date TEXT,
                end_date TEXT
            );

            CREATE INDEX idx_member_representatives_member ON member_representatives(member_id);

            CREATE TABLE member_status_history (
                id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                old_status TEXT,
                new_status TEXT NOT NULL,
                effective_date TEXT NOT NULL,
                reason TEXT,
                changed_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_member_status_history_member ON member_status_history(member_id);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 3,
        description: "cria_financeiro",
        // Etapa 3 do módulo de associações: contas financeiras, plano de
        // contas, centros de custo, formas de pagamento e o fluxo de caixa
        // propriamente dito. Valores monetários são `INTEGER` em centavos
        // (ver docs/plano-implementacao.md, convenção da Etapa 0) — nunca
        // `REAL`, para não sofrer com imprecisão de ponto flutuante em somas
        // de lançamentos. Saldo de conta NÃO é persistido: é sempre calculado
        // sob demanda a partir de `cash_transactions` (ver `FinancialAccountModel`),
        // para nunca divergir do que os lançamentos realmente somam.
        //
        // `payees`/`payers` são criadas aqui (junto do resto do módulo
        // financeiro, como no dicionário de dados original), mas o model e a
        // tela só chegam na Etapa 5 (Contas a pagar/receber), quando de fato
        // são referenciadas. `person_id`/`address_id` neles referenciam
        // `people`/`addresses`, ambas já criadas nas migrations 1 e 2 — sem o
        // problema de referência futura corrigido nesta migration anterior.
        sql: "
            CREATE TABLE financial_accounts (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                account_type TEXT NOT NULL,
                bank_name TEXT,
                agency TEXT,
                account_number_masked TEXT,
                opening_balance INTEGER NOT NULL DEFAULT 0,
                opening_date TEXT NOT NULL DEFAULT (date('now')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, name)
            );

            CREATE TRIGGER trg_financial_accounts_updated_at
            AFTER UPDATE ON financial_accounts
            BEGIN
                UPDATE financial_accounts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE TABLE financial_categories (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                parent_id TEXT REFERENCES financial_categories(id),
                code TEXT,
                name TEXT NOT NULL,
                category_type TEXT NOT NULL CHECK (category_type IN ('RECEITA', 'DESPESA', 'TRANSFERENCIA')),
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE (association_id, name),
                UNIQUE (association_id, code)
            );

            CREATE TABLE cost_centers (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                code TEXT,
                name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE (association_id, name)
            );

            CREATE TABLE payment_methods (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                method_type TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE (association_id, name)
            );

            CREATE TABLE payees (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                document_number TEXT,
                person_id TEXT REFERENCES people(id),
                email TEXT,
                phone TEXT,
                address_id TEXT REFERENCES addresses(id),
                is_active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE payers (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                document_number TEXT,
                person_id TEXT REFERENCES people(id),
                email TEXT,
                phone TEXT
            );

            CREATE TABLE cash_transactions (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                financial_account_id TEXT NOT NULL REFERENCES financial_accounts(id),
                transaction_type TEXT NOT NULL
                    CHECK (transaction_type IN ('RECEITA', 'DESPESA', 'TRANSFERENCIA_ENTRADA', 'TRANSFERENCIA_SAIDA', 'ESTORNO')),
                amount INTEGER NOT NULL CHECK (amount > 0),
                transaction_date TEXT NOT NULL,
                competence_date TEXT NOT NULL,
                description TEXT NOT NULL,
                financial_category_id TEXT REFERENCES financial_categories(id),
                cost_center_id TEXT REFERENCES cost_centers(id),
                payment_method_id TEXT REFERENCES payment_methods(id),
                source_type TEXT,
                source_id TEXT,
                transfer_group_id TEXT,
                status TEXT NOT NULL DEFAULT 'CONFIRMADA'
                    CHECK (status IN ('PENDENTE', 'CONFIRMADA', 'ESTORNADA', 'CANCELADA')),
                document_id TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_transactions_account ON cash_transactions(financial_account_id, transaction_date DESC);
            CREATE INDEX idx_transactions_date ON cash_transactions(association_id, transaction_date);
            CREATE INDEX idx_transactions_category ON cash_transactions(association_id, financial_category_id, transaction_date);
            CREATE INDEX idx_transactions_transfer_group ON cash_transactions(transfer_group_id);

            CREATE TABLE cash_transaction_reversals (
                id TEXT PRIMARY KEY,
                original_transaction_id TEXT NOT NULL REFERENCES cash_transactions(id),
                reversal_transaction_id TEXT NOT NULL REFERENCES cash_transactions(id),
                reason TEXT,
                reversed_by TEXT,
                reversed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (original_transaction_id),
                UNIQUE (reversal_transaction_id)
            );
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 4,
        description: "cria_contas_a_pagar_e_receber",
        // Etapa 5 do plano (docs/plano-implementacao.md) — implementada antes
        // da Etapa 4 (Mensalidades) a pedido do usuário. Não há dependência
        // real entre elas: `receivables.member_id` referencia `members`
        // (Etapa 2) diretamente, sem precisar de `membership_charges`.
        //
        // `payables.project_id`/`document_id` e `receivables.document_id`
        // ficam `TEXT` soltos, sem `REFERENCES`: `projects` (Fase 2) e
        // `documents` (Etapa 7) ainda não existem, e uma FK para tabela
        // futura quebra qualquer insert (ver nota da migration `version: 2`).
        // `payee_id`, `payer_id`, `member_id`, `financial_category_id`,
        // `cost_center_id` e `cash_transaction_id` são seguros: todas essas
        // tabelas já existem desde migrations anteriores.
        //
        // O dicionário de dados original (seção 5) não define um ENUM de
        // status para `payables`/`receivables` (só para `membership_charges`).
        // Os valores abaixo foram escolhidos seguindo o mesmo espírito.
        //
        // `payees` e `payers` NÃO são recriadas aqui: já existem desde a
        // migration `version: 3` (Etapa 3) — só ficaram sem model/tela até
        // agora, que é quando passam a ser usadas de fato.
        sql: "
            CREATE TABLE payables (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                payee_id TEXT REFERENCES payees(id),
                description TEXT NOT NULL,
                document_number TEXT,
                issue_date TEXT,
                total_amount INTEGER NOT NULL CHECK (total_amount > 0),
                financial_category_id TEXT REFERENCES financial_categories(id),
                cost_center_id TEXT REFERENCES cost_centers(id),
                status TEXT NOT NULL DEFAULT 'ABERTA'
                    CHECK (status IN ('ABERTA', 'APROVACAO_PENDENTE', 'PARCIAL', 'PAGA', 'CANCELADA')),
                project_id TEXT,
                document_id TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_payables_status ON payables(association_id, status);

            CREATE TABLE payable_installments (
                id TEXT PRIMARY KEY,
                payable_id TEXT NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
                installment_number INTEGER NOT NULL CHECK (installment_number > 0),
                due_date TEXT NOT NULL,
                original_amount INTEGER NOT NULL CHECK (original_amount > 0),
                discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
                interest_amount INTEGER NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
                paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
                status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'PARCIAL', 'PAGA', 'CANCELADA')),
                paid_at TEXT,
                UNIQUE (payable_id, installment_number)
            );

            CREATE INDEX idx_payable_installments_due_date ON payable_installments(due_date, status);

            CREATE TABLE payable_payments (
                id TEXT PRIMARY KEY,
                payable_installment_id TEXT NOT NULL REFERENCES payable_installments(id),
                cash_transaction_id TEXT NOT NULL REFERENCES cash_transactions(id),
                amount INTEGER NOT NULL CHECK (amount > 0),
                paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (cash_transaction_id)
            );

            CREATE TABLE receivables (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                payer_id TEXT REFERENCES payers(id),
                member_id TEXT REFERENCES members(id),
                description TEXT NOT NULL,
                source_type TEXT,
                total_amount INTEGER NOT NULL CHECK (total_amount > 0),
                financial_category_id TEXT REFERENCES financial_categories(id),
                cost_center_id TEXT REFERENCES cost_centers(id),
                status TEXT NOT NULL DEFAULT 'ABERTA'
                    CHECK (status IN ('ABERTA', 'PARCIAL', 'RECEBIDA', 'CANCELADA')),
                document_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_receivables_status ON receivables(association_id, status);

            CREATE TABLE receivable_installments (
                id TEXT PRIMARY KEY,
                receivable_id TEXT NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
                installment_number INTEGER NOT NULL CHECK (installment_number > 0),
                due_date TEXT NOT NULL,
                original_amount INTEGER NOT NULL CHECK (original_amount > 0),
                discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
                interest_amount INTEGER NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
                received_amount INTEGER NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
                status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'PARCIAL', 'RECEBIDA', 'CANCELADA')),
                received_at TEXT,
                UNIQUE (receivable_id, installment_number)
            );

            CREATE INDEX idx_receivable_installments_due_date ON receivable_installments(due_date, status);

            CREATE TABLE receivable_payments (
                id TEXT PRIMARY KEY,
                receivable_installment_id TEXT NOT NULL REFERENCES receivable_installments(id),
                cash_transaction_id TEXT NOT NULL REFERENCES cash_transactions(id),
                amount INTEGER NOT NULL CHECK (amount > 0),
                received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (cash_transaction_id)
            );

            CREATE TABLE donors (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                document_number TEXT,
                person_id TEXT REFERENCES people(id),
                contact_data TEXT,
                notes TEXT
            );

            CREATE TABLE donations (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                donor_id TEXT REFERENCES donors(id),
                amount INTEGER NOT NULL CHECK (amount > 0),
                donation_date TEXT NOT NULL,
                donation_type TEXT,
                purpose TEXT,
                cash_transaction_id TEXT REFERENCES cash_transactions(id),
                document_id TEXT
            );

            CREATE INDEX idx_donations_donor ON donations(donor_id);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 5,
        description: "cria_mensalidades",
        // Etapa 4 do plano (docs/plano-implementacao.md) — implementada
        // depois da Etapa 5 (Contas a pagar/receber), a pedido do usuário.
        //
        // `membership_charges.membership_plan_id` referencia
        // `membership_plans`, criada logo acima NESTA MESMA migration —
        // seguro. Já `members.membership_plan_id` (coluna criada lá na
        // migration `version: 2`, antes de `membership_plans` existir) NÃO
        // ganha uma FK retroativa aqui: SQLite não permite adicionar
        // `REFERENCES` a uma coluna existente sem recriar a tabela inteira.
        // Reconfirmado na `version: 10` (reestruturação de mensalidades) que
        // isso é definitivo, não só "para o MVP": o rebuild de `members`
        // puxaria em cadeia outras 12 tabelas dependentes numa transação só
        // (ver comentário da `version: 10`). Continua sendo um vínculo
        // solto, validado em código (mesmo espírito de `source_type`/
        // `source_id`), e a obrigatoriedade do plano passou a ser imposta
        // só na aplicação (`MemberModel`/`MemberForm`).
        sql: "
            CREATE TABLE membership_plans (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                description TEXT,
                amount INTEGER NOT NULL CHECK (amount >= 0),
                frequency TEXT NOT NULL DEFAULT 'MENSAL',
                due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, name)
            );

            CREATE TRIGGER trg_membership_plans_updated_at
            AFTER UPDATE ON membership_plans
            BEGIN
                UPDATE membership_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE TABLE member_plan_history (
                id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                membership_plan_id TEXT NOT NULL REFERENCES membership_plans(id),
                start_date TEXT NOT NULL,
                end_date TEXT,
                custom_amount INTEGER,
                reason TEXT
            );

            CREATE TABLE membership_charges (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                member_id TEXT NOT NULL REFERENCES members(id),
                membership_plan_id TEXT REFERENCES membership_plans(id),
                charge_type TEXT NOT NULL DEFAULT 'MENSALIDADE'
                    CHECK (charge_type IN ('MENSALIDADE', 'EXTRAORDINARIA', 'EVENTO', 'ACORDO')),
                competence_month TEXT NOT NULL,
                due_date TEXT NOT NULL,
                principal_amount INTEGER NOT NULL CHECK (principal_amount >= 0),
                discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
                interest_amount INTEGER NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
                penalty_amount INTEGER NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
                total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
                status TEXT NOT NULL DEFAULT 'ABERTA'
                    CHECK (status IN ('ABERTA', 'PARCIAL', 'PAGA', 'VENCIDA', 'CANCELADA', 'ISENTA')),
                paid_at TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, member_id, charge_type, competence_month)
            );

            CREATE TRIGGER trg_membership_charges_updated_at
            AFTER UPDATE ON membership_charges
            BEGIN
                UPDATE membership_charges SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE INDEX idx_charges_due_status ON membership_charges(association_id, due_date, status);
            CREATE INDEX idx_charges_member ON membership_charges(member_id, competence_month DESC);

            CREATE TABLE charge_adjustments (
                id TEXT PRIMARY KEY,
                charge_id TEXT NOT NULL REFERENCES membership_charges(id) ON DELETE CASCADE,
                adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('DESCONTO', 'JUROS', 'MULTA', 'OUTRO')),
                description TEXT,
                amount INTEGER NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE charge_payments (
                id TEXT PRIMARY KEY,
                charge_id TEXT NOT NULL REFERENCES membership_charges(id),
                cash_transaction_id TEXT NOT NULL REFERENCES cash_transactions(id),
                paid_amount INTEGER NOT NULL CHECK (paid_amount > 0),
                paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payment_method TEXT,
                receipt_number TEXT,
                UNIQUE (cash_transaction_id)
            );

            CREATE TABLE member_exemptions (
                id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                start_month TEXT NOT NULL,
                end_month TEXT,
                reason TEXT,
                approved_by TEXT,
                document_id TEXT
            );
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 6,
        description: "cria_protocolos",
        // Etapa 6 do plano: numeração controlada de ofícios/documentos
        // recebidos e expedidos.
        //
        // Simplificação em relação ao dicionário de dados original: o
        // documento pede uma tabela `protocol_sequences` separada (`id`,
        // `protocol_book_id`, `year`, `last_number`) além do `next_number`
        // já presente em `protocol_books`, pensada para concorrência segura
        // em Postgres multiusuário. Aqui usamos só `protocol_books.next_number`
        // como contador atômico via `UPDATE ... RETURNING` (SQLite ≥ 3.35,
        // confirmado na versão empacotada por este projeto) — SQLite já é
        // single-writer por arquivo, então uma segunda tabela de sequência
        // só duplicaria o estado sem reduzir risco real de concorrência.
        // `protocol_books` já é única por (association_id, protocol_type, year),
        // então cada linha já é, na prática, uma sequência isolada.
        //
        // `responsible_user_id` (users, Etapa 8) e `document_id` (documents,
        // Etapa 7) ficam `TEXT` soltos, sem `REFERENCES` — mesma regra das
        // migrations anteriores para tabelas de etapas futuras.
        sql: "
            CREATE TABLE protocol_books (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                protocol_type TEXT NOT NULL,
                year INTEGER NOT NULL,
                prefix TEXT,
                next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE (association_id, protocol_type, year)
            );

            CREATE TABLE protocol_entries (
                id TEXT PRIMARY KEY,
                protocol_book_id TEXT NOT NULL REFERENCES protocol_books(id),
                number INTEGER NOT NULL CHECK (number > 0),
                year INTEGER NOT NULL,
                direction TEXT NOT NULL CHECK (direction IN ('RECEBIDO', 'EXPEDIDO', 'INTERNO')),
                document_type TEXT NOT NULL,
                protocol_date TEXT NOT NULL,
                sender_name TEXT,
                recipient_name TEXT,
                subject TEXT NOT NULL,
                responsible_user_id TEXT,
                deadline TEXT,
                status TEXT NOT NULL DEFAULT 'ABERTO'
                    CHECK (status IN ('ABERTO', 'EM_ANDAMENTO', 'RESPONDIDO', 'ENCERRADO', 'CANCELADO')),
                response_protocol_id TEXT REFERENCES protocol_entries(id),
                document_id TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (protocol_book_id, number)
            );

            CREATE INDEX idx_protocol_entries_date ON protocol_entries(protocol_book_id, protocol_date DESC);
            CREATE INDEX idx_protocol_entries_status ON protocol_entries(status, deadline);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 7,
        description: "cria_documentos",
        // Etapa 7 do plano: metadados de documentos ficam no banco; o
        // arquivo em si vive fora do SQLite, numa pasta gerenciada pelo app
        // (ver `documents.rs` — comandos Rust dedicados fazem a cópia e
        // calculam tamanho/tipo/hash, em vez de somar `@tauri-apps/
        // plugin-fs` ao frontend).
        //
        // `documents.current_version_id` referencia `document_versions`,
        // criada logo abaixo NESTA MESMA migration — seguro, mesma regra já
        // usada entre `associations`/`addresses` na migration `version: 1`
        // (SQLite não valida a tabela referenciada no momento do
        // `CREATE TABLE`, só quando a FK é de fato usada por um INSERT/UPDATE).
        //
        // `owner_user_id`, `uploaded_by`, `responsible_user_id` e `user_id`
        // (users, Etapa 8) ficam `TEXT` soltos, sem `REFERENCES` — mesma
        // regra das migrations anteriores para tabelas de etapas futuras.
        //
        // Duas simplificações em relação ao dicionário de dados original:
        // (a) `document_access_logs.ip_address` foi removida — este é um
        // app desktop local de usuário único, não uma aplicação web onde um
        // IP de origem faz sentido registrar; (b) `records` (registros
        // institucionais genéricos) é a tabela mais rasa de todo o
        // documento-fonte — nem chega a aparecer na seção de DDL dele, só
        // na tabela-resumo — então foi implementada com o mínimo descrito
        // ali, sem inventar campos extras.
        sql: "
            CREATE TABLE document_types (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                retention_period_months INTEGER,
                requires_expiration INTEGER NOT NULL DEFAULT 0,
                is_confidential INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                UNIQUE (association_id, name)
            );

            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                document_type_id TEXT REFERENCES document_types(id),
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'ATIVO'
                    CHECK (status IN ('ATIVO', 'ARQUIVADO', 'CANCELADO')),
                confidentiality TEXT NOT NULL DEFAULT 'INTERNO'
                    CHECK (confidentiality IN ('PUBLICO', 'INTERNO', 'RESTRITO', 'CONFIDENCIAL')),
                document_date TEXT,
                expiration_date TEXT,
                owner_user_id TEXT,
                current_version_id TEXT REFERENCES document_versions(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TRIGGER trg_documents_updated_at
            AFTER UPDATE ON documents
            BEGIN
                UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE INDEX idx_documents_type ON documents(association_id, document_type_id);
            CREATE INDEX idx_documents_status ON documents(association_id, status);

            CREATE TABLE document_versions (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                version_number INTEGER NOT NULL CHECK (version_number > 0),
                storage_key TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                file_size INTEGER NOT NULL CHECK (file_size >= 0),
                checksum_sha256 TEXT NOT NULL,
                uploaded_by TEXT,
                uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                change_note TEXT,
                UNIQUE (document_id, version_number),
                UNIQUE (document_id, checksum_sha256)
            );

            CREATE INDEX idx_document_versions_document ON document_versions(document_id, version_number DESC);

            CREATE TABLE document_links (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                link_role TEXT NOT NULL DEFAULT 'ANEXO',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (document_id, entity_type, entity_id, link_role)
            );

            CREATE INDEX idx_document_links_entity ON document_links(entity_type, entity_id);

            CREATE TABLE document_tags (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                color TEXT,
                UNIQUE (association_id, name)
            );

            CREATE TABLE document_tag_links (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES document_tags(id) ON DELETE CASCADE,
                PRIMARY KEY (document_id, tag_id)
            );

            CREATE TABLE document_access_logs (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                user_id TEXT,
                action TEXT NOT NULL
                    CHECK (action IN ('VISUALIZOU', 'BAIXOU', 'EDITOU_METADADOS', 'CRIOU_VERSAO')),
                accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_document_access_logs_document ON document_access_logs(document_id, accessed_at DESC);

            CREATE TABLE records (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                record_type TEXT NOT NULL,
                reference_number TEXT,
                record_date TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'ATIVO'
                    CHECK (status IN ('ATIVO', 'ARQUIVADO', 'CANCELADO')),
                responsible_user_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_records_type ON records(association_id, record_type);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 8,
        description: "cria_usuarios_permissoes_auditoria",
        // Etapa 8 do plano — fecha o MVP. Decisão tomada no início da etapa
        // (item que o plano deixava em aberto): SEM gate de login. O app
        // continua desktop local mono-instância, sem tela de autenticação;
        // `users` existe só para *atribuir responsabilidade* a registros
        // (quem lançou, quem aprovou, quem alterou uma permissão), com o
        // "usuário atual" escolhido manualmente pelo operador num seletor no
        // topo da tela (`useCurrentUser.ts`, persistido em `localStorage` —
        // não é sessão autenticada, é só rótulo de autoria). Por isso
        // `users` não tem coluna de senha nem de login externo
        // (`external_subject`/`last_login_at` do dicionário de dados
        // original foram omitidas — não têm uso sem um fluxo de login real).
        //
        // `audit_logs.user_id` É uma FK de verdade para `users(id)` (criada
        // logo acima, nesta mesma migration) — diferente das colunas soltas
        // de etapas anteriores (`protocol_entries.responsible_user_id`,
        // `documents.owner_user_id`, `document_versions.uploaded_by`,
        // `cash_transactions.created_by`, `member_status_history.changed_by`
        // etc.), que continuam TEXT sem `REFERENCES`: SQLite não permite
        // adicionar uma FK a uma coluna já existente sem recriar a tabela
        // inteira (mesma regra já aplicada a `members.membership_plan_id` na
        // migration `version: 5`), e isso não se justifica para o MVP. Essas
        // colunas passam a ser preenchidas com `getCurrentUserId()` a partir
        // de agora nos fluxos considerados sensíveis (financeiro, sócio,
        // permissão — ver `docs/dominio-associacoes.md`, seção 6, regra de
        // "Auditoria"), mas continuam validadas só em código.
        //
        // `before_data`/`after_data` de `audit_logs` são `TEXT` (JSON
        // serializado manualmente, mesma convenção de `associations.settings`)
        // em vez de um tipo JSONB nativo, que o SQLite não tem.
        //
        // `document_access_logs.ip_address`/`user_agent` do dicionário
        // original também não entram aqui — mesma razão já registrada na
        // migration `version: 7`: app desktop local, sem requisição de rede
        // por trás de cada acesso.
        //
        // LIMITAÇÃO CONHECIDA (registrada depois, quando o app passou a
        // suportar várias associações por arquivo — ver
        // `docs/plano-implementacao.md`): `users.email` é `UNIQUE` GLOBAL,
        // não `UNIQUE(association_id, email)` — na época desta migration só
        // existia uma associação por arquivo, então não fazia diferença.
        // Corrigir isso exigiria reconstruir `users` (SQLite não altera
        // constraint de tabela existente) e, por causa do `PRAGMA
        // foreign_keys = ON` mais a migration inteira rodar dentro de uma
        // transação (sqlx faz isso — `PRAGMA foreign_keys` não tem efeito
        // dentro de uma transação já aberta), também reconstruir em cadeia
        // `audit_logs`, `notifications` e `user_roles` (todas têm FK para
        // `users`). Risco/esforço não compensam corrigir agora: na prática
        // só afetaria duas associações distintas tentando cadastrar o
        // mesmo e-mail como "usuário" de atribuição — falha de forma clara
        // (erro de `UNIQUE constraint failed` no cadastro), não corrompe
        // nada silenciosamente.
        sql: "
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                person_id TEXT REFERENCES people(id),
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO', 'INATIVO')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (email)
            );

            CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                description TEXT,
                is_system_role INTEGER NOT NULL DEFAULT 0,
                UNIQUE (association_id, name)
            );

            CREATE TABLE permissions (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL,
                module TEXT NOT NULL
            );

            CREATE TABLE role_permissions (
                role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
                PRIMARY KEY (role_id, permission_id)
            );

            CREATE TABLE user_roles (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, role_id)
            );

            CREATE TABLE audit_logs (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                user_id TEXT REFERENCES users(id),
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                before_data TEXT,
                after_data TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
            CREATE INDEX idx_audit_association ON audit_logs(association_id, created_at DESC);

            CREATE TABLE notifications (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                user_id TEXT REFERENCES users(id),
                notification_type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT,
                read_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

            CREATE TABLE system_settings (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                is_secret INTEGER NOT NULL DEFAULT 0,
                UNIQUE (association_id, key)
            );
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 9,
        description: "remove_usuarios_permissoes_auditoria",
        // Correção pós-MVP (ver docs/plano-implementacao.md): o app deixou
        // de ter usuários — sem usuário não há a quem atribuir um perfil
        // nem autoria de auditoria, então perfis/permissões/auditoria da
        // Etapa 8 saem junto. `DROP TABLE` em cadeia, dependentes antes das
        // tabelas referenciadas (testado num SQLite in-memory com `PRAGMA
        // foreign_keys = ON` dentro de uma transação só, igual ao sqlx faz
        // ao aplicar uma migration — funciona nessa ordem):
        // `user_roles`/`role_permissions` primeiro (nada mais referencia
        // essas duas), depois `notifications`/`audit_logs` (referenciavam
        // `users`, e nada referencia elas), só então `roles`/`users`/
        // `permissions` (agora sem nada apontando para eles).
        //
        // As colunas soltas que apontavam para `users` sem FK real
        // (`cash_transactions.created_by`, `member_status_history.
        // changed_by`, `protocol_entries.responsible_user_id`,
        // `documents.owner_user_id`, `document_versions.uploaded_by`,
        // `records.responsible_user_id`) não precisam de migration: nunca
        // tiveram `REFERENCES`, continuam existindo, só que para sempre
        // `NULL` a partir de agora — mudar isso exigiria recriar todas
        // essas tabelas, e não há ganho nenhum em fazer isso.
        sql: "
            DROP TABLE user_roles;
            DROP TABLE role_permissions;
            DROP TABLE notifications;
            DROP TABLE audit_logs;
            DROP TABLE roles;
            DROP TABLE users;
            DROP TABLE permissions;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 10,
        description: "cria_parcelas_e_voto_do_plano",
        // Reestruturação do fluxo de mensalidades (ver
        // docs/plano-implementacao.md): `parcelas` é um calendário de
        // competências (1 linha por mês/ano, SEM sócio) — cada
        // `membership_charges` passa a apontar pra uma delas via
        // `parcela_id`, além de continuar guardando `competence_month`
        // solto (não removido, ainda usado direto em filtros/exibição).
        //
        // `membership_plan_id` de `members` DELIBERADAMENTE não vira
        // `NOT NULL`/ganha FK aqui: recriar `members` puxaria, em cadeia,
        // as 12 tabelas que dependem dela via FK (member_dependents,
        // member_representatives, member_status_history,
        // member_plan_history, member_exemptions, receivables ->
        // receivable_installments -> receivable_payments,
        // membership_charges -> charge_adjustments/charge_payments) numa
        // única transação — o `sqlx` não permite `PRAGMA
        // foreign_keys=OFF` no meio de uma transação já aberta (mesmo
        // problema já documentado na `version: 9`). Verificado com
        // simulação em SQLite antes de escrever esta migration: o rebuild
        // de `members` sozinha já falha com "FOREIGN KEY constraint
        // failed" (tabelas sem cascade) ou apaga dependentes/histórico
        // silenciosamente (tabelas com `ON DELETE CASCADE`). Ficou como
        // obrigatoriedade só na aplicação (`MemberModel`/`MemberForm`),
        // mesmo espírito de outras colunas soltas do projeto.
        //
        // `parcela_id` também fica solto (nullable, com `REFERENCES` mas
        // sem `NOT NULL`) pelo mesmo motivo de custo/benefício — sempre
        // preenchido pelo código da aplicação a partir de agora.
        //
        // `lower(hex(randomblob(16)))` gera os ids do backfill em SQL puro
        // (não dá pra chamar `crypto.randomUUID()` do TS aqui) — mesmo
        // espírito hex do `generate_id()` de `config.rs`; nada no schema
        // depende do formato UUID, é sempre `TEXT` opaco.
        sql: "
            CREATE TABLE parcelas (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                competence_month TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, competence_month)
            );

            CREATE INDEX idx_parcelas_competencia ON parcelas(association_id, competence_month);

            ALTER TABLE membership_charges ADD COLUMN parcela_id TEXT REFERENCES parcelas(id);
            ALTER TABLE membership_plans ADD COLUMN grants_voting_right INTEGER NOT NULL DEFAULT 1;

            INSERT INTO parcelas (id, association_id, competence_month)
            SELECT lower(hex(randomblob(16))), association_id, competence_month
            FROM membership_charges
            GROUP BY association_id, competence_month;

            UPDATE membership_charges
            SET parcela_id = (
                SELECT id FROM parcelas p
                WHERE p.association_id = membership_charges.association_id
                  AND p.competence_month = membership_charges.competence_month
            )
            WHERE parcela_id IS NULL;

            INSERT INTO member_plan_history (id, member_id, membership_plan_id, start_date, end_date)
            SELECT lower(hex(randomblob(16))), id, membership_plan_id, association_date, NULL
            FROM members
            WHERE membership_plan_id IS NOT NULL
              AND id NOT IN (SELECT member_id FROM member_plan_history);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 11,
        description: "remove_planos_valor_unico_por_associacao",
        // Simplificação pedida pelo usuário (ver docs/plano-implementacao.md):
        // vários planos de mensalidade viraram confusos — a associação passa
        // a ter UM valor de contribuição só (`monthly_contribution_amount`,
        // centavos) e um dia de vencimento (`monthly_contribution_due_day`),
        // editados junto com os dados institucionais.
        //
        // `membership_plans` e `member_plan_history` são removidas. Ordem
        // testada em simulação SQLite (transação única, `PRAGMA
        // foreign_keys=ON`, igual ao sqlx): `member_plan_history` primeiro
        // (nada mais referencia ela), depois zera
        // `membership_charges.membership_plan_id` (a ÚNICA referência real
        // restante a `membership_plans` — REFERENCES sem CASCADE, então
        // só dá pra derrubar a tabela depois de zerar quem aponta pra ela),
        // só então `DROP TABLE membership_plans`. `members.membership_plan_id`
        // e `membership_charges.membership_plan_id` continuam existindo como
        // colunas — mesmo espírito de outras colunas soltas do projeto
        // (`created_by`/`changed_by` etc., ver `version: 9`): daqui pra
        // frente sempre `NULL`, recriar as tabelas só pra tirar a coluna não
        // vale o risco.
        //
        // CORREÇÃO (ver `version: 12`): essa suposição era errada só para
        // `membership_charges.membership_plan_id` — ele mantinha o
        // `REFERENCES membership_plans(id)` no schema mesmo já sempre `NULL`,
        // e isso quebrava todo INSERT/UPDATE na tabela (SQLite valida a FK
        // contra a tabela referenciada mesmo pra valor `NULL`). A `version: 12`
        // removeu essa coluna de vez. `members.membership_plan_id` nunca teve
        // `REFERENCES` (ver comentário da `version: 2`) e não tem esse problema.
        //
        // Direito a voto (era `membership_plans.grants_voting_right`, criado
        // na `version: 10`) não ganha substituto nenhum: a regra virou
        // implícita ("sócio ATIVO tem direito a voto"), só documentada, sem
        // campo — decisão do usuário.
        sql: "
            ALTER TABLE associations ADD COLUMN monthly_contribution_amount INTEGER;
            ALTER TABLE associations ADD COLUMN monthly_contribution_due_day INTEGER CHECK (monthly_contribution_due_day BETWEEN 1 AND 31);

            DROP TABLE member_plan_history;

            UPDATE membership_charges SET membership_plan_id = NULL;

            DROP TABLE membership_plans;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 12,
        description: "remove_coluna_solta_membership_plan_id_de_charges",
        // Correção da `version: 11`: deixar `membership_charges.membership_plan_id`
        // como coluna solta (só zerada, sem tirar o `REFERENCES
        // membership_plans(id)` do schema) partiu do mesmo raciocínio já usado
        // em outras colunas soltas do projeto — mas aqui estava ERRADO.
        // Confirmado com o usuário rodando a tela de Cobranças depois da
        // `version: 11`: TODO insert/update em `membership_charges` passou a
        // falhar com "no such table: main.membership_plans", mesmo gravando
        // `NULL` na coluna. Reproduzido em simulação SQLite (`PRAGMA
        // foreign_keys=ON`, igual ao sqlx): diferente do que vale pra
        // `DELETE`/`DROP TABLE` (que só checam FK de linhas com valor
        // não-nulo), todo `INSERT`/`UPDATE` na tabela recria a checagem da FK
        // contra a tabela referenciada NO SCHEMA, mesmo quando a coluna nem
        // aparece na lista de colunas do INSERT (some para NULL por padrão) —
        // se essa tabela não existe mais, a query interna da checagem falha
        // antes mesmo de olhar o valor. É o mesmo motivo, documentado desde a
        // `version: 2`, de `members.membership_plan_id` nunca ter ganho essa
        // FK: aqui ela existia (criada junto com `membership_plans` na
        // `version: 5`, quando fazia sentido) e ficou pra trás quando a
        // tabela referenciada foi removida.
        //
        // `DROP TABLE` + recriar `membership_charges` do zero (o truque
        // "12 passos" clássico do SQLite pra alterar constraint) NÃO
        // funciona aqui: `charge_adjustments`/`charge_payments` têm
        // `charge_id NOT NULL REFERENCES membership_charges(id)` com dados
        // reais (não-nulos) apontando pra ela — testado em simulação, o
        // `DROP TABLE membership_charges` nessas condições falha com
        // "FOREIGN KEY constraint failed" antes mesmo de recriar a tabela, e
        // não dá pra desligar `PRAGMA foreign_keys` no meio da transação (é
        // no-op dentro de transação, e o sqlx roda cada migration numa só).
        // `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) resolve sem precisar
        // recriar a tabela inteira — testado e confirmado seguro. Por isso
        // aqui a coluna é REMOVIDA de verdade (não fica solta, `NULL`): não
        // tinha uso nenhum na aplicação além de sempre gravar `NULL` desde a
        // `version: 11`, então não há motivo pra mantê-la só pra repetir o
        // mesmo erro. `members.membership_plan_id` (nunca teve FK) não é
        // afetado por este bug e continua como está.
        sql: "
            ALTER TABLE membership_charges DROP COLUMN membership_plan_id;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 13,
        description: "mensalidade_por_ausencia_de_pagamento",
        // Pedido do usuário pra simplificar de vez o módulo de mensalidade:
        // em vez de pré-gerar uma linha de cobrança pra cada sócio em cada
        // mês (`membership_charges`, via `ensureAteMesAtual`/
        // `generateForCompetence` — o próprio mecanismo que gerou o bug da
        // `version: 12`), o sistema passa a só registrar o PAGAMENTO
        // (sócio + mês em `parcelas`, `version: 10`). Quem não tem
        // pagamento pra um mês já vencido, deve — sem nunca precisar
        // materializar isso em linha nenhuma. Decisão confirmada com o
        // usuário (`AskUserQuestion`): binário, sem baixa parcial — um
        // pagamento por sócio/mês já quita aquele mês inteiro.
        //
        // `membership_charges`/`charge_payments`/`charge_adjustments`
        // (Etapa 4, `version: 5`) saem de cena por completo:
        // `charge_type` só tinha `MENSALIDADE` gerado de verdade em algum
        // lugar do app (`EXTRAORDINARIA`/`EVENTO`/`ACORDO` nunca eram
        // usados), `charge_adjustments` nunca teve model/tela consumindo, e
        // os status `ISENTA`/`CANCELADA` nunca eram setados por nenhuma
        // tela.
        //
        // Ordem do DROP: filha antes da mãe, mesma regra já usada nas
        // migrations anteriores — `charge_adjustments`/`charge_payments`
        // referenciam `membership_charges`, então caem antes dela. Depois
        // disso NENHUMA tabela sobrevivente referencia essas 3 (confirmado
        // por grep: `cash_transactions.source_id` é solto, sem
        // `REFERENCES`) — diferente da `version: 11`/`version: 12`, aqui
        // não sobra coluna nenhuma com FK pra tabela removida.
        //
        // O `INSERT ... SELECT` faz o backfill de qualquer baixa já
        // registrada em `charge_payments`: como o modelo novo é binário
        // (um pagamento por sócio/mês), uma cobrança que tinha mais de uma
        // baixa parcial colapsa pro pagamento mais recente daquela
        // competência (perda aceita — sem dado de produção ainda; testado
        // em simulação que o `JOIN` do "mais recente" não duplica linha
        // nem viola o `UNIQUE (member_id, parcela_id)`).
        sql: "
            CREATE TABLE membership_payments (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                member_id TEXT NOT NULL REFERENCES members(id),
                parcela_id TEXT NOT NULL REFERENCES parcelas(id),
                cash_transaction_id TEXT REFERENCES cash_transactions(id),
                paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0),
                paid_at TEXT NOT NULL,
                payment_method TEXT,
                receipt_number TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (member_id, parcela_id)
            );

            CREATE INDEX idx_membership_payments_member ON membership_payments(member_id);
            CREATE INDEX idx_membership_payments_parcela ON membership_payments(parcela_id);

            INSERT INTO membership_payments
              (id, association_id, member_id, parcela_id, cash_transaction_id, paid_amount, paid_at, payment_method, receipt_number, created_at)
            SELECT
              lower(hex(randomblob(16))), c.association_id, c.member_id, c.parcela_id,
              cp.cash_transaction_id, cp.paid_amount, cp.paid_at, cp.payment_method, cp.receipt_number, cp.paid_at
            FROM charge_payments cp
            JOIN membership_charges c ON c.id = cp.charge_id
            JOIN (
              SELECT charge_id, MAX(paid_at) AS max_paid_at FROM charge_payments GROUP BY charge_id
            ) ultimo ON ultimo.charge_id = cp.charge_id AND ultimo.max_paid_at = cp.paid_at
            WHERE c.parcela_id IS NOT NULL
            GROUP BY cp.charge_id;

            DROP TABLE charge_adjustments;
            DROP TABLE charge_payments;
            DROP TABLE membership_charges;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 14,
        description: "liga_pagamento_ao_protocolo_do_recibo",
        // Pedido do usuário: botão "Imprimir" na lista de Protocolos, pra
        // reimprimir um recibo de mensalidade sem precisar achar o sócio de
        // novo. Até aqui a única pista de que um protocolo É o recibo de um
        // pagamento era comparar strings (`membership_payments.receipt_number`
        // contra o número formatado do protocolo) — funciona, mas é frágil
        // (depende do formato de `formatarNumeroProtocolo` nunca mudar).
        // Troca por uma referência de verdade: `protocol_entries` nunca é
        // apagada (é um livro, só cancela via `status`, nunca `DELETE` — ver
        // `ProtocolEntryModel`), então a FK aqui não corre o risco de virar
        // "coluna solta apontando pra tabela derrubada" que já pegou este
        // projeto antes (`version: 12`).
        //
        // Backfill: melhor esforço reconstruindo a mesma string que
        // `formatarNumeroProtocolo` gera (`prefixo || número || '/' || ano`)
        // e casando contra `receipt_number` já gravado — pagamento sem
        // correspondência (registrado sem escolher livro, por exemplo) fica
        // `NULL`, sem problema: o botão de reimprimir só usa o recibo
        // dedicado quando encontra o vínculo, senão cai no comprovante
        // genérico do protocolo.
        sql: "
            ALTER TABLE membership_payments ADD COLUMN protocol_entry_id TEXT REFERENCES protocol_entries(id);

            UPDATE membership_payments
            SET protocol_entry_id = (
                SELECT pe.id
                FROM protocol_entries pe
                JOIN protocol_books pb ON pb.id = pe.protocol_book_id
                WHERE (COALESCE(pb.prefix, '') || pe.number || '/' || pe.year) = membership_payments.receipt_number
                LIMIT 1
            )
            WHERE receipt_number IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 15,
        description: "genero_da_pessoa_e_socio_do_protocolo_para_declaracao",
        // Suporte pra "Declaração de associado" (numerada como protocolo,
        // tipo DECLARACAO):
        // 1. Declaração precisa flexionar "Sr./Sra.", "brasileiro/
        //    brasileira", "associado/associada" etc. de acordo com o
        //    gênero da pessoa. Campo opcional (cadastros antigos ficam
        //    NULL) — quem gera o texto usa a forma masculina como padrão
        //    neutro quando não preenchido (ver `src/utils/genero.ts`).
        // 2. O protocolo da declaração precisa apontar de volta pro sócio
        //    (pra reimprimir puxando nome/CPF/endereço/matrícula de novo, e
        //    pro botão "Imprimir" da lista de Protocolos reabrir o texto
        //    certo em vez do comprovante genérico). FK real e seguro:
        //    `members` nunca é apagada (sócio desligado só muda `status`,
        //    nunca `DELETE` — ver `MemberModel`), mesmo raciocínio já usado
        //    pra `protocol_entry_id` na `version: 14`.
        sql: "
            ALTER TABLE people ADD COLUMN gender TEXT CHECK (gender IN ('M', 'F'));
            ALTER TABLE protocol_entries ADD COLUMN member_id TEXT REFERENCES members(id);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 16,
        description: "acordos_de_renegociacao_de_mensalidade",
        // Acordo financeiro: o sócio quita de uma vez, por um valor único
        // negociado (geralmente menor), um conjunto de parcelas já
        // vencidas — não é uma redução do valor mensal daqui pra frente, só
        // uma quitação em lote pelo valor combinado. `membership_agreements`
        // guarda o registro do acordo em si (valor original somado x valor
        // negociado, quem aprovou — texto livre, o app não tem usuários) e
        // `membership_payments.membership_agreement_id` marca quais
        // parcelas foram quitadas por ele (em vez de pagamento integral
        // normal), pra `SocioDetalhes.vue` distinguir na aba Mensalidades.
        // FK real e segura: um acordo já efetivado nunca é apagado (é
        // registro contábil), mesmo raciocínio de `protocol_entry_id`
        // (`version: 14`) e `member_id` (`version: 15`).
        sql: "
            CREATE TABLE membership_agreements (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                member_id TEXT NOT NULL REFERENCES members(id),
                original_amount INTEGER NOT NULL CHECK (original_amount >= 0),
                negotiated_amount INTEGER NOT NULL CHECK (negotiated_amount >= 0),
                agreement_date TEXT NOT NULL,
                approved_by TEXT,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE membership_payments ADD COLUMN membership_agreement_id TEXT REFERENCES membership_agreements(id);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 17,
        description: "foto_de_identificacao_da_pessoa",
        // Foto de identificação do sócio (ver `src-tauri/src/photos.rs`):
        // guardada direto na coluna, como data URL (`data:<mime>;base64,...`)
        // já pronta pro `<img :src>` — sem arquivo externo pra gerenciar,
        // diferente do esquema de `documents`/`document_versions`
        // (`version: 7`), que existe pra versionamento e auditoria de
        // arquivos reais. Aqui é 1 foto por pessoa, sem histórico.
        sql: "ALTER TABLE people ADD COLUMN photo TEXT;",
        kind: MigrationKind::Up,
    }, Migration {
        version: 18,
        description: "unifica_tipo_de_livro_com_tipo_de_documento",
        // Tipo de livro de protocolo (`protocol_books.protocol_type`) e tipo
        // de documento (`document_types`, aba "Tipos" de `Documentos.vue`)
        // sempre representaram a mesma coisa: uma etiqueta livre pra
        // classificar o que está sendo numerado/arquivado. Até aqui o tipo
        // de livro vinha de uma lista à parte, solta no `config.json`
        // (`list_protocol_types`/`add_protocol_type`, removidos de
        // `config.rs` nesta mesma mudança) — a pedido do usuário, os dois
        // viram uma lista só: `document_types`, que já existia e já tinha
        // tela própria de gestão. `ProtocolBookForm.vue` passa a escolher
        // dali (sem mais "+ Novo tipo..." embutido no formulário de livro).
        //
        // Sem mudança de schema em `protocol_books`/`protocol_entries`: as
        // duas colunas continuam TEXT solto, exatamente como antes — só a
        // fonte de onde o texto pode vir muda. Este backfill garante que
        // todo `protocol_type` já em uso por algum livro tenha uma linha
        // correspondente em `document_types` da mesma associação, pra
        // ninguém perder, ao trocar de mecanismo, uma opção que já usava.
        // `lower(hex(randomblob(16)))` gera os ids do backfill em SQL puro,
        // mesmo padrão da `version: 10`.
        sql: "
            INSERT INTO document_types (id, association_id, name)
            SELECT lower(hex(randomblob(16))), b.association_id, b.protocol_type
            FROM protocol_books b
            WHERE NOT EXISTS (
                SELECT 1 FROM document_types dt
                WHERE dt.association_id = b.association_id AND dt.name = b.protocol_type
            )
            GROUP BY b.association_id, b.protocol_type;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 19,
        description: "remove_etiquetas_de_documento",
        // Etiquetas (`document_tags`/`document_tag_links`, migration
        // `version: 7`) removidas a pedido do usuário — funcionalidade sem
        // uso real. Diferente da maioria das tabelas deste schema, nenhuma
        // outra tabela referencia estas duas (só elas apontavam pra
        // `documents`), então dá pra `DROP TABLE` de verdade, sem o risco
        // de rebuild documentado na `version: 9`.
        sql: "
            DROP TABLE document_tag_links;
            DROP TABLE document_tags;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 20,
        description: "volta_planos_de_mensalidade_multiplos",
        // Pedido do usuário: volta a existir mais de um valor de
        // mensalidade — a associação escolhe entre `UNICO` (comportamento
        // de hoje, `associations.monthly_contribution_amount` vale pra
        // todo sócio) e `MULTIPLO` (cada sócio é vinculado a um
        // `membership_plans`, e o valor sugerido nos pagamentos passa a vir
        // de lá — ver `MembershipPaymentModel.valorMensalSugerido`).
        // Dia de vencimento continua único por associação
        // (`monthly_contribution_due_day`) nos dois modos — só o VALOR
        // muda por plano, não o vencimento.
        //
        // Diferente da `version: 5`/`version: 11` (planos antigos,
        // removidos): esta tabela é criada do zero, schema simplificado (só
        // nome/descrição/valor/ativo, sem frequência, dia de vencimento
        // próprio, nem `member_plan_history` — trocar de plano é só
        // apontar `members.membership_plan_id` pra outra linha, sem guardar
        // vigência). `members.membership_plan_id` é a MESMA coluna solta
        // criada na `version: 2` (sem `REFERENCES`, documentada como
        // "vestígio, sempre null" desde a `version: 11`) — passa a ser
        // gravada de novo pela aplicação (`MemberModel`/`SocioForm.vue`),
        // ainda sem FK pelo mesmo motivo de sempre (adicionar `REFERENCES`
        // a uma coluna existente exige recriar `members`, ver comentário da
        // `version: 10`); validado em código.
        sql: "
            ALTER TABLE associations ADD COLUMN membership_mode TEXT NOT NULL DEFAULT 'UNICO'
                CHECK (membership_mode IN ('UNICO', 'MULTIPLO'));

            CREATE TABLE membership_plans (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                name TEXT NOT NULL,
                description TEXT,
                amount INTEGER NOT NULL CHECK (amount >= 0),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, name)
            );

            CREATE TRIGGER trg_membership_plans_updated_at
            AFTER UPDATE ON membership_plans
            BEGIN
                UPDATE membership_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 21,
        description: "matricula_automatica",
        // Pedido do usuário: opção pra a matrícula do sócio ser numerada
        // sozinha. `auto_registration_number` é o interruptor (0 = usuário
        // digita, como sempre foi; 1 = `MemberModel.create` gera sozinho) e
        // `next_registration_number` é o contador atômico, mesmo padrão de
        // `protocol_books.next_number`/`ProtocolEntryModel.create`
        // (`UPDATE ... RETURNING`, ver migration `version: 6`).
        //
        // Os dois são literais constantes (`0`/`1`), não `CURRENT_TIMESTAMP`
        // — não precisam do padrão de backfill + trigger de
        // `.claude/rules/database.md`, um `ALTER TABLE ... ADD COLUMN` com
        // esses defaults já é aceito direto pelo SQLite.
        //
        // Default `0` (manual): liga automática só quem pedir explicitamente
        // em "Instituição" — associação já em produção continua exatamente
        // como antes até o usuário mudar. O `UPDATE` abaixo garante que,
        // quando a numeração automática for ligada, o próximo número não
        // colide com nenhuma matrícula manual já usada (soma 1 ao maior
        // número já registrado; sem sócio nenhum ainda, começa em 1).
        sql: "
            ALTER TABLE associations ADD COLUMN auto_registration_number INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE associations ADD COLUMN next_registration_number INTEGER NOT NULL DEFAULT 1;

            UPDATE associations
            SET next_registration_number = COALESCE(
                (SELECT MAX(CAST(m.registration_number AS INTEGER)) + 1
                 FROM members m
                 WHERE m.association_id = associations.id),
                1
            );
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 22,
        description: "mensalidade_legado_do_socio",
        // Pedido do usuário: associações antigas que já cobraram e já usaram
        // mensalidades de anos anteriores, sem controle nenhum no sistema —
        // não dá pra reconstituir isso, então precisa de um jeito de dizer
        // "esqueça tudo antes desta data". `dues_start_date` é essa data,
        // POR SÓCIO (cada um pode ter entrado/regularizado em época
        // diferente): `NULL` (default, todo sócio já existente fica assim)
        // = comportamento de sempre, conta desde `association_date`; se
        // preenchida, é ela — não `association_date` — que
        // `MembershipPaymentModel.buscarLinhas` usa como início da vigência
        // pra gerar linha "sócio × mês", então nenhuma parcela é sequer
        // considerada antes dela — nem dívida, nem, por consequência, bloqueio
        // de voto em `ImprimirAptosAVotar.vue` (que só olha inadimplência).
        // Mesma regra de `exit_date` logo acima: não pode ser anterior à
        // filiação de verdade.
        sql: "
            ALTER TABLE members ADD COLUMN dues_start_date TEXT
                CHECK (dues_start_date IS NULL OR dues_start_date >= association_date);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 23,
        description: "carencia_para_voto",
        // Pedido do usuário: tempo mínimo de filiação, em meses, pra o sócio
        // entrar na lista de aptos a votar (`MemberModel.listarAptosAVotar`),
        // contado a partir de `members.association_date`. Default `0` = sem
        // carência — associação já em produção continua com a mesma lista
        // de antes até alguém preencher o campo em "Instituição". Literal
        // constante, então `ADD COLUMN ... DEFAULT` direto (sem o padrão de
        // backfill + trigger de `.claude/rules/database.md`).
        sql: "
            ALTER TABLE associations ADD COLUMN voting_min_membership_months INTEGER NOT NULL DEFAULT 0
                CHECK (voting_min_membership_months >= 0);
        ",
        kind: MigrationKind::Up,
    }, Migration {
        version: 24,
        description: "patrimonio_e_historico_de_atividades",
        // Pedido do usuário, duas coisas juntas:
        //
        // 1. Patrimônio (bloco da Fase 2 do plano): `assets` é o bem, com a
        //    origem da aquisição e, quando baixado, tipo/data/motivo da
        //    baixa (o `CHECK` final amarra os três à situação `BAIXADO`).
        //    Situação, local, responsável e conservação NÃO se editam
        //    direto — mudam por um evento em `asset_events`, que é a linha
        //    do tempo do bem (aquisição, movimentação, manutenção,
        //    empréstimo, baixa...). `cash_transaction_id` liga o evento ao
        //    lançamento de caixa quando a compra/venda/manutenção foi
        //    lançada no financeiro.
        //
        // 2. Histórico de atividades: `activity_logs` recebe uma linha por
        //    ação feita no sistema (ver `ActivityLogModel`). Diferente da
        //    `audit_logs` removida na `version: 9`, não tem usuário (o app
        //    não tem) — é só "quando + o quê". Imutável: os dois triggers
        //    abortam qualquer UPDATE/DELETE, então nem um bug no app
        //    consegue reescrever o passado. `created_at` com milissegundos
        //    pra ordenar direito ações feitas no mesmo segundo (UTC, como
        //    todo `created_at` do banco — convertido pra hora local na tela).
        sql: "
            CREATE TABLE assets (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                asset_number TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT,
                serial_number TEXT,
                acquisition_date TEXT NOT NULL,
                acquisition_origin TEXT NOT NULL
                    CHECK (acquisition_origin IN ('COMPRA', 'DOACAO', 'CESSAO', 'PRODUCAO_PROPRIA', 'OUTRO')),
                acquisition_source TEXT,
                acquisition_value INTEGER CHECK (acquisition_value IS NULL OR acquisition_value >= 0),
                acquisition_document TEXT,
                location TEXT,
                responsible TEXT,
                condition TEXT NOT NULL DEFAULT 'BOM'
                    CHECK (condition IN ('NOVO', 'BOM', 'REGULAR', 'RUIM', 'INSERVIVEL')),
                status TEXT NOT NULL DEFAULT 'EM_USO'
                    CHECK (status IN ('EM_USO', 'EM_MANUTENCAO', 'EMPRESTADO', 'BAIXADO')),
                disposal_type TEXT
                    CHECK (disposal_type IS NULL OR disposal_type IN ('VENDA', 'DOACAO', 'DESCARTE', 'PERDA', 'FURTO_ROUBO', 'OUTRO')),
                disposal_date TEXT,
                disposal_reason TEXT,
                disposal_value INTEGER CHECK (disposal_value IS NULL OR disposal_value >= 0),
                disposal_recipient TEXT,
                observations TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (association_id, asset_number),
                CHECK (
                    (status = 'BAIXADO' AND disposal_type IS NOT NULL AND disposal_date IS NOT NULL AND disposal_reason IS NOT NULL)
                    OR (status <> 'BAIXADO' AND disposal_type IS NULL AND disposal_date IS NULL)
                ),
                CHECK (disposal_date IS NULL OR disposal_date >= acquisition_date)
            );

            CREATE TRIGGER trg_assets_updated_at
            AFTER UPDATE ON assets
            BEGIN
                UPDATE assets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;

            CREATE INDEX idx_assets_association ON assets(association_id, status);

            CREATE TABLE asset_events (
                id TEXT PRIMARY KEY,
                asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL
                    CHECK (event_type IN ('AQUISICAO', 'TRANSFERENCIA', 'MANUTENCAO_ENVIO', 'MANUTENCAO_RETORNO',
                                          'EMPRESTIMO', 'DEVOLUCAO', 'CONSERVACAO', 'OCORRENCIA', 'BAIXA', 'REATIVACAO')),
                event_date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount INTEGER CHECK (amount IS NULL OR amount >= 0),
                cash_transaction_id TEXT REFERENCES cash_transactions(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX idx_asset_events_asset ON asset_events(asset_id, event_date DESC, created_at DESC);

            CREATE TABLE activity_logs (
                id TEXT PRIMARY KEY,
                association_id TEXT NOT NULL REFERENCES associations(id),
                module TEXT NOT NULL
                    CHECK (module IN ('SOCIOS', 'MENSALIDADES', 'FINANCEIRO', 'DOCUMENTOS', 'PROTOCOLOS',
                                      'PATRIMONIO', 'INSTITUICAO', 'SISTEMA')),
                description TEXT NOT NULL,
                entity_type TEXT,
                entity_id TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
            );

            CREATE INDEX idx_activity_logs_created ON activity_logs(association_id, created_at DESC);
            CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);

            CREATE TRIGGER trg_activity_logs_sem_update
            BEFORE UPDATE ON activity_logs
            BEGIN
                SELECT RAISE(ABORT, 'O histórico de atividades não pode ser alterado.');
            END;

            CREATE TRIGGER trg_activity_logs_sem_delete
            BEFORE DELETE ON activity_logs
            BEGIN
                SELECT RAISE(ABORT, 'O histórico de atividades não pode ser apagado.');
            END;
        ",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Lê (ou cria, na 1ª execução) o config.json ao lado do executável —
    // agora uma LISTA de associações, cada uma com seu próprio arquivo
    // `.db` (ver config.rs). `tauri_plugin_sql::Builder::add_migrations`
    // registra as migrations por URL de banco exata, uma vez, aqui no
    // início do processo — por isso é preciso chamar isso para CADA
    // associação já cadastrada. Uma associação criada DEPOIS que o
    // processo já subiu não tem essa URL registrada ainda; o arquivo dela
    // só fica de fato utilizável (migrado) depois de reiniciar o app —
    // mesma exigência que já existe para mudar o local de um banco.
    let app_config = config::load_or_init();

    let mut sql_builder = SqlBuilder::default();
    for associacao in &app_config.associations {
        if let Some(parent) = Path::new(&associacao.db_path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        let db_url = format!("sqlite:{}", associacao.db_path);
        sql_builder = sql_builder.add_migrations(&db_url, all_migrations());
    }

    tauri::Builder::default()
        .plugin(sql_builder.build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            config::get_config_file_path,
            config::list_associations,
            config::create_association,
            config::update_association,
            config::set_association_password,
            config::verify_association_password,
            config::remove_association,
            config::get_print_config,
            config::set_print_config,
            config::restart_app,
            documents::import_document_file,
            documents::get_document_file_path,
            documents::read_document_file_as_data_url,
            photos::read_image_as_data_url,
            files::read_text_file,
            files::write_text_file,
            backup::prepare_backup_snapshot,
            backup::export_backup,
            backup::import_backup,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao rodar a aplicação tauri");
}