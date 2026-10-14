import { all_api_key_scopes } from '@api/services/api_keys';
import { expect, it } from 'vitest';

it('accepts these scopes at the mint endpoint, and no other', () => {
  expect([...all_api_key_scopes].sort()).toEqual([
    'agents.read',
    'agents.write',
    'automations.read',
    'automations.write',
    'chat.completions',
    'integrations.read',
    'projects.read',
    'sessions.read',
    'sessions.write',
    'skills.read',
    'workspace.read',
    'workspace.write',
  ]);
});
