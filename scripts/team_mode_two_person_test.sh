#!/usr/bin/env bash
# Walks a running team-mode install as two people, with one cookie jar each, and then attacks it.
#
#   scripts/team_mode_two_person_test.sh <install folder>
#
# The install folder holds docker-compose.yml, .env and the `alfera` helper. The script makes
# two members ("Test Member", "Second Member") and two more people it removes again, a few
# chats, one API key and one scheduled task, and leaves the owner signed out. Run it on a test
# install.
#
# OWNER_LINK=<link>           signs the owner in with this link, such as the one install.sh printed.
# LOCAL_CHAT_ID=<session id>  also checks that a chat made before sign-in is still the owner's.
# WITH_MODEL=1                also has the coworker save a note, start a sandbox, try another
#                             member's task and run a scheduled task (uses the model key).
set -uo pipefail

install_dir="${1:?give the install folder}"
env_file="$install_dir/.env"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A value in double quotes is read the way the helper and Docker Compose read it.
read_setting() {
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
  }' "$env_file"
}

address="$(read_setting NEXT_PUBLIC_APP_URL)"
api="http://localhost:$(read_setting API_PORT)"
owner_jar="$work/owner.jar"
member_jar="$work/member.jar"
second_jar_of_member="$work/second_member.jar"
failures=0

check() {
  local what="$1" wanted="$2" got="$3"
  if [ "$wanted" = "$got" ]; then
    printf '  ok    %s (%s)\n' "$what" "$got"
  else
    failures=$((failures + 1))
    printf '  FAIL  %s: wanted %s, got %s\n' "$what" "$wanted" "$got"
  fi
}

# A browser sends Origin on every write from the page. curl does not, so every write names it.
status_of() {
  curl -s -o "$work/body" -w '%{http_code}' -m 30 "$@"
}

as() {
  local jar="$1" method="$2" path="$3"
  shift 3
  status_of -b "$jar" -c "$jar" -X "$method" -H "Origin: $address" -H 'accept: application/json' \
    -H 'content-type: application/json' "$@" "$address$path"
}

field() {
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$work/body" | head -1
}

session_token_in() {
  awk '$6 == "alfera_team_session" { print $7 }' "$1"
}

join_with() {
  local jar="$1" link="$2"
  check 'opening the link shows the join page' 200 "$(status_of -c "$jar" -H 'accept: text/html' "$link")"
  check 'opening it again changes nothing' 200 "$(status_of -c "$jar" -H 'accept: text/html' "$link")"
  check 'the button signs the person in' 303 "$(status_of -c "$jar" -X POST -H "Origin: $address" "$link")"
}

invite() {
  as "$owner_jar" POST /api/v1/team/invitations -d "{\"name\":\"$1\",\"role\":\"$2\"}" >/dev/null
  invited_user_id="$(field user_id)"
  invited_link="$address/join/$(field token)"
}

expire_links_of() {
  (cd "$install_dir" && docker compose exec -T postgres psql -q -U "$(read_setting POSTGRES_USER)" \
    -d "$(read_setting POSTGRES_DB)" \
    -c "update team_sign_in_links set expires_time = now() - interval '1 second' where user_id = '$1'") >/dev/null
}

sql() {
  (cd "$install_dir" && docker compose exec -T postgres psql -qtA -U "$(read_setting POSTGRES_USER)" \
    -d "$(read_setting POSTGRES_DB)" -c "$1") | tr -d '\n'
}

owner_signed_in_before="$(sql "select count(*) from users where user_data ? 'team_sign_ins'" 2>/dev/null)"
owner_signed_in_before="${owner_signed_in_before:-0}"
printf 'Team mode at %s\n\n1. The owner signs in with the first link\n' "$address"
owner_link="${OWNER_LINK:-$("$install_dir/alfera" team link | sed -n 's/^  \(http.*\)$/\1/p')}"
join_with "$owner_jar" "$owner_link"
check 'the owner is on the team as owner' 200 "$(as "$owner_jar" GET /api/v1/team)"
owner_user_id="$(field viewer_user_id)"
check 'the owner role is owner' owner "$(field viewer_role)"
check 'the team page is told the address people open, from the install settings' "$address" "$(field address)"
local_origin="http://localhost:$(read_setting APP_PORT)"
check 'asked at localhost, the team page is still told the address people open' "$address" "$(status_of -H "Cookie: alfera_team_session=$(session_token_in "$owner_jar")" -H 'accept: application/json' "$local_origin/api/v1/team" >/dev/null; field address)"
if [ "$owner_signed_in_before" = 0 ]; then
  as "$owner_jar" POST /api/v1/team/arrival >/dev/null
  check 'the first sign-in of the owner shows no notice about a new link' 1 "$(grep -c '"sign_in_notice":null' "$work/body")"
else
  printf '  skip  the owner had signed in before, so this is not a first sign-in\n'
fi
if [ "${address#http://}" != "$address" ]; then
  curl -s -o /dev/null -D "$work/headers" -b "$owner_jar" -H 'accept: text/html' "$address/"
  check 'on plain http the signed-in hint cookie is set' 1 "$(grep -ci '^set-cookie: alfera_authed=1' "$work/headers")"
  check 'on plain http the signed-in hint cookie is not marked Secure' 0 "$(grep -i '^set-cookie: alfera_authed' "$work/headers" | grep -ci 'secure')"
fi
proxy_secret="$(read_setting COWORKER_API_PROXY_SECRET)"
check "the proxy secret the installer made is long and not the development one (${#proxy_secret} characters)" yes "$([ "${#proxy_secret}" -ge 32 ] && [ "$proxy_secret" != 'local-development-internal-api-secret' ] && printf yes || printf no)"
if [ -n "${LOCAL_CHAT_ID:-}" ]; then
  check 'the chat made in local mode is still the owner'"'"'s' 200 "$(as "$owner_jar" GET "/api/v1/sessions/$LOCAL_CHAT_ID")"
fi

printf '\n2. The owner invites a member, and the member joins\n'
invite 'Test Member' member
member_user_id="$invited_user_id"
member_link="$invited_link"
join_with "$member_jar" "$member_link"
check 'the member is on the team as member' member "$(as "$member_jar" GET /api/v1/team >/dev/null; field viewer_role)"
as "$member_jar" POST /api/v1/team/arrival >/dev/null
check 'the first sign-in of an invited person shows no notice about a new link' 1 "$(grep -c '"sign_in_notice":null' "$work/body")"
landing="$(curl -sL -o /dev/null -w '%{url_effective}' -b "$member_jar" -H 'accept: text/html' "$address/")"
check "the member lands in the app, not in the owner's set-up steps (at ${landing#"$address"})" 0 "$(printf '%s' "$landing" | grep -c '/onboarding')"

invite 'Second Member' member
second_member_user_id="$invited_user_id"
join_with "$second_jar_of_member" "$invited_link"

printf '\n3. Each makes a chat the other cannot read\n'
check 'the owner makes a chat' 201 "$(as "$owner_jar" POST /api/v1/sessions -d '{"session_title":"Owner only"}')"
owner_chat="$(field session_id)"
check 'the member makes a chat' 201 "$(as "$member_jar" POST /api/v1/sessions -d '{"session_title":"Member only"}')"
member_chat="$(field session_id)"
check 'the owner reads their own chat' 200 "$(as "$owner_jar" GET "/api/v1/sessions/$owner_chat")"
check 'the member reads their own chat' 200 "$(as "$member_jar" GET "/api/v1/sessions/$member_chat")"
check 'the member cannot read the owner chat' 404 "$(as "$member_jar" GET "/api/v1/sessions/$owner_chat")"
check 'the owner cannot read the member chat' 404 "$(as "$owner_jar" GET "/api/v1/sessions/$member_chat")"
as "$member_jar" GET /api/v1/sessions >/dev/null
check 'the owner chat is not in the member list' 0 "$(grep -c "$owner_chat" "$work/body")"
as "$owner_jar" GET /api/v1/sessions >/dev/null
check 'the member chat is not in the owner list' 0 "$(grep -c "$member_chat" "$work/body")"
check 'the member asks for the open question of the owner chat' 404 "$(as "$member_jar" GET "/api/v1/choices/open?session_id=$owner_chat")"

printf '\n3b. What works for a person without them is private to that person\n'
check 'the owner makes an API key' 201 "$(as "$owner_jar" POST /api/v1/api-keys -d '{"key_name":"Two person test","scopes":["sessions.read","sessions.write"]}')"
owner_key="$(field secret)"
key_chat_body='{"title":"Started with the owner key"}'
check 'a chat is started with the owner key, at the API port' 201 "$(status_of -X POST -H "Authorization: Bearer $owner_key" -H 'content-type: application/json' -d "$key_chat_body" "$api/v1/sessions")"
key_chat="$(field session_id)"
check 'that chat is in the Personal room of the owner' "$owner_user_id" "$(sql "select p.personal_for_user_id from sessions s join projects p on p.project_id = s.project_id where s.session_id = '$key_chat'")"
check 'the owner opens the chat of their key in the dashboard' 200 "$(as "$owner_jar" GET "/api/v1/sessions/$key_chat")"
check 'the member cannot open the chat of the owner key' 404 "$(as "$member_jar" GET "/api/v1/sessions/$key_chat")"
check 'the member cannot read its messages' 404 "$(as "$member_jar" GET "/api/v1/sessions/$key_chat/messages")"
as "$member_jar" GET /api/v1/sessions >/dev/null
check 'the chat of the owner key is not in the member list' 0 "$(grep -c "$key_chat" "$work/body")"
as "$owner_jar" GET /api/v1/sessions >/dev/null
check 'it is in the owner list' 1 "$(grep -c "$key_chat" "$work/body")"
check 'the owner makes a chat that will be in no room' 201 "$(as "$owner_jar" POST /api/v1/sessions -d '{"session_title":"In no room"}')"
no_room_chat="$(field session_id)"
sql "update sessions set project_id = null where session_id = '$no_room_chat'" >/dev/null
check 'a chat in no room is still open to the person who started it' 200 "$(as "$owner_jar" GET "/api/v1/sessions/$no_room_chat")"
check 'a chat in no room is not open to a member' 404 "$(as "$member_jar" GET "/api/v1/sessions/$no_room_chat")"
as "$member_jar" GET /api/v1/sessions >/dev/null
check 'a chat in no room is not in the member list' 0 "$(grep -c "$no_room_chat" "$work/body")"
check 'no chat of this install is in no room except that one' 1 "$(sql "select count(*) from sessions where project_id is null and session_status <> 'deleted'")"

printf '\n3c. What the whole team shares is for an owner or an admin, and a secret is its maker'"'"'s\n'
check 'a member switches off the address the team gets mail at' 403 "$(as "$member_jar" PATCH /api/v1/workspace/email-address -d '{"enabled":false}')"
check 'a member reads that address' 200 "$(as "$member_jar" GET /api/v1/workspace/email-address)"
credential_body='{"display_name":"Two person test key","allowed_hosts":["api.example.com"],"secret_values":{"api_key":"two-person-test-value"}}'
check 'the owner stores a credential' 200 "$(as "$owner_jar" POST /api/v1/connection-credentials -d "$credential_body")"
owner_credential="$(field connection_id)"
as "$member_jar" GET /api/v1/connection-credentials >/dev/null
check 'the credential of the owner is not in the list of a member' 0 "$(grep -c "$owner_credential" "$work/body")"
as "$owner_jar" GET /api/v1/connection-credentials >/dev/null
check 'it is in the list of the owner' 1 "$(grep -c "$owner_credential" "$work/body")"
check 'a member renews the credential of the owner' 404 "$(as "$member_jar" POST "/api/v1/connection-credentials/$owner_credential/exchange")"
check 'a member switches it off' 404 "$(as "$member_jar" DELETE "/api/v1/connection-credentials/$owner_credential")"
check 'the credential of the owner is still live' 0 "$(sql "select count(*) from connections where connection_id = '$owner_credential' and revoked_time is not null")"
for inside_host in postgres api 127.0.0.1 169.254.169.254 host.docker.internal; do
  inside_body="{\"display_name\":\"Inside\",\"allowed_hosts\":[\"$inside_host\"],\"secret_values\":{\"api_key\":\"x\"}}"
  check "a credential for the inside host $inside_host is refused" 400 "$(as "$owner_jar" POST /api/v1/connection-credentials -d "$inside_body")"
done
sql "update sessions set created_by = 'system:email', session_source = 'email' where session_id = '$no_room_chat'" >/dev/null
member_room="$(sql "select project_id from projects where personal_for_user_id = '$member_user_id'")"
owner_room="$(sql "select project_id from projects where personal_for_user_id = '$owner_user_id'")"
check 'a mail thread from outside is open to a member' 200 "$(as "$member_jar" GET "/api/v1/sessions/$no_room_chat")"
to_member_room="{\"project_id\":\"$member_room\"}"
to_owner_room="{\"project_id\":\"$owner_room\"}"
check 'a member moves that shared chat into their own room' 403 "$(as "$member_jar" PATCH "/api/v1/sessions/$no_room_chat" -d "$to_member_room")"
check 'it is still open to the other member' 200 "$(as "$second_jar_of_member" GET "/api/v1/sessions/$no_room_chat")"
check 'the owner moves it' 200 "$(as "$owner_jar" PATCH "/api/v1/sessions/$no_room_chat" -d "$to_owner_room")"
connected=''
for app_id in $(sql "select string_agg(app_id, ' ') from (select app_id from apps where catalog_scope <> 'workspace' order by app_name limit 40) as some_apps"); do
  new_connection="{\"app_id\":\"$app_id\"}"
  if [ "$(as "$member_jar" POST /api/v1/connections -d "$new_connection")" = 201 ]; then
    connected="$(field connection_id)"
    break
  fi
done
if [ -n "$connected" ]; then
  check 'a connection a member starts, with no choice made, is the member'"'"'s alone' restricted "$(sql "select connection_config ->> 'connection_access_type' from connections where connection_id = '$connected'")"
else
  printf '  skip  no app of this install can be connected without a key, so no connection was started\n'
fi

# Sends one message and waits for the coworker to finish. Prints the HTTP status.
say_to_coworker() {
  local jar="$1" chat="$2" words="$3"
  curl -s -o "$work/body" -w '%{http_code}' -m 600 -b "$jar" -X POST -H "Origin: $address" \
    -H 'content-type: application/json' -d "{\"message\":\"$words\"}" "$address/api/v1/sessions/$chat/messages"
}

sandbox_network="$(read_setting COWORKER_SANDBOX_NETWORK)"
sandbox_network="${sandbox_network:-alfera-sandbox}"

# Whether a TCP port answers, asked from inside a container. Prints open or closed.
reach_from() {
  docker exec "$1" bash -c "timeout 5 bash -c '</dev/tcp/$2/$3' 2>/dev/null && echo open || echo closed"
}

# curl exits 0 or 52 (connected, empty answer) when the port took the connection.
open_or_closed_by_curl_exit() {
  if [ "$1" = '0' ] || [ "$1" = '52' ]; then printf open; else printf closed; fi
}

address_of_service() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
    "$(cd "$install_dir" && docker compose ps -q "$1")"
}

printf '\n4. A note the coworker saves, and who can read it\n'
if [ "${WITH_MODEL:-}" = '1' ]; then
  code_word="plum$(date +%s)"
  check 'the owner asks the coworker to remember a note, in a private chat' 201 "$(say_to_coworker "$owner_jar" "$owner_chat" "Remember this for later: our launch code word is $code_word. Save it to a file now.")"
  note_file="$(grep -rl "$code_word" "$(read_setting COWORKER_WORKSPACE_HOST_PATH)"/*/volume 2>/dev/null | head -1)"
  note_path="${note_file##*/workspace/}"
  check "the note is a file in the workspace folder (${note_path:-<not found>})" yes "$([ -n "$note_file" ] && printf yes || printf no)"
  check 'the member cannot read the chat the note was made in' 404 "$(as "$member_jar" GET "/api/v1/sessions/$owner_chat/messages")"
  check 'TRUTH: the member can read the note file itself, because the workspace folder is one for all members' 200 "$(status_of -b "$member_jar" -G --data-urlencode "file_path=$note_path" "$address/api/v1/workspace/files/content")"
  check 'TRUTH: that file holds the code word' 1 "$(grep -c "$code_word" "$work/body")"
  check "the member asks their own coworker for the word" 201 "$(say_to_coworker "$member_jar" "$member_chat" "Look through the files in the workspace folder for a launch code word and tell me the word.")"
  as "$member_jar" GET "/api/v1/sessions/$member_chat/messages" >/dev/null
  check "TRUTH: the member's coworker reads the note and answers with the word" yes "$(grep -q "$code_word" "$work/body" && printf yes || printf no)"
else
  printf '  skip  no model run asked for (WITH_MODEL=1)\n'
fi

printf '\n5. What a sandbox container can reach\n'
sandbox="$(docker ps --format '{{.Names}}' --filter 'name=^coworker-' | head -1)"
if [ -n "$sandbox" ]; then
  check "the sandbox the coworker started ($sandbox) is on the sandbox network only" "$sandbox_network" "$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$sandbox")"
else
  printf '  note  no sandbox of the coworker is running, so the checks use a container started the same way\n'
  sandbox="team-test-sandbox-$$"
  printf '  note  that container still has its private addresses, so the address checks below fail for it\n'
  docker run --detach --rm --name "$sandbox" --network "$sandbox_network" --user node node:24-bookworm sleep 600 >/dev/null
  started_a_sandbox='yes'
fi
neighbour="team-test-neighbour-$$"
docker run --detach --rm --name "$neighbour" --network "$sandbox_network" node:24-bookworm \
  node -e "require('http').createServer((q, s) => s.end('x')).listen(8099)" >/dev/null
sleep 2
for service in app:3000 api:3001 postgres:5432 engine:6420; do
  name="${service%:*}"
  port="${service#*:}"
  check "by name: $name:$port" closed "$(reach_from "$sandbox" "$name" "$port")"
  check "by container address: $name at $(address_of_service "$name"):$port" closed "$(reach_from "$sandbox" "$(address_of_service "$name")" "$port")"
done
check 'another sandbox on the same network, which listens on a port' closed "$(reach_from "$sandbox" "$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$neighbour")" 8099)"
gateway="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$sandbox_network")"
check "the gateway of the sandbox network ($gateway), on the dashboard port" closed "$(reach_from "$sandbox" "$gateway" "$(read_setting APP_PORT)")"
check 'this machine through host.docker.internal, on the dashboard port' closed "$(reach_from "$sandbox" host.docker.internal "$(read_setting APP_PORT)")"
check 'this machine through host.docker.internal, on the API port' closed "$(reach_from "$sandbox" host.docker.internal "$(read_setting API_PORT)")"
lan_host="$(printf '%s' "$address" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
check "this machine at its network address ($lan_host), on the dashboard port" closed "$(reach_from "$sandbox" "$lan_host" "$(read_setting APP_PORT)")"
check 'a public site answers' 200 "$(docker exec "$sandbox" curl -s -m 20 -o /dev/null -w '%{http_code}' https://example.com)"
check 'a name is looked up inside the closed sandbox' yes "$(docker exec "$sandbox" getent hosts example.com >/dev/null 2>&1 && printf yes || printf no)"
mapped="$(docker exec "$sandbox" curl -s -g -m 5 -o /dev/null "http://[::ffff:$(address_of_service postgres)]:5432"; printf '%s' "$?")"
check "an IPv4-mapped IPv6 address of the database is no way in (curl exit $mapped)" closed "$(open_or_closed_by_curl_exit "$mapped")"
check 'the cloud metadata address' closed "$(reach_from "$sandbox" 169.254.169.254 80)"
check 'a package registry answers' 200 "$(docker exec "$sandbox" curl -s -m 20 -o /dev/null -w '%{http_code}' https://registry.npmjs.org/left-pad)"
docker rm --force "$neighbour" >/dev/null
[ "${started_a_sandbox:-}" != 'yes' ] || docker rm --force "$sandbox" >/dev/null

printf '\n6. A scheduled task belongs to the member who made it\n'
task_name="Orchid report $(date +%s)"
task_body="{\"trigger_name\":\"$task_name\",\"trigger_type\":\"schedule\",\"schedule_expression\":\"0 0 1 1 *\",\"trigger_config\":{\"starts_job_handler\":\"run_scheduled_agent_task\",\"timezone\":\"UTC\",\"job_input\":{\"instruction\":\"Run the shell command sleep 25 six times, one command after the other. Then answer done.\"}}}"
check 'a member makes a scheduled task' 201 "$(as "$member_jar" POST /api/v1/triggers -d "$task_body")"
task_id="$(field trigger_id)"
as "$member_jar" GET /api/v1/triggers >/dev/null
check 'the maker sees the task in their list' 1 "$(grep -c "$task_id" "$work/body")"
as "$second_jar_of_member" GET /api/v1/triggers >/dev/null
check 'another member does not see it in their list' 0 "$(grep -c "$task_id" "$work/body")"
as "$owner_jar" GET /api/v1/triggers >/dev/null
check 'the owner sees it' 1 "$(grep -c "$task_id" "$work/body")"
check 'another member reads its runs' 404 "$(as "$second_jar_of_member" GET "/api/v1/triggers/$task_id/runs")"
check 'another member changes it' 404 "$(as "$second_jar_of_member" PATCH "/api/v1/triggers/$task_id" -d '{"trigger_name":"Taken over"}')"
check 'another member switches it off' 404 "$(as "$second_jar_of_member" PATCH "/api/v1/triggers/$task_id" -d '{"trigger_status":"disabled"}')"
check 'another member runs it now' 404 "$(as "$second_jar_of_member" POST "/api/v1/triggers/$task_id/run" -d '{"occurrence_key":"by-another-member"}')"
check 'another member deletes it' 404 "$(as "$second_jar_of_member" DELETE "/api/v1/triggers/$task_id")"
check 'the task is as its maker left it' "$task_name|enabled" "$(sql "select trigger_name || '|' || trigger_status from triggers where trigger_id = '$task_id'")"
if [ "${WITH_MODEL:-}" = '1' ]; then
  check 'another member makes a chat to ask their coworker' 201 "$(as "$second_jar_of_member" POST /api/v1/sessions -d '{"session_title":"Tasks of others"}')"
  asking_chat="$(field session_id)"
  check "another member's coworker is asked to list every scheduled task" 201 "$(say_to_coworker "$second_jar_of_member" "$asking_chat" "List every scheduled task you can see, with its name and id. Use your scheduled task tool.")"
  as "$second_jar_of_member" GET "/api/v1/sessions/$asking_chat/messages" >/dev/null
  check "that coworker does not see the other member's task" 0 "$(grep -c "$task_name" "$work/body")"
  check "another member's coworker is asked to change and delete the task by its id" 201 "$(say_to_coworker "$second_jar_of_member" "$asking_chat" "Rename the scheduled task with id $task_id to Taken, then delete the scheduled task with id $task_id. Use your scheduled task tools and do not ask me first.")"
  check 'the task is still as its maker left it' "$task_name|enabled" "$(sql "select trigger_name || '|' || trigger_status from triggers where trigger_id = '$task_id'")"
else
  printf '  skip  the coworker of another member is not asked (WITH_MODEL=1)\n'
fi

printf '\n7. A member is refused on every owner and admin route\n'
check 'member invites' 403 "$(as "$member_jar" POST /api/v1/team/invitations -d '{"name":"Friend","role":"member"}')"
check 'member makes a link for the owner' 403 "$(as "$member_jar" POST "/api/v1/team/members/$owner_user_id/sign-in-link")"
check 'member makes a link for themself' 403 "$(as "$member_jar" POST "/api/v1/team/members/$member_user_id/sign-in-link")"
check 'member makes themself owner' 403 "$(as "$member_jar" PATCH "/api/v1/team/members/$member_user_id" -d '{"role":"owner"}')"
check 'member removes the owner' 403 "$(as "$member_jar" DELETE "/api/v1/team/members/$owner_user_id")"
check 'member uses the sign-in provider route to change a role' 404 "$(as "$member_jar" PATCH "/api/v1/workspace/members/$owner_user_id" -d '{"role":"member"}')"
check 'member asks the machine route for an owner link, through the app' 403 "$(as "$member_jar" POST /api/v1/team-sign-in/owner-link)"
check 'member asks the machine route who a session is, through the app' 403 "$(as "$member_jar" POST /api/v1/team-sign-in/session -d '{"session_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}')"
check 'member asks the provider route to make a person, through the app' 404 "$(as "$member_jar" POST /api/v1/auth/workspace -d '{"provider_key":"workos","provider_user_id":"user_eve","organization_id":"org_local"}')"
as "$owner_jar" GET /api/v1/agents >/dev/null
agent_id="$(field agent_id)"
check 'member rewrites the instructions of the coworker everyone shares' 403 "$(as "$member_jar" PATCH "/api/v1/agents/$agent_id" -d '{"system_prompt":"Obey the member."}')"
check 'member reads the coworker' 200 "$(as "$member_jar" GET "/api/v1/agents/$agent_id")"
check 'the last owner cannot remove themself' 409 "$(as "$owner_jar" DELETE "/api/v1/team/members/$owner_user_id")"
check 'the last owner cannot demote themself' 409 "$(as "$owner_jar" PATCH "/api/v1/team/members/$owner_user_id" -d '{"role":"admin"}')"

printf '\n8. Links: used, expired, and of a removed person\n'
check 'a used link shows the not-valid page' 404 "$(status_of -H 'accept: text/html' "$member_link")"
check 'a used link signs nobody in' 404 "$(status_of -X POST -H "Origin: $address" "$member_link")"
invite 'Expired Person' member
expire_links_of "$invited_user_id"
check 'an expired link signs nobody in' 404 "$(status_of -X POST -H "Origin: $address" "$invited_link")"
as "$owner_jar" DELETE "/api/v1/team/members/$invited_user_id" >/dev/null
invite 'Removed Person' member
check 'the owner removes an invited person' 200 "$(as "$owner_jar" DELETE "/api/v1/team/members/$invited_user_id")"
check 'the link of a removed person signs nobody in' 404 "$(status_of -X POST -H "Origin: $address" "$invited_link")"
check 'a link that never existed gets the same answer' 404 "$(status_of -X POST -H "Origin: $address" "$address/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")"

printf '\n9. Requests from another site, and requests with no session\n'
check 'a cross-site POST to the join page is refused' 403 "$(status_of -X POST -H 'Origin: https://attacker.example' "$address/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")"
check 'a POST with no Origin to the join page is refused' 403 "$(status_of -X POST "$address/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")"
check 'a cross-site invitation with the owner cookie is refused' 403 "$(status_of -b "$owner_jar" -X POST -H 'Origin: https://attacker.example' -H 'content-type: application/json' -d '{"name":"Eve","role":"owner"}' "$address/api/v1/team/invitations")"
check 'a cross-site invitation marked by the browser is refused' 403 "$(status_of -b "$owner_jar" -X POST -H 'Sec-Fetch-Site: cross-site' -H "Origin: $address" -H 'content-type: application/json' -d '{"name":"Eve","role":"owner"}' "$address/api/v1/team/invitations")"
for path in / /chats /settings/team /sign-in /sign-up /onboarding /auth/session /auth/callback /callback /connect/start /product-demo /api/v1/workspace /api/v1/team /monitoring /join; do
  check "no session: GET $path" 401 "$(status_of -H 'accept: text/html' "$address$path")"
done
check 'no session: a caller that names localhost gets the sign-in page' 401 "$(status_of -H 'Host: localhost' -H 'accept: text/html' "$address/")"
check 'no session: that page says how to get a link' yes "$(grep -q 'alfera team link' "$work/body" && printf yes || printf no)"
check 'no session: that page holds nothing of the workspace' 0 "$(grep -c "$owner_user_id\|Owner only\|workspace_id" "$work/body")"
check 'no session: a caller that names localhost gets no data' 401 "$(status_of -H 'Host: localhost' -H 'accept: application/json' "$address/api/v1/workspace")"
check 'no session: the data answer says how to get a link' yes "$(grep -q 'alfera team link' "$work/body" && printf yes || printf no)"
check 'no session: POST /api/v1/sessions' 401 "$(status_of -X POST -H "Origin: $address" -H 'content-type: application/json' -d '{}' "$address/api/v1/sessions")"
check 'no session: POST /monitoring' 401 "$(status_of -X POST -H "Origin: $address" -d '{}' "$address/monitoring")"
check 'no session: a server function called from another site is refused' 403 "$(status_of -X POST "$address/_serverFn/x")"
check 'no session: a server function called from the page is refused' 401 "$(status_of -X POST -H "Origin: $address" "$address/_serverFn/x")"
check 'no session: POST /auth/sign-out' 401 "$(status_of -X POST -H "Origin: $address" "$address/auth/sign-out")"
check 'a made-up session cookie is refused' 401 "$(status_of -H 'Cookie: alfera_team_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' -H 'accept: application/json' "$address/api/v1/team")"
curl -sL -o "$work/page" -b "$owner_jar" -H 'accept: text/html' "$address/"
asset="$(grep -aoE '/(assets|_build)/[A-Za-z0-9_./-]+\.js' "$work/page" | head -1)"
check "no session: the app's own file ${asset:-<none found>} is served" 200 "$(status_of "$address${asset:-/no-asset-found}")"
check 'no session: a file from the public folder is served' 200 "$(status_of "$address/favicon.svg")"
check 'no session: a file name that does not exist under /assets is not a way in' 404 "$(status_of -H 'accept: text/html' "$address/assets/nope.js")"

printf '\n10. The API port, without the app in front\n'
check 'no secret, no identity' 401 "$(status_of "$api/v1/team")"
check 'forged identity headers, no secret' 401 "$(status_of -H 'x-coworker-auth-provider: workos' -H "x-coworker-auth-user-id: $owner_user_id" -H 'x-coworker-auth-organization-id: org_local' "$api/v1/team")"
check 'forged identity headers, wrong secret' 401 "$(status_of -H 'x-coworker-api-secret: not-the-secret' -H 'x-coworker-auth-provider: workos' -H "x-coworker-auth-user-id: $owner_user_id" -H 'x-coworker-auth-organization-id: org_local' "$api/v1/team")"
check 'forged invitation, no secret' 401 "$(status_of -X POST -H 'content-type: application/json' -H "x-coworker-auth-user-id: $owner_user_id" -H 'x-coworker-auth-provider: workos' -d '{"name":"Eve","role":"owner"}' "$api/v1/team/invitations")"
check 'owner link, no secret' 401 "$(status_of -X POST "$api/v1/team-sign-in/owner-link")"
check 'session lookup, no secret' 401 "$(status_of -X POST -H 'content-type: application/json' -d '{"session_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' "$api/v1/team-sign-in/session")"
check 'the member cookie means nothing at the API port' 401 "$(status_of -b "$member_jar" "$api/v1/team")"
check 'the identity headers are dropped by the app, so a member cannot name the owner' member "$(as "$member_jar" GET /api/v1/team -H "x-coworker-auth-user-id: $owner_user_id" -H 'x-coworker-api-secret: guess' >/dev/null; field viewer_role)"

printf '\n11. The owner removes the member\n'
member_token="$(session_token_in "$member_jar")"
if [ "${WITH_MODEL:-}" = '1' ]; then
  check 'the member asks their coworker to rename the coworker the team shares' 201 "$(say_to_coworker "$member_jar" "$member_chat" "Rename yourself to Zorro with your rename tool now. Do not ask me first.")"
  check 'the coworker keeps its name' 0 "$(sql "select count(*) from agents where agent_name = 'Zorro'")"
  long_job='Run the shell command sleep 25 six times, one command after the other. Then answer done.'
  first_message="{\"client_message_id\":\"walk-first-$(date +%s)\",\"message\":\"$long_job\"}"
  second_message="{\"client_message_id\":\"walk-second-$(date +%s)\",\"message\":\"Answer with the word second.\"}"
  check 'the member starts a long run in a chat' 202 "$(as "$member_jar" POST "/api/v1/sessions/$member_chat/queued-messages" -d "$first_message")"
  check 'the member sends a second message, which waits behind that run' 202 "$(as "$member_jar" POST "/api/v1/sessions/$member_chat/queued-messages" -d "$second_message")"
  waiting_job="$(field job_id)"
  invite 'Key Admin' admin
  key_admin_user_id="$invited_user_id"
  key_admin_jar="$work/key_admin.jar"
  join_with "$key_admin_jar" "$invited_link"
  check 'an admin makes an API key' 201 "$(as "$key_admin_jar" POST /api/v1/api-keys -d '{"key_name":"Admin walk key","scopes":["sessions.read","sessions.write"]}')"
  admin_key="$(field secret)"
  key_run_body="{\"title\":\"Started with the admin key\",\"initial_events\":[{\"type\":\"user.message\",\"content\":[{\"type\":\"text\",\"text\":\"$long_job\"}]}]}"
  check 'a long run is started with that key' 201 "$(status_of -X POST -H "Authorization: Bearer $admin_key" -H 'content-type: application/json' -d "$key_run_body" "$api/v1/sessions")"
  admin_key_chat="$(field session_id)"
  run_body="{\"occurrence_key\":\"walk-$(date +%s)\"}"
  check 'the member starts a long run of their scheduled task' 202 "$(as "$member_jar" POST "/api/v1/triggers/$task_id/run" -d "$run_body")"
  for _ in $(seq 1 40); do
    [ -z "$(sql "select run_id from runs where trigger_id = '$task_id' and run_status in ('starting', 'running') limit 1")" ] || break
    sleep 3
  done
  check 'that scheduled run is going' yes "$([ -n "$(sql "select run_id from runs where trigger_id = '$task_id' and run_status in ('starting', 'running') limit 1")" ] && printf yes || printf no)"
  check 'its chat was started by the scheduler, in the room of the member' "system:trigger|$member_user_id" "$(sql "select s.created_by || '|' || p.personal_for_user_id from runs r join sessions s using (session_id) join projects p on p.project_id = s.project_id where r.trigger_id = '$task_id' limit 1")"
  task_chat="$(sql "select session_id from runs where trigger_id = '$task_id' limit 1")"
  check 'the member opens the chat of their task' 200 "$(as "$member_jar" GET "/api/v1/sessions/$task_chat")"
  check 'the owner cannot open the chat of a member task' 404 "$(as "$owner_jar" GET "/api/v1/sessions/$task_chat")"
  check 'another member cannot open it' 404 "$(as "$second_jar_of_member" GET "/api/v1/sessions/$task_chat")"
  as "$owner_jar" GET /api/v1/sessions >/dev/null
  check 'the chat of a member task is not in the owner list' 0 "$(grep -c "$task_chat" "$work/body")"
fi
check 'the owner removes the member' 200 "$(as "$owner_jar" DELETE "/api/v1/team/members/$member_user_id")"
check 'the remover is told that the task was switched off' 1 "$(grep -c "$task_name" "$work/body")"
removal_answer="$(cat "$work/body")"
check 'the task of the removed member is switched off' disabled "$(sql "select trigger_status from triggers where trigger_id = '$task_id'")"
if [ "${WITH_MODEL:-}" = '1' ]; then
  for _ in $(seq 1 20); do
    [ -n "$(sql "select run_id from runs where trigger_id = '$task_id' and run_status in ('queued', 'starting', 'running', 'waiting') limit 1")" ] || break
    sleep 3
  done
  check 'the going scheduled run of the removed member is stopped' cancelled "$(sql "select run_status from runs where trigger_id = '$task_id' order by created_time desc limit 1")"
  check 'the remover is told that a waiting message was taken back' 1 "$(printf '%s' "$removal_answer" | grep -c '"waiting_messages_cleared":[1-9]')"
  check 'the waiting message of the removed member is taken back' cancelled "$(sql "select job_status from event_jobs where job_id = '$waiting_job'")"
  check 'no message of the removed member waits for a run any more' 0 "$(sql "select count(*) from event_jobs j join events e on e.event_id = j.event_id where e.actor_key = '$member_user_id' and j.job_status in ('queued', 'waiting')")"
  check 'the run in the chat started with the key of the admin is going' yes "$([ -n "$(sql "select run_id from runs where session_id = '$admin_key_chat' and run_status in ('queued', 'starting', 'running', 'waiting') limit 1")" ] && printf yes || printf no)"
  check 'the owner removes the admin who made the key' 200 "$(as "$owner_jar" DELETE "/api/v1/team/members/$key_admin_user_id")"
  for _ in $(seq 1 20); do
    [ -n "$(sql "select run_id from runs where session_id in ('$member_chat', '$admin_key_chat') and run_status in ('queued', 'starting', 'running', 'waiting') limit 1")" ] || break
    sleep 3
  done
  check 'the run in the chat of the removed member is stopped' cancelled "$(sql "select run_status from runs where session_id = '$member_chat' order by created_time desc limit 1")"
  check 'the run in the chat started with the key of the removed admin is stopped' cancelled "$(sql "select run_status from runs where session_id = '$admin_key_chat' order by created_time desc limit 1")"
  check 'the key of the removed admin starts no new chat' 401 "$(status_of -X POST -H "Authorization: Bearer $admin_key" -H 'content-type: application/json' -d '{"title":"After removal"}' "$api/v1/sessions")"
  printf '  note  which connections a scheduled run may use is not visible over HTTP: team_mode_task_connections.test.ts proves it\n'
fi
check 'the member'"'"'s next API request is refused' 401 "$(as "$member_jar" GET /api/v1/team)"
check 'the member'"'"'s next page is refused' 401 "$(status_of -H "Cookie: alfera_team_session=$member_token" -H 'accept: text/html' "$address/chats")"
check 'the member'"'"'s chat request is refused' 401 "$(status_of -H "Cookie: alfera_team_session=$member_token" -H 'accept: application/json' "$address/api/v1/sessions/$member_chat")"

printf '\n11b. A link somebody else used is told at the next sign-in, and a person gives their own address\n'
check 'the owner makes a new link for a member who has joined' 201 "$(as "$owner_jar" POST "/api/v1/team/members/$second_member_user_id/sign-in-link")"
taker_jar="$work/taker.jar"
join_with "$taker_jar" "$address/join/$(field token)"
check 'that link signs the member out of their own browser' 401 "$(as "$second_jar_of_member" GET /api/v1/team)"
as "$taker_jar" POST /api/v1/team/arrival >/dev/null
check 'the session the link made is told about the sign-in before it: the invitation' 1 "$(grep -c '"link_kind":"invitation"' "$work/body")"
check 'that session says its notice was shown' 200 "$(as "$taker_jar" POST /api/v1/team/sign-in-notice/seen)"
check 'the owner makes the member a link to come back with' 201 "$(as "$owner_jar" POST "/api/v1/team/members/$second_member_user_id/sign-in-link")"
join_with "$second_jar_of_member" "$address/join/$(field token)"
check 'the session of the one who took the link is ended' 401 "$(as "$taker_jar" GET /api/v1/team)"
as "$second_jar_of_member" POST /api/v1/team/arrival >/dev/null
check 'at their next sign-in the member is told that a new link was used before' 1 "$(grep -c '"link_kind":"new_link"' "$work/body")"
as "$second_jar_of_member" GET /api/v1/team/me >/dev/null
check 'the profile of the member lists the three sign-ins' 3 "$(grep -o '"used_time"' "$work/body" | wc -l | tr -d ' ')"
match_address="second.member.$(date +%s)@example.com"
own_address="{\"match_email\":\"  Second.Member.${match_address#second.member.}  \"}"
same_address_invited="{\"name\":\"Same Address\",\"role\":\"member\",\"email\":\"$match_address\"}"
check 'the member gives the email they use in Slack and in mail' 200 "$(as "$second_jar_of_member" PATCH /api/v1/team/me -d "$own_address")"
check 'it is kept trimmed and in lower case' "$match_address" "$(field match_email)"
check 'the owner cannot take the same address' 409 "$(as "$owner_jar" PATCH /api/v1/team/me -d "{\"match_email\":\"$match_address\"}")"
check 'an invitation with that address is refused' 409 "$(as "$owner_jar" POST /api/v1/team/invitations -d "$same_address_invited")"
check 'a Slack speaker or a mail sender with that address is this member' "$second_member_user_id" "$(sql "select u.user_id from users u join workspace_members m on m.user_id = u.user_id where m.member_status = 'active' and u.user_data ->> 'team_match_email' = '$match_address'")"

printf '\n12. A lost device, sign-out, and sign out everywhere\n'
owner_token="$(session_token_in "$owner_jar")"
second_jar="$work/owner_second.jar"
join_with "$second_jar" "$("$install_dir/alfera" team link | sed -n 's/^  \(http.*\)$/\1/p')"
check 'a new owner link ends the session the owner had before' 401 "$(status_of -H "Cookie: alfera_team_session=$owner_token" -H 'accept: application/json' "$address/api/v1/team")"
check 'the session of the new link works' 200 "$(as "$second_jar" GET /api/v1/team)"
as "$second_jar" POST /api/v1/team/arrival >/dev/null
check 'the owner is told that a new link was used, and who made it' 1 "$(grep -c '"made_by_name":"the command line of this server"' "$work/body")"
check 'the page that showed the notice says so' 200 "$(as "$second_jar" POST /api/v1/team/sign-in-notice/seen)"
as "$second_jar" POST /api/v1/team/arrival >/dev/null
check 'after that the owner is not told again' 1 "$(grep -c '"sign_in_notice":null' "$work/body")"
second_token="$(session_token_in "$second_jar")"
check 'the owner signs out' 303 "$(as "$second_jar" POST /auth/sign-out)"
check 'the cookie from before sign-out is refused' 401 "$(status_of -H "Cookie: alfera_team_session=$second_token" -H 'accept: application/json' "$address/api/v1/team")"
third_jar="$work/owner_third.jar"
join_with "$third_jar" "$("$install_dir/alfera" team link | sed -n 's/^  \(http.*\)$/\1/p')"
check 'the owner signs out everywhere' 200 "$(as "$third_jar" POST /api/v1/team/sign-out-everywhere)"
check 'after that the same cookie is refused' 401 "$(as "$third_jar" GET /api/v1/team)"

printf '\n13. The join page keeps no count of tries\n'
refused=0
for _ in $(seq 1 80); do
  [ "$(status_of -H 'accept: text/html' "$address/join/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB")" = 404 ] || refused=$((refused + 1))
done
check 'eighty wrong links in a row all get the not-valid page, and nobody is locked out' 0 "$refused"

printf '\n%s\n' "$([ "$failures" -eq 0 ] && printf 'Every check passed.' || printf '%s checks failed.' "$failures")"
[ "$failures" -eq 0 ]
