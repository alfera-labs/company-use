#!/usr/bin/env bash
# One-command self-host installer.
#
#   curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash
#
# From a clone, the same script builds the two images from that source:
#
#   ./deploy/install.sh
#
# It generates the local secrets, asks for one model key or for a model you host, starts the
# stack, and waits until the dashboard answers. Then it prints a one-time sign-in link for the owner and opens it. The
# result asks every browser for a session, and only this machine can open it until
# `./alfera add team`. Run it on a machine nobody else is signed in to: for a few minutes the
# link is in this terminal, in the browser's history and in the process list.
# When Docker is missing it offers to get it, and installs nothing without a yes. With no
# terminal to ask on, it stops with one sentence instead.
#
# Environment variables:
#   ANTHROPIC_API_KEY / OPENAI_API_KEY / VERCEL_AI_GATEWAY_API_KEY   one of them, to skip the
#                                                                    question
#   OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL   in place of a key: a model you
#                                         host, or another OpenAI-compatible address. Add
#                                         OPENAI_COMPATIBLE_API_KEY when the server needs one.
#   WORKOS_API_KEY and WORKOS_CLIENT_ID   set both to hand sign-in to WorkOS, in place of the
#                                         install's own sign-in links
# Other knobs: INSTALL_DIR, PRODUCT_VERSION, PRODUCT_REPOSITORY, PRODUCT_RAW_BASE, APP_PORT,
# API_PORT, BUILD_FROM_SOURCE=1, COWORKER_SANDBOX_NETWORK (the name of the sandbox network,
# for a second install on one machine).
#
# A program can run it, with no person at a terminal (SELF_HOSTING.md, "Install from a program"):
#   --unattended      asks nothing. Each answer comes from the environment or from --answers-stdin.
#                     From a file, the work then runs apart from the connection that started
#                     it: a connection that drops stops nothing, and the same command run
#                     again shows the progress of the install that is still going.
#   --answers-stdin   reads NAME=value lines from stdin, so a key is on no command line. The
#                     script must be a file for this, not a pipe.
#   --progress        stdout holds one JSON line per step and nothing else. The words for a
#                     person go to stderr.
#   --install-docker  on Linux, gets Docker with the official script when it is missing.
#   --https[=name]    serves the dashboard and the API on port 443 with a certificate the
#                     install gets by itself. With no name, the name is made from the public
#                     address of this machine.
#   PRODUCT_SOURCE_ARCHIVE   the address of a .tar.gz of the source, used in place of a clone.
set -euo pipefail
# The .env holds every secret of the install, and so does each file written on the way to it.
umask 077

readonly repository_url="${PRODUCT_REPOSITORY:-https://github.com/alfera-labs/company-use.git}"
readonly raw_base="${PRODUCT_RAW_BASE:-https://raw.githubusercontent.com/alfera-labs/company-use/${ALFERA_VERSION:-main}/deploy}"
readonly api_image="${API_IMAGE:-ghcr.io/alfera-labs/alfera-api}"
readonly product_version="${PRODUCT_VERSION:-${ALFERA_VERSION:-latest}}"
readonly sandbox_image='node:24-bookworm'
readonly reserved_address="${ALFERA_PUBLIC_ADDRESS:-}"
readonly swap_file='/swapfile'
readonly ssh_settings_file='/etc/ssh/sshd_config.d/00-alfera.conf'
readonly seconds_between_address_checks=5
readonly most_address_checks=120
readonly seconds_up_before_a_cloud_address_is_final=120
readonly app_port="${APP_PORT:-3000}"
readonly api_port="${API_PORT:-3001}"
readonly docker_socket='/var/run/docker.sock'
readonly docker_desktop_url='https://www.docker.com/products/docker-desktop/'
readonly docker_docs_url='https://docs.docker.com/get-docker/'

# Set by choose_install_dir. `builds_from_source` is "yes" when the images come from a clone.
install_dir=''
builds_from_source='no'
uses_prepared_images='no'
# Set by write_sign_in_values, or read back from an existing .env.
sign_in_mode='links'
# Set by read_model_key: a provider key, or the three values of a model the person hosts.
model_key_env_name=''
model_key_value=''
own_model_address=''
own_model_name=''
own_model_key=''

# How a program runs it. Each one is set by an argument of the same name.
unattended='no'
first_boot='no'
progress='no'
installs_docker='no'
reads_answers_from_stdin='no'
https_name=''
unknown_argument=''
for argument in "$@"; do
  case "$argument" in
    --unattended) unattended='yes' ;;
    --first-boot) first_boot='yes' unattended='yes' ;;
    --progress) progress='yes' ;;
    --install-docker) installs_docker='yes' ;;
    --answers-stdin) reads_answers_from_stdin='yes' ;;
    --https) https_name='auto' ;;
    --https=?*) https_name="${argument#--https=}" ;;
    *) unknown_argument="$argument" ;;
  esac
done

# The step a progress line is about, and whether a failed line was written for this run.
current_step='arguments'
failure_was_reported='no'

# One install works on a machine at a time. An unattended install keeps its progress lines and
# its words in two files, so a later run can show them. open_state_folder sets the three paths.
state_dir=''
progress_file=''
log_file=''
holds_the_lock='no'
# The name of this process in the lock folder, where the kernel has no lock to give.
lock_owner=''
# Set by the run that starts the work apart from its connection, for the run that does the work.
readonly works_apart="${ALFERA_INSTALL_WORKS_APART:-no}"

# With --progress, stdout belongs to the program that reads it: descriptor 3 keeps it for the
# progress lines, and everything else this script and Docker print goes to stderr. The run that
# works apart from a connection writes both to the files instead, once it has opened them.
if [ "$works_apart" = 'yes' ]; then
  progress='no'
elif [ "$progress" = 'yes' ]; then
  exec 3>&1 1>&2
fi

print_step() {
  printf '%s\n' "$*"
}

# One line of text inside a JSON string. A control character has no place in one, so each
# becomes a space: a strict parser refuses the line otherwise.
json_text() {
  printf '%s' "$1" | LC_ALL=C tr '\000-\037\177' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# report_progress <state> [<name> <value>]...: one JSON line about the current step.
report_progress() {
  [ "$progress" = 'yes' ] || return 0
  local line
  line="$(printf '{"step":"%s","state":"%s"' "$current_step" "$1")"
  shift
  while [ "$#" -ge 2 ]; do
    line="$line$(printf ',"%s":"%s"' "$1" "$(json_text "$2")")"
    shift 2
  done
  printf '%s}\n' "$line" >&3
}

# The sentence a person reads in an app for each reason an install stops. No command, no file
# name: that person has no terminal. A reason that is not listed here keeps the terminal words.
plain_sentence_for() {
  case "$1" in
    bad_arguments) printf 'The setup was started in a way it does not know. Update the app, then try again.' ;;
    install_running) printf 'Setup is still running on this server. Try again in a minute.' ;;
    install_interrupted) printf 'Setup was interrupted on the server. Try again.' ;;
    state_folder_not_safe) printf 'The setup cannot keep its notes safely on this server. Start again with a fresh Ubuntu server.' ;;
    own_domain_needed) printf 'Sign-in through WorkOS needs a domain of your own. Point a domain at this server, enter it, then try again.' ;;
    unsupported_machine) printf 'This server has a processor Alfera does not run on. Choose a server with an Intel, AMD or Arm 64-bit processor.' ;;
    not_enough_memory) printf 'This server has too little memory. Choose a server with at least 4 GB of memory, then try again.' ;;
    curl_missing | openssl_missing | git_missing | tar_missing) printf 'A basic tool is missing on this server. Start again with a fresh Ubuntu server.' ;;
    docker_not_installed) printf 'Docker is not on this server yet. Try again, and let the setup install it.' ;;
    docker_not_running) printf 'Docker is on this server but it is not running. Restart the server, then try again.' ;;
    docker_not_reachable) printf 'The setup is not allowed to use Docker on this server. Sign in to the server as root, then try again.' ;;
    docker_install_failed) printf 'Docker could not be installed on this server. Start again with a fresh Ubuntu server.' ;;
    docker_compose_missing) printf 'The Docker on this server is too old. Start again with a fresh Ubuntu server.' ;;
    source_download_failed) printf 'The server could not download Alfera. Check that the server can reach the internet, then try again.' ;;
    setting_has_line_break) printf 'One of the values holds a line break. Paste it again as one line.' ;;
    docker_socket_unreadable) printf 'Docker did not answer on this server. Restart the server, then try again.' ;;
    model_key_missing) printf 'No model key was given. Enter your model key, then try again.' ;;
    model_key_refused) printf 'The model provider refused that key. Check the key, then try again.' ;;
    own_model_name_missing) printf 'The model has an address but no name. Enter the name of the model, then try again.' ;;
    own_model_not_answering) printf 'The model at that address did not answer. Check the address, then try again.' ;;
    database_from_earlier_install) printf 'This server holds the data of an earlier Alfera, and its settings file is gone. Use a fresh server, or put the settings file back.' ;;
    https_name_not_usable) printf 'The server could not work out its public address. Enter the name people will open, then try again.' ;;
    installed_with_other_address) printf 'Alfera is already set up on this server with another address. Change the address from the server settings.' ;;
    image_build_failed) printf 'Alfera could not be built on this server. Check that it has 4 GB of memory and 20 GB of free disk, then try again.' ;;
    image_pull_failed) printf 'The server could not download Alfera. Check that the server can reach the internet, then try again.' ;;
    port_in_use) printf 'Another program on this server already uses a port Alfera needs. Use a fresh server, then try again.' ;;
    no_free_address_range) printf 'Docker on this server has no network range left. Use a fresh server, then try again.' ;;
    stack_start_failed) printf 'Alfera was built but did not start. Try again in a minute.' ;;
    api_did_not_answer | dashboard_did_not_answer) printf 'Alfera started but did not answer in time. Try again in a minute.' ;;
    certificate_not_issued) printf 'The server did not get its security certificate. Check that the name points at this server and that ports 80 and 443 are open, then try again.' ;;
    sign_in_link_not_made) printf 'Alfera runs, but it made no sign-in link. Try again in a minute.' ;;
    version_not_published) printf 'This version of Alfera is not published yet. Choose another version, then try again.' ;;
    registry_login_failed) printf 'The server could not sign in to the image registry. Check the registry user and token, then try again.' ;;
    public_address_not_stable) printf 'The server did not get a fixed public address within ten minutes. Delete this server and start again.' ;;
    ssh_password_login_not_closed) printf 'The server could not turn off password sign-in over SSH. Delete this server and start again.' ;;
    setup_token_not_usable) printf 'The setup link of this server is not valid. Delete this server and start again.' ;;
    unexpected) printf 'The setup stopped for a reason it did not expect. Try again. If it stops again, copy the log and ask for help.' ;;
    *) printf '%s' "$2" ;;
  esac
}

# fail <reason id> <words for a terminal>. The reason id is for a program and never changes;
# INSTALLER_CONTRACT.md lists every one. A call with the words alone gets the reason `unlisted`.
fail() {
  local reason='unlisted'
  if [ "$#" -ge 2 ]; then
    reason="$1"
    shift
  fi
  printf 'error: %s\n' "$*" >&2
  failure_was_reported='yes'
  report_progress failed reason "$reason" message "$(plain_sentence_for "$reason" "$*")"
  exit 1
}

# A stop that no `fail` explained still gets its failed line: a command that broke, or a signal.
# The lock goes with the run that holds it.
leave() {
  local status="$?"
  [ "$status" -eq 0 ] || [ "$failure_was_reported" = 'yes' ] ||
    report_progress failed reason unexpected message "$(plain_sentence_for unexpected)"
  [ -z "$install_dir" ] || rm -f "$install_dir/.env.next"
  [ "$holds_the_lock" != 'yes' ] || give_the_lock_back
}

# run_step <step id> <command>...: the started line, the work, the done line.
run_step() {
  current_step="$1"
  shift
  report_progress started
  "$@"
  report_progress done
}

# The file can exist with no terminal behind it, so try to open it. An unattended run never asks.
has_terminal() {
  [ "$unattended" != 'yes' ] && { : >/dev/tty; } 2>/dev/null
}

# The names an answer on stdin may have. A key in the environment of `ssh host KEY=... bash`
# is on a command line of that host, and stdin is not.
readonly answer_names='MODEL_KEY ANTHROPIC_API_KEY OPENAI_API_KEY VERCEL_AI_GATEWAY_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY OPENAI_COMPATIBLE_BASE_URL OPENAI_COMPATIBLE_MODEL OPENAI_COMPATIBLE_API_KEY WORKOS_API_KEY WORKOS_CLIENT_ID'

# The lines of stdin, kept to hand them on to the run that works apart from this connection.
answers_text=''

read_answers_from_stdin() {
  local line name
  [ "$reads_answers_from_stdin" = 'yes' ] || return 0
  [ -f "${BASH_SOURCE[0]:-}" ] ||
    fail bad_arguments '--answers-stdin needs this script in a file, because a piped script is itself on stdin. Download install.sh, then run: bash install.sh --answers-stdin'
  answers_text="$(cat)"
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    name="${line%%=*}"
    case " $answer_names " in
      *" $name "*) printf -v "$name" '%s' "${line#*=}" ;;
      *) fail bad_arguments "stdin holds a line that is not an answer this script reads. The names are: $answer_names" ;;
    esac
  done <<<"$answers_text"
}

# MODEL_KEY is a key whose provider the caller did not work out. Each provider's keys start in
# their own way, so the key goes under the name of its provider here.
sort_out_the_model_key() {
  local key_name
  [ -n "${MODEL_KEY:-}" ] || return 0
  key_name="$(model_key_name "$MODEL_KEY")"
  if [ -z "$key_name" ]; then
    print_step 'the model key does not start the way a key of a known provider does, so it is not used. Enter it on the setup page, or with: ./alfera add model'
    return 0
  fi
  printf -v "$key_name" '%s' "$MODEL_KEY"
}

check_setup_token_hash() {
  [ -n "${ALFERA_SETUP_TOKEN_SHA256:-}" ] || return 0
  printf '%s' "$ALFERA_SETUP_TOKEN_SHA256" | grep -Eqx '[0-9a-f]{64}' ||
    fail setup_token_not_usable 'ALFERA_SETUP_TOKEN_SHA256 is not 64 small hex characters.'
}

read_arguments() {
  check_setup_token_hash
  [ -z "$unknown_argument" ] ||
    fail bad_arguments "unknown argument: $unknown_argument. The arguments are --unattended, --answers-stdin, --progress, --install-docker, --first-boot and --https[=name]."
  [ "$first_boot" != 'yes' ] || [ -n "$https_name" ] || https_name='auto'
  read_answers_from_stdin
  sort_out_the_model_key
}

# The home folder of this account, asked of the account itself. HOME is not used: a first-boot
# script has none, and whoever starts this script can set it to any folder.
account_home() {
  local name
  name="$(id -un)"
  if command -v getent >/dev/null 2>&1; then
    getent passwd "$name" | cut -d: -f6
  elif command -v dscl >/dev/null 2>&1; then
    dscl . -read "/Users/$name" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p'
  fi
}

# The lock and the two files are in a folder that only this account can write: in its own home,
# its own, closed to others, and not a link. In a folder another account can reach, that account
# could aim the files at any file of this one, or leave a lock that never goes.
open_state_folder() {
  local home
  home="$(account_home)"
  [ -n "$home" ] && [ -d "$home" ] ||
    fail state_folder_not_safe "the account $(id -un) has no home folder, and the installer keeps its lock there. Run it as an account that has one."
  state_dir="$home/.alfera-install"
  mkdir -m 0700 "$state_dir" 2>/dev/null || true
  if [ -L "$state_dir" ] || [ ! -d "$state_dir" ] || [ ! -O "$state_dir" ]; then
    fail state_folder_not_safe "$state_dir is a link or belongs to another account, so the installer writes nothing there. Look at it, remove it, then run this again."
  fi
  chmod 0700 "$state_dir"
  progress_file="$state_dir/progress"
  log_file="$state_dir/log"
}

# make_new_file <path>: an empty file that did not exist a moment ago. A link left at the path
# is removed, never followed, and the file is made only if nothing is there.
make_new_file() {
  rm -f "$1"
  (set -o noclobber && : >"$1") 2>/dev/null
}

is_own_plain_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ -O "$1" ]
}

# On Linux the kernel holds the lock: `flock` on a file, kept by an open descriptor (8) for as
# long as the working process lives. The kernel frees it when that process ends, however it
# ends, so no lock is ever left behind and no process number is ever trusted.
has_kernel_lock() {
  command -v flock >/dev/null 2>&1
}

# Where there is no `flock` (macOS), the lock is a folder that holds one file, named after the
# process that owns it: its number and the moment it started. A number alone comes back after
# a restart; a number with its start time does not.
process_name_of() {
  local started
  started="$(ps -o lstart= -p "$1" 2>/dev/null | LC_ALL=C tr -cd 'A-Za-z0-9')"
  [ -z "$started" ] || printf '%s.%s' "$1" "$started"
}

lock_owner_is_alive() {
  [ "$(process_name_of "${1%%.*}")" = "$1" ]
}

owner_of_the_folder_lock() {
  ls "$state_dir/lock.d" 2>/dev/null | head -1
}

# Each step is one that two runs cannot both do: making the folder, and renaming the file of an
# owner that is gone to this process's own name. The rename takes the lock over in one move, and
# it can never hit the file of a live owner, because that file has another name.
take_the_folder_lock() {
  local folder="$state_dir/lock.d" mine owner
  mine="$(process_name_of "$$")"
  [ -n "$mine" ] || return 1
  if mkdir "$folder" 2>/dev/null; then
    : 2>/dev/null >"$folder/$mine" || return 1
  else
    owner="$(owner_of_the_folder_lock)"
    if [ -z "$owner" ]; then
      # Made this moment by another run, or left empty by one that died right there.
      sleep 1
      [ -z "$(owner_of_the_folder_lock)" ] || return 1
      rmdir "$folder" 2>/dev/null && mkdir "$folder" 2>/dev/null || return 1
      : 2>/dev/null >"$folder/$mine" || return 1
    else
      ! lock_owner_is_alive "$owner" || return 1
      mv "$folder/$owner" "$folder/$mine" 2>/dev/null || return 1
    fi
  fi
  if [ "$(ls "$folder" 2>/dev/null)" != "$mine" ]; then
    rm -f "$folder/$mine"
    return 1
  fi
  lock_owner="$mine"
}

take_the_lock() {
  if has_kernel_lock; then
    [ ! -L "$state_dir/flock" ] || return 1
    exec 8>>"$state_dir/flock"
    flock -n 8 || {
      exec 8>&-
      return 1
    }
  else
    take_the_folder_lock || return 1
  fi
  holds_the_lock='yes'
  rm -f "$state_dir/works_apart"
}

give_the_lock_back() {
  rm -f "$state_dir/works_apart"
  [ -z "$lock_owner" ] || rm -f "$state_dir/lock.d/$lock_owner"
  [ -z "$lock_owner" ] || rmdir "$state_dir/lock.d" 2>/dev/null || true
}

# Whether an install holds the lock now. The lock itself is asked, never a process number.
install_is_at_work() {
  local owner
  if has_kernel_lock; then
    is_own_plain_file "$state_dir/flock" || return 1
    ! (flock -n 9) 9<"$state_dir/flock"
  else
    owner="$(owner_of_the_folder_lock)"
    [ -n "$owner" ] && lock_owner_is_alive "$owner"
  fi
}

new_lines_of() {
  local file="$1" shown="$2" total="$3"
  [ "$total" -le "$shown" ] || sed -n "$((shown + 1)),${total}p" "$file"
}

line_count_of() {
  is_own_plain_file "$1" || return 0
  wc -l <"$1" | tr -d ' '
}

# Shows what the install that works apart from a connection writes, its words and with
# --progress its progress lines, until that install lets the lock go. Then this run ends as
# that one did. It starts no step of its own.
follow_the_install() {
  local shown_words=0 shown_progress=0 total at_work last=''
  while :; do
    at_work='yes'
    install_is_at_work || at_work='no'
    total="$(line_count_of "$log_file")"
    new_lines_of "$log_file" "$shown_words" "${total:-0}"
    shown_words="${total:-0}"
    total="$(line_count_of "$progress_file")"
    [ "$progress" != 'yes' ] || new_lines_of "$progress_file" "$shown_progress" "${total:-0}" >&3
    shown_progress="${total:-0}"
    [ "$at_work" = 'yes' ] || break
    sleep 1
  done
  ! is_own_plain_file "$progress_file" || last="$(tail -1 "$progress_file")"
  failure_was_reported='yes'
  case "$last" in
    *'"step":"install","state":"done"'*) exit 0 ;;
    *'"state":"failed"'*) exit 1 ;;
  esac
  failure_was_reported='no'
  current_step="$(printf '%s' "$last" | sed -n 's/^{"step":"\([a-z_]*\)".*/\1/p')"
  current_step="${current_step:-install}"
  fail install_interrupted 'The install that was running here stopped and did not say why: it was killed, or the machine restarted. Run this again.'
}

# An install is already at work on this machine. One that works apart from its connection can
# be followed, and it says so with a file a moment after it took the lock. One that a person
# runs at a terminal cannot, so this run says so and stops.
join_the_running_install() {
  [ -f "$state_dir/works_apart" ] || sleep 2
  [ ! -f "$state_dir/works_apart" ] || follow_the_install
  fail install_running 'An install is already running on this machine. Wait until it ends, then run this again.'
}

# start_the_work_apart <argument>...: runs this script again as a process of its own, which no
# end of this connection stops, and hands it the lock: the open descriptor goes to it as it
# starts, or it renames this run's file in the lock folder to its own. So the lock is never
# free between the two. Its answers go to it on stdin, as they came. Then this run only shows
# what that one writes.
start_the_work_apart() {
  local leave_the_session='' waited=0
  make_new_file "$progress_file" && make_new_file "$log_file" ||
    fail state_folder_not_safe "the installer could not make its two files in $state_dir. Look at that folder, remove it, then run this again."
  : >"$state_dir/works_apart"
  ! command -v setsid >/dev/null 2>&1 || leave_the_session='setsid'
  if [ "$reads_answers_from_stdin" = 'yes' ]; then
    printf '%s\n' "$answers_text" |
      ALFERA_INSTALL_WORKS_APART=yes ALFERA_INSTALL_LOCK_FROM="$lock_owner" \
        nohup $leave_the_session bash "${BASH_SOURCE[0]}" "$@" >/dev/null 2>&1 &
  else
    ALFERA_INSTALL_WORKS_APART=yes ALFERA_INSTALL_LOCK_FROM="$lock_owner" \
      nohup $leave_the_session bash "${BASH_SOURCE[0]}" "$@" </dev/null >/dev/null 2>&1 &
  fi
  if has_kernel_lock; then
    exec 8>&-
  else
    while [ -e "$state_dir/lock.d/$lock_owner" ]; do
      waited=$((waited + 1))
      [ "$waited" -lt 100 ] || fail unexpected 'The install did not start as a process of its own. Run this again.'
      sleep 0.1
    done
    lock_owner=''
  fi
  holds_the_lock='no'
  follow_the_install
}

# The run that does the work apart from a connection: the lock came to it from the run that
# started it. With no lock to take over it ends without a word, and so does nothing twice.
receive_the_lock() {
  local mine
  if has_kernel_lock; then
    { : >&8; } 2>/dev/null || take_the_lock || exit 0
  else
    mine="$(process_name_of "$$")"
    [ -n "${ALFERA_INSTALL_LOCK_FROM:-}" ] && [ -n "$mine" ] &&
      mv "$state_dir/lock.d/$ALFERA_INSTALL_LOCK_FROM" "$state_dir/lock.d/$mine" 2>/dev/null || exit 0
    lock_owner="$mine"
  fi
  holds_the_lock='yes'
}

# From here on the run that works apart writes its progress lines and its words to the two
# files. They are its own plain files: the run that started it made them new.
open_the_files_of_the_work() {
  is_own_plain_file "$progress_file" && is_own_plain_file "$log_file" || exit 1
  exec 3>>"$progress_file" 1>>"$log_file" 2>&1
  progress='yes'
}

# Three kinds of run. The one that does the work apart from a connection gets the lock from
# the run that started it. An unattended run from a file takes the lock, starts such a run,
# hands it the lock and follows it. Every other run does the work itself, here, under the lock.
# A run that finds the lock taken starts nothing.
begin() {
  if [ "$works_apart" = 'yes' ]; then
    open_state_folder
    receive_the_lock
    open_the_files_of_the_work
    read_arguments
    return
  fi
  read_arguments
  open_state_folder
  take_the_lock || join_the_running_install
  if [ "$unattended" = 'yes' ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
    start_the_work_apart "$@"
  fi
}

# Asks a question with two answers on the terminal. Only y or yes is a yes. An answer that is
# neither gets the question once more with the reason, and then counts as no.
person_says_yes() {
  local answer='' tries=0
  while :; do
    printf '%s Type y for yes or n for no, then press Enter: ' "$1" >/dev/tty
    read -r answer </dev/tty || return 1
    case "$answer" in
      y | Y | yes | Yes | YES) return 0 ;;
      n | N | no | No | NO) return 1 ;;
    esac
    tries=$((tries + 1))
    if [ "$tries" -ge 2 ]; then
      printf 'That was not y or n again, so it is taken as no.\n' >/dev/tty
      return 1
    fi
    if [ -z "$answer" ]; then
      printf 'Nothing was typed.\n' >/dev/tty
    else
      printf '"%s" is neither y nor n.\n' "$answer" >/dev/tty
    fi
  done
}

docker_is_installed() {
  command -v docker >/dev/null 2>&1
}

docker_answers() {
  docker info >/dev/null 2>&1
}

wait_until_docker_answers() {
  local waited=0
  print_step 'Waiting for Docker to answer. Press Ctrl-C to stop.'
  until docker_answers; do
    sleep 3
    hash -r
    waited=$((waited + 3))
    [ "$((waited % 30))" -ne 0 ] ||
      print_step "Still waiting for Docker after $waited seconds. Start Docker if it is not open. Press Ctrl-C to stop."
  done
  print_step 'Docker answers. Going on.'
}

get_docker_ready_on_macos() {
  if docker_is_installed; then
    print_step 'Docker is installed, but it is not running.'
    if person_says_yes 'Start Docker Desktop now?'; then
      open -a Docker >/dev/null 2>&1 ||
        print_step 'Docker Desktop did not start from here. Start Docker yourself.'
    fi
  else
    print_step 'Docker is not installed, and Alfera runs in it.'
    person_says_yes 'Open the Docker Desktop download page?' ||
      fail docker_not_installed "Docker is needed: install Docker Desktop from $docker_desktop_url, then run this again."
    open "$docker_desktop_url" >/dev/null 2>&1 ||
      print_step "The page did not open. It is at $docker_desktop_url"
    print_step 'Install Docker Desktop and start it. This goes on by itself after that.'
  fi
  wait_until_docker_answers
}

install_docker_on_linux() {
  # The Docker daemon must not keep the lock of this install open (descriptor 8).
  curl -fsSL https://get.docker.com | sh 8>&- ||
    fail docker_install_failed "The Docker install script stopped. The lines above say why. Install Docker by hand ($docker_docs_url), then run this again."
  hash -r
  docker_answers ||
    fail docker_not_reachable "Docker is installed, but this user cannot reach it yet. Run: sudo usermod -aG docker $(id -un), log out and in, then run this again."
}

get_docker_ready_on_linux() {
  if docker_is_installed; then
    fail docker_not_reachable "Docker is installed, but this user cannot reach it. Start it with: sudo systemctl start docker. If it already runs, run: sudo usermod -aG docker $(id -un), log out and in, then run this again."
  fi
  print_step 'Docker is not installed, and Alfera runs in it.'
  person_says_yes 'Install Docker now with the official script from get.docker.com?' ||
    fail docker_not_installed "Docker is needed: install it ($docker_docs_url), then run this again."
  install_docker_on_linux
}

# --install-docker is the yes to the question a person at a terminal is asked. As root, a
# Docker that is installed and stopped is started too.
get_docker_ready_without_asking() {
  [ "$installs_docker" = 'yes' ] && [ "$(uname -s)" = 'Linux' ] || return 0
  if ! docker_is_installed; then
    print_step 'Docker is not installed. Installing it with the official script from get.docker.com.'
    install_docker_on_linux
  elif [ "$(id -u)" = '0' ]; then
    systemctl start docker >/dev/null 2>&1 8>&- || true
  fi
}

# Docker missing or stopped is the most common first failure, so a person at a terminal gets
# help with it. A run with no terminal stops with one sentence.
get_docker_ready() {
  docker_answers && return 0
  get_docker_ready_without_asking
  docker_answers && return 0
  local reason='docker_not_installed'
  local what_to_do="Docker is not installed: install it ($docker_docs_url), then run this again."
  if docker_is_installed; then
    reason='docker_not_running'
    what_to_do='Docker is installed but not running: start Docker, then run this again.'
  fi
  has_terminal || fail "$reason" "$what_to_do"
  case "$(uname -s)" in
    Darwin) get_docker_ready_on_macos ;;
    Linux) get_docker_ready_on_linux ;;
    *) fail "$reason" "$what_to_do" ;;
  esac
}

# The API image holds a Docker client that is pinned for these two processors only.
check_machine() {
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) fail unsupported_machine "This machine has a $(uname -m) processor. Alfera runs on x86_64 and arm64." ;;
  esac
}

check_required_tools() {
  check_machine
  command -v curl >/dev/null 2>&1 || fail curl_missing 'curl is not installed. Install curl, then run this again.'
  command -v openssl >/dev/null 2>&1 ||
    fail openssl_missing 'openssl is not installed. Install openssl, then run this again.'
}

check_docker() {
  get_docker_ready
  docker compose version >/dev/null 2>&1 ||
    fail docker_compose_missing 'The Docker Compose plugin is missing. Install it (https://docs.docker.com/compose/install/), then run this again.'
}

# Prints the root of the clone this script sits in, or nothing when it runs from a pipe.
find_clone_root() {
  local script_path="${BASH_SOURCE[0]:-}"
  [ -n "$script_path" ] && [ -f "$script_path" ] || return 0
  local clone_root
  clone_root="$(cd "$(dirname "$script_path")/.." && pwd)"
  [ -f "$clone_root/apps/api/Dockerfile" ] && printf '%s' "$clone_root"
  return 0
}

published_images_exist() {
  [ "${BUILD_FROM_SOURCE:-}" != '1' ] &&
    docker manifest inspect "$api_image:$product_version" >/dev/null 2>&1
}

# PRODUCT_SOURCE_ARCHIVE names a .tar.gz of the source: a release archive, a copy on a machine
# with no way to the code host, or the export a test serves. The files sit at the top of the
# archive, or in one folder at the top.
unpack_source_archive() {
  local unpacked="$1" top
  command -v tar >/dev/null 2>&1 || fail tar_missing 'tar is not installed. Install tar, then run this again.'
  print_step "getting the source from $PRODUCT_SOURCE_ARCHIVE"
  curl -fsSL "$PRODUCT_SOURCE_ARCHIVE" -o "$unpacked.tar.gz" && mkdir -p "$unpacked" &&
    tar -xzf "$unpacked.tar.gz" -C "$unpacked" ||
    fail source_download_failed "Could not download and unpack $PRODUCT_SOURCE_ARCHIVE. Check the network, then run this again."
  rm -f "$unpacked.tar.gz"
  [ -f "$unpacked/apps/api/Dockerfile" ] && return 0
  top="$(find "$unpacked" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -f "$top/apps/api/Dockerfile" ] ||
    fail source_download_failed "$PRODUCT_SOURCE_ARCHIVE does not hold the source of Alfera."
  mv "$top" "$unpacked.top" && rm -rf "$unpacked" && mv "$unpacked.top" "$unpacked"
}

# The source lands in a folder beside its place and moves there when it is whole, so a run that
# stops halfway leaves nothing a later run would take for the source.
clone_source() {
  local source_dir="$1"
  if [ -f "$source_dir/apps/api/Dockerfile" ]; then
    print_step "using the clone at $source_dir"
    return
  fi
  rm -rf "$source_dir.partial"
  if [ -n "${PRODUCT_SOURCE_ARCHIVE:-}" ]; then
    unpack_source_archive "$source_dir.partial"
  else
    command -v git >/dev/null 2>&1 ||
      fail git_missing 'There is no published image for this version, and git is not installed to build it from source. Install git, then run this again.'
    print_step "no published image for $product_version; cloning the source to build it"
    git clone --depth 1 "$repository_url" "$source_dir.partial" ||
      fail source_download_failed "Could not clone $repository_url. Check the network, then run this again."
  fi
  rm -rf "$source_dir"
  mv "$source_dir.partial" "$source_dir"
}

was_prepared_for_this_version() {
  [ -x "$1/alfera" ] && [ -f "$1/baked_version" ] && [ "$(cat "$1/baked_version")" = "$product_version" ]
}

download_install_file() {
  curl -fsSL "$raw_base/$1" -o "$install_dir/$1" ||
    fail source_download_failed "Could not download $raw_base/$1. Check the network, then run this again."
}

# Three ways in: from a clone (build that source), from a pipe with published images (pull
# them), and from a pipe without (clone, then build).
choose_install_dir() {
  local clone_root
  clone_root="$(find_clone_root)"
  if [ -n "$clone_root" ]; then
    install_dir="$clone_root/deploy"
    builds_from_source='yes'
    print_step "installing from the clone at $clone_root"
    return
  fi

  local standalone_dir="${INSTALL_DIR:-$PWD/alfera-selfhost}"
  mkdir -p "$standalone_dir"
  # An install that is already here stays where it is, whatever is published by now.
  if [ -f "$standalone_dir/source/deploy/.env" ]; then
    install_dir="$standalone_dir/source/deploy"
    builds_from_source='yes'
    print_step "using the clone at $standalone_dir/source"
    return
  fi
  if [ -f "$standalone_dir/.env" ] && [ -x "$standalone_dir/alfera" ]; then
    install_dir="$standalone_dir"
    print_step "using the install at $install_dir"
    return
  fi
  if [ -z "${PRODUCT_SOURCE_ARCHIVE:-}" ] && was_prepared_for_this_version "$standalone_dir"; then
    install_dir="$standalone_dir"
    uses_prepared_images='yes'
    print_step "using the files and images prepared in $install_dir"
    return
  fi
  if [ -z "${PRODUCT_SOURCE_ARCHIVE:-}" ] && published_images_exist; then
    install_dir="$standalone_dir"
    print_step "installing into $install_dir"
    download_install_file docker-compose.yml
    download_install_file Caddyfile
    download_install_file .env.selfhost.example
    download_install_file alfera
    chmod +x "$install_dir/alfera"
    return
  fi

  [ "$first_boot" != 'yes' ] || [ -n "${PRODUCT_SOURCE_ARCHIVE:-}" ] ||
    fail version_not_published "there is no published image of version $product_version at $api_image, and a first boot never builds one."
  clone_source "$standalone_dir/source"
  install_dir="$standalone_dir/source/deploy"
  builds_from_source='yes'
}

random_secret() {
  openssl rand -hex 32
}

# Replaces `KEY=` (or an existing value) with `KEY=value`, in place, without a temp file the
# caller has to clean up. The value is written through awk so a slash or an ampersand in a
# generated secret cannot be read as sed replacement syntax.
set_env_value() {
  local key="$1" value="$2" file="$install_dir/.env"
  case "$value" in
    *$'\n'* | *$'\r'*) fail setting_has_line_break "the value for $key holds a line break. One setting is one line." ;;
  esac
  # Docker Compose changes a bare value that holds a dollar sign, a quote or " #", and it reads
  # this file for every container. So any value outside the plain characters goes in double
  # quotes, with a backslash before each backslash, double quote and dollar sign: Compose and
  # read_env_value then both give back what was typed.
  SETTING_KEY="$key" SETTING_VALUE="$value" awk '
    BEGIN {
      key = ENVIRON["SETTING_KEY"]; value = ENVIRON["SETTING_VALUE"]
      if (value ~ /[^A-Za-z0-9_@%+=:,.\/-]/) {
        gsub(/[\\"$]/, "\\\\&", value)
        value = "\"" value "\""
      }
    }
    index($0, key "=") == 1 && !done { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" >"$file.next"
  mv "$file.next" "$file"
  chmod 0600 "$file"
}

# docker-compose.yml adds this group to the API and worker containers so they can use the
# mounted socket. A guessed id makes every agent command fail with "permission denied" later, so
# stop here instead. The id is read from inside a container, because that is where it is used:
# on a desktop Docker that runs in a virtual machine it differs from the id the host shows.
read_docker_group_id() {
  if [ "$first_boot" = 'yes' ]; then
    stat -c '%g' "$docker_socket"
    return
  fi
  docker run --rm --quiet -v "$docker_socket:$docker_socket" pgvector/pgvector:pg17 \
    stat -c '%g' "$docker_socket"
}

write_generated_secrets() {
  set_env_value COWORKER_API_PROXY_SECRET "$(random_secret)"
  set_env_value WORKOS_COOKIE_PASSWORD "$(random_secret)"
  set_env_value COWORKER_BROWSER_STATE_ENCRYPTION_KEY "$(random_secret)"
  set_env_value RIVET_TOKEN "$(random_secret)"
  local database_password
  database_password="$(openssl rand -hex 16)"
  set_env_value POSTGRES_PASSWORD "$database_password"
  set_env_value DATABASE_URL "postgres://coworker:${database_password}@postgres:5432/coworker"
  print_step 'generated the local secrets'
}

# The first name the owner is greeted with. An account name such as `root` says
# nothing about the person, so those stay empty.
local_user_name() {
  local account
  account="$(id -un 2>/dev/null || true)"
  case "$account" in
    '' | root | admin | ubuntu | debian | ec2-user | user | docker) return 0 ;;
  esac
  printf '%s%s' "$(printf '%s' "${account:0:1}" | tr '[:lower:]' '[:upper:]')" "${account:1}"
}

# Every install asks for a session. The default is the install's own one-time links, with one
# owner, and the dashboard port stays on this machine until `./alfera add team` opens it. Both
# WorkOS values in the environment hand sign-in to WorkOS instead.
write_sign_in_values() {
  if [ -n "${WORKOS_API_KEY:-}" ] && [ -n "${WORKOS_CLIENT_ID:-}" ]; then
    set_env_value COWORKER_AUTH_MODE ''
    set_env_value APP_BIND '0.0.0.0'
    set_env_value WORKOS_API_KEY "$WORKOS_API_KEY"
    set_env_value WORKOS_CLIENT_ID "$WORKOS_CLIENT_ID"
    sign_in_mode='workos'
    return
  fi
  set_env_value COWORKER_AUTH_MODE 'team'
  set_env_value APP_BIND '127.0.0.1'
  set_env_value COWORKER_LOCAL_USER_NAME "$(local_user_name)"
}

# Each provider's keys carry their own prefix, so one question covers all three.
model_key_name() {
  case "$1" in
    sk-ant-oat* | sk-admin-*) ;;
    sk-ant-*) printf 'ANTHROPIC_API_KEY' ;;
    vck_*) printf 'VERCEL_AI_GATEWAY_API_KEY' ;;
    sk-or-*) printf 'OPENROUTER_API_KEY' ;;
    AIza*) printf 'GEMINI_API_KEY' ;;
    sk-proj-* | sk-svcacct-*) printf 'OPENAI_API_KEY' ;;
    sk-*) [ "$(model_key_status OPENAI_API_KEY "$1")" != '200' ] || printf 'OPENAI_API_KEY' ;;
  esac
}

# Asks the provider to list its models with the key. That proves the key without spending a
# token. Prints the HTTP status, or 000 when the provider could not be reached. The key goes to
# curl on stdin, so it is never on a command line another process can read.
model_key_status() {
  local key_name="$1" key_value="$2"
  case "$key_name" in
    ANTHROPIC_API_KEY)
      printf 'x-api-key: %s\n' "$key_value" |
        curl -s -o /dev/null -m 15 -w '%{http_code}' -H @- -H 'anthropic-version: 2023-06-01' \
          https://api.anthropic.com/v1/models || true
      ;;
    OPENAI_API_KEY)
      printf 'Authorization: Bearer %s\n' "$key_value" |
        curl -s -o /dev/null -m 15 -w '%{http_code}' -H @- https://api.openai.com/v1/models || true
      ;;
    OPENROUTER_API_KEY)
      printf 'Authorization: Bearer %s\n' "$key_value" |
        curl -s -o /dev/null -m 15 -w '%{http_code}' -H @- https://openrouter.ai/api/v1/key || true
      ;;
    GEMINI_API_KEY)
      printf 'x-goog-api-key: %s\n' "$key_value" |
        curl -s -o /dev/null -m 15 -w '%{http_code}' -H @- \
          https://generativelanguage.googleapis.com/v1beta/models || true
      ;;
    *) printf 'unchecked' ;;
  esac
}

# A refused key is the one answer worth stopping for: the first screen would fail with it.
# A provider that cannot be reached, or has no key check, lets the install go on.
model_key_is_refused() {
  case "$(model_key_status "$model_key_env_name" "$model_key_value")" in
    401 | 403) return 0 ;;
    200) print_step 'the model key works' ;;
    unchecked) print_step 'this provider has no key check; going on' ;;
    *) print_step 'the model key could not be checked now; going on' ;;
  esac
  return 1
}

read_model_key_from_environment() {
  local key_name
  for key_name in ANTHROPIC_API_KEY OPENAI_API_KEY VERCEL_AI_GATEWAY_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY; do
    if [ -n "${!key_name:-}" ]; then
      model_key_env_name="$key_name"
      model_key_value="${!key_name}"
      return 0
    fi
  done
  return 1
}

# A model the person hosts, named in the environment. The helper sends it one request with a
# tool, because an address that does not answer would fail the first screen.
read_own_model_from_environment() {
  local problem
  [ -n "${OPENAI_COMPATIBLE_BASE_URL:-}" ] || return 1
  [ -n "${OPENAI_COMPATIBLE_MODEL:-}" ] ||
    fail own_model_name_missing 'OPENAI_COMPATIBLE_BASE_URL is set, but there is no model name. Set OPENAI_COMPATIBLE_MODEL, then run this again.'
  own_model_address="${OPENAI_COMPATIBLE_BASE_URL%/}"
  own_model_name="$OPENAI_COMPATIBLE_MODEL"
  own_model_key="${OPENAI_COMPATIBLE_API_KEY:-}"
  print_step "using the model $own_model_name at $own_model_address from the environment"
  problem="$(OPENAI_COMPATIBLE_API_KEY="$own_model_key" "$install_dir/alfera" own-model-problem "$own_model_address" "$own_model_name")"
  [ -z "$problem" ] || fail own_model_not_answering "$problem"
}

# The helper asks the person how Alfera gets its model, as `./alfera add model` does, and
# prints what was chosen: one NAME=value line for a key, or three for a model the person hosts.
# A person who stops at a question, or presses Ctrl-C, ends the install with nothing written.
ask_for_a_model() {
  local answers line
  answers="$("$install_dir/alfera" ask-model)" ||
    fail model_key_missing 'No model was chosen, so Alfera was not installed. Run this again when you have a key or a model server.'
  while IFS= read -r line; do
    case "${line%%=*}" in
      OPENAI_COMPATIBLE_BASE_URL) own_model_address="${line#*=}" ;;
      OPENAI_COMPATIBLE_MODEL) own_model_name="${line#*=}" ;;
      OPENAI_COMPATIBLE_API_KEY) own_model_key="${line#*=}" ;;
      ?*)
        model_key_env_name="${line%%=*}"
        model_key_value="${line#*=}"
        ;;
    esac
  done <<<"$answers"
}

# The first screen reads the person's company with a model, so the product cannot start
# without one. This runs before anything is written, so a run that stops here leaves no
# half-made .env behind.
read_model_key() {
  if read_model_key_from_environment; then
    print_step "using $model_key_env_name from the environment"
    ! model_key_is_refused || fail model_key_refused "$model_key_env_name was refused by the provider. Check the key, then run this again."
    return
  fi
  ! read_own_model_from_environment || return 0
  [ "$first_boot" != 'yes' ] || return 0
  has_terminal ||
    fail model_key_missing 'There is no model key. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or VERCEL_AI_GATEWAY_API_KEY, or set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL for a model you host, then run this again.'
  ask_for_a_model
}

write_model_values() {
  if [ -z "$own_model_address" ]; then
    [ -z "$model_key_env_name" ] || set_env_value "$model_key_env_name" "$model_key_value"
    return
  fi
  set_env_value OPENAI_COMPATIBLE_BASE_URL "$own_model_address"
  set_env_value OPENAI_COMPATIBLE_MODEL "$own_model_name"
  set_env_value OPENAI_COMPATIBLE_API_KEY "$own_model_key"
}

# The containers and every sandbox write the workspace folder as uid 1000. The folder is closed
# to other accounts of this machine (0750) wherever uid 1000 can be made its owner: when this
# account is uid 1000, when it is root, and on macOS, where Docker maps file ownership to the
# account that runs it. On Linux under any other account there is no way to hand the folder to
# uid 1000 without root, so there it stays world-writable. SELF_HOSTING.md says so.
set_workspace_folder_mode() {
  local workspace_path="$1"
  if [ "$(id -u)" = '0' ]; then
    chown 1000:1000 "$workspace_path"
    chmod 0750 "$workspace_path"
  elif [ "$(id -u)" = '1000' ] || [ "$(uname -s)" = 'Darwin' ]; then
    chmod 0750 "$workspace_path"
  else
    chmod 0777 "$workspace_path"
    print_step "the workspace folder is open to every account of this machine: run as root or as uid 1000 to close it"
  fi
}

write_host_values() {
  local workspace_path="$install_dir/workspaces" docker_group_id
  mkdir -p "$workspace_path"
  set_workspace_folder_mode "$workspace_path"
  docker_group_id="$(read_docker_group_id)" ||
    fail docker_socket_unreadable "cannot read the group id of $docker_socket: Docker could not run a container. The lines above say why. Fix that, then run this again."

  set_env_value PRODUCT_VERSION "$product_version"
  set_env_value APP_PORT "$app_port"
  set_env_value API_PORT "$api_port"
  set_env_value DOCKER_GROUP_ID "$docker_group_id"
  set_env_value COWORKER_WORKSPACE_HOST_PATH "$workspace_path"
  set_env_value COWORKER_WORKSPACE_BASE_PATH "$workspace_path"
  set_env_value NEXT_PUBLIC_APP_URL "http://localhost:$app_port"
  set_env_value NEXT_PUBLIC_API_URL "http://localhost:$api_port"
  set_env_value NEXT_PUBLIC_WORKOS_REDIRECT_URI "http://localhost:$app_port/auth/callback"
  set_env_value ALLOWED_ORIGINS "http://localhost:$app_port"
  [ -z "${COWORKER_SANDBOX_NETWORK:-}" ] ||
    set_env_value COWORKER_SANDBOX_NETWORK "$COWORKER_SANDBOX_NETWORK"
}

# A new .env holds a new database password, and Postgres keeps the password it was first
# started with. A volume left by an earlier install would refuse the new one.
refuse_database_from_earlier_install() {
  local volume="${COMPOSE_PROJECT_NAME:-alfera}_coworker_postgres"
  docker volume inspect "$volume" >/dev/null 2>&1 || return 0
  fail database_from_earlier_install "a database from an earlier install exists (Docker volume $volume), and this install has no .env with its password.
       To keep that data: put the earlier .env back in $install_dir, then run this again.
       To start clean:    docker volume rm $volume    (this deletes that data)"
}

write_env_file() {
  if [ -f "$install_dir/.env" ]; then
    print_step "keeping the existing $install_dir/.env"
    sign_in_mode='workos'
    ! grep -q '^COWORKER_AUTH_MODE=team$' "$install_dir/.env" || sign_in_mode='links'
    ! grep -q '^COWORKER_AUTH_MODE=local$' "$install_dir/.env" || sign_in_mode='local'
    return
  fi
  refuse_database_from_earlier_install
  read_model_key
  : >"$install_dir/.env.unfinished"
  cp "$install_dir/.env.selfhost.example" "$install_dir/.env"
  chmod 0600 "$install_dir/.env"
  write_generated_secrets
  write_host_values
  write_sign_in_values
  write_model_values
}

# A value in double quotes is read the way Docker Compose reads it: without the quotes, and
# with each backslash taken off the character it guards.
read_env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 {
    value = substr($0, length(key) + 2)
    if (length(value) >= 2 && value ~ /^".*"$/) {
      quoted = substr(value, 2, length(value) - 2)
      value = ""
      for (at = 1; at <= length(quoted); at++) {
        if (substr(quoted, at, 1) == "\\" && at < length(quoted)) at++
        value = value substr(quoted, at, 1)
      }
    }
    print value
    exit
  }' "$install_dir/.env"
}

# The helper knows what a name for https may be, and makes one from the public address of this
# machine when none is given. It runs before a key is asked for, so a name that cannot be used
# stops the install with nothing written.
choose_https_name() {
  local answer
  [ -n "$https_name" ] || return 0
  answer="$("$install_dir/alfera" https-name "$https_name" 2>&1)" ||
    fail https_name_not_usable "${answer#error: }"
  https_name="$answer"
}

# `shared` for a name on a name service that everyone shares, `own` for a domain, `none` for
# an install with no https. The helper knows which names are shared.
name_kind() {
  if [ -z "$https_name" ]; then
    printf 'none'
  else
    "$install_dir/alfera" https-name-kind "$https_name"
  fi
}

# With WorkOS the session cookie is not held to one host, so a shared name is not safe there.
refuse_a_shared_name_with_workos() {
  [ "$(name_kind)" = 'shared' ] || return 0
  fail own_domain_needed "sign-in through WorkOS needs a domain of your own, and $https_name is on a name service that everyone shares. Point a domain at this machine, then run this again with --https=your.name"
}

# A run that stops while the .env is written leaves a marker next to it. The stack starts only
# after the marker is gone, so a .env with a marker was never used: the next run writes a new one.
# write_env_file makes the marker after its last question, so a person who stops there leaves nothing.
write_whole_env_file() {
  local marker="$install_dir/.env.unfinished"
  if [ -f "$marker" ]; then
    rm -f "$install_dir/.env" "$marker"
  fi
  if [ -f "$install_dir/.env" ]; then
    write_env_file
    # The stack is not up, so a name asked for now is still in time for the first build.
    if [ -n "$https_name" ]; then
      choose_https_name
      [ "$sign_in_mode" != 'workos' ] || refuse_a_shared_name_with_workos
      "$install_dir/alfera" https-settings "$https_name"
    fi
    https_name="$(read_env_value ALFERA_PUBLIC_HOST)"
    "$install_dir/alfera" secret-files
    return
  fi
  choose_https_name
  [ -z "${WORKOS_API_KEY:-}" ] || [ -z "${WORKOS_CLIENT_ID:-}" ] || refuse_a_shared_name_with_workos
  write_env_file
  [ -z "${CADDY_GLOBAL_OPTIONS:-}" ] || set_env_value CADDY_GLOBAL_OPTIONS "$CADDY_GLOBAL_OPTIONS"
  [ -z "$https_name" ] || "$install_dir/alfera" https-settings "$https_name"
  "$install_dir/alfera" secret-files
  rm -f "$marker"
}

# The address people open: the https name when the install has one.
dashboard_address() {
  if [ -n "$https_name" ]; then
    printf 'https://%s' "$https_name"
  else
    printf 'http://localhost:%s' "$app_port"
  fi
}

answers_now() {
  local status
  status="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 2>/dev/null || true)"
  [ "$status" = '200' ] || [ "$status" = "${2:-200}" ]
}

# Finished means: the .env is whole, each of the five services runs, and the API and the
# dashboard answer. A second run on such an install has nothing to do.
install_is_finished() {
  local running service
  [ -f "$install_dir/.env" ] && [ ! -f "$install_dir/.env.unfinished" ] || return 1
  running=" $(cd "$install_dir" && docker compose ps --status running --services 2>/dev/null | tr '\n' ' ')"
  for service in postgres engine api worker app; do
    case "$running" in
      *" $service "*) ;;
      *) return 1 ;;
    esac
  done
  answers_now "http://localhost:$(read_env_value API_PORT)/health" &&
    answers_now "http://localhost:$(read_env_value APP_PORT)/sign-in" 401
}

stop_when_already_installed() {
  local wanted_name="$https_name" address
  install_is_finished || return 0
  https_name="$(read_env_value ALFERA_PUBLIC_HOST)"
  address="$(read_env_value NEXT_PUBLIC_APP_URL)"
  current_step='install'
  if [ -n "$wanted_name" ] && [ "$wanted_name" != "$https_name" ]; then
    [ "$wanted_name" = 'auto' ] && [ -n "$https_name" ] ||
      fail installed_with_other_address "Alfera is already installed here at $address. To serve it over https, run: cd $install_dir && ./alfera add https ${wanted_name#auto}"
  fi
  print_step "Alfera is already installed and running at $address. Nothing was changed."
  print_step "For a new sign-in link:  cd $install_dir && ./alfera team link"
  print_step "For a new version:       cd $install_dir && ./alfera update"
  report_progress done changed no address "$address" install_dir "$install_dir" name_kind "$(name_kind)"
  exit 0
}

readonly build_stopped='The image build stopped. The lines above say why. Fix that, then run this again: it keeps the .env it wrote.'

# One image at a time. Each build installs packages and bundles them, and two at once can
# exhaust a desktop Docker's memory.
# The dashboard build is killed when Docker has 3 GB of memory and ends well with 4 GB (measured
# with no swap, on two processor cores). So a machine with less is told now, and not after ten
# minutes of building. A server sold as "4 GB" shows about 3.8 GB, and swap counts.
swap_megabytes() {
  local swap_mb=0
  if command -v free >/dev/null 2>&1; then
    swap_mb="$(free -m | awk '$1 == "Swap:" { print $2 }')"
  elif [ -r /proc/meminfo ]; then
    swap_mb="$(awk '$1 == "SwapTotal:" { print int($2 / 1024) }' /proc/meminfo)"
  fi
  printf '%s' "${swap_mb:-0}"
}

check_memory_to_build() {
  local memory_mb swap_mb
  memory_mb="$(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{ print int($1 / 1048576) }')"
  swap_mb="$(swap_megabytes)"
  [ "${memory_mb:-0}" -gt 0 ] || return 0
  [ "$((memory_mb + ${swap_mb:-0}))" -ge 3400 ] ||
    fail not_enough_memory "Docker has $memory_mb MB of memory here, and building the images needs about 4 GB. Use a machine with 4 GB or more, or give Docker more memory, then run this again."
}

build_api_image() {
  check_memory_to_build
  print_step ''
  print_step 'building the API image (the first build takes several minutes)'
  (cd "$install_dir" && docker compose build api) || fail image_build_failed "$build_stopped"
}

build_app_image() {
  print_step 'building the dashboard image'
  (cd "$install_dir" && docker compose build app) || fail image_build_failed "$build_stopped"
}

images_are_on_this_machine() {
  local images
  images="$(cd "$install_dir" && docker compose config --images 2>/dev/null)" && [ -n "$images" ] &&
    printf '%s\n' "$images" | xargs docker image inspect >/dev/null 2>&1
}

pull_images() {
  if [ "$uses_prepared_images" = 'yes' ] && images_are_on_this_machine; then
    print_step 'the images are already on this machine'
    return
  fi
  print_step 'pulling images'
  (cd "$install_dir" && docker compose pull --quiet) ||
    fail image_pull_failed 'The images did not download. Check the network, then run this again: it keeps the .env it wrote.'
}

# The address ranges tried by name when Docker has none left to hand out. The worker has the
# same list for the sandbox network. No range of 172.16.0.0/12 is in it: cloud networks use
# those.
subnet_candidates() {
  local third
  for third in 210 211 212 213 214 215 216 217 218 219; do printf '10.213.%s.0/24\n' "$third"; done
}

# The destinations in the route table of this machine, one per line.
host_routes() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 route 2>/dev/null | awk '{ print $1 }'
  else
    netstat -rn -f inet 2>/dev/null | awk '{ print $1 }'
  fi
}

# overlaps_a_route <range>: true when a destination on stdin overlaps the range. It reads the
# spelling of `ip route` (10.0.0.0/8, 10.1.2.3) and of netstat (10.213/16, 127, 10.1.2.3). The
# default route is not a network of its own, so it is skipped.
overlaps_a_route() {
  awk -v range="$1" '
    function parse(text,    parts, octets, count, position) {
      split(text, parts, "/")
      count = split(parts[1], octets, ".")
      if (count < 1 || count > 4) return 0
      parsed_address = 0
      for (position = 1; position <= 4; position++) {
        if (position <= count && octets[position] !~ /^[0-9]+$/) return 0
        parsed_address = parsed_address * 256 + (position <= count ? octets[position] : 0)
      }
      parsed_prefix = (parts[2] ~ /^[0-9]+$/) ? parts[2] + 0 : count * 8
      return 1
    }
    BEGIN { parse(range); range_address = parsed_address; range_prefix = parsed_prefix }
    parse($1) {
      shared = parsed_prefix < range_prefix ? parsed_prefix : range_prefix
      if (shared == 0) next
      block = 2 ^ (32 - shared)
      if (int(parsed_address / block) == int(range_address / block)) found = 1
    }
    END { exit found ? 0 : 1 }'
}

# The candidates that no route of this machine overlaps. Docker checks a range it is given
# against its own networks only, so a range of the office network or of a VPN would be taken
# without a word, and then that network could not be reached from this machine.
free_subnet_candidates() {
  local routes subnet
  routes="$(host_routes)"
  for subnet in $(subnet_candidates); do
    printf '%s\n' "$routes" | overlaps_a_route "$subnet" || printf '%s\n' "$subnet"
  done
}

# A machine with many Docker networks has no address range left in Docker's own pools, and
# then no network can be made without naming a range.
docker_has_no_free_range() {
  printf '%s' "$1" | grep -qiE 'address pools have been fully subnetted|could not find an available.*address pool|no available network'
}

# Compose reads docker-compose.override.yml next to docker-compose.yml on every command, so
# the helper and a hand-typed `docker compose` use the same range from now on.
write_stack_subnet() {
  cat >"$install_dir/docker-compose.override.yml" <<OVERRIDE
# Written by install.sh: Docker had no free address range, so this stack names its own.
networks:
  default:
    ipam:
      config:
        - subnet: $1
OVERRIDE
}

start_with_a_named_subnet() {
  local subnet output
  [ ! -f "$install_dir/docker-compose.override.yml" ] ||
    fail no_free_address_range "Docker has no free address range, and $install_dir/docker-compose.override.yml is already there. Add a subnet for the default network to it, then run this again."
  for subnet in $(free_subnet_candidates); do
    write_stack_subnet "$subnet"
    if output="$(cd "$install_dir" && docker compose up -d 2>&1)"; then
      printf '%s\n' "$output"
      print_step "Docker had no free address range, so the stack uses $subnet (docker-compose.override.yml)"
      return 0
    fi
    rm -f "$install_dir/docker-compose.override.yml"
    if ! printf '%s' "$output" | grep -qi 'overlaps'; then
      printf '%s\n' "$output"
      return 1
    fi
  done
  printf 'Docker has no free address range, and every range tried by name is taken or is a route of this machine. Run: docker network prune\n' >&2
  return 1
}

# Every sandbox container goes on a network of its own. The worker makes it on first use, but
# from inside its container it cannot see the routes of this machine. So the installer makes
# it here, where it can. The arguments are the ones of docker_sandbox_network.ts.
make_sandbox_network() {
  local name subnet
  name="$(read_env_value COWORKER_SANDBOX_NETWORK)"
  name="${name:-alfera-sandbox}"
  if docker network inspect "$name" >/dev/null 2>&1; then return 0; fi
  set -- network create --driver bridge --opt com.docker.network.bridge.enable_icc=false
  if docker "$@" "$name" >/dev/null 2>&1; then return 0; fi
  for subnet in $(free_subnet_candidates); do
    if docker "$@" --subnet "$subnet" "$name" >/dev/null 2>&1; then
      print_step "Docker had no free address range, so the sandbox network $name uses $subnet"
      return 0
    fi
  done
  print_step "the sandbox network $name could not be made now. The worker tries again when a chat first runs a command."
}

why_the_stack_did_not_start='stack_start_failed'

start_compose_stack() {
  local output
  if output="$(cd "$install_dir" && docker compose up -d 2>&1)"; then
    printf '%s\n' "$output"
    return 0
  fi
  printf '%s\n' "$output"
  if printf '%s' "$output" | grep -qiE 'port is already allocated|address already in use'; then
    why_the_stack_did_not_start='port_in_use'
  fi
  docker_has_no_free_range "$output" || return 1
  why_the_stack_did_not_start='no_free_address_range'
  start_with_a_named_subnet
}

start_stack() {
  print_step 'starting the stack'
  start_compose_stack ||
    fail "$why_the_stack_did_not_start" "The stack did not start. The lines above say why. Fix that, then run this again, or read the logs with: cd $install_dir && docker compose logs"
  make_sandbox_network
}

# An install that signs people in with its own links serves no page without a session, so
# there the dashboard's answer is 401. `also_fine` names that one extra answer.
wait_until_it_answers() {
  local name="$1" url="$2" also_fine="${3:-}" attempt=0 status
  while [ "$attempt" -lt 90 ]; do
    status="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if { [ "$status" -ge 200 ] && [ "$status" -lt 400 ]; } || [ "$status" = "$also_fine" ]; then
      print_step "$name answered"
      return
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  fail "${current_step}_did_not_answer" "$name did not answer at $url within three minutes. Read the logs with: cd $install_dir && docker compose logs migrations engine api app"
}

wait_for_the_api() {
  wait_until_it_answers 'the API' "http://localhost:$api_port/health"
}

wait_for_the_dashboard() {
  local also_fine=''
  [ "$sign_in_mode" != 'links' ] || also_fine='401'
  wait_until_it_answers 'the dashboard' "http://localhost:$app_port/sign-in" "$also_fine"
}

# The certificate comes in the first minute when the name points at this machine and ports 80
# and 443 are open. The question is put to this machine itself, so no route has to lead back
# in. A certificate that Caddy signed itself, or one of a test authority, is not checked.
wait_for_the_certificate() {
  local attempt=0 status trust=''
  case "$(read_env_value CADDY_GLOBAL_OPTIONS)" in
    *local_certs* | *acme_ca*) trust='--insecure' ;;
  esac
  while [ "$attempt" -lt 90 ]; do
    status="$(curl -s -o /dev/null -m 5 -w '%{http_code}' $trust \
      --resolve "$https_name:443:127.0.0.1" "https://$https_name/health" 2>/dev/null || true)"
    if [ "$status" = '200' ]; then
      print_step "https://$https_name answered"
      return
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  fail certificate_not_issued "https://$https_name did not answer with a certificate within three minutes. The name must point at this machine, and ports 80 and 443 must be open to the internet. The stack runs, and it goes on asking for the certificate. Read why with: cd $install_dir && ./alfera logs caddy"
}

# The owner signs in with a one-time link. The helper asks the API for one.
# The installer's link lasts ten minutes: it is printed, and handed to the browser.
read_owner_link() {
  "$install_dir/alfera" team link 10 2>/dev/null | sed -n 's/^  \(http.*\)$/\1/p'
}

# Only for a person at a terminal. Without one, or without a browser, the printed link is enough.
open_in_browser() {
  local url="$1"
  has_terminal || return 1
  case "$(uname -s)" in
    Darwin) open "$url" >/dev/null 2>&1 ;;
    # A browser lives on after this script: it must not keep the lock of the install open.
    Linux) command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 8>&- ;;
    *) return 1 ;;
  esac
}

print_sign_in_steps() {
  local owner_link
  case "$sign_in_mode" in
    workos)
      print_step 'One step is left, in the WorkOS dashboard, before the first sign-in:'
      print_step "  Redirects -> add  $(dashboard_address)/auth/callback"
      ;;
    local)
      print_step 'This install runs in local mode, with no sign-in: it serves anyone who can reach its port.'
      print_step "Turn sign-in on (your workspace is kept):  cd $install_dir && ./alfera team link"
      ;;
    *)
      # A run with no person at it writes to a log, and a sign-in link is a secret.
      if [ "$unattended" = 'yes' ] || [ "$progress" = 'yes' ]; then
        print_step "For your sign-in link:  cd $install_dir && ./alfera team link"
        return
      fi
      owner_link="$(read_owner_link)"
      [ -n "$owner_link" ] || fail sign_in_link_not_made "The stack runs, but it made no sign-in link. Run: cd $install_dir && ./alfera doctor"
      print_step 'Your sign-in link. It works once, for ten minutes:'
      print_step ''
      print_step "  $owner_link"
      print_step ''
      if open_in_browser "$owner_link"; then
        print_step 'It is opening in your browser.'
      elif [ -n "$https_name" ]; then
        print_step 'Open it in your browser.'
      else
        print_step 'Open it in a browser on this machine.'
      fi
      print_step "For a new link later:  cd $install_dir && ./alfera team link"
      if [ -n "$https_name" ]; then
        print_step 'Invite your team in Settings -> Team.'
      else
        print_step "Only this machine can open Alfera now. To invite your team:  ./alfera add team"
      fi
      ;;
  esac
}

print_next_steps() {
  print_step ''
  print_step "Alfera is running at $(dashboard_address)"
  [ "$(name_kind)" != 'shared' ] || print_step "$("$install_dir/alfera" shared-name-words)"
  print_step ''
  print_sign_in_steps
  print_step ''
  print_step "Manage it from $install_dir:"
  print_step '  ./alfera status        what runs, and what is set up'
  print_step '  ./alfera doctor        find and fix a problem'
  print_step '  ./alfera add slack     add Slack, email, apps, search'
  print_step '  ./alfera add team      let other machines in, then invite your team'
  print_step '  ./alfera stop          stop it (./alfera start brings it back)'
  print_step ''
  print_step 'This is the open engine. The full product is at alfera.ai'
}

add_swap() {
  [ "$(swap_megabytes)" -lt 1024 ] || return 0
  if [ ! -f "$swap_file" ]; then
    fallocate -l 2G "$swap_file" 2>/dev/null || dd if=/dev/zero of="$swap_file" bs=1M count=2048 status=none
  fi
  chmod 0600 "$swap_file"
  if mkswap "$swap_file" >/dev/null 2>&1 && swapon "$swap_file" 2>/dev/null; then
    grep -q "^$swap_file " /etc/fstab || printf '%s none swap sw 0 0\n' "$swap_file" >>/etc/fstab
    print_step 'added 2 GB of swap'
    return
  fi
  rm -f "$swap_file"
  print_step 'this machine does not allow swap, so the install goes on without it'
}

ssh_password_login() {
  sshd -T 2>/dev/null | awk '$1 == "passwordauthentication" { print $2 }'
}

close_ssh_password_login() {
  command -v sshd >/dev/null 2>&1 || return 0
  mkdir -p /run/sshd
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' >"$ssh_settings_file"
  chmod 0644 "$ssh_settings_file"
  sshd -t 2>/dev/null ||
    fail ssh_password_login_not_closed "sshd refuses its settings after $ssh_settings_file was written. Look at the files in /etc/ssh/sshd_config.d, then run this again."
  if systemctl is-active --quiet ssh 2>/dev/null; then
    systemctl reload ssh 8>&- ||
      fail ssh_password_login_not_closed 'the running sshd did not take its new settings. Run: systemctl reload ssh, then run this again.'
  fi
  [ "$(ssh_password_login)" = 'no' ] ||
    fail ssh_password_login_not_closed "sshd still takes passwords after $ssh_settings_file was written. Look at the files in /etc/ssh/sshd_config.d, then run this again."
  print_step 'SSH takes no password'
}

registry_of_the_images() {
  printf '%s' "${api_image%%/*}"
}

sign_in_to_the_registry() {
  [ -n "${ALFERA_REGISTRY_USER:-}" ] && [ -n "${ALFERA_REGISTRY_TOKEN:-}" ] || return 0
  printf '%s' "$ALFERA_REGISTRY_TOKEN" |
    docker login "$(registry_of_the_images)" -u "$ALFERA_REGISTRY_USER" --password-stdin >/dev/null ||
    fail registry_login_failed "docker login to $(registry_of_the_images) as $ALFERA_REGISTRY_USER was refused."
  print_step "signed in to $(registry_of_the_images)"
}

prepare_the_machine() {
  [ "$(id -u)" = '0' ] || fail bad_arguments '--first-boot sets up the machine itself, so it runs as root.'
  add_swap
  close_ssh_password_login
  sign_in_to_the_registry
}

seconds_up() {
  awk '{ print int($1) }' /proc/uptime 2>/dev/null || printf '0'
}

address_is_on_this_machine() {
  ip -4 -o address show 2>/dev/null | grep -q " $1/"
}

address_is_final() {
  if [ -n "$reserved_address" ]; then
    [ "$1" = "$reserved_address" ]
    return
  fi
  address_is_on_this_machine "$1" || [ "$(seconds_up)" -ge "$seconds_up_before_a_cloud_address_is_final" ]
}

address_can_be_used() {
  [ -n "$1" ] && address_is_final "$1" && { [ "$1" = "$2" ] || [ "$1" = "$reserved_address" ]; }
}

check_the_reserved_address() {
  [ -z "$reserved_address" ] ||
    printf '%s' "$reserved_address" | grep -Eqx '([0-9]{1,3}\.){3}[0-9]{1,3}' ||
    fail public_address_not_stable "ALFERA_PUBLIC_ADDRESS is not an IPv4 address: $reserved_address"
}

wait_for_a_stable_public_address() {
  local address last='' checks=0
  check_the_reserved_address
  while :; do
    checks=$((checks + 1))
    [ "$checks" -le "$most_address_checks" ] ||
      fail public_address_not_stable "the public address of this machine did not stay the same in ten minutes (last: ${last:-none})."
    address="$("$install_dir/alfera" public-address 2>/dev/null || true)"
    ! address_can_be_used "$address" "$last" || break
    last="$address"
    sleep "$seconds_between_address_checks"
  done
  print_step "the public address $address is stable"
}

pull_the_sandbox_image() {
  if docker pull --quiet "$sandbox_image" >/dev/null 2>&1; then
    print_step "the sandbox image $sandbox_image is on this machine"
  else
    print_step "the sandbox image $sandbox_image did not download now. The first chat downloads it."
  fi
}

start_the_sandbox_image_download() {
  if docker image inspect "$sandbox_image" >/dev/null 2>&1; then
    print_step "the sandbox image $sandbox_image is on this machine"
    return
  fi
  pull_the_sandbox_image 3>&- 8>&- &
  print_step "the sandbox image $sandbox_image downloads while the owner sets Alfera up"
}

trap leave EXIT
begin "$@"
run_step tools check_required_tools
run_step docker check_docker
[ "$first_boot" != 'yes' ] || run_step machine prepare_the_machine
run_step source choose_install_dir
stop_when_already_installed
[ "$first_boot" != 'yes' ] || run_step address wait_for_a_stable_public_address
run_step settings write_whole_env_file
if [ "$builds_from_source" = 'yes' ]; then
  run_step api_image build_api_image
  run_step app_image build_app_image
else
  run_step images pull_images
fi
run_step start start_stack
run_step api wait_for_the_api
run_step dashboard wait_for_the_dashboard
[ -z "$https_name" ] || run_step https wait_for_the_certificate
[ "$first_boot" != 'yes' ] || run_step sandbox_image start_the_sandbox_image_download
current_step='install'
print_next_steps
report_progress done changed yes address "$(dashboard_address)" install_dir "$install_dir" name_kind "$(name_kind)"
