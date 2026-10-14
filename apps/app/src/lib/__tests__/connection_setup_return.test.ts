import { describe, expect, it } from 'vitest';
import { build_connection_setup_callback_view } from '@/lib/connection_setup_callback_view';
import {
  build_connection_setup_return_url,
  read_connection_setup_return_event,
  should_complete_connection_setup_return,
} from '@/lib/connection_setup_return';

describe('connection setup return helpers', () => {
  it('builds a same-origin connect callback URL', () => {
    expect(build_connection_setup_return_url('https://app.alfera.ai')).toBe(
      'https://app.alfera.ai/connect/callback',
    );
  });

  it('reads successful connection callback state', () => {
    const event = read_connection_setup_return_event(
      'https://app.alfera.ai/connect/callback?connection_id=conn_123&provider_key=composio&setup_token=setup_secret',
    );

    expect(event).toMatchObject({
      status: 'success',
      connection_id: 'conn_123',
      provider_key: 'composio',
      setup_token: 'setup_secret',
    });
  });

  it('marks Composio connection returns for browser-side completion', () => {
    expect(
      should_complete_connection_setup_return(
        read_connection_setup_return_event(
          'https://app.alfera.ai/connect/callback?connection_id=conn_123&provider_key=composio',
        ),
      ),
    ).toBe(true);
  });

  it('does not complete a provider whose page never hosts the setup', () => {
    expect(
      should_complete_connection_setup_return(
        read_connection_setup_return_event(
          'https://app.alfera.ai/connect/callback?connection_id=conn_123&provider_key=native_oauth',
        ),
      ),
    ).toBe(false);
  });

  it('does not complete already-finalized OAuth callbacks in the browser', () => {
    expect(
      should_complete_connection_setup_return(
        read_connection_setup_return_event(
          'https://app.alfera.ai/connect/callback?connection_id=conn_123',
        ),
      ),
    ).toBe(false);
  });

  it('reads provider error callback state', () => {
    const event = read_connection_setup_return_event(
      'https://app.alfera.ai/connect/callback?connection_id=conn_123&error_description=access_denied',
    );

    expect(event).toMatchObject({
      status: 'error',
      connection_id: 'conn_123',
      error_message: 'access_denied',
    });
  });

  it('shows a completed return state after successful callback handoff', () => {
    expect(
      build_connection_setup_callback_view({
        status: 'success',
        product_brand_name: 'Alfera',
        can_close_manually: true,
      }),
    ).toEqual({
      title: 'Connection connected',
      description: 'You can close this window.',
    });
  });

  it('keeps provider errors visible in the callback window', () => {
    expect(
      build_connection_setup_callback_view({
        status: 'error',
        product_brand_name: 'Alfera',
        can_close_manually: true,
        error_message: 'access_denied',
      }),
    ).toEqual({
      title: 'Connection setup failed',
      description: 'access_denied',
    });
  });
});
