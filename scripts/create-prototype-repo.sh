#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ ! -f "$source_root/scripts/create-prototype-repo.mjs" ]]; then
  printf 'This installer copy is outdated. Download the latest installer from https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md.\n' >&2
  exit 1
fi
exec node "$source_root/scripts/create-prototype-repo.mjs" "$@"
