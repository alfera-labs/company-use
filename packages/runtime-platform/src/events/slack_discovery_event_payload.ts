import type { SlackDiscoveryNotification } from '@runtime-platform/events/slack_discovery_trigger';

/** The run a workspace gets once, the first time it meets the coworker in Slack. */
export const first_contact_discovery_run_key = 'first-contact';

export type SlackDiscoveryEventBody = {
  connection_id?: string;
  discovery_run_key?: string;
  delivery_mode?: 'silent' | 'slack';
  notification?: SlackDiscoveryNotification;
};

export type SlackDiscoveryChannelEventBody = {
  channel_id: string;
  connection_id?: string;
  channel_name?: string | null;
};

export type SlackDiscoverySummaryEventBody = {
  connection_id: string;
  discovery_run_key?: string;
  delivery_mode?: 'silent' | 'slack';
  notification_channel_id?: string;
  channel_subject_keys?: string[];
  member_count?: number;
};

export type SlackWorkflowProposalEventBody = {
  connection_id?: string;
  discovery_run_key?: string;
  notification_channel_id?: string;
  channel_subject_keys?: string[];
};
