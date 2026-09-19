<script setup lang="ts">
// Pré-visualização do arquivo dentro do próprio app — documento tem só 1
// arquivo, sem fluxo de versões (ver `DocumentModel.getCurrentVersion`).
// Imagem e PDF renderizam aqui mesmo; os demais tipos (Word, Excel, ZIP...)
// não têm visualizador nativo no webview, então só sobra "Abrir" (programa
// padrão do sistema operacional, via `abrirArquivoDocumento`).
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DocumentModel, type DocumentComDetalhes, type DocumentVersion } from "../models/Document.js";
import { abrirArquivoDocumento, lerArquivoDocumentoComoDataUrl } from "../services/documentFiles.js";
import { formatarBytes } from "../utils/format.js";

const route = useRoute();
const router = useRouter();
const documentId = computed(() => String(route.params.id));

const documento = ref<DocumentComDetalhes | null>(null);
const versao = ref<DocumentVersion | null>(null);
const dataUrl = ref<string | null>(null);
const loading = ref(true);
const erro = ref("");

const previsualizavel = computed(() => {
  const mime = versao.value?.mime_type ?? "";
  return mime.startsWith("image/") || mime === "application/pdf";
});

onMounted(async () => {
  try {
    const [doc, v] = await Promise.all([
      DocumentModel.get(documentId.value),
      DocumentModel.getCurrentVersion(documentId.value),
    ]);
    documento.value = doc;
    versao.value = v;

    if (v && (v.mime_type.startsWith("image/") || v.mime_type === "application/pdf")) {
      dataUrl.value = await lerArquivoDocumentoComoDataUrl(v.storage_key);
      await DocumentModel.logAccess(documentId.value, "VISUALIZOU");
    }
  } catch (error) {
    erro.value = `Não foi possível carregar a pré-visualização: ${error instanceof Error ? error.message : error}`;
  } finally {
    loading.value = false;
  }
});

function abrir() {
  if (versao.value) abrirArquivoDocumento(versao.value.storage_key);
}
</script>

<template>
  <section class="content">
    <div class="breadcrumb">
      <button type="button" class="link-btn" @click="router.push({ name: 'documentos' })">Documentos</button>
      <span class="sep">/</span>
      <button
        type="button"
        class="link-btn"
        @click="router.push({ name: 'documento-detalhes', params: { id: documentId } })"
      >
        {{ documento?.title ?? "Carregando..." }}
      </button>
      <span class="sep">/</span>
      <span class="current">Visualizar</span>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <div v-else-if="!documento || !versao" class="state-msg">Documento não encontrado.</div>

    <template v-else>
      <div class="page-header">
        <h2>{{ documento.title }}</h2>
        <p>{{ versao.original_filename }} · {{ formatarBytes(versao.file_size) }}</p>
      </div>

      <p v-if="erro" class="erro">{{ erro }}</p>

      <div v-else-if="!previsualizavel" class="sem-preview">
        <p>Pré-visualização não disponível para este tipo de arquivo.</p>
        <button type="button" class="btn-primary" @click="abrir">Abrir no programa padrão</button>
      </div>

      <div v-else class="preview">
        <img v-if="versao.mime_type.startsWith('image/')" :src="dataUrl ?? ''" :alt="versao.original_filename" />
        <iframe v-else :src="dataUrl ?? ''" title="Pré-visualização do documento" />
      </div>
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

.erro {
  color: #c0392b;
  font-size: 0.85rem;
}

.sem-preview {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
}

.sem-preview p {
  margin: 0 0 1rem;
}

.preview {
  display: flex;
  justify-content: center;
  height: calc(100vh - 220px);
  min-height: 320px;
}

.preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.preview iframe {
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: var(--accent);
  color: #fff;
}
</style>
