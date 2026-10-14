const http = require('node:http');

const aws_console_link = 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review';
const setup_token = 'stand-in-setup-token-0000000001';

function deploy_page_html(new_server_address) {
  const setup_page = `${new_server_address}/setup#token=${setup_token}`;
  return `<!doctype html><title>Get your own Alfera</title>
<a id="aws" href="${aws_console_link}" target="_blank" rel="noopener">Open AWS</a>
<button id="open" onclick='location.assign(${JSON.stringify(setup_page)})'>Open my server</button>`;
}

function start_stand_in_deploy_page(new_server_address) {
  const server = http.createServer((request, response) => {
    const is_the_deploy_page = new URL(request.url, 'http://127.0.0.1').pathname === '/deploy';
    response.writeHead(is_the_deploy_page ? 200 : 404, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end(is_the_deploy_page ? deploy_page_html(new_server_address) : '');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, address: `http://127.0.0.1:${server.address().port}/deploy` }));
  });
}

module.exports = { aws_console_link, setup_token, start_stand_in_deploy_page };
