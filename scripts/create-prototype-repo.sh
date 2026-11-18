#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec node "$source_root/scripts/create-prototype-repo.mjs" "$@"
