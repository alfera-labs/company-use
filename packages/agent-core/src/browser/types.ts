export type BrowserExecResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
};

export type BrowserExecOptions = {
  timeout_ms?: number;
  signal?: AbortSignal;
};

export type BrowserSession = {
  id: string;
  exec(argv: string[], options?: BrowserExecOptions): Promise<BrowserExecResult>;
  exec_raw(shell: string, options?: BrowserExecOptions): Promise<BrowserExecResult>;
  read_bytes?(path: string): Promise<Uint8Array>;
};
