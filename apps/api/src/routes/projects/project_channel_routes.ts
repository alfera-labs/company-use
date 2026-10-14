import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import {
  read_manageable_project_or_raise,
  read_project_or_raise,
} from '@api/routes/projects/project_reader';
import {
  list_project_channels,
  set_channel_project,
} from '@coworker/core/db/queries/channel_projects';
import { NotFoundError } from '@coworker/shared';
import { Hono } from 'hono';

// The channels a project works in (a Slack #sales in Sales). Putting a channel in a project happens
// on the channel's own setting (PUT /v1/slack/channel-settings/:channel_id with project_id); the
// project page lists them and can take one out.
export const project_channel_routes = new Hono<ApiEnv>()
  .get('/v1/projects/:project_id/channels', async (c) => {
    const project = await read_project_or_raise(c, c.req.param('project_id'));
    const channels = await list_project_channels(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
    });
    return c.json(ok(channels));
  })
  .delete('/v1/projects/:project_id/channels/:channel_route_id', async (c) => {
    const project = await read_manageable_project_or_raise(c, c.req.param('project_id'));
    const channel_route_id = c.req.param('channel_route_id');
    const linked = await list_project_channels(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: project.project_id,
    });
    if (!linked.some((channel) => channel.channel_route_id === channel_route_id)) {
      throw new NotFoundError('Channel');
    }
    await set_channel_project(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      channel_route_id,
      project_id: null,
      actor_id: c.get('user_id'),
    });
    return c.body(null, 204);
  });
