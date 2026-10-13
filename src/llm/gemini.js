import { z } from 'zod';
import { config } from '../config.js';
import { sleep } from '../util.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Anthropic-style content blocks → Gemini parts. */
function toParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((b) =>
    b.type === 'image' ? { inline_data: { mime_type: b.source.media_type, data: b.source.data } } : { text: b.text }
  );
}

// Sliding-window requests-per-minute limiter, one window per model (free-tier quotas are per model).
const windows = new Map();
async function throttle(model) {
  const rpm = config.gemini.rpm[model] ?? config.gemini.rpm.default;
  const w = windows.get(model) ?? windows.set(model, []).get(model);
  for (;;) {
    const now = Date.now();
    while (w.length && now - w[0] > 60_000) w.shift();
    if (w.length < rpm) return void w.push(now);
    await sleep(60_000 - (now - w[0]) + 50);
  }
}

async function generate(model, body) {
  for (let attempt = 0; ; attempt++) {
    await throttle(model);
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) {
      const json = await res.json();
      const cand = json.candidates?.[0];
      if (!cand) throw Object.assign(new Error(`Gemini blocked the prompt (${json.promptFeedback?.blockReason || 'no candidate'})`), { retryable: false });
      const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error(`Gemini returned no text (finishReason ${cand.finishReason})`);
      return text;
    }
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      const daily = /PerDay/i.test(JSON.stringify(err));
      if (daily) throw Object.assign(new Error(`Gemini daily quota exhausted for ${model}: ${msg}`), { retryable: false });
      if (attempt < 8) {
        const hint = err.error?.details?.find((d) => d.retryDelay)?.retryDelay;
        await sleep(hint ? parseFloat(hint) * 1000 + 500 : 4000 * 2 ** Math.min(attempt, 4));
        continue;
      }
    }
    throw Object.assign(new Error(`Gemini ${model}: ${msg}`), { status: res.status, retryable: res.status !== 400 });
  }
}

const thinking = (effort) => (effort === 'low' ? { thinkingConfig: { thinkingBudget: 0 } } : {});

function jsonSchema(schema) {
  const { $schema, ...s } = z.toJSONSchema(schema);
  return s;
}

export async function structured({ model, system, content, schema, effort, maxTokens }) {
  const contents = [{ role: 'user', parts: toParts(content) }];
  const generationConfig = {
    maxOutputTokens: maxTokens,
    responseMimeType: 'application/json',
    responseJsonSchema: jsonSchema(schema),
    ...thinking(effort),
  };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await generate(model, { system_instruction: { parts: [{ text: system }] }, contents, generationConfig });
    try {
      return schema.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Gemini output did not match the schema: ${lastErr.message.slice(0, 300)}`);
}

export function chat({ model, system, messages, effort, maxTokens }) {
  return generate(model, {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m.content) })),
    generationConfig: { maxOutputTokens: maxTokens, temperature: 1, ...thinking(effort) },
  });
}
