import { authenticate_api_key } from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { anthropic_count_tokens, anthropic_messages } from '@api/routes/compat/anthropic_messages';
import { openai_models } from '@api/routes/compat/compat_models';
import { openai_chat_completions } from '@api/routes/compat/openai_chat_completions';
import { openai_responses } from '@api/routes/compat/openai_responses';
import { Hono } from 'hono';

export const compat_routes = new Hono<ApiEnv>()
  .use('/api/compat/*', authenticate_api_key('chat.completions'))
  .post('/api/compat/v1/chat/completions', openai_chat_completions)
  .post('/api/compat/v1/responses', openai_responses)
  .post('/api/compat/v1/messages/count_tokens', anthropic_count_tokens)
  .post('/api/compat/v1/messages', anthropic_messages)
  .get('/api/compat/v1/models', openai_models);
