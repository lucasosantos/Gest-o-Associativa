<script setup lang="ts">
// Abre a partir do botão "Gerar declaração" na ficha do sócio
// (SocioDetalhes.vue). A declaração é numerada como protocolo (livro tipo
// DECLARACAO, mesma numeração atômica de recibo/ofício — ver
// `ProtocolEntryModel.create`), então SEMPRE precisa de um livro escolhido
// (diferente do recibo, aqui não existe "sem numeração automática": uma
// declaração sem número não faz sentido). A escolha do livro fica lembrada
// em localStorage, por associação, mesmo padrão de `MembershipPaymentForm.vue`.
//
// Antes de mostrar o formulário, checa se o sócio está inadimplente — a
// declaração afirma que ele está "quite com suas obrigações", então gerar
// uma pra quem deve seria emitir um documento oficial falso. Bloqueia
// (não só avisa) e mostra os meses em aberto, sem consumir número de
// protocolo nenhum.
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ProtocolEntryModel } from "../models/ProtocolEntry.js";
import { ProtocolBookModel, type ProtocolBook } from "../models/ProtocolBook.js";
import { MembershipPaymentModel, type MensalidadeLinha } from "../models/MembershipPayment.js";
import { currentAssociationConfigId } from "../composables/useCurrentAssociation.js";
import { formatarCompetencia, hojeIso } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{
  memberId: string;
  fullName: string;
  onSaved?: () => void;
}>();

const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const erro = ref("");

const inadimplente = ref(false);
const mesesVencidos = ref<MensalidadeLinha[]>([]);

const protocolBookId = ref("");
const livrosDeclaracao = ref<ProtocolBook[]>([]);

function chaveLivroLembrado(): string {
  return `app:livro-declaracao:${currentAssociationConfigId.value ?? "sem-associacao"}`;
}

function lerLivroLembrado(): string | null {
  try {
    return localStorage.getItem(chaveLivroLembrado());
  } catch {
    return null;
  }
}

function lembrarLivro(id: string) {
  try {
    localStorage.setItem(chaveLivroLembrado(), id);
  } catch {
    // localStorage indisponível (ex.: janela privada) — segue sem lembrar.
  }
}

onMounted(async () => {
  try {
    inadimplente.value = await MembershipPaymentModel.isInadimplente(props.memberId);
    if (inadimplente.value) {
      const { items } = await MembershipPaymentModel.listarPorSocio(props.memberId, { page: 1, pageSize: 1000 });
      mesesVencidos.value = items.filter((linha) => linha.status === "VENCIDO");
      return;
    }

    const livros = await ProtocolBookModel.listActiveByType("DECLARACAO");
    livrosDeclaracao.value = livros;
    const lembrado = lerLivroLembrado();
    protocolBookId.value = lembrado && livros.some((l) => l.id === lembrado) ? lembrado : (livros[0]?.id ?? "");
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!protocolBookId.value) {
    erro.value = "Selecione o livro de declaração.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    lembrarLivro(protocolBookId.value);
    const entry = await ProtocolEntryModel.create({
      protocol_book_id: protocolBookId.value,
      direction: "EXPEDIDO",
      protocol_date: hojeIso(),
      recipient_name: props.fullName,
      subject: `Declaração de associado — ${props.fullName}`,
      member_id: props.memberId,
    });

    props.onSaved?.();
    closeModal();
    router.push({ name: "declaracao-imprimir", params: { id: entry.id } });
  } catch (error) {
    erro.value = `Não foi possível gerar: ${error instanceof Error ? error.message : error}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="state-msg">Carregando...</div>

  <div v-else-if="inadimplente" class="declaracao-form">
    <p class="bloqueio">
      <strong>{{ fullName }}</strong> está inadimplente e não pode receber uma declaração — ela afirmaria que o sócio
      está "quite com suas obrigações", o que não é verdade. Regularize o(s) mês(es) abaixo antes de gerar.
    </p>
    <ul class="lista-meses">
      <li v-for="linha in mesesVencidos" :key="linha.parcela_id">{{ formatarCompetencia(linha.competence_month) }}</li>
    </ul>
    <div class="save-row">
      <button type="button" class="btn-secondary" @click="closeModal">Fechar</button>
    </div>
  </div>

  <form v-else class="declaracao-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p class="context">Declaração de associado para <strong>{{ fullName }}</strong></p>

    <div class="field">
      <label class="field-label" for="protocol-book">Livro de declaração *</label>
      <select id="protocol-book" v-model="protocolBookId" :disabled="saving" required>
        <option value="" disabled>Selecione um livro</option>
        <option v-for="livro in livrosDeclaracao" :key="livro.id" :value="livro.id">
          {{ livro.name }} (próximo nº {{ livro.next_number }})
        </option>
      </select>
      <p v-if="livrosDeclaracao.length === 0" class="field-hint">
        Nenhum livro do tipo DECLARACAO cadastrado — crie um em Documentos › Protocolos › Livros antes de gerar.
      </p>
    </div>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary" :disabled="saving || livrosDeclaracao.length === 0">
        <Spinner v-if="saving" />
        {{ saving ? "Gerando..." : "Gerar declaração" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.declaracao-form {
  min-width: 380px;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
  font-size: 0.82rem;
}

.bloqueio {
  margin: 0 0 0.9rem;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--text);
}

.lista-meses {
  margin: 0 0 1.25rem;
  padding-left: 1.2rem;
  font-size: 0.85rem;
  color: #c0392b;
}

.context {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--text-muted);
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

.field select:disabled {
  opacity: 0.6;
}

.field-hint {
  margin: 0.35rem 0 0;
  font-size: 0.76rem;
  color: var(--text-muted);
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
