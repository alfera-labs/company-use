import { automation_tools } from '@runtime-platform/tools/definitions/automations';
import { chat_respond_tool } from '@runtime-platform/tools/definitions/chat_respond';
import { company_memory_tools } from '@runtime-platform/tools/definitions/company_memory_tools';
import { goal_tools } from '@runtime-platform/tools/definitions/goals';
import { math_calculate_tool } from '@runtime-platform/tools/definitions/math_calculate';
import { member_link_tools } from '@runtime-platform/tools/definitions/member_link_tools';
import { notification_tools } from '@runtime-platform/tools/definitions/notifications';
import { present_choices_tool } from '@runtime-platform/tools/definitions/present_choices';
import { runtime_add_mcp_server_tool } from '@runtime-platform/tools/definitions/runtime_add_mcp_server';
import { runtime_create_connection_tool } from '@runtime-platform/tools/definitions/runtime_create_connection';
import { runtime_execute_tool_tool } from '@runtime-platform/tools/definitions/runtime_execute_tool';
import { runtime_get_tool_schema_tool } from '@runtime-platform/tools/definitions/runtime_get_tool_schema';
import { runtime_image_search_tool } from '@runtime-platform/tools/definitions/runtime_image_search';
import { runtime_list_connections_tool } from '@runtime-platform/tools/definitions/runtime_list_connections';
import { runtime_list_tool_field_options_tool } from '@runtime-platform/tools/definitions/runtime_list_tool_field_options';
import { runtime_load_skill_tool } from '@runtime-platform/tools/definitions/runtime_load_skill';
import { runtime_propose_app_sign_in_tool } from '@runtime-platform/tools/definitions/runtime_propose_app_sign_in';
import { runtime_read_attachment_tool } from '@runtime-platform/tools/definitions/runtime_read_attachment';
import { runtime_read_url_tool } from '@runtime-platform/tools/definitions/runtime_read_url';
import { runtime_refresh_app_credential_tool } from '@runtime-platform/tools/definitions/runtime_refresh_app_credential';
import { runtime_run_program_tool } from '@runtime-platform/tools/definitions/runtime_run_program';
import { runtime_save_procedure_rule_tool } from '@runtime-platform/tools/definitions/runtime_save_procedure_rule';
import { runtime_search_context_tool } from '@runtime-platform/tools/definitions/runtime_search_context';
import { runtime_search_tools_tool } from '@runtime-platform/tools/definitions/runtime_search_tools';
import { runtime_set_agent_name_tool } from '@runtime-platform/tools/definitions/runtime_set_agent_name';
import { runtime_web_search_tool } from '@runtime-platform/tools/definitions/runtime_web_search';
import { scheduled_task_tools } from '@runtime-platform/tools/definitions/scheduled_tasks';
import { session_tools } from '@runtime-platform/tools/definitions/sessions';
import { email_create_address_tool } from '@runtime-platform/tools/email/create_address';
import { email_respond_tool } from '@runtime-platform/tools/email/respond';
import { email_send_tool } from '@runtime-platform/tools/email/send';
import { gmail_create_reply_draft_tool } from '@runtime-platform/tools/gmail/create_reply_draft_tool';
import { slack_join_channel_tool } from '@runtime-platform/tools/slack/join_channel';
import { slack_list_channels_tool } from '@runtime-platform/tools/slack/list_channels';
import { slack_list_workspace_members_tool } from '@runtime-platform/tools/slack/list_workspace_members';
import { slack_read_file_tool } from '@runtime-platform/tools/slack/read_file';
import { slack_read_history_tool } from '@runtime-platform/tools/slack/read_history';
import { slack_respond_tool } from '@runtime-platform/tools/slack/respond';
import { slack_send_message_tool } from '@runtime-platform/tools/slack/send_message';
import { slack_upload_file_tool } from '@runtime-platform/tools/slack/upload_file';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

const tool_definitions = [
  runtime_search_context_tool,
  ...company_memory_tools,
  runtime_search_tools_tool,
  runtime_get_tool_schema_tool,
  runtime_list_tool_field_options_tool,
  runtime_list_connections_tool,
  runtime_add_mcp_server_tool,
  runtime_create_connection_tool,
  runtime_load_skill_tool,
  runtime_execute_tool_tool,
  runtime_run_program_tool,
  runtime_web_search_tool,
  runtime_read_url_tool,
  runtime_read_attachment_tool,
  runtime_image_search_tool,
  runtime_save_procedure_rule_tool,
  runtime_refresh_app_credential_tool,
  runtime_propose_app_sign_in_tool,
  runtime_set_agent_name_tool,
  ...member_link_tools,
  present_choices_tool,
  chat_respond_tool,
  math_calculate_tool,
  email_create_address_tool,
  email_respond_tool,
  email_send_tool,
  gmail_create_reply_draft_tool,
  slack_join_channel_tool,
  slack_list_channels_tool,
  slack_list_workspace_members_tool,
  slack_read_file_tool,
  slack_read_history_tool,
  slack_respond_tool,
  slack_send_message_tool,
  slack_upload_file_tool,
  ...scheduled_task_tools,
  ...automation_tools,
  ...notification_tools,
  ...goal_tools,
  ...session_tools,
] satisfies RuntimeToolDefinition[];

const tool_map = new Map(tool_definitions.map((tool) => [tool.node_key, tool]));

export function get_all_tools() {
  return [...tool_definitions];
}

export function find_tool_by_node_key(node_key: string) {
  return tool_map.get(node_key) ?? null;
}
