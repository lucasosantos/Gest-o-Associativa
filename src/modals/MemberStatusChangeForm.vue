<script setup lang="ts">
// Registra uma mudança de situação do sócio: grava em `member_status_history`
// e atualiza `members.status` (ver MemberModel.changeStatus). Sócio
// desligado/falecido não é apagado, só encerrado com data e motivo.
import { ref } from "vue";
import { MemberModel, type StatusSocio } from "../models/Member.js";
import { hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  currentStatus: StatusSocio;
  onSaved?: () => void;
}>();

const opcoesStatus: { value: StatusSocio; label: string }[] = [
  { value: "PENDENTE", label: "Pendente" },
  { value: "ATIVO", label: "Ativo" },
  { value: "INATIVO", label: "Inativo" },
  { value: "SUSPENSO", label: "Suspenso" },
  { value: "DESLIGADO", label: "Desligado" },
  { value: "FALECIDO", label: "Falecido" },
];

const novoStatus = ref<StatusSocio>(props.currentStatus);
const effectiveDate = ref(hojeIso());
const reason = ref("");
const exitDate = ref("");
const exitReason = ref("");
const saving = ref(false);
const erro = ref("");

function precisaDadosDeSaida(status: StatusSocio) {
  return status === "DESLIGADO" || status === "FALECIDO";
}

async function handleSubmit() {
  if (!effectiveDate.value) {
    erro.value = "Informe a data de vigência da mudança.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await MemberModel.changeStatus(props.memberId, novoStatus.value, {
      effectiveDate: effectiveDate.value,
      reason: reason.value.trim() || null,
      exitDate: precisaDadosDeSaida(novoStatus.value) ? exitDate.value || effectiveDate.value : null,
      exitReason: precisaDadosDeSaida(novoStatus.value) ? exitReason.value.trim() || null : null,
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
  <form class="status-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="new-status">Nova situação</label>
      <select id="new-status" v-model="novoStatus" :disabled="saving">
        <option v-for="opcao in opcoesStatus" :key="opcao.value" :value="opcao.value">{{ opcao.label }}</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="effective-date">Data de vigência *</label>
      <input id="effective-date" v-model="effectiveDate" type="date" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="reason">Motivo</label>
      <textarea id="reason" v-model="reason" rows="2" :disabled="saving"></textarea>
    </div>

    <template v-if="precisaDadosDeSaida(novoStatus)">
      <div class="field">
        <label class="field-label" for="exit-date">Data de saída</label>
        <input id="exit-date" v-model="exitDate" type="date" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="exit-reason">Motivo da saída</label>
        <input id="exit-reason" v-model="exitReason" type="text" :disabled="saving" />
      </div>
    </template>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Confirmar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.status-form {
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
.field select,
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
.field select:disabled,
.field textarea:disabled {
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
