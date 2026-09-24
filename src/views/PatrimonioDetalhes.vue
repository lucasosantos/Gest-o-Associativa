<script setup lang="ts">
// Ficha do bem patrimonial: linha do tempo (`asset_events`), dados de
// cadastro e documentos vinculados. As ações da barra lateral mudam com a
// situação do bem (`EVENTOS_PERMITIDOS`) — ex.: bem emprestado só aceita
// devolução, ocorrência ou baixa.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  AssetModel,
  EVENTOS_PERMITIDOS,
  ROTULO_CONSERVACAO,
  ROTULO_EVENTO_BEM,
  ROTULO_ORIGEM,
  ROTULO_STATUS_BEM,
  ROTULO_TIPO_BAIXA,
  type Asset,
  type AssetEvent,
  type NovoEventoBem,
} from "../models/Asset.js";
import { DocumentLinkModel, type DocumentLinkComDocumento } from "../models/DocumentLink.js";
import { formatarData, formatarMoeda } from "../utils/format.js";
import { setSidebarTools, type SidebarToolItem } from "../composables/useSidebar.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import AssetForm from "../modals/AssetForm.vue";
import AssetEventForm from "../modals/AssetEventForm.vue";
import AssetDisposalForm from "../modals/AssetDisposalForm.vue";
import AssetReactivateForm from "../modals/AssetReactivateForm.vue";
import DocumentLinkForm from "../modals/DocumentLinkForm.vue";

const route = useRoute();
const router = useRouter();
const assetId = computed(() => String(route.params.id));

const bem = ref<Asset | null>(null);
const eventos = ref<AssetEvent[]>([]);
const documentos = ref<DocumentLinkComDocumento[]>([]);
const loading = ref(true);
const erro = ref("");
const abaAtiva = ref<"historico" | "dados" | "documentos">("historico");

const ACAO_EVENTO: Record<NovoEventoBem["event_type"], { label: string; icon: string }> = {
  TRANSFERENCIA: { label: "Movimentar (local/responsável)", icon: "upload" },
  MANUTENCAO_ENVIO: { label: "Enviar para manutenção", icon: "settings" },
  MANUTENCAO_RETORNO: { label: "Retorno da manutenção", icon: "settings" },
  EMPRESTIMO: { label: "Emprestar", icon: "users" },
  DEVOLUCAO: { label: "Registrar devolução", icon: "download" },
  CONSERVACAO: { label: "Atualizar conservação", icon: "edit" },
  OCORRENCIA: { label: "Registrar ocorrência", icon: "alert" },
};

async function carregar() {
  loading.value = true;
  try {
    const encontrado = await AssetModel.get(assetId.value);
    bem.value = encontrado;
    if (!encontrado) return;
    const [e, d] = await Promise.all([
      AssetModel.eventos(encontrado.id),
      DocumentLinkModel.listForEntity("ASSET", encontrado.id),
    ]);
    eventos.value = e;
    documentos.value = d;
  } finally {
    loading.value = false;
    atualizarSidebar();
  }
}

function abrirEvento(tipo: NovoEventoBem["event_type"]) {
  if (!bem.value) return;
  openModal({
    title: ROTULO_EVENTO_BEM[tipo],
    component: AssetEventForm,
    props: { bem: bem.value, tipo, onSaved: carregar },
  });
}

function abrirEdicao() {
  if (!bem.value) return;
  openModal({ title: "Editar bem", component: AssetForm, props: { bem: bem.value, onSaved: carregar } });
}

function abrirBaixa() {
  if (!bem.value) return;
  openModal({ title: "Dar baixa no bem", component: AssetDisposalForm, props: { bem: bem.value, onSaved: carregar } });
}

function abrirDesfazerBaixa() {
  if (!bem.value) return;
  openModal({ title: "Desfazer baixa", component: AssetReactivateForm, props: { bem: bem.value, onSaved: carregar } });
}

function abrirVincularDocumento() {
  openModal({
    title: "Vincular documento",
    component: DocumentLinkForm,
    props: { entityType: "ASSET", entityId: assetId.value, onSaved: carregar },
  });
}

async function removerVinculoDocumento(vinculo: DocumentLinkComDocumento) {
  await DocumentLinkModel.remove(vinculo.id);
  await carregar();
}

async function excluir() {
  if (!bem.value) return;
  const confirmado = confirm(
    `Excluir o cadastro de "${bem.value.name}" e todo o histórico dele?\n\n` +
      "Use só para cadastro feito por engano. Se o bem saiu da associação (venda, doação, descarte...), use \"Dar baixa\"."
  );
  if (!confirmado) return;
  erro.value = "";
  try {
    await AssetModel.remove(bem.value.id);
    router.push({ name: "patrimonio" });
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  }
}

function atualizarSidebar() {
  if (!bem.value) {
    setSidebarTools([]);
    return;
  }
  const atual = bem.value;

  const acoes: SidebarToolItem[] = EVENTOS_PERMITIDOS[atual.status].map((tipo) => ({
    id: `evento-${tipo}`,
    label: ACAO_EVENTO[tipo].label,
    icon: ACAO_EVENTO[tipo].icon,
    onClick: () => abrirEvento(tipo),
  }));
  if (atual.status === "BAIXADO") {
    acoes.push({ id: "desfazer-baixa", label: "Desfazer baixa", icon: "clock", onClick: abrirDesfazerBaixa });
  } else {
    acoes.push({ id: "baixa", label: "Dar baixa", icon: "minus", onClick: abrirBaixa });
  }

  setSidebarTools([
    { group: "Movimentação", items: acoes },
    {
      group: "Cadastro",
      items: [
        { id: "editar", label: "Editar cadastro", icon: "edit", onClick: abrirEdicao },
        ...(abaAtiva.value === "documentos"
          ? [{ id: "vincular-documento", label: "Vincular documento", icon: "file", onClick: abrirVincularDocumento }]
          : []),
        { id: "excluir", label: "Excluir cadastro", icon: "trash", onClick: excluir },
      ],
    },
  ]);
}

watch(abaAtiva, atualizarSidebar);

useAssociationScopedData(carregar);
</script>

<template>
  <section class="content">
    <div class="breadcrumb">
      <button type="button" class="link-btn" @click="router.push({ name: 'patrimonio' })">Patrimônio</button>
      <span class="sep">/</span>
      <span class="current">{{ bem?.name ?? "Carregando..." }}</span>
    </div>

    <div v-if="loading && !bem" class="state-msg">Carregando...</div>
    <div v-else-if="!bem" class="state-msg">Bem não encontrado.</div>

    <template v-else>
      <div class="page-header">
        <h2>{{ bem.name }}</h2>
        <p>
          Nº {{ bem.asset_number }}
          <template v-if="bem.category"> · {{ bem.category }}</template>
          · <span class="badge" :class="`status-${bem.status}`">{{ ROTULO_STATUS_BEM[bem.status] }}</span>
        </p>
      </div>

      <p v-if="erro" class="erro">{{ erro }}</p>

      <div v-if="bem.status === 'BAIXADO' && bem.disposal_type && bem.disposal_date" class="baixa-box">
        <strong>Baixado em {{ formatarData(bem.disposal_date) }} — {{ ROTULO_TIPO_BAIXA[bem.disposal_type] }}</strong>
        <span v-if="bem.disposal_recipient"> · para {{ bem.disposal_recipient }}</span>
        <span v-if="bem.disposal_value"> · {{ formatarMoeda(bem.disposal_value) }}</span>
        <p>Motivo: {{ bem.disposal_reason }}</p>
      </div>

      <div class="resumo">
        <div>
          <span class="resumo-label">Local</span>
          <span>{{ bem.location || "—" }}</span>
        </div>
        <div>
          <span class="resumo-label">Responsável</span>
          <span>{{ bem.responsible || "—" }}</span>
        </div>
        <div>
          <span class="resumo-label">Conservação</span>
          <span>{{ ROTULO_CONSERVACAO[bem.condition] }}</span>
        </div>
        <div>
          <span class="resumo-label">Aquisição</span>
          <span>
            {{ formatarData(bem.acquisition_date) }} · {{ ROTULO_ORIGEM[bem.acquisition_origin] }}
            <template v-if="bem.acquisition_value"> · {{ formatarMoeda(bem.acquisition_value) }}</template>
          </span>
        </div>
      </div>

      <div class="tabs">
        <button
          v-for="aba in ['historico', 'dados', 'documentos'] as const"
          :key="aba"
          class="tab"
          :class="{ active: abaAtiva === aba }"
          type="button"
          @click="abaAtiva = aba"
        >
          {{ { historico: "Histórico", dados: "Dados", documentos: "Documentos" }[aba] }}
        </button>
      </div>

      <div class="tab-content">
        <ol v-if="abaAtiva === 'historico'" class="timeline">
          <li v-for="evento in eventos" :key="evento.id" :class="`evento-${evento.event_type}`">
            <span class="timeline-data">{{ formatarData(evento.event_date) }}</span>
            <div class="timeline-corpo">
              <strong>{{ ROTULO_EVENTO_BEM[evento.event_type] }}</strong>
              <p>{{ evento.description }}</p>
              <span v-if="evento.amount" class="valor">
                {{ formatarMoeda(evento.amount) }}
                <span v-if="evento.cash_transaction_id" class="badge">lançado no caixa</span>
              </span>
            </div>
          </li>
        </ol>

        <dl v-else-if="abaAtiva === 'dados'" class="data-list">
          <dt>Nº de patrimônio</dt>
          <dd>{{ bem.asset_number }}</dd>
          <dt>Descrição</dt>
          <dd>{{ bem.description || "—" }}</dd>
          <dt>Nº de série / modelo</dt>
          <dd>{{ bem.serial_number || "—" }}</dd>
          <dt>Origem</dt>
          <dd>
            {{ ROTULO_ORIGEM[bem.acquisition_origin] }}
            <template v-if="bem.acquisition_source"> — {{ bem.acquisition_source }}</template>
          </dd>
          <dt>Nota fiscal / termo</dt>
          <dd>{{ bem.acquisition_document || "—" }}</dd>
          <dt>Observações</dt>
          <dd>{{ bem.observations || "—" }}</dd>
        </dl>

        <div v-else-if="abaAtiva === 'documentos'">
          <p v-if="documentos.length === 0" class="state-msg">
            Nenhum documento vinculado — nota fiscal, termo de doação ou laudo podem ser vinculados pela barra lateral.
          </p>
          <ul v-else class="item-list">
            <li v-for="vinculo in documentos" :key="vinculo.id">
              <button
                type="button"
                class="link-btn doc"
                @click="router.push({ name: 'documento-detalhes', params: { id: vinculo.document_id } })"
              >
                {{ vinculo.document_title }}
              </button>
              <span> — {{ vinculo.link_role }}</span>
              <button type="button" class="link-btn remove" @click="removerVinculoDocumento(vinculo)">remover</button>
            </li>
          </ul>
        </div>
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
  font-size: 0.82rem;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
}

.status-EM_MANUTENCAO,
.status-EMPRESTADO {
  background: transparent;
  border: 1px solid var(--accent);
}

.status-BAIXADO {
  background: var(--surface-hover);
  color: var(--text-muted);
}

.baixa-box {
  max-width: 760px;
  margin: 1rem 0 0;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-left: 3px solid #c0392b;
  border-radius: 8px;
  background: var(--surface);
  font-size: 0.85rem;
  color: var(--text);
}

.baixa-box p {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
}

.resumo {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
  max-width: 760px;
  margin-top: 1rem;
}

.resumo > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.85rem;
  color: var(--text);
}

.resumo-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 1.25rem 0;
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

.tab-content {
  max-width: 760px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 2px solid var(--border);
}

.timeline li {
  position: relative;
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 0.75rem;
  padding: 0 0 1.1rem 1rem;
  font-size: 0.85rem;
}

.timeline li::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 0.3rem;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--accent);
}

.timeline li.evento-BAIXA::before {
  border-color: #c0392b;
  background: #c0392b;
}

.timeline li.evento-AQUISICAO::before {
  background: var(--accent);
}

.timeline-data {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.timeline-corpo strong {
  color: var(--text);
}

.timeline-corpo p {
  margin: 0.2rem 0 0;
  color: var(--text);
}

.valor {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.3rem;
  color: var(--text-muted);
}

.data-list {
  display: grid;
  grid-template-columns: 170px 1fr;
  row-gap: 0.6rem;
  font-size: 0.88rem;
}

.data-list dt {
  color: var(--text-muted);
}

.data-list dd {
  margin: 0;
  color: var(--text);
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

.item-list .doc {
  font-size: 0.85rem;
  color: var(--accent);
}

.item-list .remove {
  margin-left: 0.75rem;
  color: #c0392b;
}
</style>
