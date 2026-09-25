<script setup lang="ts">
// Administra o registro de associações do config.json: renomear, mover o
// arquivo do banco, definir/trocar/remover senha e remover a entrada. A
// tela Início cuida só de escolher/desbloquear e cadastrar uma nova — esta
// aqui é o lugar para mexer nas já existentes. Também guarda o tamanho do
// papel das impressões (padrão e recibo), aplicado por `usePaginaImpressao`.
import { onMounted, ref } from "vue";
import {
  listAssociations,
  getConfigFilePath,
  removeAssociation,
  getPrintConfig,
  setPrintConfig,
  type AssociationSummary,
  type PapelPadrao,
  type PapelRecibo,
} from "../services/config.js";
import { ROTULO_PAPEL } from "../composables/usePaginaImpressao.js";
import {
  currentAssociationConfigId,
  isAssociationConnected,
  clearCurrentAssociation,
} from "../composables/useCurrentAssociation.js";
import { closeDatabase } from "../services/database.js";
import { openModal } from "../composables/useModal.js";
import AssociationSettingsForm from "../modals/AssociationSettingsForm.vue";

const loading = ref(true);
const associacoes = ref<AssociationSummary[]>([]);
const configFilePath = ref("");

// --- Impressão (papel padrão e papel de recibo, também no config.json) ---
const PAPEIS_PADRAO: PapelPadrao[] = ["A4", "CARTA", "OFICIO"];
const PAPEIS_RECIBO: PapelRecibo[] = ["A4", "A5", "CARTA", "TERMICA_58", "TERMICA_80"];
const papelPadrao = ref<PapelPadrao>("A4");
const papelRecibo = ref<PapelRecibo>("A4");
const mensagemImpressao = ref("");
const erroImpressao = ref("");

async function carregar() {
  loading.value = true;
  try {
    const [lista, caminho, impressao] = await Promise.all([listAssociations(), getConfigFilePath(), getPrintConfig()]);
    associacoes.value = lista;
    configFilePath.value = caminho;
    papelPadrao.value = impressao.default_paper;
    papelRecibo.value = impressao.receipt_paper;
  } finally {
    loading.value = false;
  }
}

async function salvarImpressao() {
  mensagemImpressao.value = "";
  erroImpressao.value = "";
  try {
    await setPrintConfig({ default_paper: papelPadrao.value, receipt_paper: papelRecibo.value });
    mensagemImpressao.value = "Salvo — vale para as próximas impressões.";
  } catch (error) {
    erroImpressao.value = `Não foi possível salvar: ${error instanceof Error ? error.message : error}`;
  }
}

onMounted(carregar);

function abrirEdicao(associacao: AssociationSummary) {
  openModal({
    title: `Editar "${associacao.name}"`,
    component: AssociationSettingsForm,
    props: { association: associacao, onSaved: carregar },
  });
}

async function remover(associacao: AssociationSummary) {
  const confirmado = confirm(
    `Remover "${associacao.name}" da lista? O arquivo do banco (${associacao.db_path}) NÃO será apagado, só deixa de aparecer aqui.`
  );
  if (!confirmado) return;

  if (currentAssociationConfigId.value === associacao.id) {
    await closeDatabase();
    clearCurrentAssociation();
  }

  await removeAssociation(associacao.id);
  await carregar();
}
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Configurações</h2>
        <p>
          Associações cadastradas nesta instalação, guardadas em <code>config.json</code> na mesma pasta do
          executável.
        </p>
      </div>
    </div>

    <div v-if="loading" class="state-msg">Carregando...</div>

    <div v-else class="settings-group">
      <h3>Associações</h3>

      <p v-if="associacoes.length === 0" class="group-desc">
        Nenhuma associação cadastrada ainda — cadastre a primeira na tela Início.
      </p>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Arquivo do banco</th>
            <th>Senha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="associacao in associacoes" :key="associacao.id">
            <td>
              {{ associacao.name }}
              <span v-if="associacao.id === currentAssociationConfigId && isAssociationConnected" class="badge">ativa</span>
            </td>
            <td class="path-cell">{{ associacao.db_path }}</td>
            <td>{{ associacao.has_password ? "Sim" : "Não" }}</td>
            <td class="actions">
              <button type="button" class="link-btn" @click="abrirEdicao(associacao)">Editar</button>
              <button type="button" class="link-btn remove" @click="remover(associacao)">Remover</button>
            </td>
          </tr>
        </tbody>
      </table>

      <p class="hint">
        Arquivo de configurações: <code>{{ configFilePath }}</code>
      </p>
    </div>

    <div v-if="!loading" class="settings-group">
      <h3>Impressão</h3>
      <p class="group-desc">
        Tamanho do papel usado nas impressões desta instalação. Na janela de impressão, deixe a escala em
        "Padrão"/100% e o mesmo papel selecionado na impressora.
      </p>

      <div class="print-grid">
        <div class="field">
          <label class="field-label" for="papel-padrao">Impressão padrão</label>
          <select id="papel-padrao" v-model="papelPadrao" @change="salvarImpressao">
            <option v-for="papel in PAPEIS_PADRAO" :key="papel" :value="papel">{{ ROTULO_PAPEL[papel] }}</option>
          </select>
          <span class="field-hint">Relatórios, listas, livro de protocolo, extrato, declarações e atividades.</span>
        </div>
        <div class="field">
          <label class="field-label" for="papel-recibo">Impressão de recibo</label>
          <select id="papel-recibo" v-model="papelRecibo" @change="salvarImpressao">
            <option v-for="papel in PAPEIS_RECIBO" :key="papel" :value="papel">{{ ROTULO_PAPEL[papel] }}</option>
          </select>
          <span class="field-hint">Recibos de mensalidade e de acordo, e comprovante de protocolo.</span>
        </div>
      </div>

      <p v-if="mensagemImpressao" class="mensagem ok">{{ mensagemImpressao }}</p>
      <p v-if="erroImpressao" class="mensagem erro">{{ erroImpressao }}</p>
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  max-width: 900px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.25rem 1.5rem 1.5rem;
  margin-top: 1rem;
}

.settings-group h3 {
  margin: 0 0 0.9rem;
  font-size: 1.05rem;
}

.print-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
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

.field-hint {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.mensagem {
  margin: 0.9rem 0 0;
  font-size: 0.82rem;
}

.mensagem.ok {
  color: var(--accent);
}

.mensagem.erro {
  color: #c0392b;
}

.group-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.55rem 0.7rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 0.6rem 0.7rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: top;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.path-cell {
  color: var(--text-muted);
  font-size: 0.78rem;
  word-break: break-all;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  background: var(--accent-soft);
  color: var(--accent);
  margin-left: 0.4rem;
}

.actions {
  display: flex;
  gap: 0.9rem;
  white-space: nowrap;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.link-btn.remove {
  color: #c0392b;
}

.hint {
  margin: 1rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  word-break: break-all;
}
</style>
