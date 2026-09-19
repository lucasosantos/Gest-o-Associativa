<script setup lang="ts">
// Quando aberto a partir de um protocolo (`protocolEntryId`) ou de um
// sócio (`memberId` — ex.: "Vincular como documento" depois de gerar uma
// declaração, `ImprimirDeclaracao.vue`), o documento é IMPORTADO e
// vinculado num passo só — não existe mais o fluxo antigo de "escolher um
// documento já existente" pra vincular (`DocumentLinkForm.vue`, que só
// ficou pro sentido "a partir do documento, escolher a entidade"). Título
// e data vêm sugeridos por quem abre o modal, mas continuam editáveis.
import { onMounted, ref } from "vue";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { DocumentModel, type ConfidencialidadeDocumento } from "../models/Document.js";
import { DocumentTypeModel, type DocumentType } from "../models/DocumentType.js";
import { DocumentLinkModel } from "../models/DocumentLink.js";
import { hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  /** Presente quando aberto a partir de um protocolo — vincula o documento recém-criado a ele. */
  protocolEntryId?: string;
  /** Presente quando aberto a partir de um sócio — vincula o documento recém-criado a ele. */
  memberId?: string;
  tituloSugerido?: string;
  dataSugerida?: string;
  onSaved?: () => void;
}>();

const title = ref(props.tituloSugerido ?? "");
const description = ref("");
const documentTypeId = ref("");
const confidentiality = ref<ConfidencialidadeDocumento>("INTERNO");
const documentDate = ref(props.dataSugerida || hojeIso());
const expirationDate = ref("");
const sourcePath = ref("");

const tipos = ref<DocumentType[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    tipos.value = await DocumentTypeModel.listActive();
  } finally {
    loading.value = false;
  }
});

async function escolherArquivo() {
  const escolhido = await openDialog({ title: "Selecione o arquivo do documento", multiple: false });
  if (typeof escolhido === "string") sourcePath.value = escolhido;
}

async function handleSubmit() {
  if (!title.value.trim() || !sourcePath.value) {
    erro.value = "Informe o título e escolha o arquivo.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const criado = await DocumentModel.create({
      title: title.value.trim(),
      description: description.value.trim() || null,
      document_type_id: documentTypeId.value || null,
      confidentiality: confidentiality.value,
      document_date: documentDate.value || null,
      expiration_date: expirationDate.value || null,
      source_path: sourcePath.value,
    });

    if (props.protocolEntryId) {
      await DocumentLinkModel.create({
        document_id: criado.id,
        entity_type: "PROTOCOL_ENTRY",
        entity_id: props.protocolEntryId,
        link_role: "ANEXO",
      });
    }

    if (props.memberId) {
      await DocumentLinkModel.create({
        document_id: criado.id,
        entity_type: "MEMBER",
        entity_id: props.memberId,
        link_role: "ANEXO",
      });
    }

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

  <form v-else class="upload-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label" for="file-picker">Arquivo *</label>
      <div class="file-picker">
        <button type="button" class="btn-secondary" :disabled="saving" @click="escolherArquivo">Escolher arquivo</button>
        <span class="file-name">{{ sourcePath || "Nenhum arquivo escolhido" }}</span>
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="title">Título *</label>
      <input id="title" v-model="title" type="text" :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="description">Descrição</label>
      <textarea id="description" v-model="description" rows="2" :disabled="saving"></textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label" for="document-type">Tipo</label>
        <select id="document-type" v-model="documentTypeId" :disabled="saving">
          <option value="">Sem tipo</option>
          <option v-for="tipo in tipos" :key="tipo.id" :value="tipo.id">{{ tipo.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="confidentiality">Confidencialidade</label>
        <select id="confidentiality" v-model="confidentiality" :disabled="saving">
          <option value="PUBLICO">Público</option>
          <option value="INTERNO">Interno</option>
          <option value="RESTRITO">Restrito</option>
          <option value="CONFIDENCIAL">Confidencial</option>
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label" for="document-date">Data do documento</label>
        <input id="document-date" v-model="documentDate" type="date" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="expiration-date">Validade</label>
        <input id="expiration-date" v-model="expirationDate" type="date" :disabled="saving" />
      </div>
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
.upload-form {
  min-width: 460px;
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

.file-picker {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.file-name {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
