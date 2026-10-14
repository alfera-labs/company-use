const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { stays_in_the_app } = require('../src/window/alfera_pages.cjs');

before(() => {
  process.env.ALFERA_ADDRESS = 'http://localhost:3000';
});
after(() => delete process.env.ALFERA_ADDRESS);

test('a link to the install the person chose opens in the app', () => {
  assert.equal(stays_in_the_app('http://localhost:3000/join/a-sign-in-link'), true);
  assert.equal(stays_in_the_app('http://localhost:3000/chats/ses_0000000001'), true);
});

test('a link to any other site leaves the app', () => {
  assert.equal(stays_in_the_app('https://example.com/join/a-sign-in-link'), false);
  assert.equal(stays_in_the_app('http://localhost:4000/join/a-sign-in-link'), false);
  assert.equal(stays_in_the_app('mailto:someone@example.com'), false);
});

test('the sign-in pages of the hosted product stay in the app', () => {
  assert.equal(stays_in_the_app('https://accounts.google.com/o/oauth2/auth'), true);
});
