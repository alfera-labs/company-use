// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RevealStep } from '@/components/onboarding/reveal_step';
import type { CompanyScan } from '@/lib/api';

const job = (name: string) => ({
  name,
  offer: `I'll do ${name}.`,
  steps: [`First step of ${name}`, `Second step of ${name}`],
  title: name,
  body: `The body of ${name}.`,
  prompt: `Do ${name}.`,
});
const scan: CompanyScan = {
  company_name: '',
  summary: '',
  scan_facts: [],
  findings: [job('the schedule'), job('the site'), job('the report')],
  scanned_url: null,
  scanned_at: '2026-10-12T00:00:00.000Z',
};

type Part = { kind: string; text: string };

let root: Root | null = null;
let swaps: { before: Map<string, Part>; after: Map<string, Part> }[];

function named_parts(): Map<string, Part> {
  const parts = new Map<string, Part>();
  for (const element of document.querySelectorAll<HTMLElement>('.ob-step *')) {
    const name = element.style.viewTransitionName;
    if (!name) continue;
    expect(parts.has(name), `${name} is on one page twice`).toBe(false);
    parts.set(name, { kind: element.className, text: element.textContent ?? '' });
  }
  return parts;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'matchMedia',
    () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as never,
  );
  swaps = [];
  document.startViewTransition = ((swap: () => void) => {
    const before = named_parts();
    swap();
    swaps.push({ before, after: named_parts() });
    return { finished: Promise.resolve() };
  }) as never;
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(RevealStep, { scan, onAdvance: () => {} })));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function pick(offer_text: string) {
  const row = [...document.querySelectorAll<HTMLElement>('.ob-waiting__row')].find((one) =>
    one.textContent?.includes(offer_text),
  );
  expect(row, `the row of ${offer_text}`).toBeTruthy();
  await act(async () => row?.click());
}

const names_only_in = (one: Map<string, Part>, other: Map<string, Part>) =>
  [...one.keys()].filter((name) => !other.has(name)).sort();

describe('choosing another starter job', () => {
  it('starts with the first job on stage and the others waiting', () => {
    expect(document.querySelector('.ob-run__say')?.textContent).toBe("I'll do the schedule.");
    expect(document.querySelectorAll('.ob-waiting__row')).toHaveLength(2);
  });

  it('never gives one name to two different texts, so no text is drawn over another', async () => {
    await pick('the site');
    await pick('the report');
    await pick('the schedule');

    expect(swaps).toHaveLength(3);
    for (const { before, after } of swaps) {
      for (const [name, part] of before) {
        if (after.has(name)) expect(after.get(name), name).toEqual(part);
      }
    }
  });

  it('takes the old job and the picked row out, then puts the picked job and a new row in', async () => {
    await pick('the site');
    const [{ before, after }] = swaps as [(typeof swaps)[number]];

    expect(names_only_in(before, after)).toEqual(['ob-run-0', 'ob-waiting-offer-1']);
    expect(names_only_in(after, before)).toEqual(['ob-run-1', 'ob-waiting-offer-0']);
    expect(after.get('ob-run-1')?.text).toContain("I'll do the site.");
    expect(after.get('ob-run-1')?.text).toContain('First step of the site');
    expect(before.get('ob-waiting-offer-2')).toEqual(after.get('ob-waiting-offer-2'));
  });

  it('shows one job on stage after the swap, with its own steps and no step of the old one', async () => {
    await pick('the site');
    const stage = document.querySelector('.ob-reveal__stage')?.textContent ?? '';

    expect(document.querySelectorAll('.ob-run')).toHaveLength(1);
    expect(stage).toContain('First step of the site');
    expect(stage).not.toContain('the schedule');
  });
});

describe('the timing of a swap in the stylesheet', () => {
  const css_path = createRequire(import.meta.url).resolve('@coworker/ui/onboarding.css');
  const css = readFileSync(css_path, 'utf8');
  const milliseconds = (rule: RegExp) => Number(css.match(rule)?.[1] ?? Number.NaN);

  it('lets what leaves fade out before what comes fades in', () => {
    const leaves_in = milliseconds(
      /\.ob-morphing::view-transition-old\(\*\):only-child \{\s*animation-duration: (\d+)ms;/u,
    );
    const comes_after = milliseconds(
      /\.ob-morphing::view-transition-new\(\*\):only-child \{\s*animation-delay: (\d+)ms;/u,
    );

    expect(leaves_in).toBeGreaterThan(0);
    expect(comes_after).toBeGreaterThanOrEqual(leaves_in);
  });

  it('names no part of a job on its own, so a job is always drawn as one', () => {
    expect(css).not.toMatch(/view-transition-name: ob-run-(line|connect)/u);
  });
});

describe('the wizard on an install that signs its people in itself', () => {
  const css_path = createRequire(import.meta.url).resolve('@coworker/ui/onboarding.css');
  const css = readFileSync(css_path, 'utf8');
  const variables_of = (block_start: string) => {
    const block = css.slice(css.indexOf(block_start)).split('\n}\n')[0] ?? '';
    return [...block.matchAll(/^\s+(--ob-[\w-]+):/gmu)].map((match) => match[1]).sort();
  };

  it('has a dark material for every light one, except the orange of the brand', () => {
    const light = variables_of('.ob-root {').filter((name) => name !== '--ob-orange');

    expect(light.length).toBeGreaterThan(8);
    expect(variables_of('.dark [data-wizard-follows-theme] .ob-root {')).toEqual(light);
  });

  it('paints no control with a colour that is written out, so the dark material reaches it', () => {
    const rules = css.slice(css.indexOf('/* ---------- top bar ---------- */'));

    expect(rules).not.toMatch(/background-color: #fff|linear-gradient\(to bottom, #2a231e/u);
  });
});
