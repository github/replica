#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <starter-id> <new-check-directory>\n' "$0" >&2
  exit 2
fi
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
bash "$source_root/scripts/create-prototype-repo.sh" --starter "$1" "$2"
destination="$(cd "$2" && pwd -P)"
node "$source_root/actions/build/scripts/validate-repository/index.ts" --root "$destination"
cd "$destination"
node --input-type=module - <<'NODE'
import { readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync("package.json", "utf8"))
for (const command of ["dev", "build", "preview", "check:starter"]) {
  if (typeof manifest.scripts?.[command] !== "string" || !manifest.scripts[command].trim()) {
    throw new Error(`Starter package.json must declare scripts.${command}.`)
  }
}
if (typeof manifest.engines?.node !== "string" || !manifest.engines.node.trim()) {
  throw new Error("Starter package.json must declare engines.node.")
}
NODE
npm ci --engine-strict
npm run check:starter
node "$source_root/actions/build/scripts/validate-build-output/index.ts" --root "$destination"
