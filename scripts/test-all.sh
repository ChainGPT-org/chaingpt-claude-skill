#!/usr/bin/env bash
# test-all.sh — single entry point for every test layer in the repo.
#
# Layers (in order, fast → slow):
#   1. validate     — frontmatter, structural, anchor checks         (~1s)
#   2. typecheck    — tsc --noEmit across both servers               (~5s)
#   3. mcp-test     — vitest unit + integration (mcp-server)         (~3s)
#   4. mock-test    — vitest endpoint tests (mock-server)            (~10s)
#   5. examples     — node --check / python ast.parse on every file  (~2s)
#   6. smoke        — live-API smoke against real upstreams          (~30s)
#
# Usage:
#   ./scripts/test-all.sh                # run everything
#   ./scripts/test-all.sh --fast         # skip live smoke (everything offline)
#   ./scripts/test-all.sh --only smoke   # one layer only
#   ./scripts/test-all.sh --skip-drift   # smoke without drift (when upstream 503s)
#
# Exit codes:
#   0  every requested layer passed
#   1  one or more layers failed
#   2  invalid usage

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Flags ─────────────────────────────────────────────────────────
FAST=0
ONLY=""
SKIP_DRIFT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast) FAST=1; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --skip-drift) SKIP_DRIFT=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"; exit 0 ;;
    *)
      echo "Unknown flag: $1" >&2
      echo "Try: $0 --help" >&2
      exit 2 ;;
  esac
done

# ── Output helpers ────────────────────────────────────────────────
if [[ -t 1 ]]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=""; RED=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi

PASS=()
FAIL=()
SKIP=()

run_layer() {
  local name="$1"; shift
  if [[ -n "$ONLY" && "$ONLY" != "$name" ]]; then
    SKIP+=("$name (not selected)")
    return 0
  fi
  echo
  echo "${BOLD}${BLUE}━━━ $name ━━━${RESET}"
  local start=$SECONDS
  if "$@"; then
    local elapsed=$((SECONDS - start))
    echo "${GREEN}✓ $name (${elapsed}s)${RESET}"
    PASS+=("$name (${elapsed}s)")
    return 0
  else
    local elapsed=$((SECONDS - start))
    echo "${RED}✗ $name FAILED (${elapsed}s)${RESET}"
    FAIL+=("$name (${elapsed}s)")
    return 1
  fi
}

# ── Layer 1: validate ─────────────────────────────────────────────
layer_validate() {
  bash "$REPO_ROOT/scripts/validate.sh"
}

# ── Layer 2: typecheck ────────────────────────────────────────────
layer_typecheck() {
  local ok=0
  if [[ -d mcp-server/node_modules ]]; then
    (cd mcp-server && node node_modules/typescript/bin/tsc --noEmit) || ok=1
  else
    echo "${YELLOW}skip mcp-server typecheck (run 'cd mcp-server && npm ci' first)${RESET}"
  fi
  if [[ -d mock-server/node_modules ]]; then
    (cd mock-server && node node_modules/typescript/bin/tsc --noEmit) || ok=1
  else
    echo "${YELLOW}skip mock-server typecheck (run 'cd mock-server && npm ci' first)${RESET}"
  fi
  return $ok
}

# ── Layer 3: mcp-server vitest ────────────────────────────────────
layer_mcp_test() {
  if [[ ! -d mcp-server/node_modules ]]; then
    echo "Installing mcp-server deps..."
    (cd mcp-server && npm ci) || return 1
  fi
  (cd mcp-server && npm test)
}

# ── Layer 4: mock-server vitest ───────────────────────────────────
layer_mock_test() {
  if [[ ! -d mock-server/node_modules ]]; then
    echo "Installing mock-server deps..."
    (cd mock-server && npm ci) || return 1
  fi
  (cd mock-server && npm test)
}

# ── Layer 5: examples (syntax) ────────────────────────────────────
layer_examples() {
  local fail=0
  if command -v node >/dev/null 2>&1; then
    while IFS= read -r f; do
      node --check "$f" 2>&1 | sed "s|^|  $f: |" && echo "  ${GREEN}ok${RESET} $f" \
        || { echo "  ${RED}FAIL${RESET} $f"; fail=1; }
    done < <(find examples/js examples/sse -type f -name "*.js" 2>/dev/null)
  fi
  if command -v python3 >/dev/null 2>&1; then
    while IFS= read -r f; do
      python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" \
        && echo "  ${GREEN}ok${RESET} $f" \
        || { echo "  ${RED}FAIL${RESET} $f"; fail=1; }
    done < <(find examples/python -type f -name "*.py" 2>/dev/null)
  fi
  # Go: prefer `go vet` (catches more than `gofmt -l`) when the toolchain is present.
  if command -v go >/dev/null 2>&1 && [[ -d examples/go ]]; then
    if (cd examples/go && go vet ./... 2>&1); then
      echo "  ${GREEN}ok${RESET} examples/go (go vet)"
    else
      echo "  ${RED}FAIL${RESET} examples/go (go vet)"; fail=1
    fi
  elif [[ -d examples/go ]]; then
    echo "  ${YELLOW}skip${RESET} examples/go (no go toolchain)"
  fi
  # Rust: `cargo check` is the cheapest type-check that doesn't link.
  if command -v cargo >/dev/null 2>&1 && [[ -d examples/rust ]]; then
    if (cd examples/rust && cargo check --offline 2>/dev/null || cargo check 2>&1); then
      echo "  ${GREEN}ok${RESET} examples/rust (cargo check)"
    else
      echo "  ${RED}FAIL${RESET} examples/rust (cargo check)"; fail=1
    fi
  elif [[ -d examples/rust ]]; then
    echo "  ${YELLOW}skip${RESET} examples/rust (no cargo toolchain)"
  fi
  return $fail
}

# ── Layer 6: live smoke ───────────────────────────────────────────
layer_smoke() {
  if [[ $FAST -eq 1 && -z "$ONLY" ]]; then
    echo "${YELLOW}skipped (--fast)${RESET}"
    SKIP+=("smoke (--fast)")
    return 0
  fi
  if [[ ! -f mcp-server/dist/smoke-test.js ]]; then
    echo "Building mcp-server first..."
    (cd mcp-server && npm run build) || return 1
  fi
  local env_args=("CHAINGPT_API_KEY=${CHAINGPT_API_KEY:-smoke-test}")
  if [[ $SKIP_DRIFT -eq 1 ]]; then
    env_args+=("SKIP_DRIFT_SMOKE=1")
  fi
  (cd mcp-server && env "${env_args[@]}" node dist/smoke-test.js)
}

# ── Run ───────────────────────────────────────────────────────────
echo "${BOLD}ChainGPT Claude Skill — full test run${RESET}"
echo "Repo: $REPO_ROOT"
echo "Mode: $([[ $FAST -eq 1 ]] && echo "FAST (no live smoke)" || echo "FULL")"
[[ -n "$ONLY" ]] && echo "Only: $ONLY"
[[ $SKIP_DRIFT -eq 1 ]] && echo "Skip: drift smoke cases"

run_layer "validate"  layer_validate    || true
run_layer "typecheck" layer_typecheck   || true
run_layer "mcp-test"  layer_mcp_test    || true
run_layer "mock-test" layer_mock_test   || true
run_layer "examples"  layer_examples    || true
run_layer "smoke"     layer_smoke       || true

# ── Summary ───────────────────────────────────────────────────────
echo
echo "${BOLD}━━━ Summary ━━━${RESET}"
for p in ${PASS[@]+"${PASS[@]}"}; do echo "  ${GREEN}✓${RESET} $p"; done
for s in ${SKIP[@]+"${SKIP[@]}"}; do echo "  ${YELLOW}∼${RESET} $s"; done
for f in ${FAIL[@]+"${FAIL[@]}"}; do echo "  ${RED}✗${RESET} $f"; done
echo

if [[ ${#FAIL[@]} -eq 0 ]]; then
  echo "${BOLD}${GREEN}All ${#PASS[@]} layers passed.${RESET}"
  exit 0
else
  echo "${BOLD}${RED}${#FAIL[@]} of $((${#PASS[@]} + ${#FAIL[@]})) layers failed.${RESET}"
  exit 1
fi
