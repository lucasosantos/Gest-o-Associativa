<script setup lang="ts">
// Lista de mensalidades de todos os sócios ativos, mês a mês — desde a
// `version: 13` (migration `mensalidade_por_ausencia_de_pagamento`) não
// existe mais cobrança pré-gerada por sócio: cada linha aqui é calculada
// na hora cruzando `parcelas` (calendário de meses) com `membership_payments`
// (pagamentos já registrados) — quem não tem pagamento pra um mês já
// vencido aparece como "Vencido". Ver `MembershipPaymentModel`.
import { computed, ref, watch } from "vue";
import {
  MembershipPaymentModel,
  type MensalidadeLinha,
  type StatusMensalidade,
} from "../models/MembershipPayment.js";
import { formatarMoeda, formatarData, formatarCompetencia } from "../utils/format.js";
import { openModal } from "../composables/useModal.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import MembershipPaymentForm from "../modals/MembershipPaymentForm.vue";

const PAGE_SIZE = 20;
const competenceFiltro = ref("");
const statusFiltro = ref<StatusMensalidade | "">("");
const linhas = ref<MensalidadeLinha[]>([]);
const totalLinhas = ref(0);
const paginaAtual = ref(1);
const loading = ref(true);
const totalPaginas = computed(() => Math.max(1, Math.ceil(totalLinhas.value / PAGE_SIZE)));

const STATUS_LABEL: Record<StatusMensalidade, string> = {
  PAGO: "Pago",
  VENCIDO: "Vencido",
  ABERTO: "Em aberto",
};

async function carregar() {
  loading.value = true;
  try {
    const pagina = await MembershipPaymentModel.listar(
      {
        competenceMonth: competenceFiltro.value ? `${competenceFiltro.value}-01` : undefined,
        status: statusFiltro.value || undefined,
      },
      { page: paginaAtual.value, pageSize: PAGE_SIZE }
    );
    linhas.value = pagina.items;
    totalLinhas.value = pagina.total;
  } finally {
    loading.value = false;
  }
}

watch([competenceFiltro, statusFiltro], () => {
  paginaAtual.value = 1;
  carregar();
});

function mudarPagina(delta: number) {
  const nova = paginaAtual.value + delta;
  if (nova < 1 || nova > totalPaginas.value) return;
  paginaAtual.value = nova;
  carregar();
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
      onSaved: carregar,
    },
  });
}

useAssociationScopedData(() => {
  paginaAtual.value = 1;
  carregar();
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Cobranças</h2>
        <p>Mensalidades dos sócios ativos, mês a mês.</p>
      </div>
    </div>

    <div class="filter-row">
      <div>
        <label class="field-label" for="competence-filter">Competência</label>
        <input id="competence-filter" v-model="competenceFiltro" type="month" />
      </div>
      <div>
        <label class="field-label" for="status-filter">Situação</label>
        <select id="status-filter" v-model="statusFiltro">
          <option value="">Todas</option>
          <option v-for="(label, status) in STATUS_LABEL" :key="status" :value="status">{{ label }}</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="linhas.length === 0" class="state-msg">Nenhuma mensalidade encontrada.</p>

    <template v-else>
      <table class="data-table">
        <thead>
          <tr>
            <th>Sócio</th>
            <th>Matrícula</th>
            <th>Competência</th>
            <th>Vencimento</th>
            <th>Situação</th>
            <th>Recibo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="linha in linhas" :key="`${linha.member_id}-${linha.parcela_id}`">
            <td>{{ linha.full_name }}</td>
            <td>{{ linha.registration_number }}</td>
            <td>{{ formatarCompetencia(linha.competence_month) }}</td>
            <td>{{ formatarData(linha.due_date) }}</td>
            <td>
              {{ STATUS_LABEL[linha.status] }}
              <span v-if="linha.status === 'PAGO' && linha.paid_amount != null"> — {{ formatarMoeda(linha.paid_amount) }}</span>
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
        <span>Página {{ paginaAtual }} de {{ totalPaginas }} · {{ totalLinhas }} mensalidade(s)</span>
        <button type="button" class="btn-secondary" :disabled="paginaAtual >= totalPaginas" @click="mudarPagina(1)">
          Próxima
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
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
  max-width: 900px;
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

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
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
