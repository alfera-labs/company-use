# Self-hosting

## One-click deploy

[Deploy on DigitalOcean](https://app.alfera.ai/deploy?cloud=digitalocean) or
[Deploy on AWS](https://app.alfera.ai/deploy?cloud=aws).

You get your own Alfera on a server in your own cloud account, with no terminal.

1. Pick a cloud: DigitalOcean or AWS. You can also type a name for the address of your server.
2. Let the page make the server. On DigitalOcean you press Authorize. On AWS you sign in and
   press Create stack.
3. Wait about 2 minutes on AWS, or up to 10 minutes on DigitalOcean. The server installs
   Alfera and gets an https address, such as
   `https://acme-203-0-113-7.sslip.io`. The page shows each step. You can close the tab and
   come back.
4. The page opens the setup page of your server. There you connect your AI, make your account
   with an email and a password, and save your recovery code.

**What it costs.** On DigitalOcean, about $24 a month for the server, and about $4.80 more for
weekly backups if you tick the box. On AWS, about $34 a month in us-east-1 and up to $41 in
other regions: the server, its 30 GB disk and its public address. The AWS server can use more
processor time than its base share when it needs it. AWS bills that extra time only when its
average use over a day is above 20%. Your cloud bills you directly. Alfera bills you nothing for
the server. Your AI provider bills you for what the AI uses.

**What the page sees.** While your server installs, it sends the page only its progress and
its address. The page deletes them after 7 days. The page never sees your AI key, your
password, or your data. The setup link goes from your browser to your cloud, never to Alfera.
On DigitalOcean, the sign-in passes through the Alfera API once and is not kept, and the page
gives the permission back as soon as the server exists. On AWS, the page gets no access to
your account: you make the server yourself in the AWS console.

**Two ways in.** Open [app.alfera.ai/deploy](https://app.alfera.ai/deploy), or open `/deploy`
on any Alfera, your own included. Both show the same page. The page on your
own Alfera reports progress to your own API, so Alfera Cloud is not involved. To switch it on,
serve your Alfera on https, set these values in the `.env` of your install, and run
`./alfera restart`:

| Value | What it is |
| --- | --- |
| `COMPANY_USE_DEPLOY_PAGE_ORIGINS` | The origin of your Alfera, such as `https://acme-203-0-113-7.sslip.io`. The API answers the page only from these origins. |
| `COMPANY_USE_DIGITALOCEAN_CLIENT_ID` | The client id of a DigitalOcean OAuth app whose callback URL is `<your origin>/deploy`. Empty turns DigitalOcean off. |
| `COMPANY_USE_AWS_TEMPLATE_URL` | The https address of a copy of `deploy/aws/alfera-ec2.yaml` in an S3 bucket. Empty turns AWS off. |
| `COMPANY_USE_VERSION` | The release the new server installs: a tag of this repository. Empty means `main`. |

[Start a new cloud server with no terminal](#start-a-new-cloud-server-with-no-terminal) tells
what the server does, step by step.

## The stack

Run the product on one machine with Docker. The stack has six containers:

| Container | What it does |
| --- | --- |
| `postgres` | The database, with pgvector. |
| `migrations` | Runs the schema migrations and seeds the tool catalog and the template library, then exits. |
| `engine` | The Rivet Engine. It carries the job queue between the API and the worker. |
| `api` | The HTTP API. It writes jobs and never runs one. |
| `worker` | The queue worker. It runs every job: agent runs and automations. |
| `app` | The dashboard. |

Each agent session also gets one more container: its sandbox. See
[The sandbox and storage on your machine](#the-sandbox-and-storage-on-your-machine).
A seventh container, `caddy`, serves the install over https when you turn that on. See
[HTTPS](#https).

It runs on a laptop for one person, or on a server that stays on for a team. For the second,
go to [Install on a server](#install-on-a-server).

## Install with one command

```bash
curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash
```

The installer checks Docker and asks one question: how Alfera gets its AI model. Type `1` to
paste an API key from Anthropic, OpenAI or Vercel AI Gateway, or `2` to use a model you host.
Then it writes a `.env` with freshly generated secrets, starts the stack, and waits until the API and the dashboard answer. Then it prints
your sign-in link and opens it in your browser. Select the button on that page and you are
in, as the owner. On a machine with no browser, copy the printed link. That link lasts ten
minutes. Until you use it, it is in the terminal, in the browser's history and in the
process list, so install on a machine nobody else is signed in to.

Only this machine can open the dashboard at first. To invite your team, see
[Sign-in and your team](#sign-in-and-your-team).

It pulls the published images for `PRODUCT_VERSION` into `./alfera-selfhost`. When that
version has no published image, it clones the repository into `./alfera-selfhost/source` and
builds the images there.

From a clone, run the same script. It builds the two images from your source, one after the
other, and keeps its `.env` in `deploy/`:

```bash
git clone https://github.com/alfera-labs/company-use.git
cd company-use
./deploy/install.sh
```

Set the model key as an environment variable to run it with no question:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash'
```

For a model you host, set its address and its name in place of a key (see
[Use a model you host](#use-a-model-you-host)):

```bash
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1 OPENAI_COMPATIBLE_MODEL=qwen3:14b \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash'
```

Other knobs: `INSTALL_DIR`, `PRODUCT_VERSION`, `APP_PORT`, `API_PORT`, `BUILD_FROM_SOURCE=1`
(build even when an image is published), `COWORKER_SANDBOX_NETWORK` (the name of the sandbox
network; a second install on one machine needs its own), and `PRODUCT_REPOSITORY` plus
`PRODUCT_RAW_BASE`, which a fork sets to its own clone URL and raw file URL.
`PRODUCT_SOURCE_ARCHIVE` is the address of a `.tar.gz` of the source: the installer downloads
and unpacks it in place of a clone, so it needs no `git`. An install made that way has no
clone for `./alfera update` to pull.

You can run it again at any time. A run that stopped halfway is finished by the next run,
with the `.env` the first one wrote. On an install that is up, a second run changes nothing
and says so. On one that is stopped, it starts the stack again.

## Install on a server

This is the way to an Alfera that stays on and that your team opens from anywhere, over https.
On a Mac, the Alfera app does all of it for you: it makes the server in your DigitalOcean
account after you press "Authorize", then runs these steps on it (see `desktop/README.md`).

1. **Get a server.** A plain Linux server with Ubuntu 24.04, 2 CPU cores, 4 GB of memory and
   40 GB of disk, with an Intel, AMD or Arm processor. See
   [The smallest server](#the-smallest-server). It must be a server you sign in to as root
   and that runs Docker itself: a platform that only runs your containers has no Docker socket
   to give, and the sandbox needs one.
2. **Open three ports** if the provider has a firewall in front of the server: 22 for you,
   and 80 and 443 for everyone. Open no other port.
3. **Sign in to the server as root and run the installer:**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh -o install.sh
   bash install.sh --install-docker --https
   ```

   `--install-docker` gets Docker with the official script when the server has none. `--https`
   turns https on with a name made from the server's public address, such as
   `203-0-113-7.sslip.io`. That name is for trying it out. For real use, take a domain of
   your own: first point it at the server (one `A` record), then give it:
   `--https=alfera.example.com`. See [HTTPS](#https) for why. The installer asks for one model
   key, builds the two images, starts the stack, and waits for the certificate.
4. **Open the sign-in link** it prints. It is at the https address, it works once, and it
   lasts ten minutes. `./alfera team link` makes a new one.
5. **Invite your team** in Settings -> Team. Each person gets a link from you.

The install is in `alfera-selfhost/source/deploy` under the folder you ran the installer in.
The helper `./alfera` is there. After a restart of the server the stack starts again by
itself.

### The smallest server

2 CPU cores, 4 GB of memory and 40 GB of disk. That is the smallest that builds the images,
and it has little room to spare. With 8 GB the build has room, and several chats can work at
the same time.

| What | How much |
| --- | --- |
| Memory to build the images | Docker capped at 3.5 GB, with 2 cores and no swap: built, nothing killed. Capped at 3 GB: the dashboard build is killed. A server sold as 4 GB leaves Docker about 3.5 GB. |
| Memory with the stack up and no chat running | about 1 GB |
| Memory for a sandbox | one per running chat, each held to 2 GB and 2 cores. Idle, it uses little. |
| Disk after the install | about 16 GB: 3.7 GB of images (1.6 GB of it is the sandbox image, `node:24-bookworm`) and 12 GB of build cache |
| Time to install | 4 to 18 minutes on these machines, most of it the two image builds. A slow or busy processor is at the long end. |

The installer stops before the build, with the reason `not_enough_memory`, when Docker has
less than 3.4 GB of memory, swap included. `docker builder prune` gives the build cache back;
the next `./alfera update` then builds from the start.

These numbers come from Ubuntu 24.04 machines on a Mac, not from rented servers: an arm64
machine, an emulated amd64 machine, and arm64 with Docker capped at each size. We have not yet
installed on a rented server of 4 GB.

## HTTPS

Off by default: an install on your own machine stays on plain http on `localhost`. Turn it on
with `--https` when you install, or later:

```bash
./alfera add https                      # a name made from this machine's public address
./alfera add https alfera.example.com   # a domain of yours that points at this machine
```

Then one more container runs, `caddy`. It listens on ports 80 and 443, gets a certificate
for the name from Let's Encrypt, renews it, and passes requests on: `/v1` and `/health` to the
API, everything else to the dashboard. So the dashboard and the API share one name and one
certificate. The dashboard port and the API port stay on this machine, so nobody reaches
them around Caddy. The session cookie becomes `__Host-alfera_team_session`: `Secure`, and
kept by the browser to that one host. Sign-in links are made at the https address.

`add https` builds the dashboard image again when the install was built from source, because
the browser bundle holds the API address. That takes a few minutes.

**What it needs.** Ports 80 and 443 open from the internet to this machine, and a name that
points at it. The certificate authority connects to port 80 or 443 to check that.

**With no domain: a name for trying it out.** The name is made from the public address:
`203.0.113.7` becomes `203-0-113-7.sslip.io`. A public name service, sslip.io, answers every
such name with the address inside it. You need no account there and set nothing up.

The name is not yours. Two others can get a certificate for it, and with a certificate they
can stand in for your install: whoever runs that name service, and whoever is given the
address of your server after you delete the server. What the install does about the names of
other people on the same service: the session cookie is held to your one host name, and a
write from another site is refused, so a neighbour name cannot read or use a session. So use
the automatic name to try Alfera. For real use, point a domain of your own at the server and
run `./alfera add https your.name`. The installer says the same in one line when it ends, and
`"name_kind":"shared"` in its last progress line says it to a program.

With sign-in through WorkOS the installer and the helper refuse a shared name and ask for a
domain (`own_domain_needed`). That session cookie is not held to one host name.

Three more things to know:

- The machine must have its public address on its own network interface. On a server behind
  the provider's address translation it does not, and the installer stops and says so. Give
  the name yourself then: `--https=203-0-113-7.sslip.io`, with the public address in it.
- Everyone who uses sslip.io shares the limit the certificate authority sets for one domain.
  Let's Encrypt gives out 50 certificates a week for a domain by default, and sslip.io says it
  has a much higher limit. If the limit is reached, no certificate comes. A domain of your
  own has its own limit and is the lasting answer.
- A browser that has opened the https address once comes back over https only, for a year
  (`Strict-Transport-Security`). The plain local install sends no such header.

**A name that is mistyped gets no sign-in link.** `./alfera team link` makes a link only when
the install answers at its https name with a certificate. Until then it stops with
`certificate_not_issued`: a link at a wrong name would send you, and the secret in the link,
to somebody else's server. On an https install, `./alfera add team` with a plain address is
refused (`served_over_https`): the install is open already, and the plain port stays on this
machine.

**When no certificate comes.** The installer waits three minutes, then stops with the reason
`certificate_not_issued`. The stack is up and keeps asking: Caddy tries again by itself, with
longer and longer waits, for up to 30 days. Until then nobody can open the https address, and
the dashboard answers only on the machine itself. `./alfera logs caddy` shows what the
certificate authority said. Run the installer again once the cause is gone: it finishes. Or
change the name: `./alfera add https alfera.example.com`.

**Settings.** `COMPOSE_PROFILES=https` in `.env` starts the container, and `ALFERA_PUBLIC_HOST`
is the name. `CADDY_GLOBAL_OPTIONS` is one line of Caddy global options, empty as a rule:

- `email you@example.com` lets Caddy also ask a second certificate authority, ZeroSSL, when
  the first refuses. Caddy sends that address to both.
- `local_certs` makes Caddy sign the certificate itself, for a name no authority can reach,
  such as one inside your own network. Browsers then warn.

**Your own proxy instead.** Leave this off and see "Behind a reverse proxy with https" under
[Sign-in and your team](#sign-in-and-your-team).

## Install from a program

A setup app, a server's first-boot script or a test runs the installer with no person:

```bash
curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh -o install.sh
printf 'ANTHROPIC_API_KEY=%s\n' "$key" |
  INSTALL_DIR=/opt/alfera bash install.sh --unattended --progress --answers-stdin --install-docker --https
```

| Argument | What it does |
| --- | --- |
| `--unattended` | Asks nothing and opens no terminal. A missing answer stops the install with a reason. It prints no sign-in link, because its output goes to a log. |
| `--answers-stdin` | Reads `NAME=value` lines from stdin, so a key is on no command line and in no process list. The names: the model keys, `MODEL_KEY`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`. The script must be a file for this, not a pipe. The same names in the environment work too. |
| `--progress` | Stdout holds one JSON line per step and nothing else. Everything a person would read, and what Docker prints, goes to stderr. |
| `--install-docker` | On Linux, installs Docker with the official script when it is missing. |
| `--https[=name]` | Turns https on. See [HTTPS](#https). |
| `--first-boot` | For a new cloud server with no person at it. Runs as root. Adds 2 GB of swap, turns SSH password sign-in off, signs in to the image registry when `ALFERA_REGISTRY_USER` and `ALFERA_REGISTRY_TOKEN` are set, waits until the public address stays the same for a minute, pulls the images of `ALFERA_VERSION` and never builds them, and pulls the sandbox image. It needs no model key: the setup page of the server asks for it. It also means `--unattended` and `--https`. See [Start a new cloud server with no terminal](#start-a-new-cloud-server-with-no-terminal). |

`MODEL_KEY` is for a caller that has a key and has not worked out whose it is. The installer
puts it under the name of its provider by the way it starts:

| The key starts with | It goes to |
| --- | --- |
| `sk-ant-` | `ANTHROPIC_API_KEY` |
| `vck_` | `VERCEL_AI_GATEWAY_API_KEY` |
| `sk-or-` | `OPENROUTER_API_KEY` |
| `AIza` | `GEMINI_API_KEY` |
| `sk-proj-`, `sk-svcacct-` | `OPENAI_API_KEY` |
| `sk-` and nothing above | `OPENAI_API_KEY`, only when OpenAI accepts the key |

The installer does not use a key that starts in another way, or with `sk-ant-oat` (a Claude
subscription token) or `sk-admin-` (an OpenAI admin key). It does not guess. Enter that key
on the setup page or with `./alfera add model`.

**A connection that drops stops nothing.** An unattended install from a file does its work in
a process of its own, apart from the connection that started it, and the command you ran only
shows what that process writes. When the connection is cut, the install goes on. Run the same
command again: it starts nothing, shows the progress lines of the running install from the
first one, and ends as that install ends. You need not give the key again. An installer
that a person runs at a terminal, or one that is piped into `bash`, does its work in place;
a second run then stops with `install_running`.

**One install works on a machine at a time.** On Linux the kernel holds the lock (`flock` on
`~/.alfera-install/flock`), for as long as the working install lives. An install that is
killed, or a machine that loses power, leaves no lock behind, and no process number is
trusted. Where there is no `flock` (macOS), the lock is a folder that names its owner by
process number and start time. The progress lines and the words of the last unattended
install are in `~/.alfera-install/progress` and `log`. That folder is in the home folder of
the account, which the installer asks the account for: it does not read `HOME`, and it never
uses a folder that accounts share. It must belong to the account and be no link, or the
install stops with `state_folder_not_safe`; it is closed to other accounts (mode 0700), and
no link inside it is followed.

A progress line is one JSON object with string values:

```json
{"step":"api_image","state":"started"}
{"step":"api_image","state":"done"}
{"step":"api","state":"failed","reason":"api_did_not_answer","message":"Alfera started but did not answer in time. Try again in a minute."}
{"step":"install","state":"done","changed":"yes","address":"https://203-0-113-7.sslip.io","install_dir":"/opt/alfera/source/deploy","name_kind":"shared"}
```

`state` is `started`, `done` or `failed`. A failed line is the last line, the exit code is
then 1, and `message` is one sentence for a person with no terminal. The steps, in order:
`tools`, `docker`, `source`, `settings`, then `api_image` and `app_image` (or `images` when
published images are pulled), `start`, `api`, `dashboard`, `https` (only with https), and
`install`, which is written once, as `done`, with `changed`, `address`, `install_dir` and
`name_kind`. `changed` is `no` when the install was already up and the run changed nothing.
`name_kind` is `own` for a domain, `shared` for a name on the shared name service, and `none`
for an install with no https. A value never holds a control character: each one is written
as a space, so every line is JSON for a strict parser.

The reasons an install stops with:

| Reason | What happened |
| --- | --- |
| `bad_arguments` | An argument or a line on stdin the installer does not know. |
| `install_running` | Another install is at work on this machine, and it cannot be followed. Nothing was started. Try again in a minute. |
| `install_interrupted` | The install that was being followed ended without a last line: it was killed, or the machine restarted. Run it again. |
| `state_folder_not_safe` | The account has no home folder, or `~/.alfera-install` is a link or belongs to another account. Nothing was written. |
| `own_domain_needed` | Sign-in through WorkOS was asked for together with a name on the shared name service. Give a domain. |
| `unsupported_machine` | The processor is not x86_64 or arm64. |
| `not_enough_memory` | Docker has less than 3.4 GB of memory, swap included, and the images must be built. |
| `curl_missing`, `openssl_missing`, `git_missing`, `tar_missing` | A tool the installer needs is not on the machine. |
| `docker_not_installed` | Docker is missing and `--install-docker` was not given. |
| `docker_not_running` | Docker is installed and does not answer. |
| `docker_not_reachable` | Docker runs, and this account may not use it. |
| `docker_install_failed` | The official Docker script stopped. |
| `docker_compose_missing` | Docker has no Compose plugin. |
| `docker_socket_unreadable` | The group of the Docker socket could not be read. |
| `source_download_failed` | The source or an install file could not be downloaded. |
| `model_key_missing` | No model key was given. |
| `model_key_refused` | The provider refused the key. |
| `own_model_name_missing` | A model you host has an address but no model name. |
| `own_model_not_answering` | The model you host did not answer at its address, or it does not take tools. |
| `setting_has_line_break` | A value holds a line break. |
| `database_from_earlier_install` | A database volume of an earlier install is there, and its `.env` is not. |
| `https_name_not_usable` | The name for https is not a host name, or none could be made because the machine has no public address of its own. |
| `installed_with_other_address` | The install is up with another address than the one asked for. |
| `image_build_failed` | An image did not build. Too little memory or disk is the usual cause. |
| `image_pull_failed` | The published images did not download. |
| `port_in_use` | Another program holds a port the stack publishes. |
| `no_free_address_range` | Docker has no address range left for the network of the stack. |
| `stack_start_failed` | `docker compose up` failed for another reason. |
| `api_did_not_answer`, `dashboard_did_not_answer` | The service did not answer within three minutes. |
| `certificate_not_issued` | No certificate came within three minutes. See [HTTPS](#https). |
| `sign_in_link_not_made` | The stack runs, and the API made no sign-in link. |
| `version_not_published` | `--first-boot` found no published image of the version, and it never builds one. |
| `registry_login_failed` | The image registry refused `ALFERA_REGISTRY_USER` and `ALFERA_REGISTRY_TOKEN`. |
| `public_address_not_stable` | `--first-boot` found no final public address within ten minutes, or `ALFERA_PUBLIC_ADDRESS` is not an IPv4 address. |
| `ssh_password_login_not_closed` | `--first-boot` wrote its SSH setting, and sshd still takes passwords. |
| `setup_token_not_usable` | `ALFERA_SETUP_TOKEN_SHA256` is not 64 small hex characters, or a first boot got no setup token. |
| `unexpected` | A command failed that the installer has no reason for. Stderr holds what it printed. |
| `unlisted` | A stop that has no reason of its own yet. `message` then holds the words for a terminal. |

Three commands of the helper take `--progress` in the same way:

```bash
./alfera team link 10 --progress
# {"step":"sign_in_link","state":"done","link":"https://.../join/...","minutes":"10"}
./alfera add https alfera.example.com --progress
# steps: settings, restart, dashboard, https, then add_https with "address" and "name_kind"
./alfera add team http://192.168.1.20:3000 --progress
# steps: settings, restart, dashboard, then add_team with "address"
```

`team link` is the only one that puts a sign-in link on stdout, and it writes it nowhere
else. With `--progress`, `add team` and `add https` print no link. Their reasons:
`not_installed`, `sign_in_through_workos`, `address_missing`, `bad_address`,
`public_address_unknown`, `own_domain_needed`, `served_over_https`, `bad_minutes`,
`setting_has_line_break`, `dashboard_did_not_answer`,
`certificate_not_issued`, `sign_in_link_not_made`, `address_does_not_lead_here`, `unexpected`.
`./alfera update` and `./alfera backup` stop with these: `backup_failed` (the database could
not be saved, and nothing changed), `version_not_published` (the images of that version did not
download, and nothing changed), `update_rolled_back` (the new version did not start, and the
install is back on the version before with the database it had), `update_failed` (going back
did not work either; the backup file is named). `secret-files` stops with
`setup_token_not_usable` for a setup token hash that is not 64 small hex characters.
`add team` stops with `bad_address` for an address that only this machine can use, such as
`http://localhost:3000`, as it does for one that is not `http://` or `https://`. `add team` and
`team link` stop with `address_does_not_lead_here` when the address is on your private network
and does not answer as this install: no link is made at an address that leads nowhere.

## Start a new cloud server with no terminal

`deploy/first_boot.sh` is the first-boot script of a new DigitalOcean Droplet (user data), Amazon
EC2 server (user data) or Amazon Lightsail server (launch script). Every cloud runs the same
script, as root, once. The
deploy page writes the values below at the top of the script, after its first
line, and gives the result to the cloud:

| Value | What it is |
| --- | --- |
| `ALFERA_INSTALL_ID` | The id of this install. |
| `ALFERA_SETUP_TOKEN` | The one-time token that opens the setup page. The server keeps only its sha256. |
| `ALFERA_REPORT_TOKEN` | The token sent with each progress report. |
| `ALFERA_REPORT_URL` | Where the progress reports go. |
| `ALFERA_NAME` | The first part of the address: 0 to 20 small letters and digits. |
| `ALFERA_VERSION` | The release to install. It names the tag of the install files and of the images. |
| `ALFERA_REGISTRY_USER`, `ALFERA_REGISTRY_TOKEN` | Optional. A read-only sign-in to the image registry, when the images are not public. |
| `ALFERA_SOURCE_ARCHIVE_URL` | Optional. The address of a `.tar.gz` of your own copy of the source. The install then builds the images from it. |
| `ALFERA_INSTALL_FILES_URL` | Optional. The address of the `deploy/` folder of your own copy. The install files come from it in place of the public repository. The images still come from the registry. |
| `ALFERA_PUBLIC_ADDRESS` | Optional. The public IPv4 address that the cloud template reserved for the server before it started. The EC2 template sets it. |

The script keeps sha256 of the setup token, gets `install.sh` of `ALFERA_VERSION` (or from the
archive), and runs it with `--unattended --progress --first-boot --install-docker --https`.
The address is `https://<ALFERA_NAME>-<public address with dashes>.sslip.io`, for example
`https://acme-203-0-113-7.sslip.io`, or without the first part when `ALFERA_NAME` is empty.
The installer finds the public address on the network card, or else from the cloud's
metadata service, and waits until two reads five seconds apart agree. An address that only the
cloud's metadata service names is final once the server has run for two minutes: a Lightsail
static address comes about a minute after the server starts, so the certificate waits for it.
When `ALFERA_PUBLIC_ADDRESS` is set, the address is final as soon as the metadata service shows
it. A value that is not an IPv4 address, or an address that the metadata service does not show
within ten minutes, stops the install with `public_address_not_stable`.

On a server image baked for `ALFERA_VERSION` (see [On Amazon EC2](#on-amazon-ec2)), the script
runs the installer of the image. It downloads nothing and does not wait for the package manager.
The installer finds the install files and every image on the disk, so it pulls nothing. The
steps and their ids are the same; the steps with nothing to do end at once.

Each progress line goes to `ALFERA_REPORT_URL` as a `POST` with `Authorization: Bearer
<ALFERA_REPORT_TOKEN>` and this body. A report that does not arrive never stops the install.

```json
{"install_id":"...","step":"start","state":"done","reason":null,"address":null,"at":"2026-10-13T12:00:00Z"}
```

`step` and `reason` are the ids of [Install from a program](#install-from-a-program). A first
boot adds three steps: `machine` (swap, SSH, registry), `address` (the stable public address)
and `sandbox_image`. That step starts the download of the sandbox image once Alfera answers.
The install does not wait for it, and the first chat waits for it only when it is not done.
The last report is `install`, `done`, with the address. Only the status and the address are
sent: no key, no log. The words of the install are in
`/root/.alfera-install/log` and in `/var/log/cloud-init-output.log`.

The server keeps the setup token hash in `secrets/setup_token_hash` of the install folder. The
API reads it from `/run/secrets/setup_token_hash`, named by `SETUP_TOKEN_HASH_FILE`. The setup
page is `https://<address>/setup#token=<setup token>`.

### On Amazon EC2

The deploy page uses `deploy/aws/alfera-ec2.yaml`. It is a CloudFormation template: one EC2
server from a baked Alfera image, an Elastic IP, and a security group with ports 80 and 443 open.
Port 22 is closed. The Elastic IP is made before the server, and the template gives its address
to the server as `ALFERA_PUBLIC_ADDRESS`, so the server does not wait for its address. The
address stays the same when you stop and start the server. The template makes no IAM resource.
Its parameters are the same as those of the Lightsail template below. It needs the default VPC
of the region. The server is a `t3a.medium` (2 processors, 4 GB of memory) with a 30 GB gp3
disk and unlimited processor credits. Deleting the stack deletes the server, its disk and its address.

The image comes from `deploy/aws/bake_image.sh <version> <amd64|arm64> [regions]`. The script
starts an Ubuntu 24.04 server with `deploy/aws/bake_image_on_the_server.sh` as user data. That
script installs the system updates and Docker, downloads the install files of the version, pulls
every image of the stack and the sandbox image, writes the version to `baked_version` in
`/opt/alfera`, and removes the identity of the machine (SSH host keys, machine id, cloud-init
state, logs and the registry sign-in). Then the server stops, and the script makes the image
`alfera-<version>-<architecture>`, copies it to the other regions, writes each id to
`deploy/aws/server_images.txt`, and writes the template again. Set `ALFERA_INSTALL_FILES_URL`,
`ALFERA_REGISTRY_USER` and `ALFERA_REGISTRY_TOKEN` for a copy whose files or images are not
public. `RESOURCE_TAG` names the tag that goes on each thing the script makes.

A new image is private to its AWS account. Before other accounts can use the template, make
the image public in each region: `aws ec2 disable-image-block-public-access --region <region>`,
then `aws ec2 modify-image-attribute --region <region> --image-id <id> --launch-permission
"Add=[{Group=all}]"`.

### On Amazon Lightsail

`deploy/aws/alfera-lightsail.yaml` is a CloudFormation template: one Lightsail server with
4 GB of memory (`medium_3_0`, Ubuntu 24.04), a static address, and ports 80 and 443 open. Port
22 is closed. It makes no IAM resource, so the console asks for no extra consent. Its
parameters are the values above without the `ALFERA_` start, in CamelCase: `InstallId`,
`SetupToken`, `ReportToken`, `ReportUrl`, `Name`, `Version`, `RegistryUser`, `RegistryToken`,
`SourceArchiveUrl`. The `Address` output is the https address. Deleting the stack deletes the
server and its static address.

The template holds a copy of `deploy/first_boot.sh` as its user data. After you change
`first_boot.sh`, run `deploy/aws/write_template.sh` to write the copy again.
`deploy/test_first_boot.sh` fails when the two differ.

## Install by hand

```bash
git clone https://github.com/alfera-labs/company-use.git
cd company-use/deploy
cp .env.selfhost.example .env
# Fill one model key. The file ships with sign-in links on and the dashboard on this machine only.
# Generate the four local secrets in the marked block with `openssl rand -hex 32`.
# Replace POSTGRES_PASSWORD and the password inside DATABASE_URL too. The file ships them
# as `coworker`, which is public.
# Set DOCKER_GROUP_ID to the group id of the Docker socket (the command is under Troubleshooting).
# Set COWORKER_WORKSPACE_HOST_PATH and COWORKER_WORKSPACE_BASE_PATH to one absolute folder
# that exists on this machine and that uid 1000 can write.
./alfera secret-files
docker compose up -d --build
```

`./alfera secret-files` makes the `secrets` folder: the master key that locks stored keys and
connections, and two files that start empty. `--build` builds the images from the clone. Without it, compose pulls the published images
that `PRODUCT_VERSION` names. When the stack is up, `./alfera team link` prints your sign-in
link.

Every setting is read when a container starts, the address of the dashboard too, so a change
needs a restart only.

## Run it day to day

The install folder holds a helper named `alfera`. It reads the same `.env`, names settings,
and never prints a secret. `add team` and `team link` print a one-time sign-in link, because
handing over that link is what they are for.

```bash
./alfera status           # what runs, and which capabilities are set up
./alfera doctor           # checks the install and says how to fix each problem
./alfera add slack        # set up one outside service, then restart what reads it
./alfera add https        # serve it over https on port 443, with a certificate it gets itself
./alfera team link        # a fresh sign-in link for you, the owner
./alfera add team         # open the install to other machines, then invite your team
./alfera add local-mcp    # let an owner or admin add MCP servers on this machine or network
./alfera logs worker      # follow the logs of one service, or of all of them
./alfera stop             # stop it; ./alfera start brings it back
./alfera update           # get the new version and restart
```

`./alfera doctor` checks Docker, the generated secrets, each model key (it asks the provider to
list its models), a model you host (it sends it one request), the sign-in mode, the address
people are given, capabilities that are half set up, the API, the dashboard, the sandbox
network and its helper image, the migrations, and the worker. It exits with an error when
something needs a fix.

`./alfera add` knows these capabilities: `team`, `https`, `local-mcp`, `model`, `sign-in`,
`apps`, `slack`, `email`, `storage`, and `search`. Each one asks only for its own values.
`local-mcp` is one switch, described under
[An MCP server on this machine or on your own network](#an-mcp-server-on-this-machine-or-on-your-own-network):
it says what it opens and asks for a yes.

A word that is not a command stops the helper with one sentence and an error. `./alfera help`
lists the commands.

Each one first says what it is for and what you need at hand. It asks for every value before
it writes any, so `q` at a question, or Ctrl-C, changes nothing. A value that is needed and
left empty is asked for again with the reason, and the third empty answer stops the command.
On a second run, Enter keeps a value that is already set.

## Sign-in and your team

Every request needs a session. The install signs people in itself, with no outside account.
The owner of a one-click server signs in with an email and a password. The owner of an install
from a terminal signs in with one-time links. Everyone else joins with a one-time invite link.

**You, the owner, on a one-click server.** The setup page makes your account: an email, a
password, and a recovery code that it shows once. Save the code somewhere safe. To sign in,
open `<address>/sign-in` and give your email and password. "Forgot your password?" on that
page takes your recovery code and sets a new password: it ends every session you had, uses up
the code and shows you a new one. Settings -> Profile makes a new recovery code at any time.
After ten tries for one email in a minute, the page asks you to wait a minute.

**You, the owner, with an install from a terminal.** The installer prints your first link and opens it. The link works once,
for ten minutes. A session ends 30 days after it started; nothing extends it. For a new
browser or a lost device, run `./alfera team link` on the machine that runs Alfera: that link
lasts one hour, or as many minutes as you give (`./alfera team link 10`). A browser with no
session sees one page that says so, and nothing of your workspace.

**A lost device or a stolen session.** A new link for a person who is already in is the
lost-device button: when the link is used, every earlier session of that person ends. So
`./alfera team link` takes the owner's account back, and "New sign-in link" in Settings ->
Team does the same for anyone else. At their next sign-in the person is shown the sign-in
before that one: when it was, and who made the link. Each person can also end all of their
own sessions under Settings -> Profile: "Sign out everywhere".

**Open it to other machines.** At first the dashboard port is on this machine only.

```bash
./alfera add team
```

The command asks one question: the address people will open. Then it opens the dashboard port
to the network, restarts the stack, and prints a link for you at the new address. A session
belongs to one address, so you sign in again there.

A laptop changes network, and its address changes with it. Its name does not. So the answer
of Enter is the name of the machine when other machines can find it by that name, such as
`http://your-mac.local:3000`, and its address on the network it is on now, such as
`http://192.168.1.20:3000`, is the second choice. A Mac always has such a name. A Linux
machine has one while `avahi-daemon` runs; without it the address is the answer of Enter.
The address is stored as a browser writes it: in small letters, with no dot at the end of the
name.

**When the address stops working.** `./alfera doctor` asks the dashboard at the address people
are given, from this machine itself, and compares the answer with the one the dashboard gives
on this machine. It cannot ask from another machine, so a firewall between two machines stays
unseen. When the address is on your private network and does not answer as this install,
`doctor` and `status` say that it does not lead to this machine now, most often because the
machine changed network, and name the command that fixes it, such as `./alfera add team
http://your-mac.local:3000`. `./alfera team link` makes no link at such an address. For a
public address, or one behind a proxy, no answer from this machine proves nothing: some
networks give a machine no way to its own public address. `doctor` then warns, and a link
is still made.

The address must be one that other machines can use. `localhost`, `127.0.0.1`, `[::1]`,
`0.0.0.0`, `host.docker.internal` and a name that ends in `.localhost` lead back to the
machine that opens them, so the command refuses them, changes nothing, and names this
machine's address on your network to give in their place.

**Who can open it.** `./alfera status`, `./alfera doctor` and Settings -> Team say the same
thing, from the same two lines of `.env`: the address people are given
(`NEXT_PUBLIC_APP_URL`) and where the dashboard port is published (`APP_BIND`).

| The address | The port | What all three say |
| --- | --- | --- |
| One that only this machine can use | Anywhere | Only this machine can open it |
| Any other | Open to the network (`APP_BIND=0.0.0.0`) | Other machines can open it |
| Any other | On this machine (`APP_BIND=127.0.0.1`) | Other machines open it through a proxy on this machine, such as the one of `./alfera add https` |

When the port is open and the address is one that only this machine can use, `./alfera
doctor` warns: run `./alfera add team` and give the address other machines use.

**Invite a person.** Open Settings -> Team, type the person's name, choose a role, and select
"Invite a person". The page shows a link once. Send it to the person yourself: the install
sends no email. The person opens the link, selects the button on the page, and is in, with
their own private chats. They do not see your set-up steps.

**What a link is.** A link is `<address>/join/<token>`. It signs in the one person it was made
for, and it works once. An invitation lasts 48 hours. "New sign-in link" is for a person who
is already in and needs another browser or lost a device; it lasts 1 hour. The token is part
of the address, so the access log of a reverse proxy holds it: a used link is worth nothing,
and a link nobody used yet is worth an account until it runs out. The install's own error
reports replace the token with `[link]`.

**Roles.** An owner can do everything. An admin invites members and removes them, and cannot
change an owner or another admin. Only an owner makes someone an admin or an owner. A member
cannot manage people. A workspace always keeps one owner. Only an owner or an admin can
change what the whole team shares: the coworker's name, instructions, model and tools, the
set-up of the workspace, and the address the team gets mail at. That holds in the dashboard
and through the coworker: a member's coworker cannot rename the coworker or set the mail
address either.

**Whose chats.** There is one rule, and it is the same for a member, an admin and an owner.
A chat is in one room. A chat in your Personal room is yours alone: nobody else can list it,
open it or find it in search, an owner included. A chat in a shared project is open to the
people of that project, and it gets there only when a person starts it there or moves it
there. What works for you without you goes in your Personal room too: the chat of a
scheduled task you made, a chat started with an API key you made, and a mail thread you
started by writing to the coworker's address. A notification the coworker wrote in a chat is
listed only to the people who read that chat. Only the person who started a chat, an owner
or an admin can move it to another room. Three things are not private in this way. A mail
thread that a person outside the team started is open to every member. A Slack channel chat
is open to the people of that channel. And an owner or an admin can list every approval of
the workspace, the past ones included: each one shows what the tool call would do, whoever's
chat it was in.

**Slack and mail know a person by one address.** A person signs in with a link, so the
install holds no address of theirs. For the coworker to know a person in Slack or in mail,
the person enters the email they use there in Settings -> Profile ("Your email in Slack and
in mail"). An owner or an admin can also type it in the invite form. It is used for one
thing: to match a Slack speaker, or the sender of a mail that passed the sender check, to
that member. No mail is sent to it, and nobody signs in with it. One address is one person of
a workspace. A Slack message from an address no member gave gets no work done: the coworker
answers that it works with members only and says where to enter the address. Two things do
not use this address yet: a notification and an approval card that the coworker sends to a
person by Slack message or by mail go to the sign-in address, which a person with a link
does not have, so on an install with sign-in links those reach people in the dashboard only.

**Automations.** Every member of the workspace sees the list of automations: the name, the
instruction and what starts each one. See [Automations](#automations).

**Scheduled tasks.** A scheduled task is a task with a schedule and no automation around it:
the coworker makes one when you ask it for a one-time run, and an install from before the
Automations pages has them. They are listed on the Automations page. A member sees and manages
only the scheduled tasks they made, in the dashboard and through their coworker. An owner or an admin sees and manages every task: its
name, its schedule, its instruction and whether its runs worked. The chat a task runs in is
in the Personal room of the person who made the task, so nobody else reads what it found,
an owner included. A task uses only the connections that are shared with everyone: a connection
kept to named people is not used by a task, not even one kept to the person who made the
task. That stays so after the maker writes in the chat of the task. Only a run the maker
starts by writing in that chat uses the maker's own connections, as in any chat. A run that
no person started cannot make a task.

**Removing a person.** "Remove" signs the person out at once and ends their unused links. It
also ends what would go on working for them with nobody signed in. It revokes every API key
they made. It switches off every scheduled task they made or were the last to change. It
takes back their messages that still wait for a run. It stops the runs still going for them:
in their chats, in the chats started with their keys, and the runs of their tasks. A message
of a person who is out starts no run, even if it was already waiting. It disconnects the
apps they connected, unless you untick that: the page lists those apps and who else uses
each one before you confirm, and tells you afterwards what it did. A task of a person who is
out does not start work even if someone switches it on again. Their chats and files stay in
the database.

**Who you trust.** Whoever opens a link is signed in as its person, so send each link only to
that person. An admin can make a link only for a person who has not joined yet. An owner can
make a link for anyone, and so can sign in as any member. Using that link signs the member
out everywhere. The session the link made is told nothing about it. The member sees it at
their next sign-in: the app then shows when a link was last used for their account, which
kind of link it was and who made it, and Settings -> Profile lists the last ten sign-ins.
Give the owner role only to people who may see what every member sees.

**What members share.** Chats are private to the person, or shared through a project, as
"Whose chats" says above.
Connections are shared with everyone or kept to named people, as their owner chose. A new
connection starts as its maker's alone, in the dashboard and when the coworker starts one in
a chat: where an app can be connected, the connect dialog says so, and the maker shares it
there, or later under Integrations. Adding an MCP server for the team is for an owner or an
admin. A stored credential is listed, renewed and switched off only by the person who
made it, or by an owner or an admin. The
workspace folder is not private. There is one per workspace, and on the Docker sandbox the
coworker of every member reads and writes all of it:

- `files/`: what the coworker produced or downloaded.
- `skills/`: how the coworker works. A skill one member's coworker saved is used in every
  member's chats.
- `people/`, `companies/`, `websites/`, `tools/`, `events/`: the notes the coworker keeps,
  the notes about people included. "Remember this" is saved here.
- `tasks/` and `daily-logs/`: work in flight, and one page per day.
- `system/tool-output/`: tool results that were too big to show in full. Such a result can
  hold data that came through another member's connection.
- `system/activity/`: one line per tool call of every chat, one file per day.
- `system/browser/`: saved logins and browser sessions, when the coworker has any.

So one member can change what another member's coworker does, by having a skill or a note
saved or changed, and can read what the coworker saved for anyone. Invite only people you
trust with that. There are no private files per person today.

Private chats therefore do not protect you from a member you do not trust. A member can have
their coworker read what it saved in that folder for other members: saved tool output, the
activity log of every chat, notes, and browser logins the coworker saved. And code that a
member's coworker puts in the shared Python environment runs in every member's sandbox.

The Python environment the coworker makes for spreadsheets, decks, PDFs and charts is in that
folder too (`.venv`), so it is one for the whole team: a library the coworker installs there
for one member runs in every member's sandbox.

**Plain http is for a trusted network only.** Inside a home network, an office network or a
VPN, `http://` works. One thing needs https or `localhost`: the browser notification when a
chat finishes. A sign-in link and a session cross that network unencrypted, and the
session cookie has a plain name there, so another web service on the same host name (any
port) can read it. `./alfera doctor` warns when the address is plain http outside a private
network.

**Https with no proxy of your own.** `./alfera add https` puts a proxy in front that gets its
own certificate. See [HTTPS](#https).

**Behind a reverse proxy with https.** Give the https address:
`./alfera add team https://alfera.example.com`. The dashboard believes `X-Forwarded-Proto`
and `X-Forwarded-Host` from whoever connects to it, so the proxy must set both itself and
must not pass on what a client sent. Then the session cookie is `__Host-alfera_team_session`:
`Secure`, and kept by the browser to that one host. With nginx:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
```

`proxy_set_header` replaces a header of the same name from the client. Keep the dashboard
port on this machine (`APP_BIND=127.0.0.1` in `.env`) when the proxy runs on the same
machine, so nobody reaches the dashboard around the proxy.

**From another machine.** Chats, files, settings and the Team page go through the dashboard
address. One thing does not: a connection set-up link (a link that carries a set-up token)
calls the API address in `NEXT_PUBLIC_API_URL` from the browser. With the default
`http://localhost:3001` that step works only on the server itself. With [HTTPS](#https) on,
the API has the same public name as the dashboard, and the step works from any machine.

The switch is `COWORKER_AUTH_MODE=team` in `.env`. The API refuses to start when the WorkOS
keys are set beside it: an install has one kind of sign-in.

**An install from before sign-in.** An older install has `COWORKER_AUTH_MODE=local` in its
`.env`. That mode has no sign-in. Its dashboard answers only requests for `localhost`,
`127.0.0.1`, `[::1]`, or a name that ends in `.localhost`, but a request can carry any name:
it serves anyone who can reach its port, and that includes the code the coworker runs. It is
kept for development only. `./alfera doctor` reports it. Run `./alfera team link`: it turns
sign-in on, keeps your workspace and chats, makes you the owner, and prints your link.

## Models

You bring the model. The install holds no key of ours, and you pay your provider per token.

| Provider | Key |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Vercel AI Gateway | `VERCEL_AI_GATEWAY_API_KEY` |
| A model you host, or another OpenAI-compatible address | `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_MODEL` |

The installer asks for one key. Add or change a key later with `./alfera add model`, or in
`.env`.

### Use a model you host

The coworker can run on a model you host, or on any other server that speaks the OpenAI chat
completions API: Ollama, LM Studio, vLLM, the llama.cpp server, OpenRouter and the like. Then
no chat leaves your machine for a model provider, unless the address you give is on another
machine.

The installer and `./alfera add model` ask the same first question: `1` to paste an API key,
`2` to use a model you host. Type `2`. The model server must be running then, because the
questions come from what it answers:

1. **The address of the model server.** It is the address that ends in `/v1`. Press Enter for
   `http://host.docker.internal:11434/v1`, which is Ollama on this machine. Write
   `host.docker.internal` and not `localhost` for a server on this machine: the request comes
   from a container, and `localhost` in a container is the container.
2. **The model.** The helper asks the server which models it has and shows them as a numbered
   list. You type a number. You type no model name.
3. **The key of that server**, only when the server asks for one.

Then the helper sends the model one request that holds a tool and asks for one token. It goes
on only when the model answers. When something is wrong it says so in one sentence, and asks
again from the right place: no model server was found on this machine, nothing answers at
the address, the server has no model yet, the server refused the key, or the model does not
support tool calling.

At every question, `b` goes back to the first choice and `q` stops with nothing changed. A
plain Enter chooses nothing at the first question. Ctrl-C stops at any time, and leaves no
`.env` that is half written.

The same values in `.env`:

```bash
OPENAI_COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_COMPATIBLE_MODEL=qwen3:14b
OPENAI_COMPATIBLE_API_KEY=            # only when the server asks for a key
OPENAI_COMPATIBLE_CONTEXT_WINDOW=     # tokens; empty means 32768
OPENAI_COMPATIBLE_READS_IMAGES=       # true when the model reads images
```

What you must know before you choose a model:

- **The model must support tool calling.** The coworker does its work through tools. A model
  without tool calling cannot run it, and the chat says so. How well the coworker works
  depends on how well the model calls tools. A small model often calls the wrong tool, or
  none, and then the coworker answers but does not act.
- **The model needs a large context window, and the server must give it.** The coworker's
  instructions and its tools take many tokens before your first message. Alfera assumes a
  window of 32,768 tokens. Set `OPENAI_COMPATIBLE_CONTEXT_WINDOW` to the number your server
  really gives the model. Many servers give less than the model can take unless you tell them
  (Ollama: `OLLAMA_CONTEXT_LENGTH`). A server that gets a longer prompt than its window cuts
  it without a word or refuses it, and the coworker then forgets its instructions or fails.
- **On Linux, the server must listen on all addresses.** `host.docker.internal` is the Docker
  bridge there, and a server that listens on `127.0.0.1` only does not answer on it (Ollama:
  `OLLAMA_HOST=0.0.0.0`). `./alfera doctor` checks the address from the worker container and
  says when it cannot reach it. Then keep that port closed to other machines with your
  firewall.
- **One model does everything.** Chats, chat titles, summaries of long chats and the small
  yes-or-no calls all go to the model you named. A slow model makes all of them slow.
- **Text only, unless you say the model reads images.** With
  `OPENAI_COMPATIBLE_READS_IMAGES=true`, an image in a chat goes to the model. Without it, a
  message with an image gets no answer, and the chat says the model reads no images.
- **No price is shown.** Alfera knows no price for a model at your address, so a chat shows
  its tokens and no cost.
- **The model list holds one model.** The model picker shows the model you named and no
  other. To change it, run `./alfera add model` again.
- **The address wins over a key.** When the address is set, the coworker runs on it, even
  when a key of Anthropic, OpenAI or the gateway is also in `.env`. `./alfera add model` says
  so when it sees both. To go back to the key, empty `OPENAI_COMPATIBLE_BASE_URL` and run
  `./alfera restart`.
- **A voice note is not transcribed.** That needs an OpenAI key in `.env` as well. The same is
  true of an install that has only an Anthropic key.
- **Use `https` for a server on another machine.** Over plain `http`, your chats and the key
  cross the network unencrypted.

Only a person who can edit `.env` on the server can set the address. A chat, a member of the
workspace and the coworker cannot change it. The rule that keeps the coworker's own requests
away from private addresses stays as it is, and so does the sandbox.

Our tests check the request the coworker sends against the OpenAI chat completions format.
They do not run each of the servers named above. When one does not work, `./alfera doctor`
is the first thing to run.

## Single sign-on with WorkOS

[WorkOS](https://dashboard.workos.com) is the alternative to the install's own links. Use it
when you want sign-in with Google or email, or one account across several workspaces. It
needs keys from a WorkOS application, and it replaces the links: an install has one kind of
sign-in.

1. Create a WorkOS application and copy its API key and client id.
2. In `.env`, set `WORKOS_API_KEY` and `WORKOS_CLIENT_ID`, empty `COWORKER_AUTH_MODE`, and set
   `APP_BIND=0.0.0.0`.
3. In WorkOS -> Redirects, add `http://localhost:3000/auth/callback`.
4. Run `docker compose up -d` in the install folder.

`./alfera add sign-in` does steps 2 and 4 for you. A new install can also start this way: run
the installer with both values in the environment.

```bash
WORKOS_API_KEY=sk_... WORKOS_CLIENT_ID=client_... ANTHROPIC_API_KEY=sk-ant-... \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash'
```

Use your own origin in place of `http://localhost:3000` when the stack is behind a domain.
The app builds the callback address from the incoming request host, so a domain change needs
a new WorkOS redirect entry and no rebuild.

The workspace made with sign-in links belongs to the people of those links. A person who
signs in through WorkOS afterwards starts a new workspace; the first one stays in the
database.

## Connect your apps

Each way to reach outside apps is its own switch:

| What you want | What to set | Needs a public address |
| --- | --- | --- |
| An MCP server on the internet | Nothing in `.env`. Add the server's `https://` address in the dashboard, under Integrations. If the server takes an API key or a token, choose "I have an API key or token" there. | No |
| An MCP server on this machine or on your own network | `COWORKER_MCP_PRIVATE_ADDRESSES=open`, which `./alfera add local-mcp` sets. Off by default. See below. | No |
| The hosted app catalogue (actions in many apps) | `COMPOSIO_API_KEY`, from your own Composio account | No |
| Automations that start on an event in one of those apps | `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET`, and `API_PUBLIC_URL`. See [An automation that starts on an app event](#an-automation-that-starts-on-an-app-event). | Yes |
| A native connector (Notion, HubSpot, Salesforce, GitHub, Attio, Slack) | That app's own OAuth client: `CONNECTOR_<APP>_CLIENT_ID` and `CONNECTOR_<APP>_CLIENT_SECRET` | No |
| Alfera inside your Slack | A Slack app made from `deploy/slack-app-manifest.json` (first replace `YOUR-API-PUBLIC-URL` in it with your public API address), the three `SLACK_*` values, and `API_PUBLIC_URL`. See [Alfera inside your Slack](#alfera-inside-your-slack). | Yes |
| Alfera by email | `RESEND_API_KEY`, `INBOUND_EMAIL_DOMAIN`, `RESEND_INBOUND_WEBHOOK_SECRET`. See [Alfera by email](#alfera-by-email). | Yes |
| Web search in research tasks | One of `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `FIRECRAWL_API_KEY` | No |

`./alfera add apps` asks for the key and loads the catalogue. By hand, set the key in `.env`,
then load the catalogue once:

```bash
docker compose run --rm migrations bun --no-env-file scripts/sync-composio-catalog.js --confirm
```

"Needs a public address" means the other service must call your install. On a laptop that
takes a tunnel: point it at the API port only, and set `API_PUBLIC_URL` to the tunnel's
address.

### Alfera inside your Slack

You talk to your coworker in your Slack, and you choose in the dashboard the channels where
it answers. Slack calls your install, so the API needs a public `https://` address first:
[HTTPS](#https) gives it one, and so does a tunnel to the API port.

1. In `deploy/slack-app-manifest.json`, replace each `YOUR-API-PUBLIC-URL` with the host name
   of that address. Slack then sends its events to `/v1/channels/slack/events` there.
2. Create a Slack app from that manifest, in your own Slack workspace.
3. Run `./alfera add slack`. It asks for the client id, the client secret and the signing
   secret of the app, and for the public address of the API. It writes nothing until it has
   all four.
4. Reload the dashboard. `./alfera doctor` says so when Slack is half set up.

### Alfera by email

Your coworker gets its own address: you write to it, it answers, and it sends its
notifications by email. It needs a [Resend](https://resend.com) account, a domain that
receives mail there, and a public `https://` address for the API, because Resend calls your
install when a mail comes in.

1. In Resend, add the domain, and add a webhook for incoming mail that calls
   `/v1/channels/email/events` at the public address of the API. Resend shows the signing
   secret of that webhook.
2. Run `./alfera add email`. It asks for the Resend API key, the domain that receives mail,
   and that signing secret. It writes nothing until it has all three.
3. Reload the dashboard. `./alfera doctor` says so when email is half set up.

The API refuses a mail whose signature does not match the secret.

### An MCP server on this machine or on your own network

A default install refuses an MCP server at a private address, as Alfera Cloud does:
`localhost`, `192.168.1.20`, a name that ends in `.lan`. The dialog says so under the address
field. To allow them:

```bash
./alfera add local-mcp    # says what it opens, asks for a yes, then restarts
./alfera status           # the line "local-mcp" says on or off
```

The command first says what it opens and for whom: every owner and admin of this Alfera can
then add MCP servers that run on this machine or on your private network, and Alfera sends
requests to the private addresses they give. Then it asks for a yes at the terminal. A no, or
`q`, changes nothing. A yes sets `COWORKER_MCP_PRIVATE_ADDRESSES=open` and restarts what
reads it. A script has no terminal, so it gives the yes on the command line:

```bash
./alfera add local-mcp --yes
```

With no terminal and no `--yes`, the command refuses with one sentence and changes nothing.

To turn it off again, set `COWORKER_MCP_PRIVATE_ADDRESSES=closed` in `.env` and run
`./alfera restart`. A server on a private address that was added before then gets no more
requests.

With the switch on:

- **Only an owner or an admin adds such a server, and only in the dashboard**, under
  Integrations, MCP server. The coworker has a tool that adds MCP servers from a chat. That
  tool always refuses a private address, because a web page the coworker reads could ask for
  one. A member cannot add any MCP server.
- **Plain `http://` is accepted for a private address**, and only there. A server on the
  internet still needs `https://`. A private server that you give by name is reached over
  `http://` only: `https://` with a name is refused there, because the request goes to the
  address that was checked and a certificate cannot be checked for the name that way.
  `https://` with the address itself works when the certificate of the server names that
  address. No certificate check is ever turned off.
- **The address to give.** For a server on your network, its address there, such as
  `http://192.168.1.20:8000/mcp`, or a name that ends in `.lan`, `.local`, `.internal` or
  `.home.arpa` and resolves to private addresses only. For a server on this machine,
  `http://host.docker.internal:8000/mcp`. Not `localhost`: inside a container, `localhost`
  is the container itself, so the dialog refuses it and names the address to use.
- **`host.docker.internal` works on Linux too.** Docker Desktop and OrbStack know that name
  in every container. Docker Engine on Linux knows it only where `docker-compose.yml` says
  so, and the file says so for the `api` service, which checks and adds a server, and for the
  `worker` service, which calls its tools. The server must listen on an address a container
  can reach: on Linux that is `0.0.0.0` or the address of the Docker bridge, not `127.0.0.1`.
  An install made before this line was in the file needs the new `docker-compose.yml`.
- **Alfera's own services stay out of reach.** An address is refused when it is on a network
  the API or the worker container is itself on, where the database, the job engine, the API,
  the worker and the web app are, or on the sandbox network (`COWORKER_SANDBOX_NETWORK`, and
  every range that network is given when Docker has none free). The dialog then says "That
  address is one of Alfera's own services". The one exception is the address of
  `host.docker.internal`, which is this machine. The check runs when a server is added and
  again before every request, each time a tool is called. The name of a private server is
  looked up once for a request, and the request goes to the address that was checked, with
  the name in the `Host` header: a name that answers something else a moment later leads
  nowhere else. A private name that cannot be looked up gets no request. When Docker cannot
  say where the sandbox network is, or the container shows no network of its own, no private
  address gets a request.
- **What stays refused, always:** a cloud metadata address (`169.254.169.254` and the other
  link-local addresses, the range `fd00:ec2::/32`, `metadata.google.internal`), the carrier
  range `100.64.0.0/10`, a loopback address, a name with no dot, also when it is written
  with a dot at its end (those are the services of this stack, such as `postgres`), an
  address of one of Alfera's own services, and a public name that resolves to a private
  address. Give the address itself for that last one.
- **Five header names are Alfera's.** `Host`, `Content-Type`, `Accept`, `Mcp-Session-Id` and
  `MCP-Protocol-Version` cannot be given as additional request headers, for any MCP server.
  The dialog and the API refuse them, and a request never sends a stored one.
- **A server that signs people in with OAuth is not supported at a private address.** Use a
  server that needs no credential, or one that takes an API key or a token.

Read "Security notes" before you turn it on.

## Automations

An automation is an instruction with one or more ways to start. You make one on the
Automations page of the dashboard, or you ask the coworker in a chat. The pages are the same
as on Alfera Cloud.

| It starts | What it needs |
| --- | --- |
| On a schedule | Nothing else. |
| When you ask (the "Test" button on its page, a request in chat, or a call with an API key) | Nothing else. |
| When anything on the web calls it | A public `https://` address for the API. See [HTTPS](#https). |
| When something happens in an app | Your own Composio key, a public `https://` address, and a webhook subscription in your Composio project. See [An automation that starts on an app event](#an-automation-that-starts-on-an-app-event). |

An automation runs only while this machine and Docker are on.

**Filters and "Only run if".** A filter compares a field of the event with a value; no model
is asked. "Only run if" is a question in your own words about the event. The install asks its
own model provider: the model in `OPENAI_CLASSIFICATION_MODEL`, `ANTHROPIC_CLASSIFICATION_MODEL`
or `VERCEL_AI_GATEWAY_CLASSIFICATION_MODEL` when you set one, or the default of your provider
when you do not. Each event that passes the filters costs one short model call. When the model
gives no answer that can be read, the automation runs.

**Limits.** An automation that starts more than 50 times in one day pauses itself; you change
that number under Limits on its page. It also pauses itself after 3 runs in a row that change
nothing. Both times it tells its owner.

### An automation that the web calls

When you save the automation, the page shows the address and the secret of the trigger. The
secret is shown that one time: copy it then. The address stays on the page of the automation.
A program starts the automation with one request:

```bash
curl -X POST "https://alfera.example.com/v1/triggers/deliveries/webhook/<trigger id>" \
  -H "Authorization: Bearer <the secret of this trigger>" \
  -H "Content-Type: application/json" \
  -d '{"order": 1042}'
```

The body is what the automation reads. The secret belongs to that one trigger. A request with
no secret, a wrong secret, or the secret of another trigger gets `401`. The address is made
from `API_PUBLIC_URL`, which `./alfera add https` sets. Without a public address the same
request works from this machine only, at the port of the API: `http://localhost:3001` unless
you changed `API_PORT`.

### An automation that starts on an app event

The app catalogue is Composio. Composio watches the app and calls your install when the event
happens. So three things must be true: the install has your Composio key, Composio can reach
the install, and the install can check that a call really comes from your Composio project.

This path was built for Alfera Cloud. On a self-host it was never run against the real
provider: the steps below follow the code and the provider's documentation. Tell us in an
issue if a step is wrong.

1. **The key.** Run `./alfera add apps`. It asks for the API key of your own Composio account
   and loads the catalogue. Use a Composio project that only this install uses: a project has
   one webhook address, and step 3 sets it.
2. **The public address.** Run `./alfera add https`, with a domain of yours or with none. See
   [HTTPS](#https). On a laptop, a tunnel to the API port also works: set `API_PUBLIC_URL` to
   its address.
3. **The webhook subscription.** Tell your Composio project to send its events to
   `https://<your address>/v1/triggers/deliveries/composio`. The install does not do this for
   you. Composio's own SDK does it in one call, with your key, on any machine:

   ```ts
   import { Composio } from '@composio/core';

   const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
   const subscription = await composio.triggers.setWebhookSubscription({
     webhookUrl: 'https://alfera.example.com/v1/triggers/deliveries/composio',
   });
   console.log(subscription.secret);
   ```

   The call answers with the signing secret of the subscription. Composio's page "Subscribing
   to events" has the same call for Python.
4. **The secret.** Run `./alfera add triggers`. It asks for that signing secret and writes it
   to `.env` as `COMPOSIO_WEBHOOK_SECRET`. By hand: set the line in `.env`, then
   `docker compose up -d`.
5. **Connect the app, then add the trigger.** On the Automations page, add a trigger of the
   app and press Connect. When you save the automation, the install asks Composio, with your
   key, to watch that event for that one connected account.

Check that it works:

- `./alfera status` shows `apps` and `triggers` as set up. Until then the `triggers` line says
  that app events are off; automations on a schedule, on request and from the web work without it.
- With no secret set, the delivery address answers `503` and the code
  `composio_webhook_secret_missing`. With a secret set, a request with no signature gets `401`:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://alfera.example.com/v1/triggers/deliveries/composio
  ```

- Make the event happen in the app. "Run history" on the page of the automation lists each
  event with what was decided: it ran, a filter stopped it, or "Only run if" said no.

What the install checks on each delivery: the signature, made with your secret over the id,
the time and the body of the delivery; that the delivery is not older than 5 minutes; and that
the connected account in the delivery is the account of the trigger's own connection. A
delivery that no trigger of this install asked for is answered and dropped. The install reads
and changes only the event watchers it made, with your key. It never reads, changes or deletes
the webhook subscription.

### Scheduled tasks you already have

An install from before the Automations pages had a "Scheduled tasks" page. That page is gone.
The tasks are not: each one is still the same row in the database, it still runs on its
schedule, and it is listed on the Automations page beside the automations. A link to
`/scheduled-tasks` or to one task opens the Automations page or that task. The update changes
no data.

### What the coworker reads without being asked

Three parts read things that nobody sent to the coworker. Each one is listed here with when it
reads, what it reads, and how to stop it.

**The scout.** It looks for work that nobody asked for.

- When: the install makes it when a workspace finishes onboarding, and again when Slack is
  connected. It runs at most 4 times a day, Monday to Friday, at about 8, 11, 14 and 17 in the
  workspace's time zone. Each run is one run of your model.
- What it reads: Slack messages of the last 7 days in channels where the Slack app is a member
  and that did not mention it; the last message of each chat of the workspace, private chats
  included, when that message is a question the coworker asked; the files it made lately; the
  goal files; the calendar of a connected calendar app; and, once a week, how each automation
  did.
- What it may do: write a notification, and make a scheduled task from a Slack message it
  read. A message it tries to send in Slack is refused.
- How to stop it: Automations -> Notifications -> "Notify me" -> "Summary only". That writes
  `dial: off` in `notification-rules.md`, in the workspace folder, and the scout stops looking.
  There is no switch for the scout alone: "Summary only" also holds notifications back for one
  message a day.

**Discovery.** It reads how the team works in Slack and proposes work.

- When: once for a workspace, after Slack is connected: at the end of onboarding, or at the
  first Slack message to the coworker.
- What it reads: up to 90 days of messages in every channel where the Slack app is a member,
  public and private.
- What it does: it posts in one channel that it is reading, and later what it proposes. What it
  read in a private channel can be in that post.
- How to stop it: no setting stops it. It does not run on an install with no Slack. To keep a
  channel out of it, do not add the Slack app to that channel before the first message.

**Listening.** An automation can start on a Slack message or on an email that nobody sent to
the coworker.

- An automation you made with such a trigger: it reads each message of the channel you chose,
  or each email. To stop it, pause or delete the automation.
- "Listen to <app>": when a person connects an app that has one of ten common events (a new
  email, a new calendar event, a new file, a payment, a new contact, a new issue, a new page,
  a Slack message), the install makes an automation with that name and those triggers. It is
  not shown on the Automations page. It runs nothing. Each event it hears goes to one short
  model call that decides whether to tell you about it, at most 300 a day.
  It hears nothing until app events are set up as above. To stop the model calls, set
  `triage_calls_per_day: 0` in `notification-rules.md`. To stop the listening for one app,
  disconnect that app. There is no other switch.

## How a self-host works

- **Work starts when you ask, or when an automation starts it.** You ask in the dashboard or
  through the API. A Slack message or an email also starts a run once you set up that channel.
  An automation starts on a schedule, when you ask, when a program on the web calls it, or on
  an event in a connected app, such as a new row in a CRM. The last two need more setup: see
  [Automations](#automations).
- **"Remember this" is saved to a file.** The coworker is told to write the fact to a file in
  its workspace folder and to tell you the path. A later chat does not load that file by
  itself: the coworker is told to search the workspace files before it says it does not know
  something. A standing rule is saved as a skill.
- **It acts without asking first, with one exception.** The default for every tool is
  "allow". One rule is built in: an email that a tool sends to an address that is not a
  member of your workspace waits for your yes. The rule finds a tool by its name. It covers:
  - the coworker's own tool that sends a new email;
  - a tool of a connected app, when one word of the app's name is `email`, `gmail`,
    `outlook`, `mailgun`, `sendgrid` or `smtp`, and one word of the action's name is `send`,
    `reply` or `forward`. "Send email" in Gmail is one.

  The rule reads the addresses in the tool's input. When each one belongs to a member of
  your workspace, the email goes without a question.

  It does not cover:
  - a reply on the email channel. When a person writes to the coworker's address, the
    answer goes without a question to that person, and to the other people on the thread
    when a member of your workspace is one of them. The closing email of that conversation
    goes the same way;
  - a tool whose name has none of those words, such as a tool of a CRM that sends email;
  - a command in the sandbox.

  You set your own rules under Settings -> Tool permissions, and a rule of yours that
  allows a tool wins over the built-in one.

## What does not work on a self-host yet

- **A link to preview a site the coworker built.** The preview needs the hosted sandbox. The
  sandbox container on your machine publishes no port, so it serves no preview. The coworker
  writes the files and you open them in the Files panel, where an HTML file renders.
- **The live browser view.** It needs the hosted sandbox. The coworker still reads a public
  page when you give it the address.
- **Spreadsheets, decks, PDFs and chart images with no setup.** The sandbox image has Python
  and no Python library. The first time a job needs one, the coworker installs it into `.venv`
  in the workspace folder. That takes about a minute and needs the internet.
- **Company memory.** It runs on Alfera Cloud.
- **Automations while the machine is off.** An automation runs only while this machine and
  Docker are on. An app event or a call from the web that comes while the machine is off
  does not reach the install, and the install does not ask for it later.

## Use it from your own code

Create an API key in the dashboard under Settings -> API keys. Send it as a bearer token to
the API port. `GET /v1/openapi.json` describes the public API: the routes an API key may call.
The dashboard uses many more routes, and that file does not list them.

```bash
# Who the key belongs to.
curl -s http://localhost:3001/v1/me -H "Authorization: Bearer $ALFERA_API_KEY"

# Open a session and give it a task.
curl -s http://localhost:3001/v1/sessions \
  -H "Authorization: Bearer $ALFERA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"initial_events":[{"type":"user.message","content":[{"type":"text","text":"Write a short hello note and save it as hello.md"}]}]}'

# Read what happened, then list the files the session made.
curl -s http://localhost:3001/v1/sessions/$SESSION_ID/events -H "Authorization: Bearer $ALFERA_API_KEY"
curl -s http://localhost:3001/v1/sessions/$SESSION_ID/files -H "Authorization: Bearer $ALFERA_API_KEY"
```

The files call lists each file the session wrote or changed in the workspace folder, once: with
its file tools, or with a shell command it waited for (the 20 newest files of one command). It
does not list the coworker's own notes (`people/`, `companies/`, `websites/`, `tools/`,
`events/`, `tasks/`, `daily-logs/`, `skills/`, `system/`), working files in `tmp/`, hidden
files, or the pages `README.md`, `WORKSPACE.md` and `user.md` at the top of the folder.

The routes cover the key's own identity (`/v1/me`), the workspace, agents, sessions and their
events and files, projects, skills, and integrations.

The API port is published on `127.0.0.1` only. To call it from another machine, turn
[HTTPS](#https) on: the API then answers at `https://<your name>/v1/...`. Or put it behind
your own HTTPS proxy and set `API_PUBLIC_URL`.

## The sandbox and storage on your machine

The sandbox is a Docker container on your machine. You need no outside sandbox account and
no outside storage account.

The worker starts one sandbox container per agent session, through the host's Docker socket.
The container is removed shortly after each run and made again for the next one.
Every session of a workspace mounts the same workspace folder, so a file one chat saves is
there in the next chat. Each session also has its own `tmp/` scratch folder that no other
session sees. The folder is on your disk, under `COWORKER_WORKSPACE_HOST_PATH`.

The sandbox image is `node:24-bookworm`. Docker pulls it the first time a session starts, so
the first command of a new install takes longer. Docker pulls a small helper image,
`busybox:1.37`, at the same time. `./alfera doctor` pulls it too, so a machine that cannot get
it finds out before a chat fails.

**What a sandbox can reach.** The public internet, and nothing else. The coworker needs the
internet to install packages and read pages.

- Every sandbox container is on one Docker network of its own, named by
  `COWORKER_SANDBOX_NETWORK` (`alfera-sandbox`). No service of the install is on it, so a
  sandbox cannot find `postgres`, `engine`, `api`, `app` or `worker` by name.
- A separate network is not enough by itself. Some Docker platforms pass traffic from one
  network to another, and Docker Desktop and OrbStack let a container reach the ports this
  machine publishes on loopback through `host.docker.internal`. So right after a sandbox
  starts, and again each time it is started, the worker takes its private addresses away: a
  one-shot helper container (`busybox:1.37`) joins the sandbox's network and makes these ranges
  unreachable, together with the sandbox's own subnet and gateway: `0.0.0.0/8`, `10.0.0.0/8`,
  `100.64.0.0/10`, `168.63.129.16`, `169.254.0.0/16` (cloud metadata at `169.254.169.254` is
  inside it), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15` and
  `224.0.0.0/3`. No command runs in a sandbox before that has succeeded for its current start.
- After that the code the coworker runs cannot open a connection to the services of the
  install by container address, to another sandbox, to this machine (through the gateway,
  `host.docker.internal` or a private network address), or to anything else on your own
  network. The sandbox runs as a non-root user with no right to change routes, so it cannot
  undo this.
- IPv6 is off in a sandbox (`net.ipv6.conf.all.disable_ipv6=1`), so an IPv6 address or an
  IPv4-mapped one is no way around the list. A sandbox that has an IPv6 address anyway is
  removed, not used.
- Names are looked up at public resolvers, `1.1.1.1` and `9.9.9.9`, because the resolver
  Docker would pick can sit at a private address that is now closed. `COWORKER_SANDBOX_DNS`
  in `.env` names other resolvers, separated by commas; `docker` leaves the choice to Docker.
- A sandbox that cannot be closed this way is removed and not used, and the worker log says
  so. `COWORKER_SANDBOX_PRIVATE_ADDRESSES=open` in `.env` turns the closing off. Use it when
  the coworker must reach a service on your own network, or when your Docker cannot change
  routes for a container. With it, a sandbox can open a connection to the dashboard port,
  the API port and the database port again. Each of those still asks for what a sandbox does
  not hold: a session, the proxy secret or an API key, the database password.
- Tested on OrbStack on macOS, and on Docker Engine 29 on Ubuntu 24.04, on arm64 and on amd64
  (`deploy/test_install_on_linux.sh`). Those two Linux machines ran on a Mac: on the kernel of
  OrbStack, not the one Ubuntu ships, and the amd64 one was emulated. Not tested on Docker
  Desktop or on Podman. `scripts/team_mode_two_person_test.sh` runs the checks on your machine.

**Firewall.** One thing stays open: a public address. When this machine has a public address
on its own interface, a sandbox reaches it like any other public address, and so every
service that listens there. The worker cannot learn those addresses in a way that holds, so
it does not close them. On such a server, let only the reverse proxy listen on the public
address, keep the dashboard and API ports on loopback, and close the rest with the machine's
firewall. `./alfera add https` sets it up that way: Caddy is the only listener, on ports 80
and 443, and a sandbox that connects there is asked for a session or a key like any caller.

Every member's sandbox mounts the same workspace folder. See "What members share" under
[Sign-in and your team](#sign-in-and-your-team).

| Outside service | What a self-host uses in its place |
| --- | --- |
| E2B (managed sandboxes) | One Docker container per agent session, started through the host's Docker socket |
| Archil (shared workspace volume) | A folder on local disk: `COWORKER_WORKSPACE_HOST_PATH` |
| S3-compatible bucket (uploads and tool artifacts) | The `coworker_files` Docker volume, until you set a bucket with `./alfera add storage` |
| Managed Postgres | The `postgres` container, with pgvector |
| A cloud job queue | The `engine` container |
| WorkOS (sign-in) | One-time sign-in links the install makes itself, and the owner's password on a one-click server |
| A model provider | Nothing replaces it. You bring one model key, or a model you host |

## What is off by default

A default install sends your chats to one place: the model provider whose key you filled, or
the model server whose address you gave. You pay a provider per token. The parts below stay off until you turn them on in `.env`.

- **Error reports.** `SENTRY_DSN`, `API_SENTRY_DSN`, and `NEXT_PUBLIC_SENTRY_DSN` are empty in
  the template. The repository holds no product analytics.
- **The engine's usage statistics.** The Rivet Engine can report them to its maker.
  `docker-compose.yml` turns that off with `RIVET__TELEMETRY__ENABLED=false`.
- **The hosted model list.** `MODEL_CATALOG_REFRESH` is `false`, so the model list comes from a
  snapshot inside the image. Set it to `true` and the API fetches
  `https://models.dev/api.json` once a day.
- **Managed sandboxes.** `E2B_API_KEY` and `ARCHIL_API_KEY` are empty. Agent sessions run in
  Docker containers on your own daemon instead.
- **Object storage.** `ARTIFACT_UPLOAD_BUCKET` is empty. Uploaded files and tool artifacts
  stay on this machine, in the `coworker_files` Docker volume.
- **Email, Slack, and connectors.** Each one needs its own keys. Add only what you use.
- **Search and reader services.** Web search needs one of the search keys. Without
  `FIRECRAWL_API_KEY` or `JINA_API_KEY`, the coworker fetches a page itself.

### What still reaches the internet

- **Docker.** It pulls the images of the stack at install and update, and `node:24-bookworm`
  and `busybox:1.37` the first time a session starts.
- **The helper.** `./alfera doctor` asks your model provider to list its models, to check
  the key, and pulls `busybox:1.37` when it is missing. A model you host gets one request
  for one token in place of that. `./alfera update` pulls images or
  source.
- **The coworker, when a task needs it.** It reads web pages, from the worker container. It
  searches images on Wikimedia Commons. It calls an MCP server you added. A command in the
  sandbox reaches the public internet: that is how the coworker installs a Python library
  from the package index into `.venv`.
- **Your browser.** The dashboard's own pages load no font, script, or logo from another site.
  A chat answer can hold the address of a picture on another site. The browser does not load
  it: the answer names the site, and the picture loads after you press "Show picture from"
  that site. A picture that is a file of your workspace shows at once. Three cases load from
  another site by themselves. After you load the hosted app catalogue, app icons come from
  that catalogue's image host. When the coworker searches the web or searches for pictures,
  each result loads the icon of its site, or the picture, from the site that holds it. The
  live browser view, which a self-host does not have, loads tab icons from `www.google.com`.

### Change where uploaded files go

`./alfera add storage` asks for four values (`ARTIFACT_UPLOAD_BUCKET`, `R2_BUCKET_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), writes them to `.env`, and runs
`docker compose up -d`. It moves no file. From then on, new uploads and tool artifacts go to
the bucket, and the stack reads only the bucket. Files that are already in the
`coworker_files` volume stay there, and a chat that points at one no longer opens it. Copy
them to the bucket yourself if you need them: in the volume, each file is at
`ARTIFACT_UPLOAD_BUCKET/objects/<object key>`.

## Security notes

- **The install gives the API and worker containers access to the host's Docker socket.**
  They mount `/var/run/docker.sock`. That socket is root-equivalent on the host: whatever can
  talk to it can start a container that owns the machine. It is how each agent session gets
  its own sandbox container. Run this stack on a machine you trust it with, and do not run it
  beside workloads that must stay isolated from it.
- **The sandbox is a container, not a virtual machine.** It runs as a non-root user with
  `no-new-privileges` and limits on memory, CPU and process count. It reaches the public
  internet and no private address. See "What a sandbox can reach".
- **The API port is bound to loopback.** `docker-compose.yml` publishes it as
  `127.0.0.1:${API_PORT:-3001}`. The app container calls the API over the compose network at
  `http://api:3001`.
- **The engine has no published port.** It listens on the compose network only. The API and
  the worker sign in to it with `RIVET_TOKEN`, the engine's admin token. Keep it secret. The
  `app` and `migrations` services do not get it: `docker-compose.yml` blanks it for both.
  Every service does read the rest of `.env`.
- **`COWORKER_MCP_PRIVATE_ADDRESSES=open` lets owners and admins point the install at your
  network.** It is `closed` by default. With `open`, the API and the worker send requests to
  the private address an owner or an admin gives as an MCP server: an HTTP POST with a
  JSON-RPC body and the headers that person chose, except the five names Alfera sets itself.
  The request is sent whether or not an MCP server is there. What comes back from an address
  that is no MCP server: when it is added, one sentence in the dashboard, with the HTTP
  status, the address a redirect names or, for a reply that is JSON-RPC, the error text of
  that reply, and nothing is saved. When the coworker later calls a tool of a server that was added and the reply is
  not a good MCP answer, the tool result holds the HTTP status and up to the first 400
  characters of the reply.
  - *What an owner or admin can reach:* any address in `10.0.0.0/8`, `172.16.0.0/12`,
    `192.168.0.0/16` or `fc00::/7` that the API and worker containers can open a connection
    to, on any port. That is the other machines of your network, and this machine at
    `host.docker.internal`: every port this machine serves on an address a container can
    reach, the published dashboard port and the ports other containers publish included.
    Some Docker setups also pass traffic to a container of another stack by its own address.
  - *What they cannot reach:* the services of this stack by their own addresses (database,
    job engine, API, worker, web app), a sandbox, a loopback address of a container, a cloud
    metadata address, and anything on plain `http://` outside the private ranges.
  - *A name that changes its answer:* a request to a private server goes to the address
    that was checked, so it cannot be led to one of the addresses above. A server on the
    internet is checked the same way before each request, and the request then looks the
    name up once more. That request is `https://`, so an address that holds no certificate
    for the name gets a connection attempt and no request.
  - *What does not change:* the coworker cannot add such a server, a member cannot add any
    server, and a sandbox gets no new name and no new route.

  So turn it on only when you trust every owner and admin of the workspace with what this
  machine and your network serve without a password.
- **The dashboard port follows `APP_BIND`.** The installer publishes it on `127.0.0.1` only.
  `./alfera add team` sets `0.0.0.0`. `./alfera add https` keeps `127.0.0.1` and opens ports
  80 and 443 instead.
- **With https on, the API is reachable from the internet** at `/v1` and `/health` of the
  public name. It asks every caller for an API key or a set-up token. The proxy secret, which
  lets the dashboard speak for a person, is taken off every request that comes in through
  Caddy, so it opens nothing from outside even if it leaks. Caddy reads two settings and no
  secret of the install.
- **Nothing is served without a session.** The only exceptions are the files of the app
  itself, the page a sign-in link opens, and the setup and sign-in pages. A link and a session
  are random 256-bit secrets; the database holds only their hashes. A password is kept as an
  Argon2id hash, and a recovery code as a sha256 hash. A write from another website is refused, and no other
  site can put a page of the install in a frame.
- **A session has an absolute end.** It ends 30 days after it started, and a new link for the
  same person ends it sooner. Nothing extends it, so a copied cookie cannot be kept alive.
- **The session cookie is `HttpOnly` and `SameSite=Lax`.** Over https it is
  `__Host-alfera_team_session`, `Secure` and bound to the one host. Over plain http it has a
  plain name that another service on the same host name can read: trusted networks only.
  With WorkOS sign-in the cookie is always `Secure`, so any hostname other than `localhost`
  needs https there.
- **The API does not start with a weak proxy secret.** That secret is all that stands between
  a caller and any identity it claims. With sign-in links on, the API refuses to start unless
  `COWORKER_API_PROXY_SECRET` is set, is 32 characters or more, and is not the development
  value in the source. The installer generates one.
- **The helper and the installer write `.env` readable by you only**, from the first byte
  (`umask 077`), and refuse a value that holds a line break. A value with a dollar sign, a
  quote, a backslash or a space goes in double quotes, with a backslash before each
  backslash, double quote and dollar sign. Docker Compose reads the file for every container,
  and it would change such a value if it stood bare. When you write `.env` by hand, do the
  same.
- **The workspace folder is closed to other accounts where it can be.** See Troubleshooting.

## Upgrade

Run this in the install folder (the installer prints its path):

```bash
./alfera update vX.Y.Z
```

A release is a git tag of this repository that starts with `v`, and the two images carry the
same tag. The tags page of the repository lists them. With no version, `update` pulls the
version that `PRODUCT_VERSION` in `.env` names again. `update` does four things in order:

1. It saves the database in `backups/` (the same as `./alfera backup`).
2. It pulls the images of the version. When they do not download, nothing changes.
3. It starts the new version and waits up to three minutes for the API and the dashboard.
4. When they do not answer, it goes back: it sets the version before, puts back the database
   it saved in step 1, and starts the version before. It then stops with `update_rolled_back`.

From a clone, `./alfera update` pulls the source and builds the images again, with no going
back. The `migrations` service runs the new schema before the
API and the worker start, so neither serves against an old schema. Read the release notes
before an upgrade: a rollback does not reverse a migration.

## Back up

An install keeps its state in these places. Back up the first three.

| Where | What it holds | Back it up |
| --- | --- | --- |
| The `coworker_postgres` volume | The database: chats, runs, jobs, schedules, settings, and stored connection credentials (encrypted) | Yes |
| The `coworker_files` volume | Uploaded files and tool artifacts, unless you set a bucket | Yes |
| The folder that `COWORKER_WORKSPACE_HOST_PATH` names | The files the coworker works on | Yes |
| The `rivet_engine` volume | The queue engine's own working state. The jobs themselves are rows in the database | No step below copies it |
| The `caddy_data` volume, with https on | The certificate and its key | No. Caddy gets a new certificate |

Keep a copy of `.env` and of the `secrets` folder too. `secrets/master_key` locks the stored
model keys and connection credentials, and a database backup cannot open them without it.
The file is in no backup that this install makes: keep it away from the server.

`./alfera backup` saves the database in `backups/alfera-<time>.dump`, readable by this account
only. Put it back into an empty database with `pg_restore`:

```bash
docker compose exec -T postgres pg_restore -U coworker -d coworker --no-owner < backups/alfera-<time>.dump
```

### A new master key

`./alfera rotate-key` writes a new `secrets/master_key` and moves the old key to
`secrets/master_key_fallbacks`, then restarts the API and the worker. New values are locked
with the new key, and the values locked with an old key still open. Values are not locked
again with the new key, so keep every old key in the fallbacks file. The API, the worker and
the migrations read both files from `/run/secrets`. The dashboard gets neither.

We have not tested a restore that leaves out the `rivet_engine` volume while jobs wait. For
an exact copy, stop the stack with `./alfera stop` and copy that volume the same way as the
files volume.

Run these in the install folder:

```bash
docker compose exec -T postgres pg_dump -U coworker coworker | gzip > alfera-$(date +%F).sql.gz
```

Back up the uploaded files:

```bash
docker run --rm -v alfera_coworker_files:/files -v "$PWD":/backup alpine \
  tar czf /backup/alfera-files-$(date +%F).tar.gz -C /files .
```

Back up the workspace folder with any file copy tool. Restore the database into an empty one:

```bash
gunzip -c alfera-2026-01-31.sql.gz | docker compose exec -T postgres psql -U coworker coworker
```

## Troubleshooting

Start with `./alfera doctor`. It checks every part and names the fix.

**The installer stops with "a database from an earlier install exists".** A Docker volume
from an earlier install is still there, and the new `.env` does not hold its password. Put
the earlier `.env` back to keep the data, or remove the volume the message names to start
clean.

**Docker has no free address range ("all predefined address pools have been fully
subnetted").** A machine with many Docker networks runs out. The installer and the worker deal
with it themselves. The installer writes `docker-compose.override.yml` next to the compose
file with a range it names (`10.213.210.0/24` up to `10.213.219.0/24`), and says so in one
line; compose reads that file on every later command, so `./alfera` keeps using it, and
`./alfera status` shows the range. The installer skips a range that a route of your machine
overlaps (it reads `ip route`, or `netstat -rn` on macOS), so it does not take the range of
your office network or VPN. It makes the sandbox network in the same way. If that network is
removed later, the worker makes it again from the same list; the worker runs in a container
and cannot read the routes of the machine, so there only Docker's check against its own
networks applies. Only when every range in the list is taken do they stop and name the
command to run by hand. `docker network prune` frees the ranges of networks nothing uses.

**The chat says "The model must support tool calling, and this one does not".** The model
at your address took no tool. Choose a model that supports tool calling with
`./alfera add model`. On some servers the model supports it and the server must be told (vLLM:
start it with `--enable-auto-tool-choice` and a `--tool-call-parser`; the llama.cpp server:
start it with `--jinja`).

**`./alfera doctor` says the worker cannot reach the model address.** The model server
answers on this machine and not in a container. On Linux it listens on `127.0.0.1` only: make
it listen on all addresses (Ollama: `OLLAMA_HOST=0.0.0.0`), and keep the port closed to other
machines with your firewall. Then run `./alfera doctor` again.

**Agent commands fail with "docker: permission denied".** The API and worker containers reach
the host daemon through the mounted socket and run as uid 1000, which is not in your `docker`
group. Read the socket's group id from inside a container, put it in `.env`, and restart:

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock pgvector/pgvector:pg17 \
  stat -c '%g' /var/run/docker.sock   # e.g. 988
# set DOCKER_GROUP_ID=988 in .env
docker compose up -d api worker
```

**Agent commands fail with "no such file or directory" on a workspace path.** The sandbox
container is started by the *host* daemon, so its bind-mount source is a host path.
`COWORKER_WORKSPACE_HOST_PATH` and `COWORKER_WORKSPACE_BASE_PATH` must hold the same absolute
path, and `docker-compose.yml` mounts it at that identical path inside the API and worker
containers. If you change one, change both.

**Who can read the workspace folder on this machine.** The containers and every sandbox
write `COWORKER_WORKSPACE_HOST_PATH` as uid 1000. The installer gives the folder mode `0750`
when it can hand it to uid 1000: when you install as uid 1000, as root (it then makes uid
1000 the owner), or on macOS, where Docker maps file ownership to your account. On Linux
under any other account there is no way to do that without root, so there the folder is
`0777` and the installer says so. Install as root or as uid 1000 to close it, or `chown` it
to uid 1000 afterwards and set `0750`.

**The https address does not open, or the browser warns about the certificate.** Run
`./alfera doctor`: it asks the https address on the machine itself. Then `./alfera logs caddy`
shows what the certificate authority answered. The usual causes: the name does not point at
this machine, port 80 or 443 is closed in the provider's firewall, or the shared name service
ran into its weekly limit. See [HTTPS](#https).

**The installer stops while it builds an image.** The build needs about 3 GB of free memory and
15 GB of free disk. On a smaller server the build is killed. See
[The smallest server](#the-smallest-server). Run the installer again after you made room: it
keeps the `.env` it wrote.

**The page says "This Alfera is not set up yet".** A one-click server waits for its owner.
Open the setup link from the deploy page, with the part after the `#` sign.

**The page says "This Alfera needs a sign-in link".** The browser has no session. Run
`./alfera team link` on the machine that runs Alfera, and open the link it prints. A link
works once and for one hour.

**A link says "This link is not valid any more".** It was used, it ran out, or a newer link
for the same person replaced it. Make a new one: `./alfera team link` for the owner, or
"New sign-in link" in Settings -> Team for anyone else.

**A chat fails, and `./alfera logs worker` says "The sandbox network ... could not be made".**
Docker had no free address range, and every range the worker tried by name is taken. Make
the network yourself with a range that is free on this machine, then send the message again:

```bash
docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false \
  --subnet 10.250.0.0/24 alfera-sandbox
```

**A chat fails, and `./alfera logs worker` says a sandbox "could not be cut off from private
addresses".** The helper image did not run. The same line ends with what Docker said. When
Docker could not pull the image, pull it yourself, then send the message again:

```bash
docker pull busybox:1.37
```

**With WorkOS: sign-in bounces back to the sign-in page.** The redirect URI registered in WorkOS must
match the origin you browse from, character for character, including the port and the
`/auth/callback` path. `http://127.0.0.1:3000` and `http://localhost:3000` are different
origins to WorkOS.

**With WorkOS: sign-in works on `localhost` but not on a LAN address or a domain.** Production
mode marks session cookies `Secure`. Browsers accept those on `http://localhost` only. For any other
hostname, put the app behind HTTPS and register that `https://` origin in WorkOS.

**The API container exits at boot with a message about
`COWORKER_WORKSPACE_RUNTIME_PROVIDER=local`.** The `local` provider runs commands inside the
API container and is refused in production. Use `docker`, the template default.

**A message gets no answer.** The worker runs the jobs. Check that it registered with the
engine: `docker compose logs worker` prints a line that starts with `worker ready`.

**Something else.** Read the logs in order. The migration job speaks first.

```bash
docker compose logs migrations
docker compose logs engine
docker compose logs api
docker compose logs worker
docker compose logs app
```

## Check an install from a script

Every step is non-interactive.

```bash
# 1. Confirm the host can run the stack.
docker compose version && docker info >/dev/null

# 2. Install, supplying the one human-only value up front.
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
INSTALL_DIR="$HOME/alfera-selfhost" \
  bash -c 'curl -fsSL https://raw.githubusercontent.com/alfera-labs/company-use/main/deploy/install.sh | bash'

# 3. Verify the API answers.
curl -fsS http://localhost:3001/health

# 4. Verify the dashboard answers. Expect 401: it asks for a sign-in link.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000

# 5. Verify the whole install in one step. Exit code 0 means every check passed.
cd "$HOME/alfera-selfhost" && ./alfera doctor

# 6. Sign in. The command prints a one-time link; open it in a browser on this machine.
./alfera team link
```

Step 5 uses the folder that step 2 set with `INSTALL_DIR`. The helper is in another folder in
two cases. From a clone, it is `deploy/alfera` in the clone. When the version has no published
image, the installer builds from source and the helper is
`$INSTALL_DIR/source/deploy/alfera`. The installer prints the folder at the end.

If step 3 fails, read `docker compose logs migrations` first, then `docker compose logs api`.
Do not restart the stack before reading both: the migration job runs once and its failure is
the usual cause.

For a program that needs each step as it happens, and a reason when one fails, see
[Install from a program](#install-from-a-program).

### Prove the install on a fresh Linux machine

`deploy/test_install_on_linux.sh arm64` (or `amd64`) does the whole path on a new machine and
deletes the machine again. It needs OrbStack on a Mac. It makes an Ubuntu 24.04 machine,
installs Docker with the official script, hands this source tree to the machine in place of
the code host, runs the installer with `--unattended --progress --https`, runs it a second
time, signs in as the owner with curl, makes one API call as the owner, has the worker start a
sandbox and checks what the sandbox reaches, runs `./alfera doctor`, and prints the time, the
memory and the disk it took. It exits 0 only when every step passed. It uses no model key, so
it runs no chat. `--plain` installs on plain http.

`deploy/test_install.sh` checks the same installer with stand-ins for Docker and curl, in a
few seconds: the progress lines, the reasons, a second run, and that a key is on no command
line.
