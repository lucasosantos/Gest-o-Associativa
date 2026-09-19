<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MemberModel, type MemberComPessoa, type MemberStatusHistorico } from "../models/Member.js";
import { PersonContactModel, type PersonContact } from "../models/PersonContact.js";
import { MemberDependentModel, type MemberDependent } from "../models/MemberDependent.js";
import { MemberRepresentativeModel, type MemberRepresentative } from "../models/MemberRepresentative.js";
import { DocumentLinkModel, type DocumentLinkComDocumento } from "../models/DocumentLink.js";
import { MembershipPaymentModel, type MensalidadeLinha, type StatusMensalidade } from "../models/MembershipPayment.js";
import { formatarData, formatarCpf, formatarCompetencia } from "../utils/format.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import MemberStatusChangeForm from "../modals/MemberStatusChangeForm.vue";
import PersonContactForm from "../modals/PersonContactForm.vue";
import MemberDependentForm from "../modals/MemberDependentForm.vue";
import MemberRepresentativeForm from "../modals/MemberRepresentativeForm.vue";
import DocumentLinkForm from "../modals/DocumentLinkForm.vue";
import MembershipPaymentForm from "../modals/MembershipPaymentForm.vue";
import MembershipBulkPaymentForm from "../modals/MembershipBulkPaymentForm.vue";
import MembershipAdvancePaymentForm from "../modals/MembershipAdvancePaymentForm.vue";
import MembershipAgreementForm from "../modals/MembershipAgreementForm.vue";
import DeclaracaoForm from "../modals/DeclaracaoForm.vue";

const route = useRoute();
const router = useRouter();
const memberId = computed(() => String(route.params.id));

const socio = ref<MemberComPessoa | null>(null);
const contatos = ref<PersonContact[]>([]);
const dependentes = ref<MemberDependent[]>([]);
const representantes = ref<MemberRepresentative[]>([]);
const historico = ref<MemberStatusHistorico[]>([]);
const documentos = ref<DocumentLinkComDocumento[]>([]);
const loading = ref(true);
const abaAtiva = ref<
  "dados" | "contatos" | "dependentes" | "representantes" | "documentos" | "historico" | "mensalidades"
>("dados");

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  SUSPENSO: "Suspenso",
  DESLIGADO: "Desligado",
  FALECIDO: "Falecido",
};

const STATUS_MENSALIDADE_LABEL: Record<StatusMensalidade, string> = {
  PAGO: "Pago",
  VENCIDO: "Vencido",
  ABERTO: "Em aberto",
};

// --- Mensalidades (aba própria da ficha) ---
const PAGE_SIZE = 12;
const inadimplente = ref(false);
const mensalidades = ref<MensalidadeLinha[]>([]);
const totalMensalidades = ref(0);
const paginaAtual = ref(1);
const loadingMensalidades = ref(false);
const totalPaginas = computed(() => Math.max(1, Math.ceil(totalMensalidades.value / PAGE_SIZE)));

// --- Seleção múltipla pra acordo de renegociação (só parcelas VENCIDO) ---
const parcelasSelecionadas = ref<Set<string>>(new Set());
const linhasSelecionadas = computed(() => mensalidades.value.filter((linha) => parcelasSelecionadas.value.has(linha.parcela_id)));

async function carregarMensalidades() {
  if (!socio.value) return;
  loadingMensalidades.value = true;
  try {
    const [ehInadimplente, pagina] = await Promise.all([
      MemberModel.isInadimplente(socio.value.id),
      MembershipPaymentModel.listarPorSocio(socio.value.id, { page: paginaAtual.value, pageSize: PAGE_SIZE }),
    ]);
    inadimplente.value = ehInadimplente;
    mensalidades.value = pagina.items;
    totalMensalidades.value = pagina.total;
  } finally {
    loadingMensalidades.value = false;
  }
}

function mudarPagina(delta: number) {
  const nova = paginaAtual.value + delta;
  if (nova < 1 || nova > totalPaginas.value) return;
  paginaAtual.value = nova;
  carregarMensalidades();
}

function abrirBaixa(linha: MensalidadeLinha) {
  openModal({
    title: "Pagar mensalidade",
    component: MembershipPaymentForm,
    props: {
      memberId: linha.member_id,
      parcelaId: linha.parcela_id,
      fullName: linha.full_name,
      competenceMonth: linha.competence_month,
      onSaved: carregarMensalidades,
    },
  });
}

function alternarSelecaoParcela(parcelaId: string) {
  const proxima = new Set(parcelasSelecionadas.value);
  if (proxima.has(parcelaId)) proxima.delete(parcelaId);
  else proxima.add(parcelaId);
  parcelasSelecionadas.value = proxima;
}

function abrirAcordo() {
  if (!socio.value || linhasSelecionadas.value.length === 0) return;
  openModal({
    title: "Fazer acordo",
    component: MembershipAgreementForm,
    props: {
      memberId: socio.value.id,
      fullName: socio.value.full_name,
      parcelas: linhasSelecionadas.value.map((l) => ({ parcela_id: l.parcela_id, competence_month: l.competence_month })),
      onSaved: () => {
        parcelasSelecionadas.value = new Set();
        carregarMensalidades();
      },
    },
  });
}

/**
 * Busca TODAS as parcelas vencidas do sócio (não só as da página atual da
 * tabela — `MembershipPaymentModel.listarVencidasPorSocio`, sem paginação),
 * pra "Pagar todas"/"Fazer acordo de todas" não depender do usuário marcar
 * checkbox por checkbox nem navegar entre páginas.
 */
async function buscarTodasVencidas() {
  if (!socio.value) return [];
  return MembershipPaymentModel.listarVencidasPorSocio(socio.value.id);
}

async function abrirPagamentoTodasVencidas() {
  const vencidas = await buscarTodasVencidas();
  if (!socio.value || vencidas.length === 0) return;
  openModal({
    title: "Pagar mensalidades vencidas",
    component: MembershipBulkPaymentForm,
    props: {
      memberId: socio.value.id,
      fullName: socio.value.full_name,
      parcelas: vencidas.map((l) => ({ parcela_id: l.parcela_id, competence_month: l.competence_month })),
      onSaved: carregarMensalidades,
    },
  });
}

function abrirPagamentoAdiantado() {
  if (!socio.value) return;
  openModal({
    title: "Pagar mensalidades adiantadas",
    component: MembershipAdvancePaymentForm,
    props: {
      memberId: socio.value.id,
      fullName: socio.value.full_name,
      onSaved: carregarMensalidades,
    },
  });
}

async function abrirAcordoTodasVencidas() {
  const vencidas = await buscarTodasVencidas();
  if (!socio.value || vencidas.length === 0) return;
  openModal({
    title: "Fazer acordo",
    component: MembershipAgreementForm,
    props: {
      memberId: socio.value.id,
      fullName: socio.value.full_name,
      parcelas: vencidas.map((l) => ({ parcela_id: l.parcela_id, competence_month: l.competence_month })),
      onSaved: () => {
        parcelasSelecionadas.value = new Set();
        carregarMensalidades();
      },
    },
  });
}

async function carregar() {
  loading.value = true;
  try {
    const encontrado = await MemberModel.get(memberId.value);
    socio.value = encontrado;
    if (!encontrado) return;

    const [c, d, r, h, docs] = await Promise.all([
      PersonContactModel.listByPerson(encontrado.person_id),
      MemberDependentModel.listByMember(encontrado.id),
      MemberRepresentativeModel.listByMember(encontrado.id),
      MemberModel.statusHistory(encontrado.id),
      DocumentLinkModel.listForEntity("MEMBER", encontrado.id),
    ]);
    contatos.value = c;
    dependentes.value = d;
    representantes.value = r;
    historico.value = h;
    documentos.value = docs;
  } finally {
    loading.value = false;
  }
}

function abrirEdicao() {
  router.push({ name: "socio-editar", params: { id: memberId.value } });
}

function abrirAlterarSituacao() {
  if (!socio.value) return;
  openModal({
    title: "Alterar situação",
    component: MemberStatusChangeForm,
    props: { memberId: memberId.value, currentStatus: socio.value.status, onSaved: carregar },
  });
}

function abrirNovoContato() {
  if (!socio.value) return;
  openModal({
    title: "Novo contato",
    component: PersonContactForm,
    props: { personId: socio.value.person_id, onSaved: carregar },
  });
}

function abrirNovoDependente() {
  openModal({
    title: "Novo dependente",
    component: MemberDependentForm,
    props: { memberId: memberId.value, onSaved: carregar },
  });
}

function abrirNovoRepresentante() {
  openModal({
    title: "Novo representante",
    component: MemberRepresentativeForm,
    props: { memberId: memberId.value, onSaved: carregar },
  });
}

function abrirGerarDeclaracao() {
  if (!socio.value) return;
  openModal({
    title: "Gerar declaração",
    component: DeclaracaoForm,
    props: { memberId: socio.value.id, fullName: socio.value.full_name },
  });
}

function abrirVincularDocumento() {
  openModal({
    title: "Vincular documento",
    component: DocumentLinkForm,
    props: { entityType: "MEMBER", entityId: memberId.value, onSaved: carregar },
  });
}

async function removerVinculoDocumento(vinculo: DocumentLinkComDocumento) {
  await DocumentLinkModel.remove(vinculo.id);
  await carregar();
}

function atualizarSidebar() {
  const itensBase = [
    { id: "editar", label: "Editar sócio", icon: "edit", onClick: abrirEdicao },
    { id: "situacao", label: "Alterar situação", icon: "clock", onClick: abrirAlterarSituacao },
    { id: "declaracao", label: "Gerar declaração", icon: "file", onClick: abrirGerarDeclaracao },
  ];

  const itensPorAba: Record<string, { id: string; label: string; icon: string; onClick: () => void }[]> = {
    contatos: [{ id: "novo-contato", label: "Novo contato", icon: "plus", onClick: abrirNovoContato }],
    dependentes: [{ id: "novo-dependente", label: "Novo dependente", icon: "plus", onClick: abrirNovoDependente }],
    representantes: [
      { id: "novo-representante", label: "Novo representante", icon: "plus", onClick: abrirNovoRepresentante },
    ],
    documentos: [
      { id: "vincular-documento", label: "Vincular documento", icon: "plus", onClick: abrirVincularDocumento },
    ],
    mensalidades: [],
    dados: [],
    historico: [],
  };

  setSidebarTools([
    { group: "Sócio", items: itensBase },
    ...(itensPorAba[abaAtiva.value].length
      ? [{ group: "Nesta aba", items: itensPorAba[abaAtiva.value] }]
      : []),
  ]);
}

watch(abaAtiva, (aba) => {
  atualizarSidebar();
  if (aba === "mensalidades" && mensalidades.value.length === 0) carregarMensalidades();
});

useAssociationScopedData(carregar);

onMounted(atualizarSidebar);
</script>

<template>
  <section class="content">
    <div class="breadcrumb">
      <button type="button" class="link-btn" @click="router.push({ name: 'socios' })">Sócios</button>
      <span class="sep">/</span>
      <span class="current">{{ socio?.full_name ?? "Carregando..." }}</span>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <div v-else-if="!socio" class="state-msg">Sócio não encontrado.</div>

    <template v-else>
      <div class="page-header">
        <img v-if="socio.photo" :src="socio.photo" alt="Foto do sócio" class="photo-avatar" />
        <div v-else class="photo-avatar photo-avatar-vazio">Sem foto</div>
        <div>
          <h2>{{ socio.full_name }}</h2>
          <p>
            Matrícula {{ socio.registration_number }} · Associado em {{ formatarData(socio.association_date) }} ·
            <span class="badge">{{ STATUS_LABEL[socio.status] }}</span>
          </p>
        </div>
      </div>

      <div class="tabs">
        <button
          v-for="aba in ['dados', 'contatos', 'dependentes', 'representantes', 'documentos', 'mensalidades', 'historico'] as const"
          :key="aba"
          class="tab"
          :class="{ active: abaAtiva === aba }"
          type="button"
          @click="abaAtiva = aba"
        >
          {{
            {
              dados: "Dados",
              contatos: "Contatos",
              dependentes: "Dependentes",
              representantes: "Representantes",
              documentos: "Documentos",
              mensalidades: "Mensalidades",
              historico: "Histórico",
            }[aba]
          }}
        </button>
      </div>

      <div class="tab-content">
        <dl v-if="abaAtiva === 'dados'" class="data-list">
          <dt>CPF</dt>
          <dd>{{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}</dd>
          <dt>Mensalidade legado</dt>
          <dd>
            {{ socio.dues_start_date ? `Considerada a partir de ${formatarData(socio.dues_start_date)}` : "—" }}
          </dd>
          <dt>Observações</dt>
          <dd>{{ socio.observations || "—" }}</dd>
        </dl>

        <div v-else-if="abaAtiva === 'contatos'">
          <p v-if="contatos.length === 0" class="state-msg">Nenhum contato cadastrado.</p>
          <ul v-else class="item-list">
            <li v-for="contato in contatos" :key="contato.id">
              <strong>{{ contato.contact_type }}</strong> — {{ contato.contact_value }}
              <span v-if="contato.is_primary" class="badge">Principal</span>
            </li>
          </ul>
        </div>

        <div v-else-if="abaAtiva === 'dependentes'">
          <p v-if="dependentes.length === 0" class="state-msg">Nenhum dependente cadastrado.</p>
          <ul v-else class="item-list">
            <li v-for="dependente in dependentes" :key="dependente.id">
              <strong>{{ dependente.dependent_name }}</strong> — {{ dependente.relationship }}
              <span v-if="dependente.birth_date"> · {{ formatarData(dependente.birth_date) }}</span>
            </li>
          </ul>
        </div>

        <div v-else-if="abaAtiva === 'representantes'">
          <p v-if="representantes.length === 0" class="state-msg">Nenhum representante cadastrado.</p>
          <ul v-else class="item-list">
            <li v-for="representante in representantes" :key="representante.id">
              {{ representante.relationship }}
              <span v-if="representante.start_date"> · desde {{ formatarData(representante.start_date) }}</span>
            </li>
          </ul>
        </div>

        <div v-else-if="abaAtiva === 'documentos'">
          <p v-if="documentos.length === 0" class="state-msg">Nenhum documento vinculado a este sócio.</p>
          <ul v-else class="item-list">
            <li v-for="vinculo in documentos" :key="vinculo.id">
              <button
                type="button"
                class="link-btn"
                @click="router.push({ name: 'documento-detalhes', params: { id: vinculo.document_id } })"
              >
                {{ vinculo.document_title }}
              </button>
              <span> — {{ vinculo.link_role }}</span>
              <button type="button" class="link-btn remove" @click="removerVinculoDocumento(vinculo)">remover</button>
            </li>
          </ul>
        </div>

        <div v-else-if="abaAtiva === 'mensalidades'" class="mensalidades-tab">
          <div class="plano-row">
            <button type="button" class="btn-secondary" @click="abrirPagamentoAdiantado">Pagar mensalidades adiantadas</button>
          </div>

          <div v-if="inadimplente" class="plano-row">
            <span class="badge badge-alerta">Inadimplente</span>
            <button type="button" class="btn-secondary" @click="abrirPagamentoTodasVencidas">Pagar todas as vencidas</button>
            <button type="button" class="btn-secondary" @click="abrirAcordoTodasVencidas">Fazer acordo de todas as vencidas</button>
          </div>

          <div v-if="linhasSelecionadas.length > 0" class="plano-row">
            <span>{{ linhasSelecionadas.length }} mensalidade(s) selecionada(s)</span>
            <button type="button" class="btn-secondary" @click="abrirAcordo">Fazer acordo</button>
          </div>

          <div v-if="loadingMensalidades" class="state-msg">Carregando...</div>
          <p v-else-if="mensalidades.length === 0" class="state-msg">
            Nenhuma mensalidade em aberto pra este sócio ainda — cadastre o valor da contribuição na aba Instituição.
          </p>

          <template v-else>
            <table class="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Competência</th>
                  <th>Vencimento</th>
                  <th>Situação</th>
                  <th>Recibo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="linha in mensalidades" :key="linha.parcela_id">
                  <td>
                    <input
                      v-if="linha.status === 'VENCIDO'"
                      type="checkbox"
                      :checked="parcelasSelecionadas.has(linha.parcela_id)"
                      @change="alternarSelecaoParcela(linha.parcela_id)"
                    />
                  </td>
                  <td>{{ formatarCompetencia(linha.competence_month) }}</td>
                  <td>{{ formatarData(linha.due_date) }}</td>
                  <td>
                    {{ STATUS_MENSALIDADE_LABEL[linha.status] }}
                    <span v-if="linha.membership_agreement_id" class="badge">via acordo</span>
                  </td>
                  <td>{{ linha.receipt_number ?? "—" }}</td>
                  <td>
                    <button v-if="linha.status !== 'PAGO'" type="button" class="link-btn" @click="abrirBaixa(linha)">
                      Pagar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="paginacao">
              <button type="button" class="btn-secondary" :disabled="paginaAtual <= 1" @click="mudarPagina(-1)">
                Anterior
              </button>
              <span>Página {{ paginaAtual }} de {{ totalPaginas }}</span>
              <button
                type="button"
                class="btn-secondary"
                :disabled="paginaAtual >= totalPaginas"
                @click="mudarPagina(1)"
              >
                Próxima
              </button>
            </div>
          </template>
        </div>

        <div v-else-if="abaAtiva === 'historico'">
          <p v-if="historico.length === 0" class="state-msg">Nenhuma mudança de situação registrada.</p>
          <ul v-else class="item-list">
            <li v-for="item in historico" :key="item.id">
              {{ formatarData(item.effective_date) }} — {{ item.old_status ?? "—" }} → <strong>{{ item.new_status }}</strong>
              <span v-if="item.reason"> ({{ item.reason }})</span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.photo-avatar {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
}

.photo-avatar-vazio {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 0.68rem;
  text-align: center;
}

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

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
}

.badge-alerta {
  background: #fdecea;
  color: #c0392b;
}

.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 1rem 0 1.25rem;
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
  max-width: 640px;
}

.mensalidades-tab {
  max-width: 900px;
}

.plano-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.88rem;
  color: var(--text);
}

.data-list {
  display: grid;
  grid-template-columns: 160px 1fr;
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

.item-list .link-btn {
  font-size: 0.85rem;
  color: var(--accent);
}

.item-list .remove {
  margin-left: 0.75rem;
  color: #c0392b;
  font-size: 0.78rem;
}

.data-table {
  width: 100%;
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

.paginacao {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.btn-secondary {
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  font-size: 0.82rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
