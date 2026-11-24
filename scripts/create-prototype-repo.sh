#!/usr/bin/env bash
set -euo pipefail
unset CDPATH

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-repository-directory>\n' "$0" >&2
  exit 2
fi

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
starter="$source_root/starter"
argument="$1"
if [[ "$OSTYPE" == cygwin* || "$OSTYPE" == msys* ]]; then
  argument="$(cygpath -u -- "$argument")"
fi
name="$(basename -- "$argument")"
if [[ -z "$name" || "$name" == "." || "$name" == ".." || "$name" == "/" ]] ||
   ! parent="$(cd -- "$(dirname -- "$argument")" && pwd -P)"; then
  fail 'Destination must have an existing parent directory.'
fi
destination="${parent%/}/$name"

within() {
  local root="$1" path="$2"
  while true; do
    [[ "$path" -ef "$root" ]] && return 0
    [[ "$path" == "/" ]] && return 1
    path="${path%/*}"
    path="${path:-/}"
  done
}

internal_root="${REPLICA_INTERNAL_STARTER_ROOT:-}"
if [[ -n "$internal_root" ]] && ! internal_root="$(cd -- "$internal_root" && pwd -P)"; then
  fail 'Internal starter root must be an existing directory.'
fi
if within "$source_root" "$parent" &&
   { [[ -z "$internal_root" ]] || ! within "$internal_root" "$parent"; }; then
  fail 'Create the new repository outside the Replica checkout.'
fi
if [[ -e "$destination" || -L "$destination" ]]; then
  fail "Destination already exists: $destination"
fi
if [[ ! -d "$starter" || -L "$starter" ]]; then
  fail 'Starter skills or context templates are missing or linked.'
fi

temporary="$(mktemp -d "$parent/.replica-starter.XXXXXX")"
created=""
cleanup() {
  local status=$?
  trap '' INT TERM
  rm -rf -- "$temporary" || status=1
  if [[ -n "$created" ]]; then
    rm -rf -- "$created" || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

unsafe='[[:cntrl:]\\:<>"|?*]|[. ](/|$)'
device='(^|/)([Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][0-9]|[Ll][Pp][Tt][0-9])([./]|$)'
git_metadata='(^|/)\.[Gg][Ii][Tt](/|$)'
safe_path() {
  [[ -n "$1" && "$1" != /* && "$1" != */ && "$1" != *//* &&
     ! "$1" =~ $unsafe && ! "$1" =~ $device && ! "$1" =~ $git_metadata ]]
}

files="$temporary/files"
mkdir -- "$files"
count=0
copy_file() {
  local path="$1" source="$starter/$1" directory="$1"
  safe_path "$path" || fail "Unsupported starter entry: $path"
  while [[ "$directory" == */* ]]; do
    directory="${directory%/*}"
    if [[ -L "$starter/$directory" || ! -d "$starter/$directory" ]]; then
      fail "Linked starter directory or missing directory: $directory"
    fi
  done
  if [[ ! -f "$source" || -L "$source" ]]; then
    fail "Starter file is missing or is not a regular file: $source"
  fi
  if [[ "$path" == */* ]]; then
    mkdir -p -- "$files/${path%/*}"
  fi
  cp -p -- "$source" "$files/$path"
  ((count += 1))
}

# Git for Windows and Git Bash can spell the same checkout C:/... and /c/....
if checkout="$(git -C "$source_root" rev-parse --show-toplevel 2>/dev/null)" &&
   [[ "$checkout" -ef "$source_root" ]]; then
  git -C "$source_root" ls-files --cached --stage -z -- starter/ > "$temporary/manifest"
  while IFS= read -r -d '' entry; do
    metadata="${entry%%$'\t'*}"
    path="${entry#*$'\t'}"
    mode="${metadata%% *}"
    stage="${metadata##* }"
    if [[ ( "$mode" != 100644 && "$mode" != 100755 ) || "$stage" != 0 ||
          "$path" != starter/* ]]; then
      fail "Unsupported starter entry: $path"
    fi
    copy_file "${path#starter/}"
  done < "$temporary/manifest"
else
  if [[ -e "$source_root/.git" || -L "$source_root/.git" ]]; then
    fail 'Could not inspect the Replica checkout with Git.'
  fi
  find "$starter" -mindepth 1 -print0 > "$temporary/manifest"
  while IFS= read -r -d '' file; do
    path="${file#"$starter/"}"
    safe_path "$path" || fail "Starter archive contains Git metadata or an unsafe path: $path"
    if [[ -L "$file" || ( ! -d "$file" && ! -f "$file" ) ]]; then
      fail "Starter archive contains an unsupported file: $path"
    fi
    if [[ -f "$file" ]]; then
      copy_file "$path"
    fi
  done < "$temporary/manifest"
fi

if [[ ! -f "$files/.agents/skills/setup-skills/SKILL.md" ||
      ! -f "$files/.agents/context-templates/SKILL.md" ]]; then
  fail 'Starter skills or context templates are missing or linked.'
fi

git init -q --initial-branch=main "$files"
if ! git -C "$files" add --force --all -- . ||
   ! git -C "$files" commit -q -m 'chore: initialize prototype' \
     -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'; then
  fail 'Could not create the initial commit. Check the Git error above, then configure your Git identity or resolve signing or hook failures before retrying.'
fi

# Defer an interrupt until we know whether this process owns the destination.
interrupted=0
trap 'interrupted=130' INT
trap 'interrupted=143' TERM
mkdir -- "$destination"
created="$destination"
trap 'exit 130' INT
trap 'exit 143' TERM
((interrupted == 0)) || exit "$interrupted"
cp -Rp -- "$files/." "$destination/"
created=""

printf 'Created %s with %s starter files committed on main in a new Git repository.\n' "$destination" "$count"
printf 'Start a new agent session in that directory and run /setup-skills.\n'
