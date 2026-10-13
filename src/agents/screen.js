import { z } from 'zod';
import { structured } from '../llm.js';
import { card, dossier } from './persona.js';

const ScreenSchema = z.object({
  ratings: z.array(
    z.object({
      id: z.string(),
      score: z.number().int().min(0).max(100),
      reason: z.string().describe('One specific sentence: why they would or would not fit YOUR person'),
    })
  ),
});

/**
 * Swipe phase: an agent reviews every candidate's card against the person it represents
 * and scores how much it wants to take them on a date.
 */
export async function screenCandidates(person, candidates) {
  if (!candidates.length) return {};
  const system = `You are the dating agent for ${person.name}. You know them deeply:

${dossier(person)}

You are swiping through other agents' profiles on behalf of ${person.name}. Score each candidate 0-100 for how well they would fit ${person.name} as a romantic partner — needs met, values aligned, lifestyle compatible, interesting chemistry potential, dealbreakers avoided. Be discerning: use the full range, most candidates should land between 30 and 75 and only exceptional fits above 85. Do not consider gender or appearance; judge fit only.`;
  const content = `Candidates:\n\n${candidates.map(card).join('\n\n')}\n\nReturn a rating for every candidate id.`;
  const { ratings } = await structured({ system, content, schema: ScreenSchema, effort: 'low' });
  const valid = new Set(candidates.map((c) => c.id));
  return Object.fromEntries(ratings.filter((r) => valid.has(r.id)).map((r) => [r.id, { score: r.score, reason: r.reason }]));
}
