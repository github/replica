#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-repository-directory>\n' "$0" >&2
  exit 2
fi

if [[ ! -d "$(dirname -- "$1")" ]]; then
  printf 'Destination must have an existing parent directory.\n' >&2
  exit 1
fi
if [[ -e "$1" || -L "$1" ]]; then
  printf 'Destination already exists: %s\n' "$1" >&2
  exit 1
fi

# Preserve the standalone shell URL while the Node installer owns setup.
temporary="$(mktemp -d "$PWD/.replica-download.XXXXXX")"
trap 'rm -r -- "$temporary"' EXIT
curl -q -fLSs --output "$temporary/install-starter.mjs" \
  'https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.mjs'
node "$temporary/install-starter.mjs" "$@"
