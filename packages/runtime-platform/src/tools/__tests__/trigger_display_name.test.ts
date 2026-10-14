import {
  format_trigger_display_name,
  format_trigger_display_name_without_app,
} from '@runtime-platform/tools/trigger_display_name';
import { describe, expect, it } from 'vitest';

describe('format_trigger_display_name', () => {
  it('drops the trailing "Trigger" and sentence-cases the rest, keeping its own app name', () => {
    expect(format_trigger_display_name('New Gmail Message Received Trigger', 'Gmail')).toBe(
      'New Gmail message received',
    );
    expect(format_trigger_display_name('Email Sent')).toBe('Email sent');
  });

  it("keeps capitals only for the trigger's own app, not for another brand", () => {
    expect(format_trigger_display_name('Page Shared In Slack', 'Notion')).toBe(
      'Page shared in slack',
    );
  });

  it('leaves a name that is already a sentence alone', () => {
    expect(format_trigger_display_name('Before or after an event')).toBe(
      'Before or after an event',
    );
  });

  it("keeps the words of the trigger's own app, and spellings that are not title case", () => {
    expect(
      format_trigger_display_name('Google Calendar Event Created Trigger', 'Google Calendar'),
    ).toBe('Google Calendar event created');
    expect(format_trigger_display_name('New GitHub PR Opened')).toBe('New GitHub PR opened');
    expect(format_trigger_display_name('New HubSpot Contact', 'HubSpot')).toBe(
      'New HubSpot contact',
    );
  });
});

describe('format_trigger_display_name_without_app', () => {
  it('drops the whole app name from the front and capitalises what is left', () => {
    const display_name = format_trigger_display_name(
      'Google Calendar Event Created Trigger',
      'Google Calendar',
    );
    expect(format_trigger_display_name_without_app(display_name, 'Google Calendar')).toBe(
      'Event created',
    );
  });

  it('keeps a name that does not start with the whole app name', () => {
    expect(format_trigger_display_name_without_app('New Gmail message received', 'Gmail')).toBe(
      'New Gmail message received',
    );
    expect(format_trigger_display_name_without_app('Google event created', 'Google Calendar')).toBe(
      'Google event created',
    );
    expect(format_trigger_display_name_without_app('Gmailer sent', 'Gmail')).toBe('Gmailer sent');
  });
});
