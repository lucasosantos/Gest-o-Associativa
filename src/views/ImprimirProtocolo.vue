<script setup lang="ts">
// Comprovante genérico de um protocolo — aberto pelo botão "Imprimir" da
// lista de Protocolos (Documentos.vue) quando o protocolo NÃO é o recibo
// de um pagamento de mensalidade (esse caso especial vai direto pra
// ImprimirRecibo.vue, com valor/sócio formatados; ver
// MembershipPaymentModel.buscarPorProtocolo). Serve pra reimprimir
// qualquer ofício/portaria/edital já lançado, sem reabrir o formulário.
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ProtocolEntryModel, formatarNumeroProtocolo, type ProtocolEntryComLivro } from "../models/ProtocolEntry.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";

const route = useRoute();
const router = useRouter();
const protocoloId = String(route.params.id);

const protocolo = ref<ProtocolEntryComLivro | null>(null);
const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const loading = ref(true);

const DIRECAO_LABEL: Record<string, string> = {
  RECEBIDO: "Recebido",
  EXPEDIDO: "Expedido",
  INTERNO: "Interno",
};

const STATUS_LABEL: Record<string, string> = {
  ABERTO: "Aberto",
  EM_ANDAMENTO: "Em andamento",
  RESPONDIDO: "Respondido",
  ENCERRADO: "Encerrado",
  CANCELADO: "Cancelado",
};

const dataEmissao = computed(() => formatarData(new Date().toISOString().slice(0, 10)));

const rotuloContraparte = computed(() => (protocolo.value?.direction === "RECEBIDO" ? "Remetente" : "Destinatário"));
const contraparte = computed(() => {
  if (!protocolo.value) return "—";
  return (protocolo.value.direction === "RECEBIDO" ? protocolo.value.sender_name : protocolo.value.recipient_name) ?? "—";
});

// Aplica o papel de recibo de Configurações → Impressão (`@page`) e só então imprime.
const { imprimir } = usePaginaImpressao("RECIBO");

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosProtocolo, dadosAssociacao, dadosEndereco] = await Promise.all([
      ProtocolEntryModel.get(protocoloId),
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
    ]);
    protocolo.value = dadosProtocolo;
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
  <section class="content imprimir-protocolo">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else-if="protocolo">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <div class="comprovante documento-recibo">
        <header class="cabecalho">
          <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
          <h1>Protocolo {{ formatarNumeroProtocolo(protocolo, protocolo.book_prefix) }}</h1>
          <p class="subtitulo">{{ protocolo.book_name }} · {{ protocolo.document_type }}</p>
        </header>

        <dl class="detalhes">
          <dt>Direção</dt>
          <dd>{{ DIRECAO_LABEL[protocolo.direction] }}</dd>
          <dt>Data</dt>
          <dd>{{ formatarData(protocolo.protocol_date) }}</dd>
          <dt>Assunto</dt>
          <dd>{{ protocolo.subject }}</dd>
          <dt>{{ rotuloContraparte }}</dt>
          <dd>{{ contraparte }}</dd>
          <dt v-if="protocolo.deadline">Prazo</dt>
          <dd v-if="protocolo.deadline">{{ formatarData(protocolo.deadline) }}</dd>
          <dt>Situação</dt>
          <dd>{{ STATUS_LABEL[protocolo.status] }}</dd>
          <template v-if="protocolo.notes">
            <dt>Observações</dt>
            <dd>{{ protocolo.notes }}</dd>
          </template>
        </dl>

        <p class="local-data">Emitido em {{ dataEmissao }}</p>

        <div class="assinatura">
          <div class="linha-assinatura"></div>
          <p>Assinatura</p>
        </div>
      </div>
    </template>

    <p v-else class="state-msg">Protocolo não encontrado.</p>
  </section>
</template>

<style scoped>
.imprimir-protocolo {
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

.comprovante {
  max-width: 560px;
  margin: 0 auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 2rem 2.5rem;
  background: var(--surface);
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
  font-size: 0.82rem;
}

.detalhes {
  display: grid;
  grid-template-columns: 160px 1fr;
  row-gap: 0.6rem;
  font-size: 0.88rem;
  margin: 0 0 2rem;
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
  .comprovante {
    max-width: 100%;
    padding: 1.25rem 1.5rem;
    border-radius: 0;
    break-inside: avoid;
  }

  .detalhes {
    grid-template-columns: max-content 1fr;
    column-gap: 1rem;
  }

  .comprovante {
    border-color: #000;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .cabecalho h1,
  .detalhes dd {
    color: #000;
  }

  .linha-assinatura {
    border-top-color: #000;
  }
}
</style>
