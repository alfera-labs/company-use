const electron = require('electron');

function runs_as_a_packaged_app(electron_module = electron) {
  return typeof electron_module === 'object' && electron_module.app?.isPackaged === true;
}

function read_address_a_test_may_change(name, real_address, { environment = process.env, packaged = runs_as_a_packaged_app() } = {}) {
  return (!packaged && environment[name]) || real_address;
}

module.exports = { read_address_a_test_may_change, runs_as_a_packaged_app };
