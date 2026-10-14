import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatRunRecordsProvider } from '@/components/app/chat_run_records';
import { RunCostLine, type RunCostLineProps } from '@/components/app/run_cost_line';
import type { Run } from '@/lib/api';

function run_record(run_id: string, fields: Partial<Run>) {
  return {
    run_id,
    model_name: 'claude-opus-4',
    input_tokens: 12_400,
    output_tokens: 1_100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_microcents: 0,
    usage_metadata: {},
    ...fields,
  } as Run;
}

const runs = [
  run_record('run_with_cost', { cost_microcents: 27_000_000 }),
  run_record('run_without_cost', { usage_metadata: { estimated: true } }),
  run_record('run_still_working', { input_tokens: 0, output_tokens: 0 }),
];

function render_line(props: RunCostLineProps) {
  return renderToStaticMarkup(
    createElement(ChatRunRecordsProvider, { value: runs }, createElement(RunCostLine, props)),
  );
}

describe('the cost line of a run', () => {
  it('shows the model, the tokens and the cost the provider reported', () => {
    const html = render_line({ runId: 'run_with_cost' });

    expect(html).toContain('>claude-opus-4 · 12.4k tokens in, 1.1k out · $0.27</p>');
    expect(html).toContain('text-muted-foreground');
    expect(html).not.toContain('opacity-0');
  });

  it('shows the model and the tokens, and no price, when the provider reported no cost', () => {
    const html = render_line({ runId: 'run_without_cost' });

    expect(html).toContain('>claude-opus-4 · 12.4k tokens in, 1.1k out</p>');
    expect(html).not.toContain('$');
  });

  it('stays out of sight under a plain answer until the person points at the answer', () => {
    const html = render_line({ runId: 'run_with_cost', revealsOnHover: true });

    expect(html).toContain('opacity-0');
    expect(html).toContain('group-hover/message:opacity-100');
    expect(html).toContain('group-focus-within/message:opacity-100');
  });

  it.each([
    ['a run that used no tokens yet', 'run_still_working'],
    ['a run the chat does not hold', 'run_of_another_chat'],
    ['an answer with no run', undefined],
  ])('shows nothing for %s', (_name, runId) => {
    expect(render_line({ runId })).toBe('');
  });
});
