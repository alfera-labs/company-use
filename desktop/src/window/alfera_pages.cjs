const { open_outside_the_app } = require('../invisible_run.cjs');
const { read_address, parse_web_address } = require('../settings.cjs');

// Sign-in leaves the app for these hosts and comes back. Every other outside link opens in the
// person's own browser, so the window never becomes a general web browser.
const sign_in_hosts = ['api.workos.com', 'accounts.google.com', 'slack.com'];
const sign_in_host_suffixes = ['.workos.com', '.authkit.app', '.slack.com'];

function is_on_alfera(target) {
  const host = parse_web_address(target)?.host;
  return Boolean(host) && host === parse_web_address(read_address())?.host;
}

function stays_in_the_app(target) {
  const url = parse_web_address(target);
  if (!url) return false;
  if (is_on_alfera(target) || sign_in_hosts.includes(url.hostname)) return true;
  return sign_in_host_suffixes.some((suffix) => url.hostname.endsWith(suffix));
}

// Web links go to the person's browser. A link that starts a message, a mail or a call goes to
// the Mac app that owns it. Anything else is dropped.
const schemes_the_mac_opens = ['mailto:', 'sms:', 'tel:'];

function open_in_the_browser_or_its_mac_app(target) {
  const is_for_a_mac_app = schemes_the_mac_opens.some((scheme) =>
    String(target).startsWith(scheme),
  );
  if (parse_web_address(target) || is_for_a_mac_app) open_outside_the_app(target);
}

function keep_outside_links_out(contents, open_in_a_new_tab) {
  contents.on('will-navigate', (event, target) => {
    if (stays_in_the_app(target)) return;
    event.preventDefault();
    open_in_the_browser_or_its_mac_app(target);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (is_on_alfera(url)) open_in_a_new_tab(url);
    else open_in_the_browser_or_its_mac_app(url);
    return { action: 'deny' };
  });
}

module.exports = {
  keep_outside_links_out,
  is_on_alfera,
  stays_in_the_app,
};
