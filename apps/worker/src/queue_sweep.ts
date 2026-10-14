import {
  list_queued_jobs_with_stale_wake,
  mark_wake_sent,
  recover_expired_event_jobs,
} from '@coworker/jobs';
import type { QueueRing, RingQueueWorker } from '@worker/queue_worker_ring';
import type { WorkerServices } from '@worker/worker_services';

export const stale_wake_seconds = 10;
const sweep_job_limit = 100;

type QueuedJob = { job_id: string; workspace_id: string; queue_key: string };

export async function sweep_queues(services: WorkerServices, ring_queue_worker: RingQueueWorker) {
  const now = services.now();
  const recovered_jobs = await recover_expired_event_jobs(services.db, { now });
  const stale_jobs = await list_queued_jobs_with_stale_wake(services.db, {
    older_than_seconds: stale_wake_seconds,
    limit: sweep_job_limit,
    now,
  });
  const jobs = [...recovered_jobs.filter((job) => job.job_status === 'queued'), ...stale_jobs];
  const rings = one_ring_per_queue(jobs);
  const results = await Promise.allSettled(rings.map(ring_queue_worker));
  const delivered = rings.filter((_ring, index) => results[index]?.status === 'fulfilled');
  log_failed_rings(services, rings, results);
  await mark_rung_jobs(services, jobs, delivered);
  return { recovered_jobs: recovered_jobs.length, rung_queues: delivered.length };
}

function one_ring_per_queue(jobs: QueuedJob[]): QueueRing[] {
  const rings = new Map<string, QueueRing>();
  for (const { workspace_id, queue_key, job_id } of jobs) {
    const key = queue_id({ workspace_id, queue_key });
    if (!rings.has(key)) rings.set(key, { workspace_id, queue_key, job_id });
  }
  return [...rings.values()];
}

async function mark_rung_jobs(services: WorkerServices, jobs: QueuedJob[], delivered: QueueRing[]) {
  const rung_queues = new Set(delivered.map((ring) => queue_id(ring)));
  const job_ids_by_workspace = new Map<string, string[]>();
  for (const job of jobs) {
    if (!rung_queues.has(queue_id(job))) continue;
    const job_ids = job_ids_by_workspace.get(job.workspace_id) ?? [];
    job_ids.push(job.job_id);
    job_ids_by_workspace.set(job.workspace_id, job_ids);
  }
  await Promise.all(
    [...job_ids_by_workspace].map(([workspace_id, job_ids]) =>
      mark_wake_sent(services.db, { workspace_id, job_ids, now: services.now() }),
    ),
  );
}

function log_failed_rings(
  services: WorkerServices,
  rings: QueueRing[],
  results: PromiseSettledResult<void>[],
) {
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    services.log.error('the sweep could not ring a queue worker; the next sweep rings again', {
      ...rings[index],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
}

function queue_id(queue: { workspace_id: string; queue_key: string }) {
  return JSON.stringify([queue.workspace_id, queue.queue_key]);
}
