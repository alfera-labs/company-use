import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { Link } from '@tanstack/react-router';
import { ArrowUp, Plus } from 'lucide-react';
import { memo } from 'react';
import { GoogleLogo, SlackLogo } from '@/components/auth/provider_logos';
import { FileUploadTrigger } from '@/components/prompt-kit/file-upload';
import { PromptInputAction } from '@/components/prompt-kit/prompt-input';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

export const ChatSendButton = memo(function ChatSendButton({
  can_submit,
  expanded,
  tooltip,
}: {
  can_submit: boolean;
  expanded: boolean;
  tooltip: string;
}) {
  return (
    <PromptInputAction tooltip={tooltip}>
      <Button
        aria-label="Send message"
        className={cn(
          'size-9 shrink-0 rounded-full transition-transform duration-150 ease-out active:scale-95',
          expanded &&
            'disabled:bg-(--sidebar-selected) disabled:text-background disabled:opacity-100',
        )}
        disabled={!can_submit}
        size="sm"
        type="submit"
      >
        <ArrowUp className="size-4" />
      </Button>
    </PromptInputAction>
  );
});

export const ConnectYourAppsLink = memo(function ConnectYourAppsLink() {
  const install_can_connect_these_apps = useInstallHasAppCatalogue() !== false;
  return (
    <>
      {install_can_connect_these_apps ? (
        <span
          aria-label="Google and Slack"
          className="flex shrink-0 items-center gap-1.5"
          role="img"
        >
          <span className="grid size-5 place-items-center rounded-full border border-background bg-background">
            <GoogleLogo />
          </span>
          <span className="grid size-5 place-items-center rounded-full border border-background bg-background">
            <SlackLogo />
          </span>
        </span>
      ) : null}
      <Link className="shrink-0 hover:text-foreground" to="/integrations">
        Connect your apps
      </Link>
    </>
  );
});

export const ChatAttachButton = memo(function ChatAttachButton({
  disabled,
}: {
  disabled: boolean;
}) {
  return (
    <PromptInputAction tooltip="Add files">
      <FileUploadTrigger>
        <Button
          aria-label="Add files"
          disabled={disabled}
          className="size-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          data-tour="composer-attach"
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>
      </FileUploadTrigger>
    </PromptInputAction>
  );
});
