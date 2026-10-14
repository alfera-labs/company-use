import {
  type Bigco,
  build_bigco,
  connection_ids,
  type Department,
  departments,
} from '@api/routes/__tests__/connection_audience_bigco';
import { check_resource_use } from '@coworker/core/access/check_resource_use';
import type { Participants } from '@coworker/core/access/may_use_resource';
import { beforeAll, describe, expect, it } from 'vitest';

const { github, gmail_hr, notion, stripe, gmail_second, personal_gmail } = connection_ids;

let org: Bigco;

beforeAll(async () => {
  org = await build_bigco();
}, 240_000);

function ask(connection_id: string, participants: Participants) {
  return check_resource_use(org.db, {
    workspace_id: org.workspace_id,
    resource_type: 'connection',
    resource_id: connection_id,
    participants,
  });
}

describe('a twenty-person org scopes six connections by department', () => {
  it('gives each department exactly the connections its rooms were ticked for', async () => {
    const expected: Array<[Department, string, boolean]> = [
      ['search', github, true],
      ['cloud', github, true],
      ['ads', github, false],
      ['hr', github, false],
      ['legal', github, false],
      ['hr', gmail_hr, true],
      ['search', gmail_hr, false],
      ['legal', gmail_hr, false],
      ['legal', stripe, true],
      ['ads', stripe, false],
    ];
    for (const [department, connection_id, allowed] of expected) {
      const verdict = await ask(connection_id, org.room_of(department, []));
      expect({ department, connection_id, allowed: verdict.allowed }).toEqual({
        department,
        connection_id,
        allowed,
      });
    }
  });

  it('lets every room reach the two connections nobody restricted', async () => {
    for (const department of departments) {
      expect(await ask(notion, org.room_of(department, []))).toEqual({
        allowed: true,
        grant_level: 'use',
      });
      expect((await ask(gmail_second, org.room_of(department, []))).allowed).toBe(true);
    }
  });

  it('leaks the app while the row stays private, because a second Gmail was never scoped', async () => {
    expect((await ask(gmail_hr, org.room_of('ads', ['ads_1']))).allowed).toBe(false);
    expect((await ask(gmail_second, org.room_of('ads', ['ads_1']))).allowed).toBe(true);
  });

  it('denies a room that holds a person the connection does not name', async () => {
    const alone: Participants = { project: [], agent: [], user: [org.admin.user_id] };
    expect((await ask(personal_gmail, alone)).allowed).toBe(true);

    const with_a_colleague: Participants = {
      project: [],
      agent: [],
      user: [org.admin.user_id, (org.people.eng_1 as { user_id: string }).user_id],
    };
    expect(await ask(personal_gmail, with_a_colleague)).toMatchObject({
      allowed: false,
      denial_reason: 'not_on_the_list',
    });
  });

  it('refuses a department connection to any run that carries no room', async () => {
    const roomless: Participants = {
      project: [],
      agent: ['agt_nightly'],
      user: [(org.people.eng_1 as { user_id: string }).user_id],
    };
    expect(await ask(github, roomless)).toMatchObject({
      allowed: false,
      denial_reason: 'nobody_present_to_check',
      blocked_grantee_type: 'project',
    });
  });

  it('leaves the two roomless floaters with only the unrestricted connections', async () => {
    const floater: Participants = {
      project: [],
      agent: [],
      user: [(org.people.floater_1 as { user_id: string }).user_id],
    };
    expect((await ask(notion, floater)).allowed).toBe(true);
    expect((await ask(github, floater)).allowed).toBe(false);
    expect((await ask(gmail_hr, floater)).allowed).toBe(false);
    expect((await ask(stripe, floater)).allowed).toBe(false);
  });
});
