import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatApprovalDock, latest_approval_requests } from '@/components/app/chat_approval_dock';
import type {
  ProjectedChatMessage,
  ProjectedChatToolPart,
} from '@/components/app/chat_stream_projection';

describe('what the approval bar asks about', () => {
  it('asks about a call that is waiting and knows its own question', () => {
    expect(latest_approval_requests([turn([waiting_part()])])).toMatchObject([
      { approval_request_id: 'ejob_1', action_name: 'Send email', app_name: 'Gmail' },
    ]);
  });

  it('says nothing about a call that already ran', () => {
    const ran = { ...waiting_part(), state: 'completed' };

    expect(latest_approval_requests([turn([ran])])).toEqual([]);
  });

  it('says nothing once a newer turn has spoken', () => {
    const newer = { id: 'm2', role: 'assistant', run_id: 'run_1', parts: [] };

    expect(
      latest_approval_requests([turn([waiting_part()]), newer as unknown as ProjectedChatMessage]),
    ).toEqual([]);
  });

  it('says nothing about a call that is only waiting because its step is', () => {
    const rider = {
      ...waiting_part(),
      toolCallId: 'call_rider',
      approvalNeedsAPerson: false,
    } as ProjectedChatToolPart;

    const requests = latest_approval_requests([turn([rider, waiting_part()])]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.sibling_call_count).toBe(1);
  });

  it('asks once about a call the transcript carries twice', () => {
    expect(latest_approval_requests([turn([waiting_part(), waiting_part()])])).toHaveLength(1);
  });
});

describe('what the bar shows', () => {
  it('sits on its own surface rather than floating on the page', () => {
    expect(render_bar()).toContain('bg-raised');
  });

  it('does not tell somebody that nothing has happened yet', () => {
    expect(render_bar()).not.toContain('It only happens if you say yes');
  });

  it("shows what the call will do, in the tool's own field names", () => {
    const html = render_bar();

    expect(html).toContain('anna@acme.com');
    expect(html).toContain('Your refund for order 4471');
    expect(html).toContain('Subject');
  });

  it('puts the answers on the right, quietest first and the one that goes ahead last', () => {
    const html = render_bar();
    const row = html.slice(html.indexOf('justify-end'));
    const labels = [...row.matchAll(/>([A-Z][^<>]{3,40})</gu)].map((match) => match[1]);

    expect(labels).toEqual(['No, don&#x27;t', 'Always send to anna@acme.com', 'Yes, go ahead']);
  });

  it('says nothing about a call that carries no arguments', () => {
    const bare = { ...waiting_part(), input: undefined };

    expect(render_bar([bare])).not.toContain('See what it will do');
  });
});

function render_bar(parts: ProjectedChatToolPart[] = [waiting_part()]) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ChatApprovalDock, { apps: [], messages: [turn(parts)] }),
    ),
  );
}

function turn(parts: ProjectedChatToolPart[]): ProjectedChatMessage {
  return { id: 'm1', role: 'assistant', run_id: 'run_1', parts } as unknown as ProjectedChatMessage;
}

function waiting_part(): ProjectedChatToolPart {
  return {
    type: 'tool-gmail-send_email-1',
    toolCallId: 'tcall_1',
    toolName: 'gmail-send_email-1',
    state: 'awaiting_approval',
    approvalRequestId: 'ejob_1',
    input: {
      to: 'anna@acme.com',
      subject: 'Your refund for order 4471',
      body: 'Hi Anna,\n\nYour refund of £240 is on its way and should land in 3 to 5 working days.',
      schema_id: 'sch_abc',
    },
    inputSchema: {
      properties: {
        to: { title: 'To' },
        subject: { title: 'Subject' },
        body: { title: 'Message' },
      },
    },
    display: { title: 'Send email', subtitle: 'Gmail' },
  } as unknown as ProjectedChatToolPart;
}
