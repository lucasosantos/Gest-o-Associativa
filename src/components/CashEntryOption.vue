<script setup lang="ts">
// Bloco "também lançar no caixa" dos formulários de patrimônio (compra,
// custo de manutenção, venda). `v-model` vale `null` enquanto a caixa não
// estiver marcada ou nenhuma conta tiver sido escolhida — quem usa só
// precisa repassar o valor pro model (`LancamentoCaixaBem`).
import { onMounted, ref, watch } from "vue";
import { FinancialAccountModel, type FinancialAccount } from "../models/FinancialAccount.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import type { LancamentoCaixaBem } from "../models/Asset.js";

const props = defineProps<{ label: string; disabled?: boolean }>();
const model = defineModel<LancamentoCaixaBem | null>({ default: null });

const lancar = ref(false);
const accountId = ref("");
const paymentMethodId = ref("");
const contas = ref<FinancialAccount[]>([]);
const formas = ref<PaymentMethod[]>([]);

onMounted(async () => {
  const [c, f] = await Promise.all([FinancialAccountModel.list(), PaymentMethodModel.list()]);
  contas.value = c.filter((conta) => conta.is_active);
  formas.value = f.filter((forma) => forma.is_active);
  if (contas.value.length === 1) accountId.value = contas.value[0].id;
});

watch([lancar, accountId, paymentMethodId], () => {
  model.value =
    lancar.value && accountId.value
      ? { financial_account_id: accountId.value, payment_method_id: paymentMethodId.value || null }
      : null;
});
</script>

<template>
  <div class="cash-entry">
    <label class="checkbox">
      <input v-model="lancar" type="checkbox" :disabled="props.disabled || contas.length === 0" />
      {{ props.label }}
    </label>
    <p v-if="contas.length === 0" class="hint">Cadastre uma conta financeira no Financeiro para lançar no caixa.</p>

    <div v-if="lancar" class="cash-fields">
      <div class="field">
        <label class="field-label" for="cash-account">Conta *</label>
        <select id="cash-account" v-model="accountId" :disabled="props.disabled">
          <option value="" disabled>Escolha a conta</option>
          <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="cash-payment-method">Forma de pagamento</label>
        <select id="cash-payment-method" v-model="paymentMethodId" :disabled="props.disabled">
          <option value="">Nenhuma</option>
          <option v-for="forma in formas" :key="forma.id" :value="forma.id">{{ forma.name }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cash-entry {
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  margin-bottom: 0.9rem;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
}

.hint {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.cash-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

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
</style>
