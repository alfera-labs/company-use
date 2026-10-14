import { update_automation_body_schema } from '@api/routes/automations';
import { create_automation_body_schema } from '@api/routes/public_automations';
import type { RouteDescriptor } from '@api/services/openapi/public_api_routes';
import type { z } from 'zod';

export const answer_request_schemas: Record<string, z.ZodType> = {};
export const memory_request_schemas: Record<string, z.ZodType> = {};

export const automation_request_schemas: Record<string, z.ZodType> = {
  CreateAutomationRequest: create_automation_body_schema,
  UpdateAutomationRequest: update_automation_body_schema,
};

export const automation_route_descriptors: RouteDescriptor[] = [
  {
    method: 'post',
    path: '/v1/automations',
    summary: 'Create an automation and every way it starts.',
    auth: 'bearer',
    request: 'CreateAutomationRequest',
    success_status: '201',
  },
  {
    method: 'get',
    path: '/v1/automations',
    summary: 'List the workspace automations.',
    auth: 'bearer',
    success_status: '200',
  },
  {
    method: 'get',
    path: '/v1/automations/{automation_id}',
    summary: 'Read one automation.',
    auth: 'bearer',
    path_params: ['automation_id'],
    success_status: '200',
  },
  {
    method: 'patch',
    path: '/v1/automations/{automation_id}',
    summary: 'Pause, resume, or rewrite an automation.',
    auth: 'bearer',
    request: 'UpdateAutomationRequest',
    path_params: ['automation_id'],
    success_status: '200',
  },
  {
    method: 'delete',
    path: '/v1/automations/{automation_id}',
    summary: 'Delete an automation and take its triggers down.',
    auth: 'bearer',
    path_params: ['automation_id'],
    success_status: '200',
  },
  {
    method: 'post',
    path: '/v1/automations/{automation_id}/trigger',
    summary: 'Start an automation run now.',
    auth: 'bearer',
    path_params: ['automation_id'],
    success_status: '202',
  },
  {
    method: 'get',
    path: '/v1/automations/{automation_id}/runs',
    summary: "List an automation's runs, newest first.",
    auth: 'bearer',
    path_params: ['automation_id'],
    success_status: '200',
  },
];

export const usage_route_descriptors: RouteDescriptor[] = [];
export const memory_route_descriptors: RouteDescriptor[] = [];
export const answer_route_descriptors: RouteDescriptor[] = [];
