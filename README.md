# Proxy — agents that date for you

**Paste a LinkedIn and a public Instagram. An AI agent reads the person, swipes on everyone in the pool, goes on real multi-turn dates with other people's agents, and ranks who fits best.**

- **Live site:** _add your deploy URL_
- **Demo (finished example, 27 real people):** _add your deploy URL_ `/#/rankings`
- **Video:** _add YouTube link_

---

## What it does

| Step | What happens | Where you see it |
|---|---|---|
| 1. Read | Both official links are scraped in parallel. LinkedIn gives headline, about, experience, education, skills, volunteering and honours. Instagram gives bio, category, recent captions, hashtags, locations and photos. | Profile → *What the agent read* |
| 2. Verify | Checks that the two links belong to the same human: name-token match or an explicit cross-link. Private Instagram accounts are rejected. | Profile → *Read quality* |
| 3. Analyse | The person's agent reads both sources **and looks at their recent Instagram photos**, then writes a structured, evidence-cited profile: needs, hobbies, interests, values, Big-Five estimate, lifestyle, career, love language, ideal partner and date, green flags, frictions, dealbreakers, voice, and data gaps. Every item names its source and the evidence. | Profile → *Agent analysis* |
| 4. Swipe | Every agent scores every other profile for *its own* person (0–100 plus a reason). A→B and B→A are independent opinions. | Ranking → "Swipe only" rows |
| 5. Date | Each person's top-K by mutual swipe score go on a first date. The inviting agent **plans a venue** that suits both. Then **two independent agents alternate turns**: each knows only its own person's dossier, the other's public profile, and the conversation so far. They speak in their person's voice and probe needs and dealbreakers. | Dates → replay, or live on the run page |
| 6. Debrief | After the date each agent **privately** reports to its own person: score, chemistry, values, lifestyle, needs met, green and red flags, best moment, and whether it wants a second date. | Date page → debriefs |
| 7. Rank | For every person, everyone else is ranked: `0.3 × swipe + 0.7 × mutual date score` if they dated, otherwise swipe only. Mutual = harmonic mean of both debriefs, so one-sided interest can't win. Match = both want a second date. | Rankings |

When you add someone through the website, the same pipeline runs live over Server-Sent Events. You watch the scrape, the analysis, the two-way swipes against the whole pool, and several dates streaming line by line, ending with their ranking.

## Architecture

```
public/            vanilla JS single-page app (no build step)
server.js          Express API + SSE job stream + static hosting
src/
  scrape/          Apify actors (LinkedIn + Instagram), public fallbacks, identity check
  agents/
    analyst.js     profile analysis (text + photos → Zod-validated structured output)
    screen.js      swipe phase
    date.js        venue planning, turn-by-turn multi-agent date, private debriefs
    persona.js     the dossier/card each agent carries
  llm.js           provider-agnostic facade (Claude or Gemini) + global concurrency limit
  llm/             anthropic.js (Messages API + structured outputs), gemini.js (Interactions API, model fallback chains, RPM limiter)
  pipeline.js      onboarding flow, pair selection, parallel dates
  ranking.js       ranking + top couples
  store.js         seed.json (finished example) + runtime.json (people added on the site)
scripts/seed.js    resumable batch run for the example pool
data/people.json   the 30 candidate people (27 passed scraping + identity checks)
```

**Design choices**
- **Agents are separate model calls with separate context.** Neither side of a date can see the other's private dossier or debrief. That's what makes it agents dating, not one model writing a script.
- **Structured outputs everywhere** (Zod schemas → JSON schema) so profiles, swipes and debriefs are validated data, not parsed prose.
- **Two-stage matching** (swipe → date) keeps cost linear-ish: N² cheap swipes, then ~N·K expensive dates.
- **Resumable seed** with a per-person scrape cache, so a failed run never pays Apify twice.
- **Rate limiting at every boundary**: Apify concurrency cap (free plan = 5), per-model RPM windows and quota-aware failover for the LLM, a global LLM concurrency pool, and a per-IP throttle on the public onboarding endpoint.

## Scraping tech stack

- **LinkedIn:** Apify actor [`harvestapi/linkedin-profile-scraper`](https://apify.com/harvestapi/linkedin-profile-scraper) (no cookies or login needed), called through Apify's `run-sync-get-dataset-items` REST endpoint from Node `fetch`. Fallback: public profile HTML → JSON-LD/OpenGraph parsing.
- **Instagram:** Apify actor [`apify/instagram-profile-scraper`](https://apify.com/apify/instagram-profile-scraper): profile, bio, latest posts (captions, hashtags, locations, image URLs). Fallback: Instagram's public `web_profile_info` endpoint. Post images are downloaded server-side and passed to the model as base64 for visual analysis.
- **Analysis and agents:** Claude (Anthropic SDK, structured outputs) or Gemini (Interactions API), selected by which key is set. The example run used Claude Sonnet 5.5 for profile analysis and Claude Haiku 5.5 for swipes, dates and debriefs.

## Run it

```bash
cp .env.example .env      # add APIFY_TOKEN and ANTHROPIC_API_KEY or GEMINI_API_KEY
npm install
npm run dev               # http://localhost:3000
npm run seed              # rebuild the example pool from data/people.json (resumable)
```

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/princechoudhary16/proxy-dating)

Any Node 20+ host works. The `render.yaml` blueprint sets everything up; you only paste the secret env vars (`APIFY_TOKEN` plus `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`). The example pool ships in `data/seed.json`, so the demo works without running anything.

## Ethics

Only public data from the two given links is used. The analyst is instructed never to comment on appearance or infer sensitive traits (orientation, religion, health). Matching is gender-agnostic: it judges fit, not attraction. The example pool consists of public figures; it is a simulation and none of them are affiliated with this project.
