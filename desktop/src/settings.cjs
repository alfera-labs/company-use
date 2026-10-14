const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const default_address = 'https://app.alfera.ai';

function settings_path() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function read_settings() {
  try {
    return JSON.parse(fs.readFileSync(settings_path(), 'utf8'));
  } catch {
    return {};
  }
}

function write_settings(changes) {
  const next = { ...read_settings(), ...changes };
  fs.mkdirSync(path.dirname(settings_path()), { recursive: true });
  fs.writeFileSync(settings_path(), JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(settings_path(), 0o600);
  return next;
}

function read_address() {
  return process.env.ALFERA_ADDRESS || read_settings().address || default_address;
}

// An address chosen in the app replaces the one this run was started with. The app then has one
// answer to "where is Alfera", so sign-in on the chosen address stays in the window.
function choose_address(address) {
  delete process.env.ALFERA_ADDRESS;
  return write_settings({ address });
}

function has_chosen_an_address() {
  return Boolean(process.env.ALFERA_ADDRESS || read_settings().address);
}

// A person who used the app before it asked where Alfera is has open tabs and no saved address.
// They were on Alfera Cloud. That is written down once, when the app starts, so they are not
// asked. Nothing else may make an address out of tabs: the app writes no tab before a choice.
function keep_alfera_cloud_for_a_person_from_before() {
  const settings = read_settings();
  if (!settings.address && settings.tabs?.length) write_settings({ address: default_address });
}

function parse_web_address(text) {
  try {
    const url = new URL(String(text).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

module.exports = {
  default_address,
  read_settings,
  write_settings,
  read_address,
  choose_address,
  has_chosen_an_address,
  keep_alfera_cloud_for_a_person_from_before,
  parse_web_address,
};
