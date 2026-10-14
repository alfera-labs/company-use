#!/bin/bash
[ -n "${BASH_VERSION:-}" ] || exec /bin/bash "$0" "$@"
set -uo pipefail
umask 077
export HOME="${HOME:-/root}"

readonly install_dir='/opt/alfera'
readonly installer_file='/root/alfera-install.sh'
readonly baked_version_file="$install_dir/baked_version"
readonly source_archive_file='/root/alfera-source.tar.gz'
readonly public_install_files="https://raw.githubusercontent.com/alfera-labs/company-use/${ALFERA_VERSION:-main}/deploy"
readonly install_files="${ALFERA_INSTALL_FILES_URL:-$public_install_files}"
readonly package_manager_commands='^(/usr/bin/)?(apt|apt-get|dpkg)( |$)|/usr/bin/unattended-upgrade( |$)'
readonly most_seconds_to_wait_for_the_package_manager=600

current_time() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

json_value_or_null() {
  if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi
}

field_of_line() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

report_body() {
  printf '{"install_id":%s,"step":%s,"state":%s,"reason":%s,"address":%s,"at":"%s"}' \
    "$(json_value_or_null "${ALFERA_INSTALL_ID:-}")" "$(json_value_or_null "$1")" \
    "$(json_value_or_null "$2")" "$(json_value_or_null "$3")" "$(json_value_or_null "$4")" "$(current_time)"
}

send_report() {
  [ -n "${ALFERA_REPORT_URL:-}" ] && [ -n "${ALFERA_REPORT_TOKEN:-}" ] || return 0
  printf 'Authorization: Bearer %s\n' "$ALFERA_REPORT_TOKEN" |
    curl -s -o /dev/null -m 10 --retry 3 --retry-all-errors -H @- -H 'content-type: application/json' \
      --data-binary "$(report_body "$@")" "$ALFERA_REPORT_URL" || true
}

report_progress_line() {
  send_report "$(field_of_line "$1" step)" "$(field_of_line "$1" state)" \
    "$(field_of_line "$1" reason)" "$(field_of_line "$1" address)"
}

stop_with() {
  printf 'first boot stopped at %s: %s\n' "$1" "$2" >&2
  send_report "$1" failed "$2" ''
  exit 1
}

hash_the_setup_token() {
  [ -n "${ALFERA_SETUP_TOKEN:-}" ] || stop_with arguments setup_token_not_usable
  ALFERA_SETUP_TOKEN_SHA256="$(printf '%s' "$ALFERA_SETUP_TOKEN" | sha256sum | cut -d' ' -f1)"
  export ALFERA_SETUP_TOKEN_SHA256
  unset ALFERA_SETUP_TOKEN
}

wait_for_the_package_manager() {
  local waited=0
  while pgrep -f "$package_manager_commands" >/dev/null 2>&1; do
    [ "$waited" -lt "$most_seconds_to_wait_for_the_package_manager" ] || return 0
    sleep 5
    waited=$((waited + 5))
  done
}

installer_in_the_archive() {
  tar -tzf "$source_archive_file" | grep -m1 -E '(^|/)deploy/install\.sh$'
}

get_the_installer_from_the_archive() {
  local member
  curl -fsSL --retry 5 --retry-all-errors "$ALFERA_SOURCE_ARCHIVE_URL" -o "$source_archive_file" || return 1
  member="$(installer_in_the_archive)"
  [ -n "$member" ] && tar -xzOf "$source_archive_file" "$member" >"$installer_file.partial" || return 1
  export PRODUCT_SOURCE_ARCHIVE="file://$source_archive_file"
}

image_was_baked_for_this_version() {
  [ -z "${ALFERA_SOURCE_ARCHIVE_URL:-}" ] && [ -f "$baked_version_file" ] &&
    [ "$(cat "$baked_version_file")" = "${ALFERA_VERSION:-}" ]
}

use_the_baked_installer() {
  cp "$install_dir/install.sh" "$installer_file" || stop_with source source_download_failed
}

get_the_installer() {
  rm -f "$installer_file" "$installer_file.partial"
  if [ -n "${ALFERA_SOURCE_ARCHIVE_URL:-}" ]; then
    get_the_installer_from_the_archive
  else
    curl -fsSL --retry 5 --retry-all-errors "$install_files/install.sh" -o "$installer_file.partial"
  fi && [ -s "$installer_file.partial" ] && mv "$installer_file.partial" "$installer_file" ||
    stop_with source source_download_failed
}

run_the_installer() {
  env -u ALFERA_REPORT_TOKEN INSTALL_DIR="$install_dir" PRODUCT_RAW_BASE="$install_files" bash "$installer_file" --unattended --progress --first-boot --install-docker --https |
    while IFS= read -r line; do
      printf '%s\n' "$line"
      report_progress_line "$line"
    done
}

hash_the_setup_token
send_report tools started '' ''
if image_was_baked_for_this_version; then
  use_the_baked_installer
else
  wait_for_the_package_manager
  get_the_installer
fi
run_the_installer
