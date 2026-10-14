import {
  digest_sample_line,
  is_written_by_a_person,
} from '@runtime-platform/discovery/channel_message_line';
import { describe, expect, it } from 'vitest';

const names = new Map([['U1', 'Alex']]);
const monday_morning = `${Date.UTC(2026, 8, 28, 9) / 1000}.000100`;

describe('a channel message as the sweep reads it', () => {
  it('leads with the day, so a weekly job reads as weekly', () => {
    const line = digest_sample_line(
      {
        message_ts: monday_morning,
        user_id: 'U1',
        text: 'Weekly sales report is in the sheet',
        thread_ts: null,
        subtype: null,
        file_names: [],
      },
      names,
    );

    expect(line).toBe('Mon 2026-09-28 @Alex: Weekly sales report is in the sheet');
  });

  it('keeps a file upload, with the name of the file', () => {
    const upload = {
      message_ts: monday_morning,
      user_id: 'U1',
      text: '',
      thread_ts: null,
      subtype: 'file_share',
      file_names: ['weekly_sales_report.xlsx'],
    };

    expect(is_written_by_a_person(upload)).toBe(true);
    expect(digest_sample_line(upload, names)).toBe(
      'Mon 2026-09-28 @Alex: [file: weekly_sales_report.xlsx]',
    );
  });

  it('still skips joins, leaves and app posts', () => {
    const join = {
      ...{ message_ts: monday_morning, user_id: 'U1', text: 'joined', thread_ts: null },
      subtype: 'channel_join',
      file_names: [],
    };

    expect(is_written_by_a_person(join)).toBe(false);
  });
});
