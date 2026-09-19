<script setup lang="ts">
// Tipo do livro é o mesmo cadastro de tipo de documento (aba "Tipos", em
// Documentos.vue — ver `DocumentTypeModel`): livro de protocolo e documento
// classificam a mesma coisa (RECIBO, OFICIO, PORTARIA, DECLARACAO...), então
// viraram uma lista só a pedido do usuário. Cadastrar um tipo novo agora é
// só na aba Tipos — este formulário só escolhe entre os já existentes.
import { onMounted, ref } from "vue";
import { ProtocolBookModel } from "../models/ProtocolBook.js";
import { DocumentTypeModel } from "../models/DocumentType.js";
import { anoAtual } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ bookId?: string; onSaved?: () => void }>();

// Um livro só pode ser aberto (ou reaberto) pro ano corrente — nem um ano
// já encerrado, nem um ano à frente (ver `ProtocolBookModel.create`).
const anoCorrente = anoAtual();

const name = ref("");
const tipos = ref<string[]>([]);
const protocolType = ref("");
const year = ref(anoCorrente);
const prefix = ref("");
const loading = ref(true);
const saving = ref(false);
const erro = ref("");

onMounted(async () => {
  try {
    const [tiposAtivos, livroExistente] = await Promise.all([
      DocumentTypeModel.listActive(),
      props.bookId ? ProtocolBookModel.get(props.bookId) : Promise.resolve(null),
    ]);
    tipos.value = tiposAtivos.map((tipo) => tipo.name);

    if (livroExistente) {
      // Livro editando pode ter um tipo desativado (ou removido) da aba
      // Tipos — inclui na hora pra aparecer selecionado certo mesmo assim.
      if (!tipos.value.includes(livroExistente.protocol_type)) {
        tipos.value = [livroExistente.protocol_type, ...tipos.value];
      }
      name.value = livroExistente.name;
      protocolType.value = livroExistente.protocol_type;
      year.value = livroExistente.year;
      prefix.value = livroExistente.prefix ?? "";
    } else {
      protocolType.value = tipos.value[0] ?? "";
    }
  } finally {
    loading.value = false;
  }
});

async function handleSubmit() {
  if (!name.value.trim() || !protocolType.value || !year.value) {
    erro.value = "Preencha o nome, o tipo e o ano do livro.";
    return;
  }

  saving.value = true;
  erro.value = "";
  try {
    const dados = {
      name: name.value.trim(),
      protocol_type: protocolType.value,
      year: year.value,
      prefix: prefix.value.trim() || null,
    };

    if (props.bookId) {
      await ProtocolBookModel.update(props.bookId, dados);
    } else {
      await ProtocolBookModel.create(dados);
    }

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

  <form v-else class="book-form" @submit.prevent="handleSubmit">
    <p v-if="erro" class="erro">{{ erro }}</p>

    <p v-if="tipos.length === 0" class="state-msg">
      Nenhum tipo cadastrado ainda — cadastre um na aba Tipos, em Documentos, antes de criar um livro.
    </p>

    <template v-else>
      <div class="field">
        <label class="field-label" for="name">Nome *</label>
        <input id="name" v-model="name" type="text" placeholder="Livro de Ofícios 2026" :disabled="saving" required />
      </div>

      <div class="field-row">
        <div class="field">
          <label class="field-label" for="protocol-type">Tipo *</label>
          <select id="protocol-type" v-model="protocolType" :disabled="saving" required>
            <option v-for="tipo in tipos" :key="tipo" :value="tipo">{{ tipo }}</option>
          </select>
        </div>

        <div class="field">
          <label class="field-label" for="year">Ano *</label>
          <input
            id="year"
            v-model.number="year"
            type="number"
            :min="anoCorrente"
            :max="anoCorrente"
            :disabled="saving"
            required
          />
        </div>
      </div>

      <p class="hint">Só é possível abrir (ou reabrir) um livro para o ano corrente ({{ anoCorrente }}).</p>

      <div class="field">
        <label class="field-label" for="prefix">Prefixo do número (opcional)</label>
        <input id="prefix" v-model="prefix" type="text" placeholder="OF-" :disabled="saving" />
      </div>

      <p class="hint">
        A numeração desse livro começa em 1 e é controlada automaticamente pelo sistema a cada novo protocolo.
      </p>
    </template>

    <div class="save-row">
      <button type="button" class="btn-secondary" :disabled="saving" @click="closeModal">Cancelar</button>
      <button v-if="tipos.length > 0" type="submit" class="btn-primary" :disabled="saving">
        <Spinner v-if="saving" />
        {{ saving ? "Salvando..." : "Salvar" }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.book-form {
  min-width: 360px;
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

.hint {
  margin: 0 0 0.5rem;
  color: var(--text-muted);
  font-size: 0.78rem;
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
