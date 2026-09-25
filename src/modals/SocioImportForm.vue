<script setup lang="ts">
// Importação de sócios a partir de um CSV (Excel / Google Planilhas): mostra
// as colunas reconhecidas (lidas pelo nome do cabeçalho, em qualquer ordem;
// coluna ausente ou célula em branco só deixa o campo vazio), analisa o arquivo
// escolhido sem gravar nada e só importa depois da confirmação — ver
// `src/services/memberCsv.ts`.
import { ref } from "vue";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { COLUNAS_CSV, analisarCsv, gerarModeloCsv, importarSocios, type AnaliseCsv, type ErroLinha } from "../services/memberCsv.js";
import { readTextFile, writeTextFile } from "../services/files.js";
import { currentAutoRegistrationNumber } from "../composables/useCurrentAssociation.js";
import { closeModal } from "../composables/useModal.js";
import Spinner from "../components/Spinner.vue";

const props = defineProps<{ onSaved?: () => void }>();

type Etapa = "instrucoes" | "analise" | "concluido";

const etapa = ref<Etapa>("instrucoes");
const trabalhando = ref(false);
const erro = ref("");
const aviso = ref("");
const nomeArquivo = ref("");
const analise = ref<AnaliseCsv | null>(null);
const progresso = ref(0);
const resultado = ref<{ importados: number; erros: ErroLinha[] } | null>(null);

function mensagemDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function baixarModelo() {
  erro.value = "";
  aviso.value = "";
  const destino = await saveDialog({
    defaultPath: "modelo-importacao-socios.csv",
    filters: [{ name: "Planilha CSV", extensions: ["csv"] }],
  });
  if (!destino) return;
  try {
    await writeTextFile(destino, gerarModeloCsv());
    aviso.value = "Modelo salvo. Apague a linha de exemplo antes de importar.";
  } catch (error) {
    erro.value = `Não foi possível salvar o modelo: ${mensagemDe(error)}`;
  }
}

async function escolherArquivo() {
  erro.value = "";
  aviso.value = "";
  const caminho = await openDialog({
    multiple: false,
    filters: [{ name: "Planilha CSV", extensions: ["csv", "txt"] }],
  });
  if (!caminho || Array.isArray(caminho)) return;

  trabalhando.value = true;
  try {
    const texto = await readTextFile(caminho);
    analise.value = await analisarCsv(texto);
    nomeArquivo.value = caminho.split(/[\\/]/).pop() ?? caminho;
    etapa.value = "analise";
  } catch (error) {
    erro.value = `Não foi possível ler o arquivo: ${mensagemDe(error)}`;
  } finally {
    trabalhando.value = false;
  }
}

async function confirmarImportacao() {
  if (!analise.value || analise.value.validas.length === 0) return;
  trabalhando.value = true;
  erro.value = "";
  progresso.value = 0;
  try {
    resultado.value = await importarSocios(analise.value.validas, (feitos) => (progresso.value = feitos));
    etapa.value = "concluido";
    props.onSaved?.();
  } catch (error) {
    erro.value = `Não foi possível importar: ${mensagemDe(error)}`;
  } finally {
    trabalhando.value = false;
  }
}

function voltar() {
  analise.value = null;
  etapa.value = "instrucoes";
}
</script>

<template>
  <div class="import-form">
    <p v-if="erro" class="erro">{{ erro }}</p>
    <p v-if="aviso" class="aviso">{{ aviso }}</p>

    <template v-if="etapa === 'instrucoes'">
      <p class="texto">
        Monte uma planilha no Excel ou no Google Planilhas com a primeira linha sendo o cabeçalho (os nomes de
        coluna abaixo) e um sócio por linha. As colunas podem estar <strong>em qualquer ordem</strong> e não
        precisam estar todas: coluna que não existir no arquivo, ou célula em branco, simplesmente não é
        preenchida. O jeito mais fácil é baixar o modelo ou usar um arquivo exportado por esta tela.
      </p>

      <button type="button" class="btn-secondary" :disabled="trabalhando" @click="baixarModelo">
        Baixar modelo (.csv)
      </button>

      <table class="colunas">
        <thead>
          <tr>
            <th>#</th>
            <th>Coluna</th>
            <th>Regra</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(coluna, indice) in COLUNAS_CSV" :key="coluna.chave">
            <td>{{ indice + 1 }}</td>
            <td>
              <code>{{ coluna.chave }}</code>
              <span v-if="coluna.obrigatoria" class="obrigatoria">*</span>
            </td>
            <td>{{ coluna.descricao }}</td>
          </tr>
        </tbody>
      </table>
      <p class="dica">
        * essencial — sem ela (coluna ausente ou célula em branco) o sócio não é importado.
        <template v-if="currentAutoRegistrationNumber">
          A numeração automática de matrícula está <strong>ligada</strong>: a coluna <code>matricula</code> será
          ignorada.
        </template>
      </p>

      <h4>Como salvar o arquivo</h4>
      <ul class="dicas">
        <li><strong>Excel:</strong> Arquivo → Salvar como → tipo <em>CSV UTF-8 (delimitado por vírgulas)</em>.</li>
        <li><strong>Google Planilhas:</strong> Arquivo → Fazer download → <em>Valores separados por vírgula (.csv)</em>.</li>
        <li>
          Formate as colunas <code>matricula</code>, <code>cpf</code>, <code>telefone</code> e <code>cep</code> como
          <em>Texto</em> antes de digitar — senão a planilha apaga os zeros à esquerda.
        </li>
        <li>Datas no formato <code>DD/MM/AAAA</code>. Colunas opcionais podem ficar em branco ou nem existir.</li>
        <li>
          Linhas com erro (falta nome/data de associação, ou valor preenchido inválido, como CPF ou data errados)
          não são importadas; você vê a lista antes de confirmar.
        </li>
      </ul>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="trabalhando" @click="closeModal">Cancelar</button>
        <button type="button" class="btn-primary" :disabled="trabalhando" @click="escolherArquivo">
          <Spinner v-if="trabalhando" />
          {{ trabalhando ? "Lendo arquivo..." : "Escolher arquivo CSV" }}
        </button>
      </div>
    </template>

    <template v-else-if="etapa === 'analise' && analise">
      <p class="texto">Arquivo: <strong>{{ nomeArquivo }}</strong></p>
      <p class="resumo ok">{{ analise.validas.length }} sócio(s) prontos para importar.</p>
      <p v-if="analise.colunasAusentes.length > 0" class="texto">
        Colunas que não existem no arquivo (ficam em branco):
        <code v-for="chave in analise.colunasAusentes" :key="chave" class="coluna-tag">{{ chave }}</code>
      </p>
      <p v-if="analise.colunasIgnoradas.length > 0" class="texto">
        Colunas do arquivo não reconhecidas (ignoradas):
        <code v-for="titulo in analise.colunasIgnoradas" :key="titulo" class="coluna-tag">{{ titulo }}</code>
      </p>
      <template v-if="analise.avisos.length > 0">
        <p class="resumo">{{ analise.avisos.length }} sócio(s) serão importados sem algum dado:</p>
        <ul class="lista-erros">
          <li v-for="item in analise.avisos" :key="item.linha">Linha {{ item.linha }} — {{ item.mensagem }}</li>
        </ul>
      </template>
      <template v-if="analise.erros.length > 0">
        <p class="resumo falha">{{ analise.erros.length }} linha(s) com problema — não serão importadas:</p>
        <ul class="lista-erros">
          <li v-for="item in analise.erros" :key="item.linha">Linha {{ item.linha }} — {{ item.mensagem }}</li>
        </ul>
      </template>
      <p v-if="trabalhando" class="texto">Importando {{ progresso }} de {{ analise.validas.length }}...</p>

      <div class="save-row">
        <button type="button" class="btn-secondary" :disabled="trabalhando" @click="voltar">Voltar</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="trabalhando || analise.validas.length === 0"
          @click="confirmarImportacao"
        >
          <Spinner v-if="trabalhando" />
          Importar {{ analise.validas.length }} sócio(s)
        </button>
      </div>
    </template>

    <template v-else-if="etapa === 'concluido' && resultado">
      <p class="resumo ok">{{ resultado.importados }} sócio(s) importado(s).</p>
      <template v-if="resultado.erros.length > 0">
        <p class="resumo falha">{{ resultado.erros.length }} falharam ao gravar:</p>
        <ul class="lista-erros">
          <li v-for="item in resultado.erros" :key="item.linha">Linha {{ item.linha }} — {{ item.mensagem }}</li>
        </ul>
      </template>
      <div class="save-row">
        <button type="button" class="btn-primary" @click="closeModal">Fechar</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.import-form {
  font-size: 0.82rem;
  color: var(--text);
}

.texto {
  margin: 0 0 0.8rem;
  line-height: 1.45;
}

.erro {
  margin: 0 0 0.9rem;
  color: #c0392b;
}

.aviso {
  margin: 0 0 0.9rem;
  color: var(--accent);
}

.colunas {
  width: 100%;
  margin: 0.9rem 0 0.4rem;
  border-collapse: collapse;
  font-size: 0.76rem;
}

.colunas th {
  text-align: left;
  color: var(--text-muted);
  font-weight: 600;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--border);
}

.colunas td {
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.colunas td:first-child {
  color: var(--text-muted);
}

code {
  font-size: 0.74rem;
  background: var(--surface-hover);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
}

.obrigatoria {
  color: #c0392b;
  font-weight: 700;
  margin-left: 0.15rem;
}

.dica {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.76rem;
}

h4 {
  margin: 0.4rem 0 0.4rem;
  font-size: 0.8rem;
}

.dicas {
  margin: 0;
  padding-left: 1.1rem;
  line-height: 1.5;
  color: var(--text-muted);
}

.resumo {
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.resumo.ok {
  color: var(--accent);
}

.resumo.falha {
  color: #c0392b;
}

.coluna-tag {
  display: inline-block;
  margin: 0.15rem 0.3rem 0 0;
}

.lista-erros {
  margin: 0 0 0.8rem;
  padding-left: 1.1rem;
  max-height: 220px;
  overflow-y: auto;
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
