import { createFileRoute } from '@tanstack/react-router';
import { SetupFlow } from '@/components/install_sign_in/setup_flow';
import { take_setup_token_out_of_the_address_script } from '@/components/install_sign_in/use_setup_token';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/setup')({
  head: () => ({
    meta: [{ title: page_title('Set up Alfera') }, { name: 'referrer', content: 'no-referrer' }],
    scripts: [{ children: take_setup_token_out_of_the_address_script }],
  }),
  component: SetupFlow,
});
