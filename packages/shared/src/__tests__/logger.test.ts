import { create_logger } from '@shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const original_log_level = process.env.LOG_LEVEL;
const original_node_env = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  process.env.LOG_LEVEL = original_log_level;
  process.env.NODE_ENV = original_node_env;
  vi.restoreAllMocks();
});

function spy_on_console() {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

describe('create_logger', () => {
  it('prints the tag in front of the message', () => {
    process.env.LOG_LEVEL = 'info';
    const spies = spy_on_console();
    create_logger('queue').info('queued 3 jobs — running now');
    expect(spies.info).toHaveBeenCalledWith('[queue] queued 3 jobs — running now');
  });

  it('folds the context into the same line as compact JSON, and omits it when absent', () => {
    process.env.LOG_LEVEL = 'error';
    const spies = spy_on_console();
    const log = create_logger('queue');
    log.error('handler failed', { run_id: 'run_1' });
    log.error('handler failed');
    expect(spies.error).toHaveBeenNthCalledWith(1, '[queue] handler failed {"run_id":"run_1"}');
    expect(spies.error).toHaveBeenNthCalledWith(2, '[queue] handler failed');
  });

  it('keeps a context with an Error and nested objects on one queryable line', () => {
    process.env.LOG_LEVEL = 'error';
    const spies = spy_on_console();
    create_logger('queue').error('handler failed', {
      run_id: 'run_1',
      error: new Error('pooler write failed'),
    });
    const [line] = spies.error.mock.calls[0] ?? [];
    expect(spies.error.mock.calls[0]).toHaveLength(1);
    expect(typeof line).toBe('string');
    expect(line).not.toContain('\n');
    expect(line).toContain('"run_id":"run_1"');
    expect(line).toContain('"message":"pooler write failed"');
  });

  it('does not throw on a circular context', () => {
    process.env.LOG_LEVEL = 'error';
    const spies = spy_on_console();
    const circular: Record<string, unknown> = { run_id: 'run_1' };
    circular.self = circular;
    expect(() => create_logger('queue').error('handler failed', circular)).not.toThrow();
    expect(spies.error).toHaveBeenCalledOnce();
  });

  it('at the default level (info) shows info and above but hides debug', () => {
    delete process.env.LOG_LEVEL;
    const spies = spy_on_console();
    const log = create_logger('queue');
    log.debug('firehose');
    log.info('story');
    log.warn('careful');
    log.error('broken');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledOnce();
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(spies.error).toHaveBeenCalledOnce();
  });

  it('LOG_LEVEL=debug opens the firehose', () => {
    process.env.LOG_LEVEL = 'debug';
    const spies = spy_on_console();
    create_logger('http').debug('<-- GET /path');
    expect(spies.debug).toHaveBeenCalledWith('[http] <-- GET /path');
  });

  it('LOG_LEVEL=error hides warn and info', () => {
    process.env.LOG_LEVEL = 'error';
    const spies = spy_on_console();
    const log = create_logger('queue');
    log.info('story');
    log.warn('careful');
    log.error('broken');
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledOnce();
  });

  it('LOG_LEVEL=silent silences everything', () => {
    process.env.LOG_LEVEL = 'silent';
    const spies = spy_on_console();
    const log = create_logger('queue');
    log.info('story');
    log.error('broken');
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it('normalizes case and whitespace in LOG_LEVEL', () => {
    process.env.LOG_LEVEL = '  DEBUG ';
    const spies = spy_on_console();
    create_logger('http').debug('firehose');
    expect(spies.debug).toHaveBeenCalledOnce();
  });

  it('falls back to the default level when LOG_LEVEL is unrecognized', () => {
    process.env.LOG_LEVEL = 'chatty';
    const spies = spy_on_console();
    const log = create_logger('queue');
    log.info('story');
    log.debug('firehose');
    expect(spies.info).toHaveBeenCalledOnce();
    expect(spies.debug).not.toHaveBeenCalled();
  });
});
