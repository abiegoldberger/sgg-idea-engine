require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
app.set('trust proxy', 1);

function loadJSON(relPath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
  } catch (e) {
    console.warn(`[warn] Could not load ${relPath}, using fallback. (${e.message})`);
    return fallback;
  }
}

const CONTEXT_REGISTER = loadJSON('data/context-register.json', {});

function loadSources(relPath) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    const grouped = {};
    raw.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split('|').map((p) => p.trim());
      const [name, url, category, notes] = parts;
      if (!name || !url) return;
      const cat = category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ name, url, notes });
    });
    return grouped;
  } catch (e) {
    console.warn(`[warn] Could not load ${relPath}, sources list will be empty. (${e.message})`);
    return {};
  }
}

const SOURCES = loadSources('data/sources.txt');
const SOURCES_TEXT = Object.entries(SOURCES)
  .map(([cat, items]) => `${cat}:\n${items.map((s) => `  - ${s.name} (${s.url})${s.notes ? ' -- ' + s.notes : ''}`).join('\n')}`)
  .join('\n');
const IDEA_REGISTER = loadJSON('data/idea-register.json', []);

function formatRegisterSection(entries, field) {
  return (entries || []).map((e) => `  - ${e.name}: ${e[field] || e.description || e.reason || ''}`).join('\n');
}

const CONTEXT_REGISTER_TEXT = `Foundry (SGG built these -- strong overlap flag):
${formatRegisterSection(CONTEXT_REGISTER.foundry, 'description')}

In development (SGG is actively assessing these -- strong overlap flag, a run can otherwise resurface one of these without knowing):
${formatRegisterSection(CONTEXT_REGISTER.in_development, 'description')}

Strategic (positions SGG holds but did not originate -- weak overlap flag, except where the category matches exactly):
${formatRegisterSection(CONTEXT_REGISTER.strategic, 'description')}

Advisory (relationship territory -- weak flag, except AMP on home/strength fitness and Arya on relationships/sexual wellness, which are exact-category matches):
${formatRegisterSection(CONTEXT_REGISTER.advisory, 'description')}

Killed (SGG considered and rejected these -- do not propose these or a close variant):
${formatRegisterSection(CONTEXT_REGISTER.killed, 'reason')}

Not yet categorized (do not guess a category; just avoid proposing something that closely resembles these until they're formally placed): ${(CONTEXT_REGISTER.unresolved_not_yet_categorized || []).join(', ')}`;
const AVOID_LIST_TEXT = IDEA_REGISTER.filter((i) => i.do_not_regenerate === 'Y')
  .map((i) => `- "${i.name}" (${i.category}): ${i.reason}`)
  .join('\n');
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

// Search depth is intentionally asymmetric across the three engines:
// Ideate is a fast, exploratory pass -- most of its budget should go toward
// finding a fresh trend, not exhaustively hunting competitors. Validate is
// the deep, rigorous pass -- that's where real competitive research happens.
// Plan needs enough budget to ground a full document in real evidence.
const IDEATE_MAX_SEARCHES = Number(process.env.IDEATE_MAX_SEARCHES || 15);
const VALIDATE_MAX_SEARCHES = Number(process.env.VALIDATE_MAX_SEARCHES || 14);
const PLAN_MAX_SEARCHES = Number(process.env.PLAN_MAX_SEARCHES || 14);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[warn] ANTHROPIC_API_KEY is not set. Live runs will fall back to mock data until it is.');
}
if (!process.env.DEMO_PASSWORD) {
  console.warn('[warn] DEMO_PASSWORD is not set. Login will accept nothing until it is.');
}

app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 4,
    },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

// ---- Auth routes -----------------------------------------------------

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password && process.env.DEMO_PASSWORD && password === process.env.DEMO_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong_password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---- Static pages ------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  if (req.session && req.session.authed) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---- Shared calibration principles, reused across all three engines --------

const SHARED_PRINCIPLES = `SGG Foundry invents consumer companies from scratch and builds them -- it does not join existing companies. Most Israeli and international studios chase enterprise software, AI infrastructure, and deep tech; SGG builds things ordinary people buy, use, eat, wear, book, or subscribe to.

PRINCIPLES
- Default to an international / US market scope. Israel is only the right starting market when there's a real "boots on the ground" advantage (physical/local operations) or the idea is genuinely Israel-specific and large enough to stand alone. Israel-sourced research is productive and will pull toward Israel if left unchecked -- actively guard against defaulting there just because sourcing is easier.
- Never invent statistics. Only state a figure if you found it via search this turn; otherwise describe the trend qualitatively and say so.
- FOOTNOTES: every factual claim (a figure, percentage, market size, dated event, or attributed finding) gets an inline numbered marker like [1] immediately after it, corresponding to that source's position in the "sources" array (the first entry is [1], the second is [2], and so on). This is a verification aid, not decoration -- a reader should be able to trace any specific claim to exactly where it came from.
- ALL MONEY IN US DOLLARS. Convert every figure quoted in another currency to USD in the body text. Immediately after the converted figure, add the original amount, the exchange rate used, and the date the rate was taken, in parentheses -- e.g. "$8 (originally £6, at £1=$1.35, 17 Aug 2026)".
- Generate widely, then judge -- a promising idea with real but imperfect evidence is worth proposing. The failure mode to avoid is a narrow, timid pick that plays it safe.
- SGG's team maintains a required source list -- check every source on it directly (e.g. a "site:" search against a domain) alongside general web search, not instead of it. This is a required minimum, not an exhaustive list -- also use any other newsletter, publication, or curated source you find genuinely useful during research. The current list:
${SOURCES_TEXT}
- Check what other builders are doing -- comparable venture studios, incubators, and consumer-focused funds, globally first. Not for copying ideas: it answers whether a market is already being worked, whether it's crowded or merely proven, and what adjacent openings the movement points to.
- Every source category carries equal weight regardless of how many individual sources it contains. A category with 9 real sources (e.g. Trend & Foresight Houses) is not less important than one with 80 (e.g. Venture & Studio Landscape) -- it simply has less duplication in that space. Check at least one source from every category before finalizing an idea; do not let categories with more entries crowd out the smaller ones.
- Before crediting an idea with a real gap, check whether the obvious version of it is already a crowded software/app market or already served by a funded, scaled competitor (including large incumbents entering the space). If so, say so plainly rather than softening it -- a real screening process kills ideas, it doesn't rubber-stamp them.

THE SEVEN QUESTIONS (apply all seven; each gets a verdict of "Yes", "No", or "Maybe" -- judgment calls, not a checklist. An idea that stumbles on one but is strong everywhere else stays in.)

G1 Is the product built to help a person? -- This is what "consumer-oriented" means here: who the product is built to help, not necessarily who pays for it. B2C is the general preference and the more common shape for SGG's ideas, but B2B is a fully legitimate primary model, not just a minor angle, when the product is genuinely used by and benefits individual people -- an employer purchasing something and distributing it to employees is a clear example, not an exception. What disqualifies an idea isn't a business being anywhere in the purchase or distribution chain; it's a product whose real user and beneficiary is the business itself. Watch for this: regulatory research reliably produces business-services ideas -- push them toward a product a real person actually uses and benefits from, or drop them.

G2 Is the product the thing, not the technology behind it? -- Technology can run deep inside the product without being the product -- Flex is a logistics company with proprietary AI dispatch, and it's a flagship. What doesn't qualify is technology AS the product: chips, satellites, developer tools, AI models, enterprise platforms, anything whose real buyer is a company rather than a person. Test: strip out the tech and ask whether there's still a consumer business. If nothing is left, it isn't for us.

G3 Can SGG start it? -- A soft check, not a hard cap. SGG's own first check is around $250K -- the starting exposure, not the venture's budget. SGG raises beyond it routinely -- partners, outside investors, later rounds. Do not shrink an idea to fit $250K, and do not discount one for needing more in total. A cheaper path to market is a genuine advantage, not a requirement. Default to Yes; only mark this No or Maybe if even a lean, minimal starting version genuinely couldn't get off the ground anywhere near $250K (e.g. it requires a hospital, an airline, or similarly massive day-one infrastructure).

G4 Is this ours to invent? -- Idea stage, originated here -- not an existing company or a "bring your own team" special situation (a separate track, out of scope). This question also carries the invention-vs-transfer test: this pipeline is for inventing, not for moving something that already exists from one market into another with nothing of SGG's own design at the end of it. If the idea's central claim is about access or price (this is cheaper abroad, this is available there and not here), it's a transfer -- mark it down. If the claim is about a product somebody designed (this thing should exist and doesn't), it's an invention. Geographic replication is legitimate and distinct from transfer: building SGG's own branded, designed version of a proven consumer format, informed by a real company that has demonstrated success in one country or region but is confirmed absent from the target market, is invention -- provided SGG owns the resulting product and brand outright, not a supply agreement or someone else's logo. Confirm the source company's actual absence from the target market via search before proposing it, and name the real source company specifically as evidence the model works -- that's expected here and is not the same as importing, franchising, or reselling that company's actual products. The honest test either way: what does SGG own at the end of it? A distribution deal and someone else's brand is a transfer. A product and a brand SGG designed is a company, whether or not a proven example elsewhere is part of the evidence.

G5 Can we staff it? -- A loose test. Is this a normal, hireable team, or does it need a once-in-a-decade specialist? Staffing doubt alone should never kill a good idea -- default to Yes; only note it if the idea would require something truly exotic (e.g. a specific rare scientific breakthrough team).

G6 Could we find out we're wrong? -- The central claim has to be genuinely testable, with real numbers -- not "people would love this." Something like "at least 15% of users who complete a trial convert at $30/month," or "a single-city pilot reaches 400 bookings in ninety days." Both the market-gap claim and the definition of success need to be falsifiable. This is a real requirement, not merely a formatting check -- an idea stated only as vague inspiration fails this question.

G7 Does it fit how SGG builds, and is there a real edge? -- At minimum, this is about fit: consumer-facing, brand-led, buildable with a small founding team, standable-up in months rather than years, something SGG can credibly operate or oversee. Advantages get found later, so a good idea should not be dropped for generation purposes merely because a specific edge isn't obvious yet -- but where a real advantage already exists, say so plainly: an owned audience, distribution SGG can reach, a regulatory position, category authority, a cost or supply advantage, a portfolio asset, or genuine market openness (a large, growing, currently-unclaimed space). Name partners by field or category ("a media distribution partner"), not a specific real organization, unless a real relationship already exists (Minute Media is the standing example). "Strong brand" and "better execution" are not advantages -- everyone claims both. When an idea's advantage rests on someone's personal following, say whose, and don't quote a follower count as though it were a fixed company asset -- it belongs to the person. Only mark this No when there's a specific, already-dominant, well-funded competitor with no plausible differentiation found; default toward Yes or Maybe otherwise.

REGULATION AND HEALTH (not one of the seven questions -- separate standing guidance)
Regulation is never a reason to kill an idea. Difficult regulation gets noted and weighed, and is often the opportunity itself -- SGG already operates inside healthcare (InnerOS) and insurance (Demandoo). A regulatory change that makes a new product possible is a strong "why now"; a regulatory change that merely lets you import an existing one more cheaply is not an idea (see G4). Health and wellness carries a specific ceiling: the line is between coaching and consumer wellness on one side, and clinical care on the other. A generated idea should not require SGG to diagnose a condition, prescribe or dispense medication, act clinically on diagnostic tests or bloodwork, employ clinicians delivering treatment, or operate as a licensed care provider. Coaching, structured programmes, education, nutrition and training guidance, consumer products, community, tracking, and content are all fine -- with clinical advisors lending credibility and shaping the protocol rather than treating anyone. This is a scoping rule, not a category ban.`;

// ---- Engine 1: IDEATE -- seed in, new idea out ------------------------------

const IDEATE_SYSTEM_PROMPT = `You are SGG Foundry's proprietary AI Dealflow Engine, in IDEATION mode. This produces the same type of idea, screened under the same seven questions and with the same real research depth, as SGG's real weekly pipeline -- the only structural difference is volume: the weekly pipeline produces five ideas from twenty raw candidates; this produces one idea per run. Both take the time real research requires -- roughly 3-5 minutes -- rather than a fast, shallow pass.

Every run is fully autonomous -- you are given a focus category to search within, not a specific trend or field. Use your full search budget to do this properly: cover the source categories genuinely, find a real current trend or data point with evidence behind it, and check the competitive landscape thoroughly. This is not a quick first look with deep competitive vetting deferred to Validation -- do the real research now.

Generate your candidate angles the way SGG's real pipeline does -- from these four directions, not from free-associating within the category. Use whichever directions fit your assigned category best; you don't need all four every run.

FORWARD FROM A FORCE. SGG thinks in structural forces, not just signals -- a signal is something that changed, a force is why it changed and why it will keep changing. The six forces: diverging demographics (populations ageing while household formation and life stages fragment); fragmenting societies (falling institutional trust, consumers buying from people rather than institutions); the hollowing middle (spending polarizing toward premium and value at once); colliding technologies (AI reshaping what a product costs to make and what a service is expected to do, mostly as an input to consumer businesses rather than as the business itself); bodies and longevity (health moving from treatment to management, active life extending into decades once treated as decline); re-localising life (physical places and in-person community regaining commercial weight after a decade of digital substitution). Take a force and ask what it makes possible or necessary now. Evidence the force with real current data -- a force with no data behind it is a slogan, not a reason.

SIDEWAYS FROM WHAT OTHER BUILDERS ARE DOING. A studio or fund launching into a category is evidence the category is real -- that's worth more than it first appears. From any such launch, ask: what adjacent thing does this leave unbuilt; who does it deliberately not serve; what does it prove about willingness to pay that could support a different business; is the crowding at the idea level or only at the funding level. Several good ideas come from noticing someone has already validated a market and aimed at the wrong part of it. This is generation material, not just a competitive block-list.

UPWARD FROM WHAT IS SPREADING. A product selling out, a waitlist, a behavior spreading faster than the products serving it -- each is a specific fact that usually implies a general one. Climb from the instance to the pattern: what does this reveal about what people now expect, and what would a company built entirely on that expectation look like? Don't build a company around a viral product; build it around what the virality reveals.

BACKWARD FROM A FRICTION. Where are people visibly doing hard work a business should be doing for them -- assembling something across multiple sources, maintaining a workaround, organizing manually? Sustained unpaid effort is a market that hasn't been served yet.

For each candidate angle this generates, before investing further effort in it, do a fast gut check -- and specifically run the prove-it-exists search: phrase a search as an attempt to prove the idea already exists ("who is already doing X," "X alternative," "X startup"), not "market size for X." This is adversarial on purpose and catches an incumbent a general research pass misses. If it turns up a competitor so dominant that no plausible differentiation exists, discard that candidate immediately and move to the next one. But finding *a* competitor is not itself grounds to discard a candidate -- most good ideas have some existing player nearby, and the real question is whether genuine differentiation is still plausible. A competitor that exists but leaves real room is not a reason to discard the candidate; it's the material for an honest question-7 note. Only the strongest surviving candidate gets the fuller research and write-up; if every candidate you try within budget fails the gut check, use whatever budget remains to try one more angle rather than settling for and writing up one you know doesn't hold up.

Once you've settled on the strongest surviving candidate, invent or adapt ONE consumer company idea from it, screen it honestly against all seven questions below, and produce a short business-plan skeleton.

${SHARED_PRINCIPLES}
- If you're genuinely unsure whether a competitor is a dealbreaker on your chosen idea, mark that question "Maybe" rather than spending limited search budget chasing it down -- full competitive vetting belongs to Validation. This applies to close calls on your chosen idea, not to the fast pre-check above, which is specifically about ruling out obviously-dead candidates before committing to one.
- This is SGG's real Context Register -- a repetition and overlap check, not a blocklist. Adjacency to an existing company is often a strength, not a disqualifier:
${CONTEXT_REGISTER_TEXT}
Foundry and In-development overlap is a strong flag -- say why the new idea is genuinely distinct, or route it as an extension. Strategic and Advisory overlap is weak, except where the category matches exactly (AMP on fitness, Arya on relationships/sexual wellness). If a new idea is essentially something already on this list, drop it or push it somewhere genuinely different -- nothing from this register belongs in the idea's write-up itself.
- If the idea is genuinely scoped specifically to Israel (not just an international idea launching Israel-first), run at least one search in Hebrew, not just English -- Hebrew-language sources surface local news, government/regulatory reports, and consumer data that don't appear in English coverage at all.
- Separately from SGG's real Context Register above, check the candidate against this list of ideas *this demo engine* has already generated and explicitly decided against -- do not propose any of these or a close variant of them:
${AVOID_LIST_TEXT}
If your strongest surviving candidate is too close to one of these, treat that as a fail at the gut-check stage above and move to a different angle rather than proposing a near-duplicate.

WRITING STYLE (this is not a formatting nicety -- it's what separates a memo a partner would actually forward from a research summary):
- No hedging filler, no "in today's fast-paced world," no throat-clearing before the point. State things.
- The test for the one-liner: a normal person hearing it should think "yes, obviously -- why doesn't that exist already," not "here is a company that addresses a market opportunity in the space of."
- Name sources inline the way a person would say them out loud -- "NIQ puts the pet care market at $91.8B," not "according to research from NIQ" or "sources indicate."
- Give the idea a name worth saying out loud.
- No positioning language, no build-up. Say what the company is and does before arguing for it.

Give an honest overall confidence rating from 1 to 5 stars reflecting your honest belief the idea will succeed.

OUTPUT FORMAT
Respond with ONLY a single JSON object -- no markdown fences, no prose before or after. Match this exact shape:

{
  "idea_name": "short punchy company/concept name",
  "one_liner": "one sentence describing the company, under 20 words",
  "problem": "150-250 words: the problem, with research evidence, footnote markers like [1] on every factual claim, matching the sources array order",
  "solution": "150-250 words: the proposed solution, with research evidence and footnote markers matching the sources array order",
  "why_now": "150-250 words: the market gap and why it exists now, backed by evidence with footnote markers matching the sources array order",
  "gates": [
    {"id": "G1", "label": "Consumer-oriented", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G2", "label": "Product, Not Tech", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G3", "label": "Capital", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G4", "label": "Invention", "verdict": "Yes|No|Maybe", "note": "one sentence -- note if this uses geographic replication and why it's invention, not transfer"},
    {"id": "G5", "label": "Buildable Team", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G6", "label": "Defined Claim", "verdict": "Yes|No|Maybe", "note": "one sentence stating the actual testable claim"},
    {"id": "G7", "label": "Edge", "verdict": "Yes|No|Maybe", "note": "one sentence naming the edge FIELD, not a real org"}
  ],
  "confidence_stars": 1,
  "business_plan": {
    "problem": "concise restatement for a plan document",
    "solution_and_model": "the product and how it makes money",
    "market_and_edge": "evidence of room in the market plus the G7 edge spelled out concretely",
    "key_challenges": "the real risks, stated plainly",
    "go_to_market": "a concrete first-market, first-customer plan"
  },
  "sources": [{"title": "source title", "url": "https://..."}]
}

Only include sources you actually found via search this turn -- never fabricate a URL.`;

// SGG's six weekly focus categories -- rotated randomly server-side on every
// autonomous Ideate run so repeated button presses don't cluster on whatever
// category a model defaults to, without requiring the person to pick anything.
const FOUNDRY_CATEGORIES = [
  'Consumer Innovation & Technology',
  'Media & Entertainment',
  'Leisure & Hospitality',
  'Health & Wellness',
  'Food & Beverage',
  'Retail & Luxury',
];

app.post('/api/ideate', requireAuth, async (req, res) => {
  // Avoid repeating the same category back-to-back within a session, so a run
  // of clicks naturally spreads across the six focus areas instead of
  // clustering on whatever the model defaults to.
  if (!Array.isArray(req.session.recentCategories)) req.session.recentCategories = [];
  const recent = req.session.recentCategories.slice(-2);
  const pool = FOUNDRY_CATEGORIES.filter((c) => !recent.includes(c));
  const candidates = pool.length ? pool : FOUNDRY_CATEGORIES;
  const category = candidates[Math.floor(Math.random() * candidates.length)];
  req.session.recentCategories.push(category);
  if (req.session.recentCategories.length > 5) req.session.recentCategories.shift();

  const userMessage = `No seed was given -- this is a fully autonomous run. Your assigned focus category for this run is: ${category}. Search for a genuinely current trend, data point, or event within that category, and use it to find a real, evidenced consumer whitespace -- do not default to a generic, well-known example of the category.`;

  await runEngine({
    res,
    systemPrompt: IDEATE_SYSTEM_PROMPT,
    userMessage,
    mockFile: 'mock-ideate.json',
    maxSearches: IDEATE_MAX_SEARCHES,
    maxTokens: 16000,
  });
});

// ---- Engine 2: VALIDATE -- the user's own idea in, honest rating out -------

const VALIDATE_SYSTEM_PROMPT = `You are SGG Foundry's proprietary AI Dealflow Engine, in VALIDATION mode, demonstrated live for a prospective investor.

This is SGG's deep, rigorous validation pass -- a real due diligence document, not a quick first look. The person has described THEIR OWN idea below. Do not invent a different idea and do not soften your assessment to be encouraging -- your job is to find out, via extensive web search, whether this idea holds up. Spend real search budget hunting for competitors from multiple distinct angles: direct competitors doing the same thing, adjacent products that substitute for it, and well-funded incumbents who could credibly expand into this space even if they don't operate in it today. A validation that runs one search and stops is not a validation, it's a guess.

This document should read as a genuine 2-3 page research memo (roughly 1000-1500 words total across all fields), not a summary. For each part of the idea -- problem, solution, market opportunity, and edge -- give an explicit evidence-for and evidence-against paragraph, even when one side is thin; if you found nothing undercutting a claim, say so plainly rather than inventing a counterargument. List primary competitors thoroughly (aim for 4-6 where the space supports it), not just one or two examples.

Before researching, check the submitted idea against SGG's real Context Register and against this demo engine's own generation history -- if it matches or is a close variant of either, say so plainly (in the relevant evidence_against field and in the recommendation) and explain why, then continue with full research to confirm or update that conclusion rather than assuming the old verdict still holds.

SGG's real Context Register (a repetition/overlap check, not a blocklist):
${CONTEXT_REGISTER_TEXT}

This demo engine's own prior generation history (separate from the above):
${AVOID_LIST_TEXT}

If the idea is genuinely scoped specifically to Israel, run at least one search in Hebrew, not just English -- Hebrew-language sources surface local news, government/regulatory reports, and consumer data that don't appear in English coverage at all.

${SHARED_PRINCIPLES}

WRITING STYLE: no hedging filler, no throat-clearing. State findings plainly. Name sources inline the way a person would say them out loud -- "NIQ puts the pet care market at $91.8B," not "sources indicate." This is a rigorous document, but rigorous doesn't mean stiff -- write it the way you'd actually explain the finding to someone across a table.

Give an honest overall confidence rating from 1 to 5 stars, and explain the rating itself in a short paragraph that weighs the strongest evidence for and against -- the rating should be traceable to specific findings, not a gut feeling. If you find a direct, well-funded incumbent already doing this, G7 should be "No" and the star rating should be low (1-2) even if the rest of the idea is reasonable -- a good idea with no edge against an incumbent is still a bad venture bet. Do not inflate the rating to be polite.

OUTPUT FORMAT
Respond with ONLY a single JSON object -- no markdown fences, no prose before or after. Match this exact shape:

{
  "idea_name": "the name/short label for their idea (infer one if they didn't give one)",
  "one_liner": "one sentence restating their idea plainly, under 20 words",
  "overview_assessment": {
    "problem": {"evidence_for": "80-150 words grounded in research, footnote markers like [1] matching the sources array order", "evidence_against": "80-150 words with footnote markers, or state plainly that no meaningful counter-evidence was found"},
    "solution": {"evidence_for": "80-150 words with footnote markers", "evidence_against": "80-150 words with footnote markers"},
    "market_opportunity": {"evidence_for": "80-150 words with footnote markers", "evidence_against": "80-150 words with footnote markers"},
    "edge": {"evidence_for": "80-150 words with footnote markers", "evidence_against": "80-150 words with footnote markers"}
  },
  "competitors": [{"name": "existing company or product found via search", "scale": "funding/size/reach if known, or 'unknown'", "note": "1-2 sentences on what they do and how directly they compete"}],
  "gates": [
    {"id": "G1", "label": "Consumer-oriented", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G2", "label": "Product, Not Tech", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G3", "label": "Capital", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G4", "label": "Invention", "verdict": "Yes|No|Maybe", "note": "one sentence -- note if this uses geographic replication and why it's invention, not transfer"},
    {"id": "G5", "label": "Buildable Team", "verdict": "Yes|No|Maybe", "note": "one sentence"},
    {"id": "G6", "label": "Defined Claim", "verdict": "Yes|No|Maybe", "note": "one sentence stating the actual testable claim"},
    {"id": "G7", "label": "Edge", "verdict": "Yes|No|Maybe", "note": "one sentence -- be specific about why it does or doesn't hold up against what you found"}
  ],
  "confidence_stars": 1,
  "confidence_rationale": "a paragraph (80-150 words) explaining exactly why this rating, weighing the strongest evidence for and against",
  "key_risks": ["short risk statement", "short risk statement", "short risk statement"],
  "recommendation": "two or three sentences: pursue as-is, pursue with a specific named change, or do not pursue and why",
  "sources": [{"title": "source title", "url": "https://..."}]
}

Only include sources you actually found via search this turn -- never fabricate a URL.`;

app.post('/api/validate', requireAuth, async (req, res) => {
  const ideaText = (req.body && typeof req.body.idea === 'string' ? req.body.idea : '').trim();
  if (!ideaText) {
    return res.status(400).json({ error: 'missing_idea' });
  }

  await runEngine({
    res,
    systemPrompt: VALIDATE_SYSTEM_PROMPT,
    userMessage: `Here is the idea to validate:\n\n${ideaText}`,
    mockFile: 'mock-validate.json',
    maxSearches: VALIDATE_MAX_SEARCHES,
    maxTokens: 16000,
  });
});

// ---- Engine 3: PLAN -- a validated idea in, full business plan out --------

const PLAN_SYSTEM_PROMPT = `You are SGG Foundry's proprietary AI Dealflow Engine, in LAUNCH mode. This tool serves two purposes: it runs live as a demo for prospective investors, and it is also used privately by the SGG team to actually develop and refine ideas internally before committing real capital. Write for the second use case primarily -- a document the team could genuinely work from -- and it will naturally also impress as a demo, since real substance is more convincing than a polished skeleton.

The person has given you an idea that has already been through ideation or validation. Your job now is to write a thorough, cohesive, investor-ready business plan for it, in SGG's own house format -- a real, substantial planning document a reader could act on, not a summary or a skeleton. Use web search to ground every substantive claim (market size, competitors, pricing comparables, regulatory considerations) in real evidence. Take the space you need to be genuinely thorough.

${SHARED_PRINCIPLES}
- Write in full, well-organized prose per section -- this is a proper planning document to be read end to end, not a card layout and not a brief overview. Each section should be genuinely substantial (roughly 350-500 words), with real depth: specific numbers, named comparables, concrete reasoning, not just a paragraph gesturing at the topic. This should read like a document SGG's team could actually work from to make a real decision, not a polished-looking summary.
- Do not re-litigate whether the idea is fundamentally sound (that's what validation is for) -- but do not hide a real, material risk either. If you find a serious competitive or regulatory problem while researching, name it plainly in Key Challenges rather than glossing over it.
- PRICING IS A REQUIRED, NAMED PART OF THE BUSINESS MODEL SECTION, not an afterthought. Search for real comparable products' pricing and anchor against them by name (e.g. "priced above X's $Y/month, below Z's $W/month, because..."). State an actual price point or range and the tier structure (e.g. free tier plus one paid tier), and give the specific reasoning for where it sits relative to comparables -- never leave pricing vague or unstated.
- Capital Requirements should be staged (e.g. an initial lean validation stage, then a larger stage once that validates, then a further stage once that answers the next open question), each with a rough dollar figure, a timeframe, and what that stage actually buys -- not a single lump sum with no sequencing.
- You must also produce a ONE-PAGER matching SGG's established house format exactly (the same structure used in real SGG one-pagers like the Oazis document: Overview, Thesis, Opportunity, Strategy, Who It Serves, Current Focus, Vision) -- flowing narrative prose in each section, not copy-pasted text from the full plan, and not a list of short labeled fields. And a set of FINANCIAL ASSUMPTIONS -- give clean, specific numbers derived directly from the pricing and market sizing you already researched; these will be used to compute an actual month-by-month financial projection, so they must be realistic and internally consistent with the Business Model section, not decorative.
- WRITING STYLE: no hedging filler, no "in today's landscape" throat-clearing. State things plainly and confidently -- this is a document a partner would actually forward, not a research summary. Name sources inline the way a person would say them out loud.

OUTPUT FORMAT
Respond with ONLY a single JSON object -- no markdown fences, no prose before or after. Match this exact shape:

{
  "plan_title": "Business Plan: [idea name]",
  "one_liner": "one sentence description of the business, under 20 words",
  "overview": {
    "problem": "1-2 sentences: the core problem",
    "solution": "1-2 sentences: the core solution",
    "edge": "1-2 sentences: the core edge"
  },
  "sections": [
    {"heading": "1. Problem & Market Opportunity", "body": "350-500 words -- real depth, not a summary. Include footnote markers like [1] on every factual claim, matching the sources array order"},
    {"heading": "2. Solution & Product", "body": "350-500 words -- real depth, not a summary"},
    {"heading": "3. Business Model", "body": "350-500 words. Must explicitly name a real price point or range, anchored against named comparable products' actual prices, plus the tier structure and reasoning -- this is required, not optional. Footnote any comparable pricing cited."},
    {"heading": "4. Go-to-Market", "body": "350-500 words -- real depth, not a summary"},
    {"heading": "5. Key Challenges", "body": "350-500 words. Name 2-3 specific risks and what would be done about each, stated plainly and in real depth."},
    {"heading": "6. Team & Operating Plan", "body": "350-500 words -- real depth, not a summary"},
    {"heading": "7. Capital Requirements & Next Steps", "body": "350-500 words. A staged capital plan (e.g. validate / pre-seed-equivalent / next stage), each with a rough dollar figure, timeframe, and what it buys, plus the single next decision gate that matters most."}
  ],
  "one_pager": {
    "subtitle": "a punchy 3-6 word subtitle capturing the core thesis in one phrase, e.g. 'Urbanizing the Airport Lounge' -- this is SGG's established house style for one-pager subtitles, not a restated one-liner",
    "overview": "80-120 words: what the company is, the model (who pays whom for what), and the one-sentence version of why it exists, written as flowing prose",
    "thesis": "60-100 words: the single core insight this is built on -- often 'X already solved this problem in context A; this applies the same logic to context B'",
    "opportunity": "80-120 words: the market evidence, named comparable companies or analogues, and why the timing is right now",
    "strategy": "60-100 words: how the business actually operates and makes money -- the mechanics, not the vision",
    "who_it_serves": [
      {"segment": "a customer/stakeholder type", "benefit": "5-10 word benefit to them"},
      {"segment": "a second customer/stakeholder type", "benefit": "5-10 word benefit to them"},
      {"segment": "a third customer/stakeholder type", "benefit": "5-10 word benefit to them"}
    ],
    "current_focus": "60-100 words: what's being built or proven right now, concretely -- the immediate proof-of-concept, not the long-term vision",
    "vision": "60-100 words: what this becomes at scale, tying back to SGG's track record and the specific ask -- ending on the capital stage and what it buys"
  },
  "financials": {
    "currency": "USD or the currency actually used in the Business Model section (e.g. NIS) -- must match",
    "price_per_unit": 0,
    "price_unit_label": "short label matching the Business Model pricing, e.g. 'per hour', 'per month membership'",
    "starting_volume_per_month": 0,
    "monthly_growth_rate_pct": 0,
    "variable_cost_pct_of_revenue": 0,
    "fixed_monthly_costs": 0,
    "notes": "1-2 sentences on how these numbers were derived from the Business Model and Capital Requirements sections"
  },
  "sources": [{"title": "source title", "url": "https://..."}]
}

Only include sources you actually found via search this turn -- never fabricate a URL. No appendices -- this plan is the seven numbered sections, the overview, the one-pager, the financial assumptions, and sources, nothing more.`;

app.post('/api/plan', requireAuth, async (req, res) => {
  const ideaText = (req.body && typeof req.body.idea === 'string' ? req.body.idea : '').trim();
  if (!ideaText) {
    return res.status(400).json({ error: 'missing_idea' });
  }

  await runEngine({
    res,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userMessage: `Here is the idea to build a full business plan for:\n\n${ideaText}`,
    mockFile: 'mock-plan.json',
    maxTokens: 16000,
    maxSearches: PLAN_MAX_SEARCHES,
  });
});

// ---- Shared engine runner ---------------------------------------------

async function runEngine({ res, systemPrompt, userMessage, mockFile, maxTokens = 16000, maxSearches }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const mockPath = path.join(__dirname, 'public', mockFile);
    if (fs.existsSync(mockPath)) {
      await new Promise((r) => setTimeout(r, 1400));
      const result = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
      return res.json({ ok: true, result, mock: true });
    }
    return res.status(500).json({ error: 'server_missing_api_key' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: maxSearches,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[anthropic error]', response.status, errText);
      return res.status(502).json({ error: 'upstream_error', detail: errText.slice(0, 500) });
    }

    const data = await response.json();
    const textBlocks = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text);
    const rawText = textBlocks.join('\n').trim();
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[parse error]', parseErr, '\nraw:', rawText.slice(0, 2000));
      return res.status(502).json({ error: 'bad_model_output', raw: rawText.slice(0, 2000) });
    }

    return res.json({ ok: true, result, usage: data.usage || null });
  } catch (err) {
    console.error('[engine error]', err);
    return res.status(500).json({ error: 'server_error', detail: String(err) });
  }
}

// ---- Financial model: server computes the actual math; the model only supplies clean assumptions ----

function computeProjection(f) {
  const months = [];
  let volume = Number(f.starting_volume_per_month) || 0;
  let cumulative = 0;
  const growth = (Number(f.monthly_growth_rate_pct) || 0) / 100;
  const varPct = (Number(f.variable_cost_pct_of_revenue) || 0) / 100;
  const price = Number(f.price_per_unit) || 0;
  const fixedCosts = Number(f.fixed_monthly_costs) || 0;

  for (let m = 1; m <= 24; m++) {
    if (m > 1) volume = volume * (1 + growth);
    const revenue = volume * price;
    const variableCost = revenue * varPct;
    const grossProfit = revenue - variableCost;
    const netIncome = grossProfit - fixedCosts;
    cumulative += netIncome;
    months.push({ month: m, volume, revenue, variableCost, grossProfit, fixedCosts, netIncome, cumulative });
  }
  return months;
}

async function buildFinancialWorkbook(planTitle, financials) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SGG Foundry AI Dealflow Engine';
  wb.created = new Date();

  const f = {
    currency: financials.currency || 'USD',
    price_per_unit: Number(financials.price_per_unit) || 0,
    price_unit_label: financials.price_unit_label || 'per unit',
    starting_volume_per_month: Number(financials.starting_volume_per_month) || 0,
    monthly_growth_rate_pct: Number(financials.monthly_growth_rate_pct) || 0,
    variable_cost_pct_of_revenue: Number(financials.variable_cost_pct_of_revenue) || 0,
    fixed_monthly_costs: Number(financials.fixed_monthly_costs) || 0,
  };

  // House style, matched to SGG's real financial model documents (e.g. the
  // Oazis projections) -- Montserrat, muted blue-gray header bars, a darker
  // slate-blue divider bar between sections. Deliberately NOT the website's
  // own charcoal/ember palette -- this is a separate, established house
  // style for financial deliverables specifically.
  const CURRENCY_SYMBOLS = { USD: '$', NIS: '\u20aa', EUR: '\u20ac', GBP: '\u00a3' };
  const sym = CURRENCY_SYMBOLS[f.currency] || (f.currency + ' ');
  const moneyFmt = `${sym}#,##0`;
  const FONT_NAME = 'Montserrat';
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE5F1' } };
  const DIVIDER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF919EB4' } };
  const BASE_FONT = { name: FONT_NAME, size: 10 };
  const HEADER_FONT = { name: FONT_NAME, size: 10, bold: true };
  const TITLE_FONT = { name: FONT_NAME, size: 13, bold: true };
  const SUB_FONT = { name: FONT_NAME, size: 9, italic: true, color: { argb: 'FF666666' } };
  const NOTE_FONT = { name: FONT_NAME, size: 10, italic: true };

  function titleRow(sheet, subtitle) {
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = planTitle || 'SGG Foundry Financial Model';
    sheet.getCell('A1').font = TITLE_FONT;
    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').value = subtitle;
    sheet.getCell('A2').font = SUB_FONT;
    sheet.addRow([]);
  }

  function dividerRow(sheet, width) {
    const r = sheet.addRow([]);
    for (let c = 1; c <= width; c++) sheet.getCell(r.number, c).fill = DIVIDER_FILL;
    return r;
  }

  function headerRow(sheet, values) {
    const r = sheet.addRow(values);
    r.eachCell((c) => { c.fill = HEADER_FILL; c.font = HEADER_FONT; });
    return r;
  }

  // --- Highlights (Summary) sheet -- mirrors the real model's Key Figures / Growth Plan Results pattern ---
  const hi = wb.addWorksheet('Highlights');
  hi.columns = [{ width: 34 }, { width: 16 }, { width: 16 }];
  titleRow(hi, 'Key figures and growth plan results, Years 1-2');

  const computed = computeProjection(f);
  const yearVolume = (y) => computed.filter((m) => Math.ceil(m.month / 12) === y).reduce((s, m) => s + m.volume, 0);
  const yearRevenue = (y) => computed.filter((m) => Math.ceil(m.month / 12) === y).reduce((s, m) => s + m.revenue, 0);
  const yearNetIncome = (y) => computed.filter((m) => Math.ceil(m.month / 12) === y).reduce((s, m) => s + m.netIncome, 0);

  headerRow(hi, ['Key Figures', 'Year 1', 'Year 2']);
  const volRow = hi.addRow(['Total volume', yearVolume(1), yearVolume(2)]);
  volRow.eachCell((c) => { c.font = BASE_FONT; });
  [volRow.getCell(2), volRow.getCell(3)].forEach((c) => { c.numFmt = '#,##0'; });
  const priceRow = hi.addRow([`Price (${f.price_unit_label})`, f.price_per_unit, f.price_per_unit]);
  priceRow.eachCell((c) => { c.font = NOTE_FONT; });
  [priceRow.getCell(2), priceRow.getCell(3)].forEach((c) => { c.numFmt = moneyFmt; });

  dividerRow(hi, 3);

  headerRow(hi, ['Growth Plan Results', 'Year 1', 'Year 2']);
  const revRow = hi.addRow(['Total Revenue', yearRevenue(1), yearRevenue(2)]);
  revRow.eachCell((c) => { c.font = HEADER_FONT; });
  [revRow.getCell(2), revRow.getCell(3)].forEach((c) => { c.numFmt = moneyFmt; });
  const niRow = hi.addRow(['Net Income', yearNetIncome(1), yearNetIncome(2)]);
  niRow.eachCell((c) => { c.font = HEADER_FONT; });
  [niRow.getCell(2), niRow.getCell(3)].forEach((c) => { c.numFmt = moneyFmt; });
  const marginRow = hi.addRow(['% Margin',
    yearRevenue(1) ? niRow.getCell(2).value / revRow.getCell(2).value : 0,
    yearRevenue(2) ? niRow.getCell(3).value / revRow.getCell(3).value : 0]);
  marginRow.eachCell((c) => { c.font = NOTE_FONT; });
  [marginRow.getCell(2), marginRow.getCell(3)].forEach((c) => { c.numFmt = '0%'; });

  dividerRow(hi, 3);

  // --- Set Up Costs sheet -- mirrors the real model's simple itemized pattern ---
  const setup = wb.addWorksheet('Set Up Costs');
  setup.columns = [{ width: 34 }, { width: 18 }];
  titleRow(setup, `${planTitle || 'This venture'} \u2014 estimated Stage 2 (launch) set-up costs`);
  headerRow(setup, ['Item', 'Estimated Cost']);
  const setupItems = [
    ['Buildout / Fit-out', Math.round(f.fixed_monthly_costs * 3)],
    ['Equipment', Math.round(f.fixed_monthly_costs * 1.5)],
    ['Design / Branding', Math.round(f.fixed_monthly_costs * 0.5)],
    ['Initial Marketing', Math.round(f.fixed_monthly_costs * 0.5)],
    ['Legal & Licensing', Math.round(f.fixed_monthly_costs * 0.3)],
    ['Working Capital Buffer', Math.round(f.fixed_monthly_costs * 3)],
  ];
  const setupRowNums = [];
  setupItems.forEach(([item, cost]) => {
    const r = setup.addRow([item, cost]);
    r.eachCell((c) => { c.font = BASE_FONT; });
    r.getCell(2).numFmt = moneyFmt;
    setupRowNums.push(r.number);
  });
  const totalRow = setup.addRow(['Total', { formula: `SUM(B${setupRowNums[0]}:B${setupRowNums[setupRowNums.length - 1]})` }]);
  totalRow.eachCell((c) => { c.font = HEADER_FONT; c.fill = HEADER_FILL; });
  totalRow.getCell(2).numFmt = moneyFmt;
  setup.addRow([]);
  const setupNote = setup.addRow(['Note', 'These figures are estimated from the Business Model section\'s fixed-cost assumption and should be replaced with real vendor quotes before this stage is funded.']);
  setupNote.getCell(1).font = HEADER_FONT;
  setupNote.getCell(2).font = SUB_FONT;
  setup.mergeCells(`B${setupNote.number}:D${setupNote.number}`);

  // --- Monthly Projection sheet (real formulas, editable in Excel) ---
  const proj = wb.addWorksheet('Monthly Projection');
  proj.columns = [
    { width: 8 }, { width: 14 }, { width: 14 }, { width: 16 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 },
  ];
  titleRow(proj, '24-month projection, computed live from the Assumptions below.');

  headerRow(proj, ['Assumption', 'Value', 'Note']);
  const asmRows = [
    ['Price per unit', f.price_per_unit, f.price_unit_label, moneyFmt],
    ['Starting volume / month', f.starting_volume_per_month, '', '#,##0'],
    ['Monthly growth rate (%)', f.monthly_growth_rate_pct, '', '0.0"%"'],
    ['Variable cost (% of revenue)', f.variable_cost_pct_of_revenue, '', '0.0"%"'],
    ['Fixed monthly costs', f.fixed_monthly_costs, '', moneyFmt],
    ['Currency', f.currency, '', null],
  ];
  const asmStartRow = proj.rowCount + 1;
  asmRows.forEach(([label, value, note, fmt]) => {
    const r = proj.addRow([label, value, note]);
    r.eachCell((c) => { c.font = BASE_FONT; });
    if (fmt) r.getCell(2).numFmt = fmt;
  });
  // Named row offsets within this sheet: price=asmStartRow, volume=+1, growth=+2, varcost=+3, fixed=+4
  const priceCell = `B${asmStartRow}`;
  const volCell = `B${asmStartRow + 1}`;
  const growthCell = `B${asmStartRow + 2}`;
  const varCell = `B${asmStartRow + 3}`;
  const fixedCell = `B${asmStartRow + 4}`;

  dividerRow(proj, 8);
  const projHeaderRow = headerRow(proj, ['Month', 'Volume', 'Revenue', 'Variable Costs', 'Gross Profit', 'Fixed Costs', 'Net Income', 'Cumulative Cash']);
  const headerRowNum = projHeaderRow.number;

  for (let m = 1; m <= 24; m++) {
    const row = headerRowNum + m;
    const prevRow = row - 1;
    const volumeCell = `B${row}`;
    if (m === 1) {
      proj.getCell(volumeCell).value = { formula: volCell };
    } else {
      proj.getCell(volumeCell).value = { formula: `B${prevRow}*(1+${growthCell}/100)` };
    }
    proj.getCell(`A${row}`).value = m;
    proj.getCell(`C${row}`).value = { formula: `${volumeCell}*${priceCell}` };
    proj.getCell(`D${row}`).value = { formula: `C${row}*${varCell}/100` };
    proj.getCell(`E${row}`).value = { formula: `C${row}-D${row}` };
    proj.getCell(`F${row}`).value = { formula: fixedCell };
    proj.getCell(`G${row}`).value = { formula: `E${row}-F${row}` };
    proj.getCell(`H${row}`).value =
      m === 1 ? { formula: `G${row}` } : { formula: `H${prevRow}+G${row}` };
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((col) => {
      proj.getCell(`${col}${row}`).font = BASE_FONT;
    });
  }
  ['C', 'D', 'E', 'F', 'G', 'H'].forEach((col) => {
    for (let r = headerRowNum + 1; r <= headerRowNum + 24; r++) proj.getCell(`${col}${r}`).numFmt = moneyFmt;
  });
  proj.getCell(`B${headerRowNum + 1}`).numFmt = '#,##0';
  for (let r = headerRowNum + 2; r <= headerRowNum + 24; r++) proj.getCell(`B${r}`).numFmt = '#,##0.0';
  proj.views = [{ state: 'frozen', ySplit: headerRowNum }];

  // --- Summary sheet ---
  const breakevenEntry = computed.find((row) => row.cumulative >= 0);
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 30 }, { width: 20 }];
  titleRow(summary, 'Headline figures, computed from the Monthly Projection sheet.');
  headerRow(summary, ['Metric', 'Value']);
  const r1 = summary.addRow(['Year 1 Revenue', { formula: `SUM('Monthly Projection'!C${headerRowNum + 1}:C${headerRowNum + 12})` }]);
  const r2 = summary.addRow(['Year 2 Revenue', { formula: `SUM('Monthly Projection'!C${headerRowNum + 13}:C${headerRowNum + 24})` }]);
  const r3 = summary.addRow(['Cumulative cash at month 24', { formula: `'Monthly Projection'!H${headerRowNum + 24}` }]);
  const r4 = summary.addRow(['Breakeven month', breakevenEntry ? breakevenEntry.month : 'Not within 24 months']);
  [r1, r2, r3].forEach((r) => { r.getCell(2).numFmt = moneyFmt; });
  [r1, r2, r3, r4].forEach((r) => r.eachCell((c) => { c.font = BASE_FONT; }));
  r1.getCell(1).font = HEADER_FONT; r2.getCell(1).font = HEADER_FONT;
  r3.getCell(1).font = HEADER_FONT; r4.getCell(1).font = HEADER_FONT;
  summary.addRow([]);
  const genRow = summary.addRow(['Generated by', 'SGG Foundry AI Dealflow Engine']);
  genRow.eachCell((c) => { c.font = SUB_FONT; });
  const dateRow = summary.addRow(['Date', new Date().toISOString().slice(0, 10)]);
  dateRow.eachCell((c) => { c.font = SUB_FONT; });

  return wb;
}

app.post('/api/plan/excel', requireAuth, async (req, res) => {
  try {
    const { planTitle, financials } = req.body || {};
    if (!financials) {
      return res.status(400).json({ error: 'missing_financials' });
    }
    const wb = await buildFinancialWorkbook(planTitle, financials);
    const buffer = await wb.xlsx.writeBuffer();
    const filename = `${(planTitle || 'financial-model').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[excel error]', err);
    res.status(500).json({ error: 'excel_generation_failed', detail: String(err) });
  }
});

// Sample/showcase ideas -- edit public/examples.json with real Idea Ledger entries
// before showing this to investors.
app.get('/api/examples', requireAuth, (req, res) => {
  const p = path.join(__dirname, 'public', 'examples.json');
  if (!fs.existsSync(p)) return res.json({ examples: [] });
  const raw = fs.readFileSync(p, 'utf8');
  res.json({ examples: JSON.parse(raw) });
});

// The Library tab -- every idea the engine has generated, organized by
// SGG's six focus categories. Edit public/library.json directly to add
// more as they come in; no code changes needed.
app.get('/api/library', requireAuth, (req, res) => {
  const p = path.join(__dirname, 'public', 'library.json');
  if (!fs.existsSync(p)) return res.json({ library: {} });
  const raw = fs.readFileSync(p, 'utf8');
  res.json({ library: JSON.parse(raw) });
});

app.listen(PORT, () => {
  console.log(`SGG Foundry idea engine listening on http://localhost:${PORT}`);
});
