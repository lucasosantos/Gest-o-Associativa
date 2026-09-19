<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ReceivableModel } from "../models/Receivable.js";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { PayerModel, type Payer } from "../models/Payer.js";
import { FinancialCategoryModel, type FinancialCategory } from "../models/FinancialCategory.js";
import { CostCenterModel, type CostCenter } from "../models/CostCenter.js";
import { reaisParaCentavos, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

const origem = ref<"socio" | "pagador">("socio");
const memberId = ref("");
const payerId = ref("");
const sourceType = ref("");
const description = ref("");
const totalAmount = ref(0);
const installments = ref(1);
const firstDueDate = ref(hojeIso());
const categoryId = ref("");
const costCenterId = ref("");

const socios = ref<MemberComPessoa[]>([]);
const pagadores = ref<Payer[]>([]);
const categorias = ref<FinancialCategory[]>([]);
const centrosCusto = ref<CostCenter[]>([]);
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    const [m, pg, c, cc] = await Promise.all([
      MemberModel.list(),
      PayerModel.list(),
      FinancialCategoryModel.list(),
      CostCenterModel.list(),
    ]);
    socios.value = m;
    pagadores.value = pg;
    categorias.value = c.filter((categoria) => categoria.category_type === "RECEITA");
    centrosCusto.value = cc;
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!description.value.trim() || totalAmount.value <= 0 || installments.value < 1) {
    erro.value = "Preencha a descrição, um valor maior que zero e ao menos 1 parcela.";
    return;
  }
  if (origem.value === "socio" && !memberId.value) {
    erro.value = "Selecione o sócio de origem.";
    return;
  }
  if (origem.value === "pagador" && !payerId.value) {
    erro.value = "Selecione o pagador de origem.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    await ReceivableModel.create({
      member_id: origem.value === "socio" ? memberId.value : null,
      payer_id: origem.value === "pagador" ? payerId.value : null,
      description: description.value.trim(),
      source_type: sourceType.value.trim() || null,
      total_amount: reaisParaCentavos(totalAmount.value),
      financial_category_id: categoryId.value || null,
      cost_center_id: costCenterId.value || null,
      installments: installments.value,
      first_due_date: firstDueDate.value,
    });

    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <form v-else class="receivable-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="field">
      <label class="field-label">Origem</label>
      <div class="radio-row">
        <label><input v-model="origem" type="radio" value="socio" :disabled="saving" /> Sócio</label>
        <label><input v-model="origem" type="radio" value="pagador" :disabled="saving" /> Pagador avulso</label>
      </div>
    </div>

    <div v-if="origem === 'socio'" class="field">
      <label class="field-label" for="member">Sócio *</label>
      <select id="member" v-model="memberId" :disabled="saving" required>
        <option value="" disabled>Selecione...</option>
        <option v-for="socio in socios" :key="socio.id" :value="socio.id">{{ socio.full_name }}</option>
      </select>
    </div>

    <div v-else class="field">
      <label class="field-label" for="payer">Pagador *</label>
      <select id="payer" v-model="payerId" :disabled="saving" required>
        <option value="" disabled>Selecione...</option>
        <option v-for="pagador in pagadores" :key="pagador.id" :value="pagador.id">{{ pagador.name }}</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="description">Descrição *</label>
      <input id="description" v-model="description" type="text" placeholder="Taxa extraordinária, aluguel do salão..." :disabled="saving" required />
    </div>

    <div class="field">
      <label class="field-label" for="source-type">Tipo</label>
      <input id="source-type" v-model="sourceType" type="text" placeholder="EVENTO, CONVENIO, ALUGUEL..." :disabled="saving" />
    </div>

    <div class="field">
      <label class="field-label" for="total-amount">Valor total (R$) *</label>
      <input id="total-amount" v-model.number="totalAmount" type="number" step="0.01" min="0.01" :disabled="saving" required />
    </div>

    <div class="field-row">
      <div class="field">
        <label class="field-label" for="installments">Parcelas</label>
        <input id="installments" v-model.number="installments" type="number" min="1" step="1" :disabled="saving" />
      </div>

      <div class="field">
        <label class="field-label" for="first-due-date">1º vencimento *</label>
        <input id="first-due-date" v-model="firstDueDate" type="date" :disabled="saving" required />
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="category">Categoria</label>
      <select id="category" v-model="categoryId" :disabled="saving">
        <option value="">Nenhuma</option>
        <option v-for="categoria in categorias" :key="categoria.id" :value="categoria.id">{{ categoria.name }}</option>
      </select>
    </div>

    <div class="field">
      <label class="field-label" for="cost-center">Centro de custo</label>
      <select id="cost-center" v-model="costCenterId" :disabled="saving">
        <option value="">Nenhum</option>
        <option v-for="centro in centrosCusto" :key="centro.id" :value="centro.id">{{ centro.name }}</option>
      </select>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.receivable-form {
  min-width: 420px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
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

.radio-row {
  display: flex;
  gap: 1.25rem;
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 400;
}

.radio-row label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
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
