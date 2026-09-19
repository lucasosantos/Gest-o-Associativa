<script setup lang="ts">
// Impressão da lista completa de um livro de protocolo — rota escondida
// (sem aba no menu), aberta a partir do botão "Imprimir" na aba Livros de
// Documentos.vue. Mostra TODOS os registros do livro, sem os filtros da
// tela de Protocolos, na ordem do próprio livro (número, não data — é
// possível lançar um protocolo com data retroativa fora de ordem, mas o
// número da página do livro é o que realmente conta como sequência).
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ProtocolBookModel, type ProtocolBook } from "../models/ProtocolBook.js";
import { ProtocolEntryModel, formatarNumeroProtocolo, type ProtocolEntry } from "../models/ProtocolEntry.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { formatarData } from "../utils/format.js";
import PrintHeader from "../components/PrintHeader.vue";

const route = useRoute();
const router = useRouter();
const livroId = String(route.params.id);

const livro = ref<ProtocolBook | null>(null);
const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const protocolos = ref<ProtocolEntry[]>([]);
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

function contraparte(protocolo: ProtocolEntry): string {
  if (protocolo.direction === "RECEBIDO") return protocolo.sender_name ?? "—";
  return protocolo.recipient_name ?? "—";
}

function imprimir() {
  window.print();
}

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosLivro, dadosAssociacao, dadosEndereco, lista] = await Promise.all([
      ProtocolBookModel.get(livroId),
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      ProtocolEntryModel.list({ protocolBookId: livroId }),
    ]);
    livro.value = dadosLivro;
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    protocolos.value = [...lista].sort((a, b) => a.number - b.number);
  } finally {
    loading.value = false;
  }

  await nextTick();
  imprimir();
});
</script>

<template>
  <section class="content imprimir-livro">
    <div v-if="loading" class="state-msg">Carregando...</div>

    <template v-else-if="livro">
      <div class="no-print action-bar">
        <button type="button" class="btn-secondary" @click="router.back()">Voltar</button>
        <button type="button" class="btn-primary" @click="imprimir">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>{{ livro.name }}</h1>
        <p class="subtitulo">
          Tipo {{ livro.protocol_type }} · Ano {{ livro.year }} · {{ protocolos.length }} registro(s)
        </p>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <p v-if="protocolos.length === 0" class="state-msg">Nenhum protocolo lançado neste livro ainda.</p>

      <table v-else class="tabela-impressao">
        <thead>
          <tr>
            <th>Nº</th>
            <th>Data</th>
            <th>Direção</th>
            <th>Tipo</th>
            <th>Assunto</th>
            <th>Remetente/Destinatário</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="protocolo in protocolos" :key="protocolo.id">
            <td>{{ formatarNumeroProtocolo(protocolo, livro.prefix) }}</td>
            <td>{{ formatarData(protocolo.protocol_date) }}</td>
            <td>{{ DIRECAO_LABEL[protocolo.direction] }}</td>
            <td>{{ protocolo.document_type }}</td>
            <td>{{ protocolo.subject }}</td>
            <td>{{ contraparte(protocolo) }}</td>
            <td>{{ STATUS_LABEL[protocolo.status] }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <p v-else class="state-msg">Livro não encontrado.</p>
  </section>
</template>

<style scoped>
.imprimir-livro {
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
  margin: 0 0 0.3rem;
  font-size: 1.3rem;
  color: var(--text);
}

.subtitulo {
  margin: 0 0 0.2rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.emissao {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.tabela-impressao {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
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

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho {
    border-bottom-color: #000;
  }

  .tabela-impressao th,
  .tabela-impressao td {
    border-color: #000;
    color: #000;
  }

  .tabela-impressao th {
    background: none;
  }

  .tabela-impressao tr {
    break-inside: avoid;
  }
}
</style>
