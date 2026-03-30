#!/usr/bin/env bash
set -euo pipefail

REPO="intern-c-ag/skillsmith"
INSTALL_DIR="${SKILLSMITH_HOME:-$HOME/.skillsmith}"
BIN_DIR="${SKILLSMITH_BIN:-$HOME/.local/bin}"

main() {
  echo ""
  echo "  ┌─┐┬┌─┬┐ ┬  ┌─┐┌┬┐┬┌┬┐┬ ┬"
  echo "  └─┐├┴┐│ │  │  └─┐││││ │ ├─┤"
  echo "  └─┘┴ ┴┴─┘┴─┘└─┘┴ ┴┴ ┴ ┴ ┴"
  echo ""

  # Check deps
  need_cmd node
  need_cmd git

  local node_major
  node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
  if [ "$node_major" -lt 18 ]; then
    err "Node.js >= 18 required (found v$(node -v))"
  fi

  # Download
  info "Downloading skillsmith..."
  if [ -d "$INSTALL_DIR" ]; then
    git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || {
      rm -rf "$INSTALL_DIR"
      git clone --quiet --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
    }
  else
    git clone --quiet --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
  fi

  # Build
  info "Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --silent --no-fund --no-audit 2>/dev/null

  info "Building..."
  npx --yes tsup src/cli.ts --format esm --target node18 --clean --silent 2>/dev/null

  # Link binary
  mkdir -p "$BIN_DIR"
  cat > "$BIN_DIR/skillsmith" << 'WRAPPER'
#!/usr/bin/env bash
exec node "${SKILLSMITH_HOME:-$HOME/.skillsmith}/dist/cli.js" "$@"
WRAPPER
  chmod +x "$BIN_DIR/skillsmith"

  # Check PATH
  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    warn "$BIN_DIR is not in your PATH"
    echo ""
    echo "  Add this to your shell config:"
    echo ""
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
    echo ""
  fi

  echo ""
  success "skillsmith installed!"
  echo ""
  echo "  Get started:"
  echo ""
  echo "    skillsmith train ~/your-project"
  echo "    skillsmith list"
  echo "    skillsmith init ."
  echo ""
}

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
