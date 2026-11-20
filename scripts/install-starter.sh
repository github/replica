#!/usr/bin/env bash
set -euo pipefail
unset CDPATH
unset TAR_OPTIONS

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <new-repository-directory>\n' "$0" >&2
  exit 2
fi

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

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
if [[ -e "$destination" || -L "$destination" ]]; then
  fail "Destination already exists: $destination"
fi

temporary="$(mktemp -d "$(pwd -P)/.replica-download.XXXXXX")"
active=""
cleanup() {
  local status=$?
  trap '' INT TERM
  if [[ -n "$active" ]]; then
    kill -TERM "$active" 2>/dev/null || true
    wait "$active" 2>/dev/null || true
  fi
  rm -rf -- "$temporary" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_and_wait() {
  local status=0
  "$@" &
  active=$!
  wait "$active" || status=$?
  active=""
  return "$status"
}

cd -- "$temporary"
archive="replica.tar.gz"
if ! run_and_wait curl -q -fLSs --output "$archive" \
    'https://github.com/github/replica/archive/refs/heads/main.tar.gz'; then
  fail 'Could not download the Replica source archive. Check your network connection and access to GitHub, then try again.'
fi

# Relative archive names keep GNU tar from interpreting a Windows drive as a host.
if ! tar -tzf "$archive" > members || ! tar -tvzf "$archive" > types; then
  fail 'Could not read the Replica source archive.'
fi
if [[ "$(wc -l < members)" != "$(wc -l < types)" ]]; then
  fail 'Replica source archive has an invalid listing.'
fi

root="replica-main"
script="scripts/create-prototype-repo.sh"
unsafe='[[:cntrl:]\\:<>"|?*]|[. ](/|$)'
device='(^|/)([Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][0-9]|[Ll][Pp][Tt][0-9])([./]|$)'
git_metadata='(^|/)\.[Gg][Ii][Tt](/|$)'
has_script=0
has_skills=0
has_templates=0
: > selected
while IFS= read -r member; do
  IFS= read -r type <&3 || fail 'Replica source archive has an invalid listing.'
  if [[ "$member" == "$root/" ]]; then
    path=""
  else
    path="${member#"$root/"}"
    path="${path%/}"
    if [[ "$member" != "$root/"* || -z "$path" ||
          "$path" == /* || "$path" == */ || "$path" == *//* ||
          "$path" =~ $unsafe || "$path" =~ $device ]]; then
      fail "Replica source archive contains an unsafe path: $member"
    fi
  fi
  if [[ "$path" == starter/* && "$path" =~ $git_metadata ]]; then
    fail 'Replica source archive contains Git metadata.'
  fi
  case "$path" in
    ""|starter|starter/*|scripts|"$script")
      expected="-"
      if [[ "$member" == */ ]]; then
        expected="d"
      fi
      if [[ "${type:0:1}" != "$expected" ]]; then
        fail "Replica source archive contains a linked or unsupported file: $member"
      fi
      printf '%s\n' "$path" >> selected
      ;;
  esac
  case "$path" in
    "$script") has_script=1 ;;
    starter/.agents/skills/setup-skills/SKILL.md) has_skills=1 ;;
    starter/.agents/context-templates/SKILL.md) has_templates=1 ;;
  esac
done < members 3< types

duplicates="$(sort -f selected | uniq -id)"
if [[ -n "$duplicates" ]]; then
  fail 'Replica source archive contains a duplicate path.'
fi
if (( ! has_script || ! has_skills || ! has_templates )); then
  fail 'Replica source archive is missing the starter or setup script.'
fi
tar -xzf "$archive" -- "$root/starter" "$root/$script"
if [[ ! -f "$root/$script" || -L "$root/$script" ]]; then
  fail 'Replica source archive is missing the starter or setup script.'
fi

run_and_wait "$BASH" "$root/$script" "$destination"
