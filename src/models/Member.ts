import { getDatabase } from "../services/database.js";
import { newId } from "../services/id.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { PersonModel, type NovaPessoa, type AtualizacaoPessoa, type GeneroPessoa } from "./Person.js";
import { MembershipPaymentModel } from "./MembershipPayment.js";
import { AssociationModel } from "./Association.js";

/** Situação do sócio (ver `docs/dominio-associacoes.md`, seção 2.2). */
export type StatusSocio = "PENDENTE" | "ATIVO" | "INATIVO" | "SUSPENSO" | "DESLIGADO" | "FALECIDO";

/** Espelha a tabela `members` (migration `version: 2`). */
export interface Member {
  id: string;
  association_id: string;
  person_id: string;
  registration_number: string;
  association_date: string;
  status: StatusSocio;
  exit_date: string | null;
  exit_reason: string | null;
  /**
   * Plano de mensalidade vinculado ao sócio — coluna criada solta (sem
   * `REFERENCES`) na migration `version: 2`, ficou sempre `null` entre as
   * migrations `version: 11` e `version: 20` (planos removidos, depois
   * trazidos de volta a pedido do usuário). Só é gravada/lida quando a
   * associação está no modo "Múltiplos planos"
   * (`Association.membership_mode`); no modo "Único" continua `null`.
   * Aponta pra `membership_plans.id`, validado em código (nunca ganhou FK
   * real — ver comentário da `version: 20`).
   */
  membership_plan_id: string | null;
  /**
   * Mensalidade legado (migration `version: 22`): `null` = comportamento de
   * sempre, dívida e aptidão a voto contam desde `association_date`. Se
   * preenchida, `MembershipPaymentModel.buscarLinhas` passa a considerar
   * essa data como início da vigência financeira — nenhum mês anterior a
   * ela vira linha "sócio × mês", então não conta como dívida nem bloqueia
   * o sócio na lista de aptos a votar. Uso: associação antiga que já
   * recebeu e já gastou mensalidades de anos anteriores fora do sistema,
   * sem como reconstituir esse controle.
   */
  dues_start_date: string | null;
  observations: string | null;
  created_at: string;
  updated_at: string;
}

/** Sócio com os dados da pessoa já unidos (uso em listas e na ficha). */
export interface MemberComPessoa extends Member {
  full_name: string;
  cpf: string | null;
  gender: GeneroPessoa | null;
  /** Foto de identificação da pessoa, migration `version: 17` (ver `Person.photo`). */
  photo: string | null;
}

/** Registro do histórico de mudança de situação (`member_status_history`). */
export interface MemberStatusHistorico {
  id: string;
  member_id: string;
  old_status: StatusSocio | null;
  new_status: StatusSocio;
  effective_date: string;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

/**
 * Dados de criação: `people` + `members` num único formulário, já que a UI
 * trata isso como uma "ficha de sócio" só (ver `docs/plano-implementacao.md`,
 * Etapa 2).
 */
export interface NovoSocio extends NovaPessoa {
  /**
   * Opcional quando a associação está com numeração automática ligada
   * (`Association.auto_registration_number`) — `MemberModel.create` gera
   * sozinho e ignora o que vier aqui. Obrigatório no modo manual.
   */
  registration_number?: string;
  association_date: string;
  observations?: string | null;
  /** Só usado no modo "Múltiplos planos" (ver `Member.membership_plan_id`). */
  membership_plan_id?: string | null;
  /** Ver `Member.dues_start_date`. */
  dues_start_date?: string | null;
}

const CAMPOS_PESSOA = [
  "full_name",
  "birth_date",
  "nationality",
  "marital_status",
  "cpf",
  "rg",
  "profession",
  "mother_name",
  "father_name",
  "gender",
  "notes",
  "photo",
] as const;

const CAMPOS_SOCIO = [
  "registration_number",
  "association_date",
  "observations",
  "membership_plan_id",
  "dues_start_date",
] as const;

export type AtualizacaoSocio = AtualizacaoPessoa & {
  registration_number?: string;
  association_date?: string;
  observations?: string | null;
  membership_plan_id?: string | null;
  dues_start_date?: string | null;
};

const SELECT_COM_PESSOA = `
  SELECT m.*, p.full_name AS full_name, p.cpf AS cpf, p.gender AS gender, p.photo AS photo
  FROM members m
  JOIN people p ON p.id = m.person_id
`;

/** Acesso à tabela `members` e operações de negócio do sócio. */
export class MemberModel {
  static async list(): Promise<MemberComPessoa[]> {
    const db = await getDatabase();
    return db.select<MemberComPessoa[]>(`${SELECT_COM_PESSOA} WHERE m.association_id = $1 ORDER BY p.full_name`, [
      getCurrentAssociationId(),
    ]);
  }

  /**
   * Existe algum sócio cadastrado nesta associação — usado só pra travar a
   * edição da data de fundação em `InstitutionalDataEditor.vue`: mudá-la
   * depois de já ter sócio cadastrado bagunçaria o marco inicial do
   * calendário de parcelas (`ParcelaModel.ensureAteMesAtual`).
   */
  static async existeAlgum(): Promise<boolean> {
    const db = await getDatabase();
    const [{ total }] = await db.select<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM members WHERE association_id = $1",
      [getCurrentAssociationId()]
    );
    return total > 0;
  }

  /** Busca por nome, CPF, matrícula, telefone ou e-mail (ver seção 2.2 do documento de domínio). */
  static async search(termo: string): Promise<MemberComPessoa[]> {
    const db = await getDatabase();
    const like = `%${termo}%`;
    return db.select<MemberComPessoa[]>(
      `${SELECT_COM_PESSOA}
       WHERE m.association_id = $1
         AND (
           p.full_name LIKE $2
           OR p.cpf LIKE $2
           OR m.registration_number LIKE $2
           OR EXISTS (
                SELECT 1 FROM person_contacts pc
                WHERE pc.person_id = p.id AND pc.contact_value LIKE $2
              )
         )
       ORDER BY p.full_name`,
      [getCurrentAssociationId(), like]
    );
  }

  static async get(id: string): Promise<MemberComPessoa | null> {
    const db = await getDatabase();
    const rows = await db.select<MemberComPessoa[]>(`${SELECT_COM_PESSOA} WHERE m.id = $1`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Cria pessoa + sócio. A matrícula sai do formulário (`dados.registration_number`)
   * no modo manual; com `Association.auto_registration_number` ligado, o que
   * vier do formulário é ignorado e o número sai de
   * `AssociationModel.proximaMatricula` — checado ANTES de criar a pessoa,
   * pra não deixar um registro de `people` órfão se faltar matrícula no modo
   * manual.
   */
  static async create(dados: NovoSocio): Promise<Member> {
    const associationId = getCurrentAssociationId();
    const associacao = await AssociationModel.get(associationId);
    if (!associacao) throw new Error("Associação não encontrada.");

    let registrationNumber = dados.registration_number?.trim() || "";
    if (associacao.auto_registration_number) {
      registrationNumber = await AssociationModel.proximaMatricula(associationId);
    } else if (!registrationNumber) {
      throw new Error("Informe o número de matrícula.");
    }

    const pessoa = await PersonModel.create({
      full_name: dados.full_name,
      birth_date: dados.birth_date,
      nationality: dados.nationality,
      marital_status: dados.marital_status,
      cpf: dados.cpf,
      rg: dados.rg,
      profession: dados.profession,
      mother_name: dados.mother_name,
      father_name: dados.father_name,
      gender: dados.gender,
      notes: dados.notes,
      photo: dados.photo,
    });

    const db = await getDatabase();
    const id = newId();
    await db.execute(
      `INSERT INTO members
         (id, association_id, person_id, registration_number, association_date, observations, membership_plan_id, dues_start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        associationId,
        pessoa.id,
        registrationNumber,
        dados.association_date,
        dados.observations ?? null,
        dados.membership_plan_id ?? null,
        dados.dues_start_date ?? null,
      ]
    );

    const [criado] = await db.select<Member[]>("SELECT * FROM members WHERE id = $1", [id]);
    return criado;
  }

  /** Atualiza os campos de `people` e/ou `members` presentes em `dados`. */
  static async update(id: string, dados: AtualizacaoSocio): Promise<void> {
    const atual = await MemberModel.get(id);
    if (!atual) throw new Error("Sócio não encontrado.");

    const dadosPessoa: Record<string, unknown> = {};
    const dadosSocio: Record<string, unknown> = {};

    for (const [campo, valor] of Object.entries(dados)) {
      if (valor === undefined) continue;
      if ((CAMPOS_PESSOA as readonly string[]).includes(campo)) dadosPessoa[campo] = valor;
      else if ((CAMPOS_SOCIO as readonly string[]).includes(campo)) dadosSocio[campo] = valor;
    }

    if (Object.keys(dadosPessoa).length > 0) {
      await PersonModel.update(atual.person_id, dadosPessoa as AtualizacaoPessoa);
    }

    if (Object.keys(dadosSocio).length > 0) {
      const db = await getDatabase();
      const campos = Object.entries(dadosSocio);
      const sets = campos.map(([campo], indice) => `${campo} = $${indice + 2}`).join(", ");
      const valores = campos.map(([, valor]) => valor as string | null);
      await db.execute(`UPDATE members SET ${sets} WHERE id = $1`, [id, ...valores]);
    }
  }

  /**
   * Registra uma mudança de situação: atualiza `members.status` (e,
   * opcionalmente, `exit_date`/`exit_reason`) e grava a transição em
   * `member_status_history` — sócio desligado não é apagado, só encerrado
   * (ver `docs/dominio-associacoes.md`, seção 2.2). `changed_by` fica
   * sempre `null`: o app não tem usuários (correção pós-MVP removeu
   * usuários/perfis/auditoria — ver docs/plano-implementacao.md).
   */
  static async changeStatus(
    id: string,
    novoStatus: StatusSocio,
    opcoes: { effectiveDate: string; reason?: string | null; exitDate?: string | null; exitReason?: string | null }
  ): Promise<void> {
    const atual = await MemberModel.get(id);
    if (!atual) throw new Error("Sócio não encontrado.");

    const db = await getDatabase();
    await db.execute("UPDATE members SET status = $2, exit_date = $3, exit_reason = $4 WHERE id = $1", [
      id,
      novoStatus,
      opcoes.exitDate ?? null,
      opcoes.exitReason ?? null,
    ]);

    await db.execute(
      `INSERT INTO member_status_history (id, member_id, old_status, new_status, effective_date, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), id, atual.status, novoStatus, opcoes.effectiveDate, opcoes.reason ?? null]
    );
  }

  static async statusHistory(memberId: string): Promise<MemberStatusHistorico[]> {
    const db = await getDatabase();
    return db.select<MemberStatusHistorico[]>(
      "SELECT * FROM member_status_history WHERE member_id = $1 ORDER BY effective_date DESC, created_at DESC",
      [memberId]
    );
  }

  /**
   * Sócio inadimplente: deve algum mês (`parcelas`, migration `version: 10`)
   * já vencido, dentro da vigência dele (`association_date` até `exit_date`,
   * se houver). Desde a `version: 13`, não existe mais cobrança pré-gerada
   * pra checar — a ausência de pagamento em `membership_payments` já É a
   * dívida (ver `MembershipPaymentModel.isInadimplente`).
   */
  static async isInadimplente(memberId: string): Promise<boolean> {
    return MembershipPaymentModel.isInadimplente(memberId);
  }
}
