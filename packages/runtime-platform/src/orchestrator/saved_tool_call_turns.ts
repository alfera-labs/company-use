import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';

const turn_save_deadline_ms = 60_000;

type SavedTurnWaiter = {
  tool_call_ids: readonly string[];
  resolve: () => void;
  reject: (reason: unknown) => void;
};

export function create_saved_tool_call_turns() {
  const saved_tool_call_ids = new Set<string>();
  const waiters: SavedTurnWaiter[] = [];
  let stopped: unknown;

  function all_saved(tool_call_ids: readonly string[]) {
    return tool_call_ids.every((tool_call_id) => saved_tool_call_ids.has(tool_call_id));
  }

  return {
    record_saved_message(message: RuntimeAgentMessage) {
      for (const part of message.content) {
        if (part.type === 'tool_call') saved_tool_call_ids.add(part.id);
      }
      for (const waiter of [...waiters]) {
        if (!all_saved(waiter.tool_call_ids)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    },
    wait_until_saved(tool_call_ids: readonly string[]): Promise<void> {
      if (stopped !== undefined) return Promise.reject(stopped);
      if (all_saved(tool_call_ids)) return Promise.resolve();
      return add_waiter(waiters, tool_call_ids);
    },
    stop(reason: unknown) {
      stopped = reason;
      for (const waiter of waiters.splice(0, waiters.length)) waiter.reject(reason);
    },
  };
}

function add_waiter(waiters: SavedTurnWaiter[], tool_call_ids: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      reject(new Error(`The turn asking for ${tool_call_ids.join(', ')} was never saved.`));
    }, turn_save_deadline_ms);
    timer.unref?.();
    const waiter = {
      tool_call_ids,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    };
    waiters.push(waiter);
  });
}
