#!/usr/bin/env bash
# Proves ./alfera doctor on a scratch install. Docker and curl are stand-ins on PATH, so the
# test starts nothing, calls nobody, and needs no key. It prints one line per case (ok / FAIL)
# and exits 1 on any FAIL.
# Usage: deploy/test_alfera.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
install="$work/install"
tools="$work/tools"
failed=0
mkdir -p "$install" "$tools"
cp "$here/alfera" "$install/alfera"

# Docker says the stack is healthy. It has the sandbox helper image, and can pull it, unless
# the file no_helper_image is next to this stand-in. The worker reaches a model address from
# its container unless the file worker_cannot_reach is there. It writes each command line to
# DOCKER_LOG when that is set.
cat >"$tools/docker" <<'STUB'
#!/usr/bin/env bash
[ -z "${DOCKER_LOG:-}" ] || echo "$*" >>"$DOCKER_LOG"
case "$*" in
  'compose ps -a'*) echo 'migrations exited 0' ;;
  'compose ps --status running --services') echo 'worker' ;;
  'compose exec -T -e MODEL_ADDRESS='*) [ ! -f "$(dirname "$0")/worker_cannot_reach" ] ;;
  'compose logs worker') echo 'worker ready' ;;
  'image inspect '* | 'pull '*) [ ! -f "$(dirname "$0")/no_helper_image" ] ;;
  'compose exec -T postgres pg_dump '*) echo 'the bytes of a dump' ;;
  'compose pull --quiet') ! grep -q '^PRODUCT_VERSION=missing$' .env ;;
  'compose up -d') ! grep -q '^PRODUCT_VERSION=broken$' .env ;;
esac
STUB

# A provider accepts every key but one that holds "refused". A key comes on stdin, as a header
# for `-H @-`. The API and the dashboard ask for a session, as an install with sign-in links
# does. Each address asked is written down, and so is every command line.
# A model server answers as real ones do: it lists two models, runs any model but the ones
# named no-tools and no-such-model, and is not there at all at the host nothing-answers. The
# one at the host one-model lists a single model, and that one takes no tool. The one at the
# host many-models lists twenty-five.
# No machine is at 192.168.7.7, at moved-away.example.com or at no-such-machine.local, as
# after a change of network. A router is at 192.168.8.8: it answers every address with its own page.
cat >"$tools/curl" <<'STUB'
#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in http*) echo "$argument" >>"$CURL_LOG" ;; esac
done
echo "$*" >>"$CURL_LOG.arguments"
headers_on_stdin=''
case "$*" in *'-H @-'*) headers_on_stdin="$(cat)" ;; esac
case "$headers_on_stdin" in *refused*) printf '401' && exit 0 ;; esac
state="$(dirname "$0")"
case "$*" in
  */metadata/v1/interfaces/public/0/ipv4/address) [ -f "$state/on_digitalocean" ] && printf '203.0.113.7' && exit 0; exit 22 ;;
  *-X\ PUT*/latest/api/token) [ -f "$state/on_aws" ] && printf 'a-metadata-token' && exit 0; exit 22 ;;
  */latest/meta-data/public-ipv4) case "$headers_on_stdin" in *a-metadata-token*) printf '198.51.100.4'; exit 0 ;; esac; exit 22 ;;
esac
case "$*" in
  *192.168.7.7* | *moved-away.example.com* | *no-such-machine*) printf '\n000'; exit 7 ;;
  *192.168.8.8*) printf '<html>the page of a router</html>\n200'; exit 0 ;;
  *nothing-answers*) printf '\n000'; exit 7 ;;
  *still-loading*) printf '\n000'; exit 28 ;;
  *wrong-path*) printf '404 page not found\n404'; exit 0 ;;
  *'"model":"no-tools"'*)
    printf '{"error":{"message":"registry.ollama.ai/library/no-tools does not support tools"}}\n400'
    exit 0
    ;;
  *'"model":"no-such-model"'*)
    printf '{"error":{"message":"model \\"no-such-model\\" not found, try pulling it first"}}\n404'
    exit 0
    ;;
  *owner-link*) printf '{"data":{"token":"%s"}}' 'link_token_0123456789abcdefghijklmnopqrstuvw'; exit 0 ;;
  *'-o /dev/null'*) ;;
  *one-model*/v1/models) printf '{"data":[{"id":"no-tools"}]}\n200'; exit 0 ;;
  *many-models*/v1/models)
    printf '{"data":['
    for number in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do printf '{"id":"vendor/model-%s"},' "$number"; done
    printf '{"id":"vendor/model-25"}]}\n200'
    exit 0
    ;;
  */v1/models) printf '{"object":"list","data":[{"id":"qwen3:14b","object":"model"},{"id": "gemma3:4b"}]}\n200'; exit 0 ;;
esac
case "$*" in
  *'%{http_code}'*refused*) printf '401' ;;
  *'%{http_code}'*/v1/team-sign-in/session | *'%{http_code}'*/sign-in) printf '401' ;;
  *'%{http_code}'*) printf '200' ;;
esac
STUB

# This machine is at 192.168.1.20 on its network, unless the file no_network_address is next
# to this stand-in: then it shows no address at all, as a machine with no network does.
cat >"$tools/ip" <<'STUB'
#!/usr/bin/env bash
[ -f "$(dirname "$0")/no_network_address" ] || echo '1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.20 uid 1000'
STUB
printf '#!/usr/bin/env bash\n' >"$tools/route"

# The machine has no name other machines find it by, unless a file next to these stand-ins
# says so. `a_mac_named` holds the Bonjour name of a Mac. `linux_with_avahi_named` holds the
# host name of a Linux machine on which avahi announces that name.
cat >"$tools/uname" <<'STUB'
#!/usr/bin/env bash
state="$(dirname "$0")"
if [ "$*" = '-s' ] && [ -f "$state/a_mac_named" ]; then echo 'Darwin'; exit 0; fi
if [ "$*" = '-s' ] && [ -f "$state/linux_with_avahi_named" ]; then echo 'Linux'; exit 0; fi
exec "$(PATH="${PATH#*:}" command -v uname)" "$@"
STUB
printf '#!/usr/bin/env bash\ncat "$(dirname "$0")/a_mac_named" 2>/dev/null\n' >"$tools/scutil"
printf '#!/usr/bin/env bash\n[ -f "$(dirname "$0")/linux_with_avahi_named" ]\n' >"$tools/pgrep"
printf '#!/usr/bin/env bash\ncat "$(dirname "$0")/linux_with_avahi_named" 2>/dev/null\n' >"$tools/hostname"
chmod +x "$tools/docker" "$tools/curl" "$tools/ip" "$tools/route" "$tools/uname" "$tools/scutil" \
  "$tools/pgrep" "$tools/hostname"

filler='0123456789abcdef0123456789abcdef'
helper_image="$(sed -n "s/^readonly route_helper_image='\(.*\)'$/\1/p" "$here/alfera")"

# write_env <extra line>...: a complete install as install.sh leaves it, plus the lines given.
sign_in_mode='team'
write_env() {
  {
    printf '%s\n' "COWORKER_AUTH_MODE=$sign_in_mode" 'APP_BIND=127.0.0.1' 'APP_PORT=3000' 'API_PORT=3001'
    printf '%s\n' 'NEXT_PUBLIC_APP_URL=http://localhost:3000'
    for key in COWORKER_API_PROXY_SECRET WORKOS_COOKIE_PASSWORD \
      COWORKER_BROWSER_STATE_ENCRYPTION_KEY RIVET_TOKEN POSTGRES_PASSWORD; do
      printf '%s=%s\n' "$key" "$filler"
    done
    printf '%s\n' "$@"
  } >"$install/.env"
  rm -rf "$install/secrets" "$install/backups"
  mkdir -m 0700 "$install/secrets"
  printf '%s\n' "$filler" >"$install/secrets/master_key"
  : >"$install/secrets/master_key_fallbacks"
  : >"$install/secrets/setup_token_hash"
}

# expect <wanted exit> <text the output must hold, or -> <text it must not hold, or -> <case name>
expect() {
  local wanted_exit="$1" wanted_text="$2" unwanted_text="$3" name="$4" output status
  : >"$work/curl.log"
  output="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" doctor 2>&1)"
  status=$?
  if [ "$status" -ne "$wanted_exit" ] ||
    { [ "$wanted_text" != '-' ] && ! grep -qF -- "$wanted_text" <<<"$output"; } ||
    { [ "$unwanted_text" != '-' ] && grep -qF -- "$unwanted_text" <<<"$output"; }; then
    printf 'FAIL  %s (exit %s)\n%s\n' "$name" "$status" "$output"
    failed=1
    return
  fi
  printf 'ok    %s\n' "$name"
}

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
expect 0 'Everything checks out.' '-' 'a complete install with sign-in links passes'

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'API_PUBLIC_URL=https://alfera.example.com'
expect 0 'Everything checks out.' 'half set up' 'a public API address with no Slack app passes'

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'SLACK_CLIENT_ID=123.456'
expect 1 'slack is half set up' '-' 'one Slack value without the rest is reported'

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'SLACK_CLIENT_ID=123.456' \
  'SLACK_CLIENT_SECRET=accepted' 'SLACK_SIGNING_SECRET=accepted'
expect 1 'slack is half set up: API_PUBLIC_URL missing' '-' 'a Slack app without a public API address is reported'

write_env 'VERCEL_AI_GATEWAY_API_KEY=vck_accepted'
expect 0 'VERCEL_AI_GATEWAY_API_KEY works' 'no key check' 'a gateway key is checked with the gateway'
grep -qxF 'https://ai-gateway.vercel.sh/v1/models' "$work/curl.log" ||
  { echo 'FAIL  the gateway was not asked'; failed=1; }

write_env 'VERCEL_AI_GATEWAY_API_KEY=vck_refused'
expect 1 'VERCEL_AI_GATEWAY_API_KEY was refused by the provider' '-' 'a refused gateway key is reported'

for key_line in 'ANTHROPIC_API_KEY=sk-ant-refused' 'OPENAI_API_KEY=sk-refused'; do
  write_env "$key_line"
  expect 1 "${key_line%%=*} was refused by the provider" '-' "a refused ${key_line%%=*} is reported"
done
if grep -qE 'vck_|sk-' "$work/curl.log.arguments"; then
  echo 'FAIL  a model key was on the command line of curl, where another process can read it'
  failed=1
else
  echo 'ok    no model key is on a command line of curl'
fi

write_env
expect 1 'no model key' '-' 'an install with no model key is reported'

own_address='http://host.docker.internal:11434/v1'
write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
expect 0 "the model qwen3:14b at $own_address answers, and takes a tool" 'no model key' 'a model the person hosts is checked with one request that holds a tool'
grep -qxF 'http://localhost:11434/v1/chat/completions' "$work/curl.log" ||
  { echo 'FAIL  the model server of this machine was not asked at localhost'; failed=1; }
grep -qF '"tools":[{"type":"function"' "$work/curl.log.arguments" ||
  { echo 'FAIL  the request to the model held no tool'; failed=1; }
expect 0 'the worker reaches the model address from its container' '-' 'the model address is checked from the worker too'

other_address='http://host.docker.internal.example.com/v1'
write_env "OPENAI_COMPATIBLE_BASE_URL=$other_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
: >"$work/curl.log"
PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" doctor >/dev/null 2>&1 || true
if ! grep -qF 'host.docker.internal.example.com' "$work/curl.log"; then
  echo 'FAIL  a name that only starts like host.docker.internal was asked at another host'
  failed=1
else
  echo 'ok    only the exact name host.docker.internal is asked at localhost'
fi
write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'

touch "$tools/worker_cannot_reach"
expect 1 "the worker cannot reach $own_address from its container" '-' 'a model server the worker cannot reach is reported'
rm "$tools/worker_cannot_reach"

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b' \
  'OPENAI_COMPATIBLE_API_KEY=key-of-the-server'
expect 0 'answers, and takes a tool' '-' 'a model server that asks for a key gets it'

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b' \
  'OPENAI_COMPATIBLE_API_KEY=refused-by-the-server'
expect 1 "The server at $own_address refused the key." '-' 'a key the model server refuses is reported'

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=no-tools'
expect 1 'The model no-tools does not support tool calling, and Alfera needs it. Choose a model that does.' '-' 'a model without tool calling is reported in one sentence'

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=no-such-model'
expect 1 "The server at $own_address has no model named no-such-model. It has: qwen3:14b, gemma3:4b." '-' 'a model the server does not have is reported, with the ones it has'

write_env 'OPENAI_COMPATIBLE_BASE_URL=http://nothing-answers:11434/v1' 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
expect 1 'Nothing answers at http://nothing-answers:11434/v1. Start the model server, then try again.' '-' 'a model server that is not running is reported'

write_env 'OPENAI_COMPATIBLE_BASE_URL=http://still-loading:11434/v1' 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
expect 1 'did not answer within two minutes' '-' 'a model that does not answer in time is reported'

write_env 'OPENAI_COMPATIBLE_BASE_URL=http://wrong-path:11434' 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
expect 1 'answered with status 404. Give the address that ends in /v1.' '-' 'an address that is not the /v1 address is reported'

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address"
expect 1 "a model address is set ($own_address), but no model name" 'no model key' 'a model address with no model name is reported'

write_env "OPENAI_COMPATIBLE_BASE_URL=$own_address" 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
own_model_status="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1)"
if grep -q '^  model      set up$' <<<"$own_model_status"; then
  echo 'ok    status shows the model as set up on an install with a model the person hosts'
else
  echo 'FAIL  status shows the model as set up on an install with a model the person hosts'
  failed=1
fi

# install.sh asks the helper this, with the key in the environment, before there is a .env.
rm "$install/.env"
problem="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" OPENAI_COMPATIBLE_API_KEY='key-of-the-server' \
  "$install/alfera" own-model-problem "$own_address" no-tools)"
if [ "$problem" = 'The model no-tools does not support tool calling, and Alfera needs it. Choose a model that does.' ] &&
  [ -z "$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" own-model-problem "$own_address" qwen3:14b)" ]; then
  echo 'ok    the installer gets one sentence for a model that does not work, and nothing for one that does'
else
  printf 'FAIL  the installer gets one sentence for a model that does not work, and nothing for one that does\n%s\n' "$problem"
  failed=1
fi
if grep -qF 'key-of-the-server' "$work/curl.log.arguments"; then
  echo 'FAIL  the key of a model server was on the command line of curl, where another process can read it'
  failed=1
else
  echo 'ok    the key of a model server is on no command line of curl'
fi

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
sed -i.bak "s/^COWORKER_API_PROXY_SECRET=.*/COWORKER_API_PROXY_SECRET=${filler:0:16}/" "$install/.env"
expect 1 'missing or under 32 characters: COWORKER_API_PROXY_SECRET' '-' 'a proxy secret of 16 characters is reported'

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
status_lines="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1)"
printf '# Written by install.sh: Docker had no free address range, so this stack names its own.\nnetworks:\n  default:\n    ipam:\n      config:\n        - subnet: 10.213.210.0/24\n' >"$install/docker-compose.override.yml"
status_lines_with_range="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1)"
rm "$install/docker-compose.override.yml"
if grep -q '^Network ' <<<"$status_lines" ||
  ! grep -q '^Network    address range 10.213.210.0/24, named in docker-compose.override.yml' <<<"$status_lines_with_range"; then
  printf 'FAIL  status names the address range of the stack only when install.sh named one\n%s\n' "$status_lines_with_range"
  failed=1
else
  echo 'ok    status names the address range of the stack only when install.sh named one'
fi

if grep -q '^  sign-in    off' <<<"$status_lines" ||
  ! grep -q '^  sign-in    this install makes its own sign-in links' <<<"$status_lines"; then
  printf 'FAIL  status does not call sign-in "off" on an install that signs people in with links\n%s\n' "$status_lines"
  failed=1
else
  echo 'ok    status does not call sign-in "off" on an install that signs people in with links'
fi

if ! grep -q '^  local-mcp  off: MCP servers on this machine or your network are refused   (./alfera add local-mcp)$' <<<"$status_lines"; then
  printf 'FAIL  status says that MCP servers on a private address are off, and how to turn them on\n%s\n' "$status_lines"
  failed=1
else
  echo 'ok    status says that MCP servers on a private address are off, and how to turn them on'
fi

# Automations work with no outside service. The one part that needs one is the app event, and
# the line says so: it must not read as if automations were off.
if ! grep -q '^  triggers   app events are off; automations on a schedule, on request and from the web work   (./alfera add triggers)$' <<<"$status_lines"; then
  printf 'FAIL  status says that only app events are off, and that the other automations work\n%s\n' "$status_lines"
  failed=1
else
  echo 'ok    status says that only app events are off, and that the other automations work'
fi

# Every line under Services and Capabilities starts its words in one column: two spaces, then a
# name, then at least two spaces.
if grep -qvE '^  [a-z-]+ {2,}[^ ]' <<<"$(sed -n '/^Capabilities$/,$p' <<<"$status_lines" | sed 1d)"; then
  printf 'FAIL  every capability line of status keeps the column\n%s\n' "$status_lines"
  failed=1
else
  echo 'ok    every capability line of status keeps the column'
fi

columns_of_capabilities() {
  sed -n '/^Capabilities$/,$p' <<<"$1" | sed 1d | sed -E 's/^(  [a-z-]+ +).*/\1/' | awk '{ print length($0) }' | sort -u | paste -sd' ' -
}

# `add local-mcp --yes` is the yes of a script: it writes the one setting and restarts what
# reads it, and asks nobody. Docker is the stand-in.
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'COWORKER_MCP_PRIVATE_ADDRESSES=closed'
add_output="$(PATH="$tools:$PATH" DOCKER_LOG="$work/docker.log" "$install/alfera" add local-mcp --yes 2>&1 </dev/null)"
status_lines_with_local_mcp="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1)"
if [ "$(grep -c '^COWORKER_MCP_PRIVATE_ADDRESSES=' "$install/.env")" != '1' ] ||
  ! grep -q '^COWORKER_MCP_PRIVATE_ADDRESSES=open$' "$install/.env" ||
  ! grep -q '^compose up -d$' "$work/docker.log" ||
  ! grep -q '^This lets every owner and admin of this Alfera add MCP servers that run on this machine or on your private network.$' <<<"$add_output" ||
  ! grep -q 'To turn it off, set COWORKER_MCP_PRIVATE_ADDRESSES=closed' <<<"$add_output" ||
  ! grep -q '^  local-mcp  on: an owner or admin can add MCP servers on this machine or your network$' <<<"$status_lines_with_local_mcp"; then
  printf 'FAIL  add local-mcp --yes says what it opens, sets the one setting, restarts, says how to turn it off, and status shows it on\n%s\n%s\n' "$add_output" "$status_lines_with_local_mcp"
  failed=1
else
  echo 'ok    add local-mcp --yes says what it opens, sets the one setting, restarts, says how to turn it off, and status shows it on'
fi

# Every capability line starts its words at one column, the "local-mcp on:" line too.
if [ "$(columns_of_capabilities "$status_lines_with_local_mcp")" = '13' ] && [ "$(columns_of_capabilities "$status_lines")" = '13' ]; then
  echo 'ok    the local-mcp line of status starts its words in the column of the others, on and off'
else
  printf 'FAIL  the local-mcp line of status starts its words in the column of the others, on and off\n%s\n' "$status_lines_with_local_mcp"
  failed=1
fi

# said_by_helper <case name> <wanted exit> <wanted first line, or -> <argument of the helper>...
said_by_helper() {
  local name="$1" wanted_exit="$2" wanted_line="$3" output status
  shift 3
  output="$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" DOCKER_LOG="$work/docker.log" "$install/alfera" "$@" 2>&1 </dev/null)"
  status=$?
  if [ "$status" -ne "$wanted_exit" ] || { [ "$wanted_line" != '-' ] && [ "$output" != "$wanted_line" ]; }; then
    printf 'FAIL  %s (exit %s)\n%s\n' "$name" "$status" "$output"
    failed=1
    return
  fi
  printf 'ok    %s\n' "$name"
}

said_by_helper 'a command the helper does not have stops with one sentence, and not with a zero' 1 \
  'error: "stauts" is not a command of this helper: run ./alfera help to see the ones it has.' stauts
said_by_helper 'help is a command, and so is the helper with no word after it' 0 - help
said_by_helper 'the helper with no word after it shows the commands' 0 -
said_by_helper 'add with no capability lists every one, https and team included' 1 \
  'error: choose one of: team https local-mcp model sign-in apps triggers slack email storage search' add

# Who can open the install. status and doctor say one thing, from the address people are given
# and where the port is published. `who_can_open <address> <port bind>` prints the two lines.
who_can_open() {
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  sed -i.bak "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=$1|; s|^APP_BIND=.*|APP_BIND=$2|" "$install/.env"
  PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1 | sed -n 's/^Mode       //p' | sed 's/   (.*//'
  PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" doctor 2>&1 | grep -E 'people sign in with links|WARN' | sed 's/^ *[a-zA-Z]* *//'
}

# says_who_can_open <address> <port bind> <wanted status words> <wanted doctor words> [<wanted warning>]
says_who_can_open() {
  local got wanted
  got="$(who_can_open "$1" "$2")"
  wanted="$(printf '%s\n%s' "$3" "$4")${5:+$'\n'$5}"
  if [ "$got" = "$wanted" ]; then
    printf 'ok    status and doctor agree on who can open %s with the port on %s\n' "$1" "$2"
  else
    printf 'FAIL  status and doctor agree on who can open %s with the port on %s\nwanted:\n%s\ngot:\n%s\n' "$1" "$2" "$wanted" "$got"
    failed=1
  fi
}

only_this_machine_status='sign-in links, this machine only'
only_this_machine_doctor='people sign in with links this install makes, and only this machine can open it'
port_open_warning='the dashboard port is open to other machines, but people are given %s, which only this machine can use: run ./alfera add team and give the address other machines use.'
this_machine_only_hosts='localhost 127.0.0.1 127.8.9.1 [::1] app.localhost 0.0.0.0 host.docker.internal LOCALHOST'
for host in $this_machine_only_hosts; do
  says_who_can_open "http://$host:3000" 127.0.0.1 "$only_this_machine_status" "$only_this_machine_doctor"
  # shellcheck disable=SC2059
  says_who_can_open "http://$host:3000" 0.0.0.0 "$only_this_machine_status" "$only_this_machine_doctor" \
    "$(printf "$port_open_warning" "http://$(tr '[:upper:]' '[:lower:]' <<<"$host"):3000")"
done
says_who_can_open 'http://192.168.1.20:3000' 0.0.0.0 'sign-in links, open to other machines' \
  'people sign in with links this install makes, and the dashboard port is open to other machines'
says_who_can_open 'http://127.example.lan:3000' 0.0.0.0 'sign-in links, open to other machines' \
  'people sign in with links this install makes, and the dashboard port is open to other machines'
says_who_can_open 'https://alfera.example.com' 127.0.0.1 'sign-in links, open to other machines through a proxy on this machine' \
  'people sign in with links this install makes, and other machines open it through a proxy on this machine'

# `add team` refuses an address that only this machine can use, and names the one to give.
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
env_before="$(cksum <"$install/.env")"
: >"$work/docker.log"
said_by_helper 'add team refuses a localhost address, and offers the address of this machine on its network' 1 \
  "$(printf '%s\n%s' 'This opens the install to other machines. People sign in with one-time links. No outside account.' \
    'error: http://localhost:3000 leads to this machine only, so no other machine can open it. Give the address other machines use, such as http://192.168.1.20:3000. Nothing was changed.')" \
  add team http://localhost:3000
for address in http://127.0.0.1:3000 'http://[::1]:3000' http://alfera.localhost:3000/; do
  said_by_helper "add team refuses $address" 1 - add team "$address"
done
if [ "$env_before" = "$(cksum <"$install/.env")" ] && [ ! -s "$work/docker.log" ]; then
  echo 'ok    a refused address changes nothing in .env and restarts nothing'
else
  echo 'FAIL  a refused address changes nothing in .env and restarts nothing'
  failed=1
fi

sign_in_mode='local'
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
expect 1 'local mode has no sign-in' '-' 'an install with no sign-in is reported'
sign_in_mode='team'

touch "$tools/no_helper_image"
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
expect 1 "docker pull $helper_image" '-' 'a sandbox helper image that cannot be pulled is reported'
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'COWORKER_SANDBOX_PRIVATE_ADDRESSES=open'
expect 0 'Everything checks out.' 'helper image' 'an install that leaves private addresses open needs no helper image'
rm "$tools/no_helper_image"

# A person at a terminal. The helper asks on /dev/tty, so each case below runs it at a terminal
# of its own and types the answers: `text to wait for=>text to type`.
# type_at_helper <argument of the helper>... -- <step>...: what the terminal showed lands in
# $work/terminal, and each Docker command in $work/docker.log.
type_at_helper() {
  local helper_arguments=()
  while [ "$1" != '--' ]; do
    helper_arguments+=("$1")
    shift
  done
  shift
  : >"$work/docker.log"
  PATH="$tools:$PATH" CURL_LOG="$work/curl.log" DOCKER_LOG="$work/docker.log" \
    python3 "$here/type_at_a_terminal.py" "$work/terminal" "$@" -- "$install/alfera" "${helper_arguments[@]}" >/dev/null 2>&1
}

shows() {
  grep -cF -- "$1" "$work/terminal"
}

setting() {
  grep "^$1=" "$install/.env" | paste -sd' ' -
}

# said <case name> <wanted> <got>
said() {
  if [ "$2" = "$3" ]; then
    printf 'ok    %s\n' "$1"
  else
    printf 'FAIL  %s: wanted %s, got %s\n%s\n' "$1" "$2" "$3" "$(cat "$work/terminal")"
    failed=1
  fi
}

: >"$work/terminal"

# The address people are given must lead to this install. `open_at <address>` is an install
# that `add team` opened at that address. `helper_says` runs the helper with nobody to ask.
open_at() {
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  sed -i.bak "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=$1|; s|^APP_BIND=.*|APP_BIND=0.0.0.0|" "$install/.env"
}
helper_says() {
  PATH="$tools:$PATH" CURL_LOG="$work/curl.log" DOCKER_LOG="$work/docker.log" "$install/alfera" "$@" 2>&1 </dev/null
}
does_not_lead='does not lead to this machine now, most often because the machine changed network'

open_at 'http://192.168.1.20:3000'
expect 0 'ok    http://192.168.1.20:3000 leads to this install, asked from this machine itself (doctor cannot ask from another machine)' \
  'does not lead' 'doctor asks the address people are given, and says that it cannot ask from another machine'

open_at 'http://192.168.7.7:3000'
expect 1 "FIX   http://192.168.7.7:3000 $does_not_lead, so no other machine can open Alfera or use a sign-in link" \
  'Everything checks out.' 'doctor reports an address that no longer leads to this machine'
expect 1 '        ./alfera add team http://192.168.1.20:3000' '-' 'and names the exact command, with the address this machine has now'
said 'status says the same about that address, with the same command' \
  "Mode       sign-in links, but http://192.168.7.7:3000 $does_not_lead   (./alfera add team http://192.168.1.20:3000)" \
  "$(helper_says status | grep '^Mode ')"
: >"$work/curl.log"
link_words="$(helper_says team link)"
said 'team link makes no link at that address, says why, and names the command' \
  "1 error: http://192.168.7.7:3000 $does_not_lead, so no sign-in link is made there. Run: ./alfera add team http://192.168.1.20:3000" \
  "$? $link_words"
said 'and the API is asked for no link' 0 "$(grep -c 'owner-link' "$work/curl.log")"

printf 'Office-Mac\n' >"$tools/a_mac_named"
expect 1 '        ./alfera add team http://office-mac.local:3000' '-' \
  'on a Mac the command gives the name of the machine, which stays the same on the next network'
printf 'No-Such-Machine\n' >"$tools/a_mac_named"
open_at 'http://no-such-machine.local:3000'
expect 1 '        Check that this machine is on its network, then run: ./alfera doctor' './alfera add team' \
  'an address by name that does not answer is not answered with the same name again'
rm "$tools/a_mac_named"

open_at 'http://192.168.7.7:3000'
touch "$tools/no_network_address"
expect 1 '        Connect this machine to a network, then run: ./alfera add team' '-' \
  'a machine on no network is told to connect to one first'
rm "$tools/no_network_address"

open_at 'http://192.168.8.8:3000'
expect 1 'FIX   http://192.168.8.8:3000 does not lead to this machine now: another server answers there, so no other machine can open Alfera or use a sign-in link' \
  '-' 'an address where another server answers is reported as such'

# An answer from this machine proves nothing about a public address or one behind a proxy: some
# networks give a machine no way to its own public address. So that is a warning, and a link is made.
open_at 'http://moved-away.example.com:3000'
expect 0 'WARN  http://moved-away.example.com:3000 gave no answer of this install when asked from this machine itself. Some networks give a machine no way to its own public address, so open it from another machine to be sure.' \
  'FIX' 'a public address that gives no answer from this machine is a warning, not a problem'
said 'and team link still makes the link there' 1 "$(helper_says team link | grep -c '^  http://moved-away.example.com:3000/join/')"
open_at 'http://192.168.7.7:3000'
sed -i.bak 's|^APP_BIND=.*|APP_BIND=127.0.0.1|' "$install/.env"
expect 0 'WARN  http://192.168.7.7:3000 gave no answer of this install' 'FIX' \
  'an address behind a proxy on this machine that gives no answer is a warning too'

# `add team` stores the address as a browser writes it, because the API compares it with what
# a browser sends: small letters, no dot at the end of the name, no path.
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
add_team_words="$(helper_says add team 'http://Office-Mac.local.:3000/')"
said 'add team stores a name typed with capitals in small letters, for the dashboard and for the API' \
  '0 NEXT_PUBLIC_APP_URL=http://office-mac.local:3000 ALLOWED_ORIGINS=http://office-mac.local:3000 1 1' \
  "$? $(setting NEXT_PUBLIC_APP_URL) $(setting ALLOWED_ORIGINS) $(grep -c '^Other machines can now open http://office-mac.local:3000$' <<<"$add_team_words") $(grep -c '^  http://office-mac.local:3000/join/' <<<"$add_team_words")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
add_team_words="$(helper_says add team http://192.168.7.7:3000)"
said 'add team at an address that does not lead to this machine says so, and makes no link' \
  "1 1 0" \
  "$? $(grep -c "^error: http://192.168.7.7:3000 $does_not_lead, so no sign-in link is made there. Run: ./alfera add team http://192.168.1.20:3000$" <<<"$add_team_words") $(grep -c '/join/' <<<"$add_team_words")"
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
said 'a program that runs add team reads the reason in the failed line' 1 \
  "$(helper_says add team http://192.168.7.7:3000 --progress | grep -c '^{"step":"add_team","state":"failed","reason":"address_does_not_lead_here","message":"That address does not lead to this server now.')"

said 'a name for https loses its capitals and the dot at its end' 'alfera.example.com' "$(helper_says https-name 'Alfera.Example.COM.')"

first_question='Type 1 or 2, then press Enter: '
model_question='Type the number of the model to use, then press Enter: '
if ! command -v python3 >/dev/null 2>&1; then
  echo 'skip  python3 is not on this machine, so no answer is typed at a terminal'
else
  write_env
  type_at_helper add model -- "$first_question=>\n" "$first_question=>2\n" 'Address: =>\n' \
    "$model_question=>\n" "$model_question=>1\n" 'model is set up.=>'
  said 'add model with a model the person hosts ends well' 0 "$?"
  said 'Enter at the first question chooses nothing, and the question comes once more' '2 2 1' \
    "$(shows 'Nothing was chosen.') $(shows "$first_question") $(shows 'No key yet? Get one at console.anthropic.com/settings/keys, platform.openai.com/api-keys or vercel.com/ai-gateway')"
  said 'the models of the server are a numbered list, and no name is asked for' '1 1 0' \
    "$(shows '   1  qwen3:14b') $(shows '   2  gemma3:4b') $(shows 'Model name')"
  said 'Enter at the list says which numbers there are' 1 "$(shows 'Type a number from 1 to 2.')"
  said 'the address, the model and an empty key are written, and the stack is started again' \
    'OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1 OPENAI_COMPATIBLE_MODEL=qwen3:14b OPENAI_COMPATIBLE_API_KEY= 1' \
    "$(setting OPENAI_COMPATIBLE_BASE_URL) $(setting OPENAI_COMPATIBLE_MODEL) $(setting OPENAI_COMPATIBLE_API_KEY) $(grep -c '^compose up -d$' "$work/docker.log")"

  write_env
  env_before="$(cksum <"$install/.env")"
  type_at_helper add model -- "$first_question=>2\n" 'Address: =>http://nothing-answers:11434/v1\n' \
    'Address: =>ollama\n' 'Address: =>b\n' "$first_question=>q\n"
  said 'q stops add model with its own exit status' 3 "$?"
  said 'a model server that does not answer is named in one sentence, with the way back' '1 2' \
    "$(shows 'Nothing answers at http://nothing-answers:11434/v1. Check the address and that the model server is running, then press Enter to look again.') $(shows 'To go back to the first choice, type b. To stop, type q.')"
  said 'a word that is not an address is told so' 1 \
    "$(shows '"ollama" is not an address. An address starts with http:// or https://, such as http://192.168.1.20:11434/v1.')"
  said 'the stop changed nothing, and started nothing' "$env_before 0" "$(cksum <"$install/.env") $(grep -c . "$work/docker.log")"

  type_at_helper add model -- "$first_question=>2\n" 'Address: =>http://one-model:8000/v1\n' \
    'Press Enter to use it: =>\n' 'Press Enter to use it: =>q\n'
  said 'a server with one model shows it and needs only Enter' 2 "$(shows 'The server at http://one-model:8000/v1 has one model: no-tools')"
  said 'a model that takes no tool is told in one sentence, with what to do when there is no other' '1 1' \
    "$(shows 'The model no-tools does not support tool calling, and Alfera needs it. Choose a model that does.') $(shows 'This server has no other model. Add one to it that supports tool calling, then press Enter to look again.')"
  said 'and .env is as it was' "$env_before" "$(cksum <"$install/.env")"

  write_env
  type_at_helper add model -- "$first_question=>2\n" 'Address: =>http://many-models:8000/v1\n' \
    "$model_question=>23\n" "$model_question=>vendor/model-23\n" 'model is set up.=>'
  said 'a server with many models shows twenty, and says how to take one of the others' '1 0 1' \
    "$(shows '  20  vendor/model-20') $(shows '  21  vendor/model-21') $(shows 'and 5 more. To use one of those, type its exact name.')"
  said 'a number past the list is told so, and the exact name is taken' '1 OPENAI_COMPATIBLE_MODEL=vendor/model-23' \
    "$(shows '"23" is not one of the choices.') $(setting OPENAI_COMPATIBLE_MODEL)"

  write_env
  env_before="$(cksum <"$install/.env")"
  type_at_helper add model -- "$first_question=>1\n" 'Key: =>sk-ant-refused-one\n' 'Key: =>sk-refused-two\n' \
    'Key: =>not-a-key\n' 'Key: =>b\n' "$first_question=>q\n"
  said 'a refused key names the provider that was asked' '1 1' \
    "$(shows 'Anthropic refused that key. Check that no character is missing at its start or its end, then paste it again.') $(shows 'OpenAI refused that key. Check that no character is missing at its start or its end, then paste it again.')"
  said 'a paste that is no key of the three providers says how each key starts' 1 \
    "$(shows 'An Anthropic key starts with sk-ant-, an OpenAI key with sk-, a Vercel AI Gateway key with vck_.')"
  said 'after three that did not work, the way back is offered, and b takes it' '1 2' \
    "$(shows 'That is 3 keys in a row that did not work. To go back to the first choice, type b. To stop, type q.') $(shows "$first_question")"
  said 'no key was shown, and .env is as it was' "0 $env_before" "$(grep -c 'refused-' "$work/terminal") $(cksum <"$install/.env")"

  type_at_helper add model -- "$first_question=>1\n" 'Key: =>\n' 'Key: =>\n' 'Key: =>\n'
  said 'an empty key says why one is needed, then the ways out, then stops by itself' '3 2 1 1' \
    "$? $(shows 'No key was pasted. Copy the whole key from the page of your provider, then paste it here.') $(shows 'To go back to the first choice, type b. To stop, type q.') $(shows 'There was no answer three times, so this stops here. Nothing was changed.')"

  type_at_helper add model -- "$first_question=>1\n" 'Key: =>^C'
  said 'Ctrl-C at a question ends add model' yes "$([ "$?" -ne 0 ] && echo yes || echo no)"
  said 'and leaves .env as it was, with no half-written copy next to it' "$env_before no" \
    "$(cksum <"$install/.env") $([ -e "$install/.env.next" ] && echo yes || echo no)"

  write_env 'OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1' 'OPENAI_COMPATIBLE_MODEL=qwen3:14b'
  type_at_helper add model -- "$first_question=>1\n" 'Key: =>sk-ant-accepted\n' 'then press Enter: =>y\n' 'model is set up.=>'
  said 'a key pasted on an install with a model server asks which one runs the chats' 1 \
    "$(shows 'Chats run on the model server at http://host.docker.internal:11434/v1 now, and it comes before a key.')"
  said 'yes writes the key and takes the address away' 'ANTHROPIC_API_KEY=sk-ant-accepted OPENAI_COMPATIBLE_BASE_URL=' \
    "$(setting ANTHROPIC_API_KEY) $(setting OPENAI_COMPATIBLE_BASE_URL)"

  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  env_before="$(cksum <"$install/.env")"
  type_at_helper add slack -- 'then press Enter: =>123.456\n' 'then press Enter: =>\n' 'then press Enter: =>\n' 'then press Enter: =>\n'
  stop_status="$?"
  said 'add slack says what it is for and what the person needs' '1 1' \
    "$(shows 'Talk to it in your Slack. Needs a public address.') $(shows 'You need a Slack app of your own, and a public https address for this install.')"
  said 'an empty value says why it is needed, and the third one stops' '3 2 1' \
    "$stop_status $(shows 'slack does not work without this value, so nothing is saved until every value is given.') $(shows 'There was no answer three times, so this stops here. Nothing was changed.')"
  said 'the one value that was given is not written: slack is not left half set up' "$env_before" "$(cksum <"$install/.env")"

  type_at_helper add slack -- 'then press Enter: =>123.456\n' 'then press Enter: =>slack-secret-one\n' \
    'then press Enter: =>slack-secret-two\n' 'then press Enter: =>https://alfera.example.com\n' 'slack is set up.=>'
  said 'every value of Slack is written together' \
    'SLACK_CLIENT_ID=123.456 SLACK_CLIENT_SECRET=slack-secret-one SLACK_SIGNING_SECRET=slack-secret-two API_PUBLIC_URL=https://alfera.example.com' \
    "$(setting SLACK_CLIENT_ID) $(setting SLACK_CLIENT_SECRET) $(setting SLACK_SIGNING_SECRET) $(setting API_PUBLIC_URL)"
  said 'a secret is not shown while it is typed' 0 "$(grep -c 'slack-secret' "$work/terminal")"

  type_at_helper add slack -- 'or give a new one: =>\n' 'or give a new one: =>slack-secret-new\n' \
    'or give a new one: =>\n' 'or give a new one: =>\n' 'slack is set up.=>'
  said 'on a second run Enter keeps a value, and a new one replaces it' \
    'SLACK_CLIENT_ID=123.456 SLACK_CLIENT_SECRET=slack-secret-new SLACK_SIGNING_SECRET=slack-secret-two' \
    "$(setting SLACK_CLIENT_ID) $(setting SLACK_CLIENT_SECRET) $(setting SLACK_SIGNING_SECRET)"

  type_at_helper add triggers -- 'then press Enter: =>trigger-secret-one\n' 'or give a new one: =>\n' 'triggers is set up.=>'
  said 'add triggers says what it is for and what the person needs' '1 1' \
    "$(shows 'Automations that start when something happens in an app. Needs apps and a public address.') $(shows 'You need apps set up, a public https address for this install, and a webhook subscription in your Composio project that calls it.')"
  said 'it writes the signing secret and keeps the public address that is set' \
    'COMPOSIO_WEBHOOK_SECRET=trigger-secret-one API_PUBLIC_URL=https://alfera.example.com' \
    "$(setting COMPOSIO_WEBHOOK_SECRET) $(setting API_PUBLIC_URL)"
  said 'the signing secret is not shown while it is typed' 0 "$(grep -c 'trigger-secret' "$work/terminal")"

  type_at_helper add search -- 'Type its number, then press Enter: =>\n' 'Type its number, then press Enter: =>2\n' \
    'then press Enter: =>brave-secret\n' 'search is set up.=>'
  said 'add search asks which key the person has, as a numbered choice' '1 1 1' \
    "$(shows '  1  Tavily API key') $(shows '  2  Brave Search API key') $(shows 'Type a number from 1 to 3.')"
  said 'and writes that one key' 'BRAVE_SEARCH_API_KEY=brave-secret' "$(setting BRAVE_SEARCH_API_KEY)"

  type_at_helper add team -- 'Address: =>my laptop\n' 'Address: =>http://localhost:3000\n' 'Address: =>\n' 'Then invite people=>'
  said 'add team says what the address is for, and what Enter takes' '1 1' \
    "$(shows 'People on other machines open Alfera at one address, and it must lead to this machine.') $(shows 'Press Enter for http://192.168.1.20:3000, or type another address.')"
  said 'with an address and no name on offer, it says that the address changes with the network' 1 \
    "$(shows 'That is the address of this machine on the network it is on now. When the machine changes network, run this command again.')"
  said 'an answer that is no address is told so, and the question comes again' 1 \
    "$(shows '"my laptop" is not an address. It starts with http:// or https://, such as http://192.168.1.20:3000.')"
  said 'a localhost address is told to be for this machine only, with the address to give' 1 \
    "$(shows 'http://localhost:3000 leads to this machine only, so no other machine can open it. Give the address other machines use, such as http://192.168.1.20:3000. To stop with nothing changed, type q.')"
  said 'Enter opens the install at the address of this machine on its network' \
    'APP_BIND=0.0.0.0 NEXT_PUBLIC_APP_URL=http://192.168.1.20:3000 1' \
    "$(setting APP_BIND) $(setting NEXT_PUBLIC_APP_URL) $(shows 'Other machines can now open http://192.168.1.20:3000')"
  said 'and status then says that other machines can open it' 1 \
    "$(PATH="$tools:$PATH" CURL_LOG="$work/curl.log" "$install/alfera" status 2>&1 | grep -c '^Mode       sign-in links, open to other machines   ')"

  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  env_before="$(cksum <"$install/.env")"
  touch "$tools/no_network_address"
  type_at_helper add team -- 'Address: =>\n' 'Address: =>\n' 'Address: =>\n'
  stop_status="$?"
  rm "$tools/no_network_address"
  said 'a machine with no address on a network gets no localhost default, and Enter is no answer' '3 1 0 2 1' \
    "$stop_status $(shows 'This machine shows no address on a network, so type the address other machines use, such as http://192.168.1.20:3000.') $(shows 'Press Enter for') $(shows 'No address was typed. To stop with nothing changed, type q.') $(shows 'That was not an address for other machines three times, so this stops here. Nothing was changed.')"
  said 'and .env is as it was' "$env_before" "$(cksum <"$install/.env")"

  # A laptop changes network, and its address with it. Its name stays, so the name is the
  # answer of Enter and the address is the second choice.
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  printf 'Office-Mac\n' >"$tools/a_mac_named"
  type_at_helper add team -- 'Address: =>\n' 'Then invite people=>'
  said 'on a Mac, add team offers the name of the machine first and says why, then its address' '1 1 1' \
    "$(shows 'Press Enter for http://office-mac.local:3000. That is the name of this machine, and it stays the same when the machine changes network.') $(shows 'Type 2 for http://192.168.1.20:3000. That is its address on the network it is on now, and it changes with the network.') $(shows 'Or type another address.')"
  said 'Enter opens the install at the name' 'NEXT_PUBLIC_APP_URL=http://office-mac.local:3000' "$(setting NEXT_PUBLIC_APP_URL)"
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  type_at_helper add team -- 'Address: =>2\n' 'Then invite people=>'
  said '2 opens it at the address' 'NEXT_PUBLIC_APP_URL=http://192.168.1.20:3000' "$(setting NEXT_PUBLIC_APP_URL)"
  rm "$tools/a_mac_named"

  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  printf 'Build-Box.lan\n' >"$tools/linux_with_avahi_named"
  type_at_helper add team -- 'Address: =>q\n'
  said 'on Linux the name is offered when avahi announces it' 1 "$(shows 'Press Enter for http://build-box.local:3000. That is the name of this machine')"
  rm "$tools/linux_with_avahi_named"

  # Every example the helper prints is at the port of this install.
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  sed -i.bak 's/^APP_PORT=.*/APP_PORT=3370/' "$install/.env"
  no_terminal_output="$(PATH="$tools:$PATH" DOCKER_LOG="$work/docker.log" python3 -c '
import os, sys
if os.fork():
    sys.exit(os.waitstatus_to_exitcode(os.wait()[1]))
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])' "$install/alfera" add team 2>&1 </dev/null | tail -1)"
  said 'add team with no address and no terminal names an address at the port of this install' \
    'error: this command asks one question, and there is no terminal to ask on. Give the address instead: ./alfera add team http://192.168.1.20:3370' \
    "$no_terminal_output"
  said 'and so does add team for a program' \
    'error: give the address people will open: ./alfera add team http://192.168.1.20:3370 --progress' \
    "$(helper_says add team --progress | grep '^error: ')"
  touch "$tools/no_network_address"
  type_at_helper add team -- 'Address: =>my laptop\n' 'Address: =>q\n'
  rm "$tools/no_network_address"
  said 'and so do the examples of the question itself, on a machine that shows no address' '1 1 0' \
    "$(shows 'so type the address other machines use, such as http://192.168.1.20:3370.') $(shows '"my laptop" is not an address. It starts with http:// or https://, such as http://192.168.1.20:3370.') $(shows ':3000')"

  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'COWORKER_MCP_PRIVATE_ADDRESSES=closed'
  env_before="$(cksum <"$install/.env")"
  type_at_helper add local-mcp -- 'Turn it on? Type y for yes or n for no, then press Enter: =>n\n'
  said 'add local-mcp says in two sentences what it opens and for whom, then asks for a yes' '3 1 1' \
    "$? $(shows 'This lets every owner and admin of this Alfera add MCP servers that run on this machine or on your private network.') $(shows 'Alfera then sends requests to the private addresses they give, so turn it on only if you trust each owner and admin with that.')"
  said 'a no changes nothing and restarts nothing' "$env_before 0 1" \
    "$(cksum <"$install/.env") $(grep -c . "$work/docker.log") $(shows 'Stopped. Nothing was changed.')"
  type_at_helper add local-mcp -- 'Turn it on? Type y for yes or n for no, then press Enter: =>y\n' 'local-mcp is on.=>'
  said 'a yes turns it on and restarts what reads it' '0 COWORKER_MCP_PRIVATE_ADDRESSES=open 1' \
    "$? $(setting COWORKER_MCP_PRIVATE_ADDRESSES) $(grep -c '^compose up -d$' "$work/docker.log")"

  # With no terminal and no --yes there is nobody to ask: one sentence, and nothing changes.
  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'COWORKER_MCP_PRIVATE_ADDRESSES=closed'
  env_before="$(cksum <"$install/.env")"
  : >"$work/docker.log"
  no_terminal_output="$(PATH="$tools:$PATH" DOCKER_LOG="$work/docker.log" python3 -c '
import os, sys
if os.fork():
    sys.exit(os.waitstatus_to_exitcode(os.wait()[1]))
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])' "$install/alfera" add local-mcp 2>&1 </dev/null)"
  said 'add local-mcp with no terminal and no --yes refuses with one sentence, and changes nothing' \
    "1 $env_before 0 error: this command asks for a yes, and there is no terminal to ask on, so give the yes on the command line: ./alfera add local-mcp --yes" \
    "$? $(cksum <"$install/.env") $(grep -c . "$work/docker.log") $no_terminal_output"

  write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
  env_before="$(cksum <"$install/.env")"
  type_at_helper add team -- 'Address: =>q\n'
  said 'q at the address of add team stops it with nothing changed' "3 $env_before" "$? $(cksum <"$install/.env")"
fi

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
rm -f "$install/secrets/master_key"
expect 1 'FIX   missing or under 32 characters: secrets/master_key' - 'the doctor names a missing master key file'

old_key='0123456789abcdef0123456789abcdef-the-key-of-an-older-install'
write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' "COWORKER_CREDENTIAL_ENCRYPTION_KEY=$old_key" 'COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS=an-older-key'
rm -rf "$install/secrets"
helper_says secret-files >/dev/null
said 'secret-files moves the master key and its fallbacks out of .env into files' \
  "$old_key an-older-key COWORKER_CREDENTIAL_ENCRYPTION_KEY= COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS=" \
  "$(cat "$install/secrets/master_key") $(cat "$install/secrets/master_key_fallbacks") $(grep '^COWORKER_CREDENTIAL_ENCRYPTION_KEY=' "$install/.env") $(grep '^COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS=' "$install/.env")"
said 'the secrets folder is closed to other accounts, and each file is read-only' \
  'drwx------ -r--r--r-- -r--r--r-- -r--r--r-- 0' \
  "$(ls -ld "$install/secrets" | cut -c1-10) $(ls -l "$install/secrets/master_key" | cut -c1-10) $(ls -l "$install/secrets/master_key_fallbacks" | cut -c1-10) $(ls -l "$install/secrets/setup_token_hash" | cut -c1-10) $(wc -c <"$install/secrets/setup_token_hash" | tr -d ' ')"
helper_says secret-files >/dev/null
said 'secret-files run again changes nothing' "$old_key an-older-key" \
  "$(cat "$install/secrets/master_key") $(cat "$install/secrets/master_key_fallbacks")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
rm -rf "$install/secrets"
helper_says secret-files >/dev/null
said 'an install with no master key gets a new one of 64 characters' 64 "$(tr -d '\n' <"$install/secrets/master_key" | wc -c | tr -d ' ')"

token_hash="$(printf '%s' 'a-setup-token' | shasum -a 256 | cut -d' ' -f1)"
ALFERA_SETUP_TOKEN_SHA256="$token_hash" helper_says secret-files >/dev/null
said 'the sha256 of the setup token is written for the API' "$token_hash" "$(cat "$install/secrets/setup_token_hash")"
said 'a setup token hash that is not 64 small hex characters stops with its reason' 1 \
  "$(ALFERA_SETUP_TOKEN_SHA256='not-a-hash' helper_says secret-files --progress | grep -c '"reason":"setup_token_not_usable"')"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
key_before="$(cat "$install/secrets/master_key")"
: >"$work/docker.log"
helper_says rotate-key >/dev/null
said 'rotate-key keeps the old key as a fallback, writes a new one, and restarts the API and the worker' \
  "$key_before yes 1" \
  "$(cat "$install/secrets/master_key_fallbacks") $([ "$(cat "$install/secrets/master_key")" != "$key_before" ] && echo yes || echo no) $(grep -c '^compose restart api worker$' "$work/docker.log")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
backup_words="$(helper_says backup)"
backup_made="$(ls "$install/backups")"
said 'backup saves the database in backups/, readable by this account only' \
  "the bytes of a dump -rw------- drwx------" \
  "$(cat "$install/backups/$backup_made") $(ls -l "$install/backups/$backup_made" | cut -c1-10) $(ls -ld "$install/backups" | cut -c1-10)"
said 'backup says the master key is not in the backup, and where it is' 1 \
  "$(grep -c "Keep a copy of $install/secrets/master_key away from this server" <<<"$backup_words")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'PRODUCT_VERSION=v1.0.0'
: >"$work/docker.log"
helper_says update v1.1.0 >/dev/null
said 'update saves the database, pulls the version and starts it' \
  "0 PRODUCT_VERSION=v1.1.0 1 1 1 0" \
  "$? $(grep '^PRODUCT_VERSION=' "$install/.env") $(grep -c 'pg_dump' "$work/docker.log") $(grep -c '^compose pull --quiet$' "$work/docker.log") $(grep -c '^compose up -d$' "$work/docker.log") $(grep -c 'pg_restore' "$work/docker.log")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'PRODUCT_VERSION=v1.0.0'
: >"$work/docker.log"
update_words="$(helper_says update missing --progress)"
said 'update to a version that does not download changes nothing and says why' \
  "PRODUCT_VERSION=v1.0.0 0 1" \
  "$(grep '^PRODUCT_VERSION=' "$install/.env") $(grep -c '^compose up -d$' "$work/docker.log") $(grep -c '"reason":"version_not_published"' <<<"$update_words")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted' 'PRODUCT_VERSION=v1.0.0'
: >"$work/docker.log"
update_words="$(helper_says update broken --progress)"
said 'update to a version that does not start goes back to the version and the database before' \
  "PRODUCT_VERSION=v1.0.0 1 1 1 2 1" \
  "$(grep '^PRODUCT_VERSION=' "$install/.env") $(grep -c 'dropdb' "$work/docker.log") $(grep -c 'createdb' "$work/docker.log") $(grep -c 'pg_restore' "$work/docker.log") $(grep -c '^compose up -d$' "$work/docker.log") $(grep -c '"reason":"update_rolled_back"' <<<"$update_words")"

write_env 'ANTHROPIC_API_KEY=sk-ant-accepted'
said 'with no public address anywhere, no name is made' 1 \
  "$(helper_says https-name auto --progress | grep -c '"reason":"public_address_unknown"')"
touch "$tools/on_digitalocean"
said 'on DigitalOcean the name comes from the metadata service' '203-0-113-7.sslip.io' "$(helper_says https-name auto)"
said 'ALFERA_NAME goes before the address' 'acme-203-0-113-7.sslip.io' "$(ALFERA_NAME=acme helper_says https-name auto)"
said 'an ALFERA_NAME with other characters stops with its reason' 1 \
  "$(ALFERA_NAME='Acme Inc' helper_says https-name auto --progress | grep -c '"reason":"bad_address"')"
said 'an ALFERA_NAME of more than 20 characters stops with its reason' 1 \
  "$(ALFERA_NAME='abcdefghijklmnopqrstu' helper_says https-name auto --progress | grep -c '"reason":"bad_address"')"
rm -f "$tools/on_digitalocean"
touch "$tools/on_aws"
said 'on AWS the name comes from the metadata service, with a token' '198-51-100-4.sslip.io' "$(helper_says https-name auto)"
rm -f "$tools/on_aws"

# The name of this machine goes to the API and the worker, which share one block of the compose
# file, and to no other service: not the database, the engine, the migrations or the web app.
compose_file="$here/docker-compose.yml"
shared_block="$(awk '/^x-workspace-access:/ { on = 1; next } /^[a-z]/ { on = 0 } on' "$compose_file")"
services_with_the_block="$(awk '/^  [a-z]+:$/ { service = $1 } /\*workspace_access/ { print service }' "$compose_file" | paste -sd' ' -)"
if [ "$(grep -c '"host.docker.internal:host-gateway"' "$compose_file")" = '1' ] &&
  grep -q '"host.docker.internal:host-gateway"' <<<"$shared_block" &&
  [ "$services_with_the_block" = 'api: worker:' ]; then
  echo 'ok    host.docker.internal is given to the API and the worker, and to no other service'
else
  echo "FAIL  host.docker.internal must be in the block that only the API and the worker share (found it for: $services_with_the_block)"
  failed=1
fi

# The helper and the API must call the same addresses "this machine only": the Team page shows
# what the API says. The API has its own test of its rule, in the open copy, where this test
# runs. It must hold every host this test tried, so one list is proven on both sides.
api_rule_test="$here/../packages/config/src/__tests__/team_mode_switch.test.ts"
if [ ! -f "$here/../package.json" ]; then
  echo 'skip  the test of the API is not next to this folder, so its hosts are not compared'
else
  hosts_the_api_does_not_test=''
  for host in $this_machine_only_hosts 192.168.1.20 127.example.lan; do
    grep -qsF -- "'$host'" "$api_rule_test" || hosts_the_api_does_not_test="$hosts_the_api_does_not_test $host"
  done
  if [ -z "$hosts_the_api_does_not_test" ]; then
    echo 'ok    the API is tested on every host this test asked the helper about'
  else
    echo "FAIL  $api_rule_test does not test:$hosts_the_api_does_not_test"
    failed=1
  fi
fi

# The doctor and the worker must name one helper image. The worker's file is here in the open
# copy, where this test runs. A whole copy that does not have that file moved it: the check
# must then fail, not pass by finding nothing.
worker_source="$here/../packages/runtime-platform/src/orchestrator/docker_sandbox_guard.ts"
if [ ! -f "$here/../package.json" ]; then
  echo 'skip  the worker source is not next to this folder, so its helper image is not compared'
elif grep -qsF "route_helper_image = '$helper_image'" "$worker_source"; then
  echo "ok    the doctor and the worker name one helper image, $helper_image"
else
  echo "FAIL  the doctor names the helper image $helper_image, and $worker_source does not"
  failed=1
fi

exit "$failed"
