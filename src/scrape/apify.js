import { config } from '../config.js';
import { pLimit, sleep } from '../util.js';

// Apify's free plan allows 5 concurrent actor runs; stay under it globally.
const limit = pLimit(Number(process.env.APIFY_CONCURRENCY) || 4);

/** Run an Apify actor synchronously and return its dataset items. */
export function runActor(actorId, input) {
  return limit(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await runOnce(actorId, input);
      } catch (e) {
        if (!e.concurrency || attempt >= 6) throw e;
        await sleep(5000 * (attempt + 1));
      }
    }
  });
}

async function runOnce(actorId, input) {
  if (!config.apifyToken) throw new Error('APIFY_TOKEN not configured');
  const url =
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
    `?timeout=${config.apify.timeoutSecs}&clean=true`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apifyToken}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((config.apify.timeoutSecs + 30) * 1000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`Apify ${actorId} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    e.concurrency = body.includes('concurrent-runs-limit');
    throw e;
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error(`Apify ${actorId} returned unexpected payload`);
  return items;
}
