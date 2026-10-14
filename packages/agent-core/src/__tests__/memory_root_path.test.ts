import { is_memory_root_path, model_root_of } from '@agent-core/environment/memory_root_path';
import { describe, expect, it } from 'vitest';

describe('model_root_of prefix boundary', () => {
  it('classes /memory and every path under it as the memory root', () => {
    expect(model_root_of('/memory').name).toBe('memory');
    expect(model_root_of('/memory/demo/plan.md').name).toBe('memory');
  });

  it('classes a lookalike path that merely starts with the /memory prefix as workspace', () => {
    expect(model_root_of('/memoryx').name).toBe('workspace');
    expect(model_root_of('/memoryx/plan.md').name).toBe('workspace');
    expect(model_root_of('/memory-backup/plan.md').name).toBe('workspace');
    expect(is_memory_root_path('/memoryx')).toBe(false);
  });

  it('classes every relative path as workspace', () => {
    expect(model_root_of('notes/a.md').name).toBe('workspace');
    expect(model_root_of('.').name).toBe('workspace');
  });
});
