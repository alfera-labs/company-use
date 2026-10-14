#!/bin/bash
[ -n "${BASH_VERSION:-}" ] || exec /bin/bash "$0" "$@"
set -euo pipefail
export HOME="${HOME:-/root}" DEBIAN_FRONTEND=noninteractive

readonly install_dir='/opt/alfera'
readonly install_files="${ALFERA_INSTALL_FILES_URL:-https://raw.githubusercontent.com/alfera-labs/company-use/${ALFERA_VERSION}/deploy}"
readonly files_to_install='docker-compose.yml Caddyfile .env.selfhost.example alfera install.sh'
readonly sandbox_image='node:24-bookworm'
readonly package_manager_commands='^(/usr/bin/)?(apt|apt-get|dpkg)( |$)|/usr/bin/unattended-upgrade( |$)'
current_step='start'

say() {
  printf 'alfera bake: %s\n' "$*"
}

say_where_it_failed() {
  say "failed at $current_step"
}

step() {
  current_step="$1"
  say "$1"
  "$@"
}

wait_for_the_package_manager() {
  local waited=0
  while pgrep -f "$package_manager_commands" >/dev/null && [ "$waited" -lt 600 ]; do
    sleep 5
    waited=$((waited + 5))
  done
}

update_the_system() {
  wait_for_the_package_manager
  apt-get -qq update
  apt-get -qq -o Dpkg::Options::=--force-confold upgrade
}

install_docker() {
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker containerd
}

download_the_install_files() {
  local file
  mkdir -p "$install_dir"
  for file in $files_to_install; do
    curl -fsSL --retry 5 --retry-all-errors "$install_files/$file" -o "$install_dir/$file"
  done
  chmod 0755 "$install_dir/alfera" "$install_dir/install.sh"
}

sign_in_to_the_registry() {
  [ -n "${ALFERA_REGISTRY_USER:-}" ] && [ -n "${ALFERA_REGISTRY_TOKEN:-}" ] || return 0
  printf '%s' "$ALFERA_REGISTRY_TOKEN" | docker login ghcr.io -u "$ALFERA_REGISTRY_USER" --password-stdin
}

write_settings_to_pull_with() {
  cp "$install_dir/.env.selfhost.example" "$install_dir/.env"
  printf '%s\n' "PRODUCT_VERSION=$ALFERA_VERSION" COMPOSE_PROFILES=https POSTGRES_PASSWORD=bake RIVET_TOKEN=bake \
    COWORKER_API_PROXY_SECRET=bake WORKOS_COOKIE_PASSWORD=bake COWORKER_BROWSER_STATE_ENCRYPTION_KEY=bake \
    >>"$install_dir/.env"
}

pull_the_images() {
  write_settings_to_pull_with
  (cd "$install_dir" && docker compose pull --quiet)
  rm -f "$install_dir/.env"
  docker pull --quiet "$sandbox_image"
}

forget_the_registry_sign_in() {
  docker logout ghcr.io || true
  rm -rf /root/.docker
}

mark_the_install_as_baked() {
  printf '%s\n' "$ALFERA_VERSION" >"$install_dir/baked_version"
  chmod -R go-rwx "$install_dir"
}

clean_the_machine_identity() {
  apt-get -qq clean
  rm -f /etc/ssh/ssh_host_* /root/.bash_history /home/*/.bash_history
  rm -rf /home/ubuntu/.ssh /root/.ssh/authorized_keys
  journalctl --rotate >/dev/null 2>&1 || true
  journalctl --vacuum-time=1s >/dev/null 2>&1 || true
  find /var/log -type f -exec truncate -s 0 {} +
  cloud-init clean --logs --machine-id --seed
}

trap say_where_it_failed ERR
[ -n "${ALFERA_VERSION:-}" ] || { current_step='arguments'; false; }
step update_the_system
step install_docker
step download_the_install_files
step sign_in_to_the_registry
step pull_the_images
step forget_the_registry_sign_in
step mark_the_install_as_baked
step clean_the_machine_identity
sync
say "done $ALFERA_VERSION"
