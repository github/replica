#!/usr/bin/env bash

starter_usage() {
  printf 'Usage: %s [--starter <id>] [--preset <preset>] [--interactive] <new-repository-directory>\n       %s --list\n' "$0" "$0"
  printf '\n--preset configures a generated starter. Omit it to use that starter'\''s default.\n'
  printf '%s\n' '--interactive asks for generation choices in a terminal.'
}

parse_starter_arguments() {
  starter_id=minimal
  list_starters=0
  show_help=0
  preset=""
  interactive=0
  destination_argument=""
  local selected=0 preset_selected=0 positional=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --help|-h) show_help=1; shift ;;
      --list) list_starters=1; shift ;;
      --starter)
        if [[ $# -lt 2 || $selected -eq 1 || ! "$2" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
          printf 'Provide one starter ID after --starter. Use --list to see available starters.\n' >&2
          return 2
        fi
        starter_id="$2"
        selected=1
        shift 2
        ;;
      --preset)
        if [[ $# -lt 2 || $preset_selected -eq 1 ||
              ! "$2" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$ ]]; then
          printf 'Provide one preset code or name after --preset, using letters, digits and hyphens.\n' >&2
          return 2
        fi
        preset="$2"
        preset_selected=1
        shift 2
        ;;
      --interactive)
        if [[ $interactive -eq 1 ]]; then
          printf 'Provide --interactive only once.\n' >&2
          return 2
        fi
        interactive=1
        shift
        ;;
      --) shift; positional=1; break ;;
      -*)
        printf 'Unknown option: %s\n' "$1" >&2
        return 2
        ;;
      *)
        if [[ -n "$destination_argument" || -z "$1" ]]; then
          starter_usage >&2
          return 2
        fi
        destination_argument="$1"
        shift
        ;;
    esac
  done
  if [[ $positional -eq 1 ]]; then
    if [[ $# -ne 1 || -n "$destination_argument" || -z "$1" ]]; then
      starter_usage >&2
      return 2
    fi
    destination_argument="$1"
  fi
  if [[ $show_help -eq 0 &&
        ( ( $list_starters -eq 1 && ( -n "$destination_argument" || $preset_selected -eq 1 || $interactive -eq 1 ) ) ||
          ( $list_starters -eq 0 && -z "$destination_argument" && $selected -eq 0 ) ) ]]; then
    starter_usage >&2
    return 2
  fi
}

read_starter_catalog() {
  local catalog="$1" line id directory name description extra
  local ids="" directories="" tab=$'\t'
  starter_ids=()
  starter_directories=()
  starter_names=()
  starter_descriptions=()
  if [[ ! -f "$catalog" || -L "$catalog" || -L "$(dirname "$catalog")" ]]; then
    printf 'Starter catalog is missing or linked: %s\n' "$catalog" >&2
    return 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    IFS=$'\t' read -r id directory name description extra <<< "$line"
    if [[ ! "$id" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ||
          ! "$directory" =~ ^starters/[a-z0-9]+(-[a-z0-9]+)*$ || "$directory" == starters/shared ||
          -z "$name" || -z "$description" || -n "$extra" ||
          "$line" == "$tab"* || "$line" == *"$tab" || "$line" == *"$tab$tab"* ||
          "$line" == *$'\r'* || "$ids" == *" $id "* || "$directories" == *" $directory "* ]]; then
      printf 'Invalid or duplicate starter catalog entry: %s\n' "$line" >&2
      return 1
    fi
    ids="$ids $id "
    directories="$directories $directory "
    starter_ids+=("$id")
    starter_directories+=("$directory")
    starter_names+=("$name")
    starter_descriptions+=("$description")
  done < "$catalog"
  if [[ ${#starter_ids[@]} -eq 0 ]]; then
    printf 'Starter catalog has no entries.\n' >&2
    return 1
  fi
}

select_starter() {
  local index
  for ((index = 0; index < ${#starter_ids[@]}; index++)); do
    if [[ "${starter_ids[$index]}" == "$starter_id" ]]; then
      starter_directory="${starter_directories[$index]}"
      starter_name="${starter_names[$index]}"
      return 0
    fi
  done
  printf 'Unknown starter: %s. Use --list to see available starters.\n' "$starter_id" >&2
  return 1
}

print_starter_catalog() {
  local index
  for ((index = 0; index < ${#starter_ids[@]}; index++)); do
    printf '%s\t%s\t%s\n' "${starter_ids[$index]}" "${starter_names[$index]}" "${starter_descriptions[$index]}"
  done
}
