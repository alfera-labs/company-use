import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const googlecalendar_recipe: ComposioRecipe = {
  toolkit_slug: 'GOOGLECALENDAR',
  app_display_name: 'Google Calendar',
  prompt: 'Choose which Google Calendar to sync',
  dimensions: [
    {
      key: 'calendars',
      label: 'Calendars',
      shape: 'flat',
      list_scope_options: { node_key: 'google_calendar_v2-list_calendars-1' },
      option_mapping: {
        id: { $: 'item.id' },
        label: { $default: [{ $: 'item.summary' }, { $: 'item.id' }] },
        kind: 'calendar',
        selectable: true,
      },
      allow_select_all: true,
    },
  ],
  objects: {
    event: {
      label: 'Event',
      list_items: { node_key: 'google_calendar_v2-events_list-1' },
      scoped_by: {
        calendars: 'calendarId',
      },
      page: {
        cursor_param: 'pageToken',
        items: { $: 'response.items' },
        next_cursor: { $: 'response.nextPageToken' },
      },
      strategy: 'modified_since',
      cursor: {
        field: { $: 'item.updated' },
        param: 'updatedMin',
        marker_format: 'iso_time',
        overlap_minutes: 5,
        max_age_days: 20,
        expired_error_contains: ['updatedMinTooLongAgo'],
      },
      identity: { $: 'item.id' },
      version_signal: { $: 'item.updated' },
      tombstone: { $: 'item.status' },
      title: { $default: [{ $: 'item.summary' }, '(no title)'] },
      content: {
        summary: { $: 'item.summary' },
        description: { $: 'item.description' },
        start: { $default: [{ $: 'item.start.dateTime' }, { $: 'item.start.date' }] },
        end: { $default: [{ $: 'item.end.dateTime' }, { $: 'item.end.date' }] },
        location: { $: 'item.location' },
        attendees: { $map: { from: { $: 'item.attendees' }, to: { $: 'item.email' } } },
      },
      item_kind: 'calendar_event',
      container: {
        id: { $: 'scope.id' },
        path: { $: 'scope.label' },
      },
      metadata: {
        start_time: { $: 'item.start' },
        end_time: { $: 'item.end' },
        location: { $: 'item.location' },
      },
      source_url: { $: 'item.htmlLink' },
      relationships: {
        attendee: { $map: { from: { $: 'item.attendees' }, to: { $: 'item.email' } } },
        organizer: { $: 'item.organizer.email' },
      },
      note: 'GOOGLECALENDAR_LIST_EVENTS does not exist; the real tool is GOOGLECALENDAR_EVENTS_LIST, whose request uses calendarId/updatedMin/pageToken and whose response uses items/nextPageToken. Attendee/organizer relationships read the email off each attendee object, since Google Calendar identifies people by email. Google Calendar has no boolean cancelled field; a cancelled event sets status to the string "cancelled", which the value expression language cannot compare for equality yet, so tombstone reads item.status as a documented gap rather than the nonexistent item.cancelled. Google rejects an updatedMin more than a few weeks old with HTTP 410 reason updatedMinTooLongAgo and does not publish the exact limit (the 2026-10-08 production source failed with a watermark 64 days old), so the cursor treats a watermark older than 20 days as unusable and relists the calendar, and relists once more if Google still answers updatedMinTooLongAgo. Because the cursor declares max_age_days, a finished walk stores the time the walk began as the watermark, not the newest event edit, so a quiet calendar keeps a fresh watermark and the next sync is incremental. The 5 minute overlap covers clock drift between this server and Google.',
    },
  },
};
