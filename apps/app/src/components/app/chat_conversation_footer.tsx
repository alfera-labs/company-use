import { ChatBrowserCard } from '@/components/app/chat_browser_card';
import { ChatOnboardingStarters } from '@/components/app/chat_onboarding_starters';
import type { Run, SandboxUrlPreview } from '@/lib/api';

type OnboardingFindings = Parameters<typeof ChatOnboardingStarters>[0]['findings'];

type ChatConversationFooterInput = {
  session_id: string | undefined;
  shows_onboarding_starters: boolean;
  onboarding_starter_findings: OnboardingFindings;
  is_onboarding_intro_settled: boolean;
  select_starter: (prompt: string) => void;
  browser_preview: SandboxUrlPreview | undefined;
  latest_run: Pick<Run, 'run_status'> | undefined;
};

/** Builds the footer under the chat: the onboarding starters and the browser card. */
export function chat_conversation_footer(input: ChatConversationFooterInput) {
  const { browser_preview, latest_run, shows_onboarding_starters } = input;
  if (!browser_preview && !shows_onboarding_starters) return undefined;
  return (
    <div className="space-y-4">
      {shows_onboarding_starters ? (
        <ChatOnboardingStarters
          findings={input.onboarding_starter_findings}
          isRevealing={input.is_onboarding_intro_settled}
          onSelect={input.select_starter}
        />
      ) : null}
      {browser_preview ? (
        <ChatBrowserCard
          key={`${input.session_id}:${browser_preview.preview_url}:${browser_preview.live_view_token}`}
          preview={browser_preview}
          {...(latest_run ? { run_status: latest_run.run_status } : {})}
        />
      ) : null}
    </div>
  );
}
