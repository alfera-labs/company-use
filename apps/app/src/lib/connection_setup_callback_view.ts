export type ConnectionSetupCallbackStatus = 'returning' | 'success' | 'error';

export type ConnectionSetupCallbackView = {
  title: string;
  description: string;
};

export function build_connection_setup_callback_view(input: {
  status: ConnectionSetupCallbackStatus;
  product_brand_name: string;
  can_close_manually: boolean;
  error_message?: string;
}): ConnectionSetupCallbackView {
  if (input.status === 'error') {
    return {
      title: 'Connection setup failed',
      description: input.error_message ?? 'The provider returned an error.',
    };
  }

  if (input.status === 'success') {
    return {
      title: 'Connection connected',
      description: input.can_close_manually
        ? 'You can close this window.'
        : 'This window will close automatically.',
    };
  }

  return {
    title: `Returning to ${input.product_brand_name}`,
    description: 'This window will close automatically.',
  };
}
