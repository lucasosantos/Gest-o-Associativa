<script setup lang="ts">
// "Pagar todas as vencidas"/selecionadas: mesmo formulário de
// MembershipPaymentForm.vue, mas quita várias parcelas de uma vez com
// `MembershipPaymentModel.pagarVarias` — UM lançamento no caixa com o total
// (como o acordo), e cada mês com seu pagamento (um recibo só pra todos, se um livro
// for escolhido), exigido pelo schema (`membership_payments` é 1:1 com
// `parcela_id`). Não é a mesma coisa que "Fazer acordo"
// (MembershipAgreementForm.vue): aqui cada mês é quitado pelo valor cheio,
// sem negociar um total. Tudo ou nada: se algum mês já estiver pago, nada é gravado.
import { useRouter } from "vue-router";
import { computed, onMounted, ref } from "vue";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import type { ProtocolBook } from "../models/ProtocolBook.js";
import { currentAssociationConfigId } from "../composables/useCurrentAssociation.js";
import { FinancialAccountModel, type FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import { centavosParaReais, reaisParaCentavos, formatarCompetencia, formatarMoeda, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  fullName: string;
  parcelas: { parcela_id: string; competence_month: string }[];
  onSaved?: () => void;
}>();
const router = useRouter();

const financialAccountId = ref("");
const paymentDate = ref(hojeIso());
const amountPerMonth = ref(0);
const paymentMethodId = ref("");
const protocolBookId = ref("");

const contas = ref<FinancialAccountComSaldo[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);
const livrosRecibo = ref<ProtocolBook[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const total = computed(() => reaisParaCentavos(amountPerMonth.value) * props.parcelas.length);

// Mesma chave de MembershipPaymentForm.vue: os dois lembram/sugerem o
// mesmo livro de recibo dessa associação.
function chaveLivroLembrado(): string {
  return `app:livro-recibo:${currentAssociationConfigId.value ?? "sem-associacao"}`;
}

function lerLivroLembrado(): string | null {
  try {
    return localStorage.getItem(chaveLivroLembrado());
  } catch {
    return null;
  }
}

onMounted(async () => {
  try {
    const [c, pm, valorSugerido, livros] = await Promise.all([
      FinancialAccountModel.list(),
      PaymentMethodModel.list(),
      MembershipPaymentModel.valorMensalSugerido(props.memberId),
      MembershipPaymentModel.listarLivrosRecibo(),
    ]);
    contas.value = c;
    formasPagamento.value = pm;
    livrosRecibo.value = livros;
    financialAccountId.value = c[0]?.id ?? "";
    amountPerMonth.value = centavosParaReais(valorSugerido);

    const lembrado = lerLivroLembrado();
    protocolBookId.value = lembrado && livros.some((l) => l.id === lembrado) ? lembrado : (livros[0]?.id ?? "");
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!financialAccountId.value) {
    erro.value = "Selecione a conta financeira.";
    return;
  }

  const formaEscolhida = formasPagamento.value.find((f) => f.id === paymentMethodId.value);
  const valorPago = reaisParaCentavos(amountPerMonth.value);

  saving.value = true;
  erro.value = "";
  try {
    const { primeiroPagamentoId } = await MembershipPaymentModel.pagarVarias(
      props.memberId,
      props.parcelas.map((parcela) => ({ parcela_id: parcela.parcela_id, amount: valorPago })),
      {
        financial_account_id: financialAccountId.value,
        payment_date: paymentDate.value,
        payment_method_id: paymentMethodId.value || null,
        payment_method_label: formaEscolhida?.name ?? null,
        protocol_book_id: protocolBookId.value || null,
      }
    );
    props.onSaved?.();
    closeModal();
    // Um recibo só, com todos os meses e o valor total — abre pra imprimir/enviar.
    router.push({ name: "recibo-imprimir", params: { id: primeiroPagamentoId } });
  } catch (error) {
    erro.value = `Não foi possível registrar o pagamento: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <form v-else class="payment-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p class="context">
      {{ fullName }} — quita <strong>{{ parcelas.length }}</strong> mensalidade(s), cada uma pelo valor cheio, num único lançamento no caixa:
      {{ parcelas.map((p) => formatarCompetencia(p.competence_month)).join(", ") }}
    </p>

    <div v-if="contas.length === 0" class="state-msg">Cadastre uma conta financeira antes de registrar o pagamento.</div>

    <template v-else>
      <div class="field">
        <label class="field-label" for="financial-account">Conta financeira *</label>
        <select id="financial-account" v-model="financialAccountId" :disabled="saving" required>
          <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="payment-date">Data do pagamento *</label>
        <input id="payment-date" v-model="paymentDate" type="date" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="amount">Valor de cada mensalidade (R$) *</label>
        <input id="amount" v-model.number="amountPerMonth" type="number" step="0.01" min="0.01" :disabled="saving" required />
        <p class="field-hint">Total: {{ formatarMoeda(total) }}</p>
      </div>

      <div class="field">
        <label class="field-label" for="payment-method">Forma de pagamento</label>
        <select id="payment-method" v-model="paymentMethodId" :disabled="saving">
          <option value="">Nenhuma</option>
          <option v-for="forma in formasPagamento" :key="forma.id" :value="forma.id">{{ forma.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="protocol-book">Livro de recibo</label>
        <select id="protocol-book" v-model="protocolBookId" :disabled="saving">
          <option value="">Sem numeração automática</option>
          <option v-for="livro in livrosRecibo" :key="livro.id" :value="livro.id">
            {{ livro.name }} (próximo nº {{ livro.next_number }})
          </option>
        </select>
        <p v-if="livrosRecibo.length === 0" class="field-hint">
          Nenhum livro do tipo RECIBO cadastrado — crie um em Documentos › Protocolos › Livros pra numerar os recibos automaticamente.
        </p>
        <p v-else class="field-hint">Gera UM recibo numerado com todos os meses e o valor total.</p>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? "Registrando..." : "Confirmar pagamentos" }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.payment-form {
  min-width: 400px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.context {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.field {
  margin-bottom: 0.9rem;
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
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
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
