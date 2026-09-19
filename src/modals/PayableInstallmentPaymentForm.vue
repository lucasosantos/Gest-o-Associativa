<script setup lang="ts">
import { onMounted, ref } from "vue";
import { PayableModel, type PayableInstallment } from "../models/Payable.js";
import { FinancialAccountModel, type FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import { centavosParaReais, reaisParaCentavos, formatarMoeda, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  installment: PayableInstallment;
  payableDescription: string;
  onSaved?: () => void;
}>();

const restante =
  props.installment.original_amount +
  props.installment.interest_amount -
  props.installment.discount_amount -
  props.installment.paid_amount;

const financialAccountId = ref("");
const paymentDate = ref(hojeIso());
const amount = ref(centavosParaReais(restante));
const paymentMethodId = ref("");

const contas = ref<FinancialAccountComSaldo[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    const [c, pm] = await Promise.all([FinancialAccountModel.list(), PaymentMethodModel.list()]);
    contas.value = c;
    formasPagamento.value = pm;
    financialAccountId.value = c[0]?.id ?? "";
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!financialAccountId.value) {
    erro.value = "Selecione a conta financeira.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await PayableModel.payInstallment(props.installment.id, {
      financial_account_id: financialAccountId.value,
      payment_date: paymentDate.value,
      amount: reaisParaCentavos(amount.value),
      payment_method_id: paymentMethodId.value || null,
    });

    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
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
      Parcela {{ installment.installment_number }} de <strong>{{ payableDescription }}</strong> — saldo restante
      {{ formatarMoeda(restante) }}
    </p>

    <div v-if="contas.length === 0" class="state-msg">Cadastre uma conta financeira antes de registrar a baixa.</div>

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
        <label class="field-label" for="amount">Valor pago (R$) *</label>
        <input id="amount" v-model.number="amount" type="number" step="0.01" min="0.01" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="payment-method">Forma de pagamento</label>
        <select id="payment-method" v-model="paymentMethodId" :disabled="saving">
          <option value="">Nenhuma</option>
          <option v-for="forma in formasPagamento" :key="forma.id" :value="forma.id">{{ forma.name }}</option>
        </select>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? "Salvando..." : "Confirmar pagamento" }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.payment-form {
  min-width: 360px;
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
