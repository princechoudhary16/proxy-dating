import { z } from 'zod';
import { config } from '../config.js';
import { sleep } from '../util.js';

/**
 * Gemini via the Interactions API (v1beta/interactions) — the endpoint new API keys are served on.
 * Each role has a chain of models; on overload (503) or quota (429) a model cools down and the
 * next one in the chain takes over, so the free tier keeps making progress.
 */
const URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const cooldown = new Map(); // model -> timestamp when it may be used again
const windows = new Map(); // model -> request timestamps in the last minute

function toInput(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((b) => (b.type === 'image' ? { type: 'image', data: b.source.data, mime_type: b.source.media_type } : { type: 'text', text: b.text }));
}

async function throttle(model) {
  const rpm = config.gemini.rpm[model];
  const w = windows.get(model) ?? windows.set(model, []).get(model);
  for (;;) {
    const now = Date.now();
    while (w.length && now - w[0] > 60_000) w.shift();
    if (w.length < rpm) return void w.push(now);
    await sleep(60_000 - (now - w[0]) + 50);
  }
}

async function pickModel(chain) {
  for (;;) {
    const now = Date.now();
    const ready = chain.find((m) => (cooldown.get(m) || 0) <= now);
    if (ready) return ready;
    await sleep(Math.max(500, Math.min(...chain.map((m) => cooldown.get(m))) - now));
  }
}

async function interact(role, body) {
  const chain = config.gemini.models[role];
  let lastErr;
  for (let attempt = 0; attempt < 24; attempt++) {
    const model = await pickModel(chain);
    await throttle(model);
    let res;
    try {
      res = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
        body: JSON.stringify({ model, store: false, ...body }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      lastErr = e;
      cooldown.set(model, Date.now() + 5_000);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = (json.steps || [])
        .filter((s) => s.type === 'model_output')
        .flatMap((s) => s.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
        .trim();
      if (text) return text;
      lastErr = new Error(`Gemini ${model} returned no text (status ${json.status})`);
      continue;
    }
    lastErr = new Error(`Gemini ${model}: ${json.error?.message || `HTTP ${res.status}`}`);
    if (res.status === 429) cooldown.set(model, Date.now() + 60_000);
    else if (res.status === 503 || res.status >= 500) cooldown.set(model, Date.now() + 8_000 * (1 + (attempt % 3)));
    else if (res.status === 404) cooldown.set(model, Date.now() + 3600_000);
    else throw Object.assign(lastErr, { retryable: false });
  }
  throw lastErr;
}

const thinkingLevel = (effort) => (effort === 'low' ? 'low' : effort === 'high' ? 'high' : 'medium');

function jsonSchema(schema) {
  const { $schema, ...s } = z.toJSONSchema(schema);
  return s;
}

export async function structured({ role, system, content, schema, effort, maxTokens }) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await interact(role, {
      system_instruction: system,
      input: toInput(content),
      generation_config: { thinking_level: thinkingLevel(effort), max_output_tokens: maxTokens },
      response_format: { type: 'text', mime_type: 'application/json', schema: jsonSchema(schema) },
    });
    try {
      return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Gemini output did not match the schema: ${String(lastErr.message).slice(0, 300)}`);
}

/** Stateless turn: the conversation so far is rendered as a script for the agent to continue. */
export function chat({ role, system, messages, effort, maxTokens }) {
  const script = messages
    .map((m) => (m.role === 'assistant' ? `YOU SAID: ${m.content}` : m.content))
    .join('\n\n');
  return interact(role, {
    system_instruction: system,
    input: [{ type: 'text', text: `${script}\n\nReply with only your next line of dialogue.` }],
    generation_config: { thinking_level: thinkingLevel(effort), max_output_tokens: maxTokens },
  });
}
