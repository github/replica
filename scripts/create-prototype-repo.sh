#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$source_root/scripts/starter-catalog.sh"
parse_starter_arguments "$@"
if [[ $show_help -eq 1 ]]; then
  starter_usage
  exit 0
fi
read_starter_catalog "$source_root/starters/catalog.tsv"
if [[ $list_starters -eq 1 ]]; then
  print_starter_catalog
  exit 0
fi
select_starter
if [[ -z "$destination_argument" ]]; then
  starter_usage >&2
  exit 2
fi
parent="$(dirname -- "$destination_argument")"
name="$(basename -- "$destination_argument")"

if [[ ! -d "$parent" || "$name" == "." || "$name" == ".." || "$name" == "/" ]]; then
  printf 'Destination must have an existing parent directory.\n' >&2
  exit 1
fi

parent="$(cd "$parent" && pwd -P)"
destination="$parent/$name"
if [[ "$parent" == "$source_root" || "$parent" == "$source_root/"* ]]; then
  printf 'Create the new repository outside the Replica checkout.\n' >&2
  exit 1
fi
if [[ -e "$destination" || -L "$destination" ]]; then
  printf 'Destination already exists: %s\n' "$destination" >&2
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
  if [[ -e "$temporary/files/$relative" || -L "$temporary/files/$relative" ]]; then
    printf 'Starter file collision: %s\n' "$relative" >&2
    exit 1
  fi
  local directory="${relative%/*}"
  while [[ "$directory" != "$relative" && "$directory" != "." ]]; do
    if [[ -f "$temporary/files/$directory" ]]; then
      printf 'Starter file collision: %s\n' "$relative" >&2
      exit 1
    fi
    [[ "$directory" != */* ]] && break
    directory="${directory%/*}"
  done
  mkdir -p -- "$temporary/files/$(dirname "$relative")"
  cp -p -- "$source" "$temporary/files/$relative"
  ((count += 1))
}

checkout_root="$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "$checkout_root" ]]; then
  checkout_root="$(cd "$checkout_root" && pwd -P)"
fi
for bundle in starters/shared "$starter_directory"; do
  starter="$source_root/$bundle"
  if [[ ! -d "$starter" || -L "$starter" ]]; then
    printf 'Starter directory is missing or linked: %s\n' "$bundle" >&2
    exit 1
  fi
  if [[ "$checkout_root" == "$source_root" ]]; then
    git -C "$source_root" ls-files --cached --stage -z -- "$bundle/" > "$temporary/manifest"
    while IFS= read -r -d '' entry; do
      metadata="${entry%%$'\t'*}"
      path="${entry#*$'\t'}"
      mode="${metadata%% *}"
      stage="${metadata##* }"
      if [[ ( "$mode" != 100644 && "$mode" != 100755 ) || "$stage" != 0 ||
            "$path" != "$bundle/"* || "$path" == */../* || "$path" == */./* ||
            "$path" == */.git/* || "$path" == */.git ]]; then
        printf 'Unsupported starter entry: %s\n' "$path" >&2
        exit 1
      fi

      directory="${path%/*}"
      while [[ "$directory" != "$bundle" ]]; do
        if [[ -L "$source_root/$directory" ]]; then
          printf 'Linked starter directory: %s\n' "$directory" >&2
          exit 1
        fi
        directory="${directory%/*}"
      done
      copy_file "$source_root/$path" "${path#"$bundle/"}"
    done < "$temporary/manifest"
  else
    unsupported="$(find "$starter" ! -type d ! -type f -print -quit)"
    if [[ -n "$unsupported" ]]; then
      printf 'Starter archive contains an unsupported file: %s\n' "$unsupported" >&2
      exit 1
    fi
    metadata="$(find "$starter" -name .git -print -quit)"
    if [[ -n "$metadata" ]]; then
      printf 'Starter archive contains Git metadata.\n' >&2
      exit 1
    fi
    while IFS= read -r -d '' path; do
      copy_file "$path" "${path#"$starter/"}"
    done < <(find "$starter" -type f -print0)
  fi
done
if [[ ! -f "$temporary/files/.agents/skills/setup-skills/SKILL.md" ||
      ! -f "$temporary/files/.agents/context-templates/SKILL.md" ]]; then
  printf 'Starter skills or context templates are missing or linked.\n' >&2
  exit 1
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

printf 'Created %s from %s (%s) with %s files and a new, uncommitted Git repository.\n' "$destination" "$starter_name" "$starter_id" "$count"
printf 'Start a new agent session in that directory. Follow AGENTS.md and README.md to run the included app.\n'
