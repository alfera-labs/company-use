import { describe, expect, it } from 'vitest';
import {
  past_participle,
  present_participle,
  say_action_in_tense,
} from '@/components/app/tool_action_words';

describe('say_action_in_tense', () => {
  it('says a catalog action in each of the three tenses a row needs', () => {
    expect(say_action_in_tense('Find Email', 'running')).toBe('Finding Email');
    expect(say_action_in_tense('Find Email', 'done')).toBe('Found Email');
    expect(say_action_in_tense('Find Email', 'about_to')).toBe('Tried to find Email');
  });

  it('leaves the rest of the name exactly as the catalog wrote it', () => {
    expect(say_action_in_tense('Read URL', 'done')).toBe('Read URL');
    expect(say_action_in_tense('Read URL', 'running')).toBe('Reading URL');
  });

  it('leaves a name that does not start with a verb alone', () => {
    expect(say_action_in_tense('New Email Matching Search', 'running')).toBe(
      'New Email Matching Search',
    );
    expect(say_action_in_tense('First action', 'done')).toBe('First action');
  });

  it('reads an action already written in the running tense back to its verb', () => {
    expect(say_action_in_tense('Searching Brain', 'done')).toBe('Searched Brain');
    expect(say_action_in_tense('Searching Brain', 'running')).toBe('Searching Brain');
    expect(say_action_in_tense('Reading from Brain', 'done')).toBe('Read from Brain');
    expect(say_action_in_tense('Saving to memory', 'done')).toBe('Saved to memory');
    expect(say_action_in_tense('Recalling past work', 'about_to')).toBe(
      'Tried to recall past work',
    );
  });

  it('says a one-word action with no object', () => {
    expect(say_action_in_tense('Search', 'running')).toBe('Searching');
    expect(say_action_in_tense('Search', 'done')).toBe('Searched');
  });
});

describe('present_participle', () => {
  it.each([
    ['send', 'sending'],
    ['create', 'creating'],
    ['run', 'running'],
    ['get', 'getting'],
    ['set', 'setting'],
    ['stop', 'stopping'],
    ['write', 'writing'],
    ['copy', 'copying'],
    ['search', 'searching'],
    ['upload', 'uploading'],
    ['list', 'listing'],
    ['submit', 'submiting'],
  ])('%s -> %s', (verb, expected) => {
    expect(present_participle(verb)).toBe(expected);
  });
});

describe('past_participle', () => {
  it.each([
    ['send', 'sent'],
    ['find', 'found'],
    ['read', 'read'],
    ['write', 'written'],
    ['create', 'created'],
    ['copy', 'copied'],
    ['run', 'run'],
    ['stop', 'stopped'],
    ['search', 'searched'],
    ['list', 'listed'],
  ])('%s -> %s', (verb, expected) => {
    expect(past_participle(verb)).toBe(expected);
  });
});
