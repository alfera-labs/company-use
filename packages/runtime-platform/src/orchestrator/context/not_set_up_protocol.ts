import { env } from '@coworker/config';
import {
  alfera_cloud_sign_up_url,
  connect_your_apps_guide_url,
} from '@coworker/config/hosted_defaults';
import { composio_is_configured } from '@runtime-platform/composio/composio_client';

const outside_services = [
  {
    name: 'apps from the app catalogue',
    add_command: './alfera add apps',
    is_set_up: () => composio_is_configured(),
  },
  {
    name: 'automations that start on an app event',
    add_command: './alfera add triggers',
    is_set_up: () => Boolean(env.COMPOSIO_WEBHOOK_SECRET),
  },
  {
    name: 'Slack',
    add_command: './alfera add slack',
    is_set_up: () => Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
  },
  {
    name: 'email',
    add_command: './alfera add email',
    is_set_up: () => Boolean(env.RESEND_API_KEY),
  },
  {
    name: 'web search',
    add_command: './alfera add search',
    is_set_up: () =>
      Boolean(
        env.TAVILY_API_KEY || env.BRAVE_SEARCH_API_KEY || env.FIRECRAWL_API_KEY || env.JINA_API_KEY,
      ),
  },
];

export type ServiceNotSetUp = { name: string; add_command: string };

export function list_services_not_set_up(): ServiceNotSetUp[] {
  return outside_services
    .filter((service) => !service.is_set_up())
    .map(({ name, add_command }) => ({ name, add_command }));
}

/** Tells the model which outside services this install lacks, and the one sentence to answer with. */
export function build_not_set_up_protocol(not_set_up: readonly ServiceNotSetUp[]): string | null {
  if (not_set_up.length === 0) return null;
  const services = not_set_up
    .map((service) => `${service.name} (${service.add_command})`)
    .join(', ');
  return [
    '## Not Set Up On This Install',
    `This is a self-hosted install. It has not set up: ${services}.`,
    `When a task needs one of them, do not try it and send no connect link. Answer in one plain sentence: what is missing, and the two ways to get it, their own key (that command, guide: ${connect_your_apps_guide_url}) or Alfera Cloud (${alfera_cloud_sign_up_url}). Say it once, then do the part of the task that needs none of them.`,
  ].join('\n');
}
