import { config } from '../config.js';
import { runActor } from './apify.js';
import { truncate, retry } from '../util.js';

const fmtDate = (d) => (!d ? null : typeof d === 'string' ? d : d.text || [d.month, d.year].filter(Boolean).join(' ') || null);

/** Normalised LinkedIn shape. Tolerant of the field names used by the common Apify LinkedIn actors. */
function normalize(raw, via) {
  const name =
    raw.fullName || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || raw.name || '';
  const exp = raw.experience || raw.experiences || raw.positions || [];
  const edu = raw.education || raw.educations || [];
  const list = (arr, f) => (Array.isArray(arr) ? arr.map(f).filter(Boolean) : []);
  return {
    via,
    name,
    headline: raw.headline || raw.occupation || '',
    about: truncate(raw.about || raw.summary || '', 3000),
    location:
      (typeof raw.location === 'string' ? raw.location : raw.location?.linkedinText) ||
      raw.addressWithCountry ||
      raw.geoLocationName ||
      null,
    followers: raw.followerCount ?? raw.followers ?? null,
    photo: raw.photo || raw.profilePicture || raw.profilePic || null,
    experience: list(exp, (e) => ({
      title: e.position || e.title || null,
      company: e.companyName || e.company || e.subtitle || null,
      start: fmtDate(e.startDate || e.starts_at),
      end: fmtDate(e.endDate || e.ends_at) || (e.endDate === null ? 'Present' : null),
      location: e.location || null,
      description: truncate(e.description || '', 500),
    })).slice(0, 15),
    education: list(edu, (e) => ({
      school: e.schoolName || e.school || e.title || null,
      degree: [e.degree || e.degreeName, e.fieldOfStudy].filter(Boolean).join(', ') || null,
      period: [fmtDate(e.startDate), fmtDate(e.endDate)].filter(Boolean).join(' – ') || e.period || null,
    })).slice(0, 8),
    skills: list(raw.skills, (s) => (typeof s === 'string' ? s : s.name || s.title)).slice(0, 40),
    languages: list(raw.languages, (l) => (typeof l === 'string' ? l : l.name || l.title)),
    certifications: list(raw.certifications, (c) => c.title || c.name).slice(0, 10),
    volunteering: list(raw.volunteering || raw.volunteerExperience, (v) =>
      [v.role || v.title, v.organizationName || v.companyName || v.subtitle].filter(Boolean).join(' @ ')
    ).slice(0, 10),
    honors: list(raw.honorsAndAwards || raw.honors, (h) => h.title || h.name).slice(0, 10),
    publications: list(raw.publications, (p) => p.title || p.name).slice(0, 10),
    recentPosts: list(raw.posts || raw.activity, (p) => truncate(p.text || p.title || p.content || '', 400)).slice(0, 10),
  };
}

async function viaApify(handle) {
  const items = await runActor(config.apify.linkedinActor, {
    profileScraperMode: 'Profile details no email ($4 per 1k)',
    urls: [`https://www.linkedin.com/in/${handle}/`],
    queries: [`https://www.linkedin.com/in/${handle}/`],
  });
  const item = items.find((i) => !i.error) || items[0];
  if (!item || item.error || !(item.firstName || item.fullName || item.name))
    throw new Error(item?.error || 'LinkedIn profile not found');
  return normalize(item, 'apify');
}

/** Fallback: public profile HTML → JSON-LD/OG meta. LinkedIn often serves an authwall to datacenter IPs. */
async function viaPublicPage(handle) {
  const res = await fetch(`https://www.linkedin.com/in/${handle}/`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LinkedIn public page HTTP ${res.status}`);
  const html = await res.text();
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    })
    .flatMap((j) => (j?.['@graph'] ? j['@graph'] : [j]))
    .find((j) => j?.['@type'] === 'Person');
  const meta = (p) => html.match(new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`))?.[1] || '';
  if (!ld && !meta('og:title')) throw new Error('LinkedIn returned an authwall');
  return normalize(
    {
      name: ld?.name || meta('og:title').split(' - ')[0],
      headline: ld?.jobTitle?.[0] || meta('og:title').split(' - ').slice(1).join(' - '),
      about: ld?.description || meta('og:description'),
      location: ld?.address?.addressLocality,
      photo: ld?.image?.contentUrl,
      experience: (ld?.worksFor || []).map((w) => ({ companyName: w.name, position: w.member?.description })),
      education: (ld?.alumniOf || []).map((a) => ({ schoolName: a.name })),
    },
    'linkedin-public'
  );
}

export async function scrapeLinkedIn(handle) {
  const errors = [];
  for (const [name, fn] of [
    ['apify', viaApify],
    ['public', viaPublicPage],
  ]) {
    if (name === 'apify' && !config.apifyToken) continue;
    try {
      return await retry(() => fn(handle), { tries: 2 });
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`Could not read LinkedIn /in/${handle} (${errors.join(' | ')})`);
}
