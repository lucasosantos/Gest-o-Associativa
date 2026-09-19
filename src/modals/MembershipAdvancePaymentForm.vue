<script setup lang="ts">
// "Pagar mensalidades adiantadas": quita competências FUTURAS (além do mês
// atual) de uma vez. Diferente de MembershipBulkPaymentForm.vue (que recebe
// uma lista de parcelas JÁ existentes — vencidas), aqui as parcelas dos
// meses futuros ainda nem existem (`ParcelaModel` só garante calendário até
// o mês atual, ver `ParcelaModel.ensureAteMesAtual`), então esta tela decide
// quantos meses e a partir de qual competência, criando cada parcela
// (`ParcelaModel.getOrCreate`) na hora de pagar. Aceita um desconto no valor
// TOTAL do lote (ex.: incentivo por antecipar o pagamento), rateado
// igualmente entre os meses (resto de centavos fica no último) pra virar o
// `amount` de cada pagamento (`MembershipPaymentModel.pagar`).
import { computed, onMounted, ref } from "vue";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { ParcelaModel } from "../models/Parcela.js";
import type { ProtocolBook } from "../models/ProtocolBook.js";
import { currentAssociationConfigId } from "../composables/useCurrentAssociation.js";
import { FinancialAccountModel, type FinancialAccountComSaldo } from "../models/FinancialAccount.js";
import { PaymentMethodModel, type PaymentMethod } from "../models/PaymentMethod.js";
import {
  centavosParaReais,
  reaisParaCentavos,
  formatarCompetencia,
  formatarMoeda,
  hojeIso,
  competenciaAtual,
  proximaCompetencia,
} from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  fullName: string;
  onSaved?: () => void;
}>();

/** Mês mais cedo que conta como "adiantado" — o atual já tem seu jeito normal de pagar (linha ABERTO da tabela). */
const competenciaMinima = proximaCompetencia(competenciaAtual());

const competenciaInicial = ref(competenciaMinima.slice(0, 7)); // "AAAA-MM", pro <input type="month">
const quantidadeMeses = ref(3);
const financialAccountId = ref("");
const paymentDate = ref(hojeIso());
const amountPerMonth = ref(0);
/** Desconto no valor TOTAL do lote, concedido por o sócio estar antecipando o pagamento. */
const discountTotal = ref(0);
const paymentMethodId = ref("");
const protocolBookId = ref("");

const contas = ref<FinancialAccountComSaldo[]>([]);
const formasPagamento = ref<PaymentMethod[]>([]);
const livrosRecibo = ref<ProtocolBook[]>([]);
const loading = ref(true);
const saving = ref(false);
const pagas = ref(0);
const erro = ref("");

/** Competências que serão geradas/pagas, em ordem — ex.: 3 meses a partir de out/2026 → out, nov, dez/2026. */
const competencias = computed(() => {
  const lista: string[] = [];
  let atual = `${competenciaInicial.value}-01`;
  for (let i = 0; i < quantidadeMeses.value; i++) {
    lista.push(atual);
    atual = proximaCompetencia(atual);
  }
  return lista;
});

/** Total do lote sem desconto: valor de cada mensalidade vezes o nº de meses. */
const totalSemDesconto = computed(() => reaisParaCentavos(amountPerMonth.value) * competencias.value.length);

/** Total do lote já com o desconto aplicado — nunca negativo. */
const total = computed(() => Math.max(0, totalSemDesconto.value - reaisParaCentavos(discountTotal.value)));

/**
 * Valor pago em cada competência: o desconto é rateado igualmente entre os
 * meses, e o resto da divisão (centavos) fica no último mês, pra soma bater
 * exatamente com `total`.
 */
const valoresPorCompetencia = computed(() => {
  const n = competencias.value.length;
  if (n === 0) return [];
  const base = Math.floor(total.value / n);
  const resto = total.value - base * n;
  return competencias.value.map((_, indice) => (indice === n - 1 ? base + resto : base));
});

function chaveLivroLembrado(): string {
  return `app:livro-recibo:${currentAssociationConfigId.value ?? "sem-associacao"}`;
}

function lerLivroLembrado(): string | null {
  try {
    return localStorage.getItem(chaveLivroLembrado());
  } catch {
    return null;
  }
}

onMounted(async () => {
  try {
    const [c, pm, valorSugerido, livros] = await Promise.all([
      FinancialAccountModel.list(),
      PaymentMethodModel.list(),
      MembershipPaymentModel.valorMensalSugerido(props.memberId),
      MembershipPaymentModel.listarLivrosRecibo(),
    ]);
    contas.value = c;
    formasPagamento.value = pm;
    livrosRecibo.value = livros;
    financialAccountId.value = c[0]?.id ?? "";
    amountPerMonth.value = centavosParaReais(valorSugerido);

    const lembrado = lerLivroLembrado();
    protocolBookId.value = lembrado && livros.some((l) => l.id === lembrado) ? lembrado : (livros[0]?.id ?? "");
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!financialAccountId.value) {
    erro.value = "Selecione a conta financeira.";
    return;
  }
  if (!Number.isInteger(quantidadeMeses.value) || quantidadeMeses.value < 1) {
    erro.value = "Informe ao menos 1 mês.";
    return;
  }
  if (total.value <= 0) {
    erro.value = "O desconto não pode ser maior ou igual ao valor total.";
    return;
  }

  const formaEscolhida = formasPagamento.value.find((f) => f.id === paymentMethodId.value);
  const valores = valoresPorCompetencia.value;

  saving.value = true;
  erro.value = "";
  pagas.value = 0;
  const falhas: string[] = [];

  for (let i = 0; i < competencias.value.length; i++) {
    const competencia = competencias.value[i];
    try {
      const parcela = await ParcelaModel.getOrCreate(competencia);
      await MembershipPaymentModel.pagar(props.memberId, parcela.id, {
        financial_account_id: financialAccountId.value,
        payment_date: paymentDate.value,
        amount: valores[i],
        payment_method_id: paymentMethodId.value || null,
        payment_method_label: formaEscolhida?.name ?? null,
        protocol_book_id: protocolBookId.value || null,
      });
      pagas.value++;
    } catch (error) {
      falhas.push(`${formatarCompetencia(competencia)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  saving.value = false;
  props.onSaved?.();

  if (falhas.length === 0) {
    closeModal();
  } else {
    erro.value = `Pagas ${pagas.value} de ${competencias.value.length} mensalidade(s). Falhou: ${falhas.join("; ")}`;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <form v-else class="payment-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p class="context">{{ fullName }} — adianta mensalidades futuras, antes do vencimento.</p>

    <div v-if="contas.length === 0" class="state-msg">Cadastre uma conta financeira antes de registrar o pagamento.</div>

    <template v-else>
      <div class="field-row">
        <div class="field">
          <label class="field-label" for="competencia-inicial">A partir de *</label>
          <input
            id="competencia-inicial"
            v-model="competenciaInicial"
            type="month"
            :min="competenciaMinima.slice(0, 7)"
            :disabled="saving"
            required
          />
        </div>

        <div class="field">
          <label class="field-label" for="quantidade-meses">Quantos meses *</label>
          <input
            id="quantidade-meses"
            v-model.number="quantidadeMeses"
            type="number"
            min="1"
            max="36"
            :disabled="saving"
            required
          />
        </div>
      </div>

      <p class="field-hint">
        Vai gerar e quitar: {{ competencias.map((c) => formatarCompetencia(c)).join(", ") }}
      </p>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="financial-account">Conta financeira *</label>
          <select id="financial-account" v-model="financialAccountId" :disabled="saving" required>
            <option v-for="conta in contas" :key="conta.id" :value="conta.id">{{ conta.name }}</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="payment-method">Forma de pagamento</label>
          <select id="payment-method" v-model="paymentMethodId" :disabled="saving">
            <option value="">Nenhuma</option>
            <option v-for="forma in formasPagamento" :key="forma.id" :value="forma.id">{{ forma.name }}</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="payment-date">Data do pagamento *</label>
        <input id="payment-date" v-model="paymentDate" type="date" :disabled="saving" required />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="amount">Valor de cada mensalidade (R$) *</label>
          <input id="amount" v-model.number="amountPerMonth" type="number" step="0.01" min="0.01" :disabled="saving" required />
        </div>

        <div class="field">
          <label class="field-label" for="desconto">Desconto no total (R$)</label>
          <input id="desconto" v-model.number="discountTotal" type="number" step="0.01" min="0" :disabled="saving" />
        </div>
      </div>

      <p class="field-hint">
        Total sem desconto: {{ formatarMoeda(totalSemDesconto) }} · Total a pagar: {{ formatarMoeda(total) }}
      </p>

      <div class="field">
        <label class="field-label" for="protocol-book">Livro de recibo</label>
        <select id="protocol-book" v-model="protocolBookId" :disabled="saving">
          <option value="">Sem numeração automática</option>
          <option v-for="livro in livrosRecibo" :key="livro.id" :value="livro.id">
            {{ livro.name }} (próximo nº {{ livro.next_number }})
          </option>
        </select>
        <p v-if="livrosRecibo.length === 0" class="field-hint">
          Nenhum livro do tipo RECIBO cadastrado — crie um em Documentos › Protocolos › Livros pra numerar os recibos automaticamente.
        </p>
        <p v-else class="field-hint">Um recibo numerado é gerado pra CADA mensalidade, em sequência.</p>
      </div>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="saving">
          <Spinner v-if="saving" />
          {{ saving ? `Pagando ${pagas + 1}/${competencias.length}...` : "Confirmar pagamentos" }}
        </button>
      </div>
    </template>
  </form>
</template>

<style scoped>
.payment-form {
  min-width: 420px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.context {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.field {
  margin-bottom: 0.9rem;
  flex: 1;
}

.field-row {
  display: flex;
  gap: 1rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field input,
.field select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.field input:disabled,
.field select:disabled {
  opacity: 0.6;
}

.field-hint {
  margin: 0.35rem 0 1rem;
  font-size: 0.76rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
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

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
</style>
