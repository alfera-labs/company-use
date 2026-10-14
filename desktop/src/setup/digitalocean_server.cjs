const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { read_address_a_test_may_change } = require('./address_a_test_may_change.cjs');

const default_api_address = 'https://api.digitalocean.com';
const image = 'ubuntu-24-04-x64';
const seconds_between_looks = 5;
const most_seconds_to_wait_for_an_address = 300;
const most_characters_of_a_refusal = 200;

const regions_by_part_of_the_world = {
  Europe: ['fra1', 'ams3', 'lon1'],
  Africa: ['fra1', 'ams3', 'lon1'],
  America: ['nyc3', 'tor1', 'sfo3'],
  Asia: ['sgp1', 'blr1', 'syd1'],
  Australia: ['syd1', 'sgp1'],
};

class DigitalOceanRefused extends Error {
  constructor(reason, { status = null, words = '' } = {}) {
    super(words || reason);
    this.reason = reason;
    this.status = status;
    this.words = words;
  }
}

const read_api_address = () => read_address_a_test_may_change('ALFERA_DIGITALOCEAN_API_ADDRESS', default_api_address);

function fingerprint_of(public_key) {
  const key_bytes = Buffer.from(public_key.trim().split(/\s+/)[1], 'base64');
  return crypto.createHash('md5').update(key_bytes).digest('hex').match(/../g).join(':');
}

const tag_of = (fingerprint) => `alfera-app-${fingerprint.replaceAll(':', '').slice(0, 12)}`;

function pick_region(regions, size, time_zone) {
  const usable = regions.filter((region) => region.available && region.sizes.includes(size)).map((region) => region.slug);
  const nearest = regions_by_part_of_the_world[time_zone.split('/')[0]] ?? [];
  const region = nearest.find((slug) => usable.includes(slug)) ?? usable[0];
  if (!region) throw new DigitalOceanRefused('no_region');
  return region;
}

function create_api_call({ api_address, token, signal }) {
  return async (method, path, body) => {
    const answer = await fetch(`${api_address}${path}`, {
      method,
      signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).catch((error) => {
      if (signal?.aborted) throw error;
      throw new DigitalOceanRefused('not_reachable');
    });
    const json = await answer.json().catch(() => ({}));
    if (answer.ok) return json;
    const words = String(json.message ?? '').slice(0, most_characters_of_a_refusal);
    throw new DigitalOceanRefused('refused', { status: answer.status, words });
  };
}

const public_address_of = (droplet) =>
  droplet.networks?.v4?.find((network) => network.type === 'public')?.ip_address ?? null;

async function add_the_key(call, public_key) {
  await call('POST', '/v2/account/keys', { name: 'Alfera app', public_key }).catch((error) => {
    if (error.status !== 422) throw error;
  });
}

const can_be_used_again = (droplet, size, addresses_given_up) =>
  droplet.size_slug === size &&
  ['new', 'active'].includes(droplet.status) &&
  !addresses_given_up.includes(public_address_of(droplet));

async function find_or_make_droplet({ call, public_key, size, time_zone, addresses_given_up }) {
  const fingerprint = fingerprint_of(public_key);
  const tag = tag_of(fingerprint);
  const { droplets } = await call('GET', `/v2/droplets?tag_name=${tag}`);
  const made_before = droplets.find((droplet) => can_be_used_again(droplet, size, addresses_given_up));
  if (made_before) return made_before;
  await add_the_key(call, public_key);
  const { regions } = await call('GET', '/v2/regions?per_page=200');
  const region = pick_region(regions, size, time_zone);
  const body = { name: 'alfera', region, size, image, ssh_keys: [fingerprint], tags: ['alfera', tag] };
  return (await call('POST', '/v2/droplets', body)).droplet;
}

async function wait_for_the_address({ call, droplet, signal }) {
  const ends_at = Date.now() + most_seconds_to_wait_for_an_address * 1000;
  let current = droplet;
  while (!(current.status === 'active' && public_address_of(current))) {
    if (Date.now() > ends_at) throw new DigitalOceanRefused('no_address');
    await wait(seconds_between_looks * 1000, undefined, { signal });
    current = (await call('GET', `/v2/droplets/${droplet.id}`)).droplet;
  }
  return public_address_of(current);
}

async function make_digitalocean_server({ token, public_key, size, addresses_given_up = [], signal, api_address = read_api_address() }) {
  const call = create_api_call({ api_address, token, signal });
  const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const droplet = await find_or_make_droplet({ call, public_key, size, time_zone, addresses_given_up });
  return wait_for_the_address({ call, droplet, signal });
}

module.exports = { make_digitalocean_server, fingerprint_of, tag_of, pick_region, DigitalOceanRefused, image };
