#!/usr/bin/env bash
# Strict-validate the marketplace and every plugin, then run each plugin's tests.
# No sign-in or network needed. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ marketplace"
claude plugin validate --strict . < /dev/null

# Each plugin that draws carries its own copy of the shared look; the copies must not drift.
echo "▸ shared palette"
ref=plugins/game-hud/hooks/palette.ts
for f in plugins/*/hooks/palette.ts; do
  if ! cmp -s "$ref" "$f"; then
    echo "✗ $f differs from $ref (copy the file again)"
    exit 1
  fi
done

# Every plugin folder is listed in the marketplace.
for dir in plugins/*/; do
  name="$(basename "$dir")"
  if ! grep -q "\"name\": \"$name\"" .claude-plugin/marketplace.json; then
    echo "✗ $name is not listed in .claude-plugin/marketplace.json"
    exit 1
  fi
done

for dir in plugins/*/; do
  name="$(basename "$dir")"
  echo "▸ $name · validate"
  claude plugin validate --strict "$dir" < /dev/null
  if compgen -G "$dir/tests/*.test.ts" > /dev/null; then
    echo "▸ $name · test"
    claude plugin test "$dir" < /dev/null
  fi
done
echo "✔ all checks passed"
