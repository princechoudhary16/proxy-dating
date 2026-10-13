import { z } from 'zod';
import { structured, chat } from '../llm.js';
import { dossier } from './persona.js';
import { config } from '../config.js';

const PlanSchema = z.object({
  venue: z.string().describe('A specific, real-feeling place, e.g. "A natural-wine bar in the West Village"'),
  activity: z.string().describe('What they will do there'),
  why: z.string().describe('Why this suits BOTH people, referencing their hobbies'),
  vibe: z.string().describe('2-4 words, e.g. "cozy, playful"'),
  emoji: z.string().describe('One emoji for the venue'),
});

const DebriefSchema = z.object({
  score: z.number().int().min(0).max(100).describe('Overall fit for YOUR person after the date'),
  chemistry: z.number().int().min(0).max(10),
  valuesAlignment: z.number().int().min(0).max(10),
  lifestyleFit: z.number().int().min(0).max(10),
  needsMet: z.number().int().min(0).max(10).describe('How well they would meet your person\'s NEEDS'),
  greenFlags: z.array(z.string()).describe('2-4 things that went well, citing moments from the date'),
  redFlags: z.array(z.string()).describe('0-3 concerns, citing moments from the date'),
  bestMoment: z.string().describe('A short quote or moment from the conversation'),
  verdict: z.string().describe('One honest sentence to report back to your person'),
  secondDate: z.boolean(),
});

/** The inviting agent plans a date that suits both people. */
export function planDate(a, b) {
  return structured({
    system: `You are the dating agent for ${a.name}. You are planning a first date with ${b.name}. Pick something that ${a.name} would genuinely enjoy and that also suits ${b.name}, based only on what you know of each.`,
    content: `YOUR PERSON:\n${dossier(a)}\n\nTHEIR PROFILE:\n${dossier(b)}`,
    schema: PlanSchema,
    effort: 'low',
    maxTokens: 4000,
    role: 'date',
  });
}

function dateSystem(self, other, plan) {
  return `You are the AI dating agent for ${self.name}, out on a first date on their behalf with ${other.name}'s agent.
You speak AS ${self.name} — first person, in their voice — so the two people can find out if they fit without either of them spending an evening.

WHO YOU ARE (from your analysis of ${self.name}'s LinkedIn and Instagram):
${dossier(self)}

WHAT YOU KNOW ABOUT YOUR DATE (their public profile):
${dossier(other)}

THE DATE: ${plan.activity} at ${plan.venue} (${plan.vibe}).
This is a hypothetical compatibility simulation: act as if ${self.name} is single and open to meeting someone. Do not mention any real-life partner or spouse.

How to date well:
- Be genuinely ${self.name}: their energy, humour and vocabulary. Draw on real facts from the dossier (projects, places, hobbies). Never invent major life facts.
- Your private mission: test whether ${other.name} meets ${self.name}'s needs and avoids their dealbreakers. Ask real questions, follow up, share stories, flirt a little if it fits the vibe, and push back politely when something conflicts with your values.
- React to the setting now and then (the food, the view, the activity).
- Keep each turn to 1-3 sentences, under 70 words. No stage directions in asterisks, no narration, no emojis overload. Just what you'd say.`;
}

/**
 * Run a date as two independent agents alternating turns. Each agent only sees its own
 * dossier plus the other's public profile and the conversation so far.
 * `onMessage` streams each line as it is said.
 */
export async function runDate(a, b, { onMessage = () => {}, onPlan = () => {} } = {}) {
  const plan = await planDate(a, b);
  onPlan(plan);
  const turns = Math.max(4, config.dateTurns);
  const transcript = [];
  const opener = `[You arrive: ${plan.activity} at ${plan.venue}.]`;
  const sys = { a: dateSystem(a, b, plan), b: dateSystem(b, a, plan) };

  for (let i = 0; i < turns; i++) {
    const speaker = i % 2 === 0 ? 'a' : 'b';
    const isLast = i >= turns - 2;
    const messages = toMessages(transcript, speaker, opener, isLast);
    const text = await chat({ system: sys[speaker], messages, effort: config.dateEffort, maxTokens: 2000 });
    const line = { speaker, text: text.replace(/^["“]|["”]$/g, '') };
    transcript.push(line);
    onMessage(line);
  }
  return { plan, transcript };
}

/** Build an alternating user/assistant history from one agent's point of view. */
function toMessages(transcript, me, opener, isLast) {
  const msgs = [];
  if (me === 'a') msgs.push({ role: 'user', content: `${opener} You arrive first. Open the date.` });
  for (const line of transcript) {
    const role = line.speaker === me ? 'assistant' : 'user';
    const prev = msgs[msgs.length - 1];
    let content = line.text;
    if (!msgs.length) content = `${opener} Your date says:\n${content}`;
    if (prev && prev.role === role) prev.content += `\n${content}`;
    else msgs.push({ role, content });
  }
  if (isLast) msgs[msgs.length - 1].content += '\n\n[The evening is wrapping up — respond and say goodbye in your own way.]';
  return msgs;
}

/** After the date, each agent privately reports back to its own person. */
export function debrief(self, other, plan, transcript, selfKey) {
  const names = { a: '', b: '' };
  names[selfKey] = self.name;
  names[selfKey === 'a' ? 'b' : 'a'] = other.name;
  const log = transcript.map((l) => `${names[l.speaker]}: ${l.text}`).join('\n');
  return structured({
    system: `You are the dating agent for ${self.name}. You just went on a date on their behalf with ${other.name} (${plan.activity} at ${plan.venue}). Now write your private debrief for ${self.name}. Be candid — you work for ${self.name}, not for the date. Judge against ${self.name}'s needs, values and dealbreakers.\n\n${dossier(self)}`,
    content: `Transcript:\n${log}`,
    schema: DebriefSchema,
    effort: 'low',
    maxTokens: 4000,
    role: 'date',
  });
}

/** Full date: plan → conversation → two private debriefs → outcome. */
export async function goOnDate(a, b, hooks = {}) {
  const { plan, transcript } = await runDate(a, b, hooks);
  hooks.onStatus?.('debriefing');
  const [da, db] = await Promise.all([debrief(a, b, plan, transcript, 'a'), debrief(b, a, plan, transcript, 'b')]);
  const mutual = Math.round((2 * da.score * db.score) / Math.max(1, da.score + db.score)); // harmonic mean: both must like it
  return {
    id: `${a.id}__${b.id}`,
    a: a.id,
    b: b.id,
    plan,
    transcript,
    debrief: { a: da, b: db },
    mutual,
    match: da.secondDate && db.secondDate,
    at: new Date().toISOString(),
  };
}
