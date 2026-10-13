import { config } from '../config.js';

/** Run an Apify actor synchronously and return its dataset items. */
export async function runActor(actorId, input) {
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
    throw new Error(`Apify ${actorId} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error(`Apify ${actorId} returned unexpected payload`);
  return items;
}
