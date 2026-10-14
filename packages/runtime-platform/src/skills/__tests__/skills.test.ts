import { render_browser_operating_guide } from '@agent-core/browser/browser_operating_guide';
import { build_browser_skill_prompt } from '@agent-core/browser/browser_skill_prompt';
import { estimate_context_tokens_roughly } from '@coworker/shared';
import {
  build_skills_discovery_block,
  resolve_skills_for_run,
} from '@runtime-platform/skills/resolve_skills_for_run';
import { find_skill_by_slug, get_all_skills } from '@runtime-platform/skills/skill_registry';
import { runtime_load_skill_tool } from '@runtime-platform/tools/definitions/runtime_load_skill';
import { describe, expect, it } from 'vitest';

describe('resolve_skills_for_run', () => {
  it('maps ungated skills onto harness skills keyed by their slug', () => {
    const skills = resolve_skills_for_run();
    const ungated_slugs = get_all_skills()
      .filter((skill) => !skill.available_on_source_types)
      .map((skill) => skill.skill_slug);

    expect(skills.map((skill) => skill.name)).toEqual(ungated_slugs);
    for (const skill of skills) {
      expect(skill.file_path).toBe(`skill://global/${skill.name}`);
    }
  });

  it('offers a source-gated skill only on a matching turn source', () => {
    const on_dashboard = resolve_skills_for_run({ source_type: 'web_chat' }).map(
      (skill) => skill.name,
    );
    const on_slack = resolve_skills_for_run({ source_type: 'slack' }).map((skill) => skill.name);

    expect(on_dashboard).not.toContain('slack-channel');
    expect(on_slack).toContain('slack-channel');
    expect(on_slack).toContain('operate-the-browser');
  });
});

describe('build_skills_discovery_block', () => {
  it('lists the turn-appropriate skills and points the model at the load tool', () => {
    const block = build_skills_discovery_block({ source_type: 'slack' });

    expect(block).toContain('<available_skills>');
    expect(block).toContain('runtime-load_skill-1');
    for (const skill of resolve_skills_for_run({ source_type: 'slack' })) {
      expect(block).toContain(skill.name);
    }
  });

  it('omits the Slack skill from a non-Slack discovery block', () => {
    expect(build_skills_discovery_block({ source_type: 'web_chat' })).not.toContain(
      'slack-channel',
    );
    expect(build_skills_discovery_block()).not.toContain('slack-channel');
    expect(build_skills_discovery_block({ source_type: 'slack' })).toContain('slack-channel');
  });

  it('offers the document skills for spreadsheets, docs, pdf, and slides', () => {
    const slugs = get_all_skills().map((skill) => skill.skill_slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        'spreadsheet-files',
        'document-files',
        'pdf-files',
        'presentation-files',
        'operate-the-browser',
      ]),
    );
  });
});

describe('slack-channel skill', () => {
  it('is gated to Slack turns but still loadable by slug', async () => {
    const skill = find_skill_by_slug('slack-channel');
    expect(skill?.available_on_source_types).toEqual(['slack']);

    const result = await runtime_load_skill_tool.execute({ skill_slug: 'slack-channel' });
    expect(result.success).toBe(true);
  });

  it('teaches the native reply contract and Slack formatting from our real tools', () => {
    const body = find_skill_by_slug('slack-channel')?.body ?? '';
    expect(body).toContain('slack-respond-1');
    expect(body).toContain('slack-upload_file-1');
    expect(body).toContain('slack-read_history-1');
    expect(body).toContain('Write standard Markdown');
    expect(body).toContain('[label](https://example.com)');
    expect(body).not.toContain('<https://example.com|label>');
    expect(body).not.toContain('slack step');
    expect(body).not.toContain('slack send');
  });
});

describe('document delivery workflow', () => {
  it('requires requested Slack attachments before claiming completion', () => {
    for (const slug of ['spreadsheet-files', 'document-files', 'pdf-files', 'presentation-files']) {
      const body = find_skill_by_slug(slug)?.body ?? '';
      expect(body).toContain('`slack-upload_file-1` with the exact final path before replying');
      expect(body).toContain('A workspace path');
      expect(body).toContain('in a reply is not delivery');
      expect(body).toContain('linking it creates a duplicate preview');
    }
  });
});

describe('skills discovery index', () => {
  it('keeps every trigger a skill is reached by, in the rendered index', () => {
    const discovery_block = build_skills_discovery_block();

    for (const trigger of [
      'browsing a site',
      'scraping or extracting page data',
      'clicking through pages',
      'filling and submitting forms',
      'logging in',
      'app_not_found',
      'not in Current Connections',
      '401',
      'asks for research, a briefing',
    ]) {
      expect(discovery_block).toContain(trigger);
    }
  });

  it('stays inside its per-call token budget', () => {
    for (const source_type of [undefined, 'slack']) {
      const tokens = estimate_context_tokens_roughly(
        build_skills_discovery_block(source_type ? { source_type } : {}),
      );
      expect(tokens).toBeLessThanOrEqual(660);
    }
  });
});

describe('operate-the-browser skill', () => {
  it('triggers on browsing, scraping, clicking, and form-filling tasks', () => {
    const skill = find_skill_by_slug('operate-the-browser');
    expect(skill).not.toBeNull();
    for (const trigger of [
      'browsing a website',
      'scraping or extracting data',
      'clicking buttons or links',
      'filling out and submitting forms',
    ]) {
      expect(skill?.description).toContain(trigger);
    }
  });

  it('shares one operating guide with the browser sub-agent prompt — no drifting copies', () => {
    const guide = render_browser_operating_guide();
    expect(find_skill_by_slug('operate-the-browser')?.body).toContain(guide);
    expect(build_browser_skill_prompt('# agent-browser core')).toContain(guide);
  });

  it('tells the main agent to persist and to hand the browse tool a complete task', () => {
    const body = find_skill_by_slug('operate-the-browser')?.body ?? '';
    expect(body).toContain('hand it the WHOLE task in one call');
    expect(body).toContain('fully achieved and verified');
    expect(body).toContain('clicking is discovery only');
  });

  it('points at the derive-client manual and overrides the advice that is unsafe here', () => {
    const body = find_skill_by_slug('operate-the-browser')?.body ?? '';
    expect(body).toContain('skills get derive-client');
    expect(body).toContain('never write auth material to a file');
    expect(body).toContain("credentials: 'include' })");
    expect(body).toContain('treat the HAR as disposable');
    expect(body).toContain('tools/<client-slug>/');
    expect(body).toContain('read it back through a call your client did not make');
  });

  it('overrides every step of the manual that writes a credential to disk', () => {
    const body = find_skill_by_slug('operate-the-browser')?.body ?? '';
    expect(body).toContain('cookies get --json > cookies.json');
    expect(body).toContain('loads from a file or environment variable');
    expect(body).toContain('re-export cookies');
    expect(body).toContain('bearer token, CSRF token, or API key');
  });

  it('tells the agent to open the API origin before calling it', () => {
    const body = find_skill_by_slug('operate-the-browser')?.body ?? '';
    expect(body).toContain('agent-browser open <api-origin>');
    expect(body).toContain("current page's origin");
  });

  it('records with response bodies off and creates the capture directory first', () => {
    const body = find_skill_by_slug('operate-the-browser')?.body ?? '';
    expect(body).toContain('mkdir -p tmp/derived-clients');
    expect(body).toContain('network har start --content none');
  });
});

describe('every built-in skill loads', () => {
  it.each(
    get_all_skills().map((skill) => skill.skill_slug),
  )('loads %s through runtime-load_skill-1', async (slug) => {
    const result = await runtime_load_skill_tool.execute({ skill_slug: slug });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(String((result.data as { content: string }).content)).toContain(
        `<skill name="${slug}"`,
      );
    }
  });
});

describe('runtime-load_skill-1', () => {
  it('returns the full skill body wrapped for invocation', async () => {
    const result = await runtime_load_skill_tool.execute({ skill_slug: 'research-briefing' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ skill_slug: 'research-briefing' });
      expect(String((result.data as { content: string }).content)).toContain(
        '<skill name="research-briefing"',
      );
      expect(String((result.data as { content: string }).content)).toContain('# Research briefing');
    }
  });

  it('fails for an unknown skill slug', async () => {
    const result = await runtime_load_skill_tool.execute({ skill_slug: 'does-not-exist' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('skill_not_found');
    }
  });
});

describe("skills that spend the person's money", () => {
  const spending_slugs = ['booking-travel', 'booking-a-table', 'ordering-food', 'buying-online'];

  it('are reachable from the discovery index by what the person asks for', () => {
    const discovery_block = build_skills_discovery_block();
    for (const trigger of ['book flights', 'reserve a table', 'order food', 'buy a product']) {
      expect(discovery_block).toContain(trigger);
    }
    expect(discovery_block).toContain('scheduling-meetings');
  });

  it('all carry the same rules for consent, secrets, and proof', () => {
    for (const slug of spending_slugs) {
      const body = find_skill_by_slug(slug)?.body ?? '';
      expect(body).toContain('total they will be charged');
      expect(body).toContain('**Take control**');
      expect(body).toContain('Never ask for a password, a card number');
      expect(body).toContain('do **not** submit again');
    }
  });

  it('never tells the agent to take a secret in chat or to use a tool we do not have', () => {
    for (const slug of [...spending_slugs, 'scheduling-meetings']) {
      const body = find_skill_by_slug(slug)?.body ?? '';
      expect(body).not.toMatch(/phone the|call the restaurant for them|vault/i);
      for (const tool of body.match(/`[a-z_]+-[a-z_]+-1`/g) ?? []) {
        expect(['`runtime-search_tools-1`']).toContain(tool);
      }
    }
  });
});
