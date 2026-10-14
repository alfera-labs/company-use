const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { answer_mcp_message } = require('../src/folder/folder_mcp_server.cjs');

function create_folder_with_one_file() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-folder-'));
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'first line\nsecond line\n');
  return folder;
}

let next_id = 1;
async function call_tool(folder, name, given) {
  const message = {
    jsonrpc: '2.0',
    id: next_id++,
    method: 'tools/call',
    params: { name, arguments: given },
  };
  const { result } = await answer_mcp_message(folder, message);
  return { text: result.content[0].text, failed: result.isError };
}

test('the server introduces itself and lists six tools with read-only marks', async () => {
  const folder = create_folder_with_one_file();
  const hello = await answer_mcp_message(folder, {
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  assert.equal(hello.result.protocolVersion, '2025-06-18');
  assert.equal(await answer_mcp_message(folder, { method: 'notifications/initialized' }), null);
  const { result } = await answer_mcp_message(folder, { id: 2, method: 'tools/list' });
  const read_only = result.tools
    .filter((tool) => tool.annotations.readOnlyHint)
    .map((tool) => tool.name);
  assert.deepEqual(read_only, ['list_files', 'read_file', 'search_files']);
  assert.equal(result.tools.length, 6);
});

test('files are listed, read, searched, written and edited inside the folder', async () => {
  const folder = create_folder_with_one_file();
  assert.match((await call_tool(folder, 'list_files', {})).text, /notes\.txt {2}\(23 bytes\)/);
  assert.equal(
    (await call_tool(folder, 'read_file', { path: 'notes.txt', line_count: 1 })).text,
    'first line\n(3 lines in total)',
  );
  assert.match(
    (await call_tool(folder, 'search_files', { pattern: 'sec.nd' })).text,
    /notes\.txt:2:second line/,
  );
  assert.equal(
    (await call_tool(folder, 'write_file', { path: 'deep/new.txt', content: 'hello' })).failed,
    false,
  );
  assert.equal(fs.readFileSync(path.join(folder, 'deep/new.txt'), 'utf8'), 'hello');
  assert.equal(
    (
      await call_tool(folder, 'edit_file', {
        path: 'notes.txt',
        old_text: 'second',
        new_text: '2nd',
      })
    ).failed,
    false,
  );
  assert.equal(fs.readFileSync(path.join(folder, 'notes.txt'), 'utf8'), 'first line\n2nd line\n');
});

test('a path outside the folder is refused, also through a link', async () => {
  const folder = create_folder_with_one_file();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zq-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(folder, 'link'));
  for (const path_outside of [
    '../secret.txt',
    path.join(outside, 'secret.txt'),
    'link/secret.txt',
  ]) {
    const read = await call_tool(folder, 'read_file', { path: path_outside });
    assert.equal(read.failed, true, path_outside);
    assert.match(read.text, /outside the folder/);
  }
  const write = await call_tool(folder, 'write_file', { path: 'link/planted.txt', content: 'x' });
  assert.equal(write.failed, true);
  assert.equal(fs.existsSync(path.join(outside, 'planted.txt')), false);
});

test('wrong arguments and unknown tools come back as errors the agent can read', async () => {
  const folder = create_folder_with_one_file();
  assert.match((await call_tool(folder, 'read_file', {})).text, /needs "path"/);
  assert.match(
    (await call_tool(folder, 'read_file', { path: 'notes.txt', mode: 'x' })).text,
    /does not take "mode"/,
  );
  assert.match((await call_tool(folder, 'delete_everything', {})).text, /no tool named/);
  assert.match((await call_tool(folder, 'read_file', { path: 'missing.txt' })).text, /not a file/);
});

test('a command runs in the folder and cannot write outside it', async () => {
  const folder = create_folder_with_one_file();
  const inside = await call_tool(folder, 'run_command', {
    command: 'wc -l < notes.txt && echo made > made.txt',
  });
  assert.equal(inside.failed, false, inside.text);
  assert.match(inside.text, /exit code 0\n\s*2/);
  assert.equal(fs.existsSync(path.join(folder, 'made.txt')), true);

  const target = path.join(os.homedir(), `zq-must-not-exist-${process.pid}.txt`);
  const outside = await call_tool(folder, 'run_command', {
    command: `echo x > ${JSON.stringify(target)}`,
  });
  const was_written = fs.existsSync(target);
  fs.rmSync(target, { force: true });
  assert.equal(was_written, false);
  assert.equal(outside.failed, true);
});

test('a command that runs too long is stopped', async () => {
  const folder = create_folder_with_one_file();
  const slow = await call_tool(folder, 'run_command', { command: 'sleep 5', timeout_seconds: 1 });
  assert.match(slow.text, /stopped after 1 seconds/);
  assert.equal(slow.failed, true);
});
