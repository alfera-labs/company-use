import { describe, expect, it } from 'vitest';
import { indefinite_article_for } from '@/lib/indefinite_article';

describe('"a" or "an" before an app name', () => {
  it.each([
    ['Alfera API', 'an'],
    ['Attio', 'an'],
    ['Outlook', 'an'],
    ['Uber', 'an'],
    ['HTTP API', 'an'],
    ['MCP server', 'an'],
    ['X', 'an'],
    ['8x8', 'an'],
    ['hourly report', 'an'],
    ['Granola', 'a'],
    ['HubSpot', 'a'],
    ['Notion', 'a'],
    ['Unity', 'a'],
    ['user', 'a'],
    ['European site', 'a'],
    ['1Password', 'a'],
    ['GitHub', 'a'],
    ['CRM', 'a'],
  ])('%s takes "%s"', (name, article) => {
    expect(indefinite_article_for(name)).toBe(article);
  });
});
