import { describe, expect, it } from 'vitest';
import {
  markdown_container_class_name,
  markdown_li_class_name,
  markdown_ol_class_name,
  markdown_paragraph_class_name,
  markdown_ul_class_name,
} from '@/components/prompt-kit/markdown_styles';

describe('markdown spacing classes', () => {
  it('keeps chat markdown lists controlled by component spacing instead of browser margins', () => {
    expect(markdown_container_class_name).toContain('gap-2');
    expect(markdown_container_class_name).toContain('[&>*:first-child]:mt-0');
    expect(markdown_container_class_name).toContain('[&>*:last-child]:mb-0');
    expect(markdown_paragraph_class_name).toContain('m-0');
    expect(markdown_ol_class_name).toContain('my-0');
    expect(markdown_ol_class_name).toContain('space-y-2');
    expect(markdown_ul_class_name).toContain('my-0');
    expect(markdown_ul_class_name).toContain('space-y-1.5');
    expect(markdown_li_class_name).toContain('[&>p]:m-0');
  });

  it('gives ordered lists enough left padding to fit multi-digit markers', () => {
    expect(markdown_container_class_name).toContain('overflow-hidden');
    expect(markdown_ol_class_name).toContain('pl-8');
  });
});
