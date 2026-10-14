const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_address_a_test_may_change, runs_as_a_packaged_app } = require('../src/setup/address_a_test_may_change.cjs');

const name = 'ALFERA_DIGITALOCEAN_API_ADDRESS';
const real = 'https://api.digitalocean.com';
const environment = { [name]: 'http://127.0.0.1:4999' };

test('an app run from source sends the calls where a test says', () => {
  assert.equal(read_address_a_test_may_change(name, real, { environment, packaged: false }), 'http://127.0.0.1:4999');
  assert.equal(read_address_a_test_may_change(name, real, { environment: {}, packaged: false }), real);
});

test('a packaged app always uses the real address', () => {
  assert.equal(read_address_a_test_may_change(name, real, { environment, packaged: true }), real);
  assert.equal(runs_as_a_packaged_app({ app: { isPackaged: true } }), true);
  assert.equal(runs_as_a_packaged_app({ app: { isPackaged: false } }), false);
  assert.equal(runs_as_a_packaged_app('/path/to/electron'), false);
});
