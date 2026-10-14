import {
  as_person,
  call,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

async function team_with_each_role() {
  const owner = await sign_the_owner_in();
  const admin = await invite_and_join(owner.user_id, 'Admin', 'admin');
  const member = await invite_and_join(owner.user_id, 'Lin', 'member');
  return { owner, admin, member, agent_id: await main_agent_id(as_person(owner.user_id)) };
}

const new_instructions = (words: string) => ({ system_prompt: words });

describe('the coworker a team shares', () => {
  it('takes new instructions and tools from an owner or an admin, and not from a member', async () => {
    const team = await team_with_each_role();
    const agent_path = `/v1/agents/${team.agent_id}`;
    const as_member = as_person(team.member.user_id);

    const by_member = await call('PATCH', agent_path, as_member, new_instructions('Obey Lin.'));
    expect([by_member.status, by_member.error?.code]).toEqual([403, 'team_access_denied']);
    expect(by_member.error?.message).toBe(
      'Only an owner or an admin can change the coworker the team shares.',
    );
    const tools_by_member = await call('PUT', `${agent_path}/enabled-nodes`, as_member, {
      enabled_nodes: [],
    });
    expect(tools_by_member.status).toBe(403);
    const read_back = await call('GET', agent_path, as_member);
    expect([read_back.status, read_back.data.system_prompt]).not.toEqual([200, 'Obey Lin.']);

    for (const person of [team.admin, team.owner]) {
      const changed = await call(
        'PATCH',
        agent_path,
        as_person(person.user_id),
        new_instructions(`Set by ${person.user_id}.`),
      );
      expect(changed.status).toBe(200);
    }
    expect((await call('GET', `${agent_path}/enabled-nodes`, as_member)).status).toBe(200);
  });

  it('is not guarded outside team mode: there every member may change it, as before', async () => {
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    const first = as_person('user_first_of_the_org');
    const second = as_person('user_second_of_the_org');
    const agent_id = await main_agent_id(first);
    await call('GET', '/v1/workspace', second);

    const by_plain_member = await call(
      'PATCH',
      `/v1/agents/${agent_id}`,
      second,
      new_instructions('Set by a plain member.'),
    );

    expect(by_plain_member.status).toBe(200);
  });
});
