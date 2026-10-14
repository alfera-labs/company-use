import { describe, expect, it } from 'vitest';
import { matches_agent_tool_query } from '@/components/app/workspace';

const notes_recall = {
  node_display_name: 'Recall',
  node_key: 'mcp_notes-recall-1',
  app_key: 'mcp_notes',
  provider_key: 'mcp',
};

describe('finding a tool among a hundred', () => {
  it('finds a tool by its own name', () => {
    expect(matches_agent_tool_query(notes_recall, 'recall')).toBe(true);
  });

  it('finds every tool a server contributed by the app it came from', () => {
    expect(matches_agent_tool_query(notes_recall, 'notes')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matches_agent_tool_query(notes_recall, 'gmail')).toBe(false);
  });

  it('shows everything when nothing is typed', () => {
    expect(matches_agent_tool_query(notes_recall, '   ')).toBe(true);
  });
});
