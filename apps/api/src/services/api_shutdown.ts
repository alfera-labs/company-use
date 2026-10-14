type ApiShutdownDependencies = {
  close_server: (finished: () => void) => void;
  wait_for_event_job_requests: () => Promise<void>;
  exit_process: (code: number) => void;
  force_exit_after_ms?: number;
};

export function create_api_shutdown(dependencies: ApiShutdownDependencies) {
  let shutdown_promise: Promise<void> | null = null;
  return () => {
    shutdown_promise ??= stop_api(dependencies);
    return shutdown_promise;
  };
}

async function stop_api(dependencies: ApiShutdownDependencies) {
  const force_exit_timer = setTimeout(
    () => dependencies.exit_process(0),
    dependencies.force_exit_after_ms ?? 9_000,
  );
  if (typeof force_exit_timer.unref === 'function') force_exit_timer.unref();

  const server_stopped = new Promise<void>((resolve) => dependencies.close_server(resolve));
  await Promise.all([server_stopped, dependencies.wait_for_event_job_requests()]);
  clearTimeout(force_exit_timer);
  dependencies.exit_process(0);
}
