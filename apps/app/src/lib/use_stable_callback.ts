import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * One function for the life of the component, which runs the handler of the newest render. A
 * memoised child that gets it as a prop does not render again when the parent does.
 */
export function useStableCallback<HandlerArguments extends unknown[], HandlerResult>(
  handler: (...handler_arguments: HandlerArguments) => HandlerResult,
): (...handler_arguments: HandlerArguments) => HandlerResult {
  const newest_handler = useRef(handler);
  useLayoutEffect(() => {
    newest_handler.current = handler;
  });
  return useCallback(
    (...handler_arguments: HandlerArguments) => newest_handler.current(...handler_arguments),
    [],
  );
}
