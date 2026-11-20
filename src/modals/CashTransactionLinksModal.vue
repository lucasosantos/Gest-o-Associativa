<script setup lang="ts">
// O que um lançamento quita (mensalidades com código, acordo, recibo,
// parcela de conta, doação, evento de patrimônio) e a ligação com estorno /
// outra perna da transferência — ver `CashTransactionModel.vinculos`.
import { onMounted, ref } from "vue";
import {
  CashTransactionModel,
  codigoDoLancamento,
  type CashTransactionComNomes,
  type VinculoLancamento,
} from "../models/CashTransaction.js";
import { closeModal } from "../composables/useModal.js";
import { formatarData, formatarMoeda } from "../utils/format.js";

const props = defineProps<{ lancamento: CashTransactionComNomes }>();

const itens = ref<VinculoLancamento[]>([]);
const carregando = ref(true);
const erro = ref("");

onMounted(async () => {
  try {
    itens.value = await CashTransactionModel.vinculos(props.lancamento.id);
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    carregando.value = false;
  }
});
</script>

<template>
  <div class="vinculos">
    <p class="lancamento-info">
      <strong>{{ codigoDoLancamento(lancamento) }}</strong> — {{ lancamento.description }}<br />
      {{ formatarMoeda(lancamento.amount) }} · {{ formatarData(lancamento.transaction_date) }} · {{ lancamento.account_name }}
    </p>

    <p v-if="carregando" class="state-msg">Carregando...</p>
    <p v-else-if="erro" class="erro">{{ erro }}</p>
    <p v-else-if="itens.length === 0" class="state-msg">Este lançamento não está ligado a nenhum registro.</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Código</th>
          <th>Descrição</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, indice) in itens" :key="indice">
          <td>{{ item.tipo }}</td>
          <td class="codigo">{{ item.codigo ?? "—" }}</td>
          <td>{{ item.descricao }}</td>
          <td>{{ item.valor === null ? "—" : formatarMoeda(item.valor) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="save-row">
      <button type="button" class="btn-secondary" @click="closeModal">Fechar</button>
    </div>
  </div>
</template>

<style scoped>
.vinculos {
  width: 640px;
  max-width: 100%;
}

.lancamento-info {
  margin: 0 0 1rem;
  font-size: 0.88rem;
  line-height: 1.5;
}

.codigo {
  font-family: ui-monospace, monospace;
  white-space: nowrap;
}

.state-msg {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.erro {
  color: #c0392b;
  font-size: 0.82rem;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border);
}

.save-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
