import type { BrowserSession } from '@agent-core/browser/types';
import type {
  BrowserGraderOutcome,
  BrowserGraderSpec,
} from '@coworker/evals/browser/browser_eval_types';

export async function grade_browser_task(
  session: BrowserSession,
  graders: BrowserGraderSpec[],
  final_text: string,
): Promise<BrowserGraderOutcome> {
  for (const grader of graders) {
    const outcome = await grade_one(session, grader, final_text);
    if (!outcome.passed) return outcome;
  }
  return { passed: true, failure_reason: null };
}

async function grade_one(
  session: BrowserSession,
  grader: BrowserGraderSpec,
  final_text: string,
): Promise<BrowserGraderOutcome> {
  if (grader.grader_type === 'url_matches') {
    const url = (await session.exec(['get', 'url'])).stdout;
    return new RegExp(grader.pattern).test(url)
      ? pass()
      : fail(`url ${url.trim()} does not match /${grader.pattern}/`);
  }
  if (grader.grader_type === 'snapshot_contains') {
    const snapshot = (await session.exec(['snapshot', '-i'])).stdout;
    return snapshot.includes(grader.text)
      ? pass()
      : fail(`snapshot does not contain "${grader.text}"`);
  }
  if (grader.grader_type === 'page_contains') {
    const text = (await session.exec(['read'])).stdout;
    return text.includes(grader.text) ? pass() : fail(`page does not contain "${grader.text}"`);
  }
  if (grader.grader_type === 'final_text_contains') {
    return final_text.includes(grader.text)
      ? pass()
      : fail(`agent report does not contain "${grader.text}"`);
  }
  return final_text.includes(grader.text)
    ? fail(`agent report falsely contains "${grader.text}"`)
    : pass();
}

function pass(): BrowserGraderOutcome {
  return { passed: true, failure_reason: null };
}

function fail(reason: string): BrowserGraderOutcome {
  return { passed: false, failure_reason: reason };
}
