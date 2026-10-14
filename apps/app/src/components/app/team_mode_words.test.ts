import { describe, expect, it } from 'vitest';
import {
  removal_summary_words,
  sign_in_link_address,
  where_people_open_it_words,
} from '@/components/app/team_mode_words';

const nothing_else = {
  user_id: 'user_2',
  api_keys_revoked: 0,
  scheduled_tasks_switched_off: [],
  waiting_messages_cleared: 0,
  runs_stopped: 0,
  connections: [],
};

describe('the words of the team page', () => {
  it('counts one thing as one thing and two things as two things', () => {
    const one = removal_summary_words('Lin', {
      ...nothing_else,
      api_keys_revoked: 1,
      scheduled_tasks_switched_off: ['Daily report'],
      waiting_messages_cleared: 1,
      runs_stopped: 1,
    });
    expect(one).toBe(
      'Lin is removed and signed out. Also: 1 API key revoked; 1 scheduled task switched off (Daily report); 1 waiting message taken back; 1 running chat stopped.',
    );
    const two = removal_summary_words('Lin', {
      ...nothing_else,
      api_keys_revoked: 2,
      scheduled_tasks_switched_off: ['A', 'B'],
      runs_stopped: 2,
    });
    expect(two).toContain(
      '2 API keys revoked; 2 scheduled tasks switched off (A, B); 2 running chats',
    );
    expect(`${one}${two}`).not.toContain('(s)');
  });

  it('makes a link for the address the install was set up with, not the one the page is open at', () => {
    const open_at = {
      address: 'http://192.168.1.20:3000',
      who_can_open: 'other_machines' as const,
    };
    expect(sign_in_link_address(open_at, 'the_token')).toBe(
      'http://192.168.1.20:3000/join/the_token',
    );
  });

  it('says where people open the install, and whether another machine can', () => {
    const on_a_network = where_people_open_it_words({
      address: 'http://192.168.1.20:3000',
      who_can_open: 'other_machines',
    });
    expect(on_a_network).toContain('People open this Alfera at http://192.168.1.20:3000');
    expect(on_a_network).not.toContain('Only this machine');

    const this_machine = where_people_open_it_words({
      address: 'http://localhost:3360',
      who_can_open: 'this_machine_only',
    });
    expect(this_machine).toContain('Only this machine can open this Alfera now');
    expect(this_machine).toContain('./alfera add team');
    expect(this_machine).not.toContain('Other machines');

    const behind_a_proxy = where_people_open_it_words({
      address: 'https://alfera.example.com',
      who_can_open: 'through_a_proxy_on_this_machine',
    });
    expect(behind_a_proxy).toContain('a proxy or a tunnel on this machine');
  });
});
