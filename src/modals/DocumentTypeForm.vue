<script setup lang="ts">
import { ref } from "vue";
import { DocumentTypeModel } from "../models/DocumentType.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const name = ref("");
const retentionPeriodMonths = ref<number | null>(null);
const requiresExpiration = ref(false);
const isConfidential = ref(false);
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!name.value.trim()) {
    erro.value = "Informe o nome do tipo de documento.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await DocumentTypeModel.create({
      name: name.value.trim(),
      retention_period_months: retentionPeriodMonths.value,
      requires_expiration: requiresExpiration.value,
      is_confidential: isConfidential.value,
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
  <form class="type-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="name">Nome *</label>
      <input id="name" v-model="name" type="text" placeholder="Estatuto, Ata, Ofício..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="retention">Prazo de retenção (meses)</label>
      <input id="retention" v-model.number="retentionPeriodMonths" type="number" min="0" :disabled="saving" />
    </div>

    <label class="checkbox-field">
      <input v-model="requiresExpiration" type="checkbox" :disabled="saving" />
      Exige data de validade
    </label>

    <label class="checkbox-field">
      <input v-model="isConfidential" type="checkbox" :disabled="saving" />
      Confidencial por padrão
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
.type-form {
  min-width: 360px;
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

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text);
  margin-bottom: 0.75rem;
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
