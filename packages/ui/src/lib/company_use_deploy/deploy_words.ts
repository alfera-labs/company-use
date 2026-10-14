export const cloud_names = ['digitalocean', 'aws'] as const;
export type CloudName = (typeof cloud_names)[number];

export const cloud_words: Record<CloudName, { label: string; note: string; cost: string }> = {
  digitalocean: {
    label: 'DigitalOcean',
    note: 'You press Authorize. This page does the rest.',
    cost: 'About $24 a month, paid to DigitalOcean.',
  },
  aws: {
    label: 'AWS',
    note: 'You sign in to AWS and press Create stack.',
    cost: 'About $34 to $41 a month, paid to AWS. The price depends on the region.',
  },
};

export const choose_words = {
  title: 'Get your own Alfera',
  lead: 'Alfera runs on a server in your own cloud account. You keep your data and pay the cloud directly.',
  recommended: 'Recommended',
  not_available: 'Not available on this page yet.',
  none_available: 'This page cannot make a server yet, because no cloud is set up.',
  name_label: 'Name in your address',
  name_optional: 'Optional',
  name_rule: 'Use 1 to 20 lowercase letters or numbers.',
  address_lead: 'Your address will look like',
  address_of: (name: string) => `${name || 'acme'}-203-0-113-7.sslip.io`,
  backups: 'Weekly backups, about $4.80 a month',
  start: 'Start',
  privacy:
    'During setup, your server sends this page only its progress and its address. We delete them after 7 days.',
};

export const open_aws_words = {
  title: 'Create your server on AWS',
  lead: 'AWS opens in a new tab. Sign in, press Create stack, then come back to this tab.',
  button: 'Open AWS',
  again: 'Open AWS again',
};

export const leaving_words = {
  title: 'Opening DigitalOcean',
  lead: 'Sign in to DigitalOcean and press Authorize. You come back here after that.',
};

export const making_words = {
  title: 'Making your server',
  lead: 'This takes about 10 minutes. You can close this tab and come back.',
  opening: 'Your server is ready. Opening it now.',
};

export const opened_words = {
  title: 'Your server is ready',
  lead: 'Open it to connect your AI and make your account.',
  button: 'Open your server',
};

export const progress_row_titles = {
  server: 'Make the server',
  prepare: 'Prepare the server',
  download: 'Download Alfera',
  start: 'Start Alfera',
  secure: 'Get a secure address',
} as const;

export const problem_title = 'We could not finish your server';

export const action_words = {
  try_again: 'Try again',
  delete_and_start_again: 'Delete this server and start again',
  start_again: 'Start again',
} as const;
export type ProblemAction = keyof typeof action_words;
