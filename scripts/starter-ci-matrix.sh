#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$source_root/scripts/starter-catalog.sh"
read_starter_catalog "$source_root/starters.tsv"
printf '['
separator=""
for ((index = 0; index < ${#starter_ids[@]}; index++)); do
  printf '%s{"id":"%s","directory":"%s"}' "$separator" "${starter_ids[$index]}" "${starter_directories[$index]}"
  separator=","
done
printf ']\n'
