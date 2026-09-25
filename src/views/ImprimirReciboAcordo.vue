<script setup lang="ts">
// Recibo de um ACORDO de renegociação de mensalidade — diferente de
// ImprimirRecibo.vue (que é sempre UMA parcela): aqui o valor é o
// negociado (geralmente menor que a soma original) cobrindo VÁRIAS
// competências de uma vez. Aberto logo após MembershipAgreementForm.vue
// efetivar o acordo, ou reaberto pelo botão "Imprimir" da lista de
// Protocolos (ver MembershipAgreementModel.buscarPorProtocolo, checado
// antes do recibo de pagamento comum em Documentos.vue).
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MembershipAgreementModel, type MembershipAgreementComDetalhes } from "../models/MembershipAgreement.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData, formatarMoeda, formatarCompetencia } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";

const route = useRoute();
const router = useRouter();
const agreementId = String(route.params.id);

const acordo = ref<MembershipAgreementComDetalhes | null>(null);
const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const loading = ref(true);

const dataEmissao = computed(() => formatarData(new Date().toISOString().slice(0, 10)));
const mesesTexto = computed(() => acordo.value?.competence_months.map(formatarCompetencia).join(", ") ?? "");
const desconto = computed(() => (acordo.value ? acordo.value.original_amount - acordo.value.negotiated_amount : 0));

// Aplica o papel de recibo de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("RECIBO");

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAcordo, dadosAssociacao, dadosEndereco] = await Promise.all([
      MembershipAgreementModel.get(agreementId),
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
    ]);
    acordo.value = dadosAcordo;
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
  <section class="content imprimir-recibo-acordo">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else-if="acordo && associacao">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <div class="recibo documento-recibo">
        <header class="cabecalho">
          <PrintHeader :association="associacao" :address="endereco" />
          <h1>Recibo de Acordo{{ acordo.receipt_number ? ` Nº ${acordo.receipt_number}` : "" }}</h1>
        </header>

        <p class="valor">{{ formatarMoeda(acordo.negotiated_amount) }}</p>

        <p class="corpo">
          Recebemos de <strong>{{ acordo.full_name }}</strong> (matrícula {{ acordo.registration_number }}) a quantia
          de <strong>{{ formatarMoeda(acordo.negotiated_amount) }}</strong>, referente a acordo de renegociação que
          quita integralmente as mensalidades de <strong>{{ mesesTexto }}</strong>.
        </p>

        <dl class="detalhes">
          <dt>Data do acordo</dt>
          <dd>{{ formatarData(acordo.agreement_date) }}</dd>
          <dt>Valor original das mensalidades</dt>
          <dd>{{ formatarMoeda(acordo.original_amount) }}</dd>
          <dt v-if="desconto > 0">Desconto concedido</dt>
          <dd v-if="desconto > 0">{{ formatarMoeda(desconto) }}</dd>
          <dt v-if="acordo.approved_by">Aprovado por</dt>
          <dd v-if="acordo.approved_by">{{ acordo.approved_by }}</dd>
        </dl>

        <p class="local-data">Emitido em {{ dataEmissao }}</p>

        <div class="assinatura">
          <div class="linha-assinatura"></div>
          <p>Assinatura</p>
        </div>
      </div>
    </template>

    <p v-else class="state-msg">Acordo não encontrado.</p>
  </section>
</template>

<style scoped>
.imprimir-recibo-acordo {
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

.detalhes {
  display: grid;
  grid-template-columns: 220px 1fr;
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
