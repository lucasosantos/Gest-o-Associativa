<script setup lang="ts">
// Impressão do extrato de UMA conta específica num período — diferente da
// prestação de contas (que soma todas as contas): aqui o que importa é
// saldo inicial → movimentos → saldo final de uma conta só (ver
// `FinancialAccountModel.extrato`). Conta vem pelo `:id` da rota, período
// via query string.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { FinancialAccountModel, type ExtratoConta, type FinancialAccount } from "../models/FinancialAccount.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarMoeda } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";

const route = useRoute();
const router = useRouter();
const accountId = String(route.params.id);
const dataInicio = String(route.query.inicio ?? "");
const dataFim = String(route.query.fim ?? "");

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const conta = ref<FinancialAccount | null>(null);
const extrato = ref<ExtratoConta | null>(null);
const loading = ref(true);
const erro = ref("");

const TIPO_LABEL: Record<string, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
  TRANSFERENCIA_ENTRADA: "Transf. (entrada)",
  TRANSFERENCIA_SAIDA: "Transf. (saída)",
  ESTORNO: "Estorno",
};

const somaMovimentos = computed(() => extrato.value?.movimentos.reduce((total, m) => total + m.signed_amount, 0) ?? 0);

// Aplica o papel padrão de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("PADRAO");

onMounted(async () => {
  if (!dataInicio || !dataFim) {
    erro.value = "Período não informado.";
    loading.value = false;
    return;
  }

  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, dadosConta, dadosExtrato] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      FinancialAccountModel.get(accountId),
      FinancialAccountModel.extrato(accountId, dataInicio, dataFim),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    conta.value = dadosConta;
    extrato.value = dadosExtrato;
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }

  if (!erro.value) {
    await nextTick();
    imprimir();
  }
});
</script>

<template>
  <section class="content imprimir-extrato">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else-if="associacao && conta && extrato">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader :association="associacao" :address="endereco" />
        <h1>Extrato — {{ conta.name }}</h1>
        <p class="subtitulo">Período de {{ formatarData(dataInicio) }} a {{ formatarData(dataFim) }}</p>
      </header>

      <dl class="resumo">
        <dt>Saldo inicial</dt>
        <dd>{{ formatarMoeda(extrato.saldo_inicial) }}</dd>
      </dl>

      <p v-if="extrato.movimentos.length === 0" class="state-msg">Nenhuma movimentação neste período.</p>

      <table v-else class="tabela-impressao">
        <thead>
          <tr>
            <th>Data</th>
            <th>Categoria</th>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="movimento in extrato.movimentos" :key="movimento.id">
            <td class="nao-quebrar">{{ formatarData(movimento.transaction_date) }}</td>
            <td>{{ movimento.category_name || "—" }}</td>
            <td class="nao-quebrar">{{ TIPO_LABEL[movimento.transaction_type] }}</td>
            <td>{{ movimento.description }}</td>
            <td class="nao-quebrar" :class="{ negativo: movimento.signed_amount < 0 }">{{ formatarMoeda(movimento.signed_amount) }}</td>
          </tr>
        </tbody>
      </table>

      <dl class="totais">
        <dt>Movimentação do período</dt>
        <dd :class="{ negativo: somaMovimentos < 0 }">{{ formatarMoeda(somaMovimentos) }}</dd>
        <dt>Saldo final</dt>
        <dd :class="{ negativo: extrato.saldo_final < 0 }">{{ formatarMoeda(extrato.saldo_final) }}</dd>
      </dl>
    </template>
  </section>
</template>

<style scoped>
.imprimir-extrato {
  max-width: 100%;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
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

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.cabecalho {
  text-align: center;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.cabecalho h1 {
  margin: 0.4rem 0 0.2rem;
  font-size: 1.2rem;
  color: var(--text);
}

.subtitulo {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.resumo {
  display: grid;
  grid-template-columns: 160px 1fr;
  row-gap: 0.5rem;
  max-width: 360px;
  margin: 0 0 1.25rem;
  font-size: 0.9rem;
}

.resumo dt {
  color: var(--text-muted);
}

.resumo dd {
  margin: 0;
  color: var(--text);
  font-weight: 600;
}

.tabela-impressao {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  margin-bottom: 1.5rem;
}

.tabela-impressao th,
.tabela-impressao td {
  border: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
  text-align: left;
  color: var(--text);
}

.tabela-impressao th {
  background: var(--surface-hover);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.negativo {
  color: #c0392b;
}

.totais {
  display: grid;
  grid-template-columns: 200px 1fr;
  row-gap: 0.5rem;
  max-width: 360px;
  margin: 0 0 1.5rem auto;
  font-size: 0.9rem;
}

.totais dt {
  color: var(--text-muted);
}

.totais dd {
  margin: 0;
  text-align: right;
  color: var(--text);
  font-weight: 600;
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .cabecalho h1,
  .resumo dd,
  .tabela-impressao th,
  .tabela-impressao td,
  .totais dd {
    color: #000;
  }

  .tabela-impressao th,
  .tabela-impressao td {
    border-color: #000;
  }

  .tabela-impressao th {
    background: none;
  }

  .tabela-impressao tr {
    break-inside: avoid;
  }
}
</style>
