<script setup lang="ts">
// Impressão da prestação de contas — todos os lançamentos confirmados da
// associação (todas as contas) dentro do período escolhido em
// Financeiro.vue › aba Relatórios. Datas vêm via query string (não há um
// registro único pra abrir por `:id`, é sempre uma consulta contra o
// período pedido).
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CashTransactionModel, type CashTransactionRelatorio } from "../models/CashTransaction.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarMoeda } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";

const route = useRoute();
const router = useRouter();
const dataInicio = String(route.query.inicio ?? "");
const dataFim = String(route.query.fim ?? "");

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const lancamentos = ref<CashTransactionRelatorio[]>([]);
const loading = ref(true);
const erro = ref("");

const TIPO_LABEL: Record<string, string> = {
  RECEITA: "Receita",
  DESPESA: "Despesa",
  TRANSFERENCIA_ENTRADA: "Transf. (entrada)",
  TRANSFERENCIA_SAIDA: "Transf. (saída)",
  ESTORNO: "Estorno",
};

const totalEntradas = computed(() =>
  lancamentos.value.reduce((total, l) => total + (l.signed_amount > 0 ? l.signed_amount : 0), 0)
);
const totalSaidas = computed(() =>
  lancamentos.value.reduce((total, l) => total + (l.signed_amount < 0 ? -l.signed_amount : 0), 0)
);
const saldoPeriodo = computed(() => totalEntradas.value - totalSaidas.value);

function imprimir() {
  window.print();
}

onMounted(async () => {
  if (!dataInicio || !dataFim) {
    erro.value = "Período não informado.";
    loading.value = false;
    return;
  }

  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, lista] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      CashTransactionModel.listarPorPeriodo(dataInicio, dataFim),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    lancamentos.value = lista;
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
  <section class="content imprimir-prestacao">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else-if="associacao">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader :association="associacao" :address="endereco" />
        <h1>Prestação de Contas</h1>
        <p class="subtitulo">Período de {{ formatarData(dataInicio) }} a {{ formatarData(dataFim) }}</p>
      </header>

      <p v-if="lancamentos.length === 0" class="state-msg">Nenhum lançamento neste período.</p>

      <table v-else class="tabela-impressao">
        <thead>
          <tr>
            <th>Data</th>
            <th>Conta</th>
            <th>Categoria</th>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lancamento in lancamentos" :key="lancamento.id">
            <td>{{ formatarData(lancamento.transaction_date) }}</td>
            <td>{{ lancamento.account_name }}</td>
            <td>{{ lancamento.category_name || "—" }}</td>
            <td>{{ TIPO_LABEL[lancamento.transaction_type] }}</td>
            <td>{{ lancamento.description }}</td>
            <td :class="{ negativo: lancamento.signed_amount < 0 }">
              {{ formatarMoeda(lancamento.signed_amount) }}
            </td>
          </tr>
        </tbody>
      </table>

      <dl class="totais">
        <dt>Total de entradas</dt>
        <dd>{{ formatarMoeda(totalEntradas) }}</dd>
        <dt>Total de saídas</dt>
        <dd>{{ formatarMoeda(totalSaidas) }}</dd>
        <dt>Saldo do período</dt>
        <dd :class="{ negativo: saldoPeriodo < 0 }">{{ formatarMoeda(saldoPeriodo) }}</dd>
      </dl>

      <div class="assinatura">
        <div class="linha-assinatura"></div>
        <p>Tesouraria</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.imprimir-prestacao {
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
  margin: 0 0 3rem auto;
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

.assinatura {
  text-align: center;
  max-width: 360px;
  margin: 0 auto;
}

.linha-assinatura {
  border-top: 1px solid var(--text);
  width: 100%;
  margin: 0 auto 0.4rem;
}

.assinatura p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .cabecalho h1,
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

  .linha-assinatura {
    border-top-color: #000;
  }
}
</style>
