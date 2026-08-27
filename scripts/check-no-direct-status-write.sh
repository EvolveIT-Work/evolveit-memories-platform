#!/usr/bin/env bash
set -eu
pattern="status[[:space:]]*=[[:space:]]*['\"']used['\"']"
found=""
while IFS= read -r -d '' file; do
  if [ "$file" = "./packages/shared/src/redeem.ts" ] || [ "$file" = "./packages/shared/src/redeem-adapters/postgres.ts" ] || [ "$file" = "./packages/shared/src/redeem-adapters/sqlite.ts" ] || [ "$file" = "./scripts/check-no-direct-status-write.sh" ] || [ "$file" = "./docs/EvolveIT_Memories_Platform_Final.md" ]; then
    continue
  fi
  if grep -nE "$pattern" "$file" >/dev/null 2>&1; then
    found="$found\n$file"
  fi
done < <(find . \( -path './.git' -o -path './node_modules' -o -path './.next' -o -path './dist' -o -path './coverage' -o -path './docs' -o -path './scripts/check-no-direct-status-write.sh' \) -prune -o -type f -print0)
if [ -n "$found" ]; then
  printf '%s\n' "$found" >&2
  echo 'Direct status write detected outside the approved redeem path.' >&2
  exit 1
fi

echo 'No direct tickets.status = "used" writes found outside the approved redeem path.'
