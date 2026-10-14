import attio_app_definition from '@connectors/apps/attio/app.json' with { type: 'json' };
import * as attio_create_note_v1_execute from '@connectors/apps/attio/create_note/v1/execute';
import attio_create_note_v1_definition from '@connectors/apps/attio/create_note/v1/node.json' with { type: 'json' };
import * as attio_create_records_v1_execute from '@connectors/apps/attio/create_records/v1/execute';
import attio_create_records_v1_definition from '@connectors/apps/attio/create_records/v1/node.json' with { type: 'json' };
import attio_list_objects_v1_definition from '@connectors/apps/attio/list_objects/v1/node.json' with { type: 'json' };
import * as attio_list_records_v1_execute from '@connectors/apps/attio/list_records/v1/execute';
import attio_list_records_v1_definition from '@connectors/apps/attio/list_records/v1/node.json' with { type: 'json' };
import * as attio_update_records_v1_execute from '@connectors/apps/attio/update_records/v1/execute';
import attio_update_records_v1_definition from '@connectors/apps/attio/update_records/v1/node.json' with { type: 'json' };
import example_app_definition from '@connectors/apps/example/app.json' with { type: 'json' };
import * as example_collect_items_v1_execute from '@connectors/apps/example/collect_items/v1/execute';
import example_collect_items_v1_definition from '@connectors/apps/example/collect_items/v1/node.json' with { type: 'json' };
import example_echo_items_v1_definition from '@connectors/apps/example/echo_items/v1/node.json' with { type: 'json' };
import github_app_definition from '@connectors/apps/github/app.json' with { type: 'json' };
import * as github_create_issues_v1_execute from '@connectors/apps/github/create_issues/v1/execute';
import github_create_issues_v1_definition from '@connectors/apps/github/create_issues/v1/node.json' with { type: 'json' };
import * as github_list_issues_v1_execute from '@connectors/apps/github/list_issues/v1/execute';
import github_list_issues_v1_definition from '@connectors/apps/github/list_issues/v1/node.json' with { type: 'json' };
import * as github_list_pull_requests_v1_execute from '@connectors/apps/github/list_pull_requests/v1/execute';
import github_list_pull_requests_v1_definition from '@connectors/apps/github/list_pull_requests/v1/node.json' with { type: 'json' };
import * as github_list_repos_v1_execute from '@connectors/apps/github/list_repos/v1/execute';
import github_list_repos_v1_definition from '@connectors/apps/github/list_repos/v1/node.json' with { type: 'json' };
import * as github_search_code_v1_execute from '@connectors/apps/github/search_code/v1/execute';
import github_search_code_v1_definition from '@connectors/apps/github/search_code/v1/node.json' with { type: 'json' };
import gmail_app_definition from '@connectors/apps/gmail/app.json' with { type: 'json' };
import * as gmail_list_labels_v1_execute from '@connectors/apps/gmail/list_labels/v1/execute';
import gmail_list_labels_v1_definition from '@connectors/apps/gmail/list_labels/v1/node.json' with { type: 'json' };
import * as gmail_list_messages_v1_execute from '@connectors/apps/gmail/list_messages/v1/execute';
import gmail_list_messages_v1_definition from '@connectors/apps/gmail/list_messages/v1/node.json' with { type: 'json' };
import * as gmail_modify_labels_v1_execute from '@connectors/apps/gmail/modify_labels/v1/execute';
import gmail_modify_labels_v1_definition from '@connectors/apps/gmail/modify_labels/v1/node.json' with { type: 'json' };
import * as gmail_send_messages_v1_execute from '@connectors/apps/gmail/send_messages/v1/execute';
import gmail_send_messages_v1_definition from '@connectors/apps/gmail/send_messages/v1/node.json' with { type: 'json' };
import google_drive_app_definition from '@connectors/apps/google_drive/app.json' with { type: 'json' };
import * as google_drive_export_files_v1_execute from '@connectors/apps/google_drive/export_files/v1/execute';
import google_drive_export_files_v1_definition from '@connectors/apps/google_drive/export_files/v1/node.json' with { type: 'json' };
import * as google_drive_list_changes_v1_execute from '@connectors/apps/google_drive/list_changes/v1/execute';
import google_drive_list_changes_v1_definition from '@connectors/apps/google_drive/list_changes/v1/node.json' with { type: 'json' };
import * as google_drive_list_files_v1_execute from '@connectors/apps/google_drive/list_files/v1/execute';
import google_drive_list_files_v1_definition from '@connectors/apps/google_drive/list_files/v1/node.json' with { type: 'json' };
import * as google_drive_list_folders_v1_execute from '@connectors/apps/google_drive/list_folders/v1/execute';
import google_drive_list_folders_v1_definition from '@connectors/apps/google_drive/list_folders/v1/node.json' with { type: 'json' };
import granola_app_definition from '@connectors/apps/granola/app.json' with { type: 'json' };
import granola_list_folders_v1_definition from '@connectors/apps/granola/list_folders/v1/node.json' with { type: 'json' };
import * as granola_list_notes_v1_execute from '@connectors/apps/granola/list_notes/v1/execute';
import granola_list_notes_v1_definition from '@connectors/apps/granola/list_notes/v1/node.json' with { type: 'json' };
import * as granola_read_notes_v1_execute from '@connectors/apps/granola/read_notes/v1/execute';
import granola_read_notes_v1_definition from '@connectors/apps/granola/read_notes/v1/node.json' with { type: 'json' };
import * as granola_read_transcripts_v1_execute from '@connectors/apps/granola/read_transcripts/v1/execute';
import granola_read_transcripts_v1_definition from '@connectors/apps/granola/read_transcripts/v1/node.json' with { type: 'json' };
import hubspot_app_definition from '@connectors/apps/hubspot/app.json' with { type: 'json' };
import * as hubspot_create_records_v1_execute from '@connectors/apps/hubspot/create_records/v1/execute';
import hubspot_create_records_v1_definition from '@connectors/apps/hubspot/create_records/v1/node.json' with { type: 'json' };
import * as hubspot_list_object_types_v1_execute from '@connectors/apps/hubspot/list_object_types/v1/execute';
import hubspot_list_object_types_v1_definition from '@connectors/apps/hubspot/list_object_types/v1/node.json' with { type: 'json' };
import * as hubspot_list_records_v1_execute from '@connectors/apps/hubspot/list_records/v1/execute';
import hubspot_list_records_v1_definition from '@connectors/apps/hubspot/list_records/v1/node.json' with { type: 'json' };
import hubspot_search_records_v1_definition from '@connectors/apps/hubspot/search_records/v1/node.json' with { type: 'json' };
import * as hubspot_update_records_v1_execute from '@connectors/apps/hubspot/update_records/v1/execute';
import hubspot_update_records_v1_definition from '@connectors/apps/hubspot/update_records/v1/node.json' with { type: 'json' };
import notion_app_definition from '@connectors/apps/notion/app.json' with { type: 'json' };
import * as notion_create_pages_v1_execute from '@connectors/apps/notion/create_pages/v1/execute';
import notion_create_pages_v1_definition from '@connectors/apps/notion/create_pages/v1/node.json' with { type: 'json' };
import * as notion_query_databases_v1_execute from '@connectors/apps/notion/query_databases/v1/execute';
import notion_query_databases_v1_definition from '@connectors/apps/notion/query_databases/v1/node.json' with { type: 'json' };
import * as notion_read_blocks_v1_execute from '@connectors/apps/notion/read_blocks/v1/execute';
import notion_read_blocks_v1_definition from '@connectors/apps/notion/read_blocks/v1/node.json' with { type: 'json' };
import * as notion_search_pages_v1_execute from '@connectors/apps/notion/search_pages/v1/execute';
import notion_search_pages_v1_definition from '@connectors/apps/notion/search_pages/v1/node.json' with { type: 'json' };
import salesforce_app_definition from '@connectors/apps/salesforce/app.json' with { type: 'json' };
import * as salesforce_create_records_v1_execute from '@connectors/apps/salesforce/create_records/v1/execute';
import salesforce_create_records_v1_definition from '@connectors/apps/salesforce/create_records/v1/node.json' with { type: 'json' };
import * as salesforce_list_object_types_v1_execute from '@connectors/apps/salesforce/list_object_types/v1/execute';
import salesforce_list_object_types_v1_definition from '@connectors/apps/salesforce/list_object_types/v1/node.json' with { type: 'json' };
import * as salesforce_query_records_v1_execute from '@connectors/apps/salesforce/query_records/v1/execute';
import salesforce_query_records_v1_definition from '@connectors/apps/salesforce/query_records/v1/node.json' with { type: 'json' };
import * as salesforce_update_records_v1_execute from '@connectors/apps/salesforce/update_records/v1/execute';
import salesforce_update_records_v1_definition from '@connectors/apps/salesforce/update_records/v1/node.json' with { type: 'json' };
import slack_app_definition from '@connectors/apps/slack/app.json' with { type: 'json' };
import * as slack_list_channels_v1_execute from '@connectors/apps/slack/list_channels/v1/execute';
import slack_list_channels_v1_definition from '@connectors/apps/slack/list_channels/v1/node.json' with { type: 'json' };
import * as slack_list_messages_v1_execute from '@connectors/apps/slack/list_messages/v1/execute';
import slack_list_messages_v1_definition from '@connectors/apps/slack/list_messages/v1/node.json' with { type: 'json' };
import * as slack_send_messages_v1_execute from '@connectors/apps/slack/send_messages/v1/execute';
import slack_send_messages_v1_definition from '@connectors/apps/slack/send_messages/v1/node.json' with { type: 'json' };
import type { ConnectorAppModule, ConnectorNodeModule } from '@connectors/types';

export const connector_app_modules: readonly ConnectorAppModule[] = [
  { source_path: 'apps/attio/app.json', definition: attio_app_definition },
  { source_path: 'apps/example/app.json', definition: example_app_definition },
  { source_path: 'apps/github/app.json', definition: github_app_definition },
  { source_path: 'apps/gmail/app.json', definition: gmail_app_definition },
  { source_path: 'apps/google_drive/app.json', definition: google_drive_app_definition },
  { source_path: 'apps/granola/app.json', definition: granola_app_definition },
  { source_path: 'apps/hubspot/app.json', definition: hubspot_app_definition },
  { source_path: 'apps/notion/app.json', definition: notion_app_definition },
  { source_path: 'apps/salesforce/app.json', definition: salesforce_app_definition },
  { source_path: 'apps/slack/app.json', definition: slack_app_definition },
];

export const connector_node_modules: readonly ConnectorNodeModule[] = [
  { source_path: 'apps/attio/create_note/v1/node.json', definition: attio_create_note_v1_definition, execute_module: attio_create_note_v1_execute },
  { source_path: 'apps/attio/create_records/v1/node.json', definition: attio_create_records_v1_definition, execute_module: attio_create_records_v1_execute },
  { source_path: 'apps/attio/list_objects/v1/node.json', definition: attio_list_objects_v1_definition },
  { source_path: 'apps/attio/list_records/v1/node.json', definition: attio_list_records_v1_definition, execute_module: attio_list_records_v1_execute },
  { source_path: 'apps/attio/update_records/v1/node.json', definition: attio_update_records_v1_definition, execute_module: attio_update_records_v1_execute },
  { source_path: 'apps/example/collect_items/v1/node.json', definition: example_collect_items_v1_definition, execute_module: example_collect_items_v1_execute },
  { source_path: 'apps/example/echo_items/v1/node.json', definition: example_echo_items_v1_definition },
  { source_path: 'apps/github/create_issues/v1/node.json', definition: github_create_issues_v1_definition, execute_module: github_create_issues_v1_execute },
  { source_path: 'apps/github/list_issues/v1/node.json', definition: github_list_issues_v1_definition, execute_module: github_list_issues_v1_execute },
  { source_path: 'apps/github/list_pull_requests/v1/node.json', definition: github_list_pull_requests_v1_definition, execute_module: github_list_pull_requests_v1_execute },
  { source_path: 'apps/github/list_repos/v1/node.json', definition: github_list_repos_v1_definition, execute_module: github_list_repos_v1_execute },
  { source_path: 'apps/github/search_code/v1/node.json', definition: github_search_code_v1_definition, execute_module: github_search_code_v1_execute },
  { source_path: 'apps/gmail/list_labels/v1/node.json', definition: gmail_list_labels_v1_definition, execute_module: gmail_list_labels_v1_execute },
  { source_path: 'apps/gmail/list_messages/v1/node.json', definition: gmail_list_messages_v1_definition, execute_module: gmail_list_messages_v1_execute },
  { source_path: 'apps/gmail/modify_labels/v1/node.json', definition: gmail_modify_labels_v1_definition, execute_module: gmail_modify_labels_v1_execute },
  { source_path: 'apps/gmail/send_messages/v1/node.json', definition: gmail_send_messages_v1_definition, execute_module: gmail_send_messages_v1_execute },
  { source_path: 'apps/google_drive/export_files/v1/node.json', definition: google_drive_export_files_v1_definition, execute_module: google_drive_export_files_v1_execute },
  { source_path: 'apps/google_drive/list_changes/v1/node.json', definition: google_drive_list_changes_v1_definition, execute_module: google_drive_list_changes_v1_execute },
  { source_path: 'apps/google_drive/list_files/v1/node.json', definition: google_drive_list_files_v1_definition, execute_module: google_drive_list_files_v1_execute },
  { source_path: 'apps/google_drive/list_folders/v1/node.json', definition: google_drive_list_folders_v1_definition, execute_module: google_drive_list_folders_v1_execute },
  { source_path: 'apps/granola/list_folders/v1/node.json', definition: granola_list_folders_v1_definition },
  { source_path: 'apps/granola/list_notes/v1/node.json', definition: granola_list_notes_v1_definition, execute_module: granola_list_notes_v1_execute },
  { source_path: 'apps/granola/read_notes/v1/node.json', definition: granola_read_notes_v1_definition, execute_module: granola_read_notes_v1_execute },
  { source_path: 'apps/granola/read_transcripts/v1/node.json', definition: granola_read_transcripts_v1_definition, execute_module: granola_read_transcripts_v1_execute },
  { source_path: 'apps/hubspot/create_records/v1/node.json', definition: hubspot_create_records_v1_definition, execute_module: hubspot_create_records_v1_execute },
  { source_path: 'apps/hubspot/list_object_types/v1/node.json', definition: hubspot_list_object_types_v1_definition, execute_module: hubspot_list_object_types_v1_execute },
  { source_path: 'apps/hubspot/list_records/v1/node.json', definition: hubspot_list_records_v1_definition, execute_module: hubspot_list_records_v1_execute },
  { source_path: 'apps/hubspot/search_records/v1/node.json', definition: hubspot_search_records_v1_definition },
  { source_path: 'apps/hubspot/update_records/v1/node.json', definition: hubspot_update_records_v1_definition, execute_module: hubspot_update_records_v1_execute },
  { source_path: 'apps/notion/create_pages/v1/node.json', definition: notion_create_pages_v1_definition, execute_module: notion_create_pages_v1_execute },
  { source_path: 'apps/notion/query_databases/v1/node.json', definition: notion_query_databases_v1_definition, execute_module: notion_query_databases_v1_execute },
  { source_path: 'apps/notion/read_blocks/v1/node.json', definition: notion_read_blocks_v1_definition, execute_module: notion_read_blocks_v1_execute },
  { source_path: 'apps/notion/search_pages/v1/node.json', definition: notion_search_pages_v1_definition, execute_module: notion_search_pages_v1_execute },
  { source_path: 'apps/salesforce/create_records/v1/node.json', definition: salesforce_create_records_v1_definition, execute_module: salesforce_create_records_v1_execute },
  { source_path: 'apps/salesforce/list_object_types/v1/node.json', definition: salesforce_list_object_types_v1_definition, execute_module: salesforce_list_object_types_v1_execute },
  { source_path: 'apps/salesforce/query_records/v1/node.json', definition: salesforce_query_records_v1_definition, execute_module: salesforce_query_records_v1_execute },
  { source_path: 'apps/salesforce/update_records/v1/node.json', definition: salesforce_update_records_v1_definition, execute_module: salesforce_update_records_v1_execute },
  { source_path: 'apps/slack/list_channels/v1/node.json', definition: slack_list_channels_v1_definition, execute_module: slack_list_channels_v1_execute },
  { source_path: 'apps/slack/list_messages/v1/node.json', definition: slack_list_messages_v1_definition, execute_module: slack_list_messages_v1_execute },
  { source_path: 'apps/slack/send_messages/v1/node.json', definition: slack_send_messages_v1_definition, execute_module: slack_send_messages_v1_execute },
];
