<script setup lang="ts">
import { ref } from "vue";
import { PayeeModel } from "../models/Payee.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const name = ref("");
const documentNumber = ref("");
const email = ref("");
const phone = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome do fornecedor.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await PayeeModel.create({
      name: name.value.trim(),
      document_number: documentNumber.value.trim() || null,
      email: email.value.trim() || null,
      phone: phone.value.trim() || null,
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
  <form class="payee-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="document-number">CNPJ/CPF</label>
      <input id="document-number" v-model="documentNumber" type="text" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="email">E-mail</label>
      <input id="email" v-model="email" type="email" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="phone">Telefone</label>
      <input id="phone" v-model="phone" type="text" :disabled="saving" />
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
.payee-form {
  min-width: 340px;
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

.field input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled {
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
