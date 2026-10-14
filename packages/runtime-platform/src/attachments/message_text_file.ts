import { generate_agent_visible_path } from '@agent-core/environment/agent_visible_path';
import type { SessionEnv } from '@agent-core/environment/session_env';
import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import { create_logger, format_error_message } from '@coworker/shared';

const log = create_logger('message_text_file');

const message_text_file_threshold_chars = 2_000;
export const message_text_file_path = 'tmp/message.md';

export type WrittenMessageTextFile = { path: string; byte_count: number };

export async function write_message_text_file(
  environment: SessionEnv | undefined,
  text: string,
): Promise<WrittenMessageTextFile | undefined> {
  if (text.length < message_text_file_threshold_chars || !environment?.write) return undefined;
  try {
    await environment.write(message_text_file_path, text);
    return {
      path: generate_agent_visible_path(environment, message_text_file_path),
      byte_count: Buffer.byteLength(text, 'utf8'),
    };
  } catch (error) {
    log.warn('Could not write the message text file.', {
      error: format_error_message(error),
    });
    return undefined;
  }
}

export function describe_message_text_file(
  written: WrittenMessageTextFile | undefined,
): RuntimeAgentMessagePart[] {
  if (!written) return [];
  return [
    {
      type: 'text',
      text: `The message above is also saved as a file at ${written.path} (${written.byte_count} bytes). When it holds data to move — rows, records, a list — read it from there with a script; do not retype it by hand.`,
    },
  ];
}
