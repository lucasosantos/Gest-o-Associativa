<script setup lang="ts">
// Relatório financeiro de um sócio — página de CONSULTA (aberta pelo botão
// da ficha, `SocioDetalhes.vue`): resumo dos pagamentos de mensalidade num
// período (`?inicio=&fim=`; sem query, da data de associação até hoje).
// Totais em cima, mês a mês embaixo. Dados de
// `MembershipPaymentModel.relatorioDoSocio`. Diferente das telas
// `Imprimir*.vue`, NÃO abre imprimindo: imprimir é opcional, pelo botão —
// a página já é montada pra sair certa no papel (`usePaginaImpressao`).
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import {
  MembershipPaymentModel,
  type RelatorioFinanceiroSocio,
  type StatusMensalidade,
} from "../models/MembershipPayment.js";
import { AssociationModel, type Association } from "../models/Association.js";
import { AddressModel, type Address } from "../models/Address.js";
import { ActivityLogModel } from "../models/ActivityLog.js";
import { getCurrentAssociationId } from "../composables/useCurrentAssociation.js";
import { usePaginaImpressao } from "../composables/usePaginaImpressao.js";
import { formatarCompetencia, formatarCpf, formatarData, formatarMoeda, hojeLocalIso } from "../utils/format.js";
import { ROTULO_SITUACAO_SOCIO } from "../utils/situacaoSocio.js";
import PrintHeader from "../components/PrintHeader.vue";

const route = useRoute();
const router = useRouter();
const memberId = String(route.params.id);

const STATUS_LABEL: Record<StatusMensalidade, string> = {
  PAGO: "Pago",
  VENCIDO: "Vencido",
  ABERTO: "Em aberto",
};

function lerData(valor: unknown): string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : "";
}

const inicio = ref(lerData(route.query.inicio));
const fim = ref(lerData(route.query.fim) || hojeLocalIso());

const associacao = ref<Association | null>(null);
const endereco = ref<Address | null>(null);
const socio = ref<MemberComPessoa | null>(null);
const relatorio = ref<RelatorioFinanceiroSocio | null>(null);
const loading = ref(true);
const erro = ref("");

const dataEmissao = formatarData(hojeLocalIso());
const periodoValido = computed(() => Boolean(inicio.value && fim.value && inicio.value <= fim.value));

// Aplica o papel padrão de Configurações → Impressão (`@page`) — usado só
// quando o usuário clica em "Imprimir".
const { imprimir } = usePaginaImpressao("PADRAO");

/** Impressão opcional: registra no histórico e abre a janela de impressão do sistema. */
async function imprimirRelatorio() {
  if (!socio.value || !relatorio.value) return;
  await ActivityLogModel.registrar({
    module: "MENSALIDADES",
    description: `Relatório financeiro impresso — ${socio.value.full_name} — ${formatarData(inicio.value)} a ${formatarData(fim.value)}`,
    entity_type: "MEMBER",
    entity_id: memberId,
  });
  await imprimir();
}

function voltarParaFicha() {
  router.push({ name: "socio-detalhes", params: { id: memberId } });
}

async function carregarRelatorio() {
  if (!periodoValido.value) {
    relatorio.value = null;
    return;
  }
  relatorio.value = await MembershipPaymentModel.relatorioDoSocio(memberId, inicio.value, fim.value);
}

/** Troca de período na barra de ações: recarrega e mantém a URL em sincronia. */
async function aplicarPeriodo() {
  if (!periodoValido.value) return;
  router.replace({ query: { inicio: inicio.value, fim: fim.value } });
  await carregarRelatorio();
}

onMounted(async () => {
  try {
    const associationId = getCurrentAssociationId();
    const [dadosAssociacao, dadosEndereco, dadosSocio] = await Promise.all([
      AssociationModel.get(associationId),
      AddressModel.primaryForAssociation(associationId),
      MemberModel.get(memberId),
    ]);
    associacao.value = dadosAssociacao;
    endereco.value = dadosEndereco;
    socio.value = dadosSocio;
    if (!dadosSocio) {
      erro.value = "Sócio não encontrado.";
      return;
    }
    if (!inicio.value) inicio.value = dadosSocio.association_date;
    await carregarRelatorio();
  } catch (error) {
    erro.value = `Não foi possível gerar o relatório: ${error instanceof Error ? error.message : error}`;
    return;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="content imprimir-relatorio">
    <div v-if="loading" class="state-msg">Carregando...</div>
    <p v-else-if="erro" class="state-msg">{{ erro }}</p>

    <template v-else-if="socio">
      <div class="breadcrumb no-print">
        <button type="button" class="link-btn" @click="router.push({ name: 'socios' })">Sócios</button>
        <span class="sep">/</span>
        <button type="button" class="link-btn" @click="voltarParaFicha">{{ socio.full_name }}</button>
        <span class="sep">/</span>
        <span class="current">Relatório financeiro</span>
      </div>

      <div class="no-print action-bar">
        <label>
          De
          <input v-model="inicio" type="date" @change="aplicarPeriodo" />
        </label>
        <label>
          até
          <input v-model="fim" type="date" :min="inicio" @change="aplicarPeriodo" />
        </label>
        <span v-if="!periodoValido" class="aviso-periodo">Período inválido</span>
        <span class="espaco"></span>
        <button type="button" class="btn-secondary" @click="voltarParaFicha">Voltar para a ficha</button>
        <button type="button" class="btn-primary" :disabled="!relatorio" @click="imprimirRelatorio">Imprimir</button>
      </div>

      <header class="cabecalho">
        <PrintHeader v-if="associacao" :association="associacao" :address="endereco" />
        <h1>Relatório financeiro do sócio</h1>
        <p class="subtitulo">Mensalidades de {{ formatarData(inicio) }} a {{ formatarData(fim) }}</p>
        <p class="emissao">Emitido em {{ dataEmissao }}</p>
      </header>

      <dl class="dados-socio">
        <div>
          <dt>Sócio</dt>
          <dd>{{ socio.full_name }}</dd>
        </div>
        <div>
          <dt>Matrícula</dt>
          <dd>{{ socio.registration_number }}</dd>
        </div>
        <div>
          <dt>CPF</dt>
          <dd>{{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}</dd>
        </div>
        <div>
          <dt>Associado em</dt>
          <dd>{{ formatarData(socio.association_date) }}</dd>
        </div>
        <div>
          <dt>Situação</dt>
          <dd>{{ ROTULO_SITUACAO_SOCIO[socio.status] }}</dd>
        </div>
      </dl>

      <template v-if="relatorio">
        <section class="resumo">
          <div class="bloco">
            <span class="rotulo">Mensalidades pagas</span>
            <strong>{{ relatorio.totais.pagas }} de {{ relatorio.totais.meses }}</strong>
            <span v-if="relatorio.totais.viaAcordo" class="detalhe">{{ relatorio.totais.viaAcordo }} via acordo</span>
          </div>
          <div class="bloco">
            <span class="rotulo">Total pago</span>
            <strong>{{ formatarMoeda(relatorio.totais.valorPago) }}</strong>
          </div>
          <div class="bloco">
            <span class="rotulo">Vencidas sem pagamento</span>
            <strong>{{ relatorio.totais.vencidas }}</strong>
            <span v-if="relatorio.totais.vencidas && relatorio.totais.valorMensal" class="detalhe">
              ≈ {{ formatarMoeda(relatorio.totais.estimativaEmAtraso) }} (estimado)
            </span>
          </div>
          <div class="bloco">
            <span class="rotulo">Em aberto (a vencer)</span>
            <strong>{{ relatorio.totais.abertas }}</strong>
          </div>
        </section>

        <p v-if="relatorio.linhas.length === 0" class="state-msg">
          Nenhuma mensalidade neste período (fora da vigência do sócio ou sem competências cadastradas).
        </p>

        <table v-else class="tabela-impressao">
          <thead>
            <tr>
              <th>Competência</th>
              <th>Vencimento</th>
              <th>Situação</th>
              <th>Pago em</th>
              <th>Forma</th>
              <th>Recibo</th>
              <th class="col-valor">Valor pago</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="linha in relatorio.linhas" :key="linha.parcela_id" :class="`status-${linha.status}`">
              <td class="nao-quebrar">{{ formatarCompetencia(linha.competence_month) }}</td>
              <td class="nao-quebrar">{{ formatarData(linha.due_date) }}</td>
              <td class="nao-quebrar">
                {{ STATUS_LABEL[linha.status] }}
                <span v-if="linha.membership_agreement_id" class="detalhe">via acordo</span>
              </td>
              <td class="nao-quebrar">{{ linha.paid_at ? formatarData(linha.paid_at) : "—" }}</td>
              <td>{{ linha.payment_method || "—" }}</td>
              <td class="nao-quebrar">{{ linha.receipt_number || "—" }}</td>
              <td class="col-valor nao-quebrar">{{ linha.paid_amount != null ? formatarMoeda(linha.paid_amount) : "—" }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="linha-total">
              <td colspan="6">Total pago no período — {{ relatorio.totais.pagas }} mensalidade(s)</td>
              <td class="col-valor nao-quebrar">{{ formatarMoeda(relatorio.totais.valorPago) }}</td>
            </tr>
          </tfoot>
        </table>

        <p v-if="relatorio.totais.vencidas && relatorio.totais.valorMensal" class="nota">
          Valor em atraso estimado pelo valor mensal atual ({{ formatarMoeda(relatorio.totais.valorMensal) }}) ×
          {{ relatorio.totais.vencidas }} mensalidade(s) vencida(s), sem juros ou multa.
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.imprimir-relatorio {
  max-width: 100%;
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

.action-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 1.5rem;
}

.action-bar label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.action-bar input {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.aviso-periodo {
  font-size: 0.8rem;
  color: #c0392b;
}

.espaco {
  flex: 1;
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

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.cabecalho {
  text-align: center;
  margin-bottom: 1.25rem;
  border-bottom: 2px solid var(--text);
  padding-bottom: 1rem;
}

.cabecalho h1 {
  margin: 0.4rem 0 0.2rem;
  font-size: 1.2rem;
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

.dados-socio {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.75rem;
  margin: 0 0 1.25rem;
  font-size: 0.85rem;
}

.dados-socio dt {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.dados-socio dd {
  margin: 0;
  color: var(--text);
  font-weight: 600;
}

.resumo {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.6rem;
  margin: 0 0 1.25rem;
}

.bloco {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.bloco strong {
  font-size: 1.05rem;
  color: var(--text);
}

.rotulo {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.detalhe {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.tabela-impressao {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.tabela-impressao th,
.tabela-impressao td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
  color: var(--text);
}

.tabela-impressao th {
  background: var(--surface-hover);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.status-VENCIDO td {
  font-weight: 600;
}

.col-valor {
  text-align: right !important;
}

.linha-total td {
  font-weight: 700;
  border-top: 2px solid var(--text);
}

.nota {
  margin: 0.6rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

@media print {
  .no-print {
    display: none !important;
  }

  .cabecalho,
  .linha-total td {
    border-color: #000;
  }

  .tabela-impressao th,
  .tabela-impressao td,
  .bloco {
    border-color: #000;
    color: #000;
  }

  .tabela-impressao th {
    background: none;
  }

  .resumo {
    break-inside: avoid;
  }
}
</style>
