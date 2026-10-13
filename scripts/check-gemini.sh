#!/usr/bin/env bash
# Validate the Gemini CLI extension manifest and run its unit/integration test suite.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v gemini >/dev/null 2>&1; then
  echo "▸ gemini-extension · validate"
  gemini extensions validate ./gemini-extension
fi

echo "▸ gemini-extension · test"
node --test ./gemini-extension/tests/gemini-extension.test.mjs
echo "✔ gemini-extension checks passed"
