export type ChatWallCode = 'card_required' | 'out_of_credits';

export function usePrefetchChatPaywall() {
  return () => undefined;
}

type ChatPaywall = {
  effective_wall_code: ChatWallCode | null;
  is_wall_known: boolean;
  paywall_open: boolean;
  set_paywall_open: (open: boolean) => void;
};

const no_paywall: ChatPaywall = {
  effective_wall_code: null,
  is_wall_known: true,
  paywall_open: false,
  set_paywall_open: () => undefined,
};

export function useChatPaywall(_input: {
  session_id: string | undefined;
  wall_code: ChatWallCode | null;
  set_wall_code: (code: ChatWallCode | null) => void;
  is_runtime_active: boolean;
  is_send_pending: boolean;
}): ChatPaywall {
  return no_paywall;
}
