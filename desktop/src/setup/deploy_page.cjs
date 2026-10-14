const { default_address, parse_web_address } = require('../settings.cjs');
const { read_address_a_test_may_change } = require('./address_a_test_may_change.cjs');
const { parse_address_choice } = require('./address_choice.cjs');

const cloud_sign_in_domain = 'digitalocean.com';
const hosts_of_a_cloud_sign_in = ['accounts.google.com', 'github.com'];

const read_deploy_page_address = (environment = process.env) =>
  read_address_a_test_may_change('ALFERA_DEPLOY_PAGE_ADDRESS', `${default_address}/deploy`, { environment });

const is_on_the_deploy_page = (url, deploy_page_address) =>
  url?.origin === parse_web_address(deploy_page_address)?.origin;

function stays_in_the_deploy_page(target, deploy_page_address) {
  const url = parse_web_address(target);
  if (!url) return false;
  if (is_on_the_deploy_page(url, deploy_page_address)) return true;
  const host = url.hostname;
  return host === cloud_sign_in_domain || host.endsWith(`.${cloud_sign_in_domain}`) || hosts_of_a_cloud_sign_in.includes(host);
}

function read_new_server_choice(target, address_of_the_page, deploy_page_address) {
  const url = parse_web_address(target);
  if (!url || !is_on_the_deploy_page(parse_web_address(address_of_the_page), deploy_page_address)) return null;
  const is_setup_page_of_a_new_server =
    url.protocol === 'https:' && url.pathname === '/setup' && new URLSearchParams(url.hash.slice(1)).has('token');
  return is_setup_page_of_a_new_server ? parse_address_choice(url.href) : null;
}

module.exports = { read_deploy_page_address, stays_in_the_deploy_page, read_new_server_choice };
