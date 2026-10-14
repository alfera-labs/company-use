const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_deploy_page_address, read_new_server_choice, stays_in_the_deploy_page } = require('../src/setup/deploy_page.cjs');

const deploy_page = 'https://app.alfera.ai/deploy';
const new_server = 'https://acme-203-0-113-7.sslip.io';
const setup_page = `${new_server}/setup#token=a-setup-token`;

test('the deploy page is the one of Alfera Cloud, and a run from source can point it at a stand-in', () => {
  assert.equal(read_deploy_page_address({}), deploy_page);
  assert.equal(read_deploy_page_address({ ALFERA_DEPLOY_PAGE_ADDRESS: 'http://127.0.0.1:4999/deploy' }), 'http://127.0.0.1:4999/deploy');
});

test('the deploy page, its DigitalOcean sign-in and the way back stay in the window', () => {
  for (const target of [
    `${deploy_page}?code=a-code&state=a-state`,
    'https://cloud.digitalocean.com/v1/oauth/authorize?client_id=x',
    'https://cloud.digitalocean.com/login',
    'https://digitalocean.com/',
    'https://accounts.google.com/o/oauth2/auth',
    'https://github.com/login/oauth/authorize',
  ]) {
    assert.equal(stays_in_the_deploy_page(target, deploy_page), true, target);
  }
});

test('every other page leaves the window, the AWS console too', () => {
  for (const target of [
    'https://us-east-1.console.aws.amazon.com/cloudformation/home',
    'https://notdigitalocean.com/',
    'https://digitalocean.com.example.com/',
    setup_page,
    'mailto:someone@example.com',
    'not an address',
  ]) {
    assert.equal(stays_in_the_deploy_page(target, deploy_page), false, target);
  }
});

test('the setup page of the new server, opened from the deploy page, is the new address', () => {
  assert.deepEqual(read_new_server_choice(setup_page, deploy_page, deploy_page), {
    address: new_server,
    first_page: setup_page,
  });
});

test('only the deploy page can choose the new server, and only with the setup page of an https server', () => {
  assert.equal(read_new_server_choice(setup_page, 'https://cloud.digitalocean.com/login', deploy_page), null);
  assert.equal(read_new_server_choice(setup_page, '', deploy_page), null);
  assert.equal(read_new_server_choice(`${new_server}/setup`, deploy_page, deploy_page), null);
  assert.equal(read_new_server_choice(`${new_server}/home#token=x`, deploy_page, deploy_page), null);
  assert.equal(read_new_server_choice('http://203.0.113.7/setup#token=x', deploy_page, deploy_page), null);
});
