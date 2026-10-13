/** Minimal promise pool: limit(fn) runs fn when a slot is free. */
export function pLimit(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n) || 0));

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Retry an async fn with exponential backoff. */
export async function retry(fn, { tries = 3, base = 800 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      err = e;
      if (e?.retryable === false) break;
      if (i < tries - 1) await sleep(base * 2 ** i);
    }
  }
  throw err;
}
