<script setup lang="ts">
// Sem fluxo de versões (removido a pedido do usuário: um documento tem
// exatamente 1 arquivo, ver `DocumentModel.getCurrentVersion`) nem de
// etiquetas — sobrando só "Arquivo" (dados do arquivo em si, com Abrir/
// Visualizar) e Vínculos, direto na página, sem abas pra alternar entre
// duas seções só.
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DocumentModel, type DocumentComDetalhes, type DocumentVersion, type StatusDocumento } from "../models/Document.js";
import { DocumentLinkModel, type DocumentLink, ROTULO_TIPO_ENTIDADE } from "../models/DocumentLink.js";
import { formatarData, formatarBytes } from "../utils/format.js";
import { abrirArquivoDocumento } from "../services/documentFiles.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import DocumentLinkForm from "../modals/DocumentLinkForm.vue";

const route = useRoute();
const router = useRouter();
const documentId = computed(() => String(route.params.id));

const documento = ref<DocumentComDetalhes | null>(null);
const versao = ref<DocumentVersion | null>(null);
const vinculos = ref<DocumentLink[]>([]);
const loading = ref(true);

const STATUS_LABEL: Record<StatusDocumento, string> = {
  ATIVO: "Ativo",
  ARQUIVADO: "Arquivado",
  CANCELADO: "Cancelado",
};

async function carregar() {
  loading.value = true;
  try {
    const encontrado = await DocumentModel.get(documentId.value);
    documento.value = encontrado;
    if (!encontrado) return;

    const [v, l] = await Promise.all([
      DocumentModel.getCurrentVersion(encontrado.id),
      DocumentLinkModel.listForDocument(encontrado.id),
    ]);
    versao.value = v;
    vinculos.value = l;
  } finally {
    loading.value = false;
  }
}

async function abrirArquivo() {
  if (!versao.value) return;
  await DocumentModel.logAccess(documentId.value, "BAIXOU");
  await abrirArquivoDocumento(versao.value.storage_key);
}

function visualizarArquivo() {
  router.push({ name: "documento-visualizar", params: { id: documentId.value } });
}

function abrirNovoVinculo() {
  openModal({ title: "Vincular documento", component: DocumentLinkForm, props: { documentId: documentId.value, onSaved: carregar } });
}

async function removerVinculo(vinculo: DocumentLink) {
  await DocumentLinkModel.remove(vinculo.id);
  await carregar();
}

async function alterarStatus(status: StatusDocumento) {
  await DocumentModel.updateStatus(documentId.value, status);
  await carregar();
}

useAssociationScopedData(carregar);

onMounted(() => {
  setSidebarTools([
    { group: "Vínculos", items: [{ id: "novo-vinculo", label: "Vincular a um registro", icon: "plus", onClick: abrirNovoVinculo }] },
  ]);
});
</script>

<template>
  <section class="content">
    <div class="breadcrumb">
      <button type="button" class="link-btn" @click="router.push({ name: 'documentos' })">Documentos</button>
      <span class="sep">/</span>
      <span class="current">{{ documento?.title ?? "Carregando..." }}</span>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <div v-else-if="!documento" class="state-msg">Documento não encontrado.</div>

    <template v-else>
      <div class="page-header">
        <div>
          <h2>{{ documento.title }}</h2>
          <p>
            {{ documento.document_type_name ?? "Sem tipo" }} ·
            <select
              :value="documento.status"
              class="status-select"
              @change="alterarStatus(($event.target as HTMLSelectElement).value as StatusDocumento)"
            >
              <option v-for="(label, status) in STATUS_LABEL" :key="status" :value="status">{{ label }}</option>
            </select>
          </p>
          <p v-if="documento.description" class="description">{{ documento.description }}</p>
        </div>
      </div>

      <section class="secao">
        <h3>Arquivo</h3>
        <div v-if="versao" class="arquivo-row">
          <div>
            <strong>{{ versao.original_filename }}</strong>
            <div class="muted">{{ formatarBytes(versao.file_size) }} · importado em {{ formatarData(versao.uploaded_at.slice(0, 10)) }}</div>
          </div>
          <div class="arquivo-acoes">
            <button type="button" class="link-btn" @click="visualizarArquivo">Visualizar</button>
            <button type="button" class="link-btn" @click="abrirArquivo">Abrir</button>
          </div>
        </div>
        <p v-else class="state-msg">Nenhum arquivo importado.</p>
      </section>

      <section class="secao">
        <h3>Vínculos</h3>
        <p v-if="vinculos.length === 0" class="state-msg">Nenhum vínculo registrado.</p>
        <ul v-else class="item-list">
          <li v-for="vinculo in vinculos" :key="vinculo.id">
            <strong>{{ ROTULO_TIPO_ENTIDADE[vinculo.entity_type] }}</strong> — {{ vinculo.link_role }}
            <button type="button" class="link-btn remove" @click="removerVinculo(vinculo)">remover</button>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.link-btn {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.link-btn:hover {
  color: var(--accent);
}

.description {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.status-select {
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
}

.secao {
  max-width: 640px;
  margin-top: 1.5rem;
}

.secao h3 {
  font-size: 0.95rem;
  color: var(--text);
  margin: 0 0 0.75rem;
}

.arquivo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.85rem;
  color: var(--text);
}

.arquivo-acoes {
  display: flex;
  gap: 0.9rem;
  white-space: nowrap;
}

.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item-list li {
  padding: 0.6rem 0.8rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  color: var(--text);
}

.muted {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.remove {
  margin-left: 0.75rem;
  color: #c0392b;
}
</style>
