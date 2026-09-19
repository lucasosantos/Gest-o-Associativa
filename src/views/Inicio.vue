<script setup lang="ts">
// Tela inicial: dashboard-resumo da associação ativa e os dados
// institucionais (aba "Instituição", que antes vivia numa tela própria).
// A troca de associação em si (select, "Entrar novamente", senha) mora na
// sidebar (`AssociationSwitcher.vue`, montado em `SidebarTools.vue`) —
// pedido do usuário: só aparece aqui, não nas demais telas.
import { onMounted, ref, watch } from "vue";
import { currentAssociationId, isAssociationConnected } from "../composables/useCurrentAssociation.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import { MemberModel } from "../models/Member.js";
import { FinancialAccountModel } from "../models/FinancialAccount.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { PayableModel } from "../models/Payable.js";
import { ReceivableModel } from "../models/Receivable.js";
import { ProtocolEntryModel } from "../models/ProtocolEntry.js";
import { DocumentModel } from "../models/Document.js";
import { formatarMoeda } from "../utils/format.js";
import InstitutionalDataEditor from "../components/InstitutionalDataEditor.vue";

type Aba = "dashboard" | "instituicao";

const abaAtiva = ref<Aba>("dashboard");

interface Resumo {
  totalSocios: number;
  sociosAtivos: number;
  saldoTotal: number;
  cobrancasAbertas: number;
  cobrancasVencidas: number;
  contasAPagarAbertas: number;
  contasAReceberAbertas: number;
  protocolosAbertos: number;
  totalDocumentos: number;
}

const resumo = ref<Resumo | null>(null);
const loadingResumo = ref(false);

async function carregarResumo() {
  if (!currentAssociationId.value) {
    resumo.value = null;
    return;
  }

  loadingResumo.value = true;
  try {
    const [socios, contas, mensalidades, pagar, receber, protocolos, documentos] = await Promise.all([
      MemberModel.list(),
      FinancialAccountModel.list(),
      MembershipPaymentModel.resumo(),
      PayableModel.list(),
      ReceivableModel.list(),
      ProtocolEntryModel.list(),
      DocumentModel.list(),
    ]);

    resumo.value = {
      totalSocios: socios.length,
      sociosAtivos: socios.filter((s) => s.status === "ATIVO").length,
      saldoTotal: contas.reduce((soma, conta) => soma + conta.balance, 0),
      cobrancasAbertas: mensalidades.abertas,
      cobrancasVencidas: mensalidades.vencidas,
      contasAPagarAbertas: pagar.filter((p) => p.status === "ABERTA" || p.status === "PARCIAL").length,
      contasAReceberAbertas: receber.filter((r) => r.status === "ABERTA" || r.status === "PARCIAL").length,
      protocolosAbertos: protocolos.filter((p) => p.status === "ABERTO" || p.status === "EM_ANDAMENTO").length,
      totalDocumentos: documentos.length,
    };
  } finally {
    loadingResumo.value = false;
  }
}

// `onMounted` + `watch(currentAssociationId, ...)` — sem isto, reabrir esta
// tela (ela remonta a cada navegação, `:key="route.fullPath"` em App.vue)
// não recarregava o resumo: `currentAssociationId` já estava definido
// (associação continua conectada entre navegações), então um `watch` puro
// nunca disparava de novo, e `resumo` ficava `null` na instância nova —
// dashboard vazio até trocar de associação de verdade.
useAssociationScopedData(carregarResumo);

// Assim que uma associação conecta (ver AssociationSwitcher.vue, na
// sidebar), decide se mostra o dashboard ou pede pra completar o cadastro
// institucional primeiro (banco novo, ainda sem a linha de `associations`).
watch(isAssociationConnected, (conectada) => {
  if (conectada) abaAtiva.value = currentAssociationId.value ? "dashboard" : "instituicao";
});

onMounted(() => {
  if (isAssociationConnected.value) {
    abaAtiva.value = currentAssociationId.value ? "dashboard" : "instituicao";
  }
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Início</h2>
        <p>Escolha a associação ativa na barra lateral — os demais módulos (sócios, financeiro, documentos...) mostram só os dados dela.</p>
      </div>
    </div>

    <template v-if="isAssociationConnected">
        <div class="tabs">
          <button class="tab" :class="{ active: abaAtiva === 'dashboard' }" type="button" @click="abaAtiva = 'dashboard'">
            Dashboard
          </button>
          <button class="tab" :class="{ active: abaAtiva === 'instituicao' }" type="button" @click="abaAtiva = 'instituicao'">
            Instituição
          </button>
        </div>

        <div v-if="abaAtiva === 'dashboard'">
          <div v-if="loadingResumo" class="state-msg">Carregando...</div>
          <div v-else-if="resumo" class="cards-grid">
            <div class="card">
              <h3>Sócios</h3>
              <p class="card-value">{{ resumo.sociosAtivos }}</p>
              <p class="card-sub">ativos de {{ resumo.totalSocios }} cadastrados</p>
            </div>

            <div class="card">
              <h3>Saldo em caixa</h3>
              <p class="card-value">{{ formatarMoeda(resumo.saldoTotal) }}</p>
              <p class="card-sub">soma de todas as contas financeiras</p>
            </div>

            <div class="card">
              <h3>Mensalidades</h3>
              <p class="card-value">{{ resumo.cobrancasAbertas }}</p>
              <p class="card-sub">
                em aberto
                <span v-if="resumo.cobrancasVencidas > 0" class="card-alert">
                  · {{ resumo.cobrancasVencidas }} vencida(s)
                </span>
              </p>
            </div>

            <div class="card">
              <h3>Contas a pagar</h3>
              <p class="card-value">{{ resumo.contasAPagarAbertas }}</p>
              <p class="card-sub">em aberto ou parciais</p>
            </div>

            <div class="card">
              <h3>Contas a receber</h3>
              <p class="card-value">{{ resumo.contasAReceberAbertas }}</p>
              <p class="card-sub">em aberto ou parciais</p>
            </div>

            <div class="card">
              <h3>Protocolos</h3>
              <p class="card-value">{{ resumo.protocolosAbertos }}</p>
              <p class="card-sub">abertos ou em andamento</p>
            </div>

            <div class="card">
              <h3>Documentos</h3>
              <p class="card-value">{{ resumo.totalDocumentos }}</p>
              <p class="card-sub">cadastrados</p>
            </div>
          </div>
        </div>

        <div v-else>
          <InstitutionalDataEditor
            :key="currentAssociationId ?? 'nova'"
            :association-id="currentAssociationId"
            :on-saved="carregarResumo"
          />
        </div>
    </template>

    <p v-else class="state-msg">Escolha uma associação na barra lateral para começar.</p>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 0 0 1.25rem;
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

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  max-width: 1100px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
}

.card h3 {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.card-value {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
}

.card-sub {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.card-alert {
  color: #c0392b;
  font-weight: 600;
}
</style>
