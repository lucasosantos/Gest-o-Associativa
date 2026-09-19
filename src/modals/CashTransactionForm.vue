<script setup lang="ts">
// Lançamento manual de receita ou despesa numa conta específica.
// Transferências entre contas usam TransferForm.vue; estornos são feitos
// direto na lista (CashTransactionModel.reverse), sem formulário próprio.
import { computed, onMounted, ref } from "vue";
import { CashTransactionModel } from "../models/CashTransaction.js";
import { FinancialCategoryModel, type FinancialCategory } from "../models/FinancialCategory.js";
import { CostCenterModel, type CostCenter } from "../models/CostCenter.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import { reaisParaCentavos, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  accountId: string;
  onSaved?: () => void;
}>();

const transactionType = ref<"RECEITA" | "DESPESA">("RECEITA");
const amount = ref(0);
const transactionDate = ref(hojeIso());
const competenceDate = ref(hojeIso());
const description = ref("");
const categoryId = ref("");
const costCenterId = ref("");
const paymentMethodId = ref("");

const categorias = ref<FinancialCategory[]>([]);
const centrosCusto = ref<CostCenter[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const categoriasFiltradas = computed(() =>
  categorias.value.filter((c) => c.category_type === transactionType.value)
);

onMounted(async () => {
  try {
    const [c, cc, pm] = await Promise.all([
      FinancialCategoryModel.list(),
      CostCenterModel.list(),
      PaymentMethodModel.list(),
    ]);
    categorias.value = c;
    centrosCusto.value = cc;
    formasPagamento.value = pm;
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!description.value.trim() || amount.value <= 0) {
    erro.value = "Informe a descrição e um valor maior que zero.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await CashTransactionModel.create({
      financial_account_id: props.accountId,
      transaction_type: transactionType.value,
      amount: reaisParaCentavos(amount.value),
      transaction_date: transactionDate.value,
      competence_date: competenceDate.value || transactionDate.value,
      description: description.value.trim(),
      financial_category_id: categoryId.value || null,
      cost_center_id: costCenterId.value || null,
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

  <form v-else class="transaction-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="transaction-type">Tipo</label>
      <select id="transaction-type" v-model="transactionType" :disabled="saving">
        <option value="RECEITA">Receita</option>
        <option value="DESPESA">Despesa</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="description">Descrição *</label>
      <input id="description" v-model="description" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="amount">Valor (R$) *</label>
      <input id="amount" v-model.number="amount" type="number" step="0.01" min="0.01" :disabled="saving" required />
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label" for="transaction-date">Data do movimento *</label>
        <input id="transaction-date" v-model="transactionDate" type="date" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="competence-date">Data de competência</label>
        <input id="competence-date" v-model="competenceDate" type="date" :disabled="saving" />
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="category">Categoria</label>
      <select id="category" v-model="categoryId" :disabled="saving">
        <option value="">Nenhuma</option>
        <option v-for="categoria in categoriasFiltradas" :key="categoria.id" :value="categoria.id">
          {{ categoria.name }}
        </option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="cost-center">Centro de custo</label>
      <select id="cost-center" v-model="costCenterId" :disabled="saving">
        <option value="">Nenhum</option>
        <option v-for="centro in centrosCusto" :key="centro.id" :value="centro.id">{{ centro.name }}</option>
      </select>
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
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.transaction-form {
  min-width: 380px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.field {
  margin-bottom: 0.9rem;
  flex: 1;
}

.field-row {
  display: flex;
  gap: 1rem;
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
