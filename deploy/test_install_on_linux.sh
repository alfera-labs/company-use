#!/usr/bin/env bash
# Installs Alfera on a fresh Linux machine the way a new server gets it, and checks the result.
#
# It needs OrbStack on a Mac (`orb`). It makes an Ubuntu 24.04 machine, installs Docker with the
# official script, serves this source tree to the machine in place of the code host, and runs
# install.sh there with no person and with progress lines. It cuts the connection while an
# image builds, then kills the install outright, and runs the same command again, which must
# end well. Then it runs the installer
# once more, signs in as the owner with curl, makes one API call as the owner, has the worker start a
# sandbox, runs `./alfera doctor`, measures, and deletes the machine. It exits 0 only when every
# step passed, and names the step that failed otherwise.
#
# The install is served over https, with a certificate Caddy signs itself: no certificate
# authority can reach a machine on a laptop. --plain installs on plain http instead.
# --keep leaves the machine up when the run ends, to look at it: orb run -m <name> -u root bash
#
# It uses no model key: the install gets a stand-in, so no chat is run, and the one thing the
# doctor may report is that key. Export ANTHROPIC_API_KEY, OPENAI_API_KEY or
# VERCEL_AI_GATEWAY_API_KEY to install with a real key; the doctor must then report nothing.
set -uo pipefail

architecture="${1:-}"
case "$architecture" in
  arm64 | amd64) shift ;;
  *) echo 'use: deploy/test_install_on_linux.sh <arm64|amd64> [--plain] [--first-boot] [--keep]' >&2; exit 2 ;;
esac
serves_https='yes'
keeps_machine='no'
first_boot='no'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --plain) serves_https='no' ;;
    --keep) keeps_machine='yes' ;;
    --first-boot) first_boot='yes' ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

source_root="$(cd "$(dirname "$0")/.." && pwd)"
machine="alfera-install-test-$architecture"
install_dir='/opt/alfera/source/deploy'
# Not 3000 and 3001: OrbStack shows a port of a machine on the Mac too, where they may be taken.
app_port=3360
api_port=3361
work="$(mktemp -d)"
failed_step=''
report=''

model_answer='VERCEL_AI_GATEWAY_API_KEY=vck_stand_in_for_the_install_test'
has_real_key='no'
for key_name in ANTHROPIC_API_KEY OPENAI_API_KEY VERCEL_AI_GATEWAY_API_KEY; do
  if [ -n "${!key_name:-}" ]; then
    model_answer="$key_name=${!key_name}"
    has_real_key='yes'
    break
  fi
done

# in_machine <script> [<argument>...]: runs the script in the machine as root. Stdin goes
# through, so a key is on no command line.
in_machine() {
  local script="$1"
  shift
  orb run -m "$machine" -u root bash -c "$script" _ "$@"
}

say() {
  printf '%s\n' "$*"
}

# step <name> <function>: runs it once, and notes how long it took. After a step fails, the
# later ones are skipped.
step() {
  local name="$1" started="$SECONDS" seconds
  [ -z "$failed_step" ] || return 0
  say ''
  say "== $name"
  if "$2"; then
    seconds=$((SECONDS - started))
    say "ok ($seconds s)"
    report="$report$(printf '%-34s %5s s' "$name" "$seconds")"$'\n'
  else
    failed_step="$name"
  fi
}

# check <what> <wanted> <got>
check() {
  if [ "$2" = "$3" ]; then
    say "  ok    $1 ($3)"
  else
    say "  FAIL  $1: wanted $2, got $3"
    return 1
  fi
}

create_machine() {
  if orb list 2>/dev/null | awk '{ print $1 }' | grep -qx "$machine"; then
    say "a machine named $machine is already there. Delete it first: orb delete -f $machine"
    return 1
  fi
  orb create --arch "$architecture" ubuntu:noble "$machine" || return 1
  check 'the machine has the processor asked for' "$architecture" \
    "$(in_machine 'dpkg --print-architecture')"
}

# An amd64 machine on an Arm Mac is emulated, and systemd there cannot put a container in its
# control group, so no container starts. Docker is told to do that itself. A real amd64 server
# needs no such setting, and gets none from the installer.
let_docker_place_containers_itself() {
  [ "$architecture" = 'amd64' ] && [ "$(uname -m)" = 'arm64' ] || return 0
  say '  this amd64 machine is emulated: Docker gets the cgroupfs driver, which a real server does not need'
  in_machine 'mkdir -p /etc/docker && printf "{\"exec-opts\":[\"native.cgroupdriver=cgroupfs\"]}\n" >/etc/docker/daemon.json'
}

# What a new server has: Docker from the official script, and nothing else of ours.
install_docker() {
  let_docker_place_containers_itself || return 1
  in_machine 'curl -fsSL https://get.docker.com | sh' >"$work/docker_install.log" 2>&1 ||
    { tail -20 "$work/docker_install.log"; return 1; }
  say "  Docker $(in_machine 'docker version --format "{{.Server.Version}}"'), $(in_machine 'docker compose version --short') compose"
}

# The source goes to the machine as one archive, and a web server on the machine hands it out.
# So the installer downloads its source from an address, as it does from the code host.
serve_source() {
  COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C "$source_root" --exclude node_modules --exclude .git \
    --exclude .turbo --exclude .output --exclude 'deploy/.env' --exclude 'deploy/workspaces' . |
    in_machine 'mkdir -p /srv/alfera-source && cat >/srv/alfera-source/alfera.tar.gz' || return 1
  in_machine '
    cd /srv/alfera-source && tar -xzf alfera.tar.gz --strip-components=2 ./deploy/install.sh &&
    systemd-run --quiet --unit alfera-test-source python3 -m http.server 8099 --bind 127.0.0.1 --directory /srv/alfera-source &&
    sleep 1 && curl -fsS -o /dev/null http://127.0.0.1:8099/install.sh' || return 1
  say "  the archive is $(in_machine 'du -h /srv/alfera-source/alfera.tar.gz | cut -f1')"
}

# Notes the most memory in use that the machine cannot give back: what programs hold, and
# shared memory. The file cache is left out, because a server gives it back when asked.
watch_memory() {
  in_machine "systemd-run --quiet --unit alfera-test-memory bash -c '
    peak=0
    while sleep 2; do
      now=\$(awk \"\\\$1 == \\\"anon\\\" || \\\$1 == \\\"shmem\\\" { sum += \\\$2 } END { print int(sum / 1048576) }\" /sys/fs/cgroup/memory.stat)
      echo \"\$now\" >/run/alfera-test-memory-now
      if [ \"\$now\" -gt \"\$peak\" ]; then peak=\"\$now\"; echo \"\$peak\" >/run/alfera-test-memory-peak; fi
    done'"
}

# The name the install is served at. The machine has a private address, so no name can be made
# from it by the installer: that failure is checked first, then the name is given.
choose_address() {
  if [ "$serves_https" != 'yes' ]; then
    address="http://localhost:$app_port"
    https_argument=''
    curl_route=''
    return 0
  fi
  local machine_address
  machine_address="$(in_machine "ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p'")"
  https_name="$(printf '%s' "$machine_address" | tr '.' '-').sslip.io"
  address="https://$https_name"
  https_argument="--https=$https_name"
  curl_route="--insecure --resolve $https_name:443:127.0.0.1"
}

# run_installer <file for the progress lines> <argument>...: each progress line is shown with
# the second it came at.
run_installer() {
  local progress_file="$1" started="$SECONDS" line
  shift
  : >"$progress_file"
  printf '%s\n' "$model_answer" | in_machine "
    { [ -f /root/install.sh ] || curl -fsSL --retry 5 --retry-all-errors http://127.0.0.1:8099/install.sh -o /root/install.sh; } &&
    INSTALL_DIR=/opt/alfera PRODUCT_SOURCE_ARCHIVE=http://127.0.0.1:8099/alfera.tar.gz \
    APP_PORT=$app_port API_PORT=$api_port CADDY_GLOBAL_OPTIONS=local_certs \
      bash /root/install.sh --unattended --progress $* 2>>/var/log/alfera-install.log" |
    while IFS= read -r line; do
      printf '%s\n' "$line" >>"$progress_file"
      printf '  %4s s  %s\n' "$((SECONDS - started))" "$line"
    done
}

field_of_last_line() {
  tail -1 "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"
}

# Whether an install holds the lock on the machine. The kernel is asked, as the installer asks.
lock_on_the_machine() {
  in_machine 'flock -n /root/.alfera-install/flock true 2>/dev/null && echo free || echo held'
}

# wait_for_the_image_build <file of progress lines>: until the API image build has started.
wait_for_the_image_build() {
  local waited=0
  until grep -q '"step":"api_image","state":"started"' "$1" 2>/dev/null; do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -gt 900 ] || grep -q '"state":"failed"' "$1" 2>/dev/null; then
      say "  the installer did not reach the image build: $(tail -1 "$1")"
      return 1
    fi
  done
}

# Runs in the machine. The install that does the work is the one process of the installer that
# was started apart from a connection, and it leads a session of its own: it and everything it
# started are killed at once, with no chance to clean up.
read -r -d '' kill_the_working_install <<'IN_MACHINE'
for pid in $(pgrep -f '[/]root/install.sh'); do
  if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx 'ALFERA_INSTALL_WORKS_APART=yes'; then
    pkill -9 -s "$(ps -o sid= -p "$pid" | tr -d ' ')"
    exit 0
  fi
done
echo 'no working install was found' >&2
exit 1
IN_MACHINE

# The connection is cut while the API image builds. The install works apart from its
# connection, so it goes on, and the same command, run again, starts nothing: it shows the
# progress of that install. Then the install is killed outright, as a power cut would. The
# run that watched it says it was interrupted, the kernel has let the lock go, and the same
# command once more does the work to the end.
install_through_a_cut_connection() {
  local watcher
  run_installer "$work/cut" --answers-stdin $https_argument >/dev/null &
  wait_for_the_image_build "$work/cut" || return 1
  pkill -f "orb run -m $machine -u root" || true
  wait
  say '  the connection was cut while the API image was building'
  check 'the install is still at work on the machine: the lock is held' held "$(lock_on_the_machine)" || return 1
  run_installer "$work/watch" $https_argument >/dev/null &
  watcher="$!"
  wait_for_the_image_build "$work/watch" || return 1
  check 'a second run shows that install and starts no build of its own: the API image is built once' 1 \
    "$(in_machine "grep -c 'building the API image' /root/.alfera-install/log")" || return 1
  in_machine "$kill_the_working_install" || return 1
  wait "$watcher"
  say '  the install was killed with no chance to clean up'
  check 'the run that watched it says it was interrupted' install_interrupted \
    "$(field_of_last_line "$work/watch" reason)" || return 1
  check 'no lock is left behind' free "$(lock_on_the_machine)" || return 1
  run_installer "$work/progress" $https_argument
}

install() {
  if [ "$serves_https" = 'yes' ]; then
    run_installer "$work/no_name" --https >/dev/null
    check 'with no name and no public address, the installer says so and writes nothing' \
      https_name_not_usable "$(field_of_last_line "$work/no_name" reason)" || return 1
  fi
  install_through_a_cut_connection || return 1
  if [ "$(field_of_last_line "$work/progress" state)" != 'done' ]; then
    say "  the installer stopped: $(tail -1 "$work/progress")"
    in_machine 'tail -40 /var/log/alfera-install.log'
    return 1
  fi
  check 'the last progress line is the end of the install' '"step":"install","state":"done"' \
    "$(tail -1 "$work/progress" | grep -o '"step":"install","state":"done"')" &&
    check 'it names the address' "$address" "$(field_of_last_line "$work/progress" address)" &&
    check 'it says whether the name is a shared one' "$([ "$serves_https" = 'yes' ] && echo shared || echo none)" \
      "$(field_of_last_line "$work/progress" name_kind)" &&
    check 'the lock and the progress are in the home folder of root, closed to others, and not in /tmp' 'drwx------ no' \
      "$(in_machine 'printf "%s %s" "$(ls -ld /root/.alfera-install | cut -c1-10)" "$([ -e /tmp/.alfera-install ] && echo yes || echo no)"')" &&
    check 'every line on stdout is a progress line' 0 \
      "$(grep -cv '^{"step":"[a-z_]*","state":"[a-z]*".*}$' "$work/progress")" &&
    check 'the log holds no sign-in link' 0 "$(in_machine 'grep -c /join/ /var/log/alfera-install.log')"
}

install_again() {
  run_installer "$work/second" $https_argument >/dev/null
  check 'a second run changes nothing and says so' no "$(field_of_last_line "$work/second" changed)"
}

# What a browser does with the link: it opens the page, then the button posts to the same
# address. curl sends no Origin by itself, so the post names it.
sign_in() {
  local link
  link="$(in_machine "cd $install_dir && ./alfera team link 10 --progress" | sed -n 's/.*"link":"\([^"]*\)".*/\1/p')"
  check 'the helper gives a link at the address of the install' "$address/join/" "${link%/join/*}/join/" || return 1
  check 'opening the link shows the join page' 200 \
    "$(in_machine "curl -s -o /dev/null -w '%{http_code}' $curl_route -c /root/owner.jar -H 'accept: text/html' '$link'")" &&
    check 'the button signs the owner in' 303 \
      "$(in_machine "curl -s -o /dev/null -w '%{http_code}' $curl_route -c /root/owner.jar -X POST -H 'Origin: $address' '$link'")" || return 1
  [ "$serves_https" = 'yes' ] || return 0
  check 'over https the session cookie has the prefix that binds it to this one host' 1 \
    "$(in_machine "grep -c '__Host-alfera_team_session' /root/owner.jar")" &&
    check 'and it is marked Secure' TRUE "$(in_machine "awk '\$6 == \"__Host-alfera_team_session\" { print \$4 }' /root/owner.jar")"
}

as_owner() {
  in_machine "curl -s -m 30 $curl_route -b /root/owner.jar -H 'Origin: $address' -H 'accept: application/json' -H 'content-type: application/json' $*"
}

call_api_as_owner() {
  check 'the owner reads the team, as owner' owner \
    "$(as_owner "$address/api/v1/team" | sed -n 's/.*"viewer_role":"\([a-z]*\)".*/\1/p')" || return 1
  check 'with no session the same call is refused' 401 \
    "$(in_machine "curl -s -o /dev/null -w '%{http_code}' $curl_route -H 'accept: application/json' $address/api/v1/team")" || return 1
  [ "$serves_https" = 'yes' ] || return 0
  check 'the API answers on port 443' 200 \
    "$(in_machine "curl -s -o /dev/null -w '%{http_code}' $curl_route $address/v1/openapi.json")" &&
    check 'a browser is told to come back over https only' 1 \
      "$(in_machine "curl -s -o /dev/null -D - $curl_route $address/health | grep -ci '^strict-transport-security: max-age=31536000'")" &&
    check 'plain http on port 80 is sent to https' 308 \
      "$(in_machine "curl -s -o /dev/null -w '%{http_code}' --resolve $https_name:80:127.0.0.1 http://$https_name/")" &&
    check 'the proxy secret opens nothing from outside: Caddy takes it off the request' 401 \
      "$(in_machine "printf 'x-coworker-api-secret: %s\n' \"\$(sed -n 's/^COWORKER_API_PROXY_SECRET=//p' $install_dir/.env)\" |
        curl -s -o /dev/null -w '%{http_code}' $curl_route -X POST -H @- '$address/v1/team-sign-in/owner-link?minutes=5'")"
}

# Runs in the machine. It sends one message as the owner, waits until the helper that closes a
# sandbox has run, and asks the sandbox what it reaches, in one go: the worker stops the
# sandbox about ten seconds after a run ends. It prints name=value lines.
# Arguments: install folder, address, curl route, chat id, dashboard port.
read -r -d '' ask_the_sandbox <<'IN_MACHINE'
cd "$1"
network="$(sed -n 's/^COWORKER_SANDBOX_NETWORK=//p' .env)"
gateway="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "${network:-alfera-sandbox}")"
api_address="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker compose ps -q api)")"
machine_address="$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')"
exec 9< <(timeout 900 docker events --filter event=die --filter image=busybox:1.37 --format '{{.Actor.Attributes.exitCode}}')
watcher="$!"
curl -s -m 900 -o /dev/null $3 -b /root/owner.jar -H "Origin: $2" -H 'content-type: application/json' \
  -X POST -d '{"message":"Run the shell command: echo hello"}' "$2/api/v1/sessions/$4/messages" &
message="$!"
read -r -t 900 helper_exit <&9 || helper_exit='did not run'
sandbox="$(docker ps --format '{{.Names}}' --filter 'name=^coworker-' | head -1)"
echo "helper_exit=$helper_exit"
echo "sandbox=${sandbox:-none}"
if [ -n "$sandbox" ]; then
  echo "network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$sandbox")"
  docker exec "$sandbox" bash -c '
    probe() { timeout 3 bash -c "</dev/tcp/$2/$3" 2>/dev/null && echo "$1=open" || echo "$1=closed"; }
    echo "user=$(id -un)"
    touch ./install-test-file 2>/dev/null && echo "file_owner=$(stat -c %u ./install-test-file)" || echo file_owner=none
    probe api "$1" 3001
    probe gateway "$2" "$4"
    probe machine "$3" "$4"
    probe host_name host.docker.internal "$4"
    probe metadata 169.254.169.254 80
    echo "public=$(curl -s -m 6 -o /dev/null -w "%{http_code}" https://example.com)"
  ' _ "$api_address" "$gateway" "$machine_address" "$5"
fi
wait "$message"
kill "$watcher" 2>/dev/null
echo "model_error=$(docker compose logs worker 2>/dev/null | grep -c 'Model provider request error')"
IN_MACHINE

# The owner sends one message. The worker then makes the workspace folder, starts the sandbox
# container through the Docker socket and takes its private addresses away, all before the
# model is asked. With the stand-in key the run ends at the model, and that is far enough.
start_a_sandbox() {
  local chat answers status=0
  chat="$(as_owner "-X POST -d '{\"session_title\":\"Install test\"}' $address/api/v1/sessions" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')"
  check 'the owner makes a chat' yes "$([ -n "$chat" ] && echo yes || echo no)" || return 1
  answers="$(in_machine "$ask_the_sandbox" "$install_dir" "$address" "$curl_route" "$chat" "$app_port")"
  answer() { printf '%s\n' "$answers" | sed -n "s/^$1=//p"; }
  check 'the worker started a sandbox container through the Docker socket' yes \
    "$([ "$(answer sandbox)" != 'none' ] && echo yes || echo no)" ||
    { in_machine "cd $install_dir && docker compose logs --tail 30 worker"; return 1; }
  check 'the helper that takes its private addresses away ran and ended well' 0 "$(answer helper_exit)" || status=1
  check 'the sandbox is on the sandbox network only' alfera-sandbox "$(answer network)" || status=1
  check 'it runs as a user that is not root' node "$(answer user)" || status=1
  check 'a file it makes in the workspace folder belongs to uid 1000' 1000 "$(answer file_owner)" || status=1
  check 'the API container is closed to it' closed "$(answer api)" || status=1
  check 'this machine through the gateway, on the dashboard port, is closed to it' closed "$(answer gateway)" || status=1
  check 'this machine at its own address, on the dashboard port, is closed to it' closed "$(answer machine)" || status=1
  check 'this machine by the name host.docker.internal is closed to it' closed "$(answer host_name)" || status=1
  check 'the cloud metadata address is closed to it' closed "$(answer metadata)" || status=1
  check 'a public site answers it' 200 "$(answer public)" || status=1
  if [ "$has_real_key" != 'yes' ]; then
    check 'the run then stopped at the model, which refused the stand-in key' yes \
      "$([ "$(answer model_error)" -ge 1 ] && echo yes || echo no)" || status=1
  fi
  return "$status"
}

# With the stand-in key the doctor has one thing to report, and it is that key.
run_doctor() {
  local output problems
  output="$(in_machine "cd $install_dir && ./alfera doctor" 2>&1)"
  say "$output" | sed 's/^/  | /'
  problems="$(printf '%s\n' "$output" | grep -c '^  FIX ')"
  if [ "$has_real_key" = 'yes' ]; then
    check 'the doctor reports nothing to fix' 0 "$problems"
    return
  fi
  check 'the doctor reports nothing to fix but the stand-in key' 0 \
    "$(printf '%s\n' "$output" | grep '^  FIX ' | grep -vc 'VERCEL_AI_GATEWAY_API_KEY')"
}

measure() {
  local running peak disk
  peak="$(in_machine 'cat /run/alfera-test-memory-peak')"
  running="$(in_machine 'cat /run/alfera-test-memory-now')"
  disk="$(in_machine "du -sxm /var/lib/docker /var/lib/containerd /opt/alfera 2>/dev/null | awk '{ sum += \$1 } END { print sum }'")"
  say "  memory at the peak of the install: $peak MB"
  say "  memory with the stack up and no chat running: $running MB"
  say "  disk the install uses (images, build cache, volumes, source): $disk MB"
  in_machine 'docker system df' | sed 's/^/  | /'
  report="$report$(printf '%-34s %5s MB' 'memory, peak of the install' "$peak")"$'\n'
  report="$report$(printf '%-34s %5s MB' 'memory, stack up, no chat running' "$running")"$'\n'
  report="$report$(printf '%-34s %5s MB' 'disk the install uses' "$disk")"$'\n'
}

readonly stand_in_public_address='203.0.113.10'
readonly first_boot_name='e2e'
readonly setup_token='a-setup-token-for-the-first-boot-test-0000'
readonly report_token='a-report-token-for-the-first-boot-test-000'

read -r -d '' stand_in_servers <<'IN_MACHINE'
import http.server, json, sys
role, log = sys.argv[1], sys.argv[2]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'203.0.113.10' if self.path == '/metadata/v1/interfaces/public/0/ipv4/address' else b''
        self.send_response(200 if body else 404)
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0))).decode()
        with open(log, 'a') as file:
            file.write(json.dumps({'authorization': self.headers.get('authorization'), 'body': json.loads(body)}) + '\n')
        self.send_response(204)
        self.end_headers()
    def log_message(self, *arguments):
        pass
address = ('127.0.0.1', 8097) if role == 'metadata' else ('127.0.0.1', 8098)
http.server.HTTPServer(address, Handler).serve_forever()
IN_MACHINE

serve_stand_ins() {
  printf '%s\n' "$stand_in_servers" | in_machine 'cat >/root/stand_in_servers.py' || return 1
  in_machine '
    apt-get install -y -qq openssh-server >/root/stand_in_setup.log 2>&1 &&
    systemd-run --quiet --unit alfera-test-metadata python3 /root/stand_in_servers.py metadata /dev/null &&
    systemd-run --quiet --unit alfera-test-reports python3 /root/stand_in_servers.py reports /root/reports.log &&
    sleep 1 && curl -fsS http://127.0.0.1:8097/metadata/v1/interfaces/public/0/ipv4/address' >/dev/null || return 1
  https_name="$first_boot_name-$(printf '%s' "$stand_in_public_address" | tr '.' '-').sslip.io"
  address="https://$https_name"
  curl_route="--insecure --resolve $https_name:443:127.0.0.1"
}

user_data_header() {
  printf '#!/bin/bash\n'
  printf "export %s='%s'\n" ALFERA_INSTALL_ID 00000000-0000-4000-8000-000000000001 \
    ALFERA_SETUP_TOKEN "$setup_token" ALFERA_REPORT_TOKEN "$report_token" \
    ALFERA_REPORT_URL http://127.0.0.1:8098/report ALFERA_NAME "$first_boot_name" ALFERA_VERSION test \
    ALFERA_SOURCE_ARCHIVE_URL http://127.0.0.1:8099/alfera.tar.gz \
    ALFERA_METADATA_ADDRESS 127.0.0.1:8097 \
    APP_PORT "$app_port" API_PORT "$api_port" CADDY_GLOBAL_OPTIONS local_certs \
    "${model_answer%%=*}" "${model_answer#*=}"
}

run_first_boot() {
  { user_data_header; tail -n +2 "$source_root/deploy/first_boot.sh"; } | in_machine 'cat >/root/user-data.sh' || return 1
  in_machine 'bash /root/user-data.sh >/var/log/alfera-first-boot.log 2>&1'
  check 'the first boot ends well' 0 "$?" || { in_machine 'tail -30 /var/log/alfera-first-boot.log; tail -30 /root/.alfera-install/log'; return 1; }
}

report_field() {
  in_machine "tail -1 /root/reports.log" | python3 -c "import json, sys; line = json.load(sys.stdin); print(line['body'].get('$1') if '$1' != 'authorization' else line['authorization'])"
}

check_first_boot() {
  local reports
  reports="$(in_machine 'wc -l </root/reports.log')"
  say "  $reports reports reached the stand-in deploy page"
  in_machine 'cut -c1-200 /root/reports.log' | sed 's/^/  | /' | tail -5
  check 'the last report is the end of the install' 'install done' "$(report_field step) $(report_field state)" &&
    check 'it names the address with the chosen name' "$address" "$(report_field address)" &&
    check 'it carries the install id' 00000000-0000-4000-8000-000000000001 "$(report_field install_id)" &&
    check 'every report carries the report token' 0 \
      "$(in_machine "grep -vc '\"authorization\": \"Bearer $report_token\"' /root/reports.log")" &&
    check 'no report holds the setup token or its hash' 0 \
      "$(in_machine "grep -c -e '$setup_token' -e \"\$(printf %s '$setup_token' | sha256sum | cut -c1-64)\" /root/reports.log")" &&
    check 'the API reads the sha256 of the setup token' "$(printf %s "$setup_token" | shasum -a 256 | cut -c1-64)" \
      "$(in_machine "cd $install_dir && docker compose exec -T api sh -c 'cat \"\$SETUP_TOKEN_HASH_FILE\"'")" &&
    check 'the raw setup token is nowhere in the install' 0 \
      "$(in_machine "grep -rlc '$setup_token' /opt/alfera/source/deploy/.env /opt/alfera/source/deploy/secrets /root/.alfera-install 2>/dev/null | wc -l")" &&
    check 'sshd takes no password' no "$(in_machine "sshd -T | awk '\$1 == \"passwordauthentication\" { print \$2 }'")" &&
    check 'the sandbox image arrives within three minutes of the end of the install' yes \
      "$(in_machine 'for i in $(seq 36); do docker image inspect node:24-bookworm >/dev/null 2>&1 && echo yes && exit; sleep 5; done; echo no')" &&
    check 'the dashboard container holds neither the master key nor the database password' 0 \
      "$(in_machine "cd $install_dir && docker compose exec -T app env | grep -c -e COWORKER_CREDENTIAL_ENCRYPTION_KEY -e POSTGRES_PASSWORD -e DATABASE_URL")" &&
    check 'the master key is in no line of .env' 0 \
      "$(in_machine "grep -c '^COWORKER_CREDENTIAL_ENCRYPTION_KEY=.' $install_dir/.env")" &&
    check 'the secrets folder is closed, and the master key reaches the API only through it' 'drwx------ 1' \
      "$(in_machine "ls -ld $install_dir/secrets | cut -c1-10") $(in_machine "cd $install_dir && docker compose exec -T api sh -c 'test -s /run/secrets/master_key && echo 1'")"
  say "  swap: $(in_machine "free -m | awk '\$1 == \"Swap:\" { print \$2 }'") MB (a container machine may not allow swap)"
}

delete_machine() {
  rm -rf "$work"
  if [ "$keeps_machine" = 'yes' ]; then
    say "the machine $machine is kept. Delete it with: orb delete -f $machine"
    return
  fi
  orb delete -f "$machine" >/dev/null 2>&1 || true
}
trap delete_machine EXIT

started_at="$SECONDS"
step 'create the machine' create_machine
if [ "$first_boot" = 'yes' ]; then
  step 'let Docker place containers' let_docker_place_containers_itself
  step 'serve the source' serve_source
  step 'watch the memory' watch_memory
  step 'serve the stand-in metadata and deploy page' serve_stand_ins
  step 'first boot' run_first_boot
  step 'check the first boot' check_first_boot
else
  step 'install Docker' install_docker
  step 'serve the source' serve_source
  step 'watch the memory' watch_memory
  step 'choose the address' choose_address
  step 'install' install
  step 'install again' install_again
fi
step 'sign in as the owner' sign_in
step 'call the API as the owner' call_api_as_owner
step 'start a sandbox' start_a_sandbox
step 'run the doctor' run_doctor
step 'measure' measure

say ''
say "Ubuntu 24.04, $architecture, $([ "$serves_https" = 'yes' ] && echo https || echo 'plain http')$([ "$first_boot" = 'yes' ] && echo ', first boot')"
printf '%s' "$report"
say "$(printf '%-34s %5s s' 'all of it' "$((SECONDS - started_at))")"
if [ -n "$failed_step" ]; then
  say "FAILED at: $failed_step"
  exit 1
fi
say 'every step passed'
