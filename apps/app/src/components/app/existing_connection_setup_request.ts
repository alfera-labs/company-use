import { z } from 'zod';

const existing_connection_setup_response_schema = z.object({
  data: z.object({
    connection_id: z.string().min(1),
    setup_url: z.string().min(1),
    app: z
      .object({
        app_id: z.string(),
        app_name: z.string(),
        app_display_name: z.string(),
        display_config: z.record(z.string(), z.unknown()),
        metadata: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
});
const api_error_response_schema = z.object({
  error: z.object({ message: z.string().trim().min(1) }),
});

type ExistingConnectionSetupResult = z.infer<
  typeof existing_connection_setup_response_schema
>['data'];

export async function load_existing_connection_setup(input: {
  connection_id: string;
  setup_token: string;
  api_origin: string;
}): Promise<ExistingConnectionSetupResult> {
  const url = new URL('/v1/connections/setup/start', input.api_origin);
  url.searchParams.set('connection_id', input.connection_id);
  url.searchParams.set('setup_token', input.setup_token);

  const response = await fetch(url.toString(), { method: 'GET', credentials: 'omit' });
  if (!response.ok) {
    throw new Error((await read_api_error_message(response)) ?? 'Connection setup link failed.');
  }

  return existing_connection_setup_response_schema.parse(await response.json()).data;
}

async function read_api_error_message(response: Response) {
  try {
    return api_error_response_schema.parse(await response.json()).error.message;
  } catch {
    return null;
  }
}
