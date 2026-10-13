/** Parse and canonicalise the two official links. Throws a user-facing error on bad input. */
export function parseLinkedIn(input) {
  const m = String(input || '').trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) throw userError('That does not look like a LinkedIn profile URL (expected linkedin.com/in/…).');
  const handle = decodeURIComponent(m[1]).replace(/\/$/, '');
  return { handle, url: `https://www.linkedin.com/in/${handle}/` };
}

const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts']);

export function parseInstagram(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i) || raw.match(/^@?([A-Za-z0-9._]{1,30})$/);
  if (!m || IG_RESERVED.has(m[1].toLowerCase()))
    throw userError('That does not look like an Instagram profile URL (expected instagram.com/<username>).');
  const handle = m[1].toLowerCase();
  return { handle, url: `https://www.instagram.com/${handle}/` };
}

export function userError(message) {
  const e = new Error(message);
  e.userFacing = true;
  e.retryable = false;
  return e;
}
