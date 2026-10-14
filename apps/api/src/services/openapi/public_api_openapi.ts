import {
  type RouteDescriptor,
  request_component_schemas,
  route_descriptors,
} from '@api/services/openapi/public_api_routes';
import { public_api_origin } from '@coworker/config/hosted_defaults';
import type { OpenAPIV3_1 } from 'openapi-types';
import { z } from 'zod';

export const openapi_document_version = '0.2.0';

export const public_api_paths = route_descriptors.map((route) => route.path);

const hosted_server = { url: public_api_origin, description: 'Production' };

/**
 * The server the document names. A self-hosted install answers at its own address: the public
 * one when it is configured, else the one this request came to.
 */
export function describe_public_api_server(install: {
  is_self_hosted: boolean;
  public_api_url?: string | undefined;
  request_url: string;
}): OpenAPIV3_1.ServerObject {
  if (!install.is_self_hosted) return hosted_server;
  const url = new URL(install.public_api_url ?? install.request_url).origin;
  return { url, description: 'This install' };
}

export function build_public_api_openapi_document(): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Alfera API',
      version: openapi_document_version,
      description:
        'The public API: hand a coworker a job, watch it run, read what it produced. ' +
        'Authenticate with a workspace API key as `Authorization: Bearer ak_...`; the same ' +
        'key opens the MCP endpoint at POST /v1/mcp. Additive-only within /v1: fields may ' +
        'appear, never change type or vanish; breaking changes are a new prefix. Clients must ' +
        'ignore unknown fields.',
    },
    servers: [hosted_server],
    security: [{ bearer_api_key: [] }],
    // The path and schema tables are assembled as plain data and cast at this one boundary:
    // openapi-types@12.1.3 defines OperationObject through a mix of its V3 and V3_1 namespaces that
    // does not type-check under this repo's exactOptionalPropertyTypes. The values are valid
    // OpenAPI 3.1 either way, and the exported return type still holds callers to Document.
    paths: build_paths() as OpenAPIV3_1.PathsObject,
    components: {
      securitySchemes: {
        bearer_api_key: {
          type: 'http',
          scheme: 'bearer',
          description: 'A workspace API key, sent as `Authorization: Bearer ak_...`.',
        },
      },
      schemas: build_component_schemas() as Record<string, OpenAPIV3_1.SchemaObject>,
    },
  };
}

function build_paths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of route_descriptors) {
    const item = paths[route.path] ?? {};
    paths[route.path] = item;
    item[route.method] = build_operation(route);
  }
  return paths;
}

function build_operation(route: RouteDescriptor): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    summary: route.summary,
    responses: {
      [route.success_status]: { description: 'Success' },
      default: {
        description: 'A named error.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  };
  if (route.auth === 'public') operation.security = [];
  if (route.path_params?.length) operation.parameters = route.path_params.map(path_parameter);
  if (route.request) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': { schema: { $ref: `#/components/schemas/${route.request}` } },
      },
    };
  }
  return operation;
}

function path_parameter(name: string): Record<string, unknown> {
  return { name, in: 'path', required: true, schema: { type: 'string' } };
}

function build_component_schemas(): Record<string, unknown> {
  const schemas: Record<string, unknown> = { Error: error_schema };
  for (const [name, schema] of Object.entries(request_component_schemas)) {
    schemas[name] = zod_to_openapi_schema(schema);
  }
  return schemas;
}

const error_schema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
    },
  },
};

function zod_to_openapi_schema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
