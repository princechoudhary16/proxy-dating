import { parseLinkedIn, parseInstagram, userError } from './urls.js';
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

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'our', 'inc', 'llc', 'ltd', 'company', 'founder', 'cofounder', 'co-founder', 'ceo', 'chief', 'officer', 'head', 'director', 'manager', 'president', 'partner', 'author', 'host', 'investor', 'board', 'member', 'advisor', 'global', 'group', 'media', 'world', 'new', 'york', 'india', 'united', 'states', 'about', 'more', 'life', 'people', 'business']);

/** Distinctive words from what someone does (companies, headline, website) — used to corroborate a name match. */
function workTokens(li) {
  const text = [li.headline, ...li.experience.slice(0, 8).map((e) => e.company), ...li.education.map((e) => e.school)].join(' ');
  return new Set([...tokens(text)].filter((t) => t.length > 3 && !STOP.has(t)));
}

/**
 * Do both links belong to the same human? Levels:
 *  - verified: explicit cross-link, or name match corroborated by shared work/brand/website signals
 *  - likely:   names match but nothing else connects them (common names collide — e.g. two different "Guy Raz")
 *  - mismatch: names don't match
 */
export function identityCheck(li, ig, liHandle) {
  const liName = tokens(li.name);
  const igBlob = [ig.fullName, ig.username, ig.biography, ig.category, ig.externalUrl, ...ig.posts.map((p) => `${p.caption} ${(p.hashtags || []).join(' ')} ${(p.mentions || []).join(' ')}`)].join(' ').toLowerCase();
  const igName = tokens(`${ig.fullName} ${ig.biography}`);
  const shared = [...liName].filter((t) => igName.has(t) || ig.username.toLowerCase().includes(t));
  const crossLinked = igBlob.includes(`linkedin.com/in/${liHandle.toLowerCase()}`);
  const igTokens = tokens(igBlob);
  const corroboration = [...workTokens(li)].filter((t) => igTokens.has(t) || ig.username.toLowerCase().includes(t)).slice(0, 5);
  const host = (ig.externalUrl || '').replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0].toLowerCase();
  const liBlob = `${li.about} ${li.headline} ${li.experience.map((e) => `${e.company} ${e.description}`).join(' ')}`.toLowerCase();
  if (host && host.length > 4 && liBlob.includes(host.split('.')[0])) corroboration.push(host);
  const nameScore = liName.size ? shared.length / liName.size : 0;
  const level = crossLinked ? 'verified' : nameScore >= 0.5 ? (corroboration.length ? 'verified' : 'likely') : 'mismatch';
  return {
    verified: level === 'verified',
    level,
    score: Math.round(nameScore * 100) / 100,
    reason: crossLinked
      ? 'Instagram links directly to this LinkedIn profile'
      : level === 'verified'
        ? `Name match (${shared.join(', ')}) + shared signals: ${corroboration.join(', ')}`
        : level === 'likely'
          ? `Names match (${shared.join(', ')}) but nothing else connects the two profiles — could be different people`
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
  if (identity.level === 'mismatch')
    throw userError(`These links look like two different people: LinkedIn says "${liRes.value.name}", Instagram says "${igRes.value.fullName || igRes.value.username}".`);

  return {
    links: { linkedin: li.url, instagram: ig.url },
    handles: { linkedin: li.handle, instagram: ig.handle },
    linkedin: liRes.value,
    instagram: igRes.value,
    identity,
    scrapedAt: new Date().toISOString(),
  };
}
