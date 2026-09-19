<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ProtocolEntryModel, formatarNumeroProtocolo, type ProtocolEntryComLivro } from "../models/ProtocolEntry.js";
import { ProtocolBookModel, type ProtocolBook } from "../models/ProtocolBook.js";
import { hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  /** Pré-seleciona o livro quando aberto a partir do contexto de um livro específico. */
  protocolBookId?: string;
  onSaved?: () => void;
}>();

const protocolBookId = ref(props.protocolBookId ?? "");
const direction = ref<"RECEBIDO" | "EXPEDIDO" | "INTERNO">("EXPEDIDO");
const protocolDate = ref(hojeIso());
const senderName = ref("");
const recipientName = ref("");
const subject = ref("");
const deadline = ref("");
const notes = ref("");
const responseProtocolId = ref("");

const livros = ref<ProtocolBook[]>([]);
const protocolosAnteriores = ref<ProtocolEntryComLivro[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

/** Tipo do documento vem do livro escolhido — nunca digitado à parte (ver `ProtocolEntryModel.create`). */
const tipoDoLivro = computed(() => livros.value.find((livro) => livro.id === protocolBookId.value)?.protocol_type ?? "");

onMounted(async () => {
  try {
    const [l, p] = await Promise.all([ProtocolBookModel.list(), ProtocolEntryModel.list()]);
    livros.value = l.filter((livro) => livro.is_active);
    protocolosAnteriores.value = p;
    if (!protocolBookId.value) protocolBookId.value = livros.value[0]?.id ?? "";
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!protocolBookId.value || !subject.value.trim()) {
    erro.value = "Selecione o livro e preencha o assunto.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await ProtocolEntryModel.create({
      protocol_book_id: protocolBookId.value,
      direction: direction.value,
      protocol_date: protocolDate.value,
      sender_name: senderName.value.trim() || null,
      recipient_name: recipientName.value.trim() || null,
      subject: subject.value.trim(),
      deadline: deadline.value || null,
      notes: notes.value.trim() || null,
      response_protocol_id: responseProtocolId.value || null,
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

  <form v-else class="entry-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div v-if="livros.length === 0" class="state-msg">Cadastre um livro de protocolo antes de lançar um registro.</div>

    <template v-else>
      <div class="field">
        <label class="field-label" for="protocol-book">Livro *</label>
        <select id="protocol-book" v-model="protocolBookId" :disabled="saving" required>
          <option v-for="livro in livros" :key="livro.id" :value="livro.id">{{ livro.name }} (próximo nº {{ livro.next_number }})</option>
        </select>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="direction">Direção</label>
          <select id="direction" v-model="direction" :disabled="saving">
            <option value="RECEBIDO">Recebido</option>
            <option value="EXPEDIDO">Expedido</option>
            <option value="INTERNO">Interno</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="document-type">Tipo de documento</label>
          <input id="document-type" :value="tipoDoLivro" type="text" disabled />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="subject">Assunto *</label>
        <input id="subject" v-model="subject" type="text" :disabled="saving" required />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="protocol-date">Data *</label>
          <input id="protocol-date" v-model="protocolDate" type="date" :disabled="saving" required />
        </div>

        <div class="field">
          <label class="field-label" for="deadline">Prazo</label>
          <input id="deadline" v-model="deadline" type="date" :disabled="saving" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="sender">Remetente</label>
          <input id="sender" v-model="senderName" type="text" :disabled="saving" />
        </div>

        <div class="field">
          <label class="field-label" for="recipient">Destinatário</label>
          <input id="recipient" v-model="recipientName" type="text" :disabled="saving" />
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="response-to">Em resposta a</label>
        <select id="response-to" v-model="responseProtocolId" :disabled="saving">
          <option value="">Nenhum</option>
          <option v-for="anterior in protocolosAnteriores" :key="anterior.id" :value="anterior.id">
            {{ formatarNumeroProtocolo(anterior, anterior.book_prefix) }} — {{ anterior.subject }}
          </option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="notes">Observações</label>
        <textarea id="notes" v-model="notes" rows="2" :disabled="saving"></textarea>
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
.entry-form {
  min-width: 440px;
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
