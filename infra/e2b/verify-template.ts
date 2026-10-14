import { baked_browser_home, sandbox_home_directory } from '@runtime-platform/orchestrator/e2b_command';
import { Sandbox } from 'e2b';

// Verifies the base image is usable the way the runtime actually uses it: as the non-root
// user, with the runtime's own environment. Both bugs this has caught were environment
// mismatches, not missing packages — pip falling back to a per-user install the runtime never
// saw, and Chrome baked under a HOME the runtime no longer sets.
//
// Run: bun run e2b:verify-template

const template_name = 'coworker-workspace';

// Exactly what create_e2b_command_env hands every sandbox command. If this drifts from the
// runtime, the verification stops meaning anything.
const runtime_env = {
  HOME: sandbox_home_directory,
  TMPDIR: '/tmp/coworker',
  AGENT_BROWSER_SESSION: 'coworker_template_verify',
  AGENT_BROWSER_RESTORE: 'coworker_template_verify',
  AGENT_BROWSER_ENCRYPTION_KEY: 'ab'.repeat(32),
  AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: '1000',
};

const browser_cache = `${sandbox_home_directory}/.agent-browser/browsers`;
const scratch = '/tmp/coworker/verify';

async function main() {
  // `timeoutMs` is the sandbox's total lifetime, not one command's deadline. Leave room for a
  // cold Chrome launch plus a save/restart cycle.
  const sandbox = await Sandbox.create(template_name, { timeoutMs: 300_000 });
  try {
    const imports = await sandbox.commands.run(
      'python3 -c "import openpyxl, pandas, docx, pptx, pdfplumber, pypdf, reportlab, PIL, pdf2image, numpy, lxml; print(\'PY_IMPORTS_OK\')"',
    );
    console.log('python imports:', imports.exitCode === 0 ? imports.stdout.trim() : imports.stderr);

    const tools = await sandbox.commands.run(
      'soffice --headless --version && pdftoppm -v 2>&1 | head -1 && pandoc --version | head -1 && gs --version && rg --version | head -1 && archil --version',
    );
    console.log('system tools:\n', tools.stdout || tools.stderr);

    // The presentation skill names Inter; LibreOffice can only render it if fontconfig finds
    // it, so confirm it resolves as the runtime user.
    const inter = await sandbox.commands.run(
      'fc-list | grep -qi inter && echo INTER_FONT_OK || echo INTER_FONT_MISSING',
    );
    console.log('inter font:', inter.stdout.trim() || inter.stderr);

    const roundtrip = await sandbox.commands.run(
      `python3 -c "import openpyxl,os; os.makedirs('${scratch}',exist_ok=True); wb=openpyxl.Workbook(); wb.active['A1']=1; wb.active['A2']=2; wb.active['A3']='=A1+A2'; wb.save('${scratch}/t.xlsx'); print('XLSX_WRITE_OK', os.path.getsize('${scratch}/t.xlsx'))"`,
      { envs: runtime_env },
    );
    console.log('xlsx roundtrip:', roundtrip.exitCode === 0 ? roundtrip.stdout.trim() : roundtrip.stderr);

    await link_baked_browser_into_home(sandbox);
    await verify_chrome_is_the_baked_one(sandbox);
    await verify_browser_drives_and_restores(sandbox);
    await verify_live_view_relay(sandbox);
  } finally {
    await sandbox.kill();
  }
}

// The live view launches this baked relay through start_preview. If it is missing, its `ws`
// dependency did not install, or it fails to boot, the panel silently never appears — the exact
// failure this build exists to prevent. Check the files are present and world-readable, then
// boot the relay and confirm it serves its health endpoint.
async function verify_live_view_relay(sandbox: Sandbox) {
  const files = await sandbox.commands.run(
    `test -r ${baked_browser_home}/live-view-relay.mjs && ` +
      `test -r ${baked_browser_home}/pointer.js && ` +
      `test -r ${baked_browser_home}/node_modules/ws/index.js && echo LIVE_VIEW_FILES_OK`,
    { envs: runtime_env },
  );
  if (!files.stdout.includes('LIVE_VIEW_FILES_OK')) {
    throw new Error(
      `The live-view relay, pointer script, or its ws dependency is missing or not readable under ${baked_browser_home}.`,
    );
  }

  // The shell command always exits 0 (a failed curl must not throw before we can read the relay's
  // own log), and the health verdict plus the relay log are asserted in JS.
  const health = await sandbox.commands.run(
    `LIVE_VIEW_RELAY_PORT=4820 AGENT_BROWSER_LIVE_VIEW_TOKEN=verify nohup node ${baked_browser_home}/live-view-relay.mjs > /tmp/coworker/relay-verify.log 2>&1 & ` +
      'sleep 3; ' +
      "printf 'HEALTH_CODE=%s\\n' \"$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:4820/)\"; " +
      "echo '---relay-log---'; cat /tmp/coworker/relay-verify.log 2>&1 | head -20",
    { timeoutMs: 20_000, envs: runtime_env },
  );
  if (!health.stdout.includes('HEALTH_CODE=200')) {
    throw new Error(`The live-view relay did not serve its health endpoint:\n${health.stdout}`);
  }
  console.log('live-view relay:', 'OK');
}

/**
 * Reproduces what sandbox_workspace_link_script does at session start. The template puts
 * Chrome in an immutable layer; the link is what makes agent-browser find it, so verifying
 * without the link would test an arrangement that never runs.
 */
async function link_baked_browser_into_home(sandbox: Sandbox) {
  const result = await sandbox.commands.run(
    `mkdir -p ${sandbox_home_directory}/.agent-browser && ` +
      `ln -sfn ${baked_browser_home}/.agent-browser/browsers ${browser_cache}`,
  );
  if (result.exitCode !== 0) throw new Error(`Could not link the baked browser: ${result.stderr}`);
}

/**
 * The check that would have caught the layout move. agent-browser only ever looks in
 * $HOME/.agent-browser/browsers; if that does not resolve to the baked copy, every cold
 * sandbox silently re-downloads ~290 MB of Chrome, which is exactly what baking it prevents.
 */
async function verify_chrome_is_the_baked_one(sandbox: Sandbox) {
  const resolved = await sandbox.commands.run(
    `readlink -f ${browser_cache} && find ${browser_cache}/ -maxdepth 2 -name chrome -type f -print -quit`,
    { envs: runtime_env },
  );
  const [resolved_path, chrome_binary] = resolved.stdout.trim().split('\n');
  if (!resolved_path?.startsWith(baked_browser_home)) {
    throw new Error(
      `${browser_cache} resolves to ${resolved_path ?? 'nothing'}, not the baked ${baked_browser_home}. ` +
        'A sandbox would re-download Chrome on every cold start.',
    );
  }
  if (!chrome_binary) throw new Error(`No chrome binary under ${resolved_path}`);
  console.log('baked chrome:', chrome_binary);
}

async function verify_browser_drives_and_restores(sandbox: Sandbox) {
  const sessions_dir = `${sandbox_home_directory}/.agent-browser/sessions`;
  await sandbox.commands.run(`rm -rf ${sessions_dir}/coworker_template_verify*`);

  const browser_version = await sandbox.commands.run('agent-browser --version', { envs: runtime_env });
  if (!browser_version.stdout.includes('0.32.3')) {
    throw new Error(`Unexpected agent-browser version: ${browser_version.stdout}`);
  }
  const doctor = await sandbox.commands.run('agent-browser doctor --json', { envs: runtime_env });
  console.log('agent-browser doctor:\n', doctor.stdout.trim() || doctor.stderr);
  verify_derive_client_manual_anchors(
    await sandbox.commands.run('agent-browser skills get derive-client', { envs: runtime_env }),
  );

  // Cold Chrome launch can take ~15s, so give the drive room and wait for load before
  // snapshotting. The snapshot lists refs as `[ref=eN]`.
  const snapshot = await sandbox.commands.run(
    'agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i',
    { timeoutMs: 90_000, envs: runtime_env },
  );
  if (!/ref=e\d+/.test(snapshot.stdout)) {
    throw new Error('Browser snapshot returned no refs under the runtime environment');
  }
  console.log('browser snapshot refs:', 'OK');

  const save_probe = await sandbox.commands.run(
    `agent-browser eval "localStorage.setItem('coworker_restore_probe', 'persisted')" && agent-browser close`,
    { timeoutMs: 60_000, envs: runtime_env },
  );
  if (save_probe.exitCode !== 0) throw new Error(save_probe.stderr || 'Browser state save failed');

  const state_file = await sandbox.commands.run(
    `find ${sessions_dir} -maxdepth 2 -type f -print -quit`,
    { envs: runtime_env },
  );
  if (!state_file.stdout.trim()) throw new Error('Browser restore created no session file');

  const plaintext_probe = await sandbox.commands.run(
    `grep -R -l 'coworker_restore_probe\\|persisted' ${sessions_dir} || true`,
    { envs: runtime_env },
  );
  if (plaintext_probe.stdout.trim()) throw new Error('Browser session file contains plaintext state');

  const restore_probe = await sandbox.commands.run(
    'agent-browser open https://example.com && agent-browser storage local coworker_restore_probe',
    { timeoutMs: 90_000, envs: runtime_env },
  );
  if (!restore_probe.stdout.includes('persisted')) {
    throw new Error(`Browser state restore failed: ${restore_probe.stdout || restore_probe.stderr}`);
  }
  await sandbox.commands.run('agent-browser close', { envs: runtime_env });
  console.log('encrypted browser restore:', 'OK');
}

// The operate-the-browser skill does not restate the derivation procedure — it points at
// agent-browser's own derive-client manual and overrides the three places that manual tells
// the agent to write a credential to disk. Those overrides negate specific upstream sentences,
// so a version bump that rewords them would leave the skill reading as if it still protects
// the customer while protecting nothing. Fail the build instead.
const derive_client_manual_anchors = [
  'cookies get --json > cookies.json',
  'loads from a file or environment variable',
  're-export cookies',
  'embeds text response bodies',
];

function verify_derive_client_manual_anchors(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}) {
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`agent-browser has no derive-client skill: ${result.stderr || 'empty output'}`);
  }
  const missing = derive_client_manual_anchors.filter((anchor) => !result.stdout.includes(anchor));
  if (missing.length > 0) {
    throw new Error(
      `The derive-client manual no longer says: ${missing.join('; ')}. ` +
        'Re-read it and update the OVERRIDE wording in operating_the_browser.ts before bumping the pin.',
    );
  }
  console.log('derive-client manual anchors:', 'OK');
}

main().catch((error) => {
  console.error('VERIFY_FAILED', error);
  process.exit(1);
});
