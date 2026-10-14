/**
 * Our own connectors that stay on offer when Composio ships an app with the same name. Every
 * other app with a Composio twin is connected through Composio, and its native twin is hidden.
 * Slack is our channel bot: its respond tool runs on our own connection.
 */
export const native_preferred_app_names = ['slack'] as const;
