import { native_preferred_app_names } from '@coworker/core/integrations/native_preferred_apps';
import { estimate_context_tokens_roughly } from '@coworker/shared';
import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { document_library_tools } from '@runtime-platform/orchestrator/context/workspace_library_context';
import { get_all_skills } from '@runtime-platform/skills/skill_registry';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { find_workspace_tool } from '@runtime-platform/tools/tool_execution_service';
import { find_tool_by_node_key } from '@runtime-platform/tools/tool_registry';
import { describe, expect, it } from 'vitest';

const channel_names = new RegExp([...native_preferred_app_names, 'email'].join('|'), 'iu');
const slack_reply_protocol_heading = '## Slack Reply Protocol';
const slack_reply_mandate = 'The ONLY way they hear you is the slack-respond-1 tool';

const every_steered_tool = [
  'slack-respond-1',
  'slack-send_message-1',
  'slack-upload_file-1',
  'runtime-execute_tool-1',
  'runtime-run_program-1',
  'runtime-list_connections-1',
  'runtime-read_attachment-1',
  'runtime-search_tools-1',
  'runtime-get_tool_schema-1',
  'runtime-list_tool_field_options-1',
  'runtime-create_connection-1',
  'runtime-load_skill-1',
  ...document_library_tools,
  'workspace-view_image',
  'workspace-run_command',
  'scheduled_tasks-create_scheduled_task-1',
  'scheduled_tasks-list_scheduled_tasks-1',
  'chat-present_choices-1',
];

const every_protocol_heading = [
  '## Ownership Protocol',
  '## Workspace Protocol',
  '## Progress Protocol',
  '## Confidentiality Protocol',
  '## Voice',
  '## Decision Protocol',
  '## Slack Format Protocol',
  '## Tool Failure Protocol',
  '## Catalog Tool Protocol',
  '## Programs Move Data Protocol',
  '## Parallel Tool Calls',
  '## Deliverable Protocol',
  '## Recurring Work Protocol',
  '## Craft Protocol',
  '## Connection Protocol',
  '## Connected Apps Protocol',
  '## API Proxy Protocol',
  '## Live Source Protocol',
  '## Browser Protocol',
  '## Available Skills',
];

const skills_discovery = '<available_skills>\n- operate-the-browser\n</available_skills>';

function dashboard_prompt(allowed_tool_names?: readonly string[]) {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    workspace_root: current_workspace_layout.model_root,
    model: { model_provider: 'anthropic', model_name: 'claude-sonnet-5' },
    current_turn_context: { source_type: 'web_chat', web_chat: { speaker_name: 'Oli' } },
    skills_discovery,
    ...(allowed_tool_names ? { allowed_tool_names } : {}),
  });
}

function slack_prompt(allowed_tool_names?: readonly string[]) {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    workspace_root: current_workspace_layout.model_root,
    model: { model_provider: 'anthropic', model_name: 'claude-sonnet-5' },
    current_turn_context: {
      source_type: 'slack',
      slack: { channel_id: 'C123', thread_ts: '1699999999.000001' },
    },
    skills_discovery,
    ...(allowed_tool_names ? { allowed_tool_names } : {}),
  });
}

function answer_prompt(allowed_tool_names: readonly string[]) {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    model: { model_provider: 'anthropic', model_name: 'claude-sonnet-5' },
    skills_discovery,
    allowed_tool_names,
  });
}

describe('build_system_prompt', () => {
  it('compiles the Workspace Protocol only for a run that has a durable workspace', () => {
    const prompt = dashboard_prompt();

    expect(prompt).toContain('## Workspace Protocol');
    expect(prompt).toContain(`durable folder at ${current_workspace_layout.model_root}`);
    expect(build_system_prompt({ system_instructions: 'You are the agent.' })).not.toContain(
      '## Workspace Protocol',
    );
  });

  it('never names the retired /work root anywhere in the prompt', () => {
    expect(dashboard_prompt()).not.toContain('/work/');
    for (const skill of get_all_skills()) {
      expect(skill.body).not.toContain('/work/');
    }
  });

  it('injects the Slack Reply Protocol as an instruction on a Slack turn', () => {
    const prompt = build_system_prompt({
      system_instructions: 'You are the agent.',
      current_turn_context: {
        source_type: 'slack',
        slack: { channel_id: 'C123', thread_ts: '1699999999.000001' },
      },
    });

    expect(prompt).toContain(slack_reply_protocol_heading);
    expect(prompt).toContain(slack_reply_mandate);
    expect(prompt).toContain('The runtime already decided that the latest message is for you');
    expect(prompt).toContain('do not end silently');
  });

  it('omits the Slack Reply Protocol on a web-chat turn where plain text is delivered', () => {
    const prompt = build_system_prompt({
      system_instructions: 'You are the agent.',
      current_turn_context: { source_type: 'web_chat', web_chat: { speaker_name: 'Oli' } },
    });

    expect(prompt).not.toContain(slack_reply_protocol_heading);
  });

  it('omits the Slack Reply Protocol when there is no turn context', () => {
    expect(build_system_prompt({ system_instructions: 'You are the agent.' })).not.toContain(
      slack_reply_protocol_heading,
    );
  });

  it('keeps requested files mandatory when source data is sparse', () => {
    const prompt = build_system_prompt({ system_instructions: 'You are the agent.' });

    expect(prompt).toContain('Sparse data changes the content, not the requested output format.');
    expect(prompt).toContain('Never create, infer, or upload mock, fake, synthetic');
  });

  it('requires documented API contracts and one selected connection for generic proxies', () => {
    const prompt = build_system_prompt({ system_instructions: 'You are the agent.' });

    expect(prompt).toContain('## API Proxy Protocol');
    expect(prompt).toContain('official API documentation before execution');
    expect(prompt).toContain('Do not repeat the same request across other connected accounts');
    expect(prompt).toContain('finish and verify the source read before any downstream write');
  });

  it('routes catalog node keys through the runtime control plane', () => {
    const prompt = build_system_prompt({ system_instructions: 'You are the agent.' });

    expect(prompt).toContain('## Catalog Tool Protocol');
    expect(prompt).toContain('it is not a callable model tool');
    expect(prompt).toContain('runtime-get_tool_schema-1');
    expect(prompt).toContain('runtime-execute_tool-1');
    expect(prompt).toContain('set output_fields to only what the next step needs');
  });

  it('compiles every section on a dashboard run, which never restricts its tools', () => {
    const prompt = dashboard_prompt();

    for (const heading of every_protocol_heading) expect(prompt).toContain(heading);
    expect(prompt).toBe(dashboard_prompt(every_steered_tool));
  });

  it('compiles every section on a Slack run, including the Slack Reply Protocol', () => {
    const prompt = slack_prompt();

    for (const heading of [...every_protocol_heading, slack_reply_protocol_heading]) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toBe(slack_prompt(every_steered_tool));
  });

  it('names tools that actually exist, so no section is dropped by a typo', () => {
    for (const tool_name of every_steered_tool) {
      expect(find_tool_by_node_key(tool_name) ?? find_workspace_tool(tool_name)).toBeTruthy();
    }
  });

  it('drops every tool-steering protocol on an external answer run that has no tools', () => {
    const prompt = answer_prompt([]);

    expect(prompt).not.toContain('## Connected Apps Protocol');
    expect(prompt).not.toContain('Inspect Current Connections');
    expect(prompt).not.toContain('runtime-list_connections-1');
    expect(prompt).not.toContain('## API Proxy Protocol');
    expect(prompt).not.toContain('_api_proxy');
    expect(prompt).not.toContain('## Catalog Tool Protocol');
    expect(prompt).not.toContain('runtime-execute_tool-1');
    expect(prompt).not.toContain('## Connection Protocol');
    expect(prompt).not.toContain('runtime-create_connection-1');
    expect(prompt).not.toContain('## Tool Failure Protocol');
    expect(prompt).not.toContain('## Slack Format Protocol');
    expect(prompt).not.toContain('## Browser Protocol');
    expect(prompt).not.toContain('## Available Skills');
    expect(prompt).not.toContain('runtime-load_skill-1');
  });

  it('offers a schedule only to a run that could actually create one', () => {
    const with_tools = answer_prompt(['scheduled_tasks-create_scheduled_task-1']);

    expect(with_tools).toContain('## Recurring Work Protocol');
    expect(with_tools).toContain('offer once, at the very end, to run it on a schedule');
    expect(with_tools).toContain('It is an offer, not a question you wait on');
    expect(with_tools).toContain('never open a turn with it');
    expect(with_tools).toContain('self-contained instruction');
  });

  it('writes a procedure page for work it did, not for a schedule it was simply asked for', () => {
    const prompt = answer_prompt(['scheduled_tasks-create_scheduled_task-1']);

    expect(prompt).toContain('when you did the work yourself');
    expect(prompt).toContain('Create the task and write no page');
    expect(prompt).toContain('rediscovers all of that on every run');
  });

  it('never offers a schedule on a run with no way to create one', () => {
    const prompt = answer_prompt([]);

    expect(prompt).not.toContain('## Recurring Work Protocol');
    expect(prompt).not.toContain('scheduled_tasks-create_scheduled_task-1');
  });

  it('keeps the universal protocols on an external answer run', () => {
    const prompt = answer_prompt([]);

    expect(prompt).toContain('## Confidentiality Protocol');
    expect(prompt).toContain('## Voice');
    expect(prompt).toContain('## Deliverable Protocol');
    expect(prompt).not.toContain('## Memory');
    expect(prompt).toContain('## Live Source Protocol');
    expect(prompt).toContain('use an available live tool or say you cannot verify it yet');
  });

  it('keeps those same protocols for a run that does hold the tools', () => {
    const prompt = answer_prompt(every_steered_tool);

    expect(prompt).toContain('## Connected Apps Protocol');
    expect(prompt).toContain('runtime-list_connections-1');
    expect(prompt).toContain('## API Proxy Protocol');
    expect(prompt).toContain('## Catalog Tool Protocol');
    expect(prompt).toContain('## Available Skills');
  });

  it('drops the memory protocol even for a run that names the deleted memory tools', () => {
    const prompt = answer_prompt(['search_memory', 'recall_agent_activity']);

    expect(prompt).not.toContain('## Memory');
    expect(prompt).not.toContain('## Connected Apps Protocol');
    expect(prompt).not.toContain('## API Proxy Protocol');
  });

  it('keeps a section for any run holding its tool, whatever else that run lacks', () => {
    const prompt = answer_prompt(['runtime-list_connections-1']);

    expect(prompt).toContain('## Connected Apps Protocol');
    expect(prompt).toContain('## Tool Failure Protocol');
    expect(prompt).not.toContain('## API Proxy Protocol');
    expect(prompt).not.toContain('## Connection Protocol');
  });

  it('keeps Anthropic working until the current task is resolved', () => {
    const prompt = build_system_prompt({
      system_instructions: 'You are the agent.',
      model: { model_provider: 'anthropic', model_name: 'claude-sonnet-5' },
    });

    expect(prompt).toContain('You keep going until the current task is completely resolved');
    expect(prompt).toContain('Do not stop because the work is lengthy, repetitive');
  });

  describe('browser protocol vs authenticated hosts', () => {
    const connection_context = {
      snapshot_status: 'available' as const,
      omitted_connection_count: 0,
      connections: [
        {
          connection_id: 'conn_1',
          app_name: 'discovered_app_1',
          app_display_name: 'Acme Planner',
          app_category: '',
          connection_name: 'Acme Planner',
          connection_status: 'active',
          health_status: 'healthy',
          provider_key: 'native',
          external_account_name: '',
          connected_time: '',
          authenticated_hosts: ['www.acmebooking.com', 'cdn-static.acmebooking.com'],
          api_protocol_headers: {},
          accessible: true,
        },
      ],
    };

    it('routes an egress-authenticated host to workspace-http_request, not agent-browser eval', () => {
      const prompt = build_system_prompt({
        system_instructions: 'You are the agent.',
        current_connection_context: connection_context,
      });

      expect(prompt).toContain('www.acmebooking.com');
      expect(prompt).toContain('write the client on `workspace-http_request`');
      expect(prompt).toContain('Do not drive those hosts with `agent-browser eval`');
    });

    it('states the origin precondition that made a credentialed fetch look like a lost login', () => {
      const prompt = build_system_prompt({
        system_instructions: 'You are the agent.',
        current_connection_context: connection_context,
      });

      expect(prompt).toContain('open a page on that site FIRST');
      expect(prompt).toContain('TypeError: Failed to fetch');
      expect(prompt).toContain('which is a missing page, not a missing login');
    });

    it('names no host rule when the workspace has no egress-authenticated connection', () => {
      const prompt = build_system_prompt({ system_instructions: 'You are the agent.' });

      expect(prompt).toContain('## Browser Protocol');
      expect(prompt).not.toContain('write the client on `workspace-http_request`');
      expect(prompt).toContain('open a page on that site FIRST');
    });

    it('drops the Browser Protocol entirely when the session has no browser', () => {
      const prompt = build_system_prompt({
        system_instructions: 'You are the agent.',
        browser_available: false,
        current_connection_context: connection_context,
      });

      expect(prompt).not.toContain('## Browser Protocol');
      expect(prompt).not.toContain('write the client on `workspace-http_request`');
    });

    it('names hosts in a stable order so this protocol never churns the prompt cache', () => {
      const reversed = {
        ...connection_context,
        connections: [
          {
            ...connection_context.connections[0],
            authenticated_hosts: ['cdn-static.acmebooking.com', 'www.acmebooking.com'],
          },
        ],
      } as typeof connection_context;

      const browser_protocol_of = (context: typeof connection_context) => {
        const prompt = build_system_prompt({
          system_instructions: 'You are the agent.',
          current_connection_context: context,
        });
        const start = prompt.indexOf('## Browser Protocol');
        return prompt.slice(start, prompt.indexOf('\n\n##', start + 1));
      };

      expect(browser_protocol_of(reversed)).toBe(browser_protocol_of(connection_context));
      expect(browser_protocol_of(reversed)).toContain(
        'cdn-static.acmebooking.com, www.acmebooking.com',
      );
    });
  });

  describe('parallel tool calls', () => {
    it('asks for batches and states the independence test that makes them safe', () => {
      const block = parallel_block_of(dashboard_prompt());

      expect(block).toContain('## Parallel Tool Calls');
      expect(block).toContain('Send independent calls in one batch, not one per turn');
      expect(block).toContain('Batching is the default, not an optimization');
      expect(block).toContain("Independent means no call needs another call's output");
      expect(block).toContain('it belongs in your next turn instead');
    });

    it('turns a predictable chain of file steps into one script', () => {
      const block = parallel_block_of(dashboard_prompt());

      expect(block).toContain('is one script, not one call each');
      expect(block).toContain('Reading back something the same script just wrote is one of those');
      expect(block).toContain('Split only where a result you cannot predict decides what you do');
    });

    it('keeps outbound actions one call at a time so each stays approvable', () => {
      expect(parallel_block_of(dashboard_prompt())).toContain(
        'Anything leaving this workspace stays one call at a time, so each stays visible and approvable',
      );
    });

    it('exempts the browser, and says nothing about it when the session has no browser', () => {
      expect(parallel_block_of(dashboard_prompt())).toContain('Drive it one call at a time');

      const without_browser = build_system_prompt({
        system_instructions: 'You are the agent.',
        browser_available: false,
      });
      expect(parallel_block_of(without_browser)).toContain('## Parallel Tool Calls');
      expect(parallel_block_of(without_browser)).not.toContain('Drive it one call at a time');
    });

    it('goes when the run has no tools to batch, and stays when it has any', () => {
      expect(answer_prompt([])).not.toContain('## Parallel Tool Calls');
      expect(answer_prompt(['runtime-search_documents-1', 'runtime-read_document-1'])).toContain(
        '## Parallel Tool Calls',
      );
    });

    it('compiles the same bytes every time', () => {
      expect(parallel_block_of(dashboard_prompt())).toBe(parallel_block_of(dashboard_prompt()));
      expect(parallel_block_of(slack_prompt())).toBe(parallel_block_of(dashboard_prompt()));
    });

    it('stays inside its token budget', () => {
      const block = parallel_block_of(dashboard_prompt());

      expect(estimate_context_tokens_roughly(block)).toBeLessThanOrEqual(240);
      expect(block.length).toBeLessThanOrEqual(960);
    });
  });
});

function parallel_block_of(prompt: string) {
  return block_of(prompt, '## Parallel Tool Calls');
}

function block_of(prompt: string, heading: string) {
  const start = prompt.indexOf(heading);
  if (start === -1) return '';
  const end = prompt.indexOf('\n\n##', start + 1);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

describe('saying what blocks the work', () => {
  const ownership = () => block_of(dashboard_prompt(), '## Ownership Protocol');

  it('names what happened, the one thing that unblocks it, and what comes next', () => {
    const block = ownership();

    expect(block).toContain('never stop at "not accessible" or "something went wrong"');
    expect(block).toContain(
      'the one thing that unblocks it (a connection, an approval, a missing fact)',
    );
    expect(block).toContain('what you will do as soon as you have it');
    expect(block).toContain('Never say something worked when it did not');
  });

  it('treats an account that cannot see the thing like an app that is not connected', () => {
    const prompt = dashboard_prompt();

    expect(ownership()).toContain('when the connected account cannot see what they asked about');
    expect(ownership()).toContain('send the connect link for it in the same reply');
    expect(block_of(prompt, '## Connection Protocol')).toContain(
      'To connect any app, or one more account of an app that is already connected, call runtime-create_connection-1',
    );
  });

  it('keeps taking another route, except around a refused permission or approval', () => {
    const block = ownership();

    expect(block).toContain('When one route is blocked, take another');
    expect(block).toContain(
      'A call refused by a permission or approval rule is not a blocked route',
    );
    expect(block).toContain('never reach the same effect another way');
    expect(block).toContain(
      'where they can approve it, as the refusal states it, never a place you guessed',
    );
    expect(block.indexOf('take another')).toBeLessThan(block.indexOf('is not a blocked route'));
  });

  it('checks with the app tools before saying something is out of reach', () => {
    const block = block_of(dashboard_prompt(), '## Connected Apps Protocol');

    expect(block).toContain('its name never proves one is out of reach');
    expect(block).toContain('before you say what you can or cannot reach, see, or find');
    expect(answer_prompt([])).not.toContain('its name never proves one is out of reach');
  });

  it('names no channel where a person would have to approve', () => {
    const refused_route_rule = ownership()
      .split('\n')
      .find((line) => line.includes('is not a blocked route'));

    expect(refused_route_rule).toBeDefined();
    expect(refused_route_rule).not.toMatch(channel_names);
  });

  it('says each ownership rule once and stays inside its token budget', () => {
    const lines = ownership()
      .split('\n')
      .filter((line) => !line.startsWith('##'));

    expect(lines).toHaveLength(6);
    expect(estimate_context_tokens_roughly(ownership())).toBeLessThanOrEqual(455);
  });
});

describe('Workspace Protocol', () => {
  const workspace_protocol = () => {
    const prompt = dashboard_prompt();
    const start = prompt.indexOf('## Workspace Protocol');
    return prompt.slice(start, prompt.indexOf('\n\n##', start + 1));
  };

  it('teaches the discipline that stops duplicate files', () => {
    const section = workspace_protocol();

    expect(section).toContain('Before you create anything');
    expect(section).toContain('_v2');
    expect(section).toContain('writable_paths');
    expect(section).toContain('tmp/ is erased');
  });

  it('says each rule once', () => {
    const lines = workspace_protocol()
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('##'));
    const openings = lines.map((line) =>
      line
        .split(/[.,:—]/u)[0]
        ?.trim()
        .toLowerCase(),
    );
    expect(new Set(openings).size).toBe(openings.length);
  });

  it('stays inside its per-call token budget', () => {
    expect(estimate_context_tokens_roughly(workspace_protocol())).toBeLessThanOrEqual(700);
  });
});
