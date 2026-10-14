import { existsSync } from 'node:fs';
import { isNotFound } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { is_protected_path } from '@/lib/protected_path';
import { answer_not_found, Route } from '@/routes/product-demo';

function error_thrown_by(load: () => never): unknown {
  try {
    return load();
  } catch (error) {
    return error;
  }
}

describe('the demo page of the marketing site', () => {
  it('answers not found on this install', () => {
    expect(Route.options.loader).toBe(answer_not_found);
    expect(isNotFound(error_thrown_by(answer_not_found))).toBe(true);
  });

  it('is behind the sign-in like every other path, and the Slack logo sits with the logos', () => {
    expect(is_protected_path('/product-demo', 'production')).toBe(true);
    expect(is_protected_path('/product-demo/slack.svg', 'production')).toBe(true);
    expect(existsSync(new URL('../../../public/logos/slack.svg', import.meta.url))).toBe(true);
  });
});
