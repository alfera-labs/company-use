#!/usr/bin/env bash
# Proves how a program runs install.sh and the helper: with no question, with one JSON line per
# step, and with the same result when it runs twice. Docker, curl and the model provider are
# stand-ins on PATH, so the test starts nothing, calls nobody, and needs no key. It prints one
# line per case (ok / FAIL) and exits 1 on any FAIL.
# Usage: deploy/test_install.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tools="$work/tools"
failed=0
mkdir -p "$tools"

# Docker builds and starts nothing. `compose up` leaves a file that says the stack runs, and
# every command line is written down. A file named build_breaks makes the build fail, one
# named build_is_slow makes it take two seconds, and one named no_container_starts makes
# `docker run` fail, as on a machine where no container starts.
cat >"$tools/docker" <<'STUB'
#!/usr/bin/env bash
state="$(dirname "$0")"
echo "docker $*" >>"$state/commands.log"
case "$*" in
  'manifest inspect '* | 'volume inspect '* | 'network inspect '*) exit 1 ;;
  'run --rm --quiet -v /var/run/docker.sock'*)
    [ ! -f "$state/no_container_starts" ] || { echo 'runc create failed: no container starts here' >&2; exit 125; }
    echo 988 ;;
  'info --format {{.MemTotal}}') cat "$state/memory_bytes" 2>/dev/null || echo 8000000000 ;;
  'compose build '*)
    [ ! -f "$state/build_is_slow" ] || sleep 2
    [ ! -f "$state/build_breaks" ] ;;
  'compose up -d') touch "$state/stack_runs" ;;
  'compose config --images') printf '%s\n' ghcr.io/alfera-labs/alfera-api:v-prepared caddy:2.11 ;;
  'compose ps --status running --services') [ ! -f "$state/stack_runs" ] || printf '%s\n' postgres engine api worker app ;;
esac
STUB

# The API and the dashboard answer once the stack runs. A key that holds "refused" is refused
# by the provider. A key comes on stdin, as a header for `-H @-`. A file named no_certificate
# makes the https address give no answer, as a name with no certificate does.
# No model server runs on this machine (port 11434). One runs at the host model-server: it
# lists two models, and each of them answers a request that holds a tool.
cat >"$tools/curl" <<'STUB'
#!/usr/bin/env bash
state="$(dirname "$0")"
echo "curl $*" >>"$state/commands.log"
headers_on_stdin=''
case "$*" in *'-H @-'*) headers_on_stdin="$(cat)" ;; esac
case "$*" in
  *api.anthropic.com*) case "$headers_on_stdin" in *refused*) printf '401' ;; *) printf '200' ;; esac ;;
  *api.openai.com*) case "$headers_on_stdin" in *openai-takes-it*) printf '200' ;; *another-provider* | *refused*) printf '401' ;; *) printf '000' ;; esac ;;
  *owner-link*) printf '{"data":{"token":"%s"}}' 'link_token_0123456789abcdefghijklmnopqrstuvw' ;;
  *localhost:11434*) printf '\n000'; exit 7 ;;
  *model-server*/models) printf '{"object":"list","data":[{"id":"qwen3:14b"},{"id":"gemma3:4b"}]}\n200' ;;
  *model-server*/chat/completions) printf '{"choices":[{"message":{"content":"ok"}}]}\n200' ;;
  *'%{http_code}'*) [ -f "$state/stack_runs" ] || { printf '000'; exit 0; }
    case "$*" in *--resolve*) [ ! -f "$state/no_certificate" ] || { printf '000'; exit 0; } ;; esac
    case "$*" in */sign-in) printf '401' ;; *) printf '200' ;; esac ;;
esac
STUB

# The account has the home folder the test names. The installer asks the account for its home
# and does not read HOME, so every run below gets a HOME that must stay empty.
cat >"$tools/getent" <<'STUB'
#!/usr/bin/env bash
[ "$1" = 'passwd' ] && printf '%s:x:0:0::%s:/bin/sh\n' "$2" "$(cat "$(dirname "$0")/account_home")"
STUB
# The machine of the test has no swap, whatever the machine the test runs on has.
printf '#!/usr/bin/env bash\necho "Swap: 0 0 0"\n' >"$tools/free"
# An install with a person at it opens the sign-in link in a browser. The test opens none.
printf '#!/usr/bin/env bash\necho "$0 $*" >>"$(dirname "$0")/commands.log"\n' >"$tools/open"
cp "$tools/open" "$tools/xdg-open"
chmod +x "$tools/docker" "$tools/curl" "$tools/getent" "$tools/free" "$tools/open" "$tools/xdg-open"
decoy_home="$work/a_home_nobody_may_use"
mkdir -p "$decoy_home"
# The folder every account shares, where an installer with no HOME once kept its lock.
shared_folder_now() {
  ls -lA /tmp/.alfera-install 2>&1 | cksum
}
shared_folder_before="$(shared_folder_now)"

# A clone with nothing in it but the install kit, so install.sh takes it for the source. Each
# clone gets an empty home folder, where the installer keeps its lock and its progress.
new_clone() {
  clone="$work/clone_$1"
  mkdir -p "$clone/apps/api" "$clone/deploy"
  touch "$clone/apps/api/Dockerfile"
  cp "$here/install.sh" "$here/alfera" "$here/docker-compose.yml" "$here/Caddyfile" \
    "$here/.env.selfhost.example" "$clone/deploy/"
  rm -f "$tools/stack_runs" "$tools/build_breaks" "$tools/build_is_slow" "$tools/no_container_starts" \
    "$tools/no_certificate" "$tools/memory_bytes" "$tools/commands.log"
  rm -rf "$work/home"
  mkdir -p "$work/home"
  printf '%s\n' "$work/home" >"$tools/account_home"
  state="$work/home/.alfera-install"
}

# The lock of the installer is the kernel's where `flock` exists, and a folder that names its
# owner elsewhere. These three put it in a state by hand, the way each kind keeps it.
process_name_of() {
  printf '%s.%s' "$1" "$(ps -o lstart= -p "$1" | LC_ALL=C tr -cd 'A-Za-z0-9')"
}

# hold_the_lock <seconds>: a process that holds the lock as a working install does. `holder`
# is its process id.
hold_the_lock() {
  mkdir -p "$state"
  chmod 0700 "$state"
  if command -v flock >/dev/null 2>&1; then
    (flock -n 8 && exec sleep "$1") 8>>"$state/flock" &
    holder="$!"
  else
    sleep "$1" &
    holder="$!"
    mkdir -p "$state/lock.d"
    : >"$state/lock.d/$(process_name_of "$holder")"
  fi
  sleep 0.5
}

# leave_a_lock_behind dead|reused: what an install that was killed leaves. `dead` names a
# process that is gone. `reused` names a process number that is alive again as another process.
leave_a_lock_behind() {
  local gone
  mkdir -p "$state"
  chmod 0700 "$state"
  : >"$state/works_apart"
  : >"$state/flock"
  sleep 30 &
  gone="$!"
  mkdir -p "$state/lock.d"
  if [ "$1" = 'dead' ]; then
    : >"$state/lock.d/$(process_name_of "$gone")"
    kill "$gone"
    wait "$gone" 2>/dev/null
  else
    : >"$state/lock.d/$gone.MonJan1000000199"
    reused_process="$gone"
  fi
  command -v flock >/dev/null 2>&1 && rm -rf "$state/lock.d"
  return 0
}

# run_installer <answers for stdin> <argument>...: stdout and stderr land in two files.
run_installer() {
  local answers="$1"
  shift
  printf '%s' "$answers" | HOME="$decoy_home" PATH="$tools:$PATH" bash "$clone/deploy/install.sh" "$@" \
    >"$work/stdout" 2>"$work/stderr"
}

run_helper() {
  PATH="$tools:$PATH" "$clone/deploy/alfera" "$@" >"$work/stdout" 2>"$work/stderr"
}

check() {
  if [ "$2" = "$3" ]; then
    printf 'ok    %s\n' "$1"
  else
    printf 'FAIL  %s: wanted %s, got %s\n' "$1" "$2" "$3"
    failed=1
  fi
}

# The steps of stdout, in order, as "step:state" words.
steps_on_stdout() {
  sed -n 's/^{"step":"\([a-z_]*\)","state":"\([a-z]*\)".*/\1:\2/p' "$work/stdout" | paste -sd' ' -
}

field_of_last_line() {
  tail -1 "$work/stdout" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"
}

lines_that_are_not_json() {
  grep -cv '^{"step":"[a-z_]*","state":"[a-z]*".*}$' "$work/stdout"
}

key='sk-ant-a-key-nobody-may-see'

new_clone first
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'an unattended install ends well' 0 "$?"
check 'it reports each step as it starts and ends, in order' \
  'tools:started tools:done docker:started docker:done source:started source:done settings:started settings:done api_image:started api_image:done app_image:started app_image:done start:started start:done api:started api:done dashboard:started dashboard:done install:done' \
  "$(steps_on_stdout)"
check 'stdout holds progress lines and nothing else' 0 "$(lines_that_are_not_json)"
check 'the last line says the install changed something' yes "$(field_of_last_line changed)"
check 'the last line names the address' 'http://localhost:3000' "$(field_of_last_line address)"
check 'the last line names the install folder' "$clone/deploy" "$(field_of_last_line install_dir)"
check 'the key from stdin is in .env' "ANTHROPIC_API_KEY=$key" "$(grep '^ANTHROPIC_API_KEY=' "$clone/deploy/.env")"
check 'the group of the Docker socket, read in a container, is in .env' 'DOCKER_GROUP_ID=988' "$(grep '^DOCKER_GROUP_ID=' "$clone/deploy/.env")"
check 'the key is on no command line' 0 "$(grep -c "$key" "$tools/commands.log")"
check 'the key is in no line the installer printed' 0 "$(cat "$work/stdout" "$work/stderr" | grep -c "$key")"
check 'no sign-in link is in what the installer printed' 0 "$(cat "$work/stdout" "$work/stderr" | grep -c '/join/')"
check 'no marker of a half-written .env is left' no "$([ -f "$clone/deploy/.env.unfinished" ] && echo yes || echo no)"
check 'the lock and the progress are in the home folder of the account, closed to others' 'drwx------' \
  "$(ls -ld "$state" | cut -c1-10)"
check 'nothing was written in the folder that HOME names' 0 "$(ls -A "$decoy_home" | wc -l | tr -d ' ')"
check 'the last line says the install has no https name' none "$(field_of_last_line name_kind)"

env_before="$(cksum <"$clone/deploy/.env")"
: >"$tools/commands.log"
run_installer '' --unattended --progress
check 'a second run on a finished install ends well' 0 "$?"
check 'it says that nothing changed' no "$(field_of_last_line changed)"
check 'it tells a person so too' 1 "$(grep -c 'Nothing was changed' "$work/stderr")"
check 'it leaves .env as it was' "$env_before" "$(cksum <"$clone/deploy/.env")"
check 'it builds nothing and starts nothing' 0 "$(grep -cE 'compose (build|up)' "$tools/commands.log")"
env -u HOME PATH="$tools:$PATH" bash "$clone/deploy/install.sh" --unattended --progress >"$work/stdout" 2>"$work/stderr" </dev/null
check 'with no HOME at all, a run finds the same install and the same folder' "no $shared_folder_before" \
  "$(field_of_last_line changed) $(shared_folder_now)"

new_clone half
touch "$tools/build_breaks"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'an install whose build breaks ends badly' 1 "$?"
check 'the failed line names the step' 'api_image:failed' "$(steps_on_stdout | awk '{ print $NF }')"
check 'the failed line names the reason' image_build_failed "$(field_of_last_line reason)"
check 'it writes exactly one failed line' 1 "$(grep -c '"state":"failed"' "$work/stdout")"
env_before="$(cksum <"$clone/deploy/.env")"
rm "$tools/build_breaks"
run_installer '' --unattended --progress
check 'a second run on that half-finished install finishes it' 'install:done yes' \
  "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line changed)"
check 'it keeps the .env the first run wrote' "$env_before" "$(cksum <"$clone/deploy/.env")"

new_clone marker
printf 'POSTGRES_PASSWORD=half\n' >"$clone/deploy/.env"
touch "$clone/deploy/.env.unfinished"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a .env that an earlier run left half-written is written again' 1 \
  "$(grep -c "^ANTHROPIC_API_KEY=$key" "$clone/deploy/.env")"

new_clone later_https
touch "$tools/build_breaks"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
rm "$tools/build_breaks"
run_installer '' --unattended --progress --https=late.example.com
check 'a half-finished plain install that is run again with --https gets the https address' \
  'https://late.example.com' "$(field_of_last_line address)"
check 'and its .env names the host' 1 "$(grep -cxF 'ALFERA_PUBLIC_HOST=late.example.com' "$clone/deploy/.env")"

new_clone no_container
touch "$tools/no_container_starts"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a Docker that starts no container stops the install with its reason' docker_socket_unreadable "$(field_of_last_line reason)"
check 'what Docker answered is in the log, not hidden' 1 "$(grep -c 'runc create failed' "$work/stderr")"
rm "$tools/no_container_starts"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'the next run starts over with a whole .env' 'install:done 1' \
  "$(steps_on_stdout | awk '{ print $NF }') $(grep -c "^ANTHROPIC_API_KEY=$key" "$clone/deploy/.env")"

new_clone small
echo 2000000000 >"$tools/memory_bytes"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a machine with 2 GB for Docker is told before the build, not after' not_enough_memory "$(field_of_last_line reason)"
check 'no build was started there' 0 "$(grep -c 'compose build' "$tools/commands.log")"

new_clone neutral_name
run_installer "MODEL_KEY=$key" --unattended --progress --answers-stdin
check 'a key under the neutral name MODEL_KEY goes under the name of its provider' \
  "ANTHROPIC_API_KEY=$key" "$(grep '^ANTHROPIC_API_KEY=' "$clone/deploy/.env")"
check 'the neutral name itself is not in .env' 0 "$(grep -c '^MODEL_KEY=' "$clone/deploy/.env")"
check 'nothing of the lock is left when the install has ended' 'no no' \
  "$([ -e "$state/lock.d" ] && echo yes || echo no) $([ -e "$state/works_apart" ] && echo yes || echo no)"

check 'the master key is not in .env' 0 "$(grep -c '^COWORKER_CREDENTIAL_ENCRYPTION_KEY=.' "$clone/deploy/.env")"
check 'the master key is a file of the secrets folder, with the two files that start empty' '65 0 0' \
  "$(wc -c <"$clone/deploy/secrets/master_key" | tr -d ' ') $(wc -c <"$clone/deploy/secrets/master_key_fallbacks" | tr -d ' ') $(wc -c <"$clone/deploy/secrets/setup_token_hash" | tr -d ' ')"

place_key() {
  new_clone "$1"
  run_installer "MODEL_KEY=$2" --unattended --progress --answers-stdin
  grep -E '^(ANTHROPIC|OPENAI|VERCEL_AI_GATEWAY|OPENROUTER|GEMINI)_API_KEY=.' "$clone/deploy/.env" | cut -d= -f1 | paste -sd' ' -
}
check 'an OpenRouter key goes under its own name' OPENROUTER_API_KEY "$(place_key openrouter sk-or-v1-a-key-of-openrouter)"
check 'a Google key goes under its own name' GEMINI_API_KEY "$(place_key google AIzaSy-a-key-of-google)"
check 'a gateway key goes under its own name' VERCEL_AI_GATEWAY_API_KEY "$(place_key gateway vck_a_key_of_the_gateway)"
check 'an OpenAI project key goes under its own name' OPENAI_API_KEY "$(place_key openai_project sk-proj-a-key-of-openai)"
check 'a key that starts with sk- only goes to OpenAI when OpenAI takes it' OPENAI_API_KEY "$(place_key openai_old sk-openai-takes-it)"
check 'a key that starts with sk- only and that OpenAI refuses is not used' '' "$(place_key other_sk sk-a-key-of-another-provider)"
check 'and with no key the unattended install stops and asks for one' model_key_missing "$(field_of_last_line reason)"
check 'a key that starts in no known way is not used' '' "$(place_key unknown xyz-a-key-of-nobody)"
check 'a Claude subscription token is not used' '' "$(place_key subscription sk-ant-oat01-short)"
check 'an OpenAI admin key is not used' '' "$(place_key admin sk-admin-short)"

new_clone not_root
run_installer '' --first-boot --progress
check 'a first boot that is not root stops before it changes the machine' \
  "$([ "$(id -u)" = '0' ] && echo skipped || echo bad_arguments)" \
  "$([ "$(id -u)" = '0' ] && echo skipped || field_of_last_line reason)"

new_clone bad_hash
ALFERA_SETUP_TOKEN_SHA256='not-a-hash' run_installer '' --unattended --progress
check 'a setup token hash that is not 64 small hex characters stops at once' 'setup_token_not_usable 0' \
  "$(field_of_last_line reason) $([ -f "$clone/deploy/.env" ] && echo 1 || echo 0)"

sandbox_source="$here/../packages/runtime-platform/src/orchestrator/context/docker_sandbox_protocol.ts"
sandbox_image="$(sed -n "s/^readonly sandbox_image='\(.*\)'$/\1/p" "$here/install.sh")"
if [ ! -f "$here/../package.json" ]; then
  echo 'skip  the worker source is not next to this folder, so its sandbox image is not compared'
else
  check 'install.sh pulls the sandbox image that the worker starts' 1 "$(grep -c "image: '$sandbox_image'" "$sandbox_source")"
fi

# An install that works apart from its connection is already going: a process that holds the
# lock, and the progress lines it has written so far. It writes its last lines two seconds
# later and lets the lock go a second after that.
new_clone second_run
hold_the_lock 3
: >"$state/works_apart"
printf '%s\n' '{"step":"tools","state":"started"}' '{"step":"tools","state":"done"}' '{"step":"docker","state":"started"}' >"$state/progress"
printf 'installing Docker\n' >"$state/log"
(sleep 1.5; printf '%s\n' '{"step":"docker","state":"done"}' '{"step":"install","state":"done","changed":"yes","address":"http://localhost:3000","install_dir":"/somewhere"}' >>"$state/progress") &
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin --install-docker
check 'a second run while a first one works ends as the first one does' 0 "$?"
check 'it shows the progress of the first one, from the start to the end' \
  'tools:started tools:done docker:started docker:done install:done' "$(steps_on_stdout)"
check 'it shows the words of the first one' 1 "$(grep -c 'installing Docker' "$work/stderr")"
check 'it starts no step of its own: no Docker command, no .env' '0 no' \
  "$(grep -c . "$tools/commands.log" 2>/dev/null || echo 0) $([ -f "$clone/deploy/.env" ] && echo yes || echo no)"
wait

new_clone interrupted
hold_the_lock 2
: >"$state/works_apart"
printf '%s\n' '{"step":"api_image","state":"started"}' >"$state/progress"
: >"$state/log"
run_installer '' --unattended --progress
check 'a first install that dies without a word is reported as interrupted, at its step' \
  'api_image:failed install_interrupted' "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line reason)"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'the run after that does the work' 'install:done yes' "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line changed)"
wait

new_clone person_at_work
hold_the_lock 20
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'while a person runs the installer at a terminal, a second run says so and does nothing' \
  install_running "$(field_of_last_line reason)"
check 'the sentence says to try again' 'Setup is still running on this server. Try again in a minute.' "$(field_of_last_line message)"
kill "$holder" 2>/dev/null
wait "$holder" 2>/dev/null

new_clone dead_worker
leave_a_lock_behind dead
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a lock left by an install that was killed is taken over, and the work is done' 'install:done yes' \
  "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line changed)"

new_clone reused_number
leave_a_lock_behind reused
# What an older installer left: a process number in a file. That number is alive, as another process.
mkdir -p "$state/lock" && echo "$reused_process" >"$state/lock/pid"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a lock whose process number now belongs to another live process is taken over too' 'install:done yes' \
  "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line changed)"
kill "$reused_process" 2>/dev/null
wait "$reused_process" 2>/dev/null

# Six runs start at the same moment over a lock that a killed install left. Each of them sees
# that the lock is free to take. Only one may take it.
new_clone six_at_once
leave_a_lock_behind dead
touch "$tools/build_is_slow"
for run in 1 2 3 4 5 6; do
  printf 'ANTHROPIC_API_KEY=%s' "$key" | HOME="$decoy_home" PATH="$tools:$PATH" bash "$clone/deploy/install.sh" \
    --unattended --progress --answers-stdin >"$work/stdout_$run" 2>/dev/null &
done
wait
check 'of six runs started at the same moment over a lock left behind, exactly one does the work' '1 1 1' \
  "$(grep -c 'compose build api' "$tools/commands.log") $(grep -c 'compose build app' "$tools/commands.log") $(grep -c 'compose up -d' "$tools/commands.log")"
check 'and all six end with the last line of that one install' 6 \
  "$(tail -q -n 1 "$work"/stdout_[1-6] | grep -c '"step":"install","state":"done","changed":"yes"')"
rm "$tools/build_is_slow"

# The folder of the lock must be this account's own, and no link is followed in it.
new_clone linked_folder
mkdir -p "$work/elsewhere"
ln -s "$work/elsewhere" "$state"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'a state folder that is a link stops the install' state_folder_not_safe "$(field_of_last_line reason)"
check 'nothing was written where the link points, and no .env' '0 no' \
  "$(ls -A "$work/elsewhere" | wc -l | tr -d ' ') $([ -f "$clone/deploy/.env" ] && echo yes || echo no)"
rm "$state"

new_clone other_owner
if [ "$(id -u)" = '0' ]; then
  mkdir -p "$state" && chown 12345 "$state"
  run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
  check 'a state folder that belongs to another account stops the install' state_folder_not_safe "$(field_of_last_line reason)"
  check 'nothing was written in it' 0 "$(ls -A "$state" | wc -l | tr -d ' ')"
else
  echo 'skip  only root can make a folder that belongs to another account, so that case runs as root only'
fi

new_clone linked_files
mkdir -p "$state" && chmod 0700 "$state"
printf 'keep me\n' >"$work/victim_one"
printf 'keep me\n' >"$work/victim_two"
ln -s "$work/victim_one" "$state/log"
ln -s "$work/victim_two" "$state/progress"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'links left where the log and the progress go are not followed' 'keep me keep me' \
  "$(cat "$work/victim_one" "$work/victim_two" | paste -sd' ' -)"
check 'the install made its own two files there and ended well' 'file file install:done' \
  "$([ ! -L "$state/log" ] && [ -f "$state/log" ] && echo file) $([ ! -L "$state/progress" ] && [ -f "$state/progress" ] && echo file) $(steps_on_stdout | awk '{ print $NF }')"

new_clone no_home_folder
printf '%s\n' "$work/no_such_home" >"$tools/account_home"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
check 'an account with no home folder stops the install: no shared folder is used in its place' \
  "state_folder_not_safe $shared_folder_before" "$(field_of_last_line reason) $(shared_folder_now)"

new_clone no_key
run_installer '' --unattended --progress
check 'with no key, an unattended install stops and asks nobody' 1 "$?"
check 'the reason is the missing key' model_key_missing "$(field_of_last_line reason)"
check 'the sentence for a person holds no command' 'No model key was given. Enter your model key, then try again.' \
  "$(field_of_last_line message)"
check 'nothing was written' no "$([ -f "$clone/deploy/.env" ] && echo yes || echo no)"

new_clone refused
run_installer 'ANTHROPIC_API_KEY=sk-ant-refused' --unattended --progress --answers-stdin
check 'a key the provider refuses stops the install with its reason' model_key_refused "$(field_of_last_line reason)"

new_clone arguments
run_installer '' --unattended --progress --no-such-argument
check 'an argument the installer does not know stops it with its reason' bad_arguments "$(field_of_last_line reason)"
run_installer 'DATABASE_URL=postgres://elsewhere' --unattended --progress --answers-stdin
check 'a line on stdin that is not an answer stops it with its reason' bad_arguments "$(field_of_last_line reason)"

new_clone person
run_installer '' --unattended </dev/null
check 'without --progress, stdout holds no JSON line' 0 "$(grep -c '^{' "$work/stdout")"

new_clone https
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin --https=Alfera.Example.com
check 'an install with --https ends well' 0 "$?"
check 'it waits for the certificate as its own step' 1 "$(steps_on_stdout | grep -c 'https:started https:done install:done')"
check 'the address is the https name, in small letters' 'https://alfera.example.com' "$(field_of_last_line address)"
check 'the last line says the name is a domain of the person' own "$(field_of_last_line name_kind)"
check 'no word about a shared name is printed for it' 0 "$(grep -c 'everyone shares' "$work/stderr")"
for line in 'COMPOSE_PROFILES=https' 'ALFERA_PUBLIC_HOST=alfera.example.com' 'APP_BIND=127.0.0.1' \
  'NEXT_PUBLIC_APP_URL=https://alfera.example.com' 'NEXT_PUBLIC_API_URL=https://alfera.example.com' \
  'API_PUBLIC_URL=https://alfera.example.com' 'COWORKER_AUTH_MODE=team'; do
  check ".env holds $line" 1 "$(grep -cxF "$line" "$clone/deploy/.env")"
done
check 'the API allows the https origin' 1 "$(grep -c '^ALLOWED_ORIGINS=.*https://alfera.example.com' "$clone/deploy/.env")"
check 'the settings were written before the dashboard was built' 'settings then build' \
  "$(awk '/"step":"settings","state":"done"/ { s = NR } /"step":"app_image","state":"started"/ { b = NR } END { print (s < b) ? "settings then build" : "wrong order" }' "$work/stdout")"
run_installer '' --unattended --progress --https=other.example.com
check 'a finished install asked for another https name says so and changes nothing' \
  installed_with_other_address "$(field_of_last_line reason)"

run_helper team link 10 --progress
check 'the helper prints the owner link as one progress line' 1 "$(wc -l <"$work/stdout" | tr -d ' ')"
check 'the link is at the https address' \
  'https://alfera.example.com/join/link_token_0123456789abcdefghijklmnopqrstuvw' "$(field_of_last_line link)"
check 'the link is in no line for a log' 0 "$(grep -c '/join/' "$work/stderr")"

env_before="$(cksum <"$clone/deploy/.env")"
run_helper add team http://192.168.1.20:3000 --progress
check 'on an https install, add team with a plain address is refused' served_over_https "$(field_of_last_line reason)"
check 'the plain port stays on this machine, and nothing in .env changed' "$env_before" "$(cksum <"$clone/deploy/.env")"

touch "$tools/no_certificate"
: >"$tools/commands.log"
run_helper team link 10 --progress
check 'with no certificate at the name, no sign-in link is made' certificate_not_issued "$(field_of_last_line reason)"
check 'no link is printed, and the API is not asked for one' '0 0' \
  "$(cat "$work/stdout" "$work/stderr" | grep -c '/join/') $(grep -c 'owner-link' "$tools/commands.log")"
rm "$tools/no_certificate"

: >"$tools/commands.log"
run_helper add https second.example.com --progress
check 'add https reports its steps' \
  'settings:started settings:done restart:started restart:done dashboard:started dashboard:done https:started https:done add_https:done' \
  "$(steps_on_stdout)"
check 'add https names the new address' 'https://second.example.com' "$(field_of_last_line address)"
check 'add https builds nothing: the dashboard reads its address when it starts' 0 "$(grep -c 'compose build' "$tools/commands.log")"
run_helper https-name 'has a space.example.com'
check 'a name with a space is refused' 1 "$?"
run_helper https-name https://Third.Example.com/
check 'a name given as an address is cut down to the host' third.example.com "$(cat "$work/stdout")"

new_clone plain_helper
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
run_helper add team http://192.168.1.20:3000 --progress
check 'add team reports its steps' \
  'settings:started settings:done restart:started restart:done dashboard:started dashboard:done add_team:done' "$(steps_on_stdout)"
check 'add team with --progress prints no sign-in link' 0 "$(cat "$work/stdout" "$work/stderr" | grep -c '/join/')"
run_helper add team --progress
check 'add team with no address asks nobody and says why' address_missing "$(field_of_last_line reason)"
run_helper add team ftp://nowhere --progress
check 'add team refuses an address that is not http' bad_address "$(field_of_last_line reason)"

sed -i.bak 's/^WORKOS_API_KEY=.*/WORKOS_API_KEY=sk_test/; s/^WORKOS_CLIENT_ID=.*/WORKOS_CLIENT_ID=client_test/' "$clone/deploy/.env"
env_before="$(cksum <"$clone/deploy/.env")"
run_helper add https 203-0-113-7.sslip.io --progress
check 'with WorkOS sign-in, add https refuses a name on a shared name service' own_domain_needed "$(field_of_last_line reason)"
check 'and writes nothing' "$env_before" "$(cksum <"$clone/deploy/.env")"

new_clone shared_name
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin --https=203-0-113-7.sslip.io
check 'an install at a name of the shared name service says so in its last line' \
  'https://203-0-113-7.sslip.io shared' "$(field_of_last_line address) $(field_of_last_line name_kind)"
check 'and tells the person that the name is for trying things out' 1 "$(grep -c 'for trying things out' "$work/stderr")"
run_helper add sign-in --progress
check 'on that install, WorkOS sign-in is refused until the name is a domain' own_domain_needed "$(field_of_last_line reason)"
run_helper add https own.example.com --progress
check 'add https says which kind the new name is' own "$(field_of_last_line name_kind)"

new_clone workos_shared
run_installer "$(printf 'ANTHROPIC_API_KEY=%s\nWORKOS_API_KEY=sk_test\nWORKOS_CLIENT_ID=client_test' "$key")" \
  --unattended --progress --answers-stdin --https=203-0-113-7.sslip.io
check 'an install with WorkOS sign-in refuses a name on a shared name service' own_domain_needed "$(field_of_last_line reason)"
check 'and writes nothing' no "$([ -f "$clone/deploy/.env" ] && echo yes || echo no)"

check 'the Caddyfile tells a browser to come back over https only' 1 \
  "$(grep -c '^	header Strict-Transport-Security "max-age=31536000"$' "$here/Caddyfile")"

# A value with a dollar sign, a quote, a backslash or " #" comes back as it was typed: from the
# reader of each script, and from Docker Compose, which reads the same file for the containers.
real_docker="$(command -v docker || true)"
all_printable="$(awk 'BEGIN { for (code = 32; code < 127; code++) printf "%c", code }')"
source_of() {
  awk -v name="$2() {" '$0 == name { on = 1 } on { print } on && $0 == "}" { exit }' "$here/$1"
}
check_settings_of() {
  local script="$1" writer="$2" reader="$3" folder="$work/settings_$1" number=0 different=0 value
  mkdir -p "$folder"
  (
    install_dir="$folder" env_file="$folder/.env"
    : >"$env_file"
    fail() { exit 1; }
    eval "$(source_of "$script" "$writer")"
    eval "$(source_of "$script" "$reader")"
    for value in "$all_printable" 'sk-abc$HOME-and$1tail${X}$$' 'value #not-a-comment' "'leading quote" \
      '"leading double quote' "a\\'b\\\"c" '  spaces around  ' 'a\b\\c\t\n' 'ends with a backslash\' 'plain-value_1.2:3/4' ''; do
      number=$((number + 1))
      "$writer" "KEY_$number" "$value"
      printf '%s' "$value" >"$folder/wanted_$number"
      [ "$("$reader" "KEY_$number")" = "$value" ] || different=$((different + 1))
    done
    exit "$different"
  )
  check "$script reads back every value as it was written, each printable character among them" 0 "$?"
  if [ -z "$real_docker" ] || ! "$real_docker" compose version >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    echo "skip  Docker Compose is not on this machine, so what it makes of the values of $script is not compared"
    return
  fi
  printf 'services:\n  s:\n    image: busybox:1.37\n    env_file: .env\n' >"$folder/compose.yml"
  check "Docker Compose gives the containers the same values, with no warning" 'same 0' \
    "$(cd "$folder" && "$real_docker" compose config --format json 2>warnings | python3 -c '
import json, sys
given = json.load(sys.stdin)["services"]["s"]["environment"]
wanted = {f"KEY_{n}": open(f"wanted_{n}").read() for n in range(1, 12)}
print("same" if all((given.get(k) or "").replace("$$", "$") == v for k, v in wanted.items()) else "different")
') $(wc -l <"$folder/warnings" | tr -d ' ')"
}
check_settings_of install.sh set_env_value read_env_value
check_settings_of alfera write_setting read_setting

new_clone hard_key
hard_key='sk-a$HOME${X} #b"c'"'"'d\e'
run_installer "OPENAI_API_KEY=$hard_key" --unattended --progress --answers-stdin
check 'a key with a dollar sign, a quote, a backslash and " #" is installed' 'install:done' "$(steps_on_stdout | awk '{ print $NF }')"
check 'the helper reads that key back as it was typed' "$hard_key" \
  "$(env_file="$clone/deploy/.env"; eval "$(source_of alfera read_setting)"; read_setting OPENAI_API_KEY)"

# A progress line is JSON for a strict parser, whatever is in a path, an address or a message.
hostile="$(printf 'a\033b\010c\001d"e\\f\ng\177h')"
for script in install.sh alfera; do
  if ! command -v python3 >/dev/null 2>&1; then
    echo 'skip  python3 is not on this machine, so no strict parser reads the progress lines'
    break
  fi
  (
    progress='yes' current_step='install'
    eval "$(source_of "$script" json_text)"
    eval "$(source_of "$script" report_progress)"
    report_progress done install_dir "$hostile" address "$hostile" message "$hostile" 3>"$work/hostile_line"
  )
  check "a line of $script with control characters, a quote and a backslash is read by a strict parser" \
    'one line, three values, no control character' \
    "$(python3 -c '
import json, sys
lines = open(sys.argv[1]).read().split("\n")
line = json.loads(lines[0])
values = [line["install_dir"], line["address"], line["message"]]
clean = all(ord(c) >= 32 and ord(c) != 127 for v in values for c in v) and all("\"e\\f" in v for v in values)
print("one line, three values, no control character" if len(lines) == 2 and lines[1] == "" and clean else "wrong")
' "$work/hostile_line" 2>&1 | tail -1)"
done

new_clone "$(printf 'odd\033\010\001"\\name')"
run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
if command -v python3 >/dev/null 2>&1; then
  check 'an install in a folder with such a name ends well, and every line it wrote is strict JSON' 'install done' \
    "$(python3 -c '
import json, sys
lines = [json.loads(line) for line in open(sys.argv[1]).read().splitlines()]
print(lines[-1]["step"], lines[-1]["state"])' "$work/stdout" 2>&1 | tail -1)"
fi

# A person at a terminal. The installer asks on /dev/tty, so each case below runs it at a
# terminal of its own and types the answers: `text to wait for=>text to type`.
# type_at_installer <step>...: what the terminal showed lands in $work/terminal.
type_at_installer() {
  HOME="$decoy_home" PATH="$tools:$PATH" python3 "$here/type_at_a_terminal.py" "$work/terminal" "$@" \
    -- bash "$clone/deploy/install.sh" >/dev/null 2>&1
}

shows() {
  grep -cF -- "$1" "$work/terminal"
}

# What a stop at a question may leave in the install folder: nothing of a .env.
env_files_left() {
  (cd "$clone/deploy" && ls -A | grep -E '^\.env($|\.next$|\.unfinished$)' | paste -sd' ' -)
}

first_question='Type 1 or 2, then press Enter: '
if ! command -v python3 >/dev/null 2>&1; then
  echo 'skip  python3 is not on this machine, so no answer is typed at a terminal'
else
  new_clone enter_at_first_question
  type_at_installer "$first_question=>\n" "$first_question=>q\n"
  check 'Enter at the first question chooses nothing, and q then stops the install' 1 "$?"
  check 'the first question is a numbered choice with one line for each way' '1 1 1 1' \
    "$(shows '  1  Paste an API key') $(shows 'You need a key from Anthropic, OpenAI or Vercel AI Gateway.') $(shows '  2  Use a model I host') $(shows 'You need a model server that runs now on this machine or your network')"
  check 'after Enter it says that nothing was chosen, and where a key comes from' '1 1' \
    "$(shows 'Nothing was chosen.') $(shows 'No key yet? Get one at console.anthropic.com/settings/keys, platform.openai.com/api-keys or vercel.com/ai-gateway')"
  check 'the question comes again, once' 2 "$(shows "$first_question")"
  check 'Enter did not lead to the questions about a model server' 0 "$(shows 'Address')"
  check 'the stop says that nothing was changed, and what to do' '1 1' \
    "$(shows 'Stopped. Nothing was changed.') $(shows 'No model was chosen, so Alfera was not installed. Run this again when you have a key or a model server.')"
  check 'nothing of a .env is left, and the lock is free' ' no' \
    "$(env_files_left) $([ -e "$state/lock.d" ] && echo yes || echo no)"

  new_clone enter_three_times
  type_at_installer "$first_question=>\n" "$first_question=>\n" 'To stop with nothing changed, type q.=>' "$first_question=>\n"
  check 'Enter three times at the first question stops the install by itself' '1 1' \
    "$? $(shows 'There was no choice three times, so this stops here. Nothing was changed.')"

  new_clone no_model_server
  type_at_installer "$first_question=>2\n" 'Address: =>\n' 'Address: =>b\n' "$first_question=>q\n"
  check 'with no model server on this machine, the installer says so in one sentence' 1 \
    "$(shows 'No model server was found on this machine: nothing answers at http://localhost:11434/v1.')"
  check 'it says how to start one, and how to go back or stop' '1 1' \
    "$(shows 'Start one, for example Ollama (ollama.com), then press Enter to look again. Or type another address.') $(shows 'To go back to the first choice, type b. To stop, type q.')"
  check 'it asks for no model name there' 0 "$(shows 'Model name')"
  check 'b goes back to the first choice' 2 "$(shows "$first_question")"
  check 'and nothing of a .env is left' '' "$(env_files_left)"

  new_clone enter_at_model_list
  model_question='Type the number of the model to use, then press Enter: '
  type_at_installer "$first_question=>2\n" 'Address: =>http://model-server:8000/v1\n' \
    "$model_question=>\n" "$model_question=>1\n" 'Alfera is running at=>'
  check 'an install on a model the person hosts ends well' 0 "$?"
  check 'the models of the server are a numbered list' '1 1' "$(shows '   1  qwen3:14b') $(shows '   2  gemma3:4b')"
  check 'Enter at the list says that nothing was chosen, and which numbers there are' '1 1' \
    "$(shows 'Nothing was chosen.') $(shows 'Type a number from 1 to 2.')"
  check 'the question about the model comes twice, not more' 2 "$(shows "$model_question")"
  check 'the address and the model are in .env' \
    'OPENAI_COMPATIBLE_BASE_URL=http://model-server:8000/v1 OPENAI_COMPATIBLE_MODEL=qwen3:14b' \
    "$(grep -E '^OPENAI_COMPATIBLE_(BASE_URL|MODEL)=' "$clone/deploy/.env" | paste -sd' ' -)"
  check 'no marker of a half-written .env is left after it' '.env' "$(env_files_left)"

  new_clone refused_three_times
  type_at_installer "$first_question=>1\n" 'Key: =>sk-ant-refused-one\n' 'Key: =>sk-ant-refused-two\n' \
    'Key: =>sk-ant-refused-three\n' 'Key: =>b\n' "$first_question=>1\n" "Key: =>$key\n" 'Alfera is running at=>'
  check 'after three refused keys and a way back, a good key installs' 0 "$?"
  check 'each refusal names the provider and says to look for a missing character' 3 \
    "$(shows 'Anthropic refused that key. Check that no character is missing at its start or its end, then paste it again.')"
  check 'after the third one it offers the way back' 1 \
    "$(shows 'That is 3 keys in a row that did not work. To go back to the first choice, type b. To stop, type q.')"
  check 'the good key is in .env' "ANTHROPIC_API_KEY=$key" "$(grep '^ANTHROPIC_API_KEY=' "$clone/deploy/.env")"
  check 'no key was shown on the terminal, and none is on a command line' '0 0' \
    "$(grep -c 'sk-ant-' "$work/terminal") $(grep -c 'sk-ant-' "$tools/commands.log")"
  check 'the sign-in link went to the browser stand-in, not to a real browser' 1 "$(grep -cE '/(open|xdg-open) .*/join/' "$tools/commands.log")"

  new_clone ctrl_c_at_a_question
  type_at_installer "$first_question=>1\n" 'Key: =>^C'
  check 'Ctrl-C at a question ends the install' yes "$([ "$?" -ne 0 ] && echo yes || echo no)"
  check 'and leaves no .env, no half-written copy of one, and no lock' ' no' \
    "$(env_files_left) $([ -e "$state/lock.d" ] && echo yes || echo no)"
  run_installer "ANTHROPIC_API_KEY=$key" --unattended --progress --answers-stdin
  check 'the next run on that folder installs' 'install:done yes' "$(steps_on_stdout | awk '{ print $NF }') $(field_of_last_line changed)"

  new_clone unattended_asks_nothing
  HOME="$decoy_home" PATH="$tools:$PATH" python3 "$here/type_at_a_terminal.py" "$work/terminal" \
    -- bash "$clone/deploy/install.sh" --unattended >/dev/null 2>&1
  check 'with a terminal and --unattended, no question is asked and the reason is the same' '1 0 1' \
    "$? $(shows "$first_question") $(shows 'There is no model key.')"
fi

address_step_with() {
  local metadata_address="$1" on_the_card="$2" uptime="$3"
  shift 3
  (
    [ "$#" -eq 0 ] || export "$@"
    eval "$(awk '/^readonly (reserved_address|seconds_between_address_checks|most_address_checks)=/' "$here/install.sh")"
    eval "$(awk '/^(address_is_final|address_can_be_used|check_the_reserved_address|wait_for_a_stable_public_address)\(\) \{$/,/^}$/' "$here/install.sh")"
    install_dir="$(mktemp -d)"
    printf '#!/bin/sh\necho %s\n' "$metadata_address" >"$install_dir/alfera"
    chmod +x "$install_dir/alfera"
    seconds_up_before_a_cloud_address_is_final=120
    seconds_up() { echo "$uptime"; }
    address_is_on_this_machine() { [ "$on_the_card" = yes ]; }
    sleep() { :; }
    print_step() { echo "stable after $checks"; }
    fail() { echo "$1 after $checks"; exit 0; }
    wait_for_a_stable_public_address
    rm -rf "$install_dir"
  )
}

check 'with no reserved address, an address on the network card is final after two equal reads, as on DigitalOcean' \
  'stable after 2' "$(address_step_with 203.0.113.7 yes 30)"
check 'with no reserved address, a metadata address waits for two minutes of uptime, as on Lightsail' \
  'public_address_not_stable after 121' "$(address_step_with 203.0.113.7 no 30)"
check 'with no reserved address, a metadata address is final once the server has run two minutes' \
  'stable after 2' "$(address_step_with 203.0.113.7 no 130)"
check 'a reserved address that the metadata shows is final at the first read' \
  'stable after 1' "$(address_step_with 203.0.113.9 no 30 ALFERA_PUBLIC_ADDRESS=203.0.113.9)"
check 'a reserved address that the metadata never shows stops at the cap with its reason, and never hangs' \
  'public_address_not_stable after 121' "$(address_step_with 203.0.113.7 no 900 ALFERA_PUBLIC_ADDRESS=203.0.113.9)"
check 'a reserved address that is not an IPv4 address stops before the first read' \
  'public_address_not_stable after 0' "$(address_step_with 203.0.113.7 no 30 'ALFERA_PUBLIC_ADDRESS=203.0.113.7;reboot')"

prepared="$work/prepared"
new_clone prepared
mkdir -p "$prepared"
cp "$here/install.sh" "$here/alfera" "$here/docker-compose.yml" "$here/Caddyfile" "$here/.env.selfhost.example" "$prepared/"
printf 'v-prepared\n' >"$prepared/baked_version"
printf '%s\n' "$work/home" >"$tools/account_home"
printf "ANTHROPIC_API_KEY=$key" | HOME="$decoy_home" PATH="$tools:$PATH" INSTALL_DIR="$prepared" PRODUCT_VERSION=v-prepared \
  bash "$prepared/install.sh" --unattended --progress --answers-stdin >"$work/stdout" 2>"$work/stderr"
check 'an install in a folder baked for its version ends well' 0 "$?"
check 'it uses the baked files and images: it downloads no file, asks the registry nothing and pulls nothing' '0 0 0' \
  "$(grep -c "curl -fsSL .*docker-compose.yml" "$tools/commands.log") $(grep -c 'manifest inspect' "$tools/commands.log") $(grep -c 'compose pull' "$tools/commands.log")"
check 'it still reports the images step' 'images:started images:done' \
  "$(steps_on_stdout | tr ' ' '\n' | grep '^images:' | paste -sd' ' -)"
printf 'v-other\n' >"$prepared/baked_version"
rm -f "$prepared/.env"
new_clone prepared_for_another_version
printf "ANTHROPIC_API_KEY=$key" | HOME="$decoy_home" PATH="$tools:$PATH" INSTALL_DIR="$prepared" PRODUCT_VERSION=v-prepared \
  PRODUCT_REPOSITORY="$work/no_repository" bash "$prepared/install.sh" --unattended --progress --answers-stdin >"$work/stdout" 2>"$work/stderr"
check 'a folder baked for another version is not taken for this one' '1 source_download_failed' \
  "$(grep -c 'manifest inspect' "$tools/commands.log") $(field_of_last_line reason)"

# Every way out has a reason a program can read, and the guide lists each one.
guide="$here/../SELF_HOSTING.md"
for script in install.sh alfera; do
  calls_without_reason="$(grep -nE '(^|[ (|&]) *fail +["'"'"']' "$here/$script" | grep -vc 'fail "\$')"
  if [ "$script" = 'install.sh' ]; then
    check "every fail of $script names a reason" 0 "$calls_without_reason"
  fi
  [ -f "$guide" ] || { echo 'skip  SELF_HOSTING.md is not next to this folder, so its list of reasons is not compared'; continue; }
  for reason in $(grep -v '^ *#' "$here/$script" | grep -oE "fail [a-z_]+ [\"']" | awk '{ print $2 }' | sort -u) \
    docker_not_running stack_start_failed port_in_use api_did_not_answer unexpected; do
    grep -q "\`$reason\`" "$guide" || { echo "FAIL  $script stops with the reason $reason, and SELF_HOSTING.md does not list it"; failed=1; }
  done
done
[ "$failed" -ne 0 ] || [ ! -f "$guide" ] || echo 'ok    SELF_HOSTING.md lists every reason'

exit "$failed"
