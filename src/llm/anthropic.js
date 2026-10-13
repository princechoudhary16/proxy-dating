import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import { sleep } from '../util.js';

// Input-tokens-per-minute budget per model (Anthropic rate limits are ITPM-based). Estimate ~4 chars/token.
const ITPM = Number(process.env.ANTHROPIC_ITPM) || 380_000;
const spent = new Map(); // model -> [{ t, tokens }]
const IMAGE_TOKENS = 1600;
const estimate = (x) => {
  const json = JSON.stringify(x);
  const images = (json.match(/"type":"image"/g) || []).length;
  return Math.ceil(json.replace(/"data":"[^"]+"/g, '').length / 4) + images * IMAGE_TOKENS;
};

async function budget(model, tokens) {
  const w = spent.get(model) ?? spent.set(model, []).get(model);
  for (;;) {
    const now = Date.now();
    while (w.length && now - w[0].t > 60_000) w.shift();
    const used = w.reduce((s, e) => s + e.tokens, 0);
    if (used + tokens <= ITPM || !w.length) return void w.push({ t: now, tokens });
    await sleep(60_000 - (now - w[0].t) + 50);
  }
}

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
  await budget(model, estimate([system, content]));
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
  await budget(model, estimate([system, messages]));
  const res = await getClient().messages.create({ model, max_tokens: maxTokens, system, messages, output_config: { effort } });
  assertUsable(res);
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
