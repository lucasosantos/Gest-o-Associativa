<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { DocumentModel, type DocumentComDetalhes, type StatusDocumento } from "../models/Document.js";
import { DocumentTypeModel, type DocumentType } from "../models/DocumentType.js";
import { InstitutionalRecordModel, type InstitutionalRecord } from "../models/InstitutionalRecord.js";
import {
  ProtocolEntryModel,
  formatarNumeroProtocolo,
  type ProtocolEntryComLivro,
  type StatusProtocolo,
} from "../models/ProtocolEntry.js";
import { ProtocolBookModel, type ProtocolBookComContagem } from "../models/ProtocolBook.js";
import { DocumentLinkModel, type DocumentLinkComDocumento } from "../models/DocumentLink.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { MembershipAgreementModel } from "../models/MembershipAgreement.js";
import { abrirArquivoDocumento } from "../services/documentFiles.js";
import { formatarData } from "../utils/format.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import DocumentUploadForm from "../modals/DocumentUploadForm.vue";
import DocumentTypeForm from "../modals/DocumentTypeForm.vue";
import InstitutionalRecordForm from "../modals/InstitutionalRecordForm.vue";
import ProtocolEntryForm from "../modals/ProtocolEntryForm.vue";
import ProtocolBookForm from "../modals/ProtocolBookForm.vue";

// Protocolos vivia numa tela própria (`/protocolos`) e passou a ser uma aba
// daqui a pedido do usuário — protocolo e documento são os dois lados da
// mesma função de secretaria.
const router = useRouter();

type Aba = "documentos" | "protocolos" | "livros" | "tipos" | "registros";
const abaAtiva = ref<Aba>("documentos");
const loading = ref(true);

const tipoFiltro = ref("");
const statusFiltro = ref<StatusDocumento | "">("");
const textoFiltro = ref("");

const documentos = ref<DocumentComDetalhes[]>([]);
const tipos = ref<DocumentType[]>([]);
const registros = ref<InstitutionalRecord[]>([]);

// --- Protocolos e Livros (abas próprias, cada uma só do seu assunto) ---
const livroFiltro = ref("");
const statusProtocoloFiltro = ref<StatusProtocolo | "">("");
const protocolos = ref<ProtocolEntryComLivro[]>([]);
const livros = ref<ProtocolBookComContagem[]>([]);
// Livro é uma tabela pequena (poucas linhas por ano/tipo cadastrado), então o
// filtro roda em memória sobre a lista já carregada, sem ida ao banco a cada
// mudança — diferente de Documentos/Protocolos, que filtram via model porque
// aquelas tabelas podem crescer bastante.
const statusLivroFiltro = ref<"ABERTO" | "FECHADO" | "">("");
const anoLivroFiltro = ref<number | "">("");
/** Documentos vinculados a cada protocolo (ver `document_links`, entidade `PROTOCOL_ENTRY`), por `protocolo.id`. */
const documentosPorProtocolo = ref<Record<string, DocumentLinkComDocumento[]>>({});

const DIRECAO_LABEL: Record<string, string> = {
  RECEBIDO: "Recebido",
  EXPEDIDO: "Expedido",
  INTERNO: "Interno",
};

const STATUS_PROTOCOLO_LABEL: Record<StatusProtocolo, string> = {
  ABERTO: "Aberto",
  EM_ANDAMENTO: "Em andamento",
  RESPONDIDO: "Respondido",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado",
};

const STATUS_LABEL: Record<StatusDocumento, string> = {
  ATIVO: "Ativo",
  ARQUIVADO: "Arquivado",
  CANCELADO: "Cancelado",
};

const CONFIDENCIALIDADE_LABEL: Record<string, string> = {
  PUBLICO: "Público",
  INTERNO: "Interno",
  RESTRITO: "Restrito",
  CONFIDENCIAL: "Confidencial",
};

async function carregarDocumentos() {
  documentos.value = await DocumentModel.list({
    documentTypeId: tipoFiltro.value || undefined,
    status: statusFiltro.value || undefined,
    texto: textoFiltro.value || undefined,
  });
}

async function carregarTipos() {
  tipos.value = await DocumentTypeModel.list();
}

async function carregarRegistros() {
  registros.value = await InstitutionalRecordModel.list();
}

async function carregarProtocolos() {
  protocolos.value = await ProtocolEntryModel.list({
    protocolBookId: livroFiltro.value || undefined,
    status: statusProtocoloFiltro.value || undefined,
  });
  await carregarDocumentosDosProtocolos();
}

/** Busca os documentos vinculados aos protocolos já carregados, de uma vez (evita 1 query por linha). */
async function carregarDocumentosDosProtocolos() {
  const vinculos = await DocumentLinkModel.listForEntities(
    "PROTOCOL_ENTRY",
    protocolos.value.map((p) => p.id)
  );
  const agrupado: Record<string, DocumentLinkComDocumento[]> = {};
  for (const vinculo of vinculos) {
    (agrupado[vinculo.entity_id] ??= []).push(vinculo);
  }
  documentosPorProtocolo.value = agrupado;
}

async function carregarLivros() {
  livros.value = await ProtocolBookModel.listComContagem();
}

/** Anos com pelo menos um livro cadastrado — opções do filtro por ano, sempre com base na lista inteira (não na já filtrada). */
const anosLivros = computed(() => [...new Set(livros.value.map((livro) => livro.year))].sort((a, b) => b - a));

const livrosFiltrados = computed(() =>
  livros.value.filter((livro) => {
    if (statusLivroFiltro.value === "ABERTO" && !livro.is_active) return false;
    if (statusLivroFiltro.value === "FECHADO" && livro.is_active) return false;
    if (anoLivroFiltro.value && livro.year !== anoLivroFiltro.value) return false;
    return true;
  })
);

let debounceTexto: ReturnType<typeof setTimeout> | undefined;
watch([tipoFiltro, statusFiltro], carregarDocumentos);
watch(textoFiltro, () => {
  clearTimeout(debounceTexto);
  debounceTexto = setTimeout(carregarDocumentos, 250);
});
watch([livroFiltro, statusProtocoloFiltro], carregarProtocolos);

function abrirNovoDocumento() {
  openModal({ title: "Novo documento", component: DocumentUploadForm, props: { onSaved: carregarDocumentos } });
}

function abrirNovoTipo() {
  openModal({ title: "Novo tipo de documento", component: DocumentTypeForm, props: { onSaved: carregarTipos } });
}

function abrirNovoRegistro() {
  openModal({ title: "Novo registro institucional", component: InstitutionalRecordForm, props: { onSaved: carregarRegistros } });
}

function abrirNovoProtocolo() {
  openModal({
    title: "Novo protocolo",
    component: ProtocolEntryForm,
    props: { protocolBookId: livroFiltro.value || undefined, onSaved: carregarProtocolos },
  });
}

function abrirNovoLivro() {
  openModal({ title: "Novo livro de protocolo", component: ProtocolBookForm, props: { onSaved: carregarLivros } });
}

function abrirVincularDocumentoProtocolo(protocolo: ProtocolEntryComLivro) {
  openModal({
    title: "Vincular documento ao protocolo",
    component: DocumentUploadForm,
    props: {
      protocolEntryId: protocolo.id,
      tituloSugerido: `${formatarNumeroProtocolo(protocolo, protocolo.book_prefix)} — ${protocolo.subject}`,
      dataSugerida: protocolo.protocol_date,
      onSaved: carregarDocumentosDosProtocolos,
    },
  });
}

async function removerVinculoDocumentoProtocolo(vinculo: DocumentLinkComDocumento) {
  await DocumentLinkModel.remove(vinculo.id);
  await carregarDocumentosDosProtocolos();
}

function abrirEditarLivro(livro: ProtocolBookComContagem) {
  openModal({
    title: "Editar livro de protocolo",
    component: ProtocolBookForm,
    props: { bookId: livro.id, onSaved: carregarLivros },
  });
}

async function excluirLivro(livro: ProtocolBookComContagem) {
  if (!confirm(`Excluir o livro "${livro.name}"? Essa ação não pode ser desfeita.`)) return;
  try {
    await ProtocolBookModel.remove(livro.id);
    await carregarLivros();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
}

/** Abre o arquivo da versão atual direto da lista, sem precisar entrar na ficha do documento (mesmo par de chamadas de `DocumentoDetalhes.vue`). */
async function abrirDocumento(documento: DocumentComDetalhes) {
  if (!documento.current_version_storage_key) return;
  await DocumentModel.logAccess(documento.id, "BAIXOU");
  await abrirArquivoDocumento(documento.current_version_storage_key);
}

function imprimirLivro(livro: ProtocolBookComContagem) {
  router.push({ name: "livro-protocolo-imprimir", params: { id: livro.id } });
}

async function alternarSituacaoLivro(livro: ProtocolBookComContagem) {
  try {
    await ProtocolBookModel.setActive(livro.id, livro.is_active === 0);
    await carregarLivros();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Se este protocolo é o recibo de um ACORDO de renegociação (várias
 * parcelas quitadas por um valor único, ver `MembershipAgreementModel`),
 * reabre o recibo de acordo — checado ANTES do recibo de mensalidade
 * comum, porque um acordo também deixa `protocol_entry_id` preenchido em
 * cada parcela que quitou (reabrir pelo pagamento isolado mostraria só a
 * fatia rateada, não o valor negociado de verdade). Senão, se é o recibo
 * de um pagamento comum, reabre o recibo dedicado; se é uma declaração de
 * associado (`member_id` preenchido, ver migration `version: 15`), reabre
 * o texto da declaração; senão, o comprovante genérico do protocolo — todos
 * reimprimíveis a qualquer momento, sem precisar navegar até o sócio.
 */
async function imprimirProtocolo(protocolo: ProtocolEntryComLivro) {
  const acordo = await MembershipAgreementModel.buscarPorProtocolo(protocolo.id);
  if (acordo) {
    router.push({ name: "acordo-imprimir", params: { id: acordo.id } });
    return;
  }

  const pagamento = await MembershipPaymentModel.buscarPorProtocolo(protocolo.id);
  if (pagamento) {
    router.push({ name: "recibo-imprimir", params: { id: pagamento.id } });
  } else if (protocolo.document_type === "DECLARACAO" && protocolo.member_id) {
    router.push({ name: "declaracao-imprimir", params: { id: protocolo.id } });
  } else {
    router.push({ name: "protocolo-imprimir", params: { id: protocolo.id } });
  }
}

async function alterarStatusTipo(tipo: DocumentType) {
  await DocumentTypeModel.setActive(tipo.id, tipo.is_active === 0);
  await carregarTipos();
}

async function alterarStatusRegistro(registro: InstitutionalRecord, status: InstitutionalRecord["status"]) {
  await InstitutionalRecordModel.updateStatus(registro.id, status);
  await carregarRegistros();
}

async function alterarStatusProtocolo(protocolo: ProtocolEntryComLivro, novoStatus: StatusProtocolo) {
  await ProtocolEntryModel.updateStatus(protocolo.id, novoStatus);
  await carregarProtocolos();
}

function atualizarSidebar() {
  const acoes: Record<Aba, { id: string; label: string; icon: string; onClick: () => void }> = {
    documentos: { id: "novo-documento", label: "Novo documento", icon: "plus", onClick: abrirNovoDocumento },
    protocolos: { id: "novo-protocolo", label: "Novo protocolo", icon: "plus", onClick: abrirNovoProtocolo },
    livros: { id: "novo-livro", label: "Novo livro", icon: "plus", onClick: abrirNovoLivro },
    tipos: { id: "novo-tipo", label: "Novo tipo", icon: "plus", onClick: abrirNovoTipo },
    registros: { id: "novo-registro", label: "Novo registro", icon: "plus", onClick: abrirNovoRegistro },
  };

  setSidebarTools([{ group: "Documentos", items: [acoes[abaAtiva.value]] }]);
}

watch(abaAtiva, atualizarSidebar);

useAssociationScopedData(async () => {
  loading.value = true;
  try {
    await Promise.all([
      carregarDocumentos(),
      carregarTipos(),
      carregarRegistros(),
      carregarProtocolos(),
      carregarLivros(),
    ]);
  } finally {
    loading.value = false;
  }
});

onMounted(atualizarSidebar);
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Documentos</h2>
        <p>Metadados, versões, protocolos e registros institucionais — o arquivo em si fica numa pasta própria ao lado do banco.</p>
      </div>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: abaAtiva === 'documentos' }" type="button" @click="abaAtiva = 'documentos'">Documentos</button>
      <button class="tab" :class="{ active: abaAtiva === 'protocolos' }" type="button" @click="abaAtiva = 'protocolos'">Protocolos</button>
      <button class="tab" :class="{ active: abaAtiva === 'livros' }" type="button" @click="abaAtiva = 'livros'">Livros</button>
      <button class="tab" :class="{ active: abaAtiva === 'tipos' }" type="button" @click="abaAtiva = 'tipos'">Tipos</button>
      <button class="tab" :class="{ active: abaAtiva === 'registros' }" type="button" @click="abaAtiva = 'registros'">Registros</button>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else>
      <div v-if="abaAtiva === 'documentos'">
        <div class="filter-row">
          <div>
            <label class="field-label" for="text-filter">Busca</label>
            <input id="text-filter" v-model="textoFiltro" type="text" placeholder="Título ou descrição..." />
          </div>
          <div>
            <label class="field-label" for="type-filter">Tipo</label>
            <select id="type-filter" v-model="tipoFiltro">
              <option value="">Todos</option>
              <option v-for="tipo in tipos" :key="tipo.id" :value="tipo.id">{{ tipo.name }}</option>
            </select>
          </div>
          <div>
            <label class="field-label" for="status-filter">Situação</label>
            <select id="status-filter" v-model="statusFiltro">
              <option value="">Todas</option>
              <option v-for="(label, status) in STATUS_LABEL" :key="status" :value="status">{{ label }}</option>
            </select>
          </div>
        </div>

        <p v-if="documentos.length === 0" class="state-msg">Nenhum documento encontrado.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Tipo</th>
              <th>Confidencialidade</th>
              <th>Situação</th>
              <th>Versão atual</th>
              <th>Atualizado em</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="documento in documentos"
              :key="documento.id"
              class="clickable-row"
              @click="router.push({ name: 'documento-detalhes', params: { id: documento.id } })"
            >
              <td>{{ documento.title }}</td>
              <td>{{ documento.document_type_name ?? "—" }}</td>
              <td>{{ CONFIDENCIALIDADE_LABEL[documento.confidentiality] }}</td>
              <td>{{ STATUS_LABEL[documento.status] }}</td>
              <td>{{ documento.current_version_filename ?? "—" }}</td>
              <td>{{ formatarData(documento.updated_at.slice(0, 10)) }}</td>
              <td>
                <button
                  v-if="documento.current_version_storage_key"
                  type="button"
                  class="link-btn"
                  @click.stop="abrirDocumento(documento)"
                >
                  Abrir
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'protocolos'">
        <div class="filter-row">
          <div>
            <label class="field-label" for="book-filter">Livro</label>
            <select id="book-filter" v-model="livroFiltro">
              <option value="">Todos</option>
              <option v-for="livro in livros" :key="livro.id" :value="livro.id">{{ livro.name }}</option>
            </select>
          </div>
          <div>
            <label class="field-label" for="protocol-status-filter">Situação</label>
            <select id="protocol-status-filter" v-model="statusProtocoloFiltro">
              <option value="">Todas</option>
              <option v-for="(label, status) in STATUS_PROTOCOLO_LABEL" :key="status" :value="status">{{ label }}</option>
            </select>
          </div>
        </div>

        <p v-if="protocolos.length === 0" class="state-msg">Nenhum protocolo encontrado.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Número</th>
              <th>Direção</th>
              <th>Data</th>
              <th>Assunto</th>
              <th>Prazo</th>
              <th>Situação</th>
              <th>Documentos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="protocolo in protocolos" :key="protocolo.id">
              <td>{{ formatarNumeroProtocolo(protocolo, protocolo.book_prefix) }}</td>
              <td>{{ DIRECAO_LABEL[protocolo.direction] }}</td>
              <td>{{ formatarData(protocolo.protocol_date) }}</td>
              <td>{{ protocolo.subject }}</td>
              <td>{{ protocolo.deadline ? formatarData(protocolo.deadline) : "—" }}</td>
              <td>
                <select
                  :value="protocolo.status"
                  class="status-select"
                  @change="alterarStatusProtocolo(protocolo, ($event.target as HTMLSelectElement).value as StatusProtocolo)"
                >
                  <option v-for="(label, status) in STATUS_PROTOCOLO_LABEL" :key="status" :value="status">{{ label }}</option>
                </select>
              </td>
              <td class="documentos-cell">
                <div v-for="vinculo in documentosPorProtocolo[protocolo.id] ?? []" :key="vinculo.id" class="documento-vinculado">
                  <button
                    type="button"
                    class="link-btn"
                    @click="router.push({ name: 'documento-detalhes', params: { id: vinculo.document_id } })"
                  >
                    {{ vinculo.document_title }}
                  </button>
                  <button type="button" class="link-btn remove" @click="removerVinculoDocumentoProtocolo(vinculo)">×</button>
                </div>
                <button type="button" class="link-btn" @click="abrirVincularDocumentoProtocolo(protocolo)">+ Vincular</button>
              </td>
              <td>
                <button type="button" class="link-btn" @click="imprimirProtocolo(protocolo)">Imprimir</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'livros'">
        <div class="filter-row">
          <div>
            <label class="field-label" for="book-status-filter">Situação</label>
            <select id="book-status-filter" v-model="statusLivroFiltro">
              <option value="">Todas</option>
              <option value="ABERTO">Aberto</option>
              <option value="FECHADO">Fechado</option>
            </select>
          </div>
          <div>
            <label class="field-label" for="book-year-filter">Ano</label>
            <select id="book-year-filter" v-model="anoLivroFiltro">
              <option value="">Todos</option>
              <option v-for="ano in anosLivros" :key="ano" :value="ano">{{ ano }}</option>
            </select>
          </div>
        </div>

        <p v-if="livros.length === 0" class="state-msg">Nenhum livro de protocolo cadastrado ainda.</p>
        <p v-else-if="livrosFiltrados.length === 0" class="state-msg">Nenhum livro encontrado com esse filtro.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Ano</th>
              <th>Próximo número</th>
              <th>Situação</th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="livro in livrosFiltrados" :key="livro.id">
              <td>{{ livro.name }}</td>
              <td>{{ livro.protocol_type }}</td>
              <td>{{ livro.year }}</td>
              <td>{{ livro.next_number }}</td>
              <td>
                <span class="badge" :class="{ 'badge-encerrado': livro.is_active === 0 }">
                  {{ livro.is_active ? "Ativo" : "Encerrado" }}
                </span>
              </td>
              <td>
                <button type="button" class="link-btn" @click="imprimirLivro(livro)">Imprimir</button>
              </td>
              <td>
                <button v-if="livro.entry_count === 0" type="button" class="link-btn" @click="abrirEditarLivro(livro)">
                  Editar
                </button>
              </td>
              <td>
                <button type="button" class="link-btn" @click="alternarSituacaoLivro(livro)">
                  {{ livro.is_active ? "Encerrar" : "Reabrir" }}
                </button>
              </td>
              <td>
                <button v-if="livro.entry_count === 0" type="button" class="link-btn remove" @click="excluirLivro(livro)">
                  Excluir
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="abaAtiva === 'tipos'">
        <p class="hint">Estes tipos também aparecem no campo Tipo dos livros de protocolo, na aba Livros.</p>
        <p v-if="tipos.length === 0" class="state-msg">Nenhum tipo de documento cadastrado ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Retenção (meses)</th>
              <th>Exige validade</th>
              <th>Confidencial</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tipo in tipos" :key="tipo.id">
              <td>{{ tipo.name }}</td>
              <td>{{ tipo.retention_period_months ?? "—" }}</td>
              <td>{{ tipo.requires_expiration ? "Sim" : "Não" }}</td>
              <td>{{ tipo.is_confidential ? "Sim" : "Não" }}</td>
              <td>
                <button type="button" class="link-btn" @click="alterarStatusTipo(tipo)">
                  {{ tipo.is_active ? "Ativo (desativar)" : "Inativo (ativar)" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else>
        <p v-if="registros.length === 0" class="state-msg">Nenhum registro institucional cadastrado ainda.</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Título</th>
              <th>Data</th>
              <th>Nº referência</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="registro in registros" :key="registro.id">
              <td>{{ registro.record_type }}</td>
              <td>{{ registro.title }}</td>
              <td>{{ formatarData(registro.record_date) }}</td>
              <td>{{ registro.reference_number ?? "—" }}</td>
              <td>
                <select
                  :value="registro.status"
                  class="status-select"
                  @change="alterarStatusRegistro(registro, ($event.target as HTMLSelectElement).value as InstitutionalRecord['status'])"
                >
                  <option value="ATIVO">Ativo</option>
                  <option value="ARQUIVADO">Arquivado</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 1rem 0 1.25rem;
  flex-wrap: wrap;
}

.tab {
  padding: 0.55rem 0.9rem;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.hint {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}

.filter-row {
  display: flex;
  gap: 1.25rem;
  margin-bottom: 1rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.filter-row input,
.filter-row select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.data-table {
  width: 100%;
  max-width: 960px;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.65rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.clickable-row {
  cursor: pointer;
}

.clickable-row:hover td {
  background: var(--surface-hover);
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.link-btn.remove {
  color: #c0392b;
}

.badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
}

.badge-encerrado {
  background: var(--surface-hover);
  color: var(--text-muted);
}

.documentos-cell {
  min-width: 160px;
}

.documento-vinculado {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
}

.status-select {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.8rem;
  font-family: inherit;
}

</style>
