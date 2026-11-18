#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 || ( $# -eq 1 && ( "$1" == --help || "$1" == -h ) ) ]]; then
  printf 'Usage: %s [--starter <id>] <new-repository-directory>\n       %s --list\n' "$0" "$0"
  [[ $# -gt 0 ]] && exit 0
  exit 2
fi

# Preserve the standalone shell URL while the Node installer owns setup.
temporary="$(mktemp -d "$PWD/.replica-download.XXXXXX")"
trap 'rm -r -- "$temporary"' EXIT
curl -q -fLSs --output "$temporary/install-starter.mjs" \
  'https://raw.githubusercontent.com/github/replica/main/scripts/install-starter.mjs'
node "$temporary/install-starter.mjs" "$@"
