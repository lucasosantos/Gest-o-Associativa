<script setup lang="ts">
// Edição dos dados cadastrais da associação do banco conectado + endereço
// principal. Antes vivia numa tela própria ("Instituição"); passou para o
// corpo da tela Início (aba "Instituição"). Cada arquivo `.db` só tem uma
// linha em `associations` agora (correção pós-MVP voltou a "1 arquivo =
// 1 associação") — `associationId` vem `null` quando o arquivo ainda está
// vazio (associação recém-criada no config.json, sem dados institucionais
// preenchidos ainda), e o primeiro "Salvar" cria essa linha.
//
// Modo de exibição/edição (pedido do usuário — nada de formulário fixo à
// mostra o tempo todo): sem associação ainda cadastrada, abre direto no
// formulário (não há nada pra exibir); com dados já salvos, abre em modo
// leitura (texto) e só entra em edição pelo botão "Editar".
import { ref, watch } from "vue";
import { AssociationModel, type StatusAssociacao, type MembershipMode } from "../models/Association.js";
import { AddressModel } from "../models/Address.js";
import { ParcelaModel } from "../models/Parcela.js";
import { MemberModel } from "../models/Member.js";
import { DocumentTypeModel } from "../models/DocumentType.js";
import { comAtividade } from "../models/ActivityLog.js";
import { centavosParaReais, reaisParaCentavos, formatarData, formatarMoeda } from "../utils/format.js";
import {
  setCurrentAssociationId,
  setCurrentMembershipMode,
  setCurrentAutoRegistrationNumber,
} from "../composables/useCurrentAssociation.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ associationId: string | null; onSaved?: () => void }>();

const loading = ref(true);
const saving = ref(false);
const erro = ref("");
const editing = ref(!props.associationId);
const addressId = ref<string | null>(null);
/**
 * Já existe sócio cadastrado nesta associação — trava a edição da data de
 * fundação: ela é o marco inicial do calendário de parcelas
 * (`ParcelaModel.ensureAteMesAtual`), mudá-la depois que já existe sócio
 * (e, com ele, mensalidade calculada a partir dela) bagunçaria esse
 * calendário.
 */
const temSocioCadastrado = ref(false);

const STATUS_LABEL: Record<StatusAssociacao, string> = {
  ATIVA: "Ativa",
  INATIVA: "Inativa",
  ENCERRADA: "Encerrada",
};

const MEMBERSHIP_MODE_LABEL: Record<MembershipMode, string> = {
  UNICO: "Plano único",
  MULTIPLO: "Múltiplos planos",
};

const legalName = ref("");
const tradeName = ref("");
const cnpj = ref("");
const foundationDate = ref("");
const status = ref<StatusAssociacao>("ATIVA");
const email = ref("");
const phone = ref("");
const website = ref("");
const membershipMode = ref<MembershipMode>("UNICO");
const contributionAmount = ref(0);
const contributionDueDay = ref(10);
const autoRegistrationNumber = ref(false);
/** Carência para votar, em meses de filiação (ver `Association.voting_min_membership_months`). */
const votingMinMonths = ref(0);

const street = ref("");
const number = ref("");
const complement = ref("");
const district = ref("");
const city = ref("");
const state = ref("");
const zipCode = ref("");

async function load() {
  loading.value = true;
  try {
    legalName.value = "";
    tradeName.value = "";
    cnpj.value = "";
    foundationDate.value = "";
    status.value = "ATIVA";
    email.value = "";
    phone.value = "";
    website.value = "";
    membershipMode.value = "UNICO";
    contributionAmount.value = 0;
    contributionDueDay.value = 10;
    autoRegistrationNumber.value = false;
    votingMinMonths.value = 0;
    addressId.value = null;
    street.value = "";
    number.value = "";
    complement.value = "";
    district.value = "";
    city.value = "";
    state.value = "";
    zipCode.value = "";
    temSocioCadastrado.value = false;
    editing.value = !props.associationId;

    if (!props.associationId) return;

    const [associacao] = await Promise.all([
      AssociationModel.get(props.associationId),
      MemberModel.existeAlgum().then((existe) => {
        temSocioCadastrado.value = existe;
      }),
    ]);
    if (!associacao) return;

    legalName.value = associacao.legal_name;
    tradeName.value = associacao.trade_name ?? "";
    cnpj.value = associacao.cnpj ?? "";
    foundationDate.value = associacao.foundation_date ?? "";
    status.value = associacao.status;
    email.value = associacao.email ?? "";
    phone.value = associacao.phone ?? "";
    website.value = associacao.website ?? "";
    membershipMode.value = associacao.membership_mode;
    contributionAmount.value = associacao.monthly_contribution_amount
      ? centavosParaReais(associacao.monthly_contribution_amount)
      : 0;
    contributionDueDay.value = associacao.monthly_contribution_due_day ?? 10;
    autoRegistrationNumber.value = Boolean(associacao.auto_registration_number);
    votingMinMonths.value = associacao.voting_min_membership_months ?? 0;

    const [enderecoPrincipal] = await AddressModel.listByAssociation(associacao.id);
    if (enderecoPrincipal) {
      addressId.value = enderecoPrincipal.id;
      street.value = enderecoPrincipal.street;
      number.value = enderecoPrincipal.number ?? "";
      complement.value = enderecoPrincipal.complement ?? "";
      district.value = enderecoPrincipal.district ?? "";
      city.value = enderecoPrincipal.city;
      state.value = enderecoPrincipal.state;
      zipCode.value = enderecoPrincipal.zip_code ?? "";
    }
  } finally {
    loading.value = false;
  }
}

watch(() => props.associationId, load, { immediate: true });

function enderecoPreenchido() {
  return Boolean(street.value.trim() || city.value.trim() || state.value.trim() || zipCode.value.trim());
}

/** Entra em modo de edição — reconfere `temSocioCadastrado` na hora, pra travar a fundação com dado fresco. */
async function abrirEdicao() {
  erro.value = "";
  if (props.associationId) {
    temSocioCadastrado.value = await MemberModel.existeAlgum();
  }
  editing.value = true;
}

/** Descarta qualquer edição não salva, recarregando da base, e volta pro modo leitura. */
async function cancelarEdicao() {
  await load();
  editing.value = false;
}

/** Endereço começado mas incompleto — conferido ANTES de gravar qualquer coisa (ver `handleSave`). */
function enderecoIncompleto() {
  return enderecoPreenchido() && (!street.value.trim() || !city.value.trim() || !state.value.trim());
}

async function salvarEndereco(idAssociacao: string) {
  if (!enderecoPreenchido()) return;

  const dados = {
    street: street.value.trim(),
    number: number.value.trim() || null,
    complement: complement.value.trim() || null,
    district: district.value.trim() || null,
    city: city.value.trim(),
    state: state.value.trim().toUpperCase(),
    zip_code: zipCode.value.trim() || null,
  };

  if (addressId.value) {
    await AddressModel.update(addressId.value, dados);
  } else {
    const criado = await AddressModel.create({
      association_id: idAssociacao,
      is_primary: 1,
      ...dados,
    });
    addressId.value = criado.id;
  }
}

async function handleSave() {
  if (!legalName.value.trim()) {
    erro.value = "Informe a razão social da associação.";
    return;
  }
  if (!Number.isInteger(votingMinMonths.value) || votingMinMonths.value < 0) {
    erro.value = "Os meses de associado para ter direito a voto devem ser um número inteiro, 0 ou maior.";
    return;
  }
  if (enderecoIncompleto()) {
    erro.value = "Para salvar o endereço, preencha ao menos rua, cidade e estado.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const dados = {
      legal_name: legalName.value.trim(),
      trade_name: tradeName.value.trim() || null,
      cnpj: cnpj.value.trim() || null,
      foundation_date: foundationDate.value || null,
      status: status.value,
      email: email.value.trim() || null,
      phone: phone.value.trim() || null,
      website: website.value.trim() || null,
      membership_mode: membershipMode.value,
      monthly_contribution_amount: contributionAmount.value > 0 ? reaisParaCentavos(contributionAmount.value) : null,
      monthly_contribution_due_day: contributionDueDay.value || null,
      auto_registration_number: (autoRegistrationNumber.value ? 1 : 0) as 0 | 1,
      voting_min_membership_months: votingMinMonths.value,
    };

    if (props.associationId) {
      const associationId = props.associationId;
      // Dados + endereço = uma atividade só no histórico.
      await comAtividade(
        async () => {
          await AssociationModel.update(associationId, dados);
          await salvarEndereco(associationId);
        },
        () => ({ association_id: associationId, module: "INSTITUICAO", description: "Dados institucionais alterados" })
      );
    } else {
      const criada = await comAtividade(
        async () => {
          const nova = await AssociationModel.create(dados);
          // O endereço PRECISA ser gravado antes de `setCurrentAssociationId`:
          // trocar o id faz o Início recriar este componente (`:key` em
          // Inicio.vue) — a instância nova lia o banco antes do endereço chegar
          // (aparecia "Nenhum endereço cadastrado", e editar de novo criava um
          // 2º endereço), e qualquer erro daqui pra frente caía numa instância
          // que já saiu da tela.
          await salvarEndereco(nova.id);
          return nova;
        },
        (nova) => ({
          association_id: nova.id,
          module: "INSTITUICAO",
          description: `Associação cadastrada — ${nova.legal_name}`,
        })
      );
      setCurrentAssociationId(criada.id);
      // Primeira vez que esta associação é cadastrada (banco recém-criado,
      // sem nenhum tipo de documento ainda) — pré-cadastra os mais comuns
      // (ver DocumentTypeModel.seedPadrao), evitando que o usuário precise
      // criar um a um antes do primeiro upload/protocolo.
      await DocumentTypeModel.seedPadrao();
    }
    setCurrentMembershipMode(membershipMode.value);
    setCurrentAutoRegistrationNumber(autoRegistrationNumber.value);

    // Fundação preenchida (ou corrigida) — garante na hora que o
    // calendário de parcelas cobre desde ela até o mês atual (ver
    // ParcelaModel.ensureAteMesAtual), sem esperar a próxima conexão. Sem
    // isso, quem cadastra a fundação só veria os meses anteriores
    // aparecerem na tela de Cobranças depois de reabrir a associação.
    if (dados.foundation_date) {
      await ParcelaModel.ensureAteMesAtual();
    }

    editing.value = false;
    props.onSaved?.();
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <div v-else-if="!editing" class="settings-group">
    <div class="view-header">
      <h3>Dados institucionais</h3>
      <button type="button" class="btn-secondary" @click="abrirEdicao">Editar</button>
    </div>

    <dl class="view-grid">
      <dt>Razão social</dt>
      <dd>{{ legalName }}</dd>
      <dt>Nome fantasia</dt>
      <dd>{{ tradeName || "—" }}</dd>
      <dt>CNPJ</dt>
      <dd>{{ cnpj || "—" }}</dd>
      <dt>Data de fundação</dt>
      <dd>{{ foundationDate ? formatarData(foundationDate) : "—" }}</dd>
      <dt>Situação</dt>
      <dd>{{ STATUS_LABEL[status] }}</dd>
      <dt>E-mail</dt>
      <dd>{{ email || "—" }}</dd>
      <dt>Telefone</dt>
      <dd>{{ phone || "—" }}</dd>
      <dt>Site</dt>
      <dd>{{ website || "—" }}</dd>
    </dl>

    <h3 class="section-title">Matrícula</h3>
    <dl class="view-grid">
      <dt>Numeração</dt>
      <dd>{{ autoRegistrationNumber ? "Automática (sequencial)" : "Manual" }}</dd>
    </dl>

    <h3 class="section-title">Direito a voto</h3>
    <dl class="view-grid">
      <dt>Meses de associado para ter direito a voto</dt>
      <dd>{{ votingMinMonths > 0 ? `${votingMinMonths} ${votingMinMonths === 1 ? "mês" : "meses"}` : "Sem carência" }}</dd>
    </dl>

    <h3 class="section-title">Mensalidade</h3>
    <dl class="view-grid">
      <dt>Modo</dt>
      <dd>{{ MEMBERSHIP_MODE_LABEL[membershipMode] }}</dd>
      <template v-if="membershipMode === 'UNICO'">
        <dt>Valor da contribuição mensal</dt>
        <dd>{{ contributionAmount > 0 ? formatarMoeda(reaisParaCentavos(contributionAmount)) : "—" }}</dd>
      </template>
      <dt>Dia de vencimento</dt>
      <dd>{{ contributionDueDay || "—" }}</dd>
    </dl>

    <h3 class="section-title">Endereço</h3>
    <p v-if="!enderecoPreenchido()" class="group-desc">Nenhum endereço cadastrado.</p>
    <dl v-else class="view-grid">
      <dt>Rua</dt>
      <dd>{{ street }}{{ number ? `, ${number}` : "" }}</dd>
      <template v-if="complement">
        <dt>Complemento</dt>
        <dd>{{ complement }}</dd>
      </template>
      <dt>Bairro</dt>
      <dd>{{ district || "—" }}</dd>
      <dt>Cidade/UF</dt>
      <dd>{{ city }}/{{ state }}</dd>
      <dt>CEP</dt>
      <dd>{{ zipCode || "—" }}</dd>
    </dl>
  </div>

  <form v-else class="settings-group" @submit.prevent="handleSave">
    <h3>Dados institucionais</h3>
    <p v-if="!associationId" class="group-desc">
      Esta associação ainda não tem dados institucionais — preencha abaixo para o cadastro inicial.
    </p>
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field-grid">
      <div class="field full">
        <label class="field-label" for="legal-name">Razão social *</label>
        <input id="legal-name" v-model="legalName" type="text" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="trade-name">Nome fantasia</label>
        <input id="trade-name" v-model="tradeName" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="cnpj">CNPJ</label>
        <input id="cnpj" v-model="cnpj" type="text" placeholder="00.000.000/0000-00" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="foundation-date">Data de fundação</label>
        <input
          id="foundation-date"
          v-model="foundationDate"
          type="date"
          :disabled="saving || temSocioCadastrado"
        />
        <p v-if="temSocioCadastrado" class="field-hint">
          Já existe sócio cadastrado — a data de fundação não pode mais ser alterada (é o marco inicial do
          calendário de mensalidades).
        </p>
      </div>

      <div class="field">
        <label class="field-label" for="status">Situação</label>
        <select id="status" v-model="status" :disabled="saving">
          <option value="ATIVA">Ativa</option>
          <option value="INATIVA">Inativa</option>
          <option value="ENCERRADA">Encerrada</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="email">E-mail</label>
        <input id="email" v-model="email" type="email" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="phone">Telefone</label>
        <input id="phone" v-model="phone" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="website">Site</label>
        <input id="website" v-model="website" type="text" :disabled="saving" />
      </div>
    </div>

    <h3 class="section-title">Matrícula</h3>
    <div class="field full">
      <label class="checkbox-row">
        <input v-model="autoRegistrationNumber" type="checkbox" :disabled="saving" />
        Numeração automática (sequencial)
      </label>
      <p class="field-hint">
        {{
          autoRegistrationNumber
            ? "Ao registrar um sócio, o número da matrícula é gerado sozinho — o campo some da ficha de sócio."
            : "Ao registrar um sócio, o usuário informa o número da matrícula na ficha."
        }}
      </p>
    </div>

    <h3 class="section-title">Direito a voto</h3>
    <div class="field">
      <label class="field-label" for="voting-min-months">Meses de associado para ter direito a voto</label>
      <input id="voting-min-months" v-model.number="votingMinMonths" type="number" min="0" step="1" :disabled="saving" />
      <p class="field-hint">
        Tempo mínimo desde a data de associação para o sócio aparecer na lista de aptos a votar (além de estar
        Ativo e com a mensalidade em dia). Use 0 para não exigir carência.
      </p>
    </div>

    <h3 class="section-title">Mensalidade</h3>
    <p class="group-desc">
      Define como o valor da mensalidade de cada sócio é calculado, mês a mês, desde que entrou — sem cobrança
      pré-gerada: quem não tem pagamento registrado pra um mês já vencido aparece como devendo (ver tela Cobranças).
    </p>

    <div class="field full">
      <label class="field-label">Modo de mensalidade</label>
      <div class="radio-row">
        <label><input v-model="membershipMode" type="radio" value="UNICO" :disabled="saving" /> Plano único</label>
        <label><input v-model="membershipMode" type="radio" value="MULTIPLO" :disabled="saving" /> Múltiplos planos</label>
      </div>
    </div>

    <div class="field-grid">
      <div v-if="membershipMode === 'UNICO'" class="field">
        <label class="field-label" for="contribution-amount">Valor da contribuição mensal (R$)</label>
        <input id="contribution-amount" v-model.number="contributionAmount" type="number" step="0.01" min="0" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="contribution-due-day">Dia de vencimento</label>
        <input id="contribution-due-day" v-model.number="contributionDueDay" type="number" min="1" max="31" :disabled="saving" />
      </div>
    </div>

    <p v-if="membershipMode === 'MULTIPLO'" class="group-desc">
      Cada sócio passa a ser vinculado a um plano (aba Planos), e o valor sugerido nos pagamentos vem do plano dele —
      o dia de vencimento acima continua valendo pra todos, só o valor muda por plano.
    </p>

    <h3 class="section-title">Endereço</h3>

    <div class="field-grid">
      <div class="field full">
        <label class="field-label" for="street">Rua</label>
        <input id="street" v-model="street" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="number">Número</label>
        <input id="number" v-model="number" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="complement">Complemento</label>
        <input id="complement" v-model="complement" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="district">Bairro</label>
        <input id="district" v-model="district" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="city">Cidade</label>
        <input id="city" v-model="city" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="state">Estado (UF)</label>
        <input id="state" v-model="state" type="text" maxlength="2" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="zip-code">CEP</label>
        <input id="zip-code" v-model="zipCode" type="text" :disabled="saving" />
      </div>
    </div>

    <div class="save-row">
      <button v-if="associationId" type="button" class="btn-secondary" :disabled="saving" @click="cancelarEdicao">
        Cancelar
      </button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.settings-group {
  max-width: 760px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem 1.5rem;
  margin-top: 1rem;
}

.settings-group h3 {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.view-header h3 {
  margin: 0;
}

.view-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  row-gap: 0.55rem;
  font-size: 0.85rem;
  margin: 0;
}

.view-grid dt {
  color: var(--text-muted);
}

.view-grid dd {
  margin: 0;
  color: var(--text);
}

.section-title {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}

.group-desc {
  margin: 0 0 1rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.erro {
  margin: 0 0 1rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem 1rem;
}

.field.full {
  grid-column: 1 / -1;
  margin-bottom: 0.9rem;
}

.radio-row {
  display: flex;
  gap: 1.25rem;
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 400;
}

.radio-row label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 400;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field input,
.field select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled,
.field select:disabled {
  opacity: 0.6;
}

.field-hint {
  margin: 0.35rem 0 0;
  font-size: 0.76rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

.btn-primary {
  border: none;
  background: var(--accent);
  color: #fff;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
