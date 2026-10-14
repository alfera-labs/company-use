import { type PolicyScopeIds, resolve_policy_mode } from '@coworker/core/access/policy_modes';
import {
  build_tool_policy_resources,
  built_in_policy_rules,
} from '@coworker/core/access/tool_policy_resources';
import { describe, expect, it } from 'vitest';

const scopes: PolicyScopeIds = {
  workspace: ['ws_1'],
  connection: ['conn_1'],
  project: ['proj_1'],
  agent: ['agt_1'],
  user: ['user_1'],
};

describe('policy precedence', () => {
  it('defaults to allow when no rule applies', () => {
    expect(resolve_policy_mode({ rules: [], resources: node_resources(), scopes })).toBe('allow');
  });

  it('takes the strictest mode across all five scopes', () => {
    const rules = [
      rule('workspace', 'ws_1', 'node', 'gmail-send_email-1', 'allow'),
      rule('connection', 'conn_1', 'node', 'gmail-send_email-1', 'ask'),
      rule('project', 'proj_1', 'node', 'gmail-send_email-1', 'allow'),
      rule('agent', 'agt_1', 'node', 'gmail-send_email-1', 'never'),
      rule('user', 'user_1', 'node', 'gmail-send_email-1', 'allow'),
    ];

    expect(resolve_policy_mode({ rules, resources: node_resources(), scopes })).toBe('never');
  });

  it('lets an exact node override a label inside one scope', () => {
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'changes_things', 'never'),
      rule('workspace', 'ws_1', 'node', 'gmail-send_email-1', 'ask'),
    ];

    expect(resolve_policy_mode({ rules, resources: node_resources(), scopes })).toBe('ask');
  });

  it('lets a narrower label override a broad label inside one scope', () => {
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'every_tool', 'never'),
      rule('workspace', 'ws_1', 'node_label', 'emails_outsiders', 'ask'),
    ];
    const resources = build_tool_policy_resources({
      node_key: 'gmail-send_email-1',
      approval_policy: { mode: 'manual_review' },
      metadata: {},
    });

    expect(resolve_policy_mode({ rules, resources, scopes })).toBe('ask');
  });
});

describe('tool policy labels', () => {
  it('labels real email actions without labelling nearby reads or drafts', () => {
    expect(resource_ids('gmail-send_email-1', 'manual_review')).toContain('emails_outsiders');
    expect(resource_ids('gmail-draft_email-1', 'manual_review')).not.toContain('emails_outsiders');
    expect(resource_ids('slack-send_message-1', 'manual_review')).not.toContain('emails_outsiders');
  });

  it('uses an explicit change label when the legacy approval gate is disabled', () => {
    const resources = build_tool_policy_resources({
      node_key: 'slack-send_message-1',
      approval_policy: { mode: 'none' },
      metadata: { policy_labels: ['changes_things'] },
    });

    expect(resources.map((resource) => resource.resource_id)).toContain('changes_things');
  });

  it('does not apply action policy to an exempt transport tool', () => {
    expect(
      build_tool_policy_resources({
        node_key: 'runtime-execute_tool-1',
        approval_policy: { mode: 'none' },
        metadata: { policy_exempt: true },
      }),
    ).toEqual([]);
  });
});

describe('a permission about one subject of a call', () => {
  const fetch_salons = {
    node_key: 'web-fetch_page-1',
    approval_policy: { mode: 'manual_review' },
    metadata: {},
    tool_input: { url: 'https://www.example-salons.com/saloni/x' },
  };
  const scopes = { workspace: ['ws_1'], connection: [], project: [], agent: [], user: ['user_1'] };

  it("is read from the call's own arguments", () => {
    expect(
      build_tool_policy_resources(fetch_salons).map((resource) => resource.resource_id),
    ).toContain('website:example-salons.com');
  });

  it('answers the rule that asked, in the scope that asked', () => {
    const resources = build_tool_policy_resources(fetch_salons);
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'changes_things', 'ask'),
      rule('workspace', 'ws_1', 'tool_subject', 'website:example-salons.com', 'allow'),
    ];
    expect(resolve_policy_mode({ rules, resources, scopes })).toBe('allow');
  });

  it('does not answer it from a scope that never objected', () => {
    const resources = build_tool_policy_resources(fetch_salons);
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'changes_things', 'ask'),
      rule('user', 'user_1', 'tool_subject', 'website:example-salons.com', 'allow'),
    ];
    expect(resolve_policy_mode({ rules, resources, scopes })).toBe('ask');
  });

  it('leaves every other website still asking', () => {
    const resources = build_tool_policy_resources({
      ...fetch_salons,
      tool_input: { url: 'https://www.example.com/x' },
    });
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'changes_things', 'ask'),
      rule('workspace', 'ws_1', 'tool_subject', 'website:example-salons.com', 'allow'),
    ];
    expect(resolve_policy_mode({ rules, resources, scopes })).toBe('ask');
  });

  it('cannot answer a ban', () => {
    const resources = build_tool_policy_resources(fetch_salons);
    const rules = [
      rule('workspace', 'ws_1', 'node_label', 'changes_things', 'never'),
      rule('workspace', 'ws_1', 'tool_subject', 'website:example-salons.com', 'allow'),
    ];
    expect(resolve_policy_mode({ rules, resources, scopes })).toBe('allow');
  });
});

describe('what asks before any rule exists', () => {
  const no_rules = built_in_policy_rules('ws_1');

  it('asks for outbound mail, and for nothing else', () => {
    expect(resolve_policy_mode({ rules: no_rules, resources: node_resources(), scopes })).toBe(
      'ask',
    );
    expect(
      resolve_policy_mode({
        rules: no_rules,
        resources: build_tool_policy_resources({
          node_key: 'linear-create_issue-1',
          approval_policy: { mode: 'manual_review' },
          metadata: {},
        }),
        scopes,
      }),
    ).toBe('allow');
    expect(
      resolve_policy_mode({
        rules: no_rules,
        resources: build_tool_policy_resources({
          node_key: 'gmail-find_email-1',
          approval_policy: { mode: 'none' },
          metadata: {},
        }),
        scopes,
      }),
    ).toBe('allow');
  });

  it('is silenced by any row a person writes, even the broadest one', () => {
    const always_allow_the_tool = [
      ...no_rules,
      rule('workspace', 'ws_1', 'node', 'gmail-send_email-1', 'allow'),
    ];
    expect(
      resolve_policy_mode({ rules: always_allow_the_tool, resources: node_resources(), scopes }),
    ).toBe('allow');

    const allow_everything = [
      ...no_rules,
      rule('workspace', 'ws_1', 'node_label', 'every_tool', 'allow'),
    ];
    expect(
      resolve_policy_mode({ rules: allow_everything, resources: node_resources(), scopes }),
    ).toBe('allow');
  });
});

function node_resources() {
  return build_tool_policy_resources({
    node_key: 'gmail-send_email-1',
    approval_policy: { mode: 'manual_review' },
    metadata: {},
  });
}

function rule(
  scope_type: string,
  scope_id: string,
  resource_type: string,
  resource_id: string,
  policy_mode: string,
) {
  return { scope_type, scope_id, resource_type, resource_id, policy_mode };
}

function resource_ids(node_key: string, mode: string) {
  return build_tool_policy_resources({
    node_key,
    approval_policy: { mode },
    metadata: {},
  }).map((resource) => resource.resource_id);
}
