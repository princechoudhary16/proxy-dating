import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SEED = path.join(config.dataDir, 'seed.json');
const RUNTIME = path.join(config.dataDir, 'runtime.json');

export const pairKey = (a, b) => [a, b].sort().join('__');

/**
 * In-memory state backed by two JSON files:
 *  - seed.json    the finished 25-person example (committed to the repo)
 *  - runtime.json people added through the website, plus their screens and dates
 */
class Store {
  people = new Map();
  screens = {}; // screens[raterId][candidateId] = { score, reason }
  dates = new Map(); // pairKey -> date

  load() {
    for (const file of [SEED, RUNTIME]) {
      if (!fs.existsSync(file)) continue;
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const p of s.people || []) this.people.set(p.id, p);
      for (const [r, m] of Object.entries(s.screens || {})) Object.assign((this.screens[r] ??= {}), m);
      for (const d of s.dates || []) this.dates.set(pairKey(d.a, d.b), d);
    }
    return this;
  }

  snapshot(filter = () => true) {
    const people = [...this.people.values()].filter(filter);
    const ids = new Set(people.map((p) => p.id));
    const screens = {};
    for (const [r, m] of Object.entries(this.screens))
      for (const [c, v] of Object.entries(m)) if (ids.has(r) || ids.has(c)) (screens[r] ??= {})[c] = v;
    const dates = [...this.dates.values()].filter((d) => ids.has(d.a) || ids.has(d.b));
    return { people, screens, dates };
  }

  saveSeed() {
    write(SEED, { generatedAt: new Date().toISOString(), ...this.snapshot() });
  }

  saveRuntime() {
    write(RUNTIME, this.snapshot((p) => p.origin === 'user'));
  }

  upsertPerson(p) {
    this.people.set(p.id, p);
  }

  setScreen(rater, candidate, v) {
    (this.screens[rater] ??= {})[candidate] = v;
  }

  addDate(d) {
    this.dates.set(pairKey(d.a, d.b), d);
  }

  getDate(a, b) {
    return this.dates.get(pairKey(a, b));
  }

  datesFor(id) {
    return [...this.dates.values()].filter((d) => d.a === id || d.b === id);
  }
}

function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

export const store = new Store();
