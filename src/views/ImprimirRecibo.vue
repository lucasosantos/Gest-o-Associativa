<script setup lang="ts">
// Tela de impressão do recibo de mensalidade — aberta automaticamente
// depois de registrar um pagamento em `MembershipPaymentForm.vue` (ver
// `MembershipPaymentModel.pagar`, que devolve o pagamento recém-criado
// pra navegar direto pra cá). Serve tanto pra imprimir de verdade quanto
// pra só ler os dados na tela e copiar num talão de recibo físico — por
// isso o valor aparece formatado bem grande, fácil de ler. Pagamento de
// vários meses de uma vez (`pagarVarias`) sai num recibo SÓ, com o valor
// total e a lista dos meses (`MembershipPaymentModel.recibo`).
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MembershipPaymentModel, type ReciboMensalidades } from "../models/MembershipPayment.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarMoeda, formatarCompetencia, hojeIso } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";

const route = useRoute();
const router = useRouter();
const paymentId = String(route.params.id);

const recibo = ref<ReciboMensalidades | null>(null);
const pagamento = computed(() => recibo.value?.pagamento ?? null);
const varios = computed(() => (recibo.value?.itens.length ?? 0) > 1);
const mesesTexto = computed(() => {
  const meses = recibo.value?.itens.map((item) => formatarCompetencia(item.competence_month)) ?? [];
  return meses.length > 1 ? `${meses.slice(0, -1).join(", ")} e ${meses[meses.length - 1]}` : (meses[0] ?? "");
});
const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const loading = ref(true);

const dataEmissao = computed(() => formatarData(hojeIso()));

// Aplica o papel de recibo de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("RECIBO");

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosPagamento, dadosAssociacao, dadosEndereco] = await Promise.all([
      MembershipPaymentModel.recibo(paymentId),
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
    ]);
    recibo.value = dadosPagamento;
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
  } finally {
    loading.value = false;
  }

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-recibo">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else-if="pagamento && recibo">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <div class="recibo documento-recibo">
        <header class="cabecalho">
          <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
          <h1>Recibo{{ pagamento.receipt_number ? ` Nº ${pagamento.receipt_number}` : "" }}</h1>
        </header>

        <p class="valor">{{ formatarMoeda(recibo.total) }}</p>

        <p class="corpo">
          Recebemos de <strong>{{ pagamento.full_name }}</strong> (matrícula {{ pagamento.registration_number }})
          a quantia de <strong>{{ formatarMoeda(recibo.total) }}</strong>,
          <template v-if="varios">
            referente às <strong>{{ recibo.itens.length }} mensalidades</strong> de <strong>{{ mesesTexto }}</strong>.
          </template>
          <template v-else>
            referente à mensalidade de <strong>{{ mesesTexto }}</strong>.
          </template>
        </p>

        <table v-if="varios" class="meses">
          <thead>
            <tr>
              <th>Mensalidade</th>
              <th>Código</th>
              <th class="col-valor">Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in recibo.itens" :key="item.id">
              <td class="nao-quebrar">{{ formatarCompetencia(item.competence_month) }}</td>
              <td class="nao-quebrar">{{ item.codigo }}</td>
              <td class="col-valor nao-quebrar">{{ formatarMoeda(item.paid_amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">Total</td>
              <td class="col-valor nao-quebrar">{{ formatarMoeda(recibo.total) }}</td>
            </tr>
          </tfoot>
        </table>

        <dl class="detalhes">
          <dt>Data do pagamento</dt>
          <dd>{{ formatarData(pagamento.paid_at) }}</dd>
          <dt>Forma de pagamento</dt>
          <dd>{{ pagamento.payment_method ?? "—" }}</dd>
          <template v-if="!varios">
            <dt>Código da mensalidade</dt>
            <dd>{{ pagamento.codigo }}</dd>
          </template>
          <dt v-if="pagamento.lancamento_codigo">Lançamento no caixa</dt>
          <dd v-if="pagamento.lancamento_codigo">{{ pagamento.lancamento_codigo }}</dd>
        </dl>

        <p class="local-data">Emitido em {{ dataEmissao }}</p>

        <div class="assinatura">
          <div class="linha-assinatura"></div>
          <p>Assinatura</p>
        </div>
      </div>
    </template>

    <p v-else class="state-msg">Pagamento não encontrado.</p>
  </section>
</template>

<style scoped>
.imprimir-recibo {
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

.recibo {
  max-width: 560px;
  margin: 0 auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2rem 2.5rem;
  background: var(--surface);
}

.cabecalho {
  text-align: center;
  margin-bottom: 1.25rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.cabecalho h1 {
  margin: 0.4rem 0 0;
  font-size: 1.2rem;
  color: var(--text);
}

.valor {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 1.25rem;
}

.corpo {
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1.7;
  margin: 0 0 1.5rem;
}

.meses {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  margin: 0 0 1.5rem;
  color: var(--text);
}

.meses th,
.meses td {
  border-bottom: 1px solid var(--border);
  padding: 0.3rem 0.4rem;
  text-align: left;
}

.meses th {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--text-muted);
}

.meses tfoot td {
  font-weight: 700;
  border-bottom: none;
}

.meses .col-valor {
  text-align: right;
}

.detalhes {
  display: grid;
  grid-template-columns: 160px 1fr;
  row-gap: 0.5rem;
  font-size: 0.85rem;
  margin: 0 0 1.5rem;
}

.detalhes dt {
  color: var(--text-muted);
}

.detalhes dd {
  margin: 0;
  color: var(--text);
}

.local-data {
  text-align: right;
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 0 0 2.5rem;
}

.assinatura {
  text-align: center;
}

.linha-assinatura {
  border-top: 1px solid var(--text);
  width: 70%;
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

  /* Papel de recibo (Configurações → Impressão): a caixa acompanha a
     largura útil da página — cabe em A5 — e não se divide em duas folhas. */
  .recibo {
    max-width: 100%;
    padding: 1.25rem 1.5rem;
    border-radius: 0;
    break-inside: avoid;
  }

  .detalhes {
    grid-template-columns: max-content 1fr;
    column-gap: 1rem;
  }

  .recibo {
    border-color: #000;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .valor,
  .corpo strong,
  .detalhes dd,
  .cabecalho h1 {
    color: #000;
  }

  .linha-assinatura {
    border-top-color: #000;
  }
}
</style>
