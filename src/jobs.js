import crypto from 'node:crypto';
import { pLimit } from './util.js';
import { config } from './config.js';

const jobs = new Map();
const limit = pLimit(config.maxConcurrentJobs);

/** Background job with a replayable event log, consumed over Server-Sent Events. */
export function startJob(kind, input, run) {
  const job = { id: crypto.randomUUID().slice(0, 8), kind, input, status: 'queued', events: [], subs: new Set(), createdAt: Date.now() };
  jobs.set(job.id, job);
  const emit = (e) => {
    const ev = { ...e, t: Date.now() };
    job.events.push(ev);
    for (const s of job.subs) s(ev);
  };
  emit({ type: 'queued' });
  limit(async () => {
    job.status = 'running';
    emit({ type: 'running' });
    try {
      await run(emit);
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      emit({ type: 'error', error: e.userFacing ? e.message : `Something went wrong: ${e.message}` });
    }
    emit({ type: 'end', status: job.status });
  });
  return job;
}

export const getJob = (id) => jobs.get(id);

// Forget finished jobs after an hour.
setInterval(() => {
  for (const [id, j] of jobs) if (j.status !== 'running' && Date.now() - j.createdAt > 3600_000) jobs.delete(id);
}, 600_000).unref();
