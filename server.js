import express from 'express';
import path from 'node:path';
import { config } from './src/config.js';
import { store } from './src/store.js';
import { rankFor, topCouples } from './src/ranking.js';
import { startJob, getJob } from './src/jobs.js';
import { onboard } from './src/pipeline.js';
import { parseLinkedIn, parseInstagram } from './src/scrape/urls.js';

store.load();
const app = express();
app.use(express.json({ limit: '50kb' }));

const summary = (p) => ({
  id: p.id,
  name: p.name,
  headline: p.headline,
  location: p.location,
  avatar: p.avatar,
  tagline: p.analysis?.tagline,
  interests: (p.analysis?.interests || []).slice(0, 4).map((i) => i.label),
  links: p.links,
  identity: p.identity,
  origin: p.origin,
  dates: store.datesFor(p.id).length,
  matches: store.datesFor(p.id).filter((d) => d.match).length,
});

const dateSummary = (d) => ({
  id: d.id,
  a: d.a,
  b: d.b,
  plan: d.plan,
  mutual: d.mutual,
  match: d.match,
  at: d.at,
  scores: { a: d.debrief.a.score, b: d.debrief.b.score },
});

const findDate = (id) => [...store.dates.values()].find((d) => d.id === id);

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, llm: !!(config.anthropicKey || config.gemini.key), provider: config.provider, models: config.models, apify: !!config.apifyToken, people: store.people.size, dates: store.dates.size })
);

app.get('/api/people', (_req, res) =>
  res.json([...store.people.values()].map(summary).sort((a, b) => (a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === 'user' ? -1 : 1)))
);

app.get('/api/people/:id', (req, res) => {
  const p = store.people.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ ...p, dates: store.datesFor(p.id).map(dateSummary), ranking: rankFor(p.id) });
});

app.get('/api/rankings/:id', (req, res) => {
  if (!store.people.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json(rankFor(req.params.id));
});

app.get('/api/dates', (_req, res) => res.json([...store.dates.values()].map(dateSummary).sort((a, b) => b.mutual - a.mutual)));

app.get('/api/dates/:id', (req, res) => {
  const d = findDate(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, people: { a: summary(store.people.get(d.a)), b: summary(store.people.get(d.b)) } });
});

app.get('/api/couples', (_req, res) => res.json(topCouples(15)));

// Naive per-IP throttle on the expensive endpoint.
const hits = new Map();
function throttle(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= 6) return res.status(429).json({ error: 'Too many profiles from you this hour. Try again later.' });
  hits.set(ip, [...recent, now]);
  next();
}

app.post('/api/onboard', throttle, (req, res) => {
  const { linkedin, instagram } = req.body || {};
  try {
    parseLinkedIn(linkedin);
    parseInstagram(instagram);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!config.anthropicKey && !config.gemini.key) return res.status(503).json({ error: 'The server has no LLM key configured.' });
  const job = startJob('onboard', { linkedin, instagram }, (emit) => onboard({ linkedinUrl: linkedin, instagramUrl: instagram }, emit));
  res.status(202).json({ jobId: job.id });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  job.events.forEach(send);
  if (job.status === 'done' || job.status === 'error') return res.end();
  const sub = (e) => {
    send(e);
    if (e.type === 'end') res.end();
  };
  job.subs.add(sub);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(ping);
    job.subs.delete(sub);
  });
});

const pub = path.join(config.root, 'public');
app.use(express.static(pub, { maxAge: '5m' }));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(pub, 'index.html')));

app.listen(config.port, () =>
  console.log(`Proxy listening on :${config.port} — ${store.people.size} people, ${store.dates.size} dates (llm=${config.provider}, apify=${!!config.apifyToken})`)
);
