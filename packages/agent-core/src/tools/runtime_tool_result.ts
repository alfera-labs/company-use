type RuntimeToolDisplay =
  | {
      kind: 'text' | 'markdown' | 'image' | 'file' | 'link';
      value: string;
    }
  | {
      kind: 'json';
      value: unknown;
    };

export type RuntimeToolContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      data: string;
      mime_type: string;
    };

type RuntimeToolResultMetadata = Record<string, unknown> & {
  duration_ms?: number;
  exit_code?: number;
  active_preview?: Record<string, unknown> & {
    port: number;
    preview_url?: string;
  };
  active_preview_ports?: number[];
};

export type RuntimeToolResult =
  | {
      ok: true;
      content?: RuntimeToolContentPart[];
      content_text?: string;
      content_json?: unknown;
      metadata?: RuntimeToolResultMetadata;
      display?: RuntimeToolDisplay;
      ends_run?: boolean;
      reply_text?: string;
    }
  | {
      ok: false;
      content?: RuntimeToolContentPart[];
      error_code: string;
      error_message: string;
      metadata?: RuntimeToolResultMetadata;
      display?: RuntimeToolDisplay;
    };
