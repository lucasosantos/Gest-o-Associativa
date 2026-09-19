<script setup lang="ts">
// Acordo de renegociação: quita de uma vez, por um valor único (geralmente
// menor), as mensalidades vencidas selecionadas na aba Mensalidades da
// ficha do sócio (SocioDetalhes.vue, checkbox por linha VENCIDA). Não é
// uma redução do valor mensal daqui pra frente — só uma quitação em lote.
// Mesmo padrão de dropdown de livro (tipo RECIBO) + localStorage de
// MembershipPaymentForm.vue: o recibo do acordo também segue a numeração
// atômica de um livro de protocolo, um recibo só cobrindo todas as
// competências selecionadas.
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { MembershipAgreementModel } from "../models/MembershipAgreement.js";
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
const agreementDate = ref(hojeIso());
const negotiatedAmount = ref(0);
const paymentMethodId = ref("");
const protocolBookId = ref("");
const approvedBy = ref("");
const notes = ref("");

const contas = ref<FinancialAccountComSaldo[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);
const livrosRecibo = ref<ProtocolBook[]>([]);
const valorMensalVigente = ref(0);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const originalAmount = computed(() => valorMensalVigente.value * props.parcelas.length);
const desconto = computed(() => Math.max(0, originalAmount.value - reaisParaCentavos(negotiatedAmount.value)));

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
    valorMensalVigente.value = valorSugerido;
    negotiatedAmount.value = centavosParaReais(valorMensalVigente.value * props.parcelas.length);

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

  saving.value = true;
  erro.value = "";
  try {
    const acordo = await MembershipAgreementModel.criar(props.memberId, {
      parcela_ids: props.parcelas.map((p) => p.parcela_id),
      original_amount: originalAmount.value,
      negotiated_amount: reaisParaCentavos(negotiatedAmount.value),
      agreement_date: agreementDate.value,
      approved_by: approvedBy.value.trim() || null,
      notes: notes.value.trim() || null,
      financial_account_id: financialAccountId.value,
      payment_method_id: paymentMethodId.value || null,
      payment_method_label: formaEscolhida?.name ?? null,
      protocol_book_id: protocolBookId.value || null,
    });

    props.onSaved?.();
    closeModal();
    router.push({ name: "acordo-imprimir", params: { id: acordo.id } });
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <form v-else class="agreement-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p class="context">
      Acordo para <strong>{{ fullName }}</strong> — quita
      <strong>{{ parcelas.length }}</strong> mensalidade(s):
      {{ parcelas.map((p) => formatarCompetencia(p.competence_month)).join(", ") }}
    </p>

    <div v-if="contas.length === 0" class="state-msg">Cadastre uma conta financeira antes de registrar o acordo.</div>

    <template v-else>
      <dl class="resumo">
        <dt>Valor original das mensalidades</dt>
        <dd>{{ formatarMoeda(originalAmount) }}</dd>
        <dt v-if="desconto > 0">Desconto</dt>
        <dd v-if="desconto > 0">{{ formatarMoeda(desconto) }}</dd>
      </dl>

      <div class="field">
        <label class="field-label" for="financial-account">Conta financeira *</label>
        <select id="financial-account" v-model="financialAccountId" :disabled="saving" required>
          <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="agreement-date">Data do acordo *</label>
        <input id="agreement-date" v-model="agreementDate" type="date" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="negotiated-amount">Valor negociado (R$) *</label>
        <input
          id="negotiated-amount"
          v-model.number="negotiatedAmount"
          type="number"
          step="0.01"
          min="0.01"
          :disabled="saving"
          required
        />
      </div>

      <div class="field">
        <label class="field-label" for="payment-method">Forma de pagamento</label>
        <select id="payment-method" v-model="paymentMethodId" :disabled="saving">
          <option value="">Nenhuma</option>
          <option v-for="forma in formasPagamento" :key="forma.id" :value="forma.id">{{ forma.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="approved-by">Aprovado por</label>
        <input id="approved-by" v-model="approvedBy" type="text" placeholder="Ex.: nome do presidente/tesoureiro" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="notes">Observações</label>
        <textarea id="notes" v-model="notes" rows="2" :disabled="saving"></textarea>
      </div>

      <div class="field">
        <label class="field-label" for="protocol-book">Livro de recibo</label>
        <select id="protocol-book" v-model="protocolBookId" :disabled="saving">
          <option value="">Sem numeração automática</option>
          <option v-for="livro in livrosRecibo" :key="livro.id" :value="livro.id">
            {{ livro.name }} (próximo nº {{ livro.next_number }})
          </option>
        </select>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? "Salvando..." : "Confirmar acordo" }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.agreement-form {
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

.resumo {
  display: grid;
  grid-template-columns: 200px 1fr;
  row-gap: 0.4rem;
  font-size: 0.85rem;
  margin: 0 0 1rem;
  padding: 0.75rem 0.9rem;
  background: var(--bg);
  border-radius: 6px;
}

.resumo dt {
  color: var(--text-muted);
}

.resumo dd {
  margin: 0;
  color: var(--text);
  font-weight: 600;
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
.field select,
.field textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
}

.field input:disabled,
.field select:disabled,
.field textarea:disabled {
  opacity: 0.6;
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
