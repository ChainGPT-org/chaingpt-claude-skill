#!/bin/bash
# validate.sh — Pre-commit validation for the ChainGPT Claude Skill
# Run: ./scripts/validate.sh
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
WARN=0

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  WARN  $1"; WARN=$((WARN + 1)); }

echo "========================================="
echo " ChainGPT Skill Validation"
echo "========================================="
echo ""

# -----------------------------------------------------------
# 1. Check required directory structure & files exist
# -----------------------------------------------------------
echo "--- Required Files ---"

REQUIRED_FILES=(
  "README.md"
  "LICENSE"
  "VERSION"
  ".claude-plugin/plugin.json"
  "skills/chaingpt/SKILL.md"
  "skills/research/SKILL.md"
  "skills/security/SKILL.md"
  "skills/deploy/SKILL.md"
  "skills/trade/SKILL.md"
  "skills/defi/SKILL.md"
  "skills/hyperliquid/SKILL.md"
  "skills/polymarket/SKILL.md"
  "skills/strategy/SKILL.md"
  "skills/bridge/SKILL.md"
  "skills/drift/SKILL.md"
  "skills/agent-wallet/SKILL.md"
  "reference/llm-chatbot.md"
  "reference/nft-generator.md"
  "reference/smart-contract-generator.md"
  "reference/smart-contract-auditor.md"
  "reference/crypto-news.md"
  "reference/agenticos.md"
  "reference/solidity-llm.md"
  "reference/saas-whitelabel.md"
  "reference/error-codes.md"
  "reference/pricing.md"
  "reference/wallet-integration.md"
  "reference/advanced-patterns.md"
  "reference/product-selection.md"
  "reference/deployment.md"
  "reference/cost-optimization.md"
  "reference/typescript-types.md"
  "templates/chatbot-app.md"
  "templates/nft-minting-service.md"
  "templates/contract-auditor-ci.md"
  "templates/news-dashboard.md"
  "templates/twitter-agent.md"
  "templates/nextjs-chatbot.md"
  "templates/react-native-wallet.md"
  "templates/nuxt-news-app.md"
  "templates/combo-nft-marketplace.md"
  "templates/combo-defi-dashboard.md"
  "templates/composition-patterns.md"
  "patterns/README.md"
  "patterns/tokens.md"
  "patterns/nfts.md"
  "patterns/defi.md"
  "patterns/governance.md"
  "patterns/security.md"
  "migration/from-openai.md"
  "migration/from-alchemy.md"
  "migration/from-custom.md"
  "skills/playground/SKILL.md"
  "skills/debug/SKILL.md"
  "skills/hackathon/SKILL.md"
  "skills/update/SKILL.md"
  "mcp-server/package.json"
  "mcp-server/src/index.ts"
  "mcp-server/README.md"
  "mock-server/package.json"
  "mock-server/src/index.ts"
  "mock-server/README.md"
  "examples/js/chatbot-stream.js"
  "examples/js/nft-generate-mint.js"
  "examples/js/audit-contract.js"
  "examples/js/fetch-news.js"
  "examples/python/chatbot_stream.py"
  "examples/python/nft_generate_mint.py"
  "examples/python/audit_contract.py"
  "examples/python/fetch_news.py"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ -f "$SKILL_ROOT/$f" ]]; then
    pass "$f"
  else
    fail "$f — file not found"
  fi
done

echo ""

# -----------------------------------------------------------
# 2. Validate SKILL.md frontmatter
# -----------------------------------------------------------
echo "--- SKILL.md Frontmatter ---"

SKILL_FILE="$SKILL_ROOT/skills/chaingpt/SKILL.md"

if [[ -f "$SKILL_FILE" ]]; then
  # Check for frontmatter delimiters
  FIRST_LINE=$(head -1 "$SKILL_FILE")
  if [[ "$FIRST_LINE" == "---" ]]; then
    # Extract frontmatter (between first and second ---)
    FRONTMATTER=$(sed -n '2,/^---$/p' "$SKILL_FILE" | sed '$d')

    # Check required fields
    if echo "$FRONTMATTER" | grep -q "^name:"; then
      pass "SKILL.md has 'name' field"
    else
      fail "SKILL.md missing 'name' field in frontmatter"
    fi

    if echo "$FRONTMATTER" | grep -q "^description:"; then
      pass "SKILL.md has 'description' field"
    else
      fail "SKILL.md missing 'description' field in frontmatter"
    fi
  else
    fail "SKILL.md missing frontmatter (no opening ---)"
  fi
else
  fail "SKILL.md not found"
fi

echo ""

# -----------------------------------------------------------
# 3. Check SKILL.md line count (< 500 lines)
# -----------------------------------------------------------
echo "--- SKILL.md Line Count ---"

if [[ -f "$SKILL_FILE" ]]; then
  LINE_COUNT=$(wc -l < "$SKILL_FILE" | tr -d ' ')
  if [[ "$LINE_COUNT" -lt 500 ]]; then
    pass "SKILL.md is $LINE_COUNT lines (limit: 500)"
  else
    fail "SKILL.md is $LINE_COUNT lines (exceeds 500 line limit)"
  fi
fi

echo ""

# -----------------------------------------------------------
# 4. Syntax-check JavaScript examples
# -----------------------------------------------------------
echo "--- JavaScript Example Syntax ---"

JS_DIR="$SKILL_ROOT/examples/js"
if [[ -d "$JS_DIR" ]]; then
  for js_file in "$JS_DIR"/*.js; do
    if [[ -f "$js_file" ]]; then
      BASENAME=$(basename "$js_file")
      if node --check "$js_file" 2>/dev/null; then
        pass "examples/js/$BASENAME"
      else
        # node --check may fail on ESM imports that aren't installed;
        # fall back to checking for gross syntax errors via acorn-like parse
        # We try a looser check: wrap in async function to handle top-level await
        TEMP_FILE=$(mktemp /tmp/validate_js_XXXXXX.mjs)
        cat "$js_file" > "$TEMP_FILE"
        if node --check "$TEMP_FILE" 2>/dev/null; then
          pass "examples/js/$BASENAME (as ESM)"
        else
          fail "examples/js/$BASENAME — syntax error"
        fi
        rm -f "$TEMP_FILE"
      fi
    fi
  done
else
  warn "examples/js/ directory not found"
fi

echo ""

# -----------------------------------------------------------
# 5. Syntax-check Python examples
# -----------------------------------------------------------
echo "--- Python Example Syntax ---"

PY_DIR="$SKILL_ROOT/examples/python"
if [[ -d "$PY_DIR" ]]; then
  for py_file in "$PY_DIR"/*.py; do
    if [[ -f "$py_file" ]]; then
      BASENAME=$(basename "$py_file")
      if python3 -c "import ast; ast.parse(open('$py_file').read())" 2>/dev/null; then
        pass "examples/python/$BASENAME"
      else
        fail "examples/python/$BASENAME — syntax error"
      fi
    fi
  done
else
  warn "examples/python/ directory not found"
fi

echo ""

# -----------------------------------------------------------
# 6. Check all files referenced in SKILL.md actually exist
# -----------------------------------------------------------
echo "--- SKILL.md File References ---"

if [[ -f "$SKILL_FILE" ]]; then
  # Extract file paths referenced with backticks that look like relative paths
  # Matches patterns like `reference/foo.md`, `templates/bar.md`, `examples/js/baz.js`, etc.
  REFS=$(grep -oE '`[a-zA-Z][a-zA-Z0-9_/-]+\.[a-z]{1,5}`' "$SKILL_FILE" | tr -d '`' | sort -u)

  for ref in $REFS; do
    # Skip URLs and non-file references
    if [[ "$ref" == http* ]] || [[ "$ref" == *.com* ]]; then
      continue
    fi
    # Only check paths that look like project-relative files
    if [[ "$ref" == */* ]] && [[ -f "$SKILL_ROOT/$ref" ]]; then
      pass "Referenced: $ref"
    elif [[ "$ref" == */* ]] && [[ ! -f "$SKILL_ROOT/$ref" ]]; then
      fail "Referenced in SKILL.md but missing: $ref"
    fi
  done
fi

echo ""

# -----------------------------------------------------------
# 7. Check sub-skill SKILL.md files have frontmatter
# -----------------------------------------------------------
echo "--- Sub-Skill Frontmatter ---"

for skill_dir in "$SKILL_ROOT"/skills/*/; do
  if [[ -d "$skill_dir" ]]; then
    SKILL_NAME=$(basename "$skill_dir")
    SUB_SKILL="$skill_dir/SKILL.md"
    if [[ -f "$SUB_SKILL" ]]; then
      SUB_FIRST=$(head -1 "$SUB_SKILL")
      if [[ "$SUB_FIRST" == "---" ]]; then
        SUB_FM=$(sed -n '2,/^---$/p' "$SUB_SKILL" | sed '$d')
        if echo "$SUB_FM" | grep -q "^name:"; then
          pass "skills/$SKILL_NAME/SKILL.md has 'name' field"
        else
          fail "skills/$SKILL_NAME/SKILL.md missing 'name' field"
        fi
        if echo "$SUB_FM" | grep -q "^description:"; then
          pass "skills/$SKILL_NAME/SKILL.md has 'description' field"
        else
          fail "skills/$SKILL_NAME/SKILL.md missing 'description' field"
        fi
      else
        fail "skills/$SKILL_NAME/SKILL.md missing frontmatter"
      fi
    else
      fail "skills/$SKILL_NAME/SKILL.md not found"
    fi
  fi
done

echo ""

# -----------------------------------------------------------
# 8. Version consistency — VERSION ↔ plugin.json ↔ package.json ↔ README badge ↔ Server() literal
# -----------------------------------------------------------
echo "--- Version Consistency ---"

if [[ -f "$SKILL_ROOT/VERSION" ]]; then
  CANONICAL_VERSION=$(tr -d '[:space:]' < "$SKILL_ROOT/VERSION")
  pass "VERSION file: $CANONICAL_VERSION"

  check_version() {
    local label="$1"
    local found="$2"
    if [[ -z "$found" ]]; then
      fail "$label: could not extract a version string"
    elif [[ "$found" == "$CANONICAL_VERSION" ]]; then
      pass "$label = $found"
    else
      fail "$label = $found (expected $CANONICAL_VERSION)"
    fi
  }

  # .claude-plugin/plugin.json
  PLUGIN_JSON="$SKILL_ROOT/.claude-plugin/plugin.json"
  if [[ -f "$PLUGIN_JSON" ]]; then
    PLUGIN_VER=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_JSON" | head -1)
    check_version ".claude-plugin/plugin.json" "$PLUGIN_VER"
  fi

  # mcp-server/package.json
  MCP_PKG="$SKILL_ROOT/mcp-server/package.json"
  if [[ -f "$MCP_PKG" ]]; then
    MCP_VER=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MCP_PKG" | head -1)
    check_version "mcp-server/package.json" "$MCP_VER"
  fi

  # mock-server/package.json (internal dev infra — drift is a soft warning)
  MOCK_PKG="$SKILL_ROOT/mock-server/package.json"
  if [[ -f "$MOCK_PKG" ]]; then
    MOCK_VER=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MOCK_PKG" | head -1)
    if [[ -z "$MOCK_VER" ]]; then
      warn "mock-server/package.json: could not extract version"
    elif [[ "$MOCK_VER" == "$CANONICAL_VERSION" ]]; then
      pass "mock-server/package.json = $MOCK_VER"
    else
      warn "mock-server/package.json = $MOCK_VER (canonical $CANONICAL_VERSION) — internal infra, not user-facing"
    fi
  fi

  # mcp-server/src/index.ts — Server() constructor version literal
  MCP_INDEX="$SKILL_ROOT/mcp-server/src/index.ts"
  if [[ -f "$MCP_INDEX" ]]; then
    SERVER_VER=$(sed -n "s/.*version:[[:space:]]*['\"]\\([0-9][^'\"]*\\)['\"].*/\\1/p" "$MCP_INDEX" | head -1)
    check_version "MCP Server() version literal" "$SERVER_VER"
  fi

  # README.md — version badge ("version-1.9.0-blue")
  README="$SKILL_ROOT/README.md"
  if [[ -f "$README" ]]; then
    README_VER=$(sed -n 's/.*version-\([0-9][^-]*\)-blue.*/\1/p' "$README" | head -1)
    check_version "README.md version badge" "$README_VER"
  fi
else
  fail "VERSION file missing"
fi

echo ""

# -----------------------------------------------------------
# Summary
# -----------------------------------------------------------
echo "========================================="
echo " Results: $PASS passed, $FAIL failed, $WARN warnings"
echo "========================================="

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Validation FAILED. Fix the issues above before submitting."
  exit 1
else
  echo ""
  echo "All checks passed."
  exit 0
fi
