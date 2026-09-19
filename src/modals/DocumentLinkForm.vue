<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  DocumentLinkModel,
  TIPOS_ENTIDADE_VINCULAVEL,
  ROTULO_TIPO_ENTIDADE,
  type TipoEntidadeVinculavel,
} from "../models/DocumentLink.js";
import { DocumentModel, type DocumentComDetalhes } from "../models/Document.js";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { ProtocolEntryModel, formatarNumeroProtocolo, type ProtocolEntryComLivro } from "../models/ProtocolEntry.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

/**
 * Formulário único para os dois pontos de entrada do vínculo:
 * - a partir da ficha do documento (`documentId` fixo, escolhe a entidade);
 * - a partir da ficha de uma entidade, ex.: sócio (`entityType`/`entityId`
 *   fixos, escolhe o documento).
 */
const props = defineProps<{
  documentId?: string;
  entityType?: TipoEntidadeVinculavel;
  entityId?: string;
  onSaved?: () => void;
}>();

const documentId = ref(props.documentId ?? "");
const entityType = ref<TipoEntidadeVinculavel>(props.entityType ?? "MEMBER");
const entityId = ref(props.entityId ?? "");
const linkRole = ref("ANEXO");

const documentos = ref<DocumentComDetalhes[]>([]);
const membros = ref<MemberComPessoa[]>([]);
const protocolos = ref<ProtocolEntryComLivro[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const precisaEscolherDocumento = computed(() => !props.documentId);
const precisaEscolherEntidade = computed(() => !props.entityId);

async function carregarOpcoesEntidade() {
  if (!precisaEscolherEntidade.value) return;
  if (entityType.value === "MEMBER") membros.value = await MemberModel.list();
  else if (entityType.value === "PROTOCOL_ENTRY") protocolos.value = await ProtocolEntryModel.list();
}

watch(entityType, () => {
  entityId.value = "";
  carregarOpcoesEntidade();
});

onMounted(async () => {
  try {
    if (precisaEscolherDocumento.value) documentos.value = await DocumentModel.list();
    await carregarOpcoesEntidade();
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!documentId.value || !entityId.value) {
    erro.value = "Escolha o documento e a entidade vinculada.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await DocumentLinkModel.create({
      document_id: documentId.value,
      entity_type: entityType.value,
      entity_id: entityId.value,
      link_role: linkRole.value.trim() || "ANEXO",
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

  <form v-else class="link-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div v-if="precisaEscolherDocumento" class="field">
      <label class="field-label" for="document">Documento *</label>
      <select id="document" v-model="documentId" :disabled="saving" required>
        <option value="" disabled>Selecione...</option>
        <option v-for="doc in documentos" :key="doc.id" :value="doc.id">{{ doc.title }}</option>
      </select>
    </div>

    <template v-if="precisaEscolherEntidade">
      <div v-if="!props.entityType" class="field">
        <label class="field-label" for="entity-type">Vincular a *</label>
        <select id="entity-type" v-model="entityType" :disabled="saving">
          <option v-for="tipo in TIPOS_ENTIDADE_VINCULAVEL" :key="tipo" :value="tipo">
            {{ ROTULO_TIPO_ENTIDADE[tipo] }}
          </option>
        </select>
      </div>

      <div v-if="entityType === 'MEMBER'" class="field">
        <label class="field-label" for="member">Sócio *</label>
        <select id="member" v-model="entityId" :disabled="saving" required>
          <option value="" disabled>Selecione...</option>
          <option v-for="membro in membros" :key="membro.id" :value="membro.id">
            {{ membro.full_name }} ({{ membro.registration_number }})
          </option>
        </select>
      </div>

      <div v-else-if="entityType === 'PROTOCOL_ENTRY'" class="field">
        <label class="field-label" for="protocol">Protocolo *</label>
        <select id="protocol" v-model="entityId" :disabled="saving" required>
          <option value="" disabled>Selecione...</option>
          <option v-for="protocolo in protocolos" :key="protocolo.id" :value="protocolo.id">
            {{ formatarNumeroProtocolo(protocolo, protocolo.book_prefix) }} — {{ protocolo.subject }}
          </option>
        </select>
      </div>

      <div v-else class="field">
        <label class="field-label" for="entity-id">Identificador do registro *</label>
        <input id="entity-id" v-model="entityId" type="text" placeholder="ID do registro" :disabled="saving" required />
        <p class="hint">Ainda não há uma tela própria para escolher {{ ROTULO_TIPO_ENTIDADE[entityType].toLowerCase() }} nesta versão — cole o identificador manualmente.</p>
      </div>
    </template>

    <div class="field">
      <label class="field-label" for="link-role">Função do vínculo</label>
      <input id="link-role" v-model="linkRole" type="text" placeholder="ANEXO" :disabled="saving" />
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
.link-form {
  min-width: 400px;
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

.hint {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
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
