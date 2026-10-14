export type BrainSyncStatus =
  | 'never_synced'
  | 'syncing'
  | 'connected'
  | 'stalled'
  | 'broken'
  | 'rate_limited'
  | 'paused';

export type BrainBackfillState = 'backfilling' | 'quiesced' | 'completed' | 'unknown';

export type BrainSyncProgressObject = {
  key: string;
  label: string;
  listed: number;
  stored: number;
  state: 'queued' | 'running' | 'done' | 'failed';
};

export type BrainSource = {
  brain_source_id: string;
  connection_id?: string | null | undefined;
  app_key: string;
  name: string;
  sync_status: BrainSyncStatus;
  backfill_state: BrainBackfillState;
  document_count: number;
  last_synced_at?: string | null | undefined;
  last_error?: unknown;
  sync_state?:
    | {
        progress?:
          | { objects: BrainSyncProgressObject[]; swept_time?: string | null | undefined }
          | null
          | undefined;
      }
    | null
    | undefined;
  scope_key?: string | null | undefined;
  sync_cadence: 'hourly' | 'daily' | 'weekly' | 'manual';
};
