#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 || ( $# -eq 1 && ( "$1" == --help || "$1" == -h ) ) ]]; then
  printf 'Usage: %s [--starter <id>] [--preset <preset>] [--interactive] <new-repository-directory>\n       %s --list\n' "$0" "$0"
  printf '\n--preset configures a generated starter. Omit it to use that starter'\''s default.\n'
  printf '%s\n' '--interactive asks for generation choices in a terminal.'
  [[ $# -gt 0 ]] && exit 0
  exit 2
fi
if [[ $# -eq 1 && "$1" != -* ]]; then
  if [[ ! -d "$(dirname -- "$1")" ]]; then
    printf 'Destination must have an existing parent directory.\n' >&2
    exit 1
  fi
  if [[ -e "$1" || -L "$1" ]]; then
    printf 'Destination already exists: %s\n' "$1" >&2
    exit 1
  fi
fi

for tool in curl tar git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Replica setup requires %s.\n' "$tool" >&2
    exit 1
  fi
done

temporary="$(mktemp -d "${TMPDIR:-/tmp}/replica-download.XXXXXX")"
trap 'rm -r -- "$temporary"' EXIT

archive="$temporary/replica.tar.gz"
if ! curl -q -fLSs --output "$archive" \
    'https://github.com/github/replica/archive/refs/heads/main.tar.gz'; then
  printf 'Could not download the Replica source archive. Check your network connection and access to GitHub, then try again.\n' >&2
  exit 1
fi
if ! tar -tzf "$archive" > "$temporary/members" ||
    ! tar -tvzf "$archive" > "$temporary/types"; then
  printf 'Could not read the Replica source archive.\n' >&2
  exit 1
fi

archive_root="replica-main"
has_script=0
has_helper=0
has_catalog=0
exec 3< "$temporary/types"
while IFS= read -r member; do
  if ! IFS= read -r details <&3; then
    printf 'Replica source archive has an invalid listing.\n' >&2
    exit 1
  fi
  relative="${member#"$archive_root/"}"
  if [[ "$member" != "$archive_root/" &&
        ( "$member" != "$archive_root/"* || -z "$relative" ||
          "$relative" == /* || "$relative" == *"//"* ||
          "/$relative/" == *"/../"* || "/$relative/" == *"/./"* ||
          "$relative" == *$'\r'* || "$relative" == *$'\t'* || "$relative" == *\\* ) ]]; then
    printf 'Replica source archive contains an unsafe path: %s\n' "$member" >&2
    exit 1
  fi
  if [[ "$member" == "$archive_root/" ||
        "$relative" == starters || "$relative" == starters/* ||
        "$member" == "$archive_root/scripts" ||
        "$member" == "$archive_root/scripts/" ||
        "$member" == "$archive_root/scripts/starter-catalog.sh" ||
        "$member" == "$archive_root/scripts/create-prototype-repo.sh" ]]; then
    if [[ "$member" == */ ]]; then
      if [[ "$details" != d* ]]; then
        printf 'Replica source archive contains an unsupported directory: %s\n' "$member" >&2
        exit 1
      fi
    elif [[ "$details" != -* ]]; then
      printf 'Replica source archive contains a linked or unsupported file: %s\n' "$member" >&2
      exit 1
    fi
  fi
  case "$member" in
    "$archive_root/scripts/create-prototype-repo.sh") has_script=1 ;;
    "$archive_root/scripts/starter-catalog.sh") has_helper=1 ;;
    "$archive_root/starters/catalog.tsv") has_catalog=1 ;;
  esac
  if [[ "$relative" == starters/* &&
        ( "$relative" == */.git || "$relative" == */.git/* ) ]]; then
    printf 'Replica source archive contains Git metadata.\n' >&2
    exit 1
  fi
done < "$temporary/members"
if IFS= read -r <&3; then
  printf 'Replica source archive has an invalid listing.\n' >&2
  exit 1
fi
exec 3<&-
if [[ $has_script -ne 1 || $has_helper -ne 1 || $has_catalog -ne 1 ]]; then
  printf 'Replica source archive is missing the starter catalog or setup scripts.\n' >&2
  exit 1
fi

if ! tar -xzf "$archive" -C "$temporary" \
    "$archive_root/starters/catalog.tsv" "$archive_root/scripts/starter-catalog.sh" \
    "$archive_root/scripts/create-prototype-repo.sh"; then
  printf 'Could not extract the Replica setup files.\n' >&2
  exit 1
fi
if [[ ! -f "$temporary/$archive_root/scripts/create-prototype-repo.sh" ||
      -L "$temporary/$archive_root/scripts/create-prototype-repo.sh" ]]; then
  printf 'Replica source archive contains an invalid setup script.\n' >&2
  exit 1
fi
source "$temporary/$archive_root/scripts/starter-catalog.sh"
parse_starter_arguments "$@"
if [[ $show_help -eq 0 && $list_starters -eq 0 ]]; then
  read_starter_catalog "$temporary/$archive_root/starters/catalog.tsv"
  select_starter
  if ! tar -xzf "$archive" -C "$temporary" \
      "$archive_root/starters/shared" "$archive_root/$starter_directory"; then
    printf 'Could not extract the selected Replica starter and shared tooling.\n' >&2
    exit 1
  fi
fi
bash "$temporary/$archive_root/scripts/create-prototype-repo.sh" "$@"
