import { config } from './config.js';
import { pLimit } from './util.js';
import * as anthropic from './llm/anthropic.js';
import * as gemini from './llm/gemini.js';

const providers = { anthropic, gemini };

function provider() {
  const p = providers[config.provider];
  const key = config.provider === 'gemini' ? config.gemini.key : config.anthropicKey;
  if (!p || !key) {
    const e = new Error('No LLM key configured on the server (set ANTHROPIC_API_KEY or GEMINI_API_KEY).');
    e.retryable = false;
    throw e;
  }
  return p;
}

// One global limiter so parallel dates never stampede the API.
const limit = pLimit(config.llmConcurrency);

/**
 * Structured call validated against a Zod schema. `role` picks the model:
 * 'analysis' (profile reading, swiping) or 'date' (planning, conversation, debriefs).
 * `content` may be a string or an array of content blocks (text + images).
 */
export function structured({ system, content, schema, effort = 'medium', maxTokens = 16000, role = 'analysis' }) {
  return limit(() => provider().structured({ model: config.models[role], system, content, schema, effort, maxTokens }));
}

/** Plain conversational turn. `messages` must already alternate user/assistant. */
export function chat({ system, messages, effort = 'low', maxTokens = 4000, role = 'date' }) {
  return limit(() => provider().chat({ model: config.models[role], system, messages, effort, maxTokens }));
}
