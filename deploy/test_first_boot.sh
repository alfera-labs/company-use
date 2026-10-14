#!/usr/bin/env bash
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/first_boot.sh"
lightsail_template="$here/aws/alfera-lightsail.yaml"
ec2_template="$here/aws/alfera-ec2.yaml"
failed=0
readonly most_bytes_of_user_data=16384
readonly contract_names='ALFERA_INSTALL_ID ALFERA_SETUP_TOKEN ALFERA_REPORT_TOKEN ALFERA_REPORT_URL ALFERA_NAME ALFERA_VERSION ALFERA_REGISTRY_USER ALFERA_REGISTRY_TOKEN ALFERA_SOURCE_ARCHIVE_URL ALFERA_INSTALL_FILES_URL'
readonly page_regions='eu-central-1 us-east-1 ap-southeast-1 ap-southeast-2'

check() {
  if [ "$2" = "$3" ]; then
    printf 'ok    %s\n' "$1"
  else
    printf 'FAIL  %s: wanted %s, got %s\n' "$1" "$2" "$3"
    failed=1
  fi
}

longest_header() {
  local name
  printf '#!/bin/bash\n'
  for name in $contract_names ALFERA_PUBLIC_ADDRESS; do
    printf "export %s='%s'\n" "$name" "$(head -c 300 /dev/zero | tr '\0' 'x')"
  done
}

user_data_bytes() {
  { longest_header; tail -n +2 "$script"; } | wc -c | tr -d ' '
}

body_in_the_template() {
  awk '/^ *- \|$/ { on = 1; match($0, /^ */); pad = RLENGTH + 2; next }
    on && /^  [A-Za-z]+:$/ { exit }
    on { print (length($0) > pad ? substr($0, pad + 1) : "") }' "$1" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

template_written_from_the_script() {
  "$here/aws/write_template.sh" "$(basename "$1")" /dev/stdout
}

exported_names_in_the_template() {
  sed -n "s/^ *- \"export \([A-Z_]*\)='\"$/\1/p" "$1" | paste -sd' ' -
}

fake_curl_that_prints_its_addresses() {
  printf '#!/bin/bash\nfor value in "$@"; do case "$value" in http*) printf "%%s\\n" "$value";; esac; done\nexit 22\n' >"$1/curl"
  chmod +x "$1/curl"
}

address_first_boot_asks_for_install_sh() {
  local fake_tools
  fake_tools="$(mktemp -d)"
  fake_curl_that_prints_its_addresses "$fake_tools"
  env -i PATH="$fake_tools:$PATH" HOME="$fake_tools" ALFERA_SETUP_TOKEN=token ALFERA_VERSION=v1.2.3 "$@" \
    bash "$script" 2>/dev/null | head -1
  rm -rf "$fake_tools"
}

address_asked_when_lightsail_runs_it_with_sh() {
  local fake_tools
  fake_tools="$(mktemp -d)"
  fake_curl_that_prints_its_addresses "$fake_tools"
  { printf '#!/bin/sh\necho a launch step of the cloud\n'; cat "$script"; } >"$fake_tools/part-001"
  env -i PATH="$fake_tools:$PATH" HOME="$fake_tools" ALFERA_SETUP_TOKEN=token ALFERA_VERSION=v1.2.3 \
    dash "$fake_tools/part-001" 2>/dev/null | grep -m1 '^https'
  rm -rf "$fake_tools"
}

what_first_boot_does_on_a_baked_image() {
  local machine
  machine="$(mktemp -d)"
  mkdir -p "$machine/opt/alfera" "$machine/root" "$machine/tools"
  fake_curl_that_prints_its_addresses "$machine/tools"
  printf '#!/bin/bash\ntouch "%s/asked_the_package_manager"\nexit 1\n' "$machine" >"$machine/tools/pgrep"
  chmod +x "$machine/tools/pgrep"
  printf 'v1.2.3\n' >"$machine/opt/alfera/baked_version"
  printf 'echo "baked installer $INSTALL_DIR $*"\n' >"$machine/opt/alfera/install.sh"
  sed -e "s#'/opt/alfera'#'$machine/opt/alfera'#" -e "s#'/root/#'$machine/root/#" "$script" >"$machine/first_boot.sh"
  env -i PATH="$machine/tools:$PATH" HOME="$machine" ALFERA_SETUP_TOKEN=token "$@" \
    bash "$machine/first_boot.sh" 2>/dev/null | sed "s#$machine#<machine>#g" | head -1
  [ -f "$machine/asked_the_package_manager" ] && echo 'waited for the package manager'
  rm -rf "$machine"
}

check 'first_boot.sh is bash that parses' 0 "$(bash -n "$script" >/dev/null 2>&1; echo $?)"
check 'its first line is the one cloud-init needs to run it' '#!/bin/bash' "$(head -1 "$script")"
check 'with eleven values of 300 characters at the top it stays under 16 KB' yes \
  "$([ "$(user_data_bytes)" -lt "$most_bytes_of_user_data" ] && echo yes || echo no)"
check 'it never names a value it does not read from the contract' '' \
  "$(grep -o 'ALFERA_[A-Z0-9_]*' "$script" | sort -u | grep -vxE "$(printf '%s' "$contract_names" | tr ' ' '|')|ALFERA_SETUP_TOKEN_SHA256" | paste -sd' ' -)"
check 'without ALFERA_INSTALL_FILES_URL it gets install.sh from the public repository' \
  'https://raw.githubusercontent.com/alfera-labs/company-use/v1.2.3/deploy/install.sh' "$(address_first_boot_asks_for_install_sh)"
check 'with ALFERA_INSTALL_FILES_URL it gets install.sh from there' \
  'https://files.example/deploy/install.sh' "$(address_first_boot_asks_for_install_sh ALFERA_INSTALL_FILES_URL=https://files.example/deploy)"
check 'on an image baked for its version it runs the baked installer, downloads nothing and waits for no package manager' \
  'baked installer <machine>/opt/alfera --unattended --progress --first-boot --install-docker --https' \
  "$(what_first_boot_does_on_a_baked_image ALFERA_VERSION=v1.2.3)"
check 'on an image baked for another version it downloads install.sh of its own version' \
  "https://raw.githubusercontent.com/alfera-labs/company-use/v2.0.0/deploy/install.sh
waited for the package manager" \
  "$(what_first_boot_does_on_a_baked_image ALFERA_VERSION=v2.0.0)"
check 'on a baked image with ALFERA_SOURCE_ARCHIVE_URL it downloads that source' \
  'https://files.example/source.tar.gz
waited for the package manager' \
  "$(what_first_boot_does_on_a_baked_image ALFERA_VERSION=v1.2.3 ALFERA_SOURCE_ARCHIVE_URL=https://files.example/source.tar.gz)"
package_manager_commands_that_match() {
  local pattern
  pattern="$(sed -n "s/^readonly package_manager_commands='\(.*\)'$/\1/p" "$script")"
  printf '%s\n' "$@" | grep -E "$pattern" | paste -sd'|' -
}

check 'it waits for apt, dpkg and an upgrade at work, and not for the upgrade helper that runs all the time' \
  'apt-get -y -qq install docker-ce|/usr/bin/dpkg --status-fd 35 --configure|/usr/bin/python3 /usr/bin/unattended-upgrade' \
  "$(package_manager_commands_that_match 'apt-get -y -qq install docker-ce' '/usr/bin/dpkg --status-fd 35 --configure' \
    '/usr/bin/python3 /usr/bin/unattended-upgrade' \
    '/usr/bin/python3 /usr/share/unattended-upgrades/unattended-upgrade-shutdown --wait-for-signal' \
    '/bin/sh /usr/lib/apt/apt.systemd.daily update' 'apt-config shell StateDir Dir::State')"
if command -v dash >/dev/null 2>&1; then
  check 'after a /bin/sh launch step, as on Lightsail, it still runs in bash' \
    'https://raw.githubusercontent.com/alfera-labs/company-use/v1.2.3/deploy/install.sh' "$(address_asked_when_lightsail_runs_it_with_sh)"
else
  echo 'skip  dash is not on this machine'
fi

check_template() {
  local template="$1" kind="$2" names="$3" hidden_parameters
  check "the $kind template sets every value it gives, in order" "$names" "$(exported_names_in_the_template "$template")"
  check "the $kind template runs first_boot.sh as it is" "$(tail -n +2 "$script")" "$(body_in_the_template "$template")"
  check "the $kind template is what aws/write_template.sh writes" "$(cat "$template")" "$(template_written_from_the_script "$template")"
  check "the $kind template opens ports 80 and 443 and no other" '80 443' \
    "$(sed -n 's/^ *- FromPort: \([0-9]*\)$/\1/p' "$template" | sort -un | paste -sd' ' -)"
  hidden_parameters="$(awk '/^  [A-Za-z]+:$/ { name = $1 } /^    NoEcho: true$/ { sub(":", "", name); print name }' "$template" | paste -sd' ' -)"
  check "the $kind template hides the registry token, which a quick-create link never fills" 'RegistryToken' "$hidden_parameters"
  check "the $kind template shows SetupToken and ReportToken, so a quick-create link can fill them" 0 \
    "$(printf '%s\n' "$hidden_parameters" | tr ' ' '\n' | grep -c -x -e SetupToken -e ReportToken)"
  check "the $kind template makes no IAM resource" 0 "$(grep -c 'AWS::IAM::' "$template")"
  if command -v cfn-lint >/dev/null 2>&1; then
    check "cfn-lint finds nothing in the $kind template" 0 "$(cfn-lint "$template" >/dev/null 2>&1; echo $?)"
  else
    echo 'skip  cfn-lint is not on this machine'
  fi
}

regions_with_an_image() {
  awk '/^  ServerImage:$/ { on = 1; next } on && /^    [a-z0-9-]+:$/ { sub(":", "", $1); print $1; next }
    on && !/^      / { exit }' "$ec2_template" | sort | paste -sd' ' -
}

check_template "$lightsail_template" Lightsail "$contract_names"
check_template "$ec2_template" EC2 "$contract_names ALFERA_PUBLIC_ADDRESS"
check 'the EC2 template gives the address it reserved, so the server knows it at once' \
  '!Ref Address' "$(grep -A1 "export ALFERA_PUBLIC_ADDRESS='" "$ec2_template" | sed -n '2s/^ *- //p')"
check 'the EC2 template has an image in each region the deploy page picks' \
  "$(printf '%s\n' $page_regions | sort | paste -sd' ' -)" "$(regions_with_an_image)"

exit "$failed"
