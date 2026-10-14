const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse_server_address } = require('../src/setup/server_address.cjs');

test('four numbers with dots are an address, and get a name that points at them', () => {
  assert.deepEqual(parse_server_address(' 203.0.113.7 '), {
    host: '203.0.113.7',
    https_name: '203-0-113-7.sslip.io',
  });
});

test('a name is an address, and is its own name', () => {
  assert.deepEqual(parse_server_address('Alfera.Example.com'), {
    host: 'alfera.example.com',
    https_name: 'alfera.example.com',
  });
});

test('anything that could change the command is refused', () => {
  const refused = [
    '',
    'server',
    '203.0.113.999',
    '203.0.113',
    'root@203.0.113.7',
    '203.0.113.7:22',
    'https://203.0.113.7',
    '203.0.113.7 -oProxyCommand=id',
    '-oProxyCommand=id',
    '203.0.113.7;id',
    '$(id).example.com',
    '`id`.example.com',
    'a b.example.com',
    'alfera.example.com/path',
    '2001:db8::1',
    'alfera_.example.com',
    '-alfera.example.com',
  ];
  for (const text of refused) assert.equal(parse_server_address(text), null, text);
});
