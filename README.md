# SGG Foundry — Dealflow Engine (investor demo)

A small, self-contained web app: a password gate, and three tabs, each
running its own Claude-powered engine with real web search behind it.

- **Ideate** — give it a trend or whitespace (or nothing), it invents a
  consumer company idea and screens it against SGG's seven gates.
- **Validate** — paste your own idea, it researches whether it holds up,
  actively hunts for existing competitors, and gives an honest rating —
  including telling you not to pursue it, if that's the honest answer.
- **Launch** — turns an idea (from Ideate, from Validate, or pasted
  directly) into a full, investor-ready business plan document, not just a
  skeleton.

The three are connected: after Ideate or Validate produces a result, a
"Build full business plan →" button carries that idea straight into Launch.

Runs on Claude Opus 4.8 by default (`CLAUDE_MODEL` in `.env`) — the
strongest reasoning model, which matters for judgment-heavy work like
screening and plan-writing. Swap to `claude-sonnet-5` if you want faster,
cheaper responses during rapid testing.

## Why this exists

Dean wants an AI engine that generates ideas, validates them, and builds a
business plan/model, live, as a password-gated feature on the SGG website —
something to show investors alongside a few strong ideas the engine has
already produced. This is that engine, built on the Claude API and running
the actual screening logic from SGG's weekly pipeline (the seven gates, the
international-by-default rule, the "name the edge as a field, not a real
partner" rule) rather than a generic idea generator.

It intentionally does **less** than the full weekly pipeline: no Hebrew
sourcing, no Context Register de-duplication, no five-idea slate, no
deep multi-hour research. It trades depth for speed so it can run in front
of an investor in under a minute. Treat its output as a demo of the
*mechanism*, not as a vetted idea ready for the Idea Ledger.

## What's in the box

```
server.js          Express server: password gate + /api/ideate, /api/validate, /api/plan
public/login.html  Password screen
public/index.html  The three-tab demo page investors actually use
public/style.css   Visual design (dark "foundry" theme)
public/app.js      Frontend logic for all three tabs
public/examples.json      "Already validated" showcase — currently Cooldown, Dry Dock, Unplugged
public/mock-ideate.json   Offline preview content for the Ideate tab
public/mock-validate.json Offline preview content for the Validate tab
public/mock-plan.json     Offline preview content for the Launch tab
.env.example        Copy to .env and fill in
```

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `DEMO_PASSWORD` — whatever access code you'll give investors; change it before each meeting
   - `SESSION_SECRET` — any random string
3. `public/examples.json` already shows three real ideas the engine generated
   and screened tonight (Cooldown, Dry Dock, Unplugged). Swap in real entries
   from the Idea Ledger whenever you want — same shape (`idea_name`,
   `one_liner`).
4. `npm start`, then open `http://localhost:3000`.

## Deploying it for real

This is a plain Node/Express app — it runs on Render, Railway, Fly.io, a
Vercel Node function, or your own server. Whatever you use:

- Set the same environment variables in that platform's dashboard.
- Make sure it's served over HTTPS (all of the above do this for you) —
  the session cookie is marked `secure` in production, so it won't be sent
  over plain HTTP.
- Point a subdomain at it (e.g. `dealflow.sternglobalgroup.com`) or link to
  it from the main site rather than embedding it in an iframe — that keeps
  the session/cookie handling simple.

## How the engine actually works

All three tabs share one calling pattern (`runEngine()` in `server.js`) and
the same seven-gate/edge/capital principles, but each has its own system
prompt tuned for its job, and — deliberately — its own research depth:

- **`/api/ideate`** — fully autonomous (no text input), invents an idea,
  runs a **mild, quick-screen** pass against the seven gates. Most of its
  search budget goes toward finding a fresh trend, not exhaustive
  competitor-hunting — that's what Validate is for. Before settling on an
  idea, it's instructed to privately weigh a few different angles within
  its assigned category rather than running with the first idea that comes
  to mind. One angle it's told to consider: **geographic replication** — a
  real company (any stage) that's demonstrably succeeded abroad but hasn't
  yet expanded to Israel, the US, or the UK (the "Rocket Internet"
  playbook). If it goes this route, it's told to confirm the source
  company's actual absence from the target market via search first, and to
  name the real source company as evidence — that's expected here and is
  different from claiming a secured partnership.
- **`/api/validate`** — takes the person's own idea and runs SGG's **deep,
  rigorous validation pass**: explicitly told to hunt for competitors from
  multiple angles (direct, adjacent/substitute, well-funded incumbents who
  could expand in) before rating anything, and to give low scores/say "no"
  when an incumbent already exists. It's built to kill ideas, not flatter
  them. The output is a genuine 2-3 page research memo (roughly
  1000-1500 words), not a summary: every part of the idea — problem,
  solution, market opportunity, edge — gets an explicit evidence-for and
  evidence-against paragraph, 4-6 primary competitors are listed with scale
  (funding/reach where known), and the star rating comes with a written
  rationale explaining exactly what evidence drove it.
- **`/api/plan`** — takes an idea (already screened) and writes a full
  business plan in SGG's own house format (matching the structure of real
  plans like InnerOS's): a short Overview, then seven numbered sections
  (Problem & Market Opportunity, Solution & Product, Business Model,
  Go-to-Market, Key Challenges, Team & Operating Plan, Capital Requirements
  & Next Steps), no appendices. Pricing is a required, explicitly-grounded
  part of the Business Model section — real comparable products named by
  price, an actual price point or range, and the reasoning behind it — not
  an afterthought. The same call also produces a condensed **one-pager**
  (its own tagline and shortened problem/solution/market/edge/ask, not just
  copy-pasted section text — printable straight to PDF from the browser)
  and a set of **financial assumptions** (price, starting volume, monthly
  growth, variable cost %, fixed costs). The model only supplies those
  assumptions — the server computes the actual 24-month projection
  (`computeProjection()` in `server.js`) and generates a real, multi-sheet
  Excel workbook (`buildFinancialWorkbook()`, via `exceljs`) with live
  cross-sheet formulas, not baked-in numbers — open it and change the
  price or growth rate and everything recalculates, including the
  Year 1/Year 2 revenue totals and ending cash position on the Summary
  sheet. This is deliberately not LLM arithmetic — language models are
  unreliable at precise multi-cell math, so the model's job is judgment
  (what are reasonable assumptions) and the server's job is computation.

The website reflects this visibly, not just under the hood — Ideate's
gates are labeled "Quick screen," Validate's are labeled "Full validation."

Each engine's search budget is independently configurable
(`IDEATE_MAX_SEARCHES`, `VALIDATE_MAX_SEARCHES`, `PLAN_MAX_SEARCHES` in
`.env` — defaults 4, 10, and 8) so you can tune speed vs. depth per mode
without affecting the others.

If you want a **slower but deeper** Ideate mode later (for internal use,
not the investor demo), raise `IDEATE_MAX_SEARCHES` and feed in the real
Context Register content so it also screens against existing
Foundry/Pre-Foundry ideas — that's most of what would make this closer to
the actual weekly pipeline rather than a demo of it.

## Security notes (read before an investor meeting)

- The password is a **single shared secret**, not per-user login. Anyone
  with it can generate ideas and burn your Anthropic API credits. Rotate it
  after each demo.
- There's no rate limiting on `/api/ideate`, `/api/validate`, or `/api/plan`
  yet. If you're worried about cost or abuse, add a simple per-session or
  per-IP limit before sharing the link widely. `/api/plan` in particular
  uses more tokens per run (it's writing a full document) — worth watching
  if you open this up broadly.
- The login page and its assets are intentionally public (no password
  needed to see the login screen or the brand) — only the three engines and
  the results require auth.

## Closing the gaps between this demo and the real weekly pipeline

Four fixes, none requiring API spend to build (though they do need a real
key to actually run and prove out):

- **Context Register awareness.** `data/context-register.json` is a static
  snapshot of SGG's real Context Register from the "SGG Foundry Pipeline"
  Drive folder (Foundry, In-development, Strategic, Advisory, and Killed
  sections) — not the lightweight non-confidential stand-in used in
  earlier versions. This is a deliberate tradeoff: the real register
  contains more sensitive detail (real funding figures, real partner
  names, real Kill List reasoning) than the earlier version did, and it
  now sits inside a prompt sent to the API from a password-gated but
  still investor-facing tool. This snapshot needs manual re-syncing if the
  real register in Drive changes — there's no live connection. Both Ideate
  and Validate now check against it using the same strong/weak overlap
  weighting the real Screening Guide specifies.
- **Idea Register avoid-list.** `data/idea-register.json` mirrors the
  `SGG_AI_Engine_Idea_Register.xlsx` register — every idea this engine has
  ever generated, whether it's still live or was killed and why. This is
  separate from the real Context Register above: it's this demo's own
  generation history, not SGG's actual portfolio. Entries marked
  `"do_not_regenerate": "Y"` get compiled into an avoid-list injected
  into both Ideate (don't propose these or a close variant) and Validate
  (recognize immediately if a submitted idea matches one, then verify or
  update that conclusion with fresh research rather than assuming it still
  holds). Keep both files in sync as ideas move through stages — the
  Excel is for humans, the JSON is what the engine actually reads.
- **Hebrew sourcing.** Both Ideate and Validate are now told to run at
  least one Hebrew-language search when an idea is genuinely Israel-scoped
  — this was identified as the single biggest quality improvement on the
  real pipeline, and the demo engine had no equivalent until now.
- **Category diversity across repeated Ideate runs.** The server tracks
  the last few categories used per session (`req.session.recentCategories`)
  and excludes the most recent 2 from the next random pick, so a run of
  clicks spreads across the six focus areas instead of clustering on
  whatever the model defaults to.

None of this closes the remaining, real gap: everything here has only been
verified by manually simulating the prompts' logic with search, never by
an actual billed API call. That's the one thing that requires spending
real money to confirm.

## Note on speed vs. depth

Fewer searches, one idea at a time — that tradeoff is deliberate so this
stays fast enough to run live in a meeting. It's still using the real gate
logic and sourcing rules from the weekly pipeline, just at lower research
depth than a full weekly run (which takes 15–25 minutes). If a future
version of this needs a weekly-digest layer, editing/rating, or slide
hand-off on top of the core engine, that's an additive UI/automation build,
not a change to the engine itself.

## Required source list (`data/sources.txt`)

All three engines are required to check every source in this file directly
(a `site:` search against its domain) alongside general web search — it's a
floor, not a ceiling; the model is also told to use any other source it
finds genuinely useful.

**This file is designed for you to edit directly, without touching any
code.** Open `data/sources.txt` in any text editor (or `nano
data/sources.txt` in the terminal). Format is one source per line:

```
Name | URL | Category | Notes (optional)
```

Lines starting with `#` are comments and ignored; blank lines are ignored
too. To add a source, just add a new line — no brackets, quotes, or commas
to get wrong the way JSON requires. Save the file and restart the app
(`npm start`) for the change to take effect.

Currently seeded with the three newsletters plus the research firms your
real weekly pipeline's Run Prompt already names (NIQ, PwC, McKinsey, Bain,
Deloitte, Kantar, Euromonitor, Morgan Stanley) and the Israel State
Comptroller. Since these are checked via `site:` search, any source with
a real, crawlable website works — newsletters, research firms, government
bodies, trade publications, whatever you want the engine checking every
run. This is meant to grow to a much longer list over time.

## Gate calibration (as of the current version)

The seven gates are not weighted equally, and that's intentional:

- **G2 (Capital) and G4 (Buildable Team)** are soft checks that default to Yes. The
  $250K figure is only SGG's starting check, not a cap — an idea needing
  more total capital later is not a mark against it. Team fillability is
  assumed unless something is truly exotic.
- **G3 (Stage)** is close to a formality in Ideate (every idea there is
  invented from scratch by construction) and only does real work in
  Validate, where a submitted idea could genuinely describe an existing
  company.
- **G5 (Regulatory)** is the one gate with an explicit exception: general
  regulatory complexity (insurance, licensing, alcohol) is a flag, not a
  kill. Health/medical regulatory intensity is weighted much more heavily —
  SGG operates in health-*adjacent*, non-clinical, coaching/subscription
  territory (in the spirit of InnerOS or a youth-athlete hygiene
  subscription), but an idea requiring clinical treatment, medical
  licensure, or hospital-level infrastructure should come back No or a
  strongly-caveated Maybe.
- **G6 (Defined Claim)** is a formulation-quality check, not a rejection
  criterion — it asks "is this idea stated clearly," not "did you prove
  it." It should rarely be the reason an idea is marked down.
- **G7 (Edge)** is still the most important gate but is applied generously.
  A valid edge is either a reachable strategic partner in the field (SGG's
  network counts even before a partner is formally secured) *or* genuine,
  evidenced market openness on its own. It should only come back No against
  a specific, already-dominant, well-funded competitor — not as a default
  posture.

If you want to tighten any of this back up later, the gate descriptions
live in the `SHARED_PRINCIPLES` constant near the top of `server.js` and
apply to all three engines at once.
