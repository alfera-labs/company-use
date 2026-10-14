import type { ConnectorRateLimits } from '@connectors/types';
import { sleep } from '@coworker/shared';

export type ConnectorRateLimitKey = {
  app_key: string;
  connection_id: string;
};

type TokenBucket = {
  tokens: number;
  last_refill_ms: number;
  running: number;
  waiting: Array<() => void>;
  paused_until_ms: number;
};

const buckets = new Map<string, TokenBucket>();

function bucket_id(key: ConnectorRateLimitKey) {
  return `${key.app_key}:${key.connection_id}`;
}

function find_or_create_bucket(key: ConnectorRateLimitKey, limits: ConnectorRateLimits) {
  const id = bucket_id(key);
  const existing = buckets.get(id);
  if (existing) return existing;
  const bucket: TokenBucket = {
    tokens: Math.max(1, limits.burst),
    last_refill_ms: Date.now(),
    running: 0,
    waiting: [],
    paused_until_ms: 0,
  };
  buckets.set(id, bucket);
  return bucket;
}

function refill_tokens(bucket: TokenBucket, limits: ConnectorRateLimits, now_ms: number) {
  const tokens_per_ms = limits.rpm / 60_000;
  const gained = (now_ms - bucket.last_refill_ms) * tokens_per_ms;
  bucket.tokens = Math.min(Math.max(1, limits.burst), bucket.tokens + gained);
  bucket.last_refill_ms = now_ms;
}

function token_wait_ms(bucket: TokenBucket, limits: ConnectorRateLimits) {
  const now_ms = Date.now();
  refill_tokens(bucket, limits, now_ms);
  const pause_ms = bucket.paused_until_ms - now_ms;
  if (pause_ms > 0) return pause_ms;
  if (bucket.tokens >= 1) return 0;
  const tokens_per_ms = limits.rpm / 60_000;
  return Math.ceil((1 - bucket.tokens) / tokens_per_ms);
}

async function take_concurrency_slot(bucket: TokenBucket, limits: ConnectorRateLimits) {
  const ceiling = Math.max(1, limits.concurrency);
  if (bucket.running < ceiling && bucket.waiting.length === 0) {
    bucket.running += 1;
    return;
  }
  await new Promise<void>((resolve) => bucket.waiting.push(resolve));
}

function release_concurrency_slot(bucket: TokenBucket) {
  const next_waiter = bucket.waiting.shift();
  if (next_waiter) {
    next_waiter();
    return;
  }
  bucket.running -= 1;
}

export async function run_under_rate_limit<TResult>(
  key: ConnectorRateLimitKey,
  limits: ConnectorRateLimits,
  work: () => Promise<TResult>,
): Promise<TResult> {
  const bucket = find_or_create_bucket(key, limits);
  await take_concurrency_slot(bucket, limits);
  try {
    let delay_ms = token_wait_ms(bucket, limits);
    while (delay_ms > 0) {
      await sleep(delay_ms);
      delay_ms = token_wait_ms(bucket, limits);
    }
    bucket.tokens -= 1;
    return await work();
  } finally {
    release_concurrency_slot(bucket);
  }
}

export function pause_rate_limit_bucket(
  key: ConnectorRateLimitKey,
  limits: ConnectorRateLimits,
  pause_ms: number,
) {
  const bucket = find_or_create_bucket(key, limits);
  bucket.paused_until_ms = Math.max(bucket.paused_until_ms, Date.now() + Math.max(0, pause_ms));
}

export function reset_rate_limit_buckets() {
  buckets.clear();
}
