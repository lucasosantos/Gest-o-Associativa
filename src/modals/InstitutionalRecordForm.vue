<script setup lang="ts">
// Tipo do registro é o mesmo cadastro de tipo de documento (aba "Tipos", em
// Documentos.vue — ver `DocumentTypeModel`), igual já feito pro tipo do
// livro de protocolo (`ProtocolBookForm.vue`): registro institucional
// também classifica algo, não faz sentido ter uma terceira lista solta de
// tipos pra isso. Cadastrar um tipo novo é só na aba Tipos.
import { onMounted, ref } from "vue";
import { InstitutionalRecordModel } from "../models/InstitutionalRecord.js";
import { DocumentTypeModel } from "../models/DocumentType.js";
import { hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const tipos = ref<string[]>([]);
const recordType = ref("");
const referenceNumber = ref("");
const recordDate = ref(hojeIso());
const title = ref("");
const description = ref("");
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    const tiposAtivos = await DocumentTypeModel.listActive();
    tipos.value = tiposAtivos.map((tipo) => tipo.name);
    recordType.value = tipos.value[0] ?? "";
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!recordType.value || !title.value.trim()) {
    erro.value = "Selecione o tipo e preencha o título do registro.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await InstitutionalRecordModel.create({
      record_type: recordType.value,
      reference_number: referenceNumber.value.trim() || null,
      record_date: recordDate.value,
      title: title.value.trim(),
      description: description.value.trim() || null,
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

  <form v-else class="record-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p v-if="tipos.length === 0" class="state-msg">
      Nenhum tipo cadastrado ainda — cadastre um na aba Tipos, em Documentos, antes de criar um registro.
    </p>

    <template v-else>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="record-type">Tipo *</label>
          <select id="record-type" v-model="recordType" :disabled="saving" required>
            <option v-for="tipo in tipos" :key="tipo" :value="tipo">{{ tipo }}</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="record-date">Data *</label>
          <input id="record-date" v-model="recordDate" type="date" :disabled="saving" required />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="title">Título *</label>
        <input id="title" v-model="title" type="text" :disabled="saving" required />
      </div>

      <div class="field">
        <label class="field-label" for="reference-number">Número de referência</label>
        <input id="reference-number" v-model="referenceNumber" type="text" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="description">Descrição</label>
        <textarea id="description" v-model="description" rows="3" :disabled="saving"></textarea>
      </div>
    </template>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button v-if="tipos.length > 0" type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.record-form {
  min-width: 420px;
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
