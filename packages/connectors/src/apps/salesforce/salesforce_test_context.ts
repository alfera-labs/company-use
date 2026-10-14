import app_definition from '@connectors/apps/salesforce/app.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { fan_out } from '@connectors/runtime/fan_out';
import type {
  ConnectorApp,
  ConnectorConnectionReference,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import { create_logger } from '@coworker/shared';

export { app_definition as salesforce_app_definition };

if (app_definition.auth.kind !== 'oauth2') {
  throw new Error('salesforce app.json must declare an oauth2 app.');
}

const salesforce_app: ConnectorApp = {
  app_key: app_definition.app_key,
  display_name: app_definition.display_name,
  base_url: app_definition.base_url,
  rate_limits: app_definition.rate_limits,
  auth: { ...app_definition.auth, kind: 'oauth2' },
};

export type RecordedRequest = {
  base_url: string;
  method: string;
  path: string;
  query: Record<string, unknown> | undefined;
  body: unknown;
};

export type SalesforceTestContext = {
  context: ConnectorNodeContext;
  requests: RecordedRequest[];
};

export const salesforce_test_instance_url = 'https://acme.my.salesforce.com';

function build_salesforce_test_connection(
  instance_url: string = salesforce_test_instance_url,
): ConnectorConnectionReference {
  const connection: ConnectorConnectionReference & { instance_url: string } = {
    connection_id: 'conn_salesforce_fixture',
    instance_url,
  };
  return connection;
}

export function build_connection_without_instance_url(): ConnectorConnectionReference {
  return { connection_id: 'conn_salesforce_no_instance' };
}

export function build_salesforce_test_context(
  respond: (request: RecordedRequest, call_index: number) => unknown,
  connection: ConnectorConnectionReference = build_salesforce_test_connection(),
): SalesforceTestContext {
  const requests: RecordedRequest[] = [];

  const send_request = async <TParsed>(request: ConnectorNodeRequest) => {
    const request_app = (request as ConnectorNodeRequest & { app?: { base_url: string } }).app;
    const recorded: RecordedRequest = {
      base_url: request_app?.base_url ?? salesforce_app.base_url,
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
    };
    requests.push(recorded);

    const payload = respond(recorded, requests.length - 1);
    const violation = find_json_schema_violation(request.response_schema, payload, 'response');
    if (violation) throw new Error(`Fixture does not match response_schema: ${violation}`);
    return payload as TParsed;
  };

  const send_request_for_response = async <TParsed>(request: ConnectorNodeRequest) => ({
    body: await send_request<TParsed>(request),
    headers: {},
    status: 200,
  });

  return {
    context: {
      app: salesforce_app,
      connection,
      send_request,
      send_request_for_response,
      fan_out,
      log: create_logger('salesforce_test'),
    },
    requests,
  };
}

export function list_required_output_keys(output_schema: { required?: readonly string[] }) {
  return [...(output_schema.required ?? [])].sort();
}
