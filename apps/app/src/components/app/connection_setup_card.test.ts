import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionSetupCard } from '@/components/app/connection_setup_card';

describe('ConnectionSetupCard', () => {
  it('renders the slow connection setup state as a disabled loading card', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionSetupCard, {
        app: {
          app_id: 'app_gmail',
          app_name: 'gmail',
          app_display_name: 'Gmail',
          description: 'Email by Google',
        },
        disabled: true,
        isLoading: true,
        status: 'starting',
      }),
    );

    expect(html).toContain('Gmail');
    expect(html).toContain('Email by Google');
    expect(html).toContain('Connect');
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('href=');
  });
});
