<script setup lang="ts">
// Tela inicial: dashboard-resumo da associação ativa e os dados
// institucionais (aba "Instituição", que antes vivia numa tela própria).
// A troca de associação em si (select, "Entrar novamente", senha) mora na
// sidebar (`AssociationSwitcher.vue`, montado em `SidebarTools.vue`) —
// pedido do usuário: só aparece aqui, não nas demais telas.
import { onMounted, ref, watch } from "vue";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { currentAssociationId, isAssociationConnected } from "../composables/useCurrentAssociation.js";
import { useAssociationScopedData } from "../composables/useAssociationScopedData.js";
import { MemberModel } from "../models/Member.js";
import { FinancialAccountModel } from "../models/FinancialAccount.js";
import { MembershipPaymentModel } from "../models/MembershipPayment.js";
import { PayableModel } from "../models/Payable.js";
import { ReceivableModel } from "../models/Receivable.js";
import { ProtocolEntryModel } from "../models/ProtocolEntry.js";
import { DocumentModel } from "../models/Document.js";
import { formatarBytes, formatarMoeda, hojeIso } from "../utils/format.js";
import { exportarBackup, importarBackup } from "../services/backup.js";
import { restartApp } from "../services/config.js";
import Spinner from "../components/Spinner.vue";
import InstitutionalDataEditor from "../components/InstitutionalDataEditor.vue";

type Aba = "dashboard" | "instituicao";

const abaAtiva = ref<Aba>("dashboard");

interface Resumo {
  totalSocios: number;
  sociosAtivos: number;
  saldoTotal: number;
  cobrancasAbertas: number;
  cobrancasVencidas: number;
  contasAPagarAbertas: number;
  contasAReceberAbertas: number;
  protocolosAbertos: number;
  totalDocumentos: number;
}

const resumo = ref<Resumo | null>(null);
const loadingResumo = ref(false);

async function carregarResumo() {
  if (!currentAssociationId.value) {
    resumo.value = null;
    return;
  }

  loadingResumo.value = true;
  try {
    const [socios, contas, mensalidades, pagar, receber, protocolos, documentos] = await Promise.all([
      MemberModel.list(),
      FinancialAccountModel.list(),
      MembershipPaymentModel.resumo(),
      PayableModel.list(),
      ReceivableModel.list(),
      ProtocolEntryModel.list(),
      DocumentModel.list(),
    ]);

    resumo.value = {
      totalSocios: socios.length,
      sociosAtivos: socios.filter((s) => s.status === "ATIVO").length,
      saldoTotal: contas.reduce((soma, conta) => soma + conta.balance, 0),
      cobrancasAbertas: mensalidades.abertas,
      cobrancasVencidas: mensalidades.vencidas,
      contasAPagarAbertas: pagar.filter((p) => p.status === "ABERTA" || p.status === "PARCIAL").length,
      contasAReceberAbertas: receber.filter((r) => r.status === "ABERTA" || r.status === "PARCIAL").length,
      protocolosAbertos: protocolos.filter((p) => p.status === "ABERTO" || p.status === "EM_ANDAMENTO").length,
      totalDocumentos: documentos.length,
    };
  } finally {
    loadingResumo.value = false;
  }
}

/** Operação de backup em andamento (trava os dois botões enquanto roda). */
const backupEmAndamento = ref<"exportar" | "importar" | null>(null);
const mensagemBackup = ref<{ tipo: "ok" | "erro"; texto: string } | null>(null);

function mensagemDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Backup completo (banco + documentos anexados) num `.zip` — ver `src/services/backup.ts`. */
async function exportarBackupCompleto() {
  mensagemBackup.value = null;
  const destino = await saveDialog({
    defaultPath: `backup-associacao-${hojeIso()}.zip`,
    filters: [{ name: "Backup", extensions: ["zip"] }],
  });
  if (!destino) return;

  backupEmAndamento.value = "exportar";
  try {
    const resumo = await exportarBackup(destino);
    mensagemBackup.value = {
      tipo: "ok",
      texto: `Backup salvo em ${destino} (${formatarBytes(resumo.tamanho_bytes)}, ${resumo.documentos} arquivo(s) de documentos).`,
    };
  } catch (error) {
    mensagemBackup.value = { tipo: "erro", texto: `Não foi possível gerar o backup: ${mensagemDe(error)}` };
  } finally {
    backupEmAndamento.value = null;
  }
}

/**
 * Restaura um backup POR CIMA da associação conectada. Nada é apagado: o
 * banco e a pasta de documentos atuais ficam guardados ao lado, renomeados
 * (ver `import_backup` em `src-tauri/src/backup.rs`). O app reinicia no fim
 * pra rodar as migrations no banco restaurado.
 */
async function importarBackupCompleto() {
  mensagemBackup.value = null;
  const origem = await openDialog({
    multiple: false,
    filters: [{ name: "Backup", extensions: ["zip", "db"] }],
  });
  if (!origem || Array.isArray(origem)) return;

  const confirmado = confirm(
    "Todos os dados atuais desta associação serão SUBSTITUÍDOS pelos do backup escolhido. " +
      "Uma cópia dos dados atuais fica guardada na mesma pasta do banco. O aplicativo será reiniciado. Continuar?"
  );
  if (!confirmado) return;

  backupEmAndamento.value = "importar";
  try {
    const copiaSeguranca = await importarBackup(origem);
    alert(`Backup restaurado. Os dados anteriores foram guardados em:\n${copiaSeguranca}\n\nO aplicativo será reiniciado agora.`);
    await restartApp();
  } catch (error) {
    mensagemBackup.value = { tipo: "erro", texto: `Não foi possível restaurar o backup: ${mensagemDe(error)}` };
    backupEmAndamento.value = null;
  }
}

// `onMounted` + `watch(currentAssociationId, ...)` — sem isto, reabrir esta
// tela (ela remonta a cada navegação, `:key="route.fullPath"` em App.vue)
// não recarregava o resumo: `currentAssociationId` já estava definido
// (associação continua conectada entre navegações), então um `watch` puro
// nunca disparava de novo, e `resumo` ficava `null` na instância nova —
// dashboard vazio até trocar de associação de verdade.
useAssociationScopedData(carregarResumo);

// Assim que uma associação conecta (ver AssociationSwitcher.vue, na
// sidebar), decide se mostra o dashboard ou pede pra completar o cadastro
// institucional primeiro (banco novo, ainda sem a linha de `associations`).
watch(isAssociationConnected, (conectada) => {
  if (conectada) abaAtiva.value = currentAssociationId.value ? "dashboard" : "instituicao";
});

onMounted(() => {
  if (isAssociationConnected.value) {
    abaAtiva.value = currentAssociationId.value ? "dashboard" : "instituicao";
  }
});
</script>

<template>
  <section class="content">
    <div class="page-header">
      <div>
        <h2>Início</h2>
        <p>Escolha a associação ativa na barra lateral — os demais módulos (sócios, financeiro, documentos...) mostram só os dados dela.</p>
      </div>
    </div>

    <template v-if="isAssociationConnected">
        <div class="tabs">
          <button class="tab" :class="{ active: abaAtiva === 'dashboard' }" type="button" @click="abaAtiva = 'dashboard'">
            Dashboard
          </button>
          <button class="tab" :class="{ active: abaAtiva === 'instituicao' }" type="button" @click="abaAtiva = 'instituicao'">
            Instituição
          </button>
        </div>

        <div v-if="abaAtiva === 'dashboard'">
          <div v-if="loadingResumo" class="state-msg">Carregando...</div>
          <div v-else-if="resumo" class="cards-grid">
            <div class="card">
              <h3>Sócios</h3>
              <p class="card-value">{{ resumo.sociosAtivos }}</p>
              <p class="card-sub">ativos de {{ resumo.totalSocios }} cadastrados</p>
            </div>

            <div class="card">
              <h3>Saldo em caixa</h3>
              <p class="card-value">{{ formatarMoeda(resumo.saldoTotal) }}</p>
              <p class="card-sub">soma de todas as contas financeiras</p>
            </div>

            <div class="card">
              <h3>Mensalidades</h3>
              <p class="card-value">{{ resumo.cobrancasAbertas }}</p>
              <p class="card-sub">
                em aberto
                <span v-if="resumo.cobrancasVencidas > 0" class="card-alert">
                  · {{ resumo.cobrancasVencidas }} vencida(s)
                </span>
              </p>
            </div>

            <div class="card">
              <h3>Contas a pagar</h3>
              <p class="card-value">{{ resumo.contasAPagarAbertas }}</p>
              <p class="card-sub">em aberto ou parciais</p>
            </div>

            <div class="card">
              <h3>Contas a receber</h3>
              <p class="card-value">{{ resumo.contasAReceberAbertas }}</p>
              <p class="card-sub">em aberto ou parciais</p>
            </div>

            <div class="card">
              <h3>Protocolos</h3>
              <p class="card-value">{{ resumo.protocolosAbertos }}</p>
              <p class="card-sub">abertos ou em andamento</p>
            </div>

            <div class="card">
              <h3>Documentos</h3>
              <p class="card-value">{{ resumo.totalDocumentos }}</p>
              <p class="card-sub">cadastrados</p>
            </div>
          </div>

          <div class="backup-panel">
            <div>
              <h3>Backup dos dados</h3>
              <p class="card-sub">
                Salva tudo desta associação (sócios, financeiro, protocolos, documentos anexados...) num único
                arquivo <code>.zip</code>. Use para guardar uma cópia de segurança ou para levar os dados para outro
                computador: lá, cadastre a associação e use "Importar backup".
              </p>
            </div>
            <div class="backup-actions">
              <button type="button" class="btn-secondary" :disabled="backupEmAndamento !== null" @click="exportarBackupCompleto">
                <Spinner v-if="backupEmAndamento === 'exportar'" />
                {{ backupEmAndamento === "exportar" ? "Gerando..." : "Exportar backup" }}
              </button>
              <button type="button" class="btn-secondary" :disabled="backupEmAndamento !== null" @click="importarBackupCompleto">
                <Spinner v-if="backupEmAndamento === 'importar'" />
                {{ backupEmAndamento === "importar" ? "Restaurando..." : "Importar backup" }}
              </button>
            </div>
            <p v-if="mensagemBackup" class="backup-msg" :class="mensagemBackup.tipo">{{ mensagemBackup.texto }}</p>
          </div>
        </div>

        <div v-else>
          <InstitutionalDataEditor
            :key="currentAssociationId ?? 'nova'"
            :association-id="currentAssociationId"
            :on-saved="carregarResumo"
          />
        </div>
    </template>

    <p v-else class="state-msg">Escolha uma associação na barra lateral para começar.</p>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.4rem;
  border-bottom: 1px solid var(--border);
  margin: 0 0 1.25rem;
}

.tab {
  padding: 0.55rem 0.9rem;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  max-width: 1100px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
}

.card h3 {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.card-value {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
}

.card-sub {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.backup-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  max-width: 1100px;
  margin-top: 1.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
}

.backup-panel > div:first-child {
  flex: 1 1 360px;
}

.backup-panel h3 {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.backup-panel code {
  font-size: 0.74rem;
}

.backup-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.backup-msg {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.8rem;
}

.backup-msg.ok {
  color: var(--accent);
}

.backup-msg.erro {
  color: #c0392b;
}

.card-alert {
  color: #c0392b;
  font-weight: 600;
}
</style>
