import { z } from 'zod';
import { structured } from '../llm.js';

const Evidence = z.object({
  label: z.string().describe('Short name, 1-4 words'),
  detail: z.string().describe('One sentence explaining it in plain language'),
  source: z.enum(['linkedin', 'instagram', 'both']),
  evidence: z.string().describe('Concrete quote or observation from the source that supports this'),
});

export const AnalysisSchema = z.object({
  summary: z.string().describe('3-4 warm, specific sentences: who this person is as a human, not a CV'),
  tagline: z.string().describe('A dating-profile one-liner, max 12 words, in their spirit'),
  needs: z.array(Evidence).describe('4-6 relationship NEEDS: what this person needs from a partner to thrive'),
  hobbies: z.array(Evidence).describe('3-8 hobbies/activities they actually do'),
  interests: z.array(Evidence).describe('4-8 topics/domains they care about'),
  values: z.array(Evidence).describe('3-6 core values'),
  personality: z.object({
    openness: z.number().int().min(0).max(100),
    conscientiousness: z.number().int().min(0).max(100),
    extraversion: z.number().int().min(0).max(100),
    agreeableness: z.number().int().min(0).max(100),
    emotionalStability: z.number().int().min(0).max(100),
    description: z.string().describe('2 sentences on temperament, with reasoning'),
  }),
  lifestyle: z.object({
    pace: z.string().describe('e.g. "always-on, travels monthly"'),
    social: z.string().describe('how they spend social time'),
    health: z.string().describe('fitness/wellness habits visible, or "not visible"'),
    tags: z.array(z.string()).describe('4-8 short lifestyle tags'),
  }),
  career: z.object({
    stage: z.string(),
    ambition: z.number().int().min(0).max(100),
    workStyle: z.string(),
  }),
  communicationStyle: z.string().describe('How they talk and write, inferred from captions/posts'),
  loveLanguage: z.object({ primary: z.string(), why: z.string() }),
  idealPartner: z.string().describe('2-3 sentences: the kind of partner who would fit them'),
  idealDate: z.string().describe('One concrete date idea they would love'),
  greenFlags: z.array(z.string()).describe('3-5 attractive qualities'),
  frictions: z.array(z.string()).describe('2-4 honest potential friction points in a relationship'),
  dealbreakers: z.array(z.string()).describe('2-4 likely dealbreakers'),
  conversationStarters: z.array(z.string()).describe('3 openers another person could use'),
  voice: z.string().describe('How their agent should sound on a date: vocabulary, energy, humour, catchphrases seen'),
  confidence: z.number().int().min(0).max(100).describe('How much signal the sources gave'),
  dataGaps: z.array(z.string()).describe('What could NOT be determined from the two sources'),
});

const SYSTEM = `You are the personal dating agent for one real person. Before you can date on their behalf you must deeply understand them.

You have exactly two sources: their public LinkedIn profile and their public Instagram profile (bio, captions, hashtags, locations, and a sample of photos). Use nothing else — no outside knowledge about them, even if they are famous. If the sources do not show something, say so in dataGaps rather than guessing.

How to read:
- LinkedIn reveals ambition, career arc, work style, values-in-action (volunteering, causes), education, and how they present themselves professionally.
- Instagram reveals the life outside work: hobbies, travel, food, fitness, family, pets, humour, aesthetic, who they spend time with, and their natural voice.
- Look for the tension between the two: the polished operator vs. the person at the beach. That's where needs live.
- Photos: describe activities, settings and objects only (e.g. "climbing", "kitchen", "stage", "dog"). Never comment on physical attractiveness, body, race, or other sensitive traits, and never infer sexual orientation, religion or health conditions.
- Needs are inferred, not quoted: e.g. a founder who posts 6am workouts and family dinners likely needs a partner who respects routine and protects family time. Tie every need to evidence.
- Be specific and vivid. "Likes travel" is useless; "Plans trips around food markets — Tokyo, Oaxaca, Lisbon in the last 20 posts" is useful.`;

function sourceDigest(src) {
  const { linkedin: li, instagram: ig } = src;
  return JSON.stringify(
    {
      linkedin: {
        name: li.name,
        headline: li.headline,
        location: li.location,
        about: li.about,
        experience: li.experience,
        education: li.education,
        skills: li.skills,
        languages: li.languages,
        certifications: li.certifications,
        volunteering: li.volunteering,
        honors: li.honors,
        publications: li.publications,
        recentPosts: li.recentPosts,
      },
      instagram: {
        username: ig.username,
        fullName: ig.fullName,
        biography: ig.biography,
        category: ig.category,
        externalUrl: ig.externalUrl,
        followers: ig.followers,
        posts: ig.posts.map(({ caption, hashtags, location, timestamp, type }) => ({ caption, hashtags, location, timestamp, type })),
      },
    },
    null,
    1
  );
}

/** Download a handful of Instagram post images so the analyst can "see" their life. Failures are skipped. */
async function fetchImages(posts, max = 6) {
  const out = [];
  for (const p of posts.filter((p) => p.image).slice(0, max * 2)) {
    if (out.length >= max) break;
    try {
      const res = await fetch(p.image, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const type = (res.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3_500_000) continue;
      out.push({ type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } });
    } catch {
      /* image CDN links expire; skip */
    }
  }
  return out;
}

export async function analyzePerson(sources, onStep = () => {}) {
  onStep({ step: 'analysis', status: 'running', detail: 'Looking at Instagram photos' });
  const images = await fetchImages(sources.instagram.posts);
  onStep({
    step: 'analysis',
    status: 'running',
    detail: `Reading ${sources.linkedin.experience.length} roles, ${sources.instagram.posts.length} captions and ${images.length} photos`,
  });
  const content = [
    { type: 'text', text: `Here are the two sources for the person you represent.\n\n${sourceDigest(sources)}` },
    ...(images.length ? [{ type: 'text', text: `Below are ${images.length} of their recent Instagram photos (most recent first).` }, ...images] : []),
    { type: 'text', text: 'Analyse this person. Every claim must be grounded in the sources above.' },
  ];
  const analysis = await structured({ system: SYSTEM, content, schema: AnalysisSchema, effort: 'medium' });
  onStep({ step: 'analysis', status: 'done', detail: analysis.tagline });
  return { ...analysis, photosSeen: images.length };
}
