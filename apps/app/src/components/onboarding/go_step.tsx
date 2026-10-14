import { SlackGlyph } from '@/components/onboarding/slack/glyph';

export function GoStep({
  slackTeamId,
  slackBotUserId,
  isFinishing,
  onOpenSlack,
  onOpenDashboard,
}: {
  slackTeamId: string | null;
  slackBotUserId: string | null;
  isFinishing: boolean;
  onOpenSlack: (slack_url: string) => void;
  onOpenDashboard: () => void;
}) {
  return (
    <div className="ob-step ob-animate">
      <h1 className="ob-title">
        I've already messaged you in <span className="ob-accent">Slack</span>
      </h1>
      <p className="ob-subtitle">Pick where we start. You can use both, any time.</p>
      <div className="ob-actions">
        <button
          aria-busy={isFinishing}
          className="ob-btn"
          type="button"
          onClick={() => onOpenSlack(slack_url_for(slackTeamId, slackBotUserId))}
        >
          <SlackGlyph className="size-5" />
          Open Slack
        </button>
        <button className="ob-quiet" disabled={isFinishing} type="button" onClick={onOpenDashboard}>
          Continue in the dashboard
        </button>
      </div>
    </div>
  );
}

// `slack://user?team=…&id=…` is the URI that opens a direct message with a user. The web
// `/client/<team>/<id>` path opens whatever object the id names and, for a bot, lands on a channel
// instead of the DM — so the app URI is first, with the workspace home and slack.com behind it.
function slack_url_for(team_id: string | null, bot_user_id: string | null) {
  if (team_id && bot_user_id) return `slack://user?team=${team_id}&id=${bot_user_id}`;
  if (team_id) return `https://app.slack.com/client/${team_id}`;
  return 'https://slack.com';
}
