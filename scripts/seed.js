/**
 * Builds the finished example: every person in data/people.json is scraped, analysed,
 * swipes on everyone else, and goes on dates. Resumable — re-run to continue after a failure.
 *
 *   npm run seed                 full run
 *   npm run seed -- --only-build stop after profiles
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { store } from '../src/store.js';
import { scrapePerson } from '../src/scrape/index.js';
import { buildPerson, screenAll, selectPairs, runDates } from '../src/pipeline.js';
import { pLimit } from '../src/util.js';

const args = new Set(process.argv.slice(2));
const cacheDir = path.join(config.dataDir, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
store.load();

const people = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'people.json'), 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 1. Scrape + analyse (cached per LinkedIn handle so re-runs never pay twice).
const limit = pLimit(4);
const failures = [];
await Promise.all(
  people.map((links) =>
    limit(async () => {
      const key = links.linkedin.match(/\/in\/([^/]+)/)[1];
      if ([...store.people.values()].some((p) => p.links.linkedin.includes(`/in/${key}/`))) return;
      const cacheFile = path.join(cacheDir, `${key}.json`);
      try {
        let sources = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null;
        if (!sources) {
          sources = await scrapePerson({ linkedinUrl: links.linkedin, instagramUrl: links.instagram }, (e) =>
            log(`[${key}] ${e.step}: ${e.status} — ${e.detail}`)
          );
          fs.writeFileSync(cacheFile, JSON.stringify(sources));
        }
        if (!sources.identity.verified) throw new Error(`identity not verified (${sources.identity.reason})`);
        const person = await buildPerson(null, { sources, origin: 'seed' });
        store.upsertPerson(person);
        store.saveSeed();
        log(`✓ ${person.name}: ${person.analysis.tagline}`);
      } catch (e) {
        failures.push({ key, error: e.message });
        log(`✗ ${key}: ${e.message}`);
      }
    })
  )
);
log(`${store.people.size} people ready. ${failures.length} failed.`);
if (failures.length) console.table(failures);
if (args.has('--only-build')) process.exit(0);

// 2. Swipe phase for anyone who hasn't swiped yet.
const all = [...store.people.values()];
const pending = all.filter((p) => Object.keys(store.screens[p.id] || {}).length < all.length - 1);
log(`Swipe phase: ${pending.length} agents reviewing ${all.length - 1} profiles each`);
await screenAll(pending, all, (e) => log(`  swiped: ${e.rater} (${e.count})`));
store.saveSeed();

// 3. Dates.
const pairs = selectPairs(all.map((p) => p.id));
log(`Dates: ${pairs.length} first dates scheduled`);
let done = 0;
await runDates(pairs, (e) => {
  if (e.type === 'date:plan') log(`  ${e.plan.emoji} ${e.id} → ${e.plan.venue}`);
  if (e.type === 'date:end') {
    done++;
    log(`  ${e.match ? '💘' : '·'} ${e.id} mutual=${e.mutual} (${done}/${pairs.length})`);
    store.saveSeed();
  }
  if (e.type === 'date:error') log(`  ✗ ${e.id}: ${e.error}`);
});
store.saveSeed();
log(`Done: ${store.people.size} people, ${store.dates.size} dates.`);
