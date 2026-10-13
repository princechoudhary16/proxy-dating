/** Compact descriptions of a person, shared by the screening and dating agents. */
const pick = (arr, n = 6) => (arr || []).slice(0, n).map((x) => x.label).join(', ');

export function card(p) {
  const a = p.analysis;
  return [
    `id: ${p.id}`,
    `name: ${p.name} — ${p.headline || ''}${p.location ? ` (${p.location})` : ''}`,
    `tagline: ${a.tagline}`,
    `needs: ${pick(a.needs)}`,
    `hobbies: ${pick(a.hobbies)}`,
    `interests: ${pick(a.interests)}`,
    `values: ${pick(a.values)}`,
    `lifestyle: ${a.lifestyle.tags.join(', ')}`,
    `dealbreakers: ${a.dealbreakers.join('; ')}`,
  ].join('\n');
}

export function dossier(p) {
  const a = p.analysis;
  const ev = (arr) => (arr || []).map((x) => `- ${x.label}: ${x.detail} (evidence: ${x.evidence})`).join('\n');
  return `NAME: ${p.name}
HEADLINE: ${p.headline || ''}
LOCATION: ${p.location || 'unknown'}
SUMMARY: ${a.summary}
NEEDS IN A PARTNER:
${ev(a.needs)}
HOBBIES:
${ev(a.hobbies)}
INTERESTS:
${ev(a.interests)}
VALUES:
${ev(a.values)}
PERSONALITY: ${a.personality.description}
LIFESTYLE: ${a.lifestyle.pace}; ${a.lifestyle.social}; health: ${a.lifestyle.health}
CAREER: ${a.career.stage}; ${a.career.workStyle}
COMMUNICATION STYLE: ${a.communicationStyle}
LOVE LANGUAGE: ${a.loveLanguage.primary} — ${a.loveLanguage.why}
IDEAL PARTNER: ${a.idealPartner}
GREEN FLAGS: ${a.greenFlags.join('; ')}
FRICTIONS: ${a.frictions.join('; ')}
DEALBREAKERS: ${a.dealbreakers.join('; ')}
VOICE: ${a.voice}`;
}
