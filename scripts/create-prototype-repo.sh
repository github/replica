#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-repository-directory>\n' "$0" >&2
  exit 2
fi

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
starter="$source_root/starter"
parent="$(dirname "$1")"
name="$(basename "$1")"

if [[ ! -d "$parent" || "$name" == "." || "$name" == ".." || "$name" == "/" ]]; then
  printf 'Destination must have an existing parent directory.\n' >&2
  exit 1
fi

parent="$(cd "$parent" && pwd -P)"
destination="$parent/$name"
internal_root="${REPLICA_INTERNAL_STARTER_ROOT:-}"
if [[ -n "$internal_root" ]]; then
  if [[ ! -d "$internal_root" ]]; then
    printf 'Internal starter root must be an existing directory.\n' >&2
    exit 1
  fi
  internal_root="$(cd "$internal_root" && pwd -P)"
fi
if [[ ( "$parent" == "$source_root" || "$parent" == "$source_root/"* ) &&
      ( -z "$internal_root" ||
        ( "$parent" != "$internal_root" && "$parent" != "$internal_root/"* ) ) ]]; then
  printf 'Create the new repository outside the Replica checkout.\n' >&2
  exit 1
fi
if [[ -e "$destination" || -L "$destination" ]]; then
  printf 'Destination already exists: %s\n' "$destination" >&2
  exit 1
fi
if [[ -L "$starter" ||
      ! -f "$starter/.agents/skills/setup-skills/SKILL.md" ||
      ! -f "$starter/.agents/context-templates/SKILL.md" ||
      -L "$starter/.agents/skills/setup-skills/SKILL.md" ||
      -L "$starter/.agents/context-templates/SKILL.md" ]]; then
  printf 'Starter skills or context templates are missing or linked.\n' >&2
  exit 1
fi

temporary="$(mktemp -d "$parent/.replica-starter.XXXXXX")"
created=""
cleanup() {
  rm -r -- "$temporary"
  if [[ -n "$created" ]]; then
    rm -r -- "$created"
  fi
}
trap cleanup EXIT

mkdir -- "$temporary/files"
count=0
copy_file() {
  local source="$1" relative="$2"
  if [[ ! -f "$source" || -L "$source" ]]; then
    printf 'Starter file is missing or is not a regular file: %s\n' "$source" >&2
    exit 1
  fi
  mkdir -p -- "$temporary/files/$(dirname "$relative")"
  cp -p -- "$source" "$temporary/files/$relative"
  ((count += 1))
}

if [[ "$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null || true)" == "$source_root" ]]; then
  git -C "$source_root" ls-files --cached --stage -z -- starter/ > "$temporary/manifest"
  while IFS= read -r -d '' entry; do
    metadata="${entry%%$'\t'*}"
    path="${entry#*$'\t'}"
    mode="${metadata%% *}"
    stage="${metadata##* }"
    if [[ ( "$mode" != 100644 && "$mode" != 100755 ) || "$stage" != 0 ||
          "$path" != starter/* || "$path" == */../* || "$path" == */./* ||
          "$path" == */.git/* || "$path" == starter/.git ]]; then
      printf 'Unsupported starter entry: %s\n' "$path" >&2
      exit 1
    fi

    directory="${path%/*}"
    while [[ "$directory" != starter ]]; do
      if [[ -L "$source_root/$directory" ]]; then
        printf 'Linked starter directory: %s\n' "$directory" >&2
        exit 1
      fi
      directory="${directory%/*}"
    done
    copy_file "$source_root/$path" "${path#starter/}"
  done < "$temporary/manifest"
else
  unsupported="$(find "$starter" ! -type d ! -type f -print -quit)"
  if [[ -n "$unsupported" ]]; then
    printf 'Starter archive contains an unsupported file: %s\n' "$unsupported" >&2
    exit 1
  fi
  if [[ -e "$starter/.git" || -L "$starter/.git" ]]; then
    printf 'Starter archive contains Git metadata.\n' >&2
    exit 1
  fi
  while IFS= read -r -d '' path; do
    copy_file "$path" "${path#"$starter/"}"
  done < <(find "$starter" -type f -print0)
fi

if [[ $count -eq 0 ]]; then
  printf 'No starter files found in %s\n' "$source_root" >&2
  exit 1
fi

git init -q --initial-branch=main "$temporary/files"
mkdir -- "$destination"
created="$destination"
cp -Rp -- "$temporary/files/." "$destination/"
created=""

printf 'Created %s with %s starter files and a new, uncommitted Git repository.\n' "$destination" "$count"
printf 'Start a new agent session in that directory and run /setup-skills.\n'
