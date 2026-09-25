# Gestão Associativa

App desktop (Windows e Linux) para administrar o dia a dia de uma associação:
sócios, planos e cobranças de mensalidade, financeiro (contas, pagamentos e
recebimentos), documentos, protocolo e declarações, patrimônio e um
histórico de tudo o que é feito no sistema. Roda offline, com os dados
guardados num arquivo SQLite local — sem servidor, sem nuvem, sem
mensalidade de sistema.

Suporta várias associações na mesma instalação, cada uma com seu próprio
banco de dados e, opcionalmente, sua própria senha de acesso.

## Sumário

- [Novidades da versão 1.1](#novidades-da-versão-11)
- [Instalação](#instalação)
- [Funcionalidades](#funcionalidades)
- [Primeiros passos e configuração](#primeiros-passos-e-configuração)
- [Impressão](#impressão)
- [Onde ficam os dados e backup](#onde-ficam-os-dados-e-backup)
- [Desenvolvimento](#desenvolvimento)

## Novidades da versão 1.1

- **Patrimônio** — cadastro de bens com linha do tempo (aquisição,
  movimentação, manutenção, empréstimo, baixa) e balanço de patrimônio
  impresso.
- **Atividades** — histórico de tudo o que é feito no sistema, com data e
  hora, que não pode ser alterado nem apagado; navegação por dia e
  impressão.
- **Lista de sócios impressa** — filtrada por situação e ordenada por nome
  ou matrícula.
- **Tamanho do papel configurável** — papel padrão (A4, Carta, Ofício) e
  papel de recibo (A4, A5, Carta ou bobina de impressora térmica 58/80 mm).
- **Impressões revisadas** — nenhuma impressão vaza mais para fora da
  folha, e o papel sai sempre com cores claras, mesmo com o sistema em
  tema escuro.

## Instalação

Baixe o instalador da sua plataforma na página de
**[Releases](../../releases/latest)**:

| Plataforma | Arquivo |
|---|---|
| 🪟 Windows | `.msi` ou `.exe` (setup) |
| 🐧 Linux | `.AppImage` (roda em qualquer distro) ou `.deb` (Debian/Ubuntu) |

### Windows

1. Baixe o arquivo `Gestão.Associativa_x.x.x_x64-setup.exe` (ou `.msi`) na
   página de releases.
2. Execute o instalador e siga o assistente. O Windows pode avisar que o
   aplicativo é de um "editor desconhecido" — clique em **Mais informações →
   Executar assim mesmo** (o app ainda não tem certificado de assinatura de
   código).
3. Ao final, o atalho "Gestão Associativa" fica disponível no Menu Iniciar.

### Linux

**AppImage** (não precisa instalar, funciona em quase qualquer distro):

```bash
chmod +x Gestao-Associativa_x.x.x_amd64.AppImage
./Gestao-Associativa_x.x.x_amd64.AppImage
```

**Pacote .deb** (Debian, Ubuntu e derivados):

```bash
sudo apt install ./gestao-associativa_x.x.x_amd64.deb
```

## Funcionalidades

- **Sócios** — cadastro de sócios (dados pessoais, foto, endereço,
  contatos, dependentes, representantes), situação com histórico
  (ativo/inativo/suspenso/desligado/etc.), matrícula manual ou automática,
  importação e exportação em planilha CSV. Impressões: lista de sócios
  (filtrada por situação, ordenada por nome ou matrícula, cada sócio em
  duas linhas com matrícula, nome, data de associação, CPF, RG e
  nascimento), lista de aptos a votar e declarações.
- **Planos** — planos de mensalidade com valores diferentes por categoria de
  sócio (disponível quando a associação usa o modo "Múltiplos planos").
- **Cobranças** — controle das mensalidades dos sócios: pagamento avulso,
  pagamento em lote, pagamento adiantado, acordos de renegociação e
  emissão de recibo.
- **Financeiro** — contas financeiras (caixa, banco), lançamentos manuais,
  estornos, contas a pagar e a receber com parcelas, doações,
  transferências entre contas e relatórios (extrato de conta, prestação de
  contas por período).
- **Documentos** — upload e vínculo de arquivos a sócios, protocolos e bens,
  livros de protocolo, protocolo de entrada/saída de documentos e emissão
  de declarações.
- **Patrimônio** — cadastro dos bens da associação (nº de patrimônio,
  categoria, origem — compra, doação, cessão —, valor, nota fiscal, local,
  responsável e estado de conservação). A ficha de cada bem mostra a linha
  do tempo completa; local, responsável e situação mudam só por eventos
  registrados (movimentar, enviar para manutenção, emprestar, devolver,
  registrar ocorrência), para ficar tudo no histórico. A **baixa** (venda,
  doação, descarte, perda, furto) exige motivo e pode ser desfeita com
  justificativa. Compra, custo de manutenção e venda podem ser lançados no
  caixa na hora. **Balanço de patrimônio** impresso, agrupado por categoria
  com subtotais, opcionalmente com os bens baixados.
- **Atividades** — tudo o que é feito no sistema fica registrado com data,
  hora e descrição (ex.: `24/09/2026 18:35 — Novo sócio — Lucas (matrícula
  12)`): cadastros, pagamentos, lançamentos, documentos, protocolos,
  patrimônio, backups, abertura da associação. Os registros não podem ser
  alterados nem apagados. A tela mostra um dia por página (pulando os dias
  sem atividade), com filtro por módulo e texto, e imprime o dia.
- **Múltiplas associações** — cada associação cadastrada tem seu próprio
  arquivo de banco de dados e, se quiser, senha de acesso própria; trocar de
  associação ativa é feito pela barra lateral da tela Início.

## Primeiros passos e configuração

1. Abra o app. Na primeira execução não há nenhuma associação cadastrada —
   use a tela **Início** para cadastrar a primeira (nome e, se quiser, uma
   senha de acesso).
2. Depois de cadastrar, o app pede pra completar o **cadastro institucional**
   (dados da associação, modo de mensalidade: **Único** valor para todos os
   sócios ou **Múltiplos planos**). Esse modo decide se a aba "Planos"
   aparece no menu.
3. A partir daí, os módulos do menu superior (Sócios, Cobranças, Financeiro,
   Documentos, Patrimônio, Atividades...) mostram sempre os dados da
   associação ativa.
4. Em **Configurações → Impressão**, escolha o tamanho do papel da sua
   impressora (ver [Impressão](#impressão)).

### Trocar/gerenciar associações

- Trocar a associação ativa: seletor na barra lateral da tela **Início**.
- Renomear, mover o arquivo do banco, trocar senha ou remover uma associação
  da lista: tela **Configurações**.
- Remover uma associação da lista **não apaga** o arquivo `.db` nem a pasta
  de documentos dela no disco — só tira da listagem do app.

## Impressão

Todas as impressões (relatórios, listas, recibos, declarações) abrem numa
tela própria que já chama a janela de impressão do sistema — dali também
dá para salvar em PDF.

Em **Configurações → Impressão** ficam dois tamanhos de papel, guardados
por instalação (valem para todas as associações daquele computador):

| Opção | Papéis | Usado em |
|---|---|---|
| Impressão padrão | A4, Carta, Ofício | relatórios, listas de sócios, livro de protocolo, extrato, prestação de contas, declarações, balanço de patrimônio, atividades |
| Impressão de recibo | A4, A5 (meia folha), Carta, bobina térmica 58 mm, bobina térmica 80 mm | recibo de mensalidade, recibo de acordo, comprovante de protocolo |

Dicas:

- Na janela de impressão, deixe a **escala em 100%/"Padrão"** e o mesmo
  papel escolhido nas Configurações.
- **Impressora térmica**: o recibo sai no formato de cupom, na largura da
  bobina, e a altura da página acompanha o tamanho do recibo (a impressora
  não puxa papel em branco). Configure o driver da impressora com a bobina
  certa e margens "Nenhuma"; faça uma impressão de teste de cada tipo de
  recibo.

## Onde ficam os dados e backup

- **`config.json`** — fica na mesma pasta do executável e guarda a lista de
  associações cadastradas (nome, caminho do banco, se tem senha) e os
  tamanhos de papel de impressão. O caminho exato aparece no rodapé da tela
  **Configurações**.
- **Banco de dados (`.db`)** — um arquivo SQLite por associação. O local
  sugerido é uma pasta ao lado do executável, mas pode ser trocado em
  Configurações → editar associação → local do arquivo (é preciso reiniciar
  o app depois de mudar).
- **Documentos anexados** — ficam na pasta `docs`, ao lado do `.db` de cada
  associação.
- **Backup** — na tela **Início**, "Exportar backup" gera um `.zip` com o
  banco e todos os documentos anexados da associação ativa (cópia
  consistente, mesmo com o app aberto). "Importar backup" restaura um
  `.zip` (ou um `.db` solto) por cima da associação ativa; os dados atuais
  **não são apagados** — ficam guardados ao lado, renomeados — e o app
  reinicia em seguida.

## Desenvolvimento

Stack: Tauri v2 + Vue 3 (Composition API) + TypeScript + Vite no frontend,
Rust no backend nativo, SQLite via `tauri-plugin-sql`. Contexto completo do
projeto para quem for contribuir está em [CLAUDE.md](CLAUDE.md), nas regras
por área em [.claude/rules/](.claude/rules/) e no histórico de decisões em
[docs/plano-implementacao.md](docs/plano-implementacao.md).

| Comando | Ação |
|---|---|
| `npm run dev` | inicia o Vite (só frontend, sem shell nativo) |
| `npm run tauri dev` | roda o app completo (Tauri + Vite) |
| `npm run build` | `vue-tsc -b && vite build` |
| `npm run type-check` | typecheck isolado (`vue-tsc -b`) |
| `npm run tauri build` | gera o binário/instalador local |

Não há scripts de `lint` nem de `test` — o projeto ainda não tem testes
automatizados nem ESLint/Prettier configurados.

### Publicar uma versão

1. Atualize a versão (mesmo número nos três lugares): `package.json`,
   `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml` (o `Cargo.lock` e o
   `package-lock.json` acompanham).
2. Faça o commit e envie uma tag `v<versão>` (ex.: `git tag v1.1.0 && git
   push origin v1.1.0`) — o workflow
   [release.yml](.github/workflows/release.yml) gera os instaladores de
   Windows e Linux e publica em Releases.

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
