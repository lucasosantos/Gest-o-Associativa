<script setup lang="ts">
import { ref } from "vue";
import { FinancialAccountModel } from "../models/FinancialAccount.js";
import { reaisParaCentavos, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const name = ref("");
const accountType = ref("CAIXA");
const bankName = ref("");
const agency = ref("");
const accountNumberMasked = ref("");
const openingBalance = ref(0);
const openingDate = ref(hojeIso());
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome da conta.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await FinancialAccountModel.create({
      name: name.value.trim(),
      account_type: accountType.value,
      bank_name: bankName.value.trim() || null,
      agency: agency.value.trim() || null,
      account_number_masked: accountNumberMasked.value.trim() || null,
      opening_balance: reaisParaCentavos(openingBalance.value),
      opening_date: openingDate.value,
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
  <form class="account-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" placeholder="Caixa, Banco X..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="account-type">Tipo</label>
      <select id="account-type" v-model="accountType" :disabled="saving">
        <option value="CAIXA">Caixa</option>
        <option value="BANCO">Conta bancária</option>
        <option value="DIGITAL">Conta digital</option>
        <option value="OUTRA">Outra</option>
      </select>
    </div>

    <template v-if="accountType === 'BANCO' || accountType === 'DIGITAL'">
      <div class="field">
        <label class="field-label" for="bank-name">Banco</label>
        <input id="bank-name" v-model="bankName" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="agency">Agência</label>
        <input id="agency" v-model="agency" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="account-number">Conta</label>
        <input id="account-number" v-model="accountNumberMasked" type="text" :disabled="saving" />
      </div>
    </template>

    <div class="field">
      <label class="field-label" for="opening-balance">Saldo inicial (R$)</label>
      <input id="opening-balance" v-model.number="openingBalance" type="number" step="0.01" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="opening-date">Data do saldo inicial</label>
      <input id="opening-date" v-model="openingDate" type="date" :disabled="saving" />
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
.account-form {
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
