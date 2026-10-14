import { DeployStopped } from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import type { DeploySession } from '@coworker/ui/lib/company_use_deploy/deploy_session';
import { test_resource_prefix } from '@coworker/ui/lib/company_use_deploy/test_overrides';
import { z } from 'zod';

const api_address = 'https://api.digitalocean.com';
const droplet_size = 's-2vcpu-4gb';
const droplet_image = 'ubuntu-24-04-x64';
const most_characters_of_a_refusal = 200;

const regions_by_part_of_the_world: Record<string, string[]> = {
  Europe: ['fra1', 'ams3', 'lon1'],
  Africa: ['fra1', 'ams3', 'lon1'],
  America: ['nyc3', 'tor1', 'sfo3'],
  Asia: ['sgp1', 'blr1', 'syd1'],
  Australia: ['syd1', 'sgp1'],
};

const regions_answer_schema = z.object({
  regions: z.array(
    z.object({ slug: z.string(), available: z.boolean(), sizes: z.array(z.string()) }),
  ),
});
const droplet_schema = z.object({ id: z.number(), status: z.string() });
const droplets_answer_schema = z.object({ droplets: z.array(droplet_schema) });
const new_droplet_answer_schema = z.object({ droplet: droplet_schema });
const refusal_schema = z.object({ message: z.string().optional() });

type Regions = z.infer<typeof regions_answer_schema>['regions'];

export const install_tag_of = (install_id: string) => `alfera-install-${install_id}`;

export function pick_region(regions: Regions, time_zone: string) {
  const usable = regions
    .filter((region) => region.available && region.sizes.includes(droplet_size))
    .map((region) => region.slug);
  const nearest = regions_by_part_of_the_world[time_zone.split('/')[0] ?? ''] ?? [];
  const region = nearest.find((slug) => usable.includes(slug)) ?? usable[0];
  if (!region) throw new DeployStopped('no_region');
  return region;
}

function create_api_call(token: string) {
  return async (method: string, path: string, body?: object) => {
    const answer = await fetch(`${api_address}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch((error: unknown) => {
      console.warn('[company-use-deploy] DigitalOcean is not reachable', error);
      throw new DeployStopped('digitalocean_not_reachable');
    });
    const is_gone = method === 'DELETE' && answer.status === 404;
    if (answer.status === 204 || is_gone) return {};
    const json: unknown = await answer.json().catch(() => ({}));
    if (answer.ok) return json;
    const words = refusal_schema
      .safeParse(json)
      .data?.message?.slice(0, most_characters_of_a_refusal);
    throw new DeployStopped('digitalocean_refused', words ?? `code ${answer.status}`);
  };
}

function droplet_request(session: DeploySession, region: string, user_data: string) {
  const is_test = session.test_overrides !== null;
  const base_name = session.name ? `alfera-${session.name}` : 'alfera';
  const tags = [
    'alfera',
    install_tag_of(session.install_id),
    ...(is_test ? [test_resource_prefix] : []),
  ];
  return {
    name: is_test ? `${test_resource_prefix}-${session.name || 'server'}` : base_name,
    region,
    size: droplet_size,
    image: droplet_image,
    backups: session.backups,
    ...(session.backups ? { backup_policy: { plan: 'weekly' } } : {}),
    ipv6: false,
    monitoring: false,
    tags,
    user_data,
  };
}

export async function find_or_make_droplet(
  token: string,
  session: DeploySession,
  user_data: string,
) {
  const call = create_api_call(token);
  const tag = install_tag_of(session.install_id);
  const made_before = droplets_answer_schema.parse(
    await call('GET', `/v2/droplets?tag_name=${tag}`),
  );
  const usable = made_before.droplets.find((droplet) => ['new', 'active'].includes(droplet.status));
  if (usable) return usable.id;
  const { regions } = regions_answer_schema.parse(await call('GET', '/v2/regions?per_page=200'));
  const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const body = droplet_request(session, pick_region(regions, time_zone), user_data);
  return new_droplet_answer_schema.parse(await call('POST', '/v2/droplets', body)).droplet.id;
}

export async function delete_droplets_of_install(token: string, install_id: string) {
  await create_api_call(token)('DELETE', `/v2/droplets?tag_name=${install_tag_of(install_id)}`);
}
