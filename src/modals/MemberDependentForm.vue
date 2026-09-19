<script setup lang="ts">
// Dependente do sócio (filho, etc.) identificado só pelo nome — sem criar um
// cadastro completo em `people` (o dicionário de dados permite as duas
// formas; a UI aqui cobre o caso mais comum do MVP).
import { ref } from "vue";
import { MemberDependentModel } from "../models/MemberDependent.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  onSaved?: () => void;
}>();

const dependentName = ref("");
const relationship = ref("FILHO");
const birthDate = ref("");
const isFinancialDependent = ref(false);
const observations = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!dependentName.value.trim() || !relationship.value.trim()) {
    erro.value = "Preencha o nome e o grau de parentesco.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await MemberDependentModel.create({
      member_id: props.memberId,
      dependent_name: dependentName.value.trim(),
      relationship: relationship.value.trim(),
      birth_date: birthDate.value || null,
      is_financial_dependent: isFinancialDependent.value ? 1 : 0,
      observations: observations.value.trim() || null,
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
  <form class="dependent-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="dependent-name">Nome *</label>
      <input id="dependent-name" v-model="dependentName" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="relationship">Parentesco *</label>
      <input id="relationship" v-model="relationship" type="text" placeholder="FILHO, CÔNJUGE..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="birth-date">Data de nascimento</label>
      <input id="birth-date" v-model="birthDate" type="date" :disabled="saving" />
    </div>

    <label class="checkbox-field">
      <input v-model="isFinancialDependent" type="checkbox" :disabled="saving" />
      Dependente financeiro
    </label>

    <div class="field">
      <label class="field-label" for="observations">Observações</label>
      <textarea id="observations" v-model="observations" rows="2" :disabled="saving"></textarea>
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
.dependent-form {
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
.field textarea:disabled {
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
