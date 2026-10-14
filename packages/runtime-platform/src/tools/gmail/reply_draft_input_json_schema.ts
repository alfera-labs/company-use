import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';

const address_list = (description: string) => ({
  type: 'array' as const,
  items: { type: 'string' as const },
  maxItems: 20,
  description,
});

export const reply_draft_input_json_schema: NodeInputSchemaData = {
  type: 'object',
  properties: {
    reply_to_message_id: {
      type: 'string',
      description: 'Gmail message id of the email you are answering (not the thread id).',
    },
    subject: {
      type: 'string',
      description: 'The subject line exactly as it should appear. It is not changed to "Re: ...".',
    },
    body: { type: 'string', description: 'The complete reply body.' },
    body_type: {
      type: 'string',
      enum: ['html', 'plaintext'],
      description: 'How to read body. Defaults to plaintext.',
    },
    to: address_list(
      'Recipients. Leave empty to answer the original sender (its Reply-To, else its From).',
    ),
    cc: address_list('Addresses to copy.'),
    bcc: address_list('Addresses to blind copy.'),
    attachment_paths: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      description:
        'Workspace file paths to attach, for example ["files/brochure.pdf"]. Up to 25 MB in total.',
    },
    attachment_names: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      description:
        'Optional display names for the attachments, in the same order as attachment_paths.',
    },
    connection_id: {
      type: 'string',
      description: 'Which Gmail connection to use when there is more than one.',
    },
  },
  required: ['reply_to_message_id', 'subject', 'body'],
  additionalProperties: false,
};
