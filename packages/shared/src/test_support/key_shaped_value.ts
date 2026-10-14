const key_prefixes = {
  openai_project: 'sk-proj-',
  anthropic: 'sk-ant-api03-',
  stripe_live: ['sk', 'live', ''].join('_'),
  slack_bot: 'xoxb-',
  aws_access_key_id: 'AKIA',
  github_personal: 'ghp_',
} as const;

export type KeyShape = keyof typeof key_prefixes;

export function key_shaped_value(shape: KeyShape, body: string): string {
  return `${key_prefixes[shape]}${body}`;
}

export function private_key_block(label: string, body: string): string {
  const dashes = '-'.repeat(5);
  return `${dashes}BEGIN ${label}${dashes}\n${body}\n${dashes}END ${label}${dashes}`;
}

export function web_token_shaped_value(claims: Record<string, unknown>, signature: string): string {
  const encode = (part: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(part)).toString('base64url');
  return [encode({ alg: 'RS256', typ: 'JWT' }), encode(claims), signature].join('.');
}
