import { parseLinkedIn, parseInstagram } from './urls.js';
import { scrapeLinkedIn } from './linkedin.js';
import { scrapeInstagram } from './instagram.js';

const tokens = (s) =>
  new Set(
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length > 1)
  );

/**
 * Do both links belong to the same human? Compare LinkedIn name tokens with the
 * Instagram display name, handle and bio. Also accept explicit cross-links.
 */
export function identityCheck(li, ig, liHandle) {
  const liName = tokens(li.name);
  const igText = `${ig.fullName} ${ig.username} ${ig.biography} ${ig.externalUrl || ''}`.toLowerCase();
  const igTokens = tokens(`${ig.fullName} ${ig.biography}`);
  const shared = [...liName].filter((t) => igTokens.has(t) || ig.username.toLowerCase().includes(t));
  const crossLinked = igText.includes(`linkedin.com/in/${liHandle.toLowerCase()}`);
  const score = crossLinked ? 1 : liName.size ? shared.length / liName.size : 0;
  return {
    verified: crossLinked || score >= 0.5,
    score: Math.round(score * 100) / 100,
    reason: crossLinked
      ? 'Instagram links directly to this LinkedIn profile'
      : shared.length
        ? `Name match on: ${shared.join(', ')}`
        : 'Names on the two profiles do not match',
  };
}

/** Fetch both official sources in parallel. `onStep` receives progress events. */
export async function scrapePerson({ linkedinUrl, instagramUrl }, onStep = () => {}) {
  const li = parseLinkedIn(linkedinUrl);
  const ig = parseInstagram(instagramUrl);

  onStep({ step: 'linkedin', status: 'running', detail: `Reading linkedin.com/in/${li.handle}` });
  onStep({ step: 'instagram', status: 'running', detail: `Reading instagram.com/${ig.handle}` });

  const [liRes, igRes] = await Promise.allSettled([
    scrapeLinkedIn(li.handle).then((d) => {
      onStep({
        step: 'linkedin',
        status: 'done',
        detail: `${d.name} — ${d.experience.length} roles, ${d.education.length} schools, ${d.skills.length} skills`,
      });
      return d;
    }),
    scrapeInstagram(ig.handle).then((d) => {
      onStep({
        step: 'instagram',
        status: 'done',
        detail: `@${d.username} — bio + ${d.posts.length} recent posts`,
      });
      return d;
    }),
  ]);

  for (const [k, r] of [['linkedin', liRes], ['instagram', igRes]])
    if (r.status === 'rejected') onStep({ step: k, status: 'error', detail: r.reason.message });
  if (liRes.status === 'rejected') throw liRes.reason;
  if (igRes.status === 'rejected') throw igRes.reason;

  const identity = identityCheck(liRes.value, igRes.value, li.handle);
  onStep({ step: 'identity', status: identity.verified ? 'done' : 'warn', detail: identity.reason });

  return {
    links: { linkedin: li.url, instagram: ig.url },
    handles: { linkedin: li.handle, instagram: ig.handle },
    linkedin: liRes.value,
    instagram: igRes.value,
    identity,
    scrapedAt: new Date().toISOString(),
  };
}
