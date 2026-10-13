import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  root,
  port: int(process.env.PORT, 3000),
  dataDir: path.join(root, 'data'),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  apifyToken: process.env.APIFY_TOKEN || '',
  model: process.env.MODEL || 'claude-opus-5-5',
  analysisEffort: process.env.ANALYSIS_EFFORT || 'medium',
  dateEffort: process.env.DATE_EFFORT || 'low',
  datesPerPerson: int(process.env.DATES_PER_PERSON, 4),
  dateTurns: int(process.env.DATE_TURNS, 8),
  llmConcurrency: int(process.env.LLM_CONCURRENCY, 8),
  maxConcurrentJobs: int(process.env.MAX_CONCURRENT_JOBS, 2),
  apify: {
    instagramActor: process.env.APIFY_INSTAGRAM_ACTOR || 'apify~instagram-profile-scraper',
    linkedinActor: process.env.APIFY_LINKEDIN_ACTOR || 'harvestapi~linkedin-profile-scraper',
    timeoutSecs: int(process.env.APIFY_TIMEOUT_SECS, 180),
  },
};
