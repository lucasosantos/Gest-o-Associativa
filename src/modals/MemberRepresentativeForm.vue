<script setup lang="ts">
// Responsável/representante do sócio (ex.: cônjuge, tutor). `member_representatives`
// exige uma `Person` de verdade (não aceita só um nome solto como
// `member_dependents`) — se o CPF informado já existir, reaproveita a pessoa;
// senão, cadastra uma nova.
import { ref } from "vue";
import { PersonModel } from "../models/Person.js";
import { MemberRepresentativeModel } from "../models/MemberRepresentative.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  onSaved?: () => void;
}>();

const fullName = ref("");
const cpf = ref("");
const relationship = ref("CÔNJUGE");
const startDate = ref("");
const saving = ref(false);
const erro = ref("");

async function handleSubmit() {
  if (!fullName.value.trim() || !relationship.value.trim()) {
    erro.value = "Preencha o nome e o vínculo com o sócio.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    let pessoa = cpf.value.trim() ? await PersonModel.findByCpf(cpf.value) : null;
    if (!pessoa) {
      pessoa = await PersonModel.create({ full_name: fullName.value.trim(), cpf: cpf.value.trim() || null });
    }

    await MemberRepresentativeModel.create({
      member_id: props.memberId,
      person_id: pessoa.id,
      relationship: relationship.value.trim(),
      start_date: startDate.value || null,
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
  <form class="representative-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>
    <p class="hint">
      Se o CPF já pertencer a alguém cadastrado, os dados dessa pessoa serão
      reaproveitados.
    </p>

    <div class="field">
      <label class="field-label" for="full-name">Nome *</label>
      <input id="full-name" v-model="fullName" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="cpf">CPF</label>
      <input id="cpf" v-model="cpf" type="text" placeholder="000.000.000-00" :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="relationship">Vínculo com o sócio *</label>
      <input id="relationship" v-model="relationship" type="text" placeholder="CÔNJUGE, TUTOR..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="start-date">Início</label>
      <input id="start-date" v-model="startDate" type="date" :disabled="saving" />
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
.representative-form {
  min-width: 380px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.hint {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.78rem;
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
