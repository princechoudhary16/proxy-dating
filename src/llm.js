import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { pLimit } from './util.js';

let client;
function getClient() {
  if (!config.anthropicKey) {
    const e = new Error('ANTHROPIC_API_KEY is not configured on the server.');
    e.retryable = false;
    throw e;
  }
  client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 5, timeout: 180_000 });
  return client;
}

// One global limiter so parallel dates never stampede the API.
const limit = pLimit(config.llmConcurrency);

function assertUsable(res) {
  if (res.stop_reason === 'refusal') {
    const e = new Error(`Model declined the request (${res.stop_details?.category ?? 'unspecified'})`);
    e.retryable = false;
    throw e;
  }
}

/**
 * Structured call: returns an object validated against a Zod schema.
 * `content` may be a string or an array of content blocks (text + images).
 */
export function structured({ system, content, schema, effort = 'medium', maxTokens = 16000 }) {
  return limit(async () => {
    const res = await getClient().messages.parse({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: zodOutputFormat(schema) },
    });
    assertUsable(res);
    if (!res.parsed_output) throw new Error('Model returned no parseable output');
    return res.parsed_output;
  });
}

/** Plain conversational turn. `messages` must already alternate user/assistant. */
export function chat({ system, messages, effort = 'low', maxTokens = 4000 }) {
  return limit(async () => {
    const res = await getClient().messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort },
    });
    assertUsable(res);
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  });
}
