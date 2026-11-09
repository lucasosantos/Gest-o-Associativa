<script setup lang="ts">
// Escolhe quem sai nas carteirinhas e a validade antes de abrir a tela de
// impressão (`ImprimirCarteirinhas.vue`, que já abre mandando imprimir).
// Dois usos:
// - em lote (sidebar de Socios.vue, sem props): todos de uma situação OU
//   sócios marcados um a um na lista (com busca);
// - um sócio só (sidebar de SocioDetalhes.vue, `memberId`/`fullName`): só
//   pergunta a validade.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { MemberModel, type MemberComPessoa, type OrdemListaSocios, type StatusSocio } from "../models/Member.js";
import { ROTULO_SITUACAO_SOCIO, SITUACOES_SOCIO } from "../utils/situacaoSocio.js";
import { formatarCpf, hojeLocalIso, somarMeses } from "../utils/format.js";
import { closeModal } from "../composables/useModal.js";

const props = defineProps<{
  /** Preenchido = carteirinha de um sócio só (ficha do sócio). */
  memberId?: string;
  fullName?: string;
}>();

const router = useRouter();

const individual = computed(() => Boolean(props.memberId));

const modo = ref<"SITUACAO" | "ESCOLHER">("SITUACAO");
const situacao = ref<StatusSocio | "">("ATIVO");
const ordem = ref<OrdemListaSocios>("NOME");

const temValidade = ref(true);
/** Padrão: um ano a partir de hoje. */
const validade = ref(somarMeses(hojeLocalIso(), 12));

// --- Escolha manual (modo ESCOLHER) ---
const socios = ref<MemberComPessoa[]>([]);
const carregandoSocios = ref(false);
const busca = ref("");
const selecionados = ref<Set<string>>(new Set());
const erro = ref("");

const comparador = new Intl.Collator("pt-BR", { sensitivity: "base" });
/** Sem acento e minúsculo, pra busca "joao" achar "João". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const sociosFiltrados = computed(() => {
  const termo = normalizar(busca.value.trim());
  const digitos = busca.value.replace(/\D/g, "");
  if (!termo) return socios.value;
  return socios.value.filter(
    (socio) =>
      normalizar(socio.full_name).includes(termo) ||
      normalizar(socio.registration_number).includes(termo) ||
      (digitos.length > 0 && (socio.cpf ?? "").includes(digitos))
  );
});

const todosVisiveisMarcados = computed(
  () => sociosFiltrados.value.length > 0 && sociosFiltrados.value.every((socio) => selecionados.value.has(socio.id))
);

function alternar(id: string) {
  const novo = new Set(selecionados.value);
  if (novo.has(id)) novo.delete(id);
  else novo.add(id);
  selecionados.value = novo;
}

/** Marca (ou desmarca, se já estavam todos marcados) os sócios que a busca está mostrando. */
function alternarVisiveis() {
  const novo = new Set(selecionados.value);
  const desmarcar = todosVisiveisMarcados.value;
  for (const socio of sociosFiltrados.value) {
    if (desmarcar) novo.delete(socio.id);
    else novo.add(socio.id);
  }
  selecionados.value = novo;
}

async function carregarSocios() {
  if (socios.value.length > 0 || carregandoSocios.value) return;
  carregandoSocios.value = true;
  try {
    const lista = await MemberModel.list();
    socios.value = lista.sort((a, b) => comparador.compare(a.full_name, b.full_name));
  } catch (error) {
    erro.value = `Não foi possível carregar os sócios: ${error instanceof Error ? error.message : error}`;
  } finally {
    carregandoSocios.value = false;
  }
}

function escolherModo(novo: "SITUACAO" | "ESCOLHER") {
  modo.value = novo;
  erro.value = "";
  if (novo === "ESCOLHER") carregarSocios();
}

function gerar() {
  erro.value = "";
  if (temValidade.value && !validade.value) {
    erro.value = "Informe a data de validade ou marque \"Sem validade\".";
    return;
  }
  const validadeQuery = temValidade.value ? validade.value : undefined;

  let query: Record<string, string | undefined>;
  if (individual.value) {
    query = { ids: props.memberId, validade: validadeQuery };
  } else if (modo.value === "ESCOLHER") {
    if (selecionados.value.size === 0) {
      erro.value = "Marque pelo menos um sócio.";
      return;
    }
    // Mantém a ordem escolhida em "Ordenar por" — a tela de impressão ordena de novo.
    query = { ids: [...selecionados.value].join(","), ordem: ordem.value, validade: validadeQuery };
  } else {
    query = { situacao: situacao.value || undefined, ordem: ordem.value, validade: validadeQuery };
  }
  // A navegação fecha o modal sozinha (`router.beforeEach` em router/index.ts).
  router.push({ name: "carteirinhas-imprimir", query });
}
</script>

<template>
  <form class="carteirinha-form" @submit.prevent="gerar">
    <p v-if="individual" class="socio-individual">
      Carteirinha de <strong>{{ fullName }}</strong>
    </p>

    <template v-else>
      <div class="field">
        <span class="field-label">Quem vai receber</span>
        <div class="modos">
          <label class="opcao">
            <input type="radio" :checked="modo === 'SITUACAO'" @change="escolherModo('SITUACAO')" />
            Todos de uma situação
          </label>
          <label class="opcao">
            <input type="radio" :checked="modo === 'ESCOLHER'" @change="escolherModo('ESCOLHER')" />
            Escolher sócios
          </label>
        </div>
      </div>

      <div v-if="modo === 'SITUACAO'" class="field">
        <label class="field-label" for="situacao">Situação</label>
        <select id="situacao" v-model="situacao">
          <option value="">Todas as situações</option>
          <option v-for="codigo in SITUACOES_SOCIO" :key="codigo" :value="codigo">
            {{ ROTULO_SITUACAO_SOCIO[codigo] }}
          </option>
        </select>
      </div>

      <div v-else class="field">
        <div class="busca-linha">
          <input v-model="busca" type="text" placeholder="Buscar por nome, matrícula ou CPF..." />
          <button
            type="button"
            class="btn-secondary btn-pequeno"
            :disabled="sociosFiltrados.length === 0"
            @click="alternarVisiveis"
          >
            {{ todosVisiveisMarcados ? "Desmarcar" : "Marcar" }} {{ busca.trim() ? "encontrados" : "todos" }}
          </button>
        </div>
        <div class="lista-socios">
          <p v-if="carregandoSocios" class="vazio">Carregando...</p>
          <p v-else-if="sociosFiltrados.length === 0" class="vazio">Nenhum sócio encontrado.</p>
          <label v-for="socio in sociosFiltrados" v-else :key="socio.id" class="item-socio">
            <input type="checkbox" :checked="selecionados.has(socio.id)" @change="alternar(socio.id)" />
            <span class="item-nome">{{ socio.full_name }}</span>
            <span class="item-info">
              Mat. {{ socio.registration_number }}
              <template v-if="socio.cpf"> · {{ formatarCpf(socio.cpf) }}</template>
              · {{ ROTULO_SITUACAO_SOCIO[socio.status] }}
            </span>
          </label>
        </div>
        <p class="hint">{{ selecionados.size }} sócio(s) marcado(s).</p>
      </div>

      <div class="field">
        <label class="field-label" for="ordem">Ordenar por</label>
        <select id="ordem" v-model="ordem">
          <option value="NOME">Nome</option>
          <option value="MATRICULA">Matrícula</option>
        </select>
      </div>
    </template>

    <div class="field">
      <span class="field-label">Validade</span>
      <div class="validade-linha">
        <label class="opcao">
          <input v-model="temValidade" type="checkbox" />
          Válida até
        </label>
        <input v-model="validade" type="date" :disabled="!temValidade" />
      </div>
      <p class="hint">Desmarcado, a carteirinha sai sem o campo de validade.</p>
    </div>

    <p class="hint">
      Frente e verso lado a lado (85,6 × 54 mm cada), 5 por folha no papel padrão de Configurações → Impressão:
      recorte o contorno, dobre no meio e cole ou plastifique.
    </p>

    <p v-if="erro" class="erro">{{ erro }}</p>

    <div class="save-row">
      <button type="button" class="btn-secondary" @click="closeModal">Cancelar</button>
      <button type="submit" class="btn-primary">{{ individual ? "Gerar carteirinha" : "Gerar carteirinhas" }}</button>
    </div>
  </form>
</template>

<style scoped>
.carteirinha-form {
  width: 440px;
  max-width: 100%;
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

.field select,
.field input[type="text"],
.field input[type="date"] {
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

.socio-individual {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--text);
}

.modos {
  display: flex;
  gap: 1.25rem;
}

.opcao {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.busca-linha {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.busca-linha input {
  flex: 1;
}

.lista-socios {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}

.item-socio {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.item-socio:last-child {
  border-bottom: none;
}

.item-socio:hover {
  background: var(--surface-hover);
}

.item-nome {
  font-size: 0.85rem;
  color: var(--text);
}

.item-info {
  grid-column: 2;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.vazio {
  margin: 0;
  padding: 0.75rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.validade-linha {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.validade-linha input[type="date"] {
  flex: 1;
}

.hint {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.erro {
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
  color: #c0392b;
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

.btn-pequeno {
  padding: 0.4rem 0.7rem;
  font-size: 0.78rem;
  white-space: nowrap;
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

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
