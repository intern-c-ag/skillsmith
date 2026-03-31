#!/usr/bin/env bash
set -euo pipefail

REPO="intern-c-ag/vibe"
INSTALL_DIR="${VIBE_HOME:-$HOME/.vibe}"
BIN_DIR="${VIBE_BIN:-$HOME/.local/bin}"

main() {
  echo ""
  echo "  ┬  ┬┬┌┐ ┌─┐"
  echo "  └┐┌┘│├┴┐├┤ "
  echo "   └┘ ┴└─┘└─┘"
  echo ""

  need_cmd node
  need_cmd git

  local node_major
  node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
  if [ "$node_major" -lt 18 ]; then
    err "Node.js >= 18 required (found v$(node -v))"
  fi

  info "Downloading vibe..."
  if [ -d "$INSTALL_DIR" ]; then
    git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || {
      rm -rf "$INSTALL_DIR"
      git clone --quiet --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
    }
  else
    git clone --quiet --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  fi

  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --silent --no-fund --no-audit 2>/dev/null

  info "Building..."
  npx --yes tsup src/cli.ts --format esm --target node18 --clean --silent 2>/dev/null

  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/vibe" << 'WRAPPER'
#!/usr/bin/env bash
exec node "${VIBE_HOME:-$HOME/.vibe}/dist/cli.js" "$@"
WRAPPER
  chmod +x "$BIN_DIR/vibe"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    warn "$BIN_DIR is not in your PATH"
    echo ""
    echo "  Add to your shell config:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
    echo ""
  fi

  echo ""
  success "vibe installed!"
  echo ""
  printf "  Run \033[1mvibe\033[0m in any project to get started.\n"
  echo ""
}

bold="\033[1m"
reset="\033[0m"
info()    { echo "  → $1"; }
success() { echo "  ✔ $1"; }
warn()    { echo "  ⚠ $1"; }
err()     { echo "  ✖ $1" >&2; exit 1; }

need_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 is required but not found"
  fi
}

main "$@"
