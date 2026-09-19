<script setup lang="ts">
import { ref } from "vue";
import { PersonContactModel, type TipoContato } from "../models/PersonContact.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  personId: string;
  onSaved?: () => void;
}>();

const contactType = ref<TipoContato>("CELULAR");
const contactValue = ref("");
const isPrimary = ref(false);
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!contactValue.value.trim()) {
    erro.value = "Informe o contato.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await PersonContactModel.create({
      person_id: props.personId,
      contact_type: contactType.value,
      contact_value: contactValue.value.trim(),
      is_primary: isPrimary.value ? 1 : 0,
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
  <form class="contact-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="contact-type">Tipo</label>
      <select id="contact-type" v-model="contactType" :disabled="saving">
        <option value="CELULAR">Celular</option>
        <option value="TELEFONE">Telefone</option>
        <option value="EMAIL">E-mail</option>
        <option value="OUTRO">Outro</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="contact-value">Contato *</label>
      <input id="contact-value" v-model="contactValue" type="text" :disabled="saving" required />
    </div>

    <label class="checkbox-field">
      <input v-model="isPrimary" type="checkbox" :disabled="saving" />
      Contato principal
    </label>

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
.contact-form {
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

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text);
  margin-bottom: 0.9rem;
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
