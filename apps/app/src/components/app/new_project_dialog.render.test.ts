import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewProjectDialog } from '@/components/app/new_project_dialog';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
  useNavigate: () => vi.fn(),
}));

vi.mock('@coworker/ui/components/alert-dialog', () => {
  const box = (children: ReactNode) => createElement('div', null, children);
  return {
    AlertDialog: ({ children }: { children?: ReactNode }) => box(children),
    AlertDialogContent: ({ children }: { children?: ReactNode }) => box(children),
    AlertDialogHeader: ({ children }: { children?: ReactNode }) => box(children),
    AlertDialogTitle: ({ children }: { children?: ReactNode }) => box(children),
    AlertDialogFooter: ({ children }: { children?: ReactNode }) => box(children),
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => box(children),
  };
});

function render_dialog(): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(NewProjectDialog, { open: true, onOpenChange: () => undefined }),
    ),
  );
}

describe('making a project asks exactly one question', () => {
  it('asks for the name and nothing else', () => {
    const html = render_dialog();
    expect(html).toContain('What would you like to call the project?');
    expect(html).toContain('Create');
    expect(html).toContain('Cancel');
  });

  it('carries none of the settings screen', () => {
    const html = render_dialog();
    for (const settings_word of ['Description', 'Instructions', 'Connections', 'Tool']) {
      expect(html).not.toContain(settings_word);
    }
  });
});

type StubLinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string> | undefined;
  preload?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

function stub_link_href(to: string, params: Record<string, string> | undefined) {
  return to
    .replace(/\{-\$(\w+)\}/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\$(\w+)/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\/$/u, '');
}
