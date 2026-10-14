#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/../first_boot.sh"
images="$here/server_images.txt"

template_with_the_script() {
  awk -v script="$script" '
    !in_body { print }
    /^ *- \|$/ && !in_body {
      in_body = 1
      match($0, /^ */)
      pad = sprintf("%" (RLENGTH + 2) "s", "")
      while ((getline line < script) > 0) {
        if (++script_line == 1) continue
        print (line == "" ? "" : pad line)
      }
      print ""
      next
    }
    in_body && /^  [A-Za-z]+:$/ { in_body = 0; print }
  ' "$1"
}

image_rows() {
  sort "$images" | awk '
    $1 != region { region = $1; printf "    %s:\n", region }
    { printf "      %s: %s\n", $2, $3 }
  '
}

template_with_the_images() {
  [ -f "$images" ] || { cat; return; }
  ROWS="$(image_rows)" awk '
    /^  ServerImage:$/ { print; print ENVIRON["ROWS"]; skipping = 1; next }
    skipping && /^    / { next }
    { skipping = 0; print }
  '
}

write() {
  local template="$here/$1" output="${2:-$here/$1}" generated
  generated="$(template_with_the_script "$template" | template_with_the_images)"
  printf '%s\n' "$generated" >"$output"
}

case "${1:-}" in
  '') write alfera-lightsail.yaml && write alfera-ec2.yaml ;;
  alfera-lightsail.yaml | alfera-ec2.yaml) write "$1" "${2:-}" ;;
  *) echo 'use: deploy/aws/write_template.sh [alfera-lightsail.yaml|alfera-ec2.yaml [output]]' >&2; exit 2 ;;
esac
