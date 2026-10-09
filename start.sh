#!/usr/bin/env sh
# Starcrew Command for macOS / Linux
#   ./start.sh            start Starcrew
#   ./start.sh --setup    install Claude Code (or Codex) and sign in, then start
#   ./start.sh --browser  install the crew browser, then start
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Starcrew needs Node.js 18 or newer: https://nodejs.org (macOS: brew install node)"; exit 1
fi
node -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)" || { echo "Please update Node.js to version 18 or newer."; exit 1; }
for arg in "$@"; do
  case "$arg" in
    --browser) npm install --no-audit --no-fund && npx playwright install chromium ;;
    --setup)
      printf "Use 1) Claude plan  2) ChatGPT plan  3) decide later? [1/2/3] "; read -r pick
      if [ "$pick" = "1" ]; then
        command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code
        claude auth status >/dev/null 2>&1 || claude auth login
      elif [ "$pick" = "2" ]; then
        command -v codex >/dev/null 2>&1 || npm install -g @openai/codex
        codex login status >/dev/null 2>&1 || codex login
      fi ;;
  esac
done
exec node server.js
