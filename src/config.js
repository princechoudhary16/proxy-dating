import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const provider = process.env.LLM_PROVIDER || (anthropicKey ? 'anthropic' : geminiKey ? 'gemini' : 'anthropic');
const DEFAULT_MODELS = {
  anthropic: { analysis: 'claude-opus-5-5', date: 'claude-opus-5-5' },
  gemini: { analysis: 'gemini-3.8-flash', date: 'gemini-flash-lite-latest' },
};

export const config = {
  root,
  port: int(process.env.PORT, 3000),
  dataDir: path.join(root, 'data'),
  anthropicKey,
  apifyToken: process.env.APIFY_TOKEN || '',
  provider,
  models: {
    analysis: process.env.ANALYSIS_MODEL || DEFAULT_MODELS[provider]?.analysis,
    date: process.env.DATE_MODEL || DEFAULT_MODELS[provider]?.date,
    screen: process.env.SCREEN_MODEL || process.env.DATE_MODEL || DEFAULT_MODELS[provider]?.date,
  },
  gemini: {
    key: geminiKey,
    // Fallback chains per role (comma-separated env overrides).
    models: {
      analysis: (process.env.GEMINI_ANALYSIS_MODELS || 'gemini-3.8-flash,gemini-flash-latest,gemini-3.7-flash,gemini-flash-lite-latest').split(','),
      date: (process.env.GEMINI_DATE_MODELS || 'gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-flash-latest').split(','),
    },
    // Free-tier requests-per-minute per model; override with GEMINI_RPM_<MODEL>=n or GEMINI_RPM=n.
    rpm: new Proxy(
      {},
      { get: (_t, m) => int(process.env[`GEMINI_RPM_${String(m).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`], int(process.env.GEMINI_RPM, 9)) }
    ),
  },
  analysisEffort: process.env.ANALYSIS_EFFORT || 'medium',
  dateEffort: process.env.DATE_EFFORT || 'low',
  datesPerPerson: int(process.env.DATES_PER_PERSON, 4),
  dateTurns: int(process.env.DATE_TURNS, 8),
  llmConcurrency: int(process.env.LLM_CONCURRENCY, 8),
  maxConcurrentJobs: int(process.env.MAX_CONCURRENT_JOBS, 2),
  apify: {
    instagramActor: process.env.APIFY_INSTAGRAM_ACTOR || 'apify~instagram-profile-scraper',
    linkedinActors: (process.env.APIFY_LINKEDIN_ACTORS || 'supreme_coder~linkedin-profile-scraper,harvestapi~linkedin-profile-scraper').split(','),
    timeoutSecs: int(process.env.APIFY_TIMEOUT_SECS, 180),
  },
};
