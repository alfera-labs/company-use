import { baked_browser_home } from '@runtime-platform/orchestrator/e2b_command';
import { Template } from 'e2b';

// The base image every agent sandbox starts from.
//
// It bakes tools, not files. The agent's own files live on the durable volume and are
// bind-mounted at /workspace when the sandbox starts (see workspace_layouts.ts); nothing here
// creates a workspace, because anything this image writes there would be shadowed by the
// mount a second later.
//
// Replaces coworker-nextjs, which prewarmed a Next.js app at /work/repo. /work no longer
// exists — the layout moved the agent's root to /workspace and HOME out to /tmp/coworker/home
// — so that scaffold became an orphan directory and a slower build for nothing.

// Browser-agent harness: the session's own sandbox drives a real headless browser through the
// stock agent-browser CLI, so there is no separate browser sandbox. Pin the CLI (agent-browser
// has recurring Chromium-install bugs); `agent-browser install` downloads the
// exact Chrome for Testing build this version expects, so pinning the CLI pins Chrome. Bake it
// at build time — never install at boot. See infra/e2b/PINS.md.
const agent_browser_version = '0.32.3';
const archil_client_version = '0.8.35-1788453570';
const archil_client_sha256 = '6a9f5ae80ee8c6b3d3f20a09443981a4889433e3f815acb21716b214390ab05b';

// The daemon lifetime follows the sandbox lifetime, not an idle timer, so a long multi-step
// task never loses its browser mid-run. The command timeout stays below the 30s CLI IPC read
// timeout. Baked in so `commands.run` inherits them at runtime.
const agent_browser_envs = {
  AGENT_BROWSER_IDLE_TIMEOUT_MS: '0',
  AGENT_BROWSER_DEFAULT_TIMEOUT: '25000',
  // Pin the per-session viewport stream server to a known port so the live-view relay can dial
  // it at a fixed localhost address. See agent_browser_stream_port in agent-core.
  AGENT_BROWSER_STREAM_PORT: '4849',
  // Hide scrollbars in the streamed viewport so the live view reads like a clean page, not a
  // tool window.
  AGENT_BROWSER_HIDE_SCROLLBARS: '1',
};

// The live-view relay needs a WebSocket server, which Node 24 does not provide built-in. Pin
// `ws` and install it beside the baked scripts so the relay imports it by absolute path.
const ws_package_version = '8.18.0';

// System tools the document skills need. LibreOffice renders and converts Office files,
// Poppler turns PDFs into images, Pandoc handles Markdown/HTML/docx, Ghostscript compresses
// PDFs. The fonts keep rendered output legible — fonts-inter is the grotesque the presentation
// skill names, and LibreOffice must have it installed to render it (python-pptx only names a
// font; the renderer supplies the glyphs).
const document_apt_packages = [
  'python3',
  'python3-pip',
  'python3-venv',
  'libreoffice',
  'poppler-utils',
  'pandoc',
  'ghostscript',
  'fonts-dejavu',
  'fonts-liberation',
  'fonts-inter',
  'libfuse2',
];

// Python libraries the document skills drive from the sandbox. Installed system-wide so
// `python3` finds them directly. Versions pinned so rebuilds are deterministic; bump
// deliberately and re-verify.
const document_python_packages = [
  'openpyxl==3.1.5',
  'python-docx==1.2.0',
  'python-pptx==1.0.2',
  'reportlab==5.0.0',
  'pdfplumber==0.11.10',
  'pypdf==6.14.2',
  'pandas==3.0.3',
  'numpy==2.4.6',
  'lxml==6.1.1',
  'Pillow==12.3.0',
  'pdf2image==1.17.0',
  'tabulate==0.10.0',
];

export default Template()
  .fromNodeImage('24')
  .aptInstall(['curl', 'git', 'ripgrep'])
  // certutil, for teaching Chrome to trust the egress proxy that attaches our credentials.
  // Chrome reads its own NSS store rather than the system bundle, and a running sandbox is not
  // root, so the tool has to be here at build time. See orchestrator/sandbox_proxy_certificate.ts.
  .aptInstall(['libnss3-tools'])
  .aptInstall(document_apt_packages)
  .setEnvs(agent_browser_envs)
  .runCmd(`npm install -g agent-browser@${agent_browser_version}`, { user: 'root' })
  // As root, `--with-deps` installs the apt system libraries headless Chrome needs.
  .runCmd('agent-browser install --with-deps', { user: 'root' })
  // Bake Chrome into an immutable image layer, world-readable, and NOT into HOME.
  //
  // agent-browser caches Chrome at $HOME/.agent-browser/browsers. The old template installed
  // it under HOME directly, which worked only while HOME was a real directory in the image.
  // HOME is now /tmp/coworker/home — scratch, recreated per run — so an install there would be
  // thrown away and every cold sandbox would re-download ~290 MB, which PINS.md forbids.
  // sandbox_workspace_link_script points HOME's browsers cache at this path instead.
  .runCmd(
    `set -euo pipefail
mkdir -p ${baked_browser_home}
HOME=${baked_browser_home} agent-browser install
chmod -R a+rX ${baked_browser_home}`,
    { user: 'root' },
  )
  // Archil is the FUSE layer for durable volumes. Pin both the exact release and its SHA-256.
  // Archil's production install channel does not publish adjacent signature files for this
  // release, so the template never executes their mutable convenience installer.
  .runCmd(
    `set -euo pipefail
VERSION=${archil_client_version}
EXPECTED_SHA256=${archil_client_sha256}
BASE_URL=https://s3.amazonaws.com/archil-client/pkg
ARTIFACT=archil_\${VERSION}_amd64.deb
VERIFY_DIR=\$(mktemp -d)
trap 'rm -rf "\$VERIFY_DIR"' EXIT
cd "\$VERIFY_DIR"
curl --fail --location --silent --show-error \\
  "\$BASE_URL/\$ARTIFACT" \\
  --output "\$ARTIFACT"
printf '%s  %s\\n' "\$EXPECTED_SHA256" "\$ARTIFACT" | sha256sum -c -
apt-get install -y "./\$ARTIFACT"
archil --version`,
    { user: 'root' },
  )
  // Install as root so the libraries land in system site-packages, where the sandbox's
  // non-root runtime user can import them. Without `user: 'root'`, pip silently falls back to
  // a per-user install the runtime never sees.
  .runCmd(
    `pip3 install --break-system-packages --no-cache-dir ${document_python_packages.join(' ')}`,
    { user: 'root' },
  )
  // Live view: the pointer reporter and the stream relay, baked world-readable next to Chrome.
  // pointer.js is registered on every browser command; live-view-relay.mjs is started per
  // session to bridge agent-browser's localhost stream to the app. Kept as real files under
  // infra/e2b/browser-live-view/ so they are testable and reviewable, not inlined here.
  // Source paths are relative to this template file's directory (infra/e2b/), which is how the
  // E2B builder resolves copy sources — not the repo root.
  .copy(['browser-live-view/pointer.js', 'browser-live-view/live-view-relay.mjs'], `${baked_browser_home}/`, {
    user: 'root',
    mode: 0o644,
  })
  // The relay imports `ws` by absolute path. Install it into the baked browser home and make it
  // world-readable so the non-root runtime user can import it.
  .runCmd(
    `set -euo pipefail
cd ${baked_browser_home}
npm init -y >/dev/null 2>&1
npm install ws@${ws_package_version}
chmod -R a+rX ${baked_browser_home}/node_modules ${baked_browser_home}/package.json`,
    { user: 'root' },
  )
  .runCmd(
    `set -euo pipefail
cd ${baked_browser_home}
test -r pointer.js && test -r live-view-relay.mjs
node --check pointer.js && node --check live-view-relay.mjs
node --input-type=module -e 'import { WebSocket, WebSocketServer } from "ws"; if (typeof WebSocket !== "function" || typeof WebSocketServer !== "function") throw new Error("Browser relay WebSocket exports are missing");'`,
  )
  // The scratch root the runtime hands out as TMPDIR and HOME. Created here so the first
  // command in a sandbox does not have to, and world-writable because the runtime is not root.
  .runCmd('mkdir -p /tmp/coworker && chmod 777 /tmp/coworker', { user: 'root' });
