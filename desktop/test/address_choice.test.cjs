const assert = require('node:assert/strict');
const http = require('node:http');
const { after, test } = require('node:test');
const { find_address_problem, parse_address_choice } = require('../src/setup/address_choice.cjs');

const servers = [];
after(() => servers.forEach((server) => server.close()));

// A real server on this machine that gives one answer to every request.
async function start_server(status, content_type, body) {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { 'content-type': content_type });
    response.end(body);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('an address, or a page on it, gives the install and the first page to open', () => {
  assert.deepEqual(parse_address_choice(' https://alfera.example.com '), {
    address: 'https://alfera.example.com',
    first_page: 'https://alfera.example.com/',
  });
  assert.deepEqual(parse_address_choice('http://localhost:3000/join/a-sign-in-link'), {
    address: 'http://localhost:3000',
    first_page: 'http://localhost:3000/join/a-sign-in-link',
  });
  assert.equal(parse_address_choice(''), null);
});

test('an address typed with no https:// in front gets it', () => {
  assert.deepEqual(parse_address_choice('alfera.example.com'), {
    address: 'https://alfera.example.com',
    first_page: 'https://alfera.example.com/',
  });
  assert.deepEqual(parse_address_choice('alfera.example.com/join/a-sign-in-link'), {
    address: 'https://alfera.example.com',
    first_page: 'https://alfera.example.com/join/a-sign-in-link',
  });
  assert.equal(parse_address_choice('localhost:3000').address, 'https://localhost:3000');
});

test('text that is not an address of a web server is not made into one', () => {
  for (const text of ['hello world', 'mailto:someone@example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'someone@example.com']) {
    assert.equal(parse_address_choice(text), null, text);
  }
});

test('an install passes when it is healthy and when it asks for a sign-in first', async () => {
  const open_install = await start_server(200, 'application/json', '{"data":{"status":"ok"}}');
  const install_with_sign_in = await start_server(
    401,
    'application/json',
    '{"error":{"code":"unauthorized","message":"Sign in to use the API"}}',
  );
  assert.equal(await find_address_problem(open_install, fetch), null);
  assert.equal(await find_address_problem(install_with_sign_in, fetch), null);
});

test('a site that is not Alfera is named as that', async () => {
  const web_page = await start_server(404, 'text/html', '<h1>Not found</h1>');
  const other_json = await start_server(200, 'application/json', '{"status":"ok"}');
  assert.match(await find_address_problem(web_page, fetch), /answers, but not like an Alfera server/);
  assert.match(await find_address_problem(other_json, fetch), /answers, but not like an Alfera server/);
});

test('an address where nothing listens is named as that', async () => {
  const closed = await start_server(200, 'text/plain', '');
  servers.pop().close();
  assert.match(await find_address_problem(closed, fetch), /^Nothing answers at 127\.0\.0\.1:\d+,/);
});
