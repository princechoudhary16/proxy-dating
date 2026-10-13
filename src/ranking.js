import { store } from './store.js';

const avg = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/** How well do `a` and `b` fit, from the swipe phase alone (mean of both directions). */
export function screenScore(a, b) {
  return avg([store.screens[a]?.[b]?.score, store.screens[b]?.[a]?.score]);
}

/**
 * Ranking for one person over everyone else.
 *  - Dated pairs: 30% swipe score + 70% mutual post-date score (harmonic mean of both debriefs),
 *    because what agents learn on a date outweighs a profile read.
 *  - Not dated:   swipe score only.
 */
export function rankFor(id) {
  const rows = [];
  for (const other of store.people.values()) {
    if (other.id === id) continue;
    const screen = screenScore(id, other.id);
    const date = store.getDate(id, other.id);
    if (screen == null && !date) continue;
    const side = date ? (date.a === id ? 'a' : 'b') : null;
    const score = date ? Math.round(0.3 * (screen ?? date.mutual) + 0.7 * date.mutual) : Math.round(screen);
    rows.push({
      id: other.id,
      score,
      screen: screen == null ? null : Math.round(screen),
      myView: store.screens[id]?.[other.id] || null,
      theirView: store.screens[other.id]?.[id] || null,
      date: date && {
        id: date.id,
        mutual: date.mutual,
        match: date.match,
        venue: date.plan.venue,
        emoji: date.plan.emoji,
        mine: date.debrief[side],
        theirs: date.debrief[side === 'a' ? 'b' : 'a'],
      },
    });
  }
  return rows.sort((x, y) => y.score - x.score || (y.date ? 1 : 0) - (x.date ? 1 : 0));
}

/** Best mutual couples across the whole pool. */
export function topCouples(limit = 10) {
  return [...store.dates.values()]
    .map((d) => ({ id: d.id, a: d.a, b: d.b, mutual: d.mutual, match: d.match, venue: d.plan.venue, emoji: d.plan.emoji }))
    .sort((x, y) => Number(y.match) - Number(x.match) || y.mutual - x.mutual)
    .slice(0, limit);
}
