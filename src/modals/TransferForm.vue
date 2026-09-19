<script setup lang="ts">
import { ref } from "vue";
import { CashTransactionModel } from "../models/CashTransaction.js";
import type { FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { reaisParaCentavos, hojeIso, formatarMoeda } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  contas: FinancialAccountComSaldo[];
  onSaved?: () => void;
}>();

const fromAccountId = ref(props.contas[0]?.id ?? "");
const toAccountId = ref(props.contas[1]?.id ?? "");
const amount = ref(0);
const transactionDate = ref(hojeIso());
const description = ref("Transferência entre contas");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!fromAccountId.value || !toAccountId.value) {
    erro.value = "Selecione a conta de origem e a de destino.";
    return;
  }
  if (fromAccountId.value === toAccountId.value) {
    erro.value = "A conta de origem e a de destino não podem ser a mesma.";
    return;
  }
  if (amount.value <= 0) {
    erro.value = "Informe um valor maior que zero.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await CashTransactionModel.transfer({
      from_account_id: fromAccountId.value,
      to_account_id: toAccountId.value,
      amount: reaisParaCentavos(amount.value),
      transaction_date: transactionDate.value,
      description: description.value.trim() || "Transferência entre contas",
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
  <form class="transfer-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="from-account">De *</label>
      <select id="from-account" v-model="fromAccountId" :disabled="saving" required>
        <option v-for="conta in contas" :key="conta.id" :value="conta.id">
          {{ conta.name }} ({{ formatarMoeda(conta.balance) }})
        </option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="to-account">Para *</label>
      <select id="to-account" v-model="toAccountId" :disabled="saving" required>
        <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="amount">Valor (R$) *</label>
      <input id="amount" v-model.number="amount" type="number" step="0.01" min="0.01" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="transaction-date">Data *</label>
      <input id="transaction-date" v-model="transactionDate" type="date" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="description">Descrição</label>
      <input id="description" v-model="description" type="text" :disabled="saving" />
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Transferir" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.transfer-form {
  min-width: 380px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
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
