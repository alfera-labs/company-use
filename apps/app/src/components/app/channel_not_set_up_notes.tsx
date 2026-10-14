import { email_guide_url, slack_guide_url } from '@coworker/config/hosted_defaults';

/** On an install with no email set up: what email does, the one command, and the guide. */
export function EmailNotSetUpNote() {
  return (
    <ChannelNotSetUpNote
      title="Email is not set up on this install"
      what_it_does="With email, your coworker gets its own address: you write to it, it answers, and it sends its notifications by email. Email needs a Resend account and a public address."
      add_command="./alfera add email"
      guide_url={email_guide_url}
    />
  );
}

/** On an install with no Slack app: what Slack does, the one command, and the guide. */
export function SlackNotSetUpNote() {
  return (
    <ChannelNotSetUpNote
      title="Slack is not set up on this install"
      what_it_does="With Slack, you talk to your coworker in your Slack, and you choose on this page the channels where it answers. Slack needs a Slack app of your own and a public address."
      add_command="./alfera add slack"
      guide_url={slack_guide_url}
    />
  );
}

function ChannelNotSetUpNote({
  title,
  what_it_does,
  add_command,
  guide_url,
}: {
  title: string;
  what_it_does: string;
  add_command: string;
  guide_url: string;
}) {
  return (
    <section className="border-border/60 border-y py-4">
      <h2 className="font-medium text-sm">{title}</h2>
      <p className="mt-1 text-muted-foreground text-sm">
        {what_it_does} On the machine that runs Alfera, run{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-foreground">{add_command}</code>, then
        reload this page.{' '}
        <a
          className="underline underline-offset-4 hover:text-foreground"
          href={guide_url}
          rel="noreferrer"
          target="_blank"
        >
          Read the guide
        </a>
        .
      </p>
    </section>
  );
}
