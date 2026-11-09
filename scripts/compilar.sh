#!/usr/bin/env bash
# Compila os instaladores do Gestão Associativa para Linux e/ou Windows,
# a partir de uma máquina Linux (x86_64).
#
# Uso:
#   scripts/compilar.sh            # Linux e Windows
#   scripts/compilar.sh linux      # só Linux  (.deb, .rpm, .AppImage)
#   scripts/compilar.sh windows    # só Windows (instalador .exe — NSIS)
#   (ou: npm run compilar / compilar:linux / compilar:windows)
#
# Os instaladores são copiados para `instaladores/<versão>/`.
#
# Windows a partir do Linux = compilação cruzada experimental do Tauri
# (https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos):
# usa `cargo-xwin` com o target MSVC e só gera o instalador NSIS (.exe). O
# instalador .msi (WiX) só sai compilando NO Windows — o workflow de release
# (.github/workflows/release.yml, disparado por tag `v*`) continua gerando os dois.
#
# Dependências (o script confere antes de começar):
#   Linux:   node/npm, cargo, libwebkit2gtk-4.1-dev, librsvg2-dev, patchelf
#   Windows: as de cima + rustup target x86_64-pc-windows-msvc, cargo-xwin,
#            nsis (makensis), lld, llvm (llvm-rc) e clang
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

ALVO="${1:-todos}"
TARGET_WINDOWS="x86_64-pc-windows-msvc"

# --- Saída colorida só quando é terminal ---
if [[ -t 1 ]]; then
  VERDE=$'\e[32m'; AMARELO=$'\e[33m'; VERMELHO=$'\e[31m'; NEGRITO=$'\e[1m'; FIM=$'\e[0m'
else
  VERDE=""; AMARELO=""; VERMELHO=""; NEGRITO=""; FIM=""
fi
info()  { echo "${NEGRITO}==>${FIM} $*"; }
ok()    { echo "${VERDE}✔${FIM} $*"; }
aviso() { echo "${AMARELO}!${FIM} $*" >&2; }
erro()  { echo "${VERMELHO}✘ $*${FIM}" >&2; exit 1; }

case "$ALVO" in
  linux | windows | todos) ;;
  -h | --help | ajuda)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) erro "Alvo inválido: \"$ALVO\". Use: linux, windows ou todos." ;;
esac

[[ "$(uname -s)" == "Linux" ]] || erro "Este script roda no Linux. No Windows, use: npm run tauri build"

# --- Dependências ---
exige() {
  command -v "$1" >/dev/null 2>&1 || erro "Falta \"$1\" no PATH. $2"
}

exige node "Instale o Node.js (LTS)."
exige npm "Instale o Node.js (LTS)."
exige cargo "Instale o Rust: https://rustup.rs"

if [[ "$ALVO" != "windows" ]]; then
  if command -v pkg-config >/dev/null 2>&1 && ! pkg-config --exists webkit2gtk-4.1; then
    erro "Falta a webkit2gtk-4.1. No Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev patchelf"
  fi
fi

if [[ "$ALVO" != "linux" ]]; then
  exige cargo-xwin "Instale com: cargo install --locked cargo-xwin"
  exige makensis "Instale o NSIS. No Ubuntu/Debian: sudo apt install nsis"
  exige lld "No Ubuntu/Debian: sudo apt install lld llvm clang"
  exige llvm-rc "No Ubuntu/Debian: sudo apt install llvm"
  exige clang "No Ubuntu/Debian: sudo apt install clang"
  if command -v rustup >/dev/null 2>&1; then
    if ! rustup target list --installed | grep -qx "$TARGET_WINDOWS"; then
      info "Instalando o target Rust $TARGET_WINDOWS..."
      rustup target add "$TARGET_WINDOWS"
    fi
  else
    aviso "rustup não encontrado — confira se o target $TARGET_WINDOWS está instalado."
  fi
fi

# --- Versão: tem que ser a mesma nos três arquivos (ver CLAUDE.md) ---
VERSAO="$(node -p "require('./package.json').version")"
VERSAO_TAURI="$(node -p "require('./src-tauri/tauri.conf.json').version")"
VERSAO_CARGO="$(sed -n 's/^version *= *"\(.*\)"/\1/p' src-tauri/Cargo.toml | head -n 1)"
if [[ "$VERSAO" != "$VERSAO_TAURI" || "$VERSAO" != "$VERSAO_CARGO" ]]; then
  erro "Versões diferentes — package.json: $VERSAO, tauri.conf.json: $VERSAO_TAURI, Cargo.toml: $VERSAO_CARGO. Acerte antes de compilar."
fi

SAIDA="$RAIZ/instaladores/$VERSAO"
mkdir -p "$SAIDA"

# --- Dependências do frontend ---
if [[ ! -d node_modules ]]; then
  info "Instalando dependências do frontend (npm ci)..."
  npm ci
fi

# Copia os arquivos que casam com o padrão; avisa se não achou nenhum.
copiar() {
  local descricao="$1"; shift
  local achou=0 arquivo
  for arquivo in "$@"; do
    [[ -f "$arquivo" ]] || continue
    cp -f "$arquivo" "$SAIDA/"
    ok "$descricao: instaladores/$VERSAO/$(basename "$arquivo")"
    achou=1
  done
  [[ $achou -eq 1 ]] || aviso "Nenhum arquivo de $descricao encontrado."
}

# A versão no nome evita copiar instalador antigo que tenha ficado no target/.
compilar_linux() {
  info "Compilando para Linux ($VERSAO)..."
  npm run tauri build
  local bundle="src-tauri/target/release/bundle"
  copiar "Linux .deb" "$bundle"/deb/*_"$VERSAO"_*.deb
  copiar "Linux .rpm" "$bundle"/rpm/*-"$VERSAO"-*.rpm
  copiar "Linux .AppImage" "$bundle"/appimage/*_"$VERSAO"_*.AppImage
}

compilar_windows() {
  info "Compilando para Windows ($VERSAO, $TARGET_WINDOWS via cargo-xwin)..."
  npm run tauri build -- --runner cargo-xwin --target "$TARGET_WINDOWS" --bundles nsis
  copiar "Windows .exe" src-tauri/target/"$TARGET_WINDOWS"/release/bundle/nsis/*_"$VERSAO"_*.exe
}

INICIO=$SECONDS
case "$ALVO" in
  linux) compilar_linux ;;
  windows) compilar_windows ;;
  todos)
    compilar_linux
    compilar_windows
    ;;
esac

echo
ok "Pronto em $(( (SECONDS - INICIO) / 60 )) min $(( (SECONDS - INICIO) % 60 )) s. Instaladores em: instaladores/$VERSAO/"
ls -lh "$SAIDA"
