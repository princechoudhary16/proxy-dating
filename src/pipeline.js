import { store, pairKey } from './store.js';
import { scrapePerson } from './scrape/index.js';
import { analyzePerson } from './agents/analyst.js';
import { screenCandidates } from './agents/screen.js';
import { goOnDate } from './agents/date.js';
import { screenScore } from './ranking.js';
import { config } from './config.js';
import { slugify } from './util.js';

/** Inline the Instagram avatar so the page never depends on expiring CDN links. */
async function avatarDataUri(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 400_000 ? `data:${type};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

/** Step 1+2: read both sources and build the person's agent profile. */
export async function buildPerson(links, { emit = () => {}, origin = 'user' } = {}) {
  const sources = await scrapePerson(links, (e) => emit({ type: 'step', ...e }));
  const analysis = await analyzePerson(sources, (e) => emit({ type: 'step', ...e }));
  const li = sources.linkedin;
  const ig = sources.instagram;
  const person = {
    id: slugify(li.name || ig.fullName || sources.handles.instagram) || sources.handles.instagram,
    name: li.name || ig.fullName || `@${ig.username}`,
    headline: li.headline,
    location: li.location,
    avatar: (await avatarDataUri(ig.profilePic)) || (await avatarDataUri(li.photo)),
    links: sources.links,
    identity: sources.identity,
    sources: { linkedin: li, instagram: { ...ig, posts: ig.posts.map(({ image, ...p }) => p) } },
    analysis,
    origin,
    createdAt: new Date().toISOString(),
  };
  // Re-adding the same LinkedIn replaces the old record instead of duplicating it.
  for (const p of store.people.values()) if (p.links.linkedin === person.links.linkedin) person.id = p.id;
  return person;
}

/** Step 3a: swipe phase. Every rater scores every candidate (both directions are separate agents). */
export async function screenAll(raters, candidates, emit = () => {}) {
  await Promise.all(
    raters.map(async (r) => {
      const pool = candidates.filter((c) => c.id !== r.id);
      const res = await screenCandidates(r, pool);
      for (const [cid, v] of Object.entries(res)) store.setScreen(r.id, cid, v);
      emit({ type: 'screen', rater: r.id, count: Object.keys(res).length });
    })
  );
}

/** Pick who goes on dates: each person's top-K by mutual swipe score. */
export function selectPairs(focusIds, k = config.datesPerPerson) {
  const ids = [...store.people.keys()];
  const pairs = new Map();
  for (const a of focusIds) {
    ids
      .filter((b) => b !== a)
      .map((b) => ({ b, s: screenScore(a, b) ?? -1 }))
      .sort((x, y) => y.s - x.s)
      .slice(0, k)
      .forEach(({ b }) => pairs.set(pairKey(a, b), [a, b]));
  }
  return [...pairs.values()].filter(([a, b]) => !store.getDate(a, b));
}

/** Step 3b: send agents on dates in parallel, streaming every line. */
export async function runDates(pairs, emit = () => {}) {
  await Promise.all(
    pairs.map(async ([aId, bId]) => {
      const a = store.people.get(aId);
      const b = store.people.get(bId);
      const id = `${a.id}__${b.id}`;
      emit({ type: 'date:start', id, a: a.id, b: b.id });
      try {
        const date = await goOnDate(a, b, {
          onPlan: (plan) => emit({ type: 'date:plan', id, plan }),
          onMessage: (line) => emit({ type: 'date:msg', id, ...line }),
          onStatus: (status) => emit({ type: 'date:status', id, status }),
        });
        store.addDate(date);
        emit({ type: 'date:end', id, mutual: date.mutual, match: date.match, debrief: date.debrief });
      } catch (e) {
        emit({ type: 'date:error', id, error: e.message });
      }
    })
  );
}

/** The website flow: links in → profile → swipes → dates → ranking. */
export async function onboard(links, emit) {
  const person = await buildPerson(links, { emit });
  store.upsertPerson(person);
  store.saveRuntime();
  emit({ type: 'profile', person: { id: person.id, name: person.name } });

  const others = [...store.people.values()].filter((p) => p.id !== person.id);
  if (others.length) {
    emit({ type: 'step', step: 'screen', status: 'running', detail: `Your agent is swiping through ${others.length} profiles — and they're swiping on you` });
    // New agent swipes on everyone; every existing agent swipes on the newcomer.
    await Promise.all([screenAll([person], others), screenAll(others, [person])]);
    emit({ type: 'step', step: 'screen', status: 'done', detail: 'Swipes are in' });

    const pairs = selectPairs([person.id]);
    emit({ type: 'step', step: 'dates', status: 'running', detail: `Going on ${pairs.length} dates at once` });
    await runDates(pairs, emit);
    emit({ type: 'step', step: 'dates', status: 'done', detail: 'All dates finished' });
  }
  store.saveRuntime();
  emit({ type: 'step', step: 'ranking', status: 'done', detail: 'Ranking ready' });
  emit({ type: 'done', personId: person.id });
  return person;
}
