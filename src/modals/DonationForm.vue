<script setup lang="ts">
import { onMounted, ref } from "vue";
import { DonationModel } from "../models/Donation.js";
import { FinancialAccountModel, type FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { FinancialCategoryModel, type FinancialCategory } from "../models/FinancialCategory.js";
import { reaisParaCentavos, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const donorName = ref("");
const donorDocument = ref("");
const financialAccountId = ref("");
const amount = ref(0);
const donationDate = ref(hojeIso());
const donationType = ref("");
const purpose = ref("");
const categoryId = ref("");

const contas = ref<FinancialAccountComSaldo[]>([]);
const categorias = ref<FinancialCategory[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    const [c, cat] = await Promise.all([FinancialAccountModel.list(), FinancialCategoryModel.list()]);
    contas.value = c;
    categorias.value = cat.filter((categoria) => categoria.category_type === "RECEITA");
    financialAccountId.value = c[0]?.id ?? "";
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!donorName.value.trim() || amount.value <= 0 || !financialAccountId.value) {
    erro.value = "Preencha o nome do doador, a conta e um valor maior que zero.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await DonationModel.create({
      donor_name: donorName.value.trim(),
      donor_document: donorDocument.value.trim() || null,
      financial_account_id: financialAccountId.value,
      amount: reaisParaCentavos(amount.value),
      donation_date: donationDate.value,
      donation_type: donationType.value.trim() || null,
      purpose: purpose.value.trim() || null,
      financial_category_id: categoryId.value || null,
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

  <form v-else class="donation-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div v-if="contas.length === 0" class="state-msg">Cadastre uma conta financeira antes de registrar doações.</div>

    <template v-else>
      <div class="field">
        <label class="field-label" for="donor-name">Doador *</label>
        <input id="donor-name" v-model="donorName" type="text" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="donor-document">CPF/CNPJ do doador</label>
        <input id="donor-document" v-model="donorDocument" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="financial-account">Conta financeira *</label>
        <select id="financial-account" v-model="financialAccountId" :disabled="saving" required>
          <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
        </select>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="amount">Valor (R$) *</label>
          <input id="amount" v-model.number="amount" type="number" step="0.01" min="0.01" :disabled="saving" required />
        </div>

        <div class="field">
          <label class="field-label" for="donation-date">Data *</label>
          <input id="donation-date" v-model="donationDate" type="date" :disabled="saving" required />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="donation-type">Tipo</label>
        <input id="donation-type" v-model="donationType" type="text" placeholder="DINHEIRO, BEM, SERVIÇO..." :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="purpose">Finalidade</label>
        <input id="purpose" v-model="purpose" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="category">Categoria</label>
        <select id="category" v-model="categoryId" :disabled="saving">
          <option value="">Nenhuma</option>
          <option v-for="categoria in categorias" :key="categoria.id" :value="categoria.id">{{ categoria.name }}</option>
        </select>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? "Salvando..." : "Salvar" }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.donation-form {
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
