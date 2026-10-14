import {
  classify_slack_thread_audience,
  type SlackThreadAudienceInput,
} from '@runtime-platform/channels/slack/thread_audience';
import { describe, expect, it } from 'vitest';

describe('Slack thread audience', () => {
  it.each([
    ['hey Otto', 'other'],
    ['alfera do not speak please', 'other'],
    ['alfera continue the import', 'agent'],
    ['what do you think, Otto?', 'other'],
    ['what do you think about Alfera, Otto?', 'other'],
    ['We already have Attio bro, import it in', 'agent'],
    ['can you finish the report?', 'agent'],
    ['what do you think?', 'agent'],
    ['my g', 'agent'],
    ['bro why dont you answer me', 'agent'],
  ] as const)('routes an existing thread locally: %s', (text, audience) => {
    expect(classify_slack_thread_audience(input_for(text))).toBe(audience);
  });
});

function input_for(text: string): SlackThreadAudienceInput {
  return {
    stored_messages: [
      {
        message_role: 'user',
        source_metadata: {
          source_actor: {
            source_actor_id: 'slack:T:U',
            actor_kind: 'external_user',
            external_ids: [
              { provider_key: 'slack', external_account_id: 'T', external_user_id: 'U' },
            ],
            profile: { display_name: 'Otto Park' },
          },
        },
        is_user_visible: true,
      },
    ],
    prior_messages: [],
    message: {
      team_id: 'T',
      channel_id: 'C',
      channel_type: 'channel',
      event_ts: '2',
      thread_ts: '1',
      user_id: 'U',
      user_profile: { display_name: 'Robin' },
      text,
    },
  };
}
