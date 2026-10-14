const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');

// The settings file is in the folder Electron names. Here that folder is one made for the test.
const electron_file = require.resolve('electron');
const settings_file_of_the_app = require.resolve('../src/settings.cjs');
const electron_before = require.cache[electron_file];
let folder;
let settings;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'alfera-settings-test-'));
  delete process.env.ALFERA_ADDRESS;
  delete require.cache[settings_file_of_the_app];
  require.cache[electron_file] = { id: electron_file, filename: electron_file, loaded: true, exports: { app: { getPath: () => folder } } };
  settings = require('../src/settings.cjs');
});
afterEach(() => {
  require.cache[electron_file] = electron_before;
  delete require.cache[settings_file_of_the_app];
  fs.rmSync(folder, { recursive: true, force: true });
});

test('on a first run no address is chosen', () => {
  assert.equal(settings.has_chosen_an_address(), false);
  assert.equal(settings.read_address(), settings.default_address);
});

test('tabs alone are not a choice: only an address is', () => {
  settings.write_settings({ tabs: ['https://app.alfera.ai/home'] });
  assert.equal(settings.has_chosen_an_address(), false);
  settings.write_settings({ address: 'https://alfera.example.com' });
  assert.equal(settings.has_chosen_an_address(), true);
});

test('a person from before the app asked keeps Alfera Cloud: it is written down once, when the app starts', () => {
  settings.write_settings({ tabs: ['https://app.alfera.ai/chats/ses_a'] });
  settings.keep_alfera_cloud_for_a_person_from_before();
  assert.equal(settings.read_settings().address, settings.default_address);
  assert.equal(settings.has_chosen_an_address(), true);
});

test('a first run stays a first run, and a chosen server stays chosen', () => {
  settings.keep_alfera_cloud_for_a_person_from_before();
  assert.equal(settings.has_chosen_an_address(), false);
  settings.write_settings({ address: 'https://alfera.example.com', tabs: ['https://alfera.example.com/home'] });
  settings.keep_alfera_cloud_for_a_person_from_before();
  assert.equal(settings.read_address(), 'https://alfera.example.com');
});

test('an address chosen in the app replaces the one the run was started with', () => {
  process.env.ALFERA_ADDRESS = 'http://localhost:3000';
  assert.equal(settings.read_address(), 'http://localhost:3000');
  settings.choose_address(settings.default_address);
  assert.equal(settings.read_address(), settings.default_address);
});
