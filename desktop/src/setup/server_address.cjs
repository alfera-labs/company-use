// What a provider shows for a server: four numbers with dots, or a name. The value goes into
// the arguments of ssh and into a command the server runs, so nothing else is let through:
// no user name, no port, no space, no leading dash.
const ipv4_address = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const host_name =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Returns the host to connect to and the name the server gets its certificate for. A server
// known only by its numbers gets a name that points at those numbers.
function parse_server_address(text) {
  const host = String(text).trim().toLowerCase();
  if (ipv4_address.test(host)) return { host, https_name: `${host.replaceAll('.', '-')}.sslip.io` };
  if (host_name.test(host)) return { host, https_name: host };
  return null;
}

module.exports = { parse_server_address };
