<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { FinancialAccountModel, type FinancialAccountComSaldo, type ExtratoConta } from "../models/FinancialAccount.js";
import { FinancialCategoryModel, type FinancialCategory } from "../models/FinancialCategory.js";
import { CostCenterModel, type CostCenter } from "../models/CostCenter.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import {
  CashTransactionModel,
  codigoDoLancamento,
  totaisDoPeriodo,
  type CashTransactionComNomes,
  type CashTransactionRelatorio,
} from "../models/CashTransaction.js";
import { PayableModel, type PayableComFornecedor, type PayableInstallment } from "../models/Payable.js";
import { ReceivableModel, type ReceivableComOrigem, type ReceivableInstallment } from "../models/Receivable.js";
import { DonationModel, type DonationComDoador } from "../models/Donation.js";
import { MembershipServiceModel, type PrestacaoServicoRelatorio } from "../models/MembershipService.js";
import { formatarMoeda, formatarData, hojeIso } from "../utils/format.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import FinancialAccountForm from "../modals/FinancialAccountForm.vue";
import FinancialCategoryForm from "../modals/FinancialCategoryForm.vue";
import CostCenterForm from "../modals/CostCenterForm.vue";
import PaymentMethodForm from "../modals/PaymentMethodForm.vue";
import CashTransactionForm from "../modals/CashTransactionForm.vue";
import TransferForm from "../modals/TransferForm.vue";
import PayableForm from "../modals/PayableForm.vue";
import PayeeForm from "../modals/PayeeForm.vue";
import PayableInstallmentPaymentForm from "../modals/PayableInstallmentPaymentForm.vue";
import ReceivableForm from "../modals/ReceivableForm.vue";
import PayerForm from "../modals/PayerForm.vue";
import ReceivableInstallmentPaymentForm from "../modals/ReceivableInstallmentPaymentForm.vue";
import DonationForm from "../modals/DonationForm.vue";
import CashTransactionDeleteForm from "../modals/CashTransactionDeleteForm.vue";
import FinancialAccountRenameForm from "../modals/FinancialAccountRenameForm.vue";
import CashTransactionLinksModal from "../modals/CashTransactionLinksModal.vue";
import ConsistenciaForm from "../modals/ConsistenciaForm.vue";

// Contas a pagar e contas a receber viviam em telas próprias
// (`/contas-a-pagar`, `/contas-a-receber`) e passaram a ser abas daqui a
// pedido do usuário — financeiramente fazem parte do mesmo módulo.
type Aba =
  | "contas"
  | "lancamentos"
  | "a-pagar"
  | "a-receber"
  | "categorias"
  | "centros-de-custo"
  | "formas-de-pagamento"
  | "relatorios";

const router = useRouter();
const abaAtiva = ref<Aba>("contas");
const loading = ref(true);

const contas = ref<FinancialAccountComSaldo[]>([]);
const categorias = ref<FinancialCategory[]>([]);
const centrosCusto = ref<CostCenter[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);

/**
 * Filtro de conta da aba Lançamentos. `TODAS_AS_CONTAS` junta os lançamentos
 * de todas as contas numa lista só (padrão); `""` = ainda não escolhido
 * (estado logo depois de trocar de associação, ver `useAssociationScopedData`).
 */
const TODAS_AS_CONTAS = "TODAS";
const contaSelecionadaId = ref("");
const mostrandoTodasAsContas = computed(() => contaSelecionadaId.value === TODAS_AS_CONTAS);
/** Soma dos saldos de todas as contas — resumo exibido com "Todas as contas". */
const saldoSomado = computed(() => contas.value.reduce((total, conta) => total + conta.balance, 0));
const lancamentos = ref<CashTransactionComNomes[]>([]);
const carregandoLancamentos = ref(false);
/** Busca da aba Lançamentos: pelo código (`01-L-2026-000123`, ou só `123`) ou pela descrição. */
const buscaLancamento = ref("");
const lancamentosFiltrados = computed(() => {
  const termo = buscaLancamento.value.trim().toLowerCase();
  if (!termo) return lancamentos.value;
  return lancamentos.value.filter(
    (l) =>
      codigoDoLancamento(l).toLowerCase().includes(termo) ||
      String(l.numero ?? "") === termo.replace(/^0+/, "") ||
      l.description.toLowerCase().includes(termo)
  );
});

// --- Contas a pagar ---
const contasAPagar = ref<PayableComFornecedor[]>([]);
const parcelasPagarPorConta = reactive<Record<string, PayableInstallment[]>>({});
const expandidasPagar = reactive<Record<string, boolean>>({});

const STATUS_PAGAR_LABEL: Record<string, string> = {
  ABERTA: "Aberta",
  APROVACAO_PENDENTE: "Aguardando aprovação",
  PARCIAL: "Parcial",
  PAGA: "Paga",
  CANCELADA: "Cancelada",
};

const STATUS_PARCELA_PAGAR_LABEL: Record<string, string> = {
  ABERTA: "Aberta",
  PARCIAL: "Parcial",
  PAGA: "Paga",
  CANCELADA: "Cancelada",
};

// --- Contas a receber (com sub-aba de doações) ---
type AbaReceber = "a-receber" | "doacoes";
const abaReceberAtiva = ref<AbaReceber>("a-receber");

const contasAReceber = ref<ReceivableComOrigem[]>([]);
const parcelasReceberPorConta = reactive<Record<string, ReceivableInstallment[]>>({});
const expandidasReceber = reactive<Record<string, boolean>>({});
const doacoes = ref<DonationComDoador[]>([]);

const STATUS_RECEBER_LABEL: Record<string, string> = {
  ABERTA: "Aberta",
  PARCIAL: "Parcial",
  RECEBIDA: "Recebida",
  CANCELADA: "Cancelada",
};

// --- Relatórios (prestação de contas + extrato de conta) ---
type AbaRelatorio = "prestacao" | "extrato";
const abaRelatorioAtiva = ref<AbaRelatorio>("prestacao");

function primeiroDiaDoMes(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
}

const prestacaoInicio = ref(primeiroDiaDoMes());
const prestacaoFim = ref(hojeIso());
const prestacaoLancamentos = ref<CashTransactionRelatorio[]>([]);
const prestacaoGerada = ref(false);
const prestacaoTotais = computed(() => totaisDoPeriodo(prestacaoLancamentos.value));
const prestacaoCarregando = ref(false);
/** Mensalidades pagas com prestação de serviço no período (fora do caixa). */
const prestacaoServicos = ref<PrestacaoServicoRelatorio[]>([]);
const prestacaoTotalServicos = computed(() => prestacaoServicos.value.reduce((t, s) => t + s.reference_amount, 0));

const extratoContaId = ref("");
const extratoInicio = ref(primeiroDiaDoMes());
const extratoFim = ref(hojeIso());
const extratoDados = ref<ExtratoConta | null>(null);
const extratoCarregando = ref(false);

async function gerarPrestacaoContas() {
  prestacaoCarregando.value = true;
  try {
    [prestacaoLancamentos.value, prestacaoServicos.value] = await Promise.all([
      CashTransactionModel.listarPorPeriodo(prestacaoInicio.value, prestacaoFim.value),
      MembershipServiceModel.listarPorPeriodo(prestacaoInicio.value, prestacaoFim.value),
    ]);
    prestacaoGerada.value = true;
  } finally {
    prestacaoCarregando.value = false;
  }
}

function imprimirPrestacaoContas() {
  router.push({ name: "prestacao-contas-imprimir", query: { inicio: prestacaoInicio.value, fim: prestacaoFim.value } });
}

async function gerarExtrato() {
  if (!extratoContaId.value) return;
  extratoCarregando.value = true;
  try {
    extratoDados.value = await FinancialAccountModel.extrato(extratoContaId.value, extratoInicio.value, extratoFim.value);
  } finally {
    extratoCarregando.value = false;
  }
}

function imprimirExtrato() {
  if (!extratoContaId.value) return;
  router.push({
    name: "extrato-conta-imprimir",
    params: { id: extratoContaId.value },
    query: { inicio: extratoInicio.value, fim: extratoFim.value },
  });
}

async function carregarContas() {
  contas.value = await FinancialAccountModel.list();
  if (!contaSelecionadaId.value && contas.value[0]) {
    contaSelecionadaId.value = TODAS_AS_CONTAS;
  }
  if (!extratoContaId.value && contas.value[0]) {
    extratoContaId.value = contas.value[0].id;
  }
}

async function carregarCategorias() {
  categorias.value = await FinancialCategoryModel.list();
}

async function carregarCentrosCusto() {
  centrosCusto.value = await CostCenterModel.list();
}

async function carregarFormasPagamento() {
  formasPagamento.value = await PaymentMethodModel.list();
}

async function carregarLancamentos() {
  if (!contaSelecionadaId.value) {
    lancamentos.value = [];
    return;
  }
  carregandoLancamentos.value = true;
  try {
    lancamentos.value = mostrandoTodasAsContas.value
      ? await CashTransactionModel.list()
      : await CashTransactionModel.listByAccount(contaSelecionadaId.value);
  } finally {
    carregandoLancamentos.value = false;
  }
}

watch(contaSelecionadaId, carregarLancamentos);

async function carregarContasAPagar() {
  contasAPagar.value = await PayableModel.list();
}

async function alternarExpansaoPagar(contaId: string) {
  expandidasPagar[contaId] = !expandidasPagar[contaId];
  if (expandidasPagar[contaId] && !parcelasPagarPorConta[contaId]) {
    parcelasPagarPorConta[contaId] = await PayableModel.installments(contaId);
  }
}

async function recarregarParcelasPagar(contaId: string) {
  parcelasPagarPorConta[contaId] = await PayableModel.installments(contaId);
  await carregarContasAPagar();
}

async function carregarContasAReceber() {
  contasAReceber.value = await ReceivableModel.list();
}

async function carregarDoacoes() {
  doacoes.value = await DonationModel.list();
}

async function alternarExpansaoReceber(contaId: string) {
  expandidasReceber[contaId] = !expandidasReceber[contaId];
  if (expandidasReceber[contaId] && !parcelasReceberPorConta[contaId]) {
    parcelasReceberPorConta[contaId] = await ReceivableModel.installments(contaId);
  }
}

async function recarregarParcelasReceber(contaId: string) {
  parcelasReceberPorConta[contaId] = await ReceivableModel.installments(contaId);
  await carregarContasAReceber();
}

function abrirNovaConta() {
  openModal({ title: "Nova conta", component: FinancialAccountForm, props: { onSaved: carregarContas } });
}

function abrirNovaCategoria() {
  openModal({
    title: "Nova categoria",
    component: FinancialCategoryForm,
    props: { categorias: categorias.value, onSaved: carregarCategorias },
  });
}

function abrirNovoCentroCusto() {
  openModal({ title: "Novo centro de custo", component: CostCenterForm, props: { onSaved: carregarCentrosCusto } });
}

function abrirNovaFormaPagamento() {
  openModal({
    title: "Nova forma de pagamento",
    component: PaymentMethodForm,
    props: { onSaved: carregarFormasPagamento },
  });
}

/** Troca o nome da conta com motivo obrigatório (vai pra Atividades com o nome antigo). */
function abrirRenomearConta(conta: FinancialAccountComSaldo) {
  openModal({
    title: "Renomear conta",
    component: FinancialAccountRenameForm,
    props: { conta, onSaved: () => Promise.all([carregarContas(), carregarLancamentos()]) },
  });
}

function abrirNovoLancamento() {
  if (contas.value.length === 0) return;
  openModal({
    title: "Novo lançamento",
    component: CashTransactionForm,
    props: {
      // Com "Todas as contas", o formulário começa na primeira e deixa escolher.
      accountId: mostrandoTodasAsContas.value ? undefined : contaSelecionadaId.value,
      onSaved: () => Promise.all([carregarContas(), carregarLancamentos()]),
    },
  });
}

function abrirTransferencia() {
  openModal({
    title: "Transferência entre contas",
    component: TransferForm,
    props: { contas: contas.value, onSaved: () => Promise.all([carregarContas(), carregarLancamentos()]) },
  });
}

/** O que acontece com cada tipo de registro quando o lançamento que o quitava é estornado. */
const EFEITO_DESFAZER_BAIXAS =
  "• mensalidades voltam a ficar em aberto (acordo desfeito, recibo cancelado);\n" +
  "• parcela de conta a pagar/receber volta a ficar em aberto (ou parcial);\n" +
  "• doação é desfeita;\n" +
  "• evento de patrimônio continua, mas sem lançamento no caixa.";

async function estornar(lancamento: CashTransactionComNomes) {
  const quitacoes = lancamento.quitacoes_count ?? 0;
  const aviso =
    quitacoes > 0
      ? `\n\nEste lançamento quita ${quitacoes} registro(s). Ao estornar, eles também são desfeitos:\n${EFEITO_DESFAZER_BAIXAS}`
      : "";
  const avisoTransferencia = lancamento.transfer_group_id
    ? "\n\nÉ uma transferência: as DUAS contas são estornadas juntas (o dinheiro volta pra conta de origem)."
    : "";
  const confirmado = confirm(
    `Estornar o lançamento ${codigoDoLancamento(lancamento)} "${lancamento.description}"?${aviso}${avisoTransferencia}`
  );
  if (!confirmado) return;

  try {
    await CashTransactionModel.reverse(lancamento.id, "Estornado pelo usuário");
    await Promise.all([carregarContas(), carregarLancamentos()]);
  } catch (error) {
    alert(`Não foi possível estornar: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Só existe depois do estorno (lançamento `ESTORNADA` ou a linha de
 * `ESTORNO`): apaga o par de vez, com motivo registrado em Atividades — ver
 * `CashTransactionModel.apagarEstornado`.
 */
function podeApagar(lancamento: CashTransactionComNomes): boolean {
  return lancamento.status === "ESTORNADA" || lancamento.transaction_type === "ESTORNO";
}

/**
 * Lançamento estornado que ainda quita algum registro — só acontece com
 * estorno feito antes de o estorno passar a desfazer as baixas (ver
 * `CashTransactionModel.desfazerBaixas`).
 */
function precisaDesfazerBaixas(lancamento: CashTransactionComNomes): boolean {
  return lancamento.status === "ESTORNADA" && (lancamento.quitacoes_count ?? 0) > 0;
}

async function desfazerBaixas(lancamento: CashTransactionComNomes) {
  const confirmado = confirm(
    `O lançamento "${lancamento.description}" já foi estornado, mas ${lancamento.quitacoes_count} registro(s) ` +
      `continuam quitados por ele.\n\nDesfazer agora?\n${EFEITO_DESFAZER_BAIXAS}`
  );
  if (!confirmado) return;

  try {
    await CashTransactionModel.desfazerBaixas(lancamento.id);
    await carregarLancamentos();
  } catch (error) {
    alert(`Não foi possível desfazer as baixas: ${error instanceof Error ? error.message : error}`);
  }
}

function abrirVinculos(lancamento: CashTransactionComNomes) {
  openModal({
    title: `Lançamento ${codigoDoLancamento(lancamento)}`,
    component: CashTransactionLinksModal,
    props: { lancamento },
  });
}

/** Verificação/correção de inconsistências do financeiro (ver `ConsistenciaModel`). */
function abrirConsistencia() {
  openModal({
    title: "Verificar consistência do financeiro",
    component: ConsistenciaForm,
    props: { onSaved: () => Promise.all([carregarContas(), carregarLancamentos(), carregarContasAPagar(), carregarContasAReceber(), carregarDoacoes()]) },
  });
}

function abrirApagarLancamento(lancamento: CashTransactionComNomes) {
  openModal({
    title: "Apagar lançamento estornado",
    component: CashTransactionDeleteForm,
    props: { lancamento, onSaved: () => Promise.all([carregarContas(), carregarLancamentos()]) },
  });
}

function abrirNovaContaPagar() {
  openModal({ title: "Nova conta a pagar", component: PayableForm, props: { onSaved: carregarContasAPagar } });
}

function abrirNovoFornecedor() {
  openModal({ title: "Novo fornecedor", component: PayeeForm, props: {} });
}

function abrirBaixaParcelaPagar(conta: PayableComFornecedor, parcela: PayableInstallment) {
  openModal({
    title: "Pagar parcela",
    component: PayableInstallmentPaymentForm,
    props: {
      installment: parcela,
      payableDescription: conta.description,
      onSaved: () => recarregarParcelasPagar(conta.id),
    },
  });
}

function abrirNovaContaReceber() {
  openModal({ title: "Nova conta a receber", component: ReceivableForm, props: { onSaved: carregarContasAReceber } });
}

function abrirNovoPagador() {
  openModal({ title: "Novo pagador", component: PayerForm, props: {} });
}

function abrirNovaDoacao() {
  openModal({ title: "Nova doação", component: DonationForm, props: { onSaved: carregarDoacoes } });
}

function abrirBaixaParcelaReceber(conta: ReceivableComOrigem, parcela: ReceivableInstallment) {
  openModal({
    title: "Registrar recebimento",
    component: ReceivableInstallmentPaymentForm,
    props: {
      installment: parcela,
      receivableDescription: conta.description,
      onSaved: () => recarregarParcelasReceber(conta.id),
    },
  });
}

function atualizarSidebar() {
  if (abaAtiva.value === "a-receber") {
    setSidebarTools(
      abaReceberAtiva.value === "a-receber"
        ? [
            {
              group: "Contas a receber",
              items: [
                { id: "nova-conta-receber", label: "Nova conta a receber", icon: "plus", onClick: abrirNovaContaReceber },
                { id: "novo-pagador", label: "Novo pagador", icon: "plus", onClick: abrirNovoPagador },
              ],
            },
          ]
        : [{ group: "Doações", items: [{ id: "nova-doacao", label: "Nova doação", icon: "plus", onClick: abrirNovaDoacao }] }]
    );
    return;
  }

  const itensPorAba: Record<Exclude<Aba, "a-receber">, { id: string; label: string; icon: string; onClick: () => void }[]> = {
    contas: [
      { id: "nova-conta", label: "Nova conta", icon: "plus", onClick: abrirNovaConta },
      { id: "consistencia", label: "Verificar consistência", icon: "alert", onClick: abrirConsistencia },
    ],
    lancamentos: [
      { id: "novo-lancamento", label: "Novo lançamento", icon: "plus", onClick: abrirNovoLancamento },
      { id: "transferencia", label: "Transferência", icon: "list", onClick: abrirTransferencia },
      { id: "consistencia", label: "Verificar consistência", icon: "alert", onClick: abrirConsistencia },
    ],
    "a-pagar": [
      { id: "nova-conta-pagar", label: "Nova conta a pagar", icon: "plus", onClick: abrirNovaContaPagar },
      { id: "novo-fornecedor", label: "Novo fornecedor", icon: "plus", onClick: abrirNovoFornecedor },
    ],
    categorias: [{ id: "nova-categoria", label: "Nova categoria", icon: "plus", onClick: abrirNovaCategoria }],
    "centros-de-custo": [
      { id: "novo-centro-custo", label: "Novo centro de custo", icon: "plus", onClick: abrirNovoCentroCusto },
    ],
    "formas-de-pagamento": [
      { id: "nova-forma-pagamento", label: "Nova forma de pagamento", icon: "plus", onClick: abrirNovaFormaPagamento },
    ],
    relatorios: [],
  };

  setSidebarTools([{ group: "Financeiro", items: itensPorAba[abaAtiva.value] }]);
}

watch([abaAtiva, abaReceberAtiva], () => {
  atualizarSidebar();
  if (abaAtiva.value === "lancamentos") carregarLancamentos();
});

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  CONFIRMADA: "Confirmada",
  ESTORNADA: "Estornada",
  CANCELADA: "Cancelada",
};

const TIPO_LABEL: Record<string, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
  TRANSFERENCIA_ENTRADA: "Transf. (entrada)",
  TRANSFERENCIA_SAIDA: "Transf. (saída)",
  ESTORNO: "Estorno",
};

useAssociationScopedData(async () => {
  loading.value = true;
  try {
    // Associação pode ter mudado (ver useAssociationScopedData) — contas
    // antigas não valem mais nada aqui, senão o próximo carregarLancamentos
    // ainda filtraria pela conta selecionada da associação anterior.
    contaSelecionadaId.value = "";
    extratoContaId.value = "";
    await Promise.all([
      carregarContas(),
      carregarCategorias(),
      carregarCentrosCusto(),
      carregarFormasPagamento(),
      carregarContasAPagar(),
      carregarContasAReceber(),
      carregarDoacoes(),
    ]);
    await carregarLancamentos();
  } finally {
    loading.value = false;
  }
});

onMounted(atualizarSidebar);
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Financeiro</h2>
        <p>Contas, categorias, centros de custo, fluxo de caixa e contas a pagar/receber da associação.</p>
      </div>
    </div>

    <div class="tabs">
      <button
        v-for="aba in ['contas', 'lancamentos', 'a-pagar', 'a-receber', 'categorias', 'centros-de-custo', 'formas-de-pagamento', 'relatorios'] as const"
        :key="aba"
        class="tab"
        :class="{ active: abaAtiva === aba }"
        type="button"
        @click="abaAtiva = aba"
      >
        {{
          {
            contas: "Contas",
            lancamentos: "Lançamentos",
            "a-pagar": "A pagar",
            "a-receber": "A receber",
            categorias: "Categorias",
            "centros-de-custo": "Centros de custo",
            "formas-de-pagamento": "Formas de pagamento",
            relatorios: "Relatórios",
          }[aba]
        }}
      </button>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>

    <div v-else class="tab-content">
      <div v-if="abaAtiva === 'contas'">
        <p v-if="contas.length === 0" class="state-msg">Nenhuma conta cadastrada ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Saldo atual</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="conta in contas" :key="conta.id">
              <td>{{ conta.name }}</td>
              <td>{{ conta.account_type }}</td>
              <td :class="{ negativo: conta.balance < 0 }">{{ formatarMoeda(conta.balance) }}</td>
              <td>
                <button type="button" class="link-btn" @click="abrirRenomearConta(conta)">Renomear</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'lancamentos'">
        <p v-if="contas.length === 0" class="state-msg">Cadastre uma conta antes de lançar movimentos.</p>
        <template v-else>
          <div class="filter-row">
            <label class="field-label" for="conta-filtro">Conta</label>
            <select id="conta-filtro" v-model="contaSelecionadaId">
              <option :value="TODAS_AS_CONTAS">Todas as contas</option>
              <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
            </select>
            <input
              v-model="buscaLancamento"
              type="search"
              class="busca-lancamento"
              placeholder="Buscar por nº/código ou descrição"
            />
            <span v-if="mostrandoTodasAsContas" class="saldo-somado">
              Saldo somado das {{ contas.length }} conta(s):
              <strong :class="{ negativo: saldoSomado < 0 }">{{ formatarMoeda(saldoSomado) }}</strong>
            </span>
          </div>

          <div v-if="carregandoLancamentos" class="state-msg">Carregando...</div>
          <p v-else-if="lancamentos.length === 0" class="state-msg">
            {{ mostrandoTodasAsContas ? "Nenhum lançamento ainda." : "Nenhum lançamento nesta conta." }}
          </p>
          <p v-else-if="lancamentosFiltrados.length === 0" class="state-msg">Nenhum lançamento encontrado na busca.</p>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Data</th>
                <th v-if="mostrandoTodasAsContas">Conta</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th :title="mostrandoTodasAsContas ? 'Saldo somado de todas as contas logo depois deste lançamento' : 'Saldo da conta logo depois deste lançamento'">
                  Saldo após
                </th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lancamento in lancamentosFiltrados" :key="lancamento.id">
                <td class="codigo">
                  <button type="button" class="link-btn" title="Ver o que este lançamento quita" @click="abrirVinculos(lancamento)">
                    {{ codigoDoLancamento(lancamento) }}
                  </button>
                </td>
                <td>{{ formatarData(lancamento.transaction_date) }}</td>
                <td v-if="mostrandoTodasAsContas">{{ lancamento.account_name }}</td>
                <td>{{ lancamento.description }}</td>
                <td>{{ TIPO_LABEL[lancamento.transaction_type] }}</td>
                <td>{{ lancamento.category_name || "—" }}</td>
                <td :class="{ negativo: lancamento.transaction_type === 'DESPESA' || lancamento.transaction_type === 'TRANSFERENCIA_SAIDA' }">
                  {{ formatarMoeda(lancamento.amount) }}
                </td>
                <td class="saldo-apos" :class="{ negativo: (lancamento.saldo_apos ?? 0) < 0 }">
                  {{ lancamento.saldo_apos === null || lancamento.saldo_apos === undefined ? "—" : formatarMoeda(lancamento.saldo_apos) }}
                </td>
                <td>{{ STATUS_LABEL[lancamento.status] }}</td>
                <td>
                  <button
                    v-if="lancamento.status === 'CONFIRMADA' && lancamento.transaction_type !== 'ESTORNO'"
                    type="button"
                    class="link-btn"
                    @click="estornar(lancamento)"
                  >
                    Estornar
                  </button>
                  <button
                    v-else-if="precisaDesfazerBaixas(lancamento)"
                    type="button"
                    class="link-btn"
                    title="O caixa já foi estornado, mas o que ele pagava (mensalidades, conta, doação...) continua quitado"
                    @click="desfazerBaixas(lancamento)"
                  >
                    Desfazer baixas
                  </button>
                  <button
                    v-else-if="podeApagar(lancamento)"
                    type="button"
                    class="link-btn link-perigo"
                    title="Apaga este lançamento e o estorno dele; fica registrado em Atividades"
                    @click="abrirApagarLancamento(lancamento)"
                  >
                    Apagar
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <div v-else-if="abaAtiva === 'a-pagar'">
        <p v-if="contasAPagar.length === 0" class="state-msg">Nenhuma conta a pagar cadastrada.</p>
        <div v-else class="expandable-list">
          <div v-for="conta in contasAPagar" :key="conta.id" class="expandable-card">
            <button type="button" class="expandable-header" @click="alternarExpansaoPagar(conta.id)">
              <div>
                <strong>{{ conta.description }}</strong>
                <span class="muted"> — {{ conta.payee_name || "sem fornecedor" }}</span>
              </div>
              <div class="header-right">
                <span>{{ formatarMoeda(conta.total_amount) }}</span>
                <span class="badge">{{ STATUS_PAGAR_LABEL[conta.status] }}</span>
              </div>
            </button>

            <div v-if="expandidasPagar[conta.id]" class="installments">
              <table v-if="parcelasPagarPorConta[conta.id]" class="data-table nested">
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Pago</th>
                    <th>Situação</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="parcela in parcelasPagarPorConta[conta.id]" :key="parcela.id">
                    <td>{{ parcela.installment_number }}</td>
                    <td>{{ formatarData(parcela.due_date) }}</td>
                    <td>{{ formatarMoeda(parcela.original_amount + parcela.interest_amount - parcela.discount_amount) }}</td>
                    <td>{{ formatarMoeda(parcela.paid_amount) }}</td>
                    <td>{{ STATUS_PARCELA_PAGAR_LABEL[parcela.status] }}</td>
                    <td>
                      <button
                        v-if="parcela.status === 'ABERTA' || parcela.status === 'PARCIAL'"
                        type="button"
                        class="link-btn"
                        @click="abrirBaixaParcelaPagar(conta, parcela)"
                      >
                        Pagar
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="state-msg">Carregando parcelas...</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="abaAtiva === 'a-receber'">
        <div class="tabs nested-tabs">
          <button class="tab" :class="{ active: abaReceberAtiva === 'a-receber' }" type="button" @click="abaReceberAtiva = 'a-receber'">
            A receber
          </button>
          <button class="tab" :class="{ active: abaReceberAtiva === 'doacoes' }" type="button" @click="abaReceberAtiva = 'doacoes'">
            Doações
          </button>
        </div>

        <div v-if="abaReceberAtiva === 'a-receber'">
          <p v-if="contasAReceber.length === 0" class="state-msg">Nenhuma conta a receber cadastrada.</p>
          <div v-else class="expandable-list">
            <div v-for="conta in contasAReceber" :key="conta.id" class="expandable-card">
              <button type="button" class="expandable-header" @click="alternarExpansaoReceber(conta.id)">
                <div>
                  <strong>{{ conta.description }}</strong>
                  <span class="muted"> — {{ conta.member_name || conta.payer_name || "sem origem" }}</span>
                </div>
                <div class="header-right">
                  <span>{{ formatarMoeda(conta.total_amount) }}</span>
                  <span class="badge">{{ STATUS_RECEBER_LABEL[conta.status] }}</span>
                </div>
              </button>

              <div v-if="expandidasReceber[conta.id]" class="installments">
                <table v-if="parcelasReceberPorConta[conta.id]" class="data-table nested">
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th>Valor</th>
                      <th>Recebido</th>
                      <th>Situação</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="parcela in parcelasReceberPorConta[conta.id]" :key="parcela.id">
                      <td>{{ parcela.installment_number }}</td>
                      <td>{{ formatarData(parcela.due_date) }}</td>
                      <td>{{ formatarMoeda(parcela.original_amount + parcela.interest_amount - parcela.discount_amount) }}</td>
                      <td>{{ formatarMoeda(parcela.received_amount) }}</td>
                      <td>{{ STATUS_RECEBER_LABEL[parcela.status] }}</td>
                      <td>
                        <button
                          v-if="parcela.status === 'ABERTA' || parcela.status === 'PARCIAL'"
                          type="button"
                          class="link-btn"
                          @click="abrirBaixaParcelaReceber(conta, parcela)"
                        >
                          Receber
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="state-msg">Carregando parcelas...</p>
              </div>
            </div>
          </div>
        </div>

        <div v-else>
          <p v-if="doacoes.length === 0" class="state-msg">Nenhuma doação registrada.</p>
          <table v-else class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Doador</th>
                <th>Valor</th>
                <th>Tipo</th>
                <th>Finalidade</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doacao in doacoes" :key="doacao.id">
                <td>{{ formatarData(doacao.donation_date) }}</td>
                <td>{{ doacao.donor_name || "—" }}</td>
                <td>{{ formatarMoeda(doacao.amount) }}</td>
                <td>{{ doacao.donation_type || "—" }}</td>
                <td>{{ doacao.purpose || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="abaAtiva === 'categorias'">
        <p v-if="categorias.length === 0" class="state-msg">Nenhuma categoria cadastrada ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Categoria superior</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="categoria in categorias" :key="categoria.id">
              <td>{{ categoria.name }}</td>
              <td>{{ categoria.category_type }}</td>
              <td>{{ categorias.find((c) => c.id === categoria.parent_id)?.name || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'centros-de-custo'">
        <p v-if="centrosCusto.length === 0" class="state-msg">Nenhum centro de custo cadastrado ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="centro in centrosCusto" :key="centro.id">
              <td>{{ centro.name }}</td>
              <td>{{ centro.code || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'formas-de-pagamento'">
        <p v-if="formasPagamento.length === 0" class="state-msg">Nenhuma forma de pagamento cadastrada ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="forma in formasPagamento" :key="forma.id">
              <td>{{ forma.name }}</td>
              <td>{{ forma.method_type }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'relatorios'">
        <div class="tabs nested-tabs">
          <button
            class="tab"
            :class="{ active: abaRelatorioAtiva === 'prestacao' }"
            type="button"
            @click="abaRelatorioAtiva = 'prestacao'"
          >
            Prestação de contas
          </button>
          <button
            class="tab"
            :class="{ active: abaRelatorioAtiva === 'extrato' }"
            type="button"
            @click="abaRelatorioAtiva = 'extrato'"
          >
            Extrato de conta
          </button>
        </div>

        <div v-if="abaRelatorioAtiva === 'prestacao'">
          <p class="relatorio-hint">Todos os lançamentos confirmados da associação (todas as contas) no período.</p>
          <div class="filter-row">
            <label class="field-label" for="prestacao-inicio">De</label>
            <input id="prestacao-inicio" v-model="prestacaoInicio" type="date" />
            <label class="field-label" for="prestacao-fim">Até</label>
            <input id="prestacao-fim" v-model="prestacaoFim" type="date" />
            <button type="button" class="btn-secondary" :disabled="prestacaoCarregando" @click="gerarPrestacaoContas">
              {{ prestacaoCarregando ? "Gerando..." : "Gerar" }}
            </button>
            <button
              v-if="prestacaoGerada"
              type="button"
              class="btn-secondary"
              @click="imprimirPrestacaoContas"
            >
              Imprimir
            </button>
          </div>

          <template v-if="prestacaoGerada">
            <p v-if="prestacaoLancamentos.length === 0" class="state-msg">Nenhum lançamento neste período.</p>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Conta</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="lancamento in prestacaoLancamentos" :key="lancamento.id">
                  <td class="codigo">{{ codigoDoLancamento(lancamento) }}</td>
                  <td>{{ formatarData(lancamento.transaction_date) }}</td>
                  <td>{{ lancamento.account_name }}</td>
                  <td>{{ lancamento.category_name || "—" }}</td>
                  <td>{{ lancamento.description }}</td>
                  <td :class="{ negativo: lancamento.signed_amount < 0 }">{{ formatarMoeda(lancamento.signed_amount) }}</td>
                </tr>
              </tbody>
            </table>
            <dl v-if="prestacaoLancamentos.length > 0" class="resumo-extrato">
              <dt>Entradas</dt>
              <dd>{{ formatarMoeda(prestacaoTotais.entradas) }}</dd>
              <dt>Saídas</dt>
              <dd>{{ formatarMoeda(prestacaoTotais.saidas) }}</dd>
              <dt>Resultado</dt>
              <dd :class="{ negativo: prestacaoTotais.saldo < 0 }">{{ formatarMoeda(prestacaoTotais.saldo) }}</dd>
              <template v-if="prestacaoTotais.transferido > 0">
                <dt>Transferido entre contas</dt>
                <dd>{{ formatarMoeda(prestacaoTotais.transferido) }}</dd>
              </template>
            </dl>

            <template v-if="prestacaoServicos.length > 0">
              <h3 class="titulo-servicos">Mensalidades pagas com prestação de serviço (fora do caixa)</h3>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Data</th>
                    <th>Sócio</th>
                    <th>Serviço</th>
                    <th>Meses</th>
                    <th>Mensalidade</th>
                    <th>Valor do serviço</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="servico in prestacaoServicos" :key="servico.id">
                    <td class="codigo">{{ servico.codigo }}</td>
                    <td>{{ formatarData(servico.service_date) }}</td>
                    <td>{{ servico.full_name }}</td>
                    <td>{{ servico.description }}</td>
                    <td>{{ servico.months_count }}</td>
                    <td>{{ formatarMoeda(servico.valor_mensal) }}</td>
                    <td>{{ formatarMoeda(servico.reference_amount) }}</td>
                  </tr>
                </tbody>
              </table>
              <dl class="resumo-extrato">
                <dt>Total em serviços (meses × mensalidade, não soma no saldo)</dt>
                <dd>{{ formatarMoeda(prestacaoTotalServicos) }}</dd>
              </dl>
            </template>
          </template>
        </div>

        <div v-else>
          <p class="relatorio-hint">Saldo inicial, movimentações e saldo final de uma conta específica no período.</p>
          <div class="filter-row">
            <label class="field-label" for="extrato-conta">Conta</label>
            <select id="extrato-conta" v-model="extratoContaId">
              <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <label class="field-label" for="extrato-inicio">De</label>
            <input id="extrato-inicio" v-model="extratoInicio" type="date" />
            <label class="field-label" for="extrato-fim">Até</label>
            <input id="extrato-fim" v-model="extratoFim" type="date" />
            <button type="button" class="btn-secondary" :disabled="extratoCarregando || !extratoContaId" @click="gerarExtrato">
              {{ extratoCarregando ? "Gerando..." : "Gerar" }}
            </button>
            <button v-if="extratoDados" type="button" class="btn-secondary" @click="imprimirExtrato">Imprimir</button>
          </div>

          <template v-if="extratoDados">
            <dl class="resumo-extrato">
              <dt>Saldo inicial</dt>
              <dd>{{ formatarMoeda(extratoDados.saldo_inicial) }}</dd>
              <dt>Saldo final</dt>
              <dd :class="{ negativo: extratoDados.saldo_final < 0 }">{{ formatarMoeda(extratoDados.saldo_final) }}</dd>
            </dl>

            <p v-if="extratoDados.movimentos.length === 0" class="state-msg">Nenhuma movimentação neste período.</p>
            <table v-else class="data-table">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Data</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Saldo após</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="movimento in extratoDados.movimentos" :key="movimento.id">
                  <td class="codigo">{{ codigoDoLancamento(movimento) }}</td>
                  <td>{{ formatarData(movimento.transaction_date) }}</td>
                  <td>{{ movimento.category_name || "—" }}</td>
                  <td>{{ movimento.description }}</td>
                  <td :class="{ negativo: movimento.signed_amount < 0 }">{{ formatarMoeda(movimento.signed_amount) }}</td>
                  <td :class="{ negativo: (movimento.saldo_apos ?? 0) < 0 }">{{ formatarMoeda(movimento.saldo_apos ?? 0) }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.codigo {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
  white-space: nowrap;
}

.saldo-apos {
  white-space: nowrap;
  color: var(--text-muted);
}

.busca-lancamento {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  min-width: 220px;
}

.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 1rem 0 1.25rem;
  flex-wrap: wrap;
}

.nested-tabs {
  margin-top: 0;
}

.tab {
  padding: 0.55rem 0.9rem;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab-content {
  max-width: 900px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.filter-row select,
.filter-row input {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.relatorio-hint {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.titulo-servicos {
  margin: 1.25rem 0 0.5rem;
  font-size: 0.9rem;
}

.resumo-extrato {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 0.3rem 1.5rem;
  margin: 0 0 1rem;
  font-size: 0.88rem;
}

.resumo-extrato dt {
  color: var(--text-muted);
}

.resumo-extrato dd {
  margin: 0;
  font-weight: 600;
  color: var(--text);
}

.field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.65rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table.nested {
  border: none;
  border-radius: 0;
  font-size: 0.82rem;
}

.data-table.nested th,
.data-table.nested td {
  padding: 0.4rem 0.6rem;
}

.negativo {
  color: #c0392b;
}

/* Resumo ao lado do filtro quando a aba Lançamentos mostra todas as contas juntas. */
.saldo-somado {
  margin-left: auto;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.saldo-somado strong {
  color: var(--text);
}

.saldo-somado strong.negativo {
  color: #c0392b;
}

.btn-secondary {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

/* Ação destrutiva (apagar lançamento estornado): mesmo vermelho dos erros do app. */
.link-btn.link-perigo {
  color: #c0392b;
}

.expandable-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.expandable-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.expandable-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text);
  font-family: inherit;
  text-align: left;
}

.expandable-header:hover {
  background: var(--surface-hover);
}

.muted {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
}

.badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--surface-hover);
  color: var(--text-muted);
}

.installments {
  padding: 0 1rem 1rem;
  border-top: 1px solid var(--border);
}
</style>
