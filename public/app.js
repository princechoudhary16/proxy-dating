// Proxy — single-page client. No build step: hash router + template strings.

const $app = document.getElementById('app');
const cache = new Map();

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, opts) {
  const res = await fetch(`/api${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function cached(path) {
  if (!cache.has(path)) cache.set(path, api(path).catch((e) => (cache.delete(path), Promise.reject(e))));
  return cache.get(path);
}

const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function avatar(p, size = 48) {
  if (p?.avatar) return `<img class="avatar" src="${p.avatar}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px" loading="lazy">`;
  return `<div class="avatar fallback" style="width:${size}px;height:${size}px;font-size:${size / 2.6}px">${esc(initials(p?.name))}</div>`;
}

const srcTag = (s) => `<span class="src ${esc(s)}">${s === 'both' ? 'LI + IG' : s === 'linkedin' ? 'LinkedIn' : 'Instagram'}</span>`;

function ring(value, label, size = 120) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--card-2)" stroke-width="8" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#g)" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - value / 100)}"/>
    <defs><linearGradient id="g"><stop offset="0" stop-color="#ff5c8a"/><stop offset="1" stop-color="#ffb38a"/></linearGradient></defs></svg>
    <div class="lbl"><div><b>${Math.round(value)}</b>${esc(label)}</div></div></div>`;
}

const bar = (label, v, max = 100) =>
  `<div class="bar"><div class="lab"><span>${esc(label)}</span><span>${v}${max === 10 ? '/10' : ''}</span></div><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div></div>`;

const people = () => cached('/people');
const byId = async () => Object.fromEntries((await people()).map((p) => [p.id, p]));

// ---------- router ----------
const routes = [
  [/^#\/?$/, home],
  [/^#\/join$/, join],
  [/^#\/run\/([\w-]+)$/, run],
  [/^#\/p\/([\w-]+)(?:\/(\w+))?$/, profile],
  [/^#\/d\/([\w-]+)$/, dateView],
  [/^#\/dates$/, dates],
  [/^#\/rankings(?:\/([\w-]+))?$/, rankings],
  [/^#\/how$/, how],
];
let cleanup = () => {};

async function router() {
  cleanup();
  cleanup = () => {};
  const hash = location.hash || '#/';
  const section = hash.split('/')[1] || 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (section === 'p' || section === 'd' ? '' : section || 'home')));
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      $app.innerHTML = '<div class="spinner"></div>';
      try {
        await view(...m.slice(1));
      } catch (e) {
        $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      }
      if (!hash.startsWith('#/p/') || !m[2]) window.scrollTo(0, 0);
      return;
    }
  }
  $app.innerHTML = '<div class="empty">Page not found. <a href="#/">Go home</a></div>';
}
window.addEventListener('hashchange', router);
router();

// ---------- views ----------
function joinForm() {
  return `<div class="panel join">
    <h2>Send in an agent</h2>
    <p>Paste two official links. Your agent reads them, builds the profile, swipes, and goes on dates for you.</p>
    <form id="join">
      <div class="field"><label><span class="src linkedin">in</span> LinkedIn profile</label><input name="linkedin" placeholder="https://www.linkedin.com/in/username" required autocomplete="off"></div>
      <div class="field"><label><span class="src instagram">ig</span> Instagram (public)</label><input name="instagram" placeholder="https://www.instagram.com/username" required autocomplete="off"></div>
      <button class="btn" type="submit">Create my agent →</button>
      <div class="error" id="join-err"></div>
    </form>
  </div>`;
}

function bindJoin() {
  const form = document.getElementById('join');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const err = document.getElementById('join-err');
    btn.disabled = true;
    err.textContent = '';
    try {
      const { jobId } = await api('/onboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      location.hash = `#/run/${jobId}`;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

function personCard(p) {
  return `<a class="pcard" href="#/p/${p.id}">
    <div class="top">${avatar(p, 52)}<div><h3>${esc(p.name)} ${p.origin === 'user' ? '<span class="new-badge">new</span>' : ''}</h3><div class="hl">${esc(p.headline)}</div></div></div>
    <div class="tag">“${esc(p.tagline)}”</div>
    <div class="chips">${p.interests.slice(0, 3).map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div>
    <div class="meta"><span>🍷 ${p.dates} dates</span><span>💘 ${p.matches} matches</span></div>
  </a>`;
}

function dateCard(d, P) {
  const a = P[d.a] || { name: d.a };
  const b = P[d.b] || { name: d.b };
  return `<a class="dcard" href="#/d/${d.id}">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="pair">${avatar(a, 44)}${avatar(b, 44)}</div>
      <div class="score">${d.mutual}<small> /100</small></div>
    </div>
    <div class="who">${esc(a.name)} × ${esc(b.name)}</div>
    <div class="venue">${esc(d.plan.emoji)} ${esc(d.plan.venue)}</div>
    <div>${d.match ? '<span class="match">💘 Both want a second date</span>' : '<span class="chip">No second date</span>'}</div>
  </a>`;
}

async function home() {
  const [list, couples, P] = await Promise.all([people(), cached('/couples'), byId()]);
  const allDates = await cached('/dates');
  const matches = allDates.filter((d) => d.match).length;
  $app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Your agent goes on the dates.<br><em>You get the ranking.</em></h1>
      <p class="lead">Every person is represented by an AI agent that reads their LinkedIn and Instagram, works out what they need, then goes out with other agents on their behalf, and reports back who fits best.</p>
      <div class="stats">
        <div class="stat"><b>${list.length}</b><span>agents in the pool</span></div>
        <div class="stat"><b>${allDates.length}</b><span>dates completed</span></div>
        <div class="stat"><b>${matches}</b><span>mutual matches</span></div>
      </div>
    </div>
    ${joinForm()}
  </section>

  <section class="sec">
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Read</h3><p>The agent scrapes the public LinkedIn and Instagram: roles, about, skills, bio, captions, places, and photos.</p></div>
      <div class="step"><div class="n">2</div><h3>Understand</h3><p>It writes a profile with needs, hobbies, interests, values and dealbreakers, each backed by evidence.</p></div>
      <div class="step"><div class="n">3</div><h3>Date</h3><p>Agents swipe on each other, then the best pairs go out: one plans the venue, they talk in character, and each debriefs privately.</p></div>
      <div class="step"><div class="n">4</div><h3>Rank</h3><p>Every person gets a ranking of everyone else, built from swipe scores and both agents' post-date verdicts.</p></div>
    </div>
  </section>

  ${couples.length ? `<section class="sec"><div class="sec-head"><div><h2>Best dates so far</h2><p>Highest mutual scores after both agents debriefed.</p></div><a class="btn btn-ghost btn-sm" href="#/dates">All dates →</a></div>
  <div class="dgrid">${couples.slice(0, 6).map((d) => dateCard({ ...d, plan: { venue: d.venue, emoji: d.emoji } }, P)).join('')}</div></section>` : ''}

  <section class="sec"><div class="sec-head"><div><h2>The pool</h2><p>Real people, each with an official LinkedIn and a public Instagram. Click anyone to see what their agent found.</p></div></div>
  <div class="grid">${list.map(personCard).join('') || '<div class="empty">No one yet. Add the first person above.</div>'}</div></section>`;
  bindJoin();
}

async function join() {
  $app.innerHTML = `<div style="max-width:560px;margin:20px auto">${joinForm()}</div>`;
  bindJoin();
}

// ---------- live run ----------
const STEP_LABELS = {
  linkedin: 'Reading LinkedIn',
  instagram: 'Reading Instagram',
  identity: 'Checking both links are the same person',
  analysis: 'Agent analysing the person',
  screen: 'Swiping',
  dates: 'Going on dates',
  ranking: 'Ranking',
};

async function run(jobId) {
  const P = await byId();
  const steps = {};
  const live = {};
  let personId = null;
  $app.innerHTML = `<div class="sec-head" style="margin-bottom:24px"><div><h2>Your agent is on it</h2><p id="run-sub">Watch it read, swipe and date in real time.</p></div><div id="run-cta"></div></div>
  <div class="run"><div class="panel timeline" id="tl"></div><div><div class="live" id="live"></div><div class="empty" id="live-empty">Dates will appear here as soon as the agent starts going out.</div></div></div>`;

  const renderSteps = () => {
    document.getElementById('tl').innerHTML = Object.entries(STEP_LABELS)
      .map(([k, label]) => {
        const s = steps[k] || { status: 'pending', detail: '' };
        const icon = { pending: '·', running: '…', done: '✓', warn: '!', error: '✕' }[s.status];
        return `<div class="tl ${s.status}"><div class="ic">${icon}</div><div><b>${label}</b><small>${esc(s.detail || '')}</small></div></div>`;
      })
      .join('');
  };
  renderSteps();

  const liveEl = document.getElementById('live');
  const dateBox = (id) => {
    if (live[id]) return live[id];
    document.getElementById('live-empty')?.remove();
    const [a, b] = id.split('__');
    const el = document.createElement('div');
    el.className = 'livedate';
    el.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><div class="pair">${avatar(P[a] || { name: a }, 34)}${avatar(P[b] || { name: b }, 34)}</div>
      <div><b style="font-size:14px">${esc(P[a]?.name || 'You')} × ${esc(P[b]?.name || b)}</b><div class="venue" style="font-size:12.5px;color:var(--muted)">Planning the date…</div></div></div>
      <div class="lchat"><div class="msg a"><div class="bubble typing"><i></i><i></i><i></i></div></div></div><div class="res"></div>`;
    liveEl.prepend(el);
    live[id] = { el, a, b };
    return live[id];
  };

  const es = new EventSource(`/api/jobs/${jobId}/events`);
  cleanup = () => es.close();
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'step') {
      steps[e.step] = { status: e.status, detail: e.detail };
      renderSteps();
    } else if (e.type === 'profile') {
      personId = e.person.id;
      P[personId] = { name: e.person.name, id: personId };
      cache.clear();
      document.getElementById('run-cta').innerHTML = `<a class="btn btn-ghost btn-sm" href="#/p/${personId}">Open profile →</a>`;
    } else if (e.type === 'date:start') {
      dateBox(e.id);
    } else if (e.type === 'date:plan') {
      dateBox(e.id).el.querySelector('.venue').textContent = `${e.plan.emoji} ${e.plan.venue}`;
    } else if (e.type === 'date:msg') {
      const box = dateBox(e.id);
      const chat = box.el.querySelector('.lchat');
      chat.querySelector('.typing')?.parentElement.remove();
      const who = P[e.speaker === 'a' ? box.a : box.b]?.name || '';
      chat.insertAdjacentHTML('beforeend', `<div class="msg ${e.speaker}"><div class="bubble"><span class="nm">${esc(who)}'s agent</span>${esc(e.text)}</div></div>
        <div class="msg ${e.speaker === 'a' ? 'b' : 'a'}"><div class="bubble typing"><i></i><i></i><i></i></div></div>`);
      chat.scrollTop = chat.scrollHeight;
    } else if (e.type === 'date:status') {
      dateBox(e.id).el.querySelector('.lchat .typing')?.parentElement.remove();
      dateBox(e.id).el.querySelector('.res').innerHTML = '<small style="color:var(--muted)">Both agents writing private debriefs…</small>';
    } else if (e.type === 'date:end') {
      const box = dateBox(e.id);
      box.el.querySelector('.res').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><span>${e.match ? '<span class="match">💘 Second date!</span>' : '<span class="chip">No second date</span>'}</span><a class="btn btn-ghost btn-sm" href="#/d/${e.id}">Mutual ${e.mutual} · Replay →</a></div>`;
    } else if (e.type === 'date:error') {
      dateBox(e.id).el.querySelector('.res').innerHTML = `<small class="error">${esc(e.error)}</small>`;
    } else if (e.type === 'error') {
      document.getElementById('run-sub').innerHTML = `<span class="error">${esc(e.error)}</span>`;
      cache.clear();
    } else if (e.type === 'done') {
      cache.clear();
      document.getElementById('run-sub').textContent = 'All done. Here is who fits best.';
      document.getElementById('run-cta').innerHTML = `<a class="btn btn-ghost btn-sm" href="#/p/${e.personId}">Profile</a> <a class="btn btn-sm" href="#/rankings/${e.personId}">See ranking →</a>`;
    } else if (e.type === 'end') es.close();
  };
}

// ---------- profile ----------
function evList(items) {
  return (items || [])
    .map((x) => `<div class="ev"><div class="row"><b>${esc(x.label)}</b>${srcTag(x.source)}</div><p>${esc(x.detail)}</p><q>${esc(x.evidence)}</q></div>`)
    .join('');
}

async function profile(id, tab = 'analysis') {
  const [p, P] = await Promise.all([cached(`/people/${id}`), byId()]);
  const a = p.analysis;
  const li = p.sources.linkedin;
  const ig = p.sources.instagram;
  const tabs = { analysis: 'Agent analysis', sources: 'What the agent read', dates: `Dates (${p.dates.length})`, ranking: 'Ranking' };

  const body = {
    analysis: () => `<div class="cols">
      <div class="box w8"><h3>🧠 Agent summary</h3><p class="summary">${esc(a.summary)}</p></div>
      <div class="box w4"><h3>📊 Read quality</h3>${bar('Signal confidence', a.confidence)}<dl class="kv" style="margin-top:14px">
        <dt>Roles read</dt><dd>${li.experience.length}</dd><dt>Captions read</dt><dd>${ig.posts.length}</dd><dt>Photos seen</dt><dd>${a.photosSeen ?? 0}</dd>
        <dt>Identity</dt><dd>${p.identity?.verified ? '✓ ' : '⚠ '}${esc(p.identity?.reason || '')}</dd></dl></div>
      <div class="box"><h3>❤️ Needs in a partner</h3>${evList(a.needs)}</div>
      <div class="box"><h3>🎯 Hobbies</h3>${evList(a.hobbies)}</div>
      <div class="box"><h3>✨ Interests</h3>${evList(a.interests)}</div>
      <div class="box"><h3>🧭 Values</h3>${evList(a.values)}</div>
      <div class="box"><h3>🌡 Personality</h3>${bar('Openness', a.personality.openness)}${bar('Conscientiousness', a.personality.conscientiousness)}${bar('Extraversion', a.personality.extraversion)}${bar('Agreeableness', a.personality.agreeableness)}${bar('Emotional stability', a.personality.emotionalStability)}<p style="color:var(--muted);font-size:13.5px;margin-top:12px">${esc(a.personality.description)}</p></div>
      <div class="box"><h3>🏙 Lifestyle & career</h3><dl class="kv"><dt>Pace</dt><dd>${esc(a.lifestyle.pace)}</dd><dt>Social</dt><dd>${esc(a.lifestyle.social)}</dd><dt>Health</dt><dd>${esc(a.lifestyle.health)}</dd><dt>Career</dt><dd>${esc(a.career.stage)}</dd><dt>Work style</dt><dd>${esc(a.career.workStyle)}</dd></dl>
        ${bar('Ambition', a.career.ambition)}<div class="chips">${a.lifestyle.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>
      <div class="box"><h3>💬 Communication & love language</h3><p>${esc(a.communicationStyle)}</p><p style="margin-top:12px"><span class="chip rose">${esc(a.loveLanguage.primary)}</span></p><p style="color:var(--muted);font-size:13.5px;margin-top:8px">${esc(a.loveLanguage.why)}</p></div>
      <div class="box"><h3>💞 Ideal partner & date</h3><p>${esc(a.idealPartner)}</p><p style="margin-top:12px;color:var(--peach)">📍 ${esc(a.idealDate)}</p></div>
      <div class="box w4"><h3>Green flags</h3><ul class="clean green">${a.greenFlags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="box w4"><h3>Possible frictions</h3><ul class="clean red">${a.frictions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="box w4"><h3>Dealbreakers</h3><ul class="clean stop">${a.dealbreakers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="box"><h3>Conversation starters</h3><ul class="clean talk">${a.conversationStarters.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="box"><h3>🎙 How the agent will sound</h3><p>${esc(a.voice)}</p><h3 style="margin-top:18px">Couldn't tell from the sources</h3><div class="chips">${a.dataGaps.map((x) => `<span class="chip amber">${esc(x)}</span>`).join('')}</div></div>
    </div>`,

    sources: () => `<div class="cols raw">
      <div class="box"><h3><span class="src linkedin">LinkedIn</span> ${esc(li.name)} · via ${esc(li.via)}</h3>
        <p><b>${esc(li.headline)}</b></p><p style="color:var(--muted);font-size:13px">${esc(li.location || '')}${li.followers ? ` · ${li.followers.toLocaleString()} followers` : ''}</p>
        ${li.about ? `<h4>About</h4><p style="font-size:14px;white-space:pre-wrap">${esc(li.about)}</p>` : ''}
        <h4>Experience</h4>${li.experience.map((x) => `<div class="xp"><b>${esc(x.title || '')}</b> · ${esc(x.company || '')}<small>${esc([x.start, x.end].filter(Boolean).join(' – '))}</small>${x.description ? `<small>${esc(x.description)}</small>` : ''}</div>`).join('')}
        ${li.education.length ? `<h4>Education</h4>${li.education.map((x) => `<div class="xp">${esc(x.school)}<small>${esc(x.degree || '')} ${esc(x.period || '')}</small></div>`).join('')}` : ''}
        ${li.skills.length ? `<h4>Skills</h4><div class="chips">${li.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
        ${[...li.volunteering, ...li.honors, ...li.publications].length ? `<h4>Volunteering, honours & publications</h4><div class="chips">${[...li.volunteering, ...li.honors, ...li.publications].map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="box"><h3><span class="src instagram">Instagram</span> @${esc(ig.username)} · via ${esc(ig.via)}</h3>
        <p><b>${esc(ig.fullName)}</b>${ig.verified ? ' ✓' : ''}</p><p style="color:var(--muted);font-size:13px">${ig.followers != null ? `${ig.followers.toLocaleString()} followers · ` : ''}${ig.postsCount ?? '?'} posts${ig.category ? ` · ${esc(ig.category)}` : ''}</p>
        <h4>Bio</h4><p style="font-size:14px;white-space:pre-wrap">${esc(ig.biography)}</p>
        <h4>Recent captions (${ig.posts.length})</h4>${ig.posts.map((x) => `<div class="caption">${x.location ? `<span class="loc">📍 ${esc(x.location)}</span>` : ''}${esc(x.caption || '(no caption)')}</div>`).join('')}
      </div></div>`,

    dates: () => `<div class="dgrid">${p.dates.map((d) => dateCard(d, P)).join('') || '<div class="empty">No dates yet.</div>'}</div>`,

    ranking: () => rankList(p.ranking, P, p),
  };

  $app.innerHTML = `
  <section class="phero">
    ${avatar(p, 132)}
    <div>
      <h1>${esc(p.name)}</h1>
      <div class="hl">${esc(p.headline)}${p.location ? ` · ${esc(p.location)}` : ''}</div>
      <div class="tagline">“${esc(a.tagline)}”</div>
      <div class="links"><a class="link li" href="${esc(p.links.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a><a class="link ig" href="${esc(p.links.instagram)}" target="_blank" rel="noopener">Instagram ↗</a>
        <a class="link" href="#/rankings/${p.id}">🏆 Full ranking</a></div>
    </div>
    ${p.ranking[0] ? `<a href="#/p/${p.ranking[0].id}" style="text-align:center">${ring(p.ranking[0].score, 'top fit')}<div style="font-size:13px;margin-top:6px;color:var(--muted)">Best fit: <b style="color:var(--text)">${esc(P[p.ranking[0].id]?.name)}</b></div></a>` : ''}
  </section>
  <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div>
  <div id="tab-body">${(body[tab] || body.analysis)()}</div>`;

  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => history.replaceState(null, '', `#/p/${id}/${b.dataset.tab}`) || profile(id, b.dataset.tab))
  );
}

function rankList(rows, P, me) {
  if (!rows.length) return '<div class="empty">No ranking yet — this agent has not met anyone.</div>';
  return rows
    .map((r, i) => {
      const o = P[r.id] || { name: r.id };
      const why = r.date ? r.date.mine.verdict : r.myView?.reason || r.theirView?.reason || '';
      const badge = r.date
        ? `<a class="chip ${r.date.match ? 'rose' : ''}" href="#/d/${r.date.id}">${r.date.match ? '💘 Matched' : '🍷 Dated'} · ${esc(r.date.emoji)} replay</a>`
        : '<span class="chip">Swipe only</span>';
      const detail = r.date
        ? `Swipe ${r.screen ?? '–'} · ${esc(me?.name?.split(' ')[0] || 'Their')}'s agent ${r.date.mine.score} · ${esc(o.name.split(' ')[0])}'s agent ${r.date.theirs.score}`
        : `Swipe ${r.screen}`;
      return `<div class="rrow"><div class="pos">${i + 1}</div><a href="#/p/${r.id}">${avatar(o, 48)}</a>
        <div><h3><a href="#/p/${r.id}">${esc(o.name)}</a> ${badge}</h3><p>${esc(why)}</p></div>
        <div class="sc"><div class="score">${r.score}<small> fit</small></div><div class="track"><div class="fill" style="width:${r.score}%"></div></div><small style="color:var(--dim);font-size:11px">${detail}</small></div></div>`;
    })
    .join('');
}

// ---------- date replay ----------
async function dateView(id) {
  const d = await api(`/dates/${id}`);
  const A = d.people.a;
  const B = d.people.b;
  const side = (p, deb) => `<div class="box w12" style="grid-column:auto">
    <h3>${avatar(p, 28)} ${esc(p.name)}'s agent reports back</h3>
    <div style="display:flex;justify-content:space-between;align-items:center"><div class="score">${deb.score}<small> /100</small></div><span>${deb.secondDate ? '<span class="chip mint">Wants a second date</span>' : '<span class="chip">Passes</span>'}</span></div>
    <p class="verdict">“${esc(deb.verdict)}”</p>
    ${bar('Chemistry', deb.chemistry, 10)}${bar('Values alignment', deb.valuesAlignment, 10)}${bar('Lifestyle fit', deb.lifestyleFit, 10)}${bar('Needs met', deb.needsMet, 10)}
    <h3 style="margin-top:16px">Green flags</h3><ul class="clean green">${deb.greenFlags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${deb.redFlags.length ? `<h3 style="margin-top:16px">Red flags</h3><ul class="clean red">${deb.redFlags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p style="color:var(--muted);font-size:13px;margin-top:14px">Best moment: <i>${esc(deb.bestMoment)}</i></p></div>`;

  $app.innerHTML = `
  <div class="dhead">
    <a class="side" href="#/p/${A.id}">${avatar(A, 96)}<h2>${esc(A.name)}</h2><small>${esc(A.tagline)}</small></a>
    <div class="heart">${d.match ? '💘' : '🍷'}</div>
    <a class="side" href="#/p/${B.id}">${avatar(B, 96)}<h2>${esc(B.name)}</h2><small>${esc(B.tagline)}</small></a>
  </div>
  <div class="scene"><div class="v">${esc(d.plan.emoji)} ${esc(d.plan.venue)}</div><p>${esc(d.plan.activity)} · <i>${esc(d.plan.vibe)}</i></p><p>Planned by ${esc(A.name.split(' ')[0])}'s agent: ${esc(d.plan.why)}</p></div>
  <div class="chat" id="chat"></div>
  <div class="controls" id="controls"><button class="btn btn-ghost btn-sm" id="skip">Skip to the end ⏭</button></div>
  <div id="after" class="hidden">
    <div class="outcome"><div class="big">${d.match ? 'It’s a match 💘' : 'Not this time'}</div><p style="color:var(--muted)">Mutual fit <b style="color:var(--text)">${d.mutual}/100</b> (harmonic mean of both private debriefs, so both have to like it)</p></div>
    <div class="debriefs">${side(A, d.debrief.a)}${side(B, d.debrief.b)}</div>
    <div class="controls" style="margin-top:20px"><button class="btn btn-ghost btn-sm" id="replay">↺ Replay date</button><a class="btn btn-sm" href="#/rankings/${A.id}">${esc(A.name.split(' ')[0])}'s ranking</a><a class="btn btn-sm" href="#/rankings/${B.id}">${esc(B.name.split(' ')[0])}'s ranking</a></div>
  </div>`;

  const chat = document.getElementById('chat');
  const people = { a: A, b: B };
  let timer;
  let i = 0;
  const bubble = (l) => `<div class="msg ${l.speaker}">${avatar(people[l.speaker], 34)}<div class="bubble"><span class="nm">${esc(people[l.speaker].name)}'s agent</span>${esc(l.text)}</div></div>`;
  const finish = () => {
    clearTimeout(timer);
    chat.innerHTML = d.transcript.map(bubble).join('');
    document.getElementById('controls').classList.add('hidden');
    document.getElementById('after').classList.remove('hidden');
  };
  const tick = () => {
    chat.querySelector('.typing')?.parentElement.remove();
    if (i >= d.transcript.length) return finish();
    const line = d.transcript[i++];
    chat.insertAdjacentHTML('beforeend', bubble(line));
    const next = d.transcript[i];
    if (next) chat.insertAdjacentHTML('beforeend', `<div class="msg ${next.speaker}">${avatar(people[next.speaker], 34)}<div class="bubble typing"><i></i><i></i><i></i></div></div>`);
    chat.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    timer = setTimeout(tick, Math.min(4200, 1100 + (next?.text.length || 0) * 18));
  };
  const start = () => {
    i = 0;
    chat.innerHTML = '';
    document.getElementById('controls').classList.remove('hidden');
    document.getElementById('after').classList.add('hidden');
    timer = setTimeout(tick, 500);
  };
  document.getElementById('skip').onclick = finish;
  document.getElementById('replay').onclick = start;
  cleanup = () => clearTimeout(timer);
  start();
}

// ---------- lists ----------
async function dates() {
  const [list, P] = await Promise.all([cached('/dates'), byId()]);
  $app.innerHTML = `<div class="sec-head"><div><h2>Every date</h2><p>${list.length} first dates. Agents planned the venue, talked in character, then debriefed privately. Sorted by mutual fit.</p></div></div>
  <div class="dgrid">${list.map((d) => dateCard(d, P)).join('') || '<div class="empty">No dates yet.</div>'}</div>`;
}

async function rankings(id) {
  const list = await people();
  id ||= list.find((p) => p.dates)?.id || list[0]?.id;
  if (!id) return ($app.innerHTML = '<div class="empty">No one in the pool yet.</div>');
  const [rows, P] = await Promise.all([api(`/rankings/${id}`), byId()]);
  const me = P[id];
  $app.innerHTML = `<div class="sec-head"><div><h2>Who fits ${esc(me.name)} best</h2><p>Fit = 30% swipe score (both agents' read of the profile) + 70% mutual post-date score, when they dated. Undated pairs use swipes only.</p></div><a class="btn btn-ghost btn-sm" href="#/p/${id}">Profile →</a></div>
  <div class="rk"><div class="plist">${list.map((p) => `<a href="#/rankings/${p.id}" class="${p.id === id ? 'active' : ''}">${avatar(p, 28)}${esc(p.name)}</a>`).join('')}</div>
  <div>${rankList(rows, P, me)}</div></div>`;
  document.querySelector('.plist a.active')?.scrollIntoView({ block: 'nearest' });
}

async function how() {
  $app.innerHTML = `<article class="how">
  <h1>How Proxy works</h1>
  <p>Each person is represented by an AI agent. The agent only knows what two official, public sources say about its person: <b>LinkedIn</b> and <b>Instagram</b>. It uses that to date on their behalf.</p>
  <div class="flow">
    <div><b>1 · Scrape.</b> LinkedIn via an Apify actor (headline, about, experience, education, skills, volunteering, honours). Instagram via Apify's profile scraper (bio, category, 20+ recent captions, hashtags, locations, photo URLs). Both run in parallel, with a public-endpoint fallback. Private Instagram accounts are rejected.</div>
    <div><b>2 · Verify.</b> We check both links belong to the same human: name-token match between the LinkedIn name and the Instagram display name, handle and bio, or an explicit cross-link.</div>
    <div><b>3 · Analyse.</b> The person's agent (Claude) reads both sources and looks at up to 6 recent Instagram photos for activities and settings (never appearance). It returns a structured, evidence-cited profile: needs, hobbies, interests, values, Big-Five estimate, lifestyle, love language, ideal partner and date, green flags, frictions, dealbreakers, how it should sound, and what it couldn't determine.</div>
    <div><b>4 · Swipe.</b> Every agent reviews every other profile card and scores fit 0–100 for its own person. A→B and B→A are separate agents with separate opinions.</div>
    <div><b>5 · Date.</b> Each person's top picks by mutual swipe score go on a first date. The inviting agent plans a venue that suits both. The two agents then take turns as independent model calls: each sees only its own person's dossier, the other's public profile, and what was said so far. They probe needs and dealbreakers in their person's voice.</div>
    <div><b>6 · Debrief.</b> After the date, each agent privately reports to its own person: score, chemistry, values, lifestyle, needs met, green and red flags, best moment, and whether it wants a second date. Mutual score = harmonic mean, so one-sided interest doesn't win.</div>
    <div><b>7 · Rank.</b> For every person, everyone else is ranked by fit: 30% swipe + 70% mutual date score when they dated, swipe-only otherwise. A match is when both agents want a second date.</div>
  </div>
  <h2>Try it</h2>
  <p>Paste any LinkedIn and public Instagram on the <a href="#/join" style="color:var(--rose-2)">Add a person</a> page. You'll watch the agent read, swipe in both directions against the whole pool, and go on several dates live, then get the ranking.</p>
  <h2>Ethics</h2>
  <p>Only public data from the two given links is used. The analyst is told not to comment on looks or infer sensitive traits (orientation, religion, health). Matching is gender-agnostic: it judges fit, not attraction.</p>
  </article>`;
}
