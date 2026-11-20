<script setup lang="ts">
// Reseta TODAS as mensalidades pagas de um sócio — pra pagamentos
// registrados errado (ver `MembershipPaymentModel.resetarDoSocio`). Mostra
// antes o que vai ser desfeito (mensalidades, valor que sai do caixa,
// acordos, recibos) e exige justificativa, que vai pra Atividades.
import { onMounted, ref } from "vue";
import { MembershipPaymentModel, type ResumoResetMensalidades } from "../models/MembershipPayment.js";
import { closeModal } from "../composables/useModal.js";
import { formatarMoeda } from "../utils/format.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ memberId: string; fullName: string; onSaved?: () => void }>();

const resumo = ref<ResumoResetMensalidades | null>(null);
const carregando = ref(true);
const justificativa = ref("");
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    resumo.value = await MembershipPaymentModel.resumoReset(props.memberId);
  } catch (error) {
    erro.value = `Não foi possível carregar as mensalidades: ${error instanceof Error ? error.message : error}`;
  } finally {
    carregando.value = false;
  }
});

async function handleSubmit() {
  if (!justificativa.value.trim()) {
    erro.value = "Informe a justificativa — ela fica registrada em Atividades.";
    return;
  }
  saving.value = true;
  erro.value = "";
  try {
    await MembershipPaymentModel.resetarDoSocio(props.memberId, justificativa.value);
    props.onSaved?.();
    closeModal();
  } catch (error) {
    erro.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="reset-form" @submit.prevent="handleSubmit">
    <p class="socio">{{ fullName }}</p>

    <div v-if="carregando" class="state-msg">Carregando...</div>

    <p v-else-if="resumo && resumo.pagamentos === 0" class="vazio">Este sócio não tem nenhuma mensalidade paga.</p>

    <template v-else-if="resumo">
      <p class="titulo-resumo">O que vai ser desfeito</p>
      <ul class="resumo">
        <li>
          <strong>{{ resumo.pagamentos }} mensalidade(s)</strong> voltam a ficar em aberto ou vencidas:
          <span class="meses">{{ resumo.meses.join(", ") }}</span>
        </li>
        <li v-if="resumo.lancamentosAEstornar > 0">
          <strong>{{ resumo.lancamentosAEstornar }} lançamento(s)</strong> estornado(s) no caixa —
          sai {{ formatarMoeda(resumo.valorAEstornar) }} do saldo
        </li>
        <li v-if="resumo.acordos > 0"><strong>{{ resumo.acordos }} acordo(s)</strong> de renegociação desfeito(s)</li>
        <li v-if="resumo.recibos > 0">
          <strong>{{ resumo.recibos }} recibo(s)</strong> cancelado(s) no livro de protocolo (o número continua registrado)
        </li>
      </ul>
      <p class="aviso">
        Os lançamentos estornados continuam no Financeiro como "Estornada", e tudo fica registrado em Atividades.
        Depois do reset, as mensalidades podem ser pagas de novo.
      </p>

      <p v-if="erro" class="erro">{{ erro }}</p>

      <div class="field">
        <label class="field-label" for="justificativa">Justificativa *</label>
        <textarea
          id="justificativa"
          v-model="justificativa"
          rows="3"
          placeholder="Ex.: pagamentos lançados no sócio errado"
          :disabled="saving"
        ></textarea>
      </div>
    </template>

    <p v-if="erro && !resumo" class="erro">{{ erro }}</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button
        v-if="resumo && resumo.pagamentos > 0"
        type="submit"
        class="btn-perigo"
        :disabled="saving || carregando"
      >
        <Spinner v-if="saving" />
        {{ saving ? "Resetando..." : "Resetar mensalidades" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.reset-form {
  width: 460px;
  max-width: 100%;
}

.socio {
  margin: 0 0 0.9rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
}

.titulo-resumo {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
}

.resumo {
  margin: 0 0 0.75rem;
  padding-left: 1.1rem;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--text);
}

.meses {
  color: var(--text-muted);
}

.aviso,
.vazio {
  margin: 0 0 0.9rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.field {
  margin-bottom: 0.9rem;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
}

.field textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  box-sizing: border-box;
}

.save-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

.btn-perigo,
.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
}

/* Ação destrutiva: mesmo vermelho das mensagens de erro do app. */
.btn-perigo {
  border: none;
  background: #c0392b;
  color: #fff;
}

.btn-perigo:disabled,
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
