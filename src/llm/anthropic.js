import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';

let client;
function getClient() {
  client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 5, timeout: 180_000 });
  return client;
}

function assertUsable(res) {
  if (res.stop_reason === 'refusal') {
    const e = new Error(`Model declined the request (${res.stop_details?.category ?? 'unspecified'})`);
    e.retryable = false;
    throw e;
  }
}

export async function structured({ model, system, content, schema, effort, maxTokens }) {
  const res = await getClient().messages.parse({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: zodOutputFormat(schema) },
  });
  assertUsable(res);
  if (!res.parsed_output) throw new Error('Model returned no parseable output');
  return res.parsed_output;
}

export async function chat({ model, system, messages, effort, maxTokens }) {
  const res = await getClient().messages.create({ model, max_tokens: maxTokens, system, messages, output_config: { effort } });
  assertUsable(res);
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
