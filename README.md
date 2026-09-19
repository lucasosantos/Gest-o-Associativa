# Gestão Associativa

App desktop (Windows e Linux) para administrar o dia a dia de uma associação:
sócios, planos e cobranças de mensalidade, financeiro (contas, pagamentos e
recebimentos), documentos, protocolo e declarações. Roda offline, com os
dados guardados num arquivo SQLite local — sem servidor, sem nuvem,
sem mensalidade de sistema.

Suporta várias associações na mesma instalação, cada uma com seu próprio
banco de dados e, opcionalmente, sua própria senha de acesso.

## Sumário

- [Instalação](#instalação)
- [Funcionalidades](#funcionalidades)
- [Primeiros passos e configuração](#primeiros-passos-e-configuração)
- [Desenvolvimento](#desenvolvimento)

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

- **Sócios** — cadastro de sócios (dados pessoais, endereço, contatos,
  dependentes, representantes), situação (ativo/inativo/etc.) e listagem de
  aptos a votar.
- **Planos** — planos de mensalidade com valores diferentes por categoria de
  sócio (disponível quando a associação usa o modo "Múltiplos planos").
- **Cobranças** — geração e controle das mensalidades dos sócios: registro
  de pagamento avulso, pagamento em lote, acordos de parcelamento e emissão
  de recibo.
- **Financeiro** — contas financeiras (caixa, banco), lançamentos manuais,
  contas a pagar e a receber com parcelas, transferências entre contas e
  relatórios (extrato de conta, prestação de contas por período).
- **Documentos** — upload e vínculo de arquivos a sócios/registros, livros de
  protocolo, protocolo de entrada/saída de documentos e emissão de
  declarações.
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
   Documentos...) mostram sempre os dados da associação ativa.

### Trocar/gerenciar associações

- Trocar a associação ativa: seletor na barra lateral da tela **Início**.
- Renomear, mover o arquivo do banco, trocar senha ou remover uma associação
  da lista: tela **Configurações**.
- Remover uma associação da lista **não apaga** o arquivo `.db` nem a pasta
  de documentos dela no disco — só tira da listagem do app.

### Onde ficam os dados

- **`config.json`** — fica na mesma pasta do executável e guarda a lista de
  associações cadastradas (nome, caminho do banco, se tem senha). O caminho
  exato aparece no rodapé da tela **Configurações**.
- **Banco de dados (`.db`)** — um arquivo SQLite por associação. O local
  sugerido é uma pasta ao lado do executável, mas pode ser trocado em
  Configurações → editar associação → local do arquivo (é preciso reiniciar
  o app depois de mudar).
- **Backup**: como tudo é local, basta copiar o(s) arquivo(s) `.db` (e a
  pasta de documentos anexados, se houver) para outro lugar.

## Desenvolvimento

Stack: Tauri v2 + Vue 3 (Composition API) + TypeScript + Vite no frontend,
Rust no backend nativo, SQLite via `tauri-plugin-sql`. Contexto completo do
projeto para quem for contribuir está em [CLAUDE.md](CLAUDE.md).

| Comando | Ação |
|---|---|
| `npm run dev` | inicia o Vite (só frontend, sem shell nativo) |
| `npm run tauri dev` | roda o app completo (Tauri + Vite) |
| `npm run build` | `vue-tsc -b && vite build` |
| `npm run type-check` | typecheck isolado (`vue-tsc -b`) |
| `npm run tauri build` | gera o binário/instalador local |

Não há scripts de `lint` nem de `test` — o projeto ainda não tem testes
automatizados nem ESLint/Prettier configurados.

### Publicando uma release

O workflow [`.github/workflows/release.yml`](.github/workflows/release.yml)
builda os instaladores de Windows e Linux e publica como GitHub Release
(rascunho) sempre que uma tag `v*` é enviada ao repositório:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Depois é só revisar e publicar o rascunho da release na aba **Releases** do
GitHub.

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
