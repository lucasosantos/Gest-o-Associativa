<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { MemberModel, type MemberComPessoa } from "../models/Member.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { formatarData, formatarCpf, hojeIso } from "../utils/format.js";
import { setSidebarTools } from "../composables/useSidebar.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import { openModal } from "../composables/useModal.js";
import { gerarCsvSocios } from "../services/memberCsv.js";
import { writeTextFile } from "../services/files.js";
import SocioImportForm from "../modals/SocioImportForm.vue";

const router = useRouter();

const socios = ref<MemberComPessoa[]>([]);
const termoBusca = ref("");
/** Filtro adicional, combinado com a busca — ver `MembershipPaymentModel.listarInadimplentes`. */
const apenasInadimplentes = ref(false);
const loading = ref(true);
/** Retorno da última importação/exportação em CSV, mostrado acima da lista. */
const mensagem = ref<{ tipo: "ok" | "erro"; texto: string } | null>(null);

async function carregar() {
  loading.value = true;
  try {
    const lista = termoBusca.value.trim()
      ? await MemberModel.search(termoBusca.value.trim())
      : await MemberModel.list();

    if (apenasInadimplentes.value) {
      const inadimplentes = await MembershipPaymentModel.listarInadimplentes();
      socios.value = lista.filter((socio) => inadimplentes.has(socio.id));
    } else {
      socios.value = lista;
    }
  } finally {
    loading.value = false;
  }
}

function abrirNovoSocio() {
  router.push({ name: "socio-novo" });
}

function abrirFicha(id: string) {
  router.push({ name: "socio-detalhes", params: { id } });
}

/** Abre a lista de aptos a votar direto pra impressão (mesmo padrão de ImprimirLivroProtocolo.vue). */
function abrirAptosAVotar() {
  router.push({ name: "aptos-a-votar-imprimir" });
}

function abrirImportacao() {
  mensagem.value = null;
  openModal({ title: "Importar sócios (CSV)", component: SocioImportForm, props: { onSaved: carregar } });
}

/** Exporta TODOS os sócios (ignora busca/filtro da tela) no mesmo layout aceito pela importação. */
async function exportarCsv() {
  mensagem.value = null;
  const destino = await saveDialog({
    defaultPath: `socios-${hojeIso()}.csv`,
    filters: [{ name: "Planilha CSV", extensions: ["csv"] }],
  });
  if (!destino) return;

  try {
    const { conteudo, total } = await gerarCsvSocios();
    await writeTextFile(destino, conteudo);
    mensagem.value = { tipo: "ok", texto: `${total} sócio(s) exportado(s) para ${destino}.` };
  } catch (error) {
    mensagem.value = { tipo: "erro", texto: `Não foi possível exportar: ${error instanceof Error ? error.message : error}` };
  }
}

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  ATIVO: "Ativo",
  INATIVO: "Inativo",
  SUSPENSO: "Suspenso",
  DESLIGADO: "Desligado",
  FALECIDO: "Falecido",
};

useAssociationScopedData(carregar);

onMounted(() => {
  setSidebarTools([
    {
      group: "Sócios",
      items: [
        { id: "novo-socio", label: "Novo sócio", icon: "plus", onClick: abrirNovoSocio },
        { id: "aptos-a-votar", label: "Aptos a votar", icon: "file", onClick: abrirAptosAVotar },
        { id: "importar-csv", label: "Importar CSV", icon: "upload", onClick: abrirImportacao },
        { id: "exportar-csv", label: "Exportar CSV", icon: "download", onClick: exportarCsv },
      ],
    },
  ]);
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Sócios</h2>
        <p>Cadastro, situação e histórico dos associados.</p>
      </div>
    </div>

    <div class="search-row">
      <input
        v-model="termoBusca"
        type="text"
        placeholder="Buscar por nome, CPF, matrícula, telefone ou e-mail..."
        @keyup.enter="carregar"
      />
      <button type="button" class="btn-secondary" @click="carregar">Buscar</button>
      <label class="checkbox-filter">
        <input v-model="apenasInadimplentes" type="checkbox" @change="carregar" />
        Somente inadimplentes
      </label>
    </div>

    <p v-if="mensagem" class="mensagem" :class="mensagem.tipo">{{ mensagem.texto }}</p>

    <div v-if="loading" class="state-msg">Carregando...</div>
    <div v-else-if="socios.length === 0" class="state-msg">Nenhum sócio encontrado.</div>

    <table v-else class="member-table">
      <thead>
        <tr>
          <th></th>
          <th>Matrícula</th>
          <th>Nome</th>
          <th>CPF</th>
          <th>Situação</th>
          <th>Associado em</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="socio in socios" :key="socio.id" class="row-link" @click="abrirFicha(socio.id)">
          <td>
            <img v-if="socio.photo" :src="socio.photo" alt="" class="photo-thumb" />
            <div v-else class="photo-thumb photo-thumb-vazio"></div>
          </td>
          <td>{{ socio.registration_number }}</td>
          <td>{{ socio.full_name }}</td>
          <td>{{ socio.cpf ? formatarCpf(socio.cpf) : "—" }}</td>
          <td><span class="badge" :class="`status-${socio.status.toLowerCase()}`">{{ STATUS_LABEL[socio.status] }}</span></td>
          <td>{{ formatarData(socio.association_date) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.search-row {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0 1.25rem;
  max-width: 640px;
}

.search-row input {
  flex: 1;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}

.checkbox-filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.4rem;
  font-size: 0.85rem;
  color: var(--text);
  white-space: nowrap;
  cursor: pointer;
}

.mensagem {
  margin: 0 0 1rem;
  font-size: 0.82rem;
}

.mensagem.ok {
  color: var(--accent);
}

.mensagem.erro {
  color: #c0392b;
}

.member-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 0.85rem;
}

.member-table th {
  text-align: left;
  padding: 0.65rem 0.9rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--border);
}

.member-table td {
  padding: 0.65rem 0.9rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.photo-thumb {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
  display: block;
}

.photo-thumb-vazio {
  border: 1px dashed var(--border);
  background: var(--surface);
}

.member-table tr:last-child td {
  border-bottom: none;
}

.row-link {
  cursor: pointer;
}

.row-link:hover td {
  background: var(--surface-hover);
}

.badge {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--surface-hover);
  color: var(--text-muted);
}

.badge.status-ativo {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
