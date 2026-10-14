import { describe, expect, it } from 'vitest';
import {
  answer_with_steps,
  answer_with_steps_and_no_cost,
  markup_after,
  plain_answer,
  render_answers,
  runs_of_the_chat,
} from '@/components/app/__tests__/answers_with_run_records';

describe('what a run cost, on an install that pays its model provider', () => {
  it('is one line in the steps of the answer: the model, the tokens and the cost', () => {
    const html = render_answers([answer_with_steps], runs_of_the_chat);
    const steps = markup_after(html, 'Worked · 1 step');

    expect(steps).toContain('>claude-opus-4 · 12.4k tokens in, 1.1k out · $0.27</p>');
    expect(steps.indexOf('$0.27')).toBeLessThan(steps.indexOf('I saved the note as hello.md.'));
    expect(html.split('data-run-cost-line').length - 1).toBe(1);
  });

  it('names the model and the tokens, and no price, when the provider reported no cost', () => {
    const html = render_answers([answer_with_steps_and_no_cost], runs_of_the_chat);

    expect(html).toContain('>claude-opus-4 · 12.4k tokens in, 1.1k out</p>');
    expect(html).not.toContain('$');
  });

  it('is under an answer that took no steps, out of sight until the person points at it', () => {
    const html = render_answers([plain_answer], runs_of_the_chat);
    const under_the_answer = markup_after(html, 'Hello.');

    expect(html).not.toContain('Worked');
    expect(under_the_answer).toContain('>claude-opus-4 · 850 tokens in, 120 out · &lt;$0.01</p>');
    expect(under_the_answer).toContain('group-hover/message:opacity-100');
    expect(html.split('data-run-cost-line').length - 1).toBe(1);
  });

  it('is not shown while the run of the answer still works', () => {
    const working = runs_of_the_chat.map((run) =>
      run.run_id === plain_answer.run_id ? { ...run, run_status: 'running' } : run,
    );

    expect(render_answers([plain_answer], working)).not.toContain('data-run-cost-line');
  });
});
